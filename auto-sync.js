const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const WATCH_DIR = __dirname;
const DEBOUNCE_MS = 5000;
const IGNORE_DIRS = ['node_modules', '.git', 'data'];
const IGNORE_EXTS = ['.log', '.db', '.db-shm', '.db-wal'];

let pending = false;
let timer = null;

function shouldIgnore(filePath) {
  const rel = path.relative(WATCH_DIR, filePath);
  if (IGNORE_DIRS.some(d => rel.startsWith(d + path.sep) || rel === d)) return true;
  if (IGNORE_EXTS.some(ext => rel.endsWith(ext))) return true;
  return false;
}

function gitCommitAndPush() {
  try {
    execSync('git add -A', { cwd: WATCH_DIR, stdio: 'pipe' });
    const status = execSync('git status --porcelain', { cwd: WATCH_DIR, encoding: 'utf8' }).trim();
    if (!status) {
      console.log('[AutoSync] Khong co thay doi, bo qua.');
      return;
    }
    const now = new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });
    const msg = `auto: ${now}`;
    execSync(`git commit -m "${msg}"`, { cwd: WATCH_DIR, stdio: 'pipe' });
    console.log(`[AutoSync] Committed: ${msg}`);
    execSync('git push origin main', { cwd: WATCH_DIR, stdio: 'pipe', timeout: 30000 });
    console.log('[AutoSync] Pushed to GitHub.');
  } catch (e) {
    console.error('[AutoSync] Loi:', e.message);
  }
}

function onChanges() {
  if (pending) return;
  pending = true;
  console.log(`[AutoSync] Phat hien thay doi, doi ${DEBOUNCE_MS / 1000}s...`);
  clearTimeout(timer);
  timer = setTimeout(() => {
    pending = false;
    gitCommitAndPush();
  }, DEBOUNCE_MS);
}

console.log('[AutoSync] Dang theo doi file thay doi...');
fs.watch(WATCH_DIR, { recursive: true }, (eventType, filename) => {
  if (!filename) return;
  const fullPath = path.join(WATCH_DIR, filename);
  if (shouldIgnore(fullPath)) return;
  onChanges();
});

console.log('[AutoSync] San sang. Bat dau theo doi.');
