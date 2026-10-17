/**
 * firestore.js — đọc/ghi Cloud Firestore từ Cloudflare Worker.
 *
 * Worker không chạy được firebase-admin (Node), nên dùng REST API + JWT ký bằng
 * service account qua WebCrypto (RS256). Access token được cache trong bộ nhớ
 * isolate (~55 phút) để không phải ký lại mỗi request.
 *
 * Biến môi trường:
 *   FIREBASE_SA = JSON service account (thô hoặc base64). Thiếu biến này thì mọi
 *   hàm ở đây thành no-op/trả null -> locks.js tự động dùng KV như trước.
 *
 * Cấu trúc dữ liệu: collection "worker", mỗi khoá KV là 1 document,
 * field value = chuỗi JSON (giống hệt giá trị đã lưu trong KV).
 */

const SCOPE = 'https://www.googleapis.com/auth/datastore';
const DEFAULT_TOKEN_URI = 'https://oauth2.googleapis.com/token';
const TOKEN_REFRESH_SKEW_MS = 5 * 60 * 1000;

let _token = { value: null, exp: 0, email: '' };

function b64url(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlStr(str) {
  return b64url(new TextEncoder().encode(str));
}

function pemToDer(pem) {
  const body = String(pem)
    .replace(/-----BEGIN [^-]+-----/, '')
    .replace(/-----END [^-]+-----/, '')
    .replace(/\s+/g, '');
  const raw = atob(body);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

/** Phân tích FIREBASE_SA (JSON thô hoặc base64). Trả null nếu thiếu/sai. */
export function serviceAccount(env) {
  const raw = env && env.FIREBASE_SA;
  if (!raw) return null;
  const text = String(raw).trim();
  if (!text) return null;
  let json = text;
  if (!text.startsWith('{')) {
    try { json = atob(text.replace(/\s+/g, '')); } catch { return null; }
  }
  try {
    const sa = JSON.parse(json);
    if (!sa.client_email || !sa.private_key || !sa.project_id) return null;
    return sa;
  } catch {
    return null;
  }
}

/** Có cấu hình Firestore hay không (quyết định dùng Firestore hay chỉ KV). */
export function fsEnabled(env) {
  return !!serviceAccount(env);
}

async function accessToken(env) {
  const sa = serviceAccount(env);
  if (!sa) return null;
  const now = Date.now();
  if (_token.value && _token.email === sa.client_email && now < _token.exp - TOKEN_REFRESH_SKEW_MS) {
    return _token.value;
  }
  const tokenUri = sa.token_uri || DEFAULT_TOKEN_URI;
  const iat = Math.floor(now / 1000);
  const header = { alg: 'RS256', typ: 'JWT', kid: sa.private_key_id };
  const claims = { iss: sa.client_email, scope: SCOPE, aud: tokenUri, iat, exp: iat + 3600 };
  const unsigned = b64urlStr(JSON.stringify(header)) + '.' + b64urlStr(JSON.stringify(claims));
  const key = await crypto.subtle.importKey(
    'pkcs8',
    pemToDer(sa.private_key),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(unsigned));
  const jwt = unsigned + '.' + b64url(new Uint8Array(sig));
  const res = await fetch(tokenUri, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=' + encodeURIComponent('urn:ietf:params:oauth:grant-type:jwt-bearer') + '&assertion=' + jwt
  });
  if (!res.ok) throw new Error('Lấy token Google thất bại (HTTP ' + res.status + ')');
  const d = await res.json();
  if (!d.access_token) throw new Error('Google không trả access_token');
  _token = {
    value: d.access_token,
    exp: now + Number(d.expires_in || 3600) * 1000,
    email: sa.client_email
  };
  return _token.value;
}

function docsBase(sa, col) {
  return 'https://firestore.googleapis.com/v1/projects/' + encodeURIComponent(sa.project_id) +
    '/databases/(default)/documents/' + encodeURIComponent(col);
}

function fieldString(doc) {
  const v = doc && doc.fields && doc.fields.value;
  return v && v.stringValue != null ? v.stringValue : null;
}

/** Đọc 1 document -> chuỗi giá trị, hoặc null nếu chưa có. */
export async function fsGet(env, col, docId) {
  const sa = serviceAccount(env);
  if (!sa) return null;
  const token = await accessToken(env);
  const res = await fetch(docsBase(sa, col) + '/' + encodeURIComponent(docId), {
    headers: { authorization: 'Bearer ' + token }
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error('Firestore đọc lỗi (HTTP ' + res.status + ')');
  return fieldString(await res.json());
}

/** Ghi (tạo/thay) 1 document. Ném lỗi nếu ghi thất bại. */
export async function fsSet(env, col, docId, value) {
  const sa = serviceAccount(env);
  if (!sa) return false;
  const token = await accessToken(env);
  const body = {
    fields: {
      value: { stringValue: String(value) },
      updatedAt: { integerValue: String(Date.now()) }
    }
  };
  const res = await fetch(docsBase(sa, col) + '/' + encodeURIComponent(docId), {
    method: 'PATCH',
    headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!res.ok) throw new Error('Firestore ghi lỗi (HTTP ' + res.status + ')');
  return true;
}

/** Liệt kê document trong collection, lọc theo tiền tố id. */
export async function fsList(env, col, prefix = '') {
  const sa = serviceAccount(env);
  if (!sa) return [];
  const token = await accessToken(env);
  const out = [];
  let pageToken = '';
  for (let page = 0; page < 10; page++) {
    const url = docsBase(sa, col) + '?pageSize=300' +
      (pageToken ? '&pageToken=' + encodeURIComponent(pageToken) : '');
    const res = await fetch(url, { headers: { authorization: 'Bearer ' + token } });
    if (!res.ok) throw new Error('Firestore liệt kê lỗi (HTTP ' + res.status + ')');
    const d = await res.json();
    for (const doc of (d.documents || [])) {
      const id = String(doc.name || '').split('/').pop();
      if (prefix && !id.startsWith(prefix)) continue;
      const value = fieldString(doc);
      if (value !== null) out.push({ id, value });
    }
    pageToken = d.nextPageToken || '';
    if (!pageToken) break;
  }
  return out;
}
