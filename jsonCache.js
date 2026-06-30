const fs = require('fs');
const path = require('path');
const dataDir = path.join(__dirname, 'data');

const cache = {};
const watchers = {};
const indices = {};
let writePending = {};

if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

function watchFile(p) {
  if (watchers[p]) return;
  try {
    watchers[p] = fs.watch(p, () => {
      try {
        cache[p] = JSON.parse(fs.readFileSync(p, 'utf8'));
      } catch {
        cache[p] = null;
      }
    });
  } catch {}
}

function readJSON(p) {
  if (cache[p] !== undefined) return cache[p];
  try {
    const raw = fs.readFileSync(p, 'utf8');
    cache[p] = JSON.parse(raw);
    watchFile(p);
  } catch {
    cache[p] = null;
  }
  return cache[p];
}

function readJSONArray(p) {
  const val = readJSON(p);
  if (!Array.isArray(val)) { cache[p] = []; }
  return cache[p];
}

function readJSONObject(p) {
  const val = readJSON(p);
  if (typeof val !== 'object' || val === null || Array.isArray(val)) { cache[p] = {}; }
  return cache[p];
}

function getPath(filename) {
  return path.join(dataDir, filename);
}

function writeJSON(p, data) {
  cache[p] = data;
  if (writePending[p]) {
    writePending[p].data = data;
    return;
  }
  writePending[p] = { data };
  try {
    fs.writeFileSync(p, JSON.stringify(data, null, 2));
  } catch (err) {
    console.error(`[jsonCache] write error: ${p}`, err.message);
  }
  writePending[p].timer = setTimeout(() => {
    if (writePending[p] && writePending[p].data !== writePending[p].lastWritten) {
      try { fs.writeFileSync(p, JSON.stringify(writePending[p].data, null, 2)); } catch {}
    }
    delete writePending[p];
  }, 100);
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
  const items = idx.map.get(key);
  return items || [];
}

const filenames = [
  'bannedWords.json', 'bannedImages.json', 'bannedGameUsers.json',
  'autoDeleteUsers.json', 'userChannels.json', 'setupChannels.json',
  'activeGames.json', 'voiceSessions.json',
  'guildConfigs.json', 'extraOwners.json', 'noemojiRoles.json',
  'guildSettings.json', 'botStatus.json'
];

filenames.forEach(f => readJSON(getPath(f)));

process.on('exit', () => {
  for (const p of Object.keys(writePending)) {
    try { fs.writeFileSync(p, JSON.stringify(writePending[p].data, null, 2)); } catch {}
  }
});

module.exports = { readJSON, readJSONArray, readJSONObject, writeJSON, getPath, buildIndex, getIndexed };
