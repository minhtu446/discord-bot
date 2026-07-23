const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const dataDir = path.join(__dirname, 'data');

const cache = {};
const watchers = {};
const indices = {};
const writePending = {};
const writingOwn = new Set();

if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

function watchFile(p) {
  if (watchers[p]) return;
  try {
    watchers[p] = fs.watch(p, () => {
      if (writingOwn.has(p)) return;
      try { cache[p] = JSON.parse(fs.readFileSync(p, 'utf8')); } catch { cache[p] = null; }
    });
  } catch {}
}

function readJSON(p) {
  if (cache[p] !== undefined) return cache[p];
  try {
    const raw = fs.readFileSync(p, 'utf8');
    cache[p] = JSON.parse(raw);
    watchFile(p);
  } catch { cache[p] = null; }
  return cache[p];
}

function readJSONArray(p) {
  const val = readJSON(p);
  if (!Array.isArray(val)) cache[p] = [];
  return cache[p];
}

function readJSONObject(p) {
  const val = readJSON(p);
  if (typeof val !== 'object' || val === null || Array.isArray(val)) cache[p] = {};
  return cache[p];
}

function getPath(filename) {
  return path.join(dataDir, filename);
}

async function flushWrite(p, entry) {
  try {
    const current = writePending[p]?.data;
    if (current === undefined) return;
    writingOwn.add(p);
    await fsp.writeFile(p, JSON.stringify(current, null, 2));
    if (writePending[p]) writePending[p].lastWritten = current;
  } catch (err) {
    console.error(`[jsonCache] write error: ${p}`, err.message);
  } finally {
    writingOwn.delete(p);
  }
}

function scheduleWrite(p) {
  const entry = writePending[p];
  if (!entry) return;
  if (entry.writing) {
    if (entry.timer) clearTimeout(entry.timer);
    entry.timer = setTimeout(() => scheduleWrite(p), 100);
    return;
  }
  entry.writing = true;
  entry.timer = null;
  setImmediate(async () => {
    try { await flushWrite(p, entry); }
    finally {
      if (writePending[p]) {
        writePending[p].writing = false;
        if (writePending[p].data !== writePending[p].lastWritten) {
          scheduleWrite(p);
        } else {
          clearTimeout(writePending[p].timer);
          delete writePending[p];
        }
      }
    }
  });
}

function writeJSON(p, data) {
  cache[p] = data;
  if (writePending[p]) {
    writePending[p].data = data;
    return;
  }
  writePending[p] = { data, lastWritten: undefined, writing: false, timer: null };
  scheduleWrite(p);
}

function buildIndex(p, keyFn) {
  const arr = readJSONArray(p);
  const map = new Map();
  for (let i = 0; i < arr.length; i++) {
    const key = keyFn(arr[i], i);
    if (key == null) continue;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(arr[i]);
  }
  indices[p] = { map, keyFn };
  return map;
}

function getIndexed(p, key) {
  const idx = indices[p];
  if (!idx) return [];
  return idx.map.get(key) || [];
}

const filenames = [
  'bannedGameUsers.json',
  'autoDeleteUsers.json', 'userChannels.json', 'setupChannels.json',
  'activeGames.json',
  'guildConfigs.json', 'extraOwners.json', 'noemojiRoles.json',
  'guildSettings.json', 'botStatus.json'
];

filenames.forEach(f => readJSON(getPath(f)));

process.on('exit', () => {
  for (const p of Object.keys(writePending)) {
    try { fs.writeFileSync(p, JSON.stringify(writePending[p].data, null, 2)); } catch {}
  }
});

function flushSync(p) {
  const entry = writePending[p];
  if (entry) {
    try {
      fs.writeFileSync(p, JSON.stringify(entry.data, null, 2));
      entry.lastWritten = entry.data;
      delete writePending[p];
    } catch (err) {
      console.error(`[jsonCache] flushSync error: ${p}`, err.message);
    }
  } else if (cache[p] !== undefined) {
    try {
      fs.writeFileSync(p, JSON.stringify(cache[p], null, 2));
    } catch (err) {
      console.error(`[jsonCache] flushSync error: ${p}`, err.message);
    }
  }
}

module.exports = { readJSON, readJSONArray, readJSONObject, writeJSON, getPath, buildIndex, getIndexed, flushSync };
