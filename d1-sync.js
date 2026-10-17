/**
 * d1-sync.js — đồng bộ thư mục data/ với Cloudflare D1 (qua Worker).
 *
 * Giữ nguyên giao diện dòng lệnh của firebase-sync.js để workflow không đổi:
 *   pull          tải toàn bộ data/ từ D1 (lần đầu sẽ tự seed từ repo git cũ)
 *   push          đẩy toàn bộ data/ hiện có lên D1
 *   flush         chỉ đẩy các tệp đã thay đổi
 *   watch         pull rồi theo dõi và đẩy thay đổi
 *   watch-nopull  chỉ theo dõi và đẩy thay đổi (bot đang chạy)
 *
 * D1 chỉ Worker mới truy cập được, nên runner GitHub Actions đi qua HTTP:
 *   GET  /bot/data  → { files: [{ name, content, encoding, bytes, updatedAt }] }
 *   POST /bot/data  → { files: [{ name, content, encoding, bytes }] }
 * Xác thực bằng header x-bot-key (BOT_KEY trong .env / GitHub secret).
 *
 * Cách mã hoá từng tệp giữ nguyên: 'utf8' nếu đọc-trả-về-trùng khớp, ngược lại 'base64'.
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
const STATE_PATH = path.join(__dirname, '.d1-sync-state.json');
const WORKER = String(process.env.WORKER_URL || 'https://clowo-locks.clowo.workers.dev').replace(/\/+$/, '');
const POLL_MS = 5000;

let _botKey = '';
function assertEnv() {
  _botKey = String(process.env.BOT_KEY || '').trim();
  if (!_botKey) {
    console.error('[DataSync][FATAL] Thiếu BOT_KEY — cần chìa khoá để gọi Worker.');
    process.exit(1);
  }
}

async function workerFetch(p, opts = {}) {
  return fetch(WORKER + p, {
    ...opts,
    headers: { 'content-type': 'application/json', 'x-bot-key': _botKey, ...(opts.headers || {}) }
  });
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
  try {
    // Ghi qua tệp tạm rồi đổi tên để tiến trình khác không phải đọc JSON dở dang
    // (configHelper.js có thể spawn `d1-sync.js flush` song song với watch).
    const tmp = `${STATE_PATH}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(state));
    fs.renameSync(tmp, STATE_PATH);
  } catch {}
}

/* ── Đẩy lên D1 ───────────────────────────────────────────────────────── */
async function pushAll(forceAll) {
  const state = loadState();
  const names = listLocalFiles();
  const files = [];
  const hashes = [];
  for (const name of names) {
    let buf; try { buf = fs.readFileSync(path.join(DATA_DIR, name)); } catch { continue; }
    const hash = sha1(buf);
    if (!forceAll && state[name] === hash) continue;
    const { content, encoding } = encodeFile(buf);
    files.push({ name, content, encoding, bytes: buf.length });
    hashes.push(hash);
  }
  if (files.length) {
    const res = await workerFetch('/bot/data', { method: 'POST', body: JSON.stringify({ files }) });
    if (!res.ok) throw new Error('Đẩy ' + files.length + ' tệp lên D1 thất bại (HTTP ' + res.status + ')');
  }
  for (let i = 0; i < files.length; i++) state[files[i].name] = hashes[i];
  saveState(state);
  return files.length;
}

/* ── Tải về từ D1 ─────────────────────────────────────────────────────── */
async function pull() {
  const res = await workerFetch('/bot/data');
  if (!res.ok) throw new Error('Tải data/ từ D1 thất bại (HTTP ' + res.status + ')');
  const d = await res.json();
  const files = (d && Array.isArray(d.files)) ? d.files : [];
  if (!files.length) {
    console.log('[DataSync] D1 đang trống — thử seed từ repo git cũ...');
    const seeded = await seedFromGit();
    if (!seeded) {
      console.error('[DataSync][FATAL] D1 trống và seed từ git thất bại (thiếu BOT_PAT?).');
      console.error('[DataSync][FATAL] Dừng để tránh bot khởi tạo dữ liệu rỗng rồi ghi đè lên D1.');
      process.exit(1);
    }
    return;
  }
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const state = loadState();
  let count = 0;
  for (const f of files) {
    const name = String((f && f.name) || '');
    if (!name || name.startsWith('.') || /[\/\\]/.test(name)) continue;
    const buf = (f && f.encoding === 'base64')
      ? Buffer.from(String(f.content || ''), 'base64')
      : Buffer.from(String(f.content || ''), 'utf8');
    const target = path.join(DATA_DIR, name);
    const tmp = `${target}.tmp`;
    try {
      fs.writeFileSync(tmp, buf);
      fs.renameSync(tmp, target);
      state[name] = sha1(buf);
      count++;
    } catch (e) {
      console.error(`[DataSync] Ghi ${name} lỗi:`, String(e.message).split('\n')[0]);
    }
  }
  saveState(state);
  console.log(`[DataSync] Đã tải ${count}/${files.length} tệp từ D1.`);
}

async function seedFromGit() {
  if (!process.env.BOT_PAT) return false;
  const gitSync = path.join(__dirname, 'data-sync.js');
  if (!fs.existsSync(gitSync)) return false;
  try {
    console.log('[DataSync][SEED] Lấy dữ liệu cũ từ repo git...');
    execFileSync(process.execPath, [gitSync, 'pull'], { cwd: __dirname, stdio: 'inherit' });
  } catch (e) {
    console.error('[DataSync][SEED] git pull lỗi:', String(e.message).split('\n')[0]);
    return false;
  }
  const n = await pushAll(true);
  console.log(`[DataSync][SEED] Đã đẩy ${n} tệp lên D1.`);
  return n > 0;
}

function watch() {
  console.log(`[DataSync] Theo dõi data/ mỗi ${POLL_MS / 1000}s...`);
  setInterval(async () => {
    try {
      const n = await pushAll(false);
      if (n) console.log(`[DataSync] Đã đẩy ${n} tệp thay đổi.`);
    } catch (e) {
      console.error('[DataSync][ERROR]', String(e && e.message || e).split('\n')[0]);
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
assertEnv();
(async () => {
  if (cmd === 'pull') {
    await pull();
  } else if (cmd === 'push') {
    const n = await pushAll(true);
    console.log(`[DataSync] Đã đẩy ${n} tệp lên D1.`);
  } else if (cmd === 'flush') {
    const n = await pushAll(false);
    console.log(`[DataSync] Flush xong: ${n} tệp thay đổi.`);
  } else if (cmd === 'watch-nopull') {
    watch();
  } else if (cmd === 'watch') {
    await pull();
    watch();
  } else {
    console.error(`[DataSync] Lệnh không hợp lệ: ${cmd}`);
    process.exit(1);
  }
})().catch((e) => {
  console.error('[DataSync][FATAL]', String(e && e.message || e));
  process.exit(1);
});
