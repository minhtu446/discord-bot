const jsonCache = require('./jsonCache');

const WORKER = 'https://clowo-locks.clowo.workers.dev';
const cachePath = jsonCache.getPath('webConfig.json');
const POLL_INTERVAL = 30000;
const META_PUSH_INTERVAL = 5 * 60 * 1000;
const MEMBER_CAP = 2000;

let configs = {};
const lastRev = {};

function botKey() {
  return process.env.BOT_KEY || '';
}

function defaults() {
  return {
    welcome: { enabled: true, channelId: '', content: '', backgroundUrl: '', backgroundSize: 'cover', avatarSize: 130, avatarShape: 'circle', roles: [] },
    ticket: { enabled: true, categoryId: '', panel: { content: '', color: 0x5865F2 }, ticket: { content: '', color: 0x5865F2 }, allow: [] },
    voice: { enabled: true, hubChannelId: '', categoryId: '' },
    emojiRole: { enabled: true, roles: [] },
    pickrole: { enabled: true, mode: 'multi', content: '', items: [] },
  };
}

function merge(base, over) {
  const out = { ...base };
  for (const k of Object.keys(over || {})) {
    const ov = over[k];
    if (ov && typeof ov === 'object' && !Array.isArray(ov)) out[k] = { ...(base[k] || {}), ...ov };
    else out[k] = ov;
  }
  return out;
}

function loadCache() {
  try {
    const c = jsonCache.readJSONObject(cachePath);
    if (c.configs && typeof c.configs === 'object') configs = c.configs;
    if (c.revs && typeof c.revs === 'object') Object.assign(lastRev, c.revs);
  } catch {}
}

function saveCache() {
  try { jsonCache.writeJSON(cachePath, { configs, revs: lastRev }); } catch {}
}

async function fetchAllConfigs() {
  if (!botKey()) return false;
  try {
    const r = await fetch(WORKER + '/bot/config', { headers: { 'x-bot-key': botKey() } });
    if (!r.ok) return false;
    const data = await r.json();
    configs = (data && typeof data === 'object' && !Array.isArray(data)) ? data : {};
    saveCache();
    return true;
  } catch (e) {
    console.error('[webConfig] fetch configs lỗi:', e.message);
    return false;
  }
}

function getGuild(guildId) {
  return merge(defaults(), configs[guildId] || {});
}

function getFeature(guildId, feature) {
  const g = getGuild(guildId);
  return g[feature] || defaults()[feature];
}

function getRev(guildId) {
  const c = configs[guildId];
  return c ? (c.rev || 0) : 0;
}

function buildMeta(guild) {
  const roles = [...guild.roles.cache.values()]
    .filter(r => r.id !== guild.id)
    .map(r => ({
      id: r.id,
      name: r.name,
      color: r.color || 0,
      position: r.position,
      managed: !!(r.managed || r.tags?.botId || r.tags?.integrationId || r.tags?.premiumSubscriberRole),
      editable: Boolean(r.editable),
    }));
  const emojis = [...guild.emojis.cache.values()].map(e => ({ id: e.id, name: e.name, animated: !!e.animated }));
  const members = [...guild.members.cache.values()]
    .filter(m => !m.user.bot)
    .slice(0, MEMBER_CAP)
    .map(m => ({ id: m.id, name: m.displayName || m.user.username }));
  return { guildId: guild.id, roles, emojis, members };
}

async function pushMeta(client) {
  if (!botKey()) return;
  for (const [, guild] of client.guilds.cache) {
    try {
      const r = await fetch(WORKER + '/bot/meta', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-bot-key': botKey() },
        body: JSON.stringify(buildMeta(guild)),
      });
      if (!r.ok) console.warn('[webConfig] push meta', guild.id, r.status);
    } catch (e) {
      console.error('[webConfig] push meta lỗi:', e.message);
    }
  }
}

const listeners = [];
function onConfigChange(fn) { listeners.push(fn); }

let cycleLock = false;
async function runCycle(client) {
  if (cycleLock) return;
  cycleLock = true;
  try {
    const ok = await fetchAllConfigs();
    if (!ok) return;
    let dirty = false;
    for (const gid of Object.keys(configs)) {
      const rev = getRev(gid);
      if (lastRev[gid] === undefined) { lastRev[gid] = rev; dirty = true; continue; }
      if (lastRev[gid] !== rev) {
        lastRev[gid] = rev;
        dirty = true;
        for (const fn of listeners) {
          try { await fn(client, gid); } catch (e) { console.error('[webConfig] listener:', e.message); }
        }
      }
    }
    if (dirty) saveCache();
  } finally {
    cycleLock = false;
  }
}

let pollTimer = null;
let metaTimer = null;

async function start(client) {
  loadCache();
  for (const [, guild] of client.guilds.cache) {
    try { await guild.members.fetch(); } catch {}
  }
  await fetchAllConfigs();
  pushMeta(client);
  runCycle(client);
  pollTimer = setInterval(() => runCycle(client), POLL_INTERVAL);
  metaTimer = setInterval(() => pushMeta(client), META_PUSH_INTERVAL);
  if (pollTimer.unref) pollTimer.unref();
  if (metaTimer.unref) metaTimer.unref();
}

function stop() {
  if (pollTimer) clearInterval(pollTimer);
  if (metaTimer) clearInterval(metaTimer);
  pollTimer = null;
  metaTimer = null;
}

module.exports = { start, stop, getGuild, getFeature, getRev, onConfigChange, pushMeta, fetchAllConfigs, buildMeta, defaults };
