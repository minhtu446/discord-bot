/**
 * firebase-sync.js — đồng bộ thư mục data/ với Cloud Firestore.
 *
 * Thay thế data-sync.js (git) nhưng GIỮ NGUYÊN giao diện dòng lệnh:
 *   pull          tải toàn bộ data/ từ Firestore (lần đầu sẽ tự seed từ repo git cũ)
 *   push          đẩy toàn bộ data/ hiện có lên Firestore
 *   flush         chỉ đẩy các tệp đã thay đổi
 *   watch         pull rồi theo dõi và đẩy thay đổi
 *   watch-nopull  chỉ theo dõi và đẩy thay đổi (bot đang chạy)
 *
 * Cấu trúc Firestore: collection "data", mỗi tệp là 1 document,
 * id = tên tệp, field content (chuỗi) + encoding ('utf8' | 'base64').
 *
 * Xác thực: FIREBASE_SERVICE_ACCOUNT (JSON thô hoặc base64) / FIREBASE_SA / firebase-sa.json
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

(function loadEnv() {
  try {
    const envPath = path.join(__dirname, '.env');
    if (fs.existsSync(envPath)) {
      const content = fs.readFileSync(envPath, 'utf8');
      for (const line of content.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eqIdx = trimmed.indexOf('=');
        if (eqIdx === -1) continue;
        const key = trimmed.substring(0, eqIdx).trim();
        const value = trimmed.substring(eqIdx + 1).trim();
        if (!process.env[key]) process.env[key] = value;
      }
    }
  } catch {}
})();

const DATA_DIR = path.join(__dirname, 'data');
const STATE_PATH = path.join(__dirname, '.firebase-sync-state.json');
const COLLECTION = process.env.FIRESTORE_DATA_COLLECTION || 'data';
const POLL_MS = 5000;
const BATCH_LIMIT = 450; // Firestore cho tối đa 500 thao tác / batch

/* ── Xác thực ─────────────────────────────────────────────────────────── */
function loadServiceAccount() {
  const raw = String(process.env.FIREBASE_SERVICE_ACCOUNT || process.env.FIREBASE_SA || '').trim();
  if (raw) {
    const cleaned = raw.replace(/^["']|["']$/g, '');
    const candidates = [];
    try { candidates.push(Buffer.from(cleaned, 'base64').toString('utf8')); } catch {}
    candidates.push(cleaned);
    for (const c of candidates) {
      try {
        const j = JSON.parse(c);
        if (j && j.project_id && j.private_key && j.client_email) return j;
      } catch {}
    }
    try { if (fs.existsSync(cleaned)) return JSON.parse(fs.readFileSync(cleaned, 'utf8')); } catch {}
  }
  const file = path.join(__dirname, 'firebase-sa.json');
  try { if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8')); } catch {}
  return null;
}

function safeRequire(id, errors) {
  try { return require(id); } catch (e) {
    if (errors) errors.push(`${id}: ${(e && e.message) || e}`);
    return null;
  }
}

/* firebase-admin v14 đã bỏ namespace cũ (admin.apps / admin.credential / admin.firestore) và ở v13
   namespace đó có thể lỗi khi gọi tách rời khỏi object -> luôn ưu tiên API modular:
   firebase-admin/app + firebase-admin/firestore (chỉ fallback về namespace cũ cho bản rất cũ). */
function loadAdmin() {
  const errors = [];
  const top = safeRequire('firebase-admin', errors);
  const appMod = safeRequire('firebase-admin/app', errors);
  const firestoreMod = safeRequire('firebase-admin/firestore', errors);

  const pick = (name) => {
    if (appMod && typeof appMod[name] === 'function') return appMod[name].bind(appMod);
    if (top && typeof top[name] === 'function') return top[name].bind(top);
    return undefined;
  };

  return {
    getApps: pick('getApps'),
    cert: pick('cert'),
    initializeApp: pick('initializeApp'),
    getFirestore: firestoreMod && typeof firestoreMod.getFirestore === 'function'
      ? firestoreMod.getFirestore.bind(firestoreMod)
      : null,
    legacyFirestore: top && typeof top.firestore === 'function' ? top.firestore.bind(top) : null,
    legacyApps: (top && top.apps) || null,
    errors,
  };
}

let _db = null;
function initDb() {
  if (_db) return _db;
  const sa = loadServiceAccount();
  if (!sa) {
    console.error('[FirebaseSync] Thiếu FIREBASE_SERVICE_ACCOUNT hoặc firebase-sa.json');
    process.exit(1);
  }
  const admin = loadAdmin();
  if (!admin.initializeApp || !admin.cert) {
    console.error('[FirebaseSync][FATAL] Không nạp được firebase-admin. Chi tiết: ' + admin.errors.join(' | '));
    process.exit(1);
  }
  const apps = typeof admin.getApps === 'function' ? admin.getApps() : (admin.legacyApps || []);
  if (!apps || !apps.length) {
    admin.initializeApp({ credential: admin.cert(sa), projectId: sa.project_id });
  }
  if (typeof admin.getFirestore === 'function') {
    _db = admin.getFirestore();
  } else if (typeof admin.legacyFirestore === 'function') {
    _db = admin.legacyFirestore();
  } else {
    console.error('[FirebaseSync][FATAL] Không nạp được firebase-admin/firestore. Chi tiết: ' + admin.errors.join(' | '));
    console.error('[FirebaseSync][FATAL] Gợi ý: firebase-admin cần Node >= 18 và gói @google-cloud/firestore (optionalDependency) phải cài được.');
    process.exit(1);
  }
  try { _db.settings({ ignoreUndefinedProperties: true }); } catch {}
  console.log(`[FirebaseSync] Firestore project=${sa.project_id} collection=${COLLECTION}`);
  return _db;
}

/* ── Tiện ích tệp ─────────────────────────────────────────────────────── */
function listLocalFiles() {
  const out = [];
  let entries = [];
  try { entries = fs.readdirSync(DATA_DIR); } catch { return out; }
  for (const name of entries) {
    if (name.startsWith('.')) continue;   // bỏ .git, .DS_Store...
    if (name.endsWith('.tmp')) continue;  // bỏ tệp ghi dở của jsonCache
    const p = path.join(DATA_DIR, name);
    let st; try { st = fs.statSync(p); } catch { continue; }
    if (!st.isFile()) continue;
    out.push(name);
  }
  return out;
}

function encodeFile(buf) {
  const text = buf.toString('utf8');
  const roundTrip = Buffer.from(text, 'utf8').equals(buf);
  if (roundTrip) return { content: text, encoding: 'utf8' };
  return { content: buf.toString('base64'), encoding: 'base64' };
}

const sha1 = (buf) => crypto.createHash('sha1').update(buf).digest('hex');

function loadState() {
  try { return JSON.parse(fs.readFileSync(STATE_PATH, 'utf8')) || {}; } catch { return {}; }
}
function saveState(state) {
  try { fs.writeFileSync(STATE_PATH, JSON.stringify(state)); } catch {}
}

/* ── Đẩy lên Firestore ────────────────────────────────────────────────── */
async function pushAll(forceAll) {
  const db = initDb();
  const state = loadState();
  const names = listLocalFiles();
  const ops = [];
  for (const name of names) {
    let buf; try { buf = fs.readFileSync(path.join(DATA_DIR, name)); } catch { continue; }
    const hash = sha1(buf);
    if (!forceAll && state[name] === hash) continue;
    const { content, encoding } = encodeFile(buf);
    ops.push({
      name, hash,
      ref: db.collection(COLLECTION).doc(name),
      data: { content, encoding, bytes: buf.length, updatedAt: Date.now() },
    });
  }
  for (let i = 0; i < ops.length; i += BATCH_LIMIT) {
    const batch = db.batch();
    for (const op of ops.slice(i, i + BATCH_LIMIT)) batch.set(op.ref, op.data, { merge: false });
    await batch.commit();
  }
  for (const op of ops) state[op.name] = op.hash;
  saveState(state);
  return ops.length;
}

/* ── Tải về từ Firestore ──────────────────────────────────────────────── */
async function pull() {
  const db = initDb();
  const snap = await db.collection(COLLECTION).get();
  if (snap.empty) {
    console.log('[FirebaseSync] Firestore đang trống — thử seed từ repo git cũ...');
    const seeded = await seedFromGit();
    if (!seeded) {
      console.error('[FirebaseSync][FATAL] Firestore trống và seed từ git thất bại (thiếu BOT_PAT?).');
      console.error('[FirebaseSync][FATAL] Dừng để tránh bot khởi tạo dữ liệu rỗng rồi ghi đè lên Firestore.');
      process.exit(1);
    }
    return;
  }
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const state = loadState();
  let count = 0;
  for (const doc of snap.docs) {
    const d = doc.data() || {};
    const buf = d.encoding === 'base64'
      ? Buffer.from(String(d.content || ''), 'base64')
      : Buffer.from(String(d.content || ''), 'utf8');
    const target = path.join(DATA_DIR, doc.id);
    const tmp = `${target}.tmp`;
    try {
      fs.writeFileSync(tmp, buf);
      fs.renameSync(tmp, target);
      state[doc.id] = sha1(buf);
      count++;
    } catch (e) {
      console.error(`[FirebaseSync] Ghi ${doc.id} lỗi:`, String(e.message).split('\n')[0]);
    }
  }
  saveState(state);
  console.log(`[FirebaseSync] Đã tải ${count}/${snap.size} tệp từ Firestore.`);
}

async function seedFromGit() {
  if (!process.env.BOT_PAT) return false;
  const gitSync = path.join(__dirname, 'data-sync.js');
  if (!fs.existsSync(gitSync)) return false;
  try {
    console.log('[FirebaseSync][SEED] Lấy dữ liệu cũ từ repo git...');
    execFileSync(process.execPath, [gitSync, 'pull'], { cwd: __dirname, stdio: 'inherit' });
  } catch (e) {
    console.error('[FirebaseSync][SEED] git pull lỗi:', String(e.message).split('\n')[0]);
    return false;
  }
  const n = await pushAll(true);
  console.log(`[FirebaseSync][SEED] Đã đẩy ${n} tệp lên Firestore.`);
  return n > 0;
}

function watch() {
  console.log(`[FirebaseSync] Theo dõi data/ mỗi ${POLL_MS / 1000}s...`);
  setInterval(async () => {
    try {
      const n = await pushAll(false);
      if (n) console.log(`[FirebaseSync] Đã đẩy ${n} tệp thay đổi.`);
    } catch (e) {
      console.error('[FirebaseSync][ERROR]', String(e && e.message || e).split('\n')[0]);
    }
  }, POLL_MS);
}

/* ── Điểm vào ─────────────────────────────────────────────────────────── */
['SIGINT', 'SIGTERM'].forEach((sig) => {
  process.on(sig, async () => {
    try { await pushAll(false); } catch {}
    process.exit(0);
  });
});

const cmd = process.argv[2] || 'watch';
(async () => {
  if (cmd === 'pull') {
    await pull();
  } else if (cmd === 'push') {
    const n = await pushAll(true);
    console.log(`[FirebaseSync] Đã đẩy ${n} tệp lên Firestore.`);
  } else if (cmd === 'flush') {
    const n = await pushAll(false);
    console.log(`[FirebaseSync] Flush xong: ${n} tệp thay đổi.`);
  } else if (cmd === 'watch-nopull') {
    watch();
  } else if (cmd === 'watch') {
    await pull();
    watch();
  } else {
    console.error(`[FirebaseSync] Lệnh không hợp lệ: ${cmd}`);
    process.exit(1);
  }
})().catch((e) => {
  console.error('[FirebaseSync][FATAL]', String(e && e.message || e));
  process.exit(1);
});
