const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

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
        process.env[key] = value;
      }
    }
  } catch {}
})();

const DATA_REPO = (process.env.DATA_REPO || 'minhtu446/discord-bot-data').replace(/\.git$/, '');
const TOKEN = process.env.BOT_PAT || '';
const WS = process.env.GITHUB_WORKSPACE || __dirname;
const DATA_DIR = path.join(WS, 'data');
const CLEAN_URL = `https://github.com/${DATA_REPO}.git`;
const AUTH_URL = TOKEN
  ? `https://x-access-token:${TOKEN}@github.com/${DATA_REPO}.git`
  : CLEAN_URL;
const COMMITTER = ['-c', 'user.name="Bot Sync"', '-c', 'user.email="bot@sync"'].join(' ');
const POLL_MS = 5000;

function run(args) {
  const cmd = `git ${args} 2>&1`;
  return execSync(cmd, { cwd: WS, stdio: 'pipe', encoding: 'utf8' });
}
function runInData(args) {
  const cmd = `git -C "${DATA_DIR}" ${args} 2>&1`;
  return execSync(cmd, { cwd: WS, stdio: 'pipe', encoding: 'utf8' });
}

function ensureToken() {
  if (!TOKEN) {
    console.error('[DataSync] Missing BOT_PAT — cannot sync private data repo');
    process.exit(1);
  }
}

function pull() {
  ensureToken();
  if (!fs.existsSync(path.join(DATA_DIR, '.git'))) {
    console.log('[DataSync] Cloning private data repo...');
    if (fs.existsSync(DATA_DIR)) {
      fs.rmSync(DATA_DIR, { recursive: true, force: true });
    }
    run(`clone --depth 1 ${AUTH_URL} "${DATA_DIR}"`);
    runInData(`remote set-url origin ${CLEAN_URL}`);
    console.log('[DataSync] Cloned private data repo.');
  } else {
    console.log('[DataSync] Pulling private data repo...');
    runInData(`fetch ${AUTH_URL} main`);
    runInData('reset --hard FETCH_HEAD');
    console.log('[DataSync] Pulled private data repo.');
  }
}

function commitAndPush() {
  try {
    runInData('add -A');
    const status = runInData('status --porcelain').trim();
    if (!status) {
      console.log('[DataSync] No data changes, skip push.');
      return;
    }
    const now = new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });
    runInData(`${COMMITTER} commit -m "auto: ${now}"`);
    try {
      runInData(`fetch ${AUTH_URL} main`);
      runInData('merge --no-edit -X ours FETCH_HEAD');
    } catch (e) {
      console.error('[DataSync][SYNC]', e.message.split('\n')[0]);
      try { runInData('merge --abort'); } catch {}
    }
    runInData(`${TOKEN ? '-c credential.helper= push ' + AUTH_URL + ' HEAD:main' : 'push origin main'}`);
    console.log(`[DataSync] Pushed at ${now}`);
  } catch (e) {
    console.error('[DataSync][ERROR]', e.message.split('\n')[0]);
  }
}

function flush() {
  try {
    commitAndPush();
  } catch {}
}

function watch() {
  console.log(`[DataSync] Polling data/ for changes every ${POLL_MS / 1000}s...`);
  setInterval(() => {
    try {
      if (runInData('status --porcelain').trim()) commitAndPush();
    } catch (e) {
      console.error('[DataSync][ERROR]', e.message.split('\n')[0]);
    }
  }, POLL_MS);
}

const cmd = process.argv[2] || 'watch';
if (cmd === 'pull') {
  pull();
} else if (cmd === 'flush') {
  flush();
} else if (cmd === 'watch-nopull') {
  watch();
} else {
  pull();
  watch();
}

process.on('exit', flush);
process.on('SIGINT', () => { flush(); process.exit(0); });
process.on('SIGTERM', () => { flush(); process.exit(0); });