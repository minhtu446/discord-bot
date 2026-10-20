// Cloudflare Worker — Clowo lock server + bot control
// Env secrets: GH_PAT (GitHub PAT, can truy cap repo + workflow), ADMIN_KEY (khoá dự phòng, tuỳ chọn), BOT_KEY (khoá bot ↔ worker)
// D1 binding: DB   — cấu hình guild (cfg:/gmeta:), trạng thái bot (bot:guilds), thư mục data/
// KV binding: LOCKS — chỉ giữ dữ liệu tạm có TTL (session, lock, audit) và ảnh nền welcome
import { dbOk, dbGet, dbSet, dbList, dbDataAll, dbDataCount, dbDataPut } from './d1.js';

const GH = 'https://api.github.com/repos/minhtu446/discord-bot';
const ADMIN_ID = '1464884102238048307';
// App Discord — dùng cho OAuth Authorization Code (đổi code + refresh token) ở /session/exchange
const CLIENT_ID = '1507978908224454747';
const ALLOWED_ORIGINS = ['https://minhtu446.github.io'];
const CORS_BASE = {
  'access-control-allow-methods': 'GET,POST,DELETE,OPTIONS',
  'access-control-allow-headers': 'content-type, authorization, x-admin-key',
  'access-control-max-age': '86400'
};

function corsHeaders(request) {
  const h = { ...CORS_BASE };
  const o = request.headers.get('origin') || '';
  if (ALLOWED_ORIGINS.includes(o)) {
    h['access-control-allow-origin'] = o;
    h['vary'] = 'Origin';
  }
  return h;
}

// Chặn request đến từ website khác (kể cả khi trình duyệt không chặn CORS)
function originBlocked(request) {
  const o = request.headers.get('origin');
  return !!o && !ALLOWED_ORIGINS.includes(o);
}

function json(data, status = 200, request) {
  const headers = { 'content-type': 'application/json' };
  if (request) Object.assign(headers, corsHeaders(request));
  return new Response(JSON.stringify(data), { status, headers });
}

// Lỗi truy cập server: CHỈ 401 mới là "phiên hết hạn".
// 403 = token vẫn sống nhưng Discord từ chối (thiếu scope "guilds"...) — báo đúng, đừng đổ lỗi phiên.
function accessError(request, m) {
  if (m && m.kvError) return kvUnavailable(request, m);
  if (m && m.forbidden) {
    return json({ error: 'Discord từ chối quyền truy cập server này (thiếu scope "guilds"?) — hãy đăng nhập lại.', code: 'FORBIDDEN' }, 403, request);
  }
  return json({ error: 'Phiên Discord đã hết hạn — hãy đăng nhập lại.', code: 'SESSION_EXPIRED' }, 401, request);
}

// KV (phiên/cấu hình) truy cập không được → ĐÂY KHÔNG PHẢI "hết phiên".
// Báo 503 để panel thử lại, thay vì bắt người dùng đăng nhập lại vô ích.
function kvUnavailable(request, e) {
  return json({
    error: 'Máy chủ đang truy cập dữ liệu lỗi — thử lại sau ít phút (bạn CHƯA hết phiên).',
    code: 'KV_UNAVAILABLE',
    detail: (e && e.message) ? String(e.message).slice(0, 200) : undefined
  }, 503, request);
}

// Ném lỗi KV — phân biệt rõ với 401 "phiên hết hạn"
function kvError(message) {
  const e = new Error(message || 'KV session lỗi');
  e.kvError = true;
  return e;
}

async function discordUid(token) {
  if (!token) return null;
  const t = String(token).replace(/^Bearer\s+/i, '').trim();
  if (!t) return null;
  try {
    const r = await fetch('https://discord.com/api/v10/users/@me', {
      headers: { 'Authorization': 'Bearer ' + t }
    });
    if (!r.ok) return null;
    const u = await r.json();
    return (u && u.id) || null;
  } catch { return null; }
}

async function getUser(env, uid) {
  try {
    const raw = await env.LOCKS.get('user:' + uid);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch { return null; }
}

async function isBanned(env, uid) {
  const u = await getUser(env, uid);
  return !!(u && u.banned);
}

async function isAdminPerson(env, uid) {
  const u = await getUser(env, uid);
  if (u && u.banned) return false;
  if (u && u.rank === 'admin') return true;
  return uid === (env.ADMIN_ID || ADMIN_ID);
}

function ownerUid(env) { return env.ADMIN_ID || ADMIN_ID; }

function timingSafeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || !a || !b) return false;
  const ea = new TextEncoder().encode(a);
  const eb = new TextEncoder().encode(b);
  let diff = ea.length ^ eb.length;
  for (let i = 0; i < Math.max(ea.length, eb.length); i++) {
    diff |= (ea[i % ea.length] || 0) ^ (eb[i % eb.length] || 0);
  }
  return diff === 0;
}

function adminKeyOk(request, env) {
  if (!env.ADMIN_KEY) return false;
  return timingSafeEqual(request.headers.get('x-admin-key') || '', env.ADMIN_KEY);
}

// ─── Phiên đăng nhập (thay token trong trình duyệt bằng session id ngắn hạn) ───
// Phiên KHÔNG còn TTL: giữ vĩnh viễn trong KV. Nhờ luồng Authorization Code có
// refresh_token, worker tự gia hạn access token trước khi hết hạn.
const SESSION_REFRESH_SKEW = 4 * 3600 * 1000; // gia hạn trước khi hết hạn 4 giờ

function genSid() {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return 's_' + Array.from(b).map(x => x.toString(16).padStart(2, '0')).join('');
}

// Gia hạn access token bằng refresh_token (Discord xoay vòng refresh token mỗi lần).
// Cập nhật tại chỗ vào rec; trả về true nếu thành công.
async function refreshSession(env, rec) {
  if (!rec || !rec.refresh_token || !env.DISCORD_SECRET) return false;
  try {
    const r = await fetch('https://discord.com/api/v10/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: CLIENT_ID,
        client_secret: env.DISCORD_SECRET,
        grant_type: 'refresh_token',
        refresh_token: rec.refresh_token
      })
    });
    if (!r.ok) return false;
    const d = await r.json();
    if (!d || !d.access_token) return false;
    rec.token = d.access_token;
    if (d.refresh_token) rec.refresh_token = d.refresh_token; // luôn lưu bản mới
    rec.expires_at = Date.now() + (Number(d.expires_in) || 604800) * 1000;
    rec.at = Date.now();
    return true;
  } catch { return false; }
}

// ─── Đọc/giữ phiên: chống đua gia hạn, đọc lại KV, phân biệt lỗi KV vs hết hạn ───

// Đọc bản ghi phiên. Thử lại 1 lần; vẫn lỗi → NÉM kvError (đừng hiểu nhầm là "hết phiên").
async function sessionRaw(env, sid) {
  let lastErr = null;
  for (let i = 0; i < 2; i++) {
    try {
      const raw = await env.LOCKS.get('session:' + sid);
      if (!raw) return null;
      const rec = JSON.parse(raw);
      return (rec && rec.uid) ? rec : null;
    } catch (e) { lastErr = e; }
  }
  throw kvError('KV đọc session lỗi: ' + ((lastErr && lastErr.message) || 'không rõ'));
}

// Ngưỡng gia hạn tính theo TUỔI THỌ THẬT của phiên: life = expires_at − at.
//   Còn < 20% life HOẶC < 4 giờ → gia hạn.
//   Kẹp tối đa 50% life để token sống ngắn không bị gia hạn liên tục.
function refreshThreshold(rec) {
  const life = (rec.at && rec.expires_at) ? Math.max(rec.expires_at - rec.at, 0) : 7 * 24 * 3600 * 1000;
  if (life < SESSION_REFRESH_SKEW) return Math.max(life / 2, 60000);
  return Math.min(Math.max(life * 0.2, SESSION_REFRESH_SKEW), life * 0.5);
}
function sessionNeedsRefresh(rec) {
  if (!rec || !rec.refresh_token || !rec.expires_at || !rec.at) return false;
  return (rec.expires_at - Date.now()) < refreshThreshold(rec);
}

// Chống ĐUA gia hạn: Discord xoay vòng refresh_token. Hai request cùng gia hạn với
// cùng một token thì lần sau THẤT BẠI (và có thể ghi đè mất token mới). Map sid →
// Promise để mọi request song song dùng chung đúng một lần gia hạn.
const SESSION_REFRESH = new Map();

// force=false → chỉ gia hạn khi tới ngưỡng. force=true → luôn (Dùng cho 401/cron).
// Trả về { rec, ok } — rec = bản ghi mới nhất (nếu đọc được), ok = vừa gia hạn thành công.
async function refreshSessionCoord(env, sid, force) {
  const running = SESSION_REFRESH.get(sid);
  if (running) return running;
  const p = (async () => {
    try {
      // ĐỌC LẠI KV trước khi gia hạn: request khác có thể đã lưu refresh_token mới hơn.
      const rec = await sessionRaw(env, sid);
      if (!rec) return { rec: null, ok: false };
      if (!force && !sessionNeedsRefresh(rec)) return { rec, ok: false };
      const before = rec.token;
      if (await refreshSession(env, rec)) {
        await env.LOCKS.put('session:' + sid, JSON.stringify(rec));
        return { rec, ok: true };
      }
      // Gia hạn THẤT BẠI → đọc lại KV lần nữa (ai đó có thể đã lưu token mới).
      const again = await sessionRaw(env, sid);
      if (again && again.token && again.token !== before) return { rec: again, ok: false };
      return { rec, ok: false };
    } catch (e) {
      if (e && e.kvError) throw e;
      return { rec: null, ok: false };
    } finally {
      SESSION_REFRESH.delete(sid);
    }
  })();
  SESSION_REFRESH.set(sid, p);
  return p;
}

async function sessionLookup(env, sid) {
  if (!sid || !String(sid).startsWith('s_')) return null;
  const rec = await sessionRaw(env, sid); // KV lỗi → ném kvError (không phải "hết phiên")
  if (!rec) return null;
  if (sessionNeedsRefresh(rec)) {
    const r = await refreshSessionCoord(env, sid, false);
    if (r && r.rec) return r.rec;
    return rec;
  }
  return rec;
}

// Quét mọi phiên và gia hạn (chạy theo cron) → refresh token không bị "bỏ không" quá lâu.
async function refreshAllSessions(env) {
  let n = 0;
  try {
    let cursor;
    do {
      const page = await env.LOCKS.list({ prefix: 'session:', limit: 1000, ...(cursor ? { cursor } : {}) });
      for (const k of page.keys) {
        try {
          const sid = String(k.name).replace(/^session:/, '');
          if (!sid.startsWith('s_')) continue;
          const r = await refreshSessionCoord(env, sid, true);
          if (r && r.ok) n++;
        } catch { continue; }
      }
      cursor = page.list_complete ? null : page.cursor;
    } while (cursor);
  } catch {}
  return n;
}

// Tạo phiên từ access token (+ refresh_token nếu có)
async function buildSession(env, token, refreshToken, expiresIn) {
  const t = String(token || '').replace(/^Bearer\s+/i, '').trim();
  if (!t) return null;
  try {
    const me = await fetch('https://discord.com/api/v10/users/@me', { headers: { 'Authorization': 'Bearer ' + t } });
    if (!me.ok) return null;
    const u = await me.json();
    if (!u || !u.id) return null;
    let guilds = [];
    const gr = await fetch('https://discord.com/api/v10/users/@me/guilds', { headers: { 'Authorization': 'Bearer ' + t } });
    if (gr.ok) {
      const d = await gr.json();
      guilds = (Array.isArray(d) ? d : []).map(g => ({ id: g.id, name: g.name, icon: g.icon, permissions: g.permissions }));
    }
    const sid = genSid();
    const rec = { uid: u.id, token: t, at: Date.now() };
    if (refreshToken) {
      rec.refresh_token = String(refreshToken);
      rec.expires_at = Date.now() + (Number(expiresIn) || 604800) * 1000;
    }
    // KHÔNG đặt expirationTtl → phiên sống vĩnh viễn (tự gia hạn bằng refresh_token)
    await env.LOCKS.put('session:' + sid, JSON.stringify(rec));
    // Đăng nhập lại → xoá cache quyền cũ của uid để lấy lại quyền mới ngay
    try { GUILD_CACHE.delete(u.id); } catch {}
    return {
      session: sid,
      uid: u.id,
      name: u.global_name || u.username,
      avatar: u.avatar,
      isAdmin: await isAdminPerson(env, u.id),
      isRoot: u.id === ownerUid(env),
      banned: await isBanned(env, u.id),
      guilds
    };
  } catch { return null; }
}

// Luồng CŨ (implicit grant): dán thẳng access token — KHÔNG có refresh_token nên vẫn hết hạn sau 7 ngày.
// Giữ lại làm đường lui cho panel cũ còn cache trong trình duyệt.
async function newSession(env, token) {
  return buildSession(env, token, null, 0);
}

// Luồng MỚI (Authorization Code + PKCE): đổi code lấy access_token + refresh_token
async function exchangeCode(env, body) {
  const code = clampStr(body && body.code, 300);
  const redirect = clampStr(body && body.redirect_uri, 300);
  const verifier = clampStr(body && body.code_verifier, 200);
  if (!code || !redirect || !env.DISCORD_SECRET) return null;
  try {
    const form = new URLSearchParams({
      client_id: CLIENT_ID,
      client_secret: env.DISCORD_SECRET,
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirect
    });
    if (verifier) form.set('code_verifier', verifier);
    const r = await fetch('https://discord.com/api/v10/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form
    });
    if (!r.ok) return null;
    const d = await r.json();
    if (!d || !d.access_token) return null;
    return buildSession(env, d.access_token, d.refresh_token, d.expires_in);
  } catch { return null; }
}

// Nhận diện chủ tài khoản: ưu tiên session, còn không thì token Discord thô (tương thích ngược)
async function authRecord(env, request, body) {
  if (body && body.session) {
    const s = await sessionLookup(env, body.session);
    if (s) return { uid: s.uid, token: s.token, sid: String(body.session) };
  }
  const auth = String(request.headers.get('authorization') || '');
  let sid = null;
  if (auth.startsWith('s_')) sid = auth;
  else if (auth.startsWith('Bearer s_')) sid = auth.slice(7);
  if (sid) {
    const s = await sessionLookup(env, sid);
    if (s) return { uid: s.uid, token: s.token, sid };
  }
  if (body && body.discordToken) {
    const uid = await discordUid(body.discordToken);
    if (uid) return { uid, token: body.discordToken };
  }
  const t = auth.replace(/^Bearer\s+/i, '').trim();
  if (t) {
    const uid = await discordUid(t);
    if (uid) return { uid, token: t };
  }
  return null;
}

async function authUid(env, request, body) {
  const r = await authRecord(env, request, body);
  return r ? r.uid : null;
}

// Quyền quản lý quyền: khoá dự phòng HOẶC chủ tài khoản có quyền admin
async function canManagePerms(request, env) {
  const keyOk = adminKeyOk(request, env);
  if (keyOk) return { keyOk, uid: null, isRoot: true };
  let uid = null;
  try {
    const body = await readJson(request);
    uid = await authUid(env, request, body);
  } catch (e) {
    if (e && e.kvError) throw e; // lỗi KV → để tầng trên báo 503, KHÔNG báo 401
  }
  if (!uid) uid = await authUid(env, request, null);
  if (!uid) return { keyOk: false, uid: null, isRoot: false, noToken: true };
  if (!(await isAdminPerson(env, uid))) return { keyOk: false, uid, isRoot: false, notAdmin: true };
  return { keyOk: false, uid, isRoot: uid === ownerUid(env) };
}

const MAX_BODY = 2048;
// D1 giới hạn ~2MB/dòng — chặn sớm hơn để báo rõ tên tệp thay vì lỗi SQL khó hiểu
const MAX_DATA_FILE = 1500000;
const RATE = new Map();

function rateLimited(key, max, win) {
  const now = Date.now();
  let arr = RATE.get(key);
  if (!arr) { arr = []; RATE.set(key, arr); }
  while (arr.length && now - arr[0] > win) arr.shift();
  if (arr.length >= max) return true;
  arr.push(now);
  return false;
}

function clientIp(request) {
  const raw = request.headers.get('cf-connecting-ip') || request.headers.get('x-real-ip') || '';
  return (raw || 'unknown').split(',')[0].trim() || 'unknown';
}

async function readJson(request) {
  const len = Number(request.headers.get('content-length') || 0);
  if (len > MAX_BODY) throw new Error('LARGE');
  const text = await request.text();
  if (text.length > MAX_BODY) throw new Error('LARGE');
  return JSON.parse(text);
}

async function readJsonLimit(request, max) {
  const len = Number(request.headers.get('content-length') || 0);
  if (len > max) throw new Error('LARGE');
  const text = await request.text();
  if (text.length > max) throw new Error('LARGE');
  return JSON.parse(text);
}

async function botKeyOk(request, env) {
  const k = request.headers.get('x-bot-key') || '';
  return !!env.BOT_KEY && timingSafeEqual(k, env.BOT_KEY);
}

// ─── Quyền quản lý guild theo Discord: owner hoặc permission MANAGE_GUILD (0x20) / ADMINISTRATOR (0x8) ───
const GUILD_CACHE = new Map(); // uid -> { at, guilds }
// Lỗi/401 KHÔNG được cache thành "không có guild nào" (bug cũ: cache [] 60s làm MỌI server đều bị coi là không có quyền).
async function manageGuilds(env, rec) {
  const uid = rec && rec.uid;
  if (!uid) return { ok: false, expired: false, guilds: [] };
  const now = Date.now();
  const c = GUILD_CACHE.get(uid);
  if (c && now - c.at < 60000) return { ok: true, expired: false, guilds: c.guilds };
  let guilds = null;
  let expired = false;
  let forbidden = false;
  let token = rec.token;
  for (let attempt = 0; attempt < 2; attempt++) {
    let r = null;
    try {
      r = await fetch('https://discord.com/api/v10/users/@me/guilds', { headers: { 'Authorization': 'Bearer ' + token } });
    } catch { break; }
    if (r.ok) {
      const d = await r.json();
      guilds = Array.isArray(d) ? d : [];
      break;
    }
    // Token chết TRƯỚC HẠN (bị thu hồi/sai tuổi thọ) → gia hạn bằng refresh_token rồi THỬ LẠI
    // một lần trước khi kết luận "hết phiên". Lỗi KV ở đây ném ra ngoài → 503, không phải 401.
    if (r.status === 401 && attempt === 0 && rec.sid) {
      const rr = await refreshSessionCoord(env, rec.sid, true);
      if (rr && rr.rec && rr.rec.token && rr.rec.token !== token) { token = rr.rec.token; continue; }
      break;
    }
    if (r.status === 401) expired = true;   // token chết → cần đăng nhập lại
    else if (r.status === 403) forbidden = true; // token còn sống nhưng thiếu quyền/scope → KHÔNG phải hết hạn
    break;
  }
  if (guilds === null) return { ok: false, expired, forbidden, guilds: [] }; // lỗi → KHÔNG cache
  GUILD_CACHE.set(uid, { at: now, guilds });
  return { ok: true, expired: false, forbidden: false, guilds };
}
function permCanManage(v) {
  try { const b = BigInt(String(v == null ? '0' : v)); return (b & 8n) !== 0n || (b & 32n) !== 0n; } catch { return false; }
}
async function canManageGuild(env, rec, gid) {
  if (!rec || !rec.uid) return { ok: false, expired: false, forbidden: false, can: false };
  const m = await manageGuilds(env, rec);
  if (!m.ok) return { ok: false, expired: !!m.expired, forbidden: !!m.forbidden, can: false };
  const g = m.guilds.find(x => String(x.id) === String(gid));
  return { ok: true, expired: false, forbidden: false, can: !!(g && (g.owner || permCanManage(g.permissions))) };
}

// ─── Chuẩn hoá cấu hình tính năng web (welcome/ticket/voice/emojiRole/pickrole) ───
function clampStr(v, n) { return String(v == null ? '' : v).slice(0, n); }
function idOrNull(v) { const s = String(v == null ? '' : v); return /^\d{15,20}$/.test(s) ? s : ''; }
function intIn(v, min, max, dflt) {
  const n = Number(v);
  if (!Number.isFinite(n)) return dflt;
  return Math.max(min, Math.min(max, Math.round(n)));
}
function colorInt(v, dflt) {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0 || n > 0xFFFFFF) return dflt;
  return Math.round(n);
}
function hexStr(v, dflt) {
  const s = String(v == null ? '' : v).trim();
  return /^#[0-9a-fA-F]{6}$/.test(s) ? s.toLowerCase() : dflt;
}
// Màu cho ô welcome: cho phép #rrggbb hoặc rgba(...) — bot dùng cả 2.
function colorStr(v, dflt) {
  const s = String(v == null ? '' : v).trim();
  if (/^#[0-9a-fA-F]{6}$/.test(s)) return s.toLowerCase();
  if (/^rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*(,\s*(0|1|0?\.\d+)\s*)?\)$/.test(s)) return s;
  return dflt;
}
const WELCOME_FONT_KEYS = ['sans', 'serif', 'mono', 'bevietnam', 'montserrat', 'oswald', 'playfair', 'dancing', 'slab', 'rubik', 'kanit', 'bebas', 'lobster', 'pacifico'];
// Một phần tử trên ảnh welcome: text | name | user | box | guildicon.
function sanitizeWelcomeText(t) {
  if (!t || typeof t !== 'object') return null;
  const kind = ['text', 'name', 'user', 'box', 'guildicon'].includes(t.kind) ? t.kind : 'text';
  const txt = clampStr(t.text, 300);
  // Phần tử name/user/guildicon lấy nội dung từ thành viên/server nên không cần chữ.
  if (kind === 'text' && !txt.trim()) return null;
  const out = {
    id: clampStr(t.id, 24) || ('t' + Math.random().toString(36).slice(2, 8)),
    kind: kind,
    x: intIn(t.x, -100, 1200, 450),
    y: intIn(t.y, -100, 700, 225),
    size: intIn(t.size, 8, 96, kind === 'text' ? 28 : 20),
    color: colorStr(t.color, kind === 'user' ? 'rgba(255,255,255,0.45)' : '#ffffff'),
    bold: !!t.bold,
    italic: !!t.italic,
    align: ['left', 'center', 'right'].includes(t.align) ? t.align : (kind === 'text' ? 'center' : 'left'),
    shadow: !!t.shadow,
    font: WELCOME_FONT_KEYS.includes(t.font) ? t.font : 'sans'
  };
  if (kind === 'text') { out.text = txt; out.box = !!t.box; }
  else if (kind === 'box') {
    out.text = txt;
    out.label = clampStr(t.label, 20);
    out.labelColor = colorStr(t.labelColor, 'rgba(255,255,255,0.2)');
    out.labelSize = intIn(t.labelSize, 6, 40, 10);
    out.box = !!t.box;
  } else if (kind === 'name') {
    out.upper = t.upper !== false;
    out.underline = t.underline !== false;
  } else if (kind === 'guildicon') {
    out.shape = ['circle', 'square', 'rounded'].includes(t.shape) ? t.shape : 'circle';
  }
  // Khung (tuỳ chọn): chỉ thêm khi có — vắng mặt = tự bám theo chữ.
  if (Number.isFinite(Number(t.w)) && Number(t.w) > 0) out.w = intIn(t.w, 10, 900, 200);
  if (Number.isFinite(Number(t.h)) && Number(t.h) > 0) out.h = intIn(t.h, 8, 400, 36);
  return out;
}

function base64Decode(b64) {
  try {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch { return null; }
}

async function sha256hex(bytes) {
  const buf = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

function sanitizeGuildConfig(raw) {
  const c = raw && typeof raw === 'object' ? raw : {};
  const out = {};

  const w = c.welcome && typeof c.welcome === 'object' ? c.welcome : {};
  out.welcome = {
    enabled: w.enabled !== false,
    channelId: idOrNull(w.channelId),
    content: clampStr(w.content, 1000),
    backgroundUrl: clampStr(w.backgroundUrl, 1000),
    bgVersion: typeof w.bgVersion === 'string' ? w.bgVersion.slice(0, 64) : '',
    avatarSize: intIn(w.avatarSize, 60, 400, 130),
    avatarW: intIn(w.avatarW, 40, 860, intIn(w.avatarSize, 60, 400, 130)),
    avatarH: intIn(w.avatarH, 40, 440, intIn(w.avatarSize, 60, 400, 130)),
    avatarShape: ['circle', 'square', 'rounded'].includes(w.avatarShape) ? w.avatarShape : 'circle',
    avatarX: intIn(w.avatarX, 10, 860, 65),
    avatarY: intIn(w.avatarY, 10, 410, 150),
    bgX: intIn(w.bgX, -2000, 2000, 0),
    bgY: intIn(w.bgY, -2000, 2000, 0),
    bgZoom: intIn(w.bgZoom, 50, 300, 100),
    info: (w.info && typeof w.info === 'object' && Number.isFinite(Number(w.info.x))) ? {
      x: intIn(w.info.x, -100, 1100, 255),
      y: intIn(w.info.y, -100, 650, 157),
      w: intIn(w.info.w, 120, 900, 545),
      h: intIn(w.info.h, 50, 400, 153)
    } : null,
    elsCustom: w.elsCustom === true ? true : null,
    texts: Array.isArray(w.texts) ? w.texts.slice(0, 24).map(sanitizeWelcomeText).filter(Boolean) : [],
    roles: Array.isArray(w.roles) ? w.roles.map(idOrNull).filter(Boolean).slice(0, 50) : []
  };

  const t = c.ticket && typeof c.ticket === 'object' ? c.ticket : {};
  const tp = t.panel && typeof t.panel === 'object' ? t.panel : {};
  const tt = t.ticket && typeof t.ticket === 'object' ? t.ticket : {};
  out.ticket = {
    enabled: t.enabled !== false,
    categoryId: idOrNull(t.categoryId),
    panel: { content: clampStr(tp.content, 1000), color: colorInt(tp.color, 0x5865F2), title: clampStr(tp.title, 256), button: clampStr(tp.button, 80) },
    ticket: { content: clampStr(tt.content, 1000), color: colorInt(tt.color, 0x5865F2) },
    allow: Array.isArray(t.allow) ? t.allow.slice(0, 200).map(x => ({
      id: idOrNull(x && x.id),
      type: (x && x.type === 'role') ? 'role' : 'user'
    })).filter(x => x.id) : []
  };

  const v = c.voice && typeof c.voice === 'object' ? c.voice : {};
  out.voice = {
    enabled: v.enabled !== false,
    hubChannelId: idOrNull(v.hubChannelId),
    categoryId: idOrNull(v.categoryId)
  };

  const e = c.emojiRole && typeof c.emojiRole === 'object' ? c.emojiRole : {};
  out.emojiRole = {
    enabled: e.enabled !== false,
    roles: Array.isArray(e.roles) ? e.roles.map(idOrNull).filter(Boolean).slice(0, 50) : []
  };

  const p = c.pickrole && typeof c.pickrole === 'object' ? c.pickrole : {};
  out.pickrole = {
    enabled: p.enabled !== false,
    mode: p.mode === 'single' ? 'single' : 'multi',
    title: clampStr(p.title, 100),
    content: clampStr(p.content, 1000),
    items: Array.isArray(p.items) ? p.items.slice(0, 100).map(x => ({
      roleId: idOrNull(x && x.roleId),
      emoji: clampStr(x && x.emoji, 100).trim()
    })).filter(x => x.roleId && x.emoji) : []
  };

  return out;
}

async function ghFetch(env, path, opts = {}) {
  return fetch(GH + path, {
    ...opts,
    headers: {
      'Accept': 'application/vnd.github+json',
      'Authorization': 'Bearer ' + env.GH_PAT,
      'X-GitHub-Api-Version': '2022-11-28',
      ...(opts.headers || {})
    }
  });
}

// Nhật ký thay đổi quyền (giữ 50 dòng mới) để phát hiện lạm dụng
async function audit(env, entry) {
  try {
    const e = { at: Date.now(), ...entry };
    const key = 'audit:' + String(e.at).padStart(14, '0') + ':' + Math.random().toString(36).slice(2, 8);
    await env.LOCKS.put(key, JSON.stringify(e));
    const rawIdx = await env.LOCKS.get('auditIndex') || '[]';
    let arr = [];
    try { arr = JSON.parse(rawIdx); } catch {}
    if (!Array.isArray(arr)) arr = [];
    arr.push(key);
    const keep = arr.slice(-50);
    const drop = arr.slice(0, Math.max(0, arr.length - 50));
    await env.LOCKS.put('auditIndex', JSON.stringify(keep));
    for (const k of drop) await env.LOCKS.delete(k);
  } catch {}
}

function idxAdd(env, idxKey, id) {
  return (async () => {
    try {
      const raw = await env.LOCKS.get(idxKey) || '[]';
      let arr = [];
      try { arr = JSON.parse(raw); } catch {}
      if (!Array.isArray(arr)) arr = [];
      arr = arr.map(String);
      const s = String(id);
      if (!arr.includes(s)) {
        arr.push(s);
        await env.LOCKS.put(idxKey, JSON.stringify(arr.slice(-500)));
      }
    } catch {}
  })();
}

function idxRemove(env, idxKey, id) {
  return (async () => {
    try {
      const raw = await env.LOCKS.get(idxKey) || '[]';
      let arr = [];
      try { arr = JSON.parse(raw); } catch {}
      if (!Array.isArray(arr)) arr = [];
      const next = arr.map(String).filter(x => x !== String(id));
      if (next.length !== arr.length) await env.LOCKS.put(idxKey, JSON.stringify(next));
    } catch {}
  })();
}

// ── Cấu hình guild: D1 (SQLite) là nguồn chính duy nhất ───────────────────
// KV đã không còn giữ bản sao cfg:/gmeta: (trước đây mirror KV ăn hết hạn mức
// ghi miễn phí). KV chỉ giữ dữ liệu tạm có TTL + ảnh nền welcome.
const BOT_GUILDS_KEY = 'bot:guilds';

function requireDb(env) {
  if (!dbOk(env)) throw new Error('Worker thiếu binding D1 (DB) — kiểm tra wrangler.toml.');
}

async function storeGet(env, key) {
  if (!dbOk(env)) return null;
  try { return await dbGet(env, key); } catch (e) {
    console.warn('[D1] đọc ' + key + ' lỗi: ' + e.message);
    return null;
  }
}

async function storePut(env, key, value) {
  requireDb(env);
  await dbSet(env, key, value);   // lỗi thì ném lên trên → báo rõ cho người dùng
}

async function storeList(env, prefix) {
  if (!dbOk(env)) return [];
  try { return await dbList(env, prefix); } catch (e) {
    console.warn('[D1] liệt kê ' + prefix + ' lỗi: ' + e.message);
    return [];
  }
}

// Danh sách server bot đang ở (bot tự đẩy lên). Trả null khi chưa có bản ghi
// → /guilds không lọc gì, giữ nguyên hành vi cũ.
async function botGuildSet(env) {
  try {
    const raw = await storeGet(env, BOT_GUILDS_KEY);
    if (!raw) return null;
    const d = JSON.parse(raw);
    if (!d || !Array.isArray(d.ids)) return null;
    return new Set(d.ids.map(String));
  } catch { return null; }
}

async function getVar(env, name) {
  const r = await ghFetch(env, '/actions/variables/' + name);
  if (!r.ok) return null;
  const d = await r.json();
  return d.value;
}

async function setVar(env, name, value) {
  let r = await ghFetch(env, '/actions/variables/' + name, {
    method: 'PATCH',
    body: JSON.stringify({ name, value })
  });
  if (r.status === 404) {
    r = await ghFetch(env, '/actions/variables', {
      method: 'POST',
      body: JSON.stringify({ name, value })
    });
  }
  return r.status === 200 || r.status === 201 || r.status === 204;
}

async function botStatus(env) {
  const ran = await ghFetch(env, '/actions/workflows/bot-runner.yml/runs?per_page=5');
  let running = false, runId = null;
  if (ran.ok) {
    const d = await ran.json();
    const latest = (d.workflow_runs || [])[0];
    running = !!(latest && latest.status === 'in_progress');
    runId = running ? latest.id : null;
  }
  const stopped = (await getVar(env, 'BOT_STOP')) === '1';
  return { running, runId, stopped };
}

async function doControl(env, action) {
  if (action === 'stop') {
    await setVar(env, 'BOT_STOP', '1');
    const st = await botStatus(env);
    if (st.runId) {
      const cr = await ghFetch(env, '/actions/runs/' + st.runId + '/cancel', { method: 'POST' });
      if (cr.ok || cr.status === 409) return { ok: true, message: 'Đã khóa + tắt bot!' };
      return { ok: true, message: 'Đã khóa — run hiện tại sẽ tự dừng.' };
    }
    return { ok: true, message: 'Bot đang tắt — đã kích hoạt khóa (cron sẽ không tự bật).' };
  }
  await setVar(env, 'BOT_STOP', '0');
  const st = await botStatus(env);
  if (action === 'restart' && st.runId) {
    await ghFetch(env, '/actions/runs/' + st.runId + '/cancel', { method: 'POST' });
    await new Promise(r => setTimeout(r, 5000));
  }
  const disp = await ghFetch(env, '/actions/workflows/bot-runner.yml/dispatches', {
    method: 'POST',
    body: JSON.stringify({ ref: 'main', inputs: { action: 'start' } })
  });
  if (disp.ok || disp.status === 204) {
    return { ok: true, message: action === 'restart' ? 'Đã restart! Đang khởi động...' : 'Đã gửi lệnh bật bot! Đang khởi động...' };
  }
  return { ok: false, error: 'Lỗi khi gửi lệnh bật bot (HTTP ' + disp.status + ')' };
}

export default {
  // Cron: định kỳ gia hạn mọi phiên để refresh token không bị coi là "bỏ không"
  async scheduled(event, env, ctx) {
    ctx.waitUntil(refreshAllSessions(env).then(n => console.log('[session] cron đã gia hạn', n, 'phiên')));
  },
  async fetch(request, env) {
    try { // Bắt lỗi chung: lỗi KV → 503, còn lại → 500. KHÔNG bao giờ để thành "phiên hết hạn".
    const url = new URL(request.url);
    const path = url.pathname;
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(request) });
    if (originBlocked(request)) return json({ error: 'Origin không được phép.' }, 403, request);

    const ip = clientIp(request);

    // Panel hỏi trước khi đăng nhập: worker đã có DISCORD_SECRET chưa?
    //  - true  → panel dùng luồng Authorization Code (+PKCE) → phiên có refresh_token, không hết hạn
    //  - false → panel dùng luồng implicit cũ (vẫn đăng nhập được như trước)
    // Nhờ vậy thứ tự deploy không còn quan trọng: đặt secret xong là panel tự chuyển luồng.
    if (path === '/oauth/cap' && request.method === 'GET') {
      return json({ code: !!env.DISCORD_SECRET }, 200, request);
    }

    if (path === '/status' && request.method === 'GET') {
      const uid = await authUid(env, request, null);
      if (!(await isAdminPerson(env, uid))) return json({ error: 'Forbidden' }, 403, request);
      return json(await botStatus(env), 200, request);
    }

    if (path === '/admin/whoami' && request.method === 'GET') {
      if (rateLimited('g:'+ip, 120, 10000)) return json({ error: 'Bạn thao tác hơi nhanh - chờ vài giây rồi thử lại.' }, 429, request);
      const uid = await authUid(env, request, null);
      if (!uid) return json({ uid: null, isAdmin: false, isRoot: false, banned: false }, 200, request);
      return json({ uid, isAdmin: await isAdminPerson(env, uid), isRoot: uid === ownerUid(env), banned: await isBanned(env, uid) }, 200, request);
    }

    if (path === '/admin/ranks' && request.method === 'GET') {
      if (rateLimited('g:' + ip, 60, 10000)) return json({ error: 'Bạn thao tác hơi nhanh - chờ vài giây rồi thử lại.' }, 429, request);
      const gate = await canManagePerms(request, env);
      if (gate.noToken) return json({ error: 'Token Discord hết hạn hoặc sai — hoặc dán khoá dự phòng (ADMIN_KEY).' }, 401, request);
      if (gate.notAdmin) return json({ error: 'Chỉ admin.' }, 403, request);
      if (rateLimited('r:' + (gate.uid || 'key') + ip, 30, 10000)) return json({ error: 'Bạn thao tác hơi nhanh - chờ vài giây rồi thử lại.' }, 429, request);
      const users = [];
      const rawIdx = await env.LOCKS.get('userIndex') || '[]';
      let uids = [];
      try { uids = JSON.parse(rawIdx); } catch {}
      if (!Array.isArray(uids)) uids = [];
      for (const uid of uids.slice(-1000)) {
        try {
          const rawVal = await env.LOCKS.get('user:' + uid);
          if (!rawVal) continue;
          const d = JSON.parse(rawVal);
          if (!d.rank) continue;
          users.push({
            uid,
            rank: d.rank || 'member',
            banned: !!d.banned,
            at: d.at || 0,
            by: d.by || ''
          });
        } catch { continue; }
      }
      users.sort((a, b) => (b.at || 0) - (a.at || 0));
      return json({ ownerUid: ownerUid(env), users, viaKey: !!gate.keyOk }, 200, request);
    }

    if (path === '/admin/rank' && request.method === 'POST') {
      if (rateLimited('p:' + ip, 30, 10000)) return json({ error: 'Bạn thao tác hơi nhanh - chờ vài giây rồi thử lại.' }, 429, request);
      try {
        const body = await readJson(request);
        const gate = await canManagePerms(request, env);
        if (gate.noToken) return json({ error: 'Token Discord hết hạn hoặc sai — hoặc dán khoá dự phòng (ADMIN_KEY).' }, 401, request);
        if (gate.notAdmin) return json({ error: 'Chỉ admin.' }, 403, request);
        const actor = gate.uid || 'key';
        const target = String(body.target || '');
        if (!/^\d{15,20}$/.test(target)) return json({ error: 'Sai User ID.' }, 400, request);
        const root = ownerUid(env);
        const wantsBan = body.rank === 'danger' || body.banned === true;
        if (wantsBan && target === root) return json({ error: 'Không thể khóa tài khoản ADMIN gốc.' }, 400, request);
        if (wantsBan && gate.uid && target === gate.uid) return json({ error: 'Không thể tự khóa chính mình.' }, 400, request);
        // Không khoá được tài khoản đang là ADMIN (trừ ADMIN gốc và khoá dự phòng) — hạ quyền thay vì khoá
        if (wantsBan && target !== root && !gate.isRoot && (await isAdminPerson(env, target))) {
          return json({ error: 'Tài khoản này đang là ADMIN — hạ về Member thay vì khoá.' }, 400, request);
        }
        if (body.rank === 'none') {
          await env.LOCKS.delete('user:' + target);
          await idxRemove(env, 'userIndex', target);
          await audit(env, { act: 'revoke', target, by: actor, via: gate.keyOk ? 'key' : 'token' });
          return json({ ok: true, user: null, removed: true }, 200, request);
        }
        const cur = (await getUser(env, target)) || {};
        if (body.rank === 'admin') { cur.rank = 'admin'; cur.banned = false; }
        else if (body.rank === 'member') { cur.rank = 'member'; cur.banned = false; }
        else if (body.rank === 'danger') { cur.rank = 'danger'; cur.banned = true; }
        else if (body.rank != null) return json({ error: 'Rank không hợp lệ.' }, 400, request);
        if (typeof body.banned === 'boolean') cur.banned = body.banned;
        cur.at = Date.now();
        cur.by = actor;
        await env.LOCKS.put('user:' + target, JSON.stringify(cur));
        await idxAdd(env, 'userIndex', target);
        await audit(env, { act: 'rank:' + (cur.rank || 'member') + (cur.banned ? '+ban' : ''), target, by: actor, via: gate.keyOk ? 'key' : 'token' });
        return json({ ok: true, user: cur }, 200, request);
      } catch {
        return json({ error: 'Payload không hợp lệ.' }, 400, request);
      }
    }

    if (path === '/control' && request.method === 'POST') {
      if (rateLimited('p:'+ip, 30, 10000)) return json({ error: 'Bạn thao tác hơi nhanh - chờ vài giây rồi thử lại.' }, 429, request);
      try {
        const body = await readJson(request);
        // Khoá dự phòng KHÔNG được phép điều khiển bot — chỉ token Discord admin
        const uid = await authUid(env, request, body);
        if (!uid) return json({ error: 'Khoá dự phòng không điều khiển được bot — cần token Discord ADMIN.' }, 401, request);
        if (!(await isAdminPerson(env, uid))) return json({ error: 'Chỉ admin được điều khiển bot.' }, 403, request);
        const gid = String(body.guildId || '');
        const existing = await env.LOCKS.get('lock:' + gid);
        if (!existing) return json({ error: 'Bạn chưa quản lý server này — hãy khóa server trước.' }, 403, request);
        const e = JSON.parse(existing);
        if (e.uid !== uid) return json({ error: 'Chỉ người đang khóa server này mới điều khiển được bot.' }, 403, request);
        const res = await doControl(env, String(body.action || ''));
        return json(res, res.ok ? 200 : 500, request);
      } catch (err) {
        if (err && err.kvError) throw err; // lỗi KV → 503 ở tầng bắt lỗi chung
        return json({ error: 'Payload không hợp lệ.' }, 400, request);
      }
    }

    if (path === '/session' && request.method === 'POST') {
      if (rateLimited('s:' + ip, 15, 60000)) return json({ error: 'Bạn thao tác hơi nhanh - chờ vài giây rồi thử lại.' }, 429, request);
      try {
        const body = await readJson(request);
        const rec = await newSession(env, body.token);
        if (!rec) return json({ error: 'Token Discord hết hạn hoặc sai - đăng nhập lại.' }, 401, request);
        return json(rec, 200, request);
      } catch {
        return json({ error: 'Payload không hợp lệ.' }, 400, request);
      }
    }

    // Luồng Authorization Code + PKCE: đổi code → phiên có refresh_token (sống vĩnh viễn)
    if (path === '/session/exchange' && request.method === 'POST') {
      if (rateLimited('s:' + ip, 15, 60000)) return json({ error: 'Bạn thao tác hơi nhanh - chờ vài giây rồi thử lại.' }, 429, request);
      try {
        const body = await readJson(request);
        if (!env.DISCORD_SECRET) return json({ error: 'Server chưa cấu hình DISCORD_SECRET — đăng nhập tạm bằng luồng cũ.' }, 503, request);
        const rec = await exchangeCode(env, body);
        if (!rec) return json({ error: 'Đổi mã đăng nhập thất bại — bấm đăng nhập lại.' }, 401, request);
        return json(rec, 200, request);
      } catch {
        return json({ error: 'Payload không hợp lệ.' }, 400, request);
      }
    }

    if (path === '/session/revoke' && request.method === 'POST') {
      try {
        const body = await readJson(request);
        if (body.session && String(body.session).startsWith('s_')) await env.LOCKS.delete('session:' + body.session);
        return json({ ok: true }, 200, request);
      } catch {
        return json({ error: 'Payload không hợp lệ.' }, 400, request);
      }
    }

    // Panel chẩn đoán: "Còn sống không, sắp hết hạn không?" — KHÔNG trả token.
    if (path === '/session/info' && request.method === 'GET') {
      const rawSid = url.searchParams.get('session') || '';
      const auth0 = String(request.headers.get('authorization') || '');
      const sid = rawSid.startsWith('s_') ? rawSid : (auth0.startsWith('s_') ? auth0 : (auth0.startsWith('Bearer s_') ? auth0.slice(7) : ''));
      if (!sid.startsWith('s_')) return json({ ok: false, code: 'NO_SESSION', error: 'Không có phiên.' }, 400, request);
      try {
        const rec = await sessionRaw(env, sid);
        if (!rec) return json({ ok: false, code: 'NOT_FOUND', error: 'Không tìm thấy phiên — có thể đã bị xoá.' }, 404, request);
        const now = Date.now();
        const life = (rec.at && rec.expires_at) ? (rec.expires_at - rec.at) : 0;
        return json({
          ok: true,
          uid: rec.uid,
          hasRefresh: !!rec.refresh_token,
          needRefresh: sessionNeedsRefresh(rec),
          ageMs: now - (rec.at || now),
          lifeMs: life,
          remainingMs: rec.expires_at ? rec.expires_at - now : null,
          thresholdMs: refreshThreshold(rec),
          legacy: !rec.refresh_token
        }, 200, request);
      } catch (e) {
        if (e && e.kvError) return kvUnavailable(request, e);
        return json({ ok: false, code: 'SESSION_INFO_ERROR', error: 'Không đọc được phiên.' }, 500, request);
      }
    }

    if (path === '/guilds' && request.method === 'GET') {
      if (rateLimited('g:' + ip, 120, 10000)) return json({ error: 'Bạn thao tác hơi nhanh - chờ vài giây rồi thử lại.' }, 429, request);
      const rec = await authRecord(env, request, null);
      if (!rec) return json({ error: 'Cần đăng nhập Discord để lấy danh sách server.' }, 401, request);
      if (await isBanned(env, rec.uid)) return json({ error: 'Tài khoản đã bị khóa.' }, 403, request);
      let token = rec.token;
      let gr = null;
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          gr = await fetch('https://discord.com/api/v10/users/@me/guilds', { headers: { 'Authorization': 'Bearer ' + token } });
        } catch { gr = null; break; }
        if (gr.status !== 401 || attempt > 0 || !rec.sid) break;
        // Token chết trước hạn → gia hạn bằng refresh_token rồi thử lại 1 lần.
        // (KV lỗi → ném kvError → 503 ở tầng bắt lỗi chung, không phải báo "hết phiên")
        const rr = await refreshSessionCoord(env, rec.sid, true);
        if (rr && rr.rec && rr.rec.token && rr.rec.token !== token) { token = rr.rec.token; continue; }
        break;
      }
      if (!gr) return json({ error: 'Không lấy được danh sách server — thử lại sau ít phút.', code: 'DISCORD_UNAVAILABLE' }, 502, request);
      if (gr.status === 401) return json({ error: 'Phiên Discord đã hết hạn — hãy đăng nhập lại.', code: 'SESSION_EXPIRED' }, 401, request);
      if (gr.status === 403) return json({ error: 'Discord từ chối quyền truy cập (thiếu scope "guilds"?) — hãy đăng nhập lại.', code: 'FORBIDDEN' }, 403, request);
      if (!gr.ok) return json({ error: 'Không lấy được danh sách server.' }, gr.status, request);
      const d = await gr.json();
      const list = (Array.isArray(d) ? d : []).map(g => ({ id: g.id, name: g.name, icon: g.icon, permissions: g.permissions }));
      // Ẩn server bot đã bị kick: bot tự đẩy danh sách server nó đang ở lên worker.
      // Chưa có bản ghi (bot chưa kịp đẩy) → giữ nguyên để không ẩn nhầm server.
      const present = await botGuildSet(env);
      return json(present ? list.filter(g => present.has(String(g.id))) : list, 200, request);
    }

    if (path === '/guild/config' && request.method === 'GET') {
      if (rateLimited('g:' + ip, 120, 10000)) return json({ error: 'Bạn thao tác hơi nhanh - chờ vài giây rồi thử lại.' }, 429, request);
      const rec = await authRecord(env, request, null);
      const uid = rec && rec.uid;
      if (!uid) return json({ error: 'Cần đăng nhập Discord.' }, 401, request);
      if (await isBanned(env, uid)) return json({ error: 'Tài khoản đã bị khóa.' }, 403, request);
      const gid = String(url.searchParams.get('guild') || '');
      if (!/^\d{15,20}$/.test(gid)) return json({ error: 'Sai guildId.' }, 400, request);
      // Kiểm tra quyền (gọi Discord) chạy song song với đọc config/meta từ D1
      // để người dùng không phải chờ nối tiếp.
      const [mg, rawCfg, rawMeta] = await Promise.all([
        canManageGuild(env, rec, gid),
        storeGet(env, 'cfg:' + gid),
        storeGet(env, 'gmeta:' + gid)
      ]);
      if (!mg.ok) return accessError(request, mg);
      const editable = mg.can;
      let config = {}, meta = {};
      try { config = JSON.parse(rawCfg || 'null') || {}; } catch {}
      try { meta = JSON.parse(rawMeta || 'null') || {}; } catch {}
      return json({
        guild: gid,
        editable,
        config,
        roles: Array.isArray(meta.roles) ? meta.roles : [],
        emojis: Array.isArray(meta.emojis) ? meta.emojis : [],
        members: Array.isArray(meta.members) ? meta.members : [],
        channels: Array.isArray(meta.channels) ? meta.channels : []
      }, 200, request);
    }

    // Chỉ làm mới meta (kênh/role/emoji/member) — KHÔNG ghi đè cfg, để trang tự cập nhật picker.
    if (path === '/guild/meta' && request.method === 'GET') {
      if (rateLimited('g:' + ip, 120, 10000)) return json({ error: 'Bạn thao tác hơi nhanh - chờ vài giây rồi thử lại.' }, 429, request);
      const rec = await authRecord(env, request, null);
      const uid = rec && rec.uid;
      if (!uid) return json({ error: 'Cần đăng nhập Discord.' }, 401, request);
      if (await isBanned(env, uid)) return json({ error: 'Tài khoản đã bị khóa.' }, 403, request);
      const gid = String(url.searchParams.get('guild') || '');
      if (!/^\d{15,20}$/.test(gid)) return json({ error: 'Sai guildId.' }, 400, request);
      const [mg, rawMeta, rawCfg] = await Promise.all([
        canManageGuild(env, rec, gid),
        storeGet(env, 'gmeta:' + gid),
        storeGet(env, 'cfg:' + gid)
      ]);
      if (!mg.ok) return accessError(request, mg);
      if (!mg.can) return json({ error: 'Bạn không có quyền quản lý server này.', code: 'NO_PERM' }, 403, request);
      let meta = {}, rev = 0;
      try { meta = JSON.parse(rawMeta || 'null') || {}; } catch {}
      try { const c = JSON.parse(rawCfg || 'null'); if (c && Number.isFinite(Number(c.rev))) rev = Number(c.rev); } catch {}
      return json({
        guild: gid,
        rev,
        roles: Array.isArray(meta.roles) ? meta.roles : [],
        emojis: Array.isArray(meta.emojis) ? meta.emojis : [],
        members: Array.isArray(meta.members) ? meta.members : [],
        channels: Array.isArray(meta.channels) ? meta.channels : []
      }, 200, request);
    }

    if (path === '/guild/config' && request.method === 'POST') {
      if (rateLimited('p:' + ip, 30, 10000)) return json({ error: 'Bạn thao tác hơi nhanh - chờ vài giây rồi thử lại.' }, 429, request);
      try {
        const body = await readJsonLimit(request, 65536);
        const rec = await authRecord(env, request, body);
        const uid = rec && rec.uid;
        if (!uid) return json({ error: 'Token Discord hết hạn hoặc sai.' }, 401, request);
        if (await isBanned(env, uid)) return json({ error: 'Tài khoản đã bị khóa.' }, 403, request);
        const gid = String(body.guildId || '');
        if (!/^\d{15,20}$/.test(gid)) return json({ error: 'Sai guildId.' }, 400, request);
        // Sanitise trước (đồng bộ, không I/O) rồi chạy kiểm tra quyền song song
        // với việc đọc rev hiện tại để rút ngắn thời gian bấm Lưu.
        const cfg = sanitizeGuildConfig(body.config);
        const [mg, rawPrev] = await Promise.all([
          canManageGuild(env, rec, gid),
          storeGet(env, 'cfg:' + gid)
        ]);
        if (!mg.ok) return accessError(request, mg);
        if (!mg.can) return json({ error: 'Bạn không có quyền quản lý server này.', code: 'NO_PERM' }, 403, request);
        let prev = {};
        try { prev = JSON.parse(rawPrev || '{}'); } catch {}
        const prevRev = Number(prev.rev || 0);
        const rawRev = body.rev != null ? body.rev : (body.config && body.config.rev);
        const clientRev = Number(rawRev);
        if (Number.isFinite(clientRev) && clientRev !== prevRev) {
          return json({ error: 'Có người vừa sửa cấu hình này. Hãy tải lại trước khi lưu.', code: 'CONFLICT', rev: prevRev }, 409, request);
        }
        const next = { ...cfg, rev: prevRev + 1, at: Date.now() };
        try {
          await storePut(env, 'cfg:' + gid, JSON.stringify(next));
        } catch (e) {
          console.error('[D1] ghi cfg:' + gid + ' lỗi:', e.message);
          return json({ error: 'Không lưu được cấu hình lên máy chủ — thử lại sau.' }, 500, request);
        }
        return json({ ok: true, rev: next.rev }, 200, request);
      } catch (err) {
        if (err && err.kvError) throw err; // lỗi KV → 503, đừng trả 400 làm panel hiểu sai
        return json({ error: err.message === 'LARGE' ? 'Payload quá lớn.' : 'Payload không hợp lệ.' }, 400, request);
      }
    }

    if (path === '/bot/config' && request.method === 'GET') {
      if (!(await botKeyOk(request, env))) return json({ error: 'Sai bot key.' }, 403, request);
      const out = {};
      for (const d of await storeList(env, 'cfg:')) {
        try {
          const cfg = JSON.parse(d.value);
          if (cfg && typeof cfg === 'object') out[d.id.slice(4)] = cfg;
        } catch {}
      }
      return json(out, 200, request);
    }

    if (path === '/bot/meta' && request.method === 'POST') {
      if (!(await botKeyOk(request, env))) return json({ error: 'Sai bot key.' }, 403, request);
      try {
        const body = await readJsonLimit(request, 2097152);
        const gid = String(body.guildId || '');
        if (!/^\d{15,20}$/.test(gid)) return json({ error: 'Sai guildId.' }, 400, request);
        const roles = Array.isArray(body.roles) ? body.roles.slice(0, 500).map(r => ({
          id: idOrNull(r && r.id),
          name: clampStr(r && r.name, 100),
          color: colorInt(r && r.color, 0),
          position: intIn(r && r.position, 0, 100000, 0),
          managed: !!(r && r.managed),
          editable: !!(r && r.editable),
          admin: !!(r && r.admin),
          elevated: !!(r && r.elevated)
        })).filter(x => x.id) : [];
        // KHÔNG giới hạn 200 emoji nữa — bot đẩy bao nhiêu emoji thì giữ bấy nhiêu
        // (payload đã bị readJsonLimit 2MB chặn sẵn, nên không lo bị spam to).
        const emojis = Array.isArray(body.emojis) ? body.emojis.map(e => ({
          id: idOrNull(e && e.id),
          name: clampStr(e && e.name, 32),
          animated: !!(e && e.animated)
        })).filter(x => x.id) : [];
        const members = Array.isArray(body.members) ? body.members.slice(0, 5000).map(m => ({
          id: idOrNull(m && m.id),
          name: clampStr(m && m.name, 100)
        })).filter(x => x.id) : [];
        const channels = Array.isArray(body.channels) ? body.channels.slice(0, 300).map(c => ({
          id: idOrNull(c && c.id),
          name: clampStr(c && c.name, 100),
          type: intIn(c && c.type, 0, 100, 0)
        })).filter(x => x.id) : [];
        try {
          await storePut(env, 'gmeta:' + gid, JSON.stringify({ roles, emojis, members, channels, at: Date.now() }));
        } catch (e) {
          console.error('[D1] ghi gmeta:' + gid + ' lỗi:', e.message);
          return json({ error: 'Không lưu được meta lên máy chủ.' }, 500, request);
        }
        return json({ ok: true }, 200, request);
      } catch (err) {
        if (err && err.kvError) throw err; // lỗi KV → 503, đừng trả 400 làm panel hiểu sai
        return json({ error: err.message === 'LARGE' ? 'Payload quá lớn.' : 'Payload không hợp lệ.' }, 400, request);
      }
    }

    // ── Đồng bộ thư mục data/ (runner GitHub Actions đi qua Worker) ──────────
    // GET  → toàn bộ tệp data/ (pull lúc bot khởi động)
    // POST → ghi các tệp đã thay đổi (flush)
    if (path === '/bot/data' && request.method === 'GET') {
      if (!(await botKeyOk(request, env))) return json({ error: 'Sai bot key.' }, 403, request);
      return json({ files: await dbDataAll(env) }, 200, request);
    }

    if (path === '/bot/data' && request.method === 'POST') {
      if (!(await botKeyOk(request, env))) return json({ error: 'Sai bot key.' }, 403, request);
      try {
        const body = await readJsonLimit(request, 8388608);
        const input = Array.isArray(body && body.files) ? body.files : [];
        const files = [];
        for (const f of input) {
          const name = String((f && f.name) || '');
          if (!name || name.startsWith('.') || /[\/\\]/.test(name)) {
            return json({ error: 'Tên tệp không hợp lệ: ' + name }, 400, request);
          }
          const bytes = Number(f && f.bytes) || 0;
          if (bytes > MAX_DATA_FILE) {
            return json({ error: 'Tệp ' + name + ' quá lớn cho D1 (tối đa ' + MAX_DATA_FILE + ' byte).' }, 413, request);
          }
          files.push({
            name,
            content: String((f && f.content) || ''),
            encoding: (f && f.encoding === 'base64') ? 'base64' : 'utf8',
            bytes
          });
        }
        const n = await dbDataPut(env, files);
        return json({ ok: true, n }, 200, request);
      } catch (err) {
        return json({ error: err.message === 'LARGE' ? 'Payload quá lớn.' : 'Payload không hợp lệ.' }, 400, request);
      }
    }

    // ── Danh sách server bot đang ở (để /guilds ẩn thẻ của server đã bị kick) ──
    if (path === '/bot/guilds' && request.method === 'POST') {
      if (!(await botKeyOk(request, env))) return json({ error: 'Sai bot key.' }, 403, request);
      try {
        const body = await readJsonLimit(request, 65536);
        const ids = (Array.isArray(body && body.guildIds) ? body.guildIds : [])
          .map(x => String(x))
          .filter(x => /^\d{15,20}$/.test(x));
        const at = Date.now();
        await dbSet(env, BOT_GUILDS_KEY, JSON.stringify({ ids, at }));
        return json({ ok: true, n: ids.length, at }, 200, request);
      } catch (err) {
        return json({ error: err.message === 'LARGE' ? 'Payload quá lớn.' : 'Payload không hợp lệ.' }, 400, request);
      }
    }

    if (path === '/guild/asset' && request.method === 'POST') {
      if (rateLimited('p:' + ip, 20, 10000)) return json({ error: 'Bạn thao tác hơi nhanh - chờ vài giây rồi thử lại.' }, 429, request);
      try {
        const body = await readJsonLimit(request, 24000000);
        const rec = await authRecord(env, request, body);
        const uid = rec && rec.uid;
        if (!uid) return json({ error: 'Token Discord hết hạn hoặc sai.' }, 401, request);
        if (await isBanned(env, uid)) return json({ error: 'Tài khoản đã bị khóa.' }, 403, request);
        const gid = String(body.guildId || '');
        if (!/^\d{15,20}$/.test(gid)) return json({ error: 'Sai guildId.' }, 400, request);
        const mg = await canManageGuild(env, rec, gid);
        if (!mg.ok) return accessError(request, mg);
        if (!mg.can) return json({ error: 'Bạn không có quyền quản lý server này.', code: 'NO_PERM' }, 403, request);
        if (body.type !== 'welcome') return json({ error: 'Sai loại tệp.' }, 400, request);
        const m = /^data:([a-zA-Z0-9.+-]+\/[a-zA-Z0-9.+-]+)?;base64,(.+)$/.exec(String(body.data || ''));
        if (!m) return json({ error: 'Dữ liệu ảnh không hợp lệ.' }, 400, request);
        const bin = base64Decode(m[2]);
        if (!bin || bin.byteLength > 24 * 1024 * 1024) return json({ error: 'Ảnh quá lớn (tối đa ~17MB).' }, 400, request);
        const digest = await sha256hex(bin);
        const version = digest.slice(0, 32);
        await env.LOCKS.put('wbg:' + gid, bin, { metadata: { version, mime: m[1] || 'image/png' } });
        return json({ ok: true, version }, 200, request);
      } catch (err) {
        if (err && err.kvError) throw err; // lỗi KV → 503, đừng báo "hết phiên"
        return json({ error: err.message === 'LARGE' ? 'Ảnh quá lớn (tối đa ~17MB).' : 'Payload không hợp lệ.' }, 400, request);
      }
    }

    if (path === '/guild/asset' && request.method === 'GET') {
      if (rateLimited('g:' + ip, 120, 10000)) return json({ error: 'Bạn thao tác hơi nhanh - chờ vài giây rồi thử lại.' }, 429, request);
      const rec = await authRecord(env, request, null);
      const uid = rec && rec.uid;
      if (!uid) return json({ error: 'Cần đăng nhập Discord.' }, 401, request);
      if (await isBanned(env, uid)) return json({ error: 'Tài khoản đã bị khóa.' }, 403, request);
      const gid = String(url.searchParams.get('guild') || '');
      if (!/^\d{15,20}$/.test(gid)) return json({ error: 'Sai guildId.' }, 400, request);
      const mg = await canManageGuild(env, rec, gid);
      if (!mg.ok) return accessError(request, mg);
      if (!mg.can) return json({ error: 'Bạn không có quyền quản lý server này.', code: 'NO_PERM' }, 403, request);
      const got = await env.LOCKS.getWithMetadata('wbg:' + gid, { type: 'arrayBuffer' });
      if (!got || !got.value) return json({ error: 'Chưa có ảnh nền.' }, 404, request);
      const mime = (got.metadata && got.metadata.mime) || 'image/png';
      return new Response(got.value, { headers: { 'content-type': mime } });
    }

    if (path === '/guild/asset' && request.method === 'DELETE') {
      if (rateLimited('d:' + ip, 20, 10000)) return json({ error: 'Bạn thao tác hơi nhanh - chờ vài giây rồi thử lại.' }, 429, request);
      const rec = await authRecord(env, request, null);
      const uid = rec && rec.uid;
      if (!uid) return json({ error: 'Cần đăng nhập Discord.' }, 401, request);
      if (await isBanned(env, uid)) return json({ error: 'Tài khoản đã bị khóa.' }, 403, request);
      const gid = String(url.searchParams.get('guild') || '');
      if (!/^\d{15,20}$/.test(gid)) return json({ error: 'Sai guildId.' }, 400, request);
      const mg = await canManageGuild(env, rec, gid);
      if (!mg.ok) return accessError(request, mg);
      if (!mg.can) return json({ error: 'Bạn không có quyền quản lý server này.', code: 'NO_PERM' }, 403, request);
      await env.LOCKS.delete('wbg:' + gid);
      return json({ ok: true }, 200, request);
    }

    if (path === '/bot/asset' && request.method === 'GET') {
      if (!(await botKeyOk(request, env))) return json({ error: 'Sai bot key.' }, 403, request);
      const gid = String(url.searchParams.get('gid') || '');
      if (!/^\d{15,20}$/.test(gid)) return json({ error: 'Sai guildId.' }, 400, request);
      const got = await env.LOCKS.getWithMetadata('wbg:' + gid, { type: 'arrayBuffer' });
      if (!got || !got.value) return json({ error: 'Chưa có ảnh nền.' }, 404, request);
      const mime = (got.metadata && got.metadata.mime) || 'image/png';
      return new Response(got.value, { headers: { 'content-type': mime } });
    }

    return json({ error: 'Not found' }, 404, request);
    } catch (e) {
      if (e && e.kvError) return kvUnavailable(request, e);
      console.error('[worker] lỗi không lường trước:', (e && e.stack) || e);
      return json({ error: 'Lỗi máy chủ — thử lại sau ít phút.', code: 'SERVER_ERROR' }, 500, request);
    }
  }
};
