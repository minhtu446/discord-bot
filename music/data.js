const { getPath, readJSONObject, writeJSON } = require('../jsonCache');

const QUEUE_PATH = getPath('music/queues.json');
const SETTINGS_PATH = getPath('music/settings.json');
const PLAYLIST_PATH = getPath('music/playlists.json');
const META_CACHE_PATH = getPath('music/metaCache.json');

const metaCache = new Map();

function loadMetaCache() {
  try { const d = readJSONObject(META_CACHE_PATH); for (const [k, v] of Object.entries(d)) metaCache.set(k, v); } catch {}
}
loadMetaCache();

function getCachedMeta(url) { return metaCache.get(url) || null; }
function setCachedMeta(url, info) {
  metaCache.set(url, info);
  const obj = Object.fromEntries(metaCache);
  writeJSON(META_CACHE_PATH, obj);
}

function saveQueue(guildId, urls) {
  const all = readJSONObject(QUEUE_PATH);
  all[guildId] = urls;
  writeJSON(QUEUE_PATH, all);
}

function loadQueue(guildId) {
  const all = readJSONObject(QUEUE_PATH);
  return all[guildId] || [];
}

function clearQueue(guildId) {
  const all = readJSONObject(QUEUE_PATH);
  delete all[guildId];
  writeJSON(QUEUE_PATH, all);
}

function saveSettings(guildId, settings) {
  const all = readJSONObject(SETTINGS_PATH);
  all[guildId] = settings;
  writeJSON(SETTINGS_PATH, all);
}

function loadSettings(guildId) {
  const all = readJSONObject(SETTINGS_PATH);
  return all[guildId] || { vol: 1, loop: false };
}

function savePlaylist(guildId, name, urls) {
  const all = readJSONObject(PLAYLIST_PATH);
  if (!all[guildId]) all[guildId] = {};
  all[guildId][name] = urls;
  writeJSON(PLAYLIST_PATH, all);
}

function loadPlaylist(guildId, name) {
  const all = readJSONObject(PLAYLIST_PATH);
  return all[guildId]?.[name] || [];
}

function listPlaylists(guildId) {
  const all = readJSONObject(PLAYLIST_PATH);
  return Object.keys(all[guildId] || {});
}

function deletePlaylist(guildId, name) {
  const all = readJSONObject(PLAYLIST_PATH);
  if (all[guildId]) { delete all[guildId][name]; writeJSON(PLAYLIST_PATH, all); }
}

module.exports = {
  getCachedMeta, setCachedMeta,
  saveQueue, loadQueue, clearQueue,
  saveSettings, loadSettings,
  savePlaylist, loadPlaylist, listPlaylists, deletePlaylist,
};
