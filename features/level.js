const jsonCache = require('../jsonCache');
const webConfig = require('../webConfig');

const LEVELS_PATH = jsonCache.getPath('levels.json');
const saveTimers = new Map();

function getStore() {
  return jsonCache.readJSONObject(LEVELS_PATH);
}

function saveStore(store) {
  jsonCache.writeJSON(LEVELS_PATH, store);
}

function scheduleSave(guildId) {
  if (saveTimers.has(guildId)) return;
  const t = setTimeout(() => {
    saveTimers.delete(guildId);
    const store = getStore();
    jsonCache.writeJSON(LEVELS_PATH, store);
    jsonCache.flushSync(LEVELS_PATH);
  }, 15000);
  saveTimers.set(guildId, t);
}

function xpForLevel(level) {
  const l = Math.max(0, Number(level) || 0);
  return 5 * l * l + 50 * l + 100;
}

function calcLevel(totalXp) {
  let xp = Math.max(0, Math.floor(Number(totalXp) || 0));
  let level = 0;
  while (xp >= xpForLevel(level)) {
    xp -= xpForLevel(level);
    level++;
    if (level > 9999) break;
  }
  return { level, currentXp: xp, needed: xpForLevel(level), totalXp: Math.max(0, Math.floor(Number(totalXp) || 0)) };
}

function getGuildStore(store, guildId) {
  if (!store[guildId] || typeof store[guildId] !== 'object') store[guildId] = {};
  return store[guildId];
}

function getUser(guildId, userId) {
  const store = getStore();
  const gs = getGuildStore(store, guildId);
  const u = gs[userId] && typeof gs[userId] === 'object' ? gs[userId] : {};
  const totalXp = Math.max(0, Math.floor(Number(u.xp) || 0));
  const calc = calcLevel(totalXp);
  return { ...calc, lastMsg: Number(u.lastMsg) || 0 };
}

function getConfig(guildId) {
  const cfg = webConfig.getFeature(guildId, 'level') || {};
  return {
    enabled: cfg.enabled !== false,
    xpMin: Math.max(1, Math.min(100, Math.floor(Number(cfg.xpMin) || 15))),
    xpMax: Math.max(1, Math.min(100, Math.floor(Number(cfg.xpMax) || 25))),
    cooldown: Math.max(10, Math.min(3600, Math.floor(Number(cfg.cooldown) || 60))),
    channelId: /^\d{15,20}$/.test(String(cfg.channelId || '')) ? String(cfg.channelId) : '',
    message: typeof cfg.message === 'string' && cfg.message.trim() ? cfg.message.trim().slice(0, 500) : '🎉 {user} đã lên **level {level}**!',
  };
}

function randomXp(min, max) {
  const lo = Math.min(min, max);
  const hi = Math.max(min, max);
  return Math.floor(Math.random() * (hi - lo + 1)) + lo;
}

function addMessageXp(message) {
  if (!message.guild || message.author?.bot) return null;
  const guildId = message.guild.id;
  const userId = message.author.id;
  const cfg = getConfig(guildId);
  if (!cfg.enabled) return null;

  const store = getStore();
  const gs = getGuildStore(store, guildId);
  const prev = gs[userId] && typeof gs[userId] === 'object' ? gs[userId] : { xp: 0, lastMsg: 0 };
  const now = Date.now();
  const lastMsg = Number(prev.lastMsg) || 0;
  if (now - lastMsg < cfg.cooldown * 1000) return null;

  const gain = randomXp(cfg.xpMin, cfg.xpMax);
  const oldTotal = Math.max(0, Math.floor(Number(prev.xp) || 0));
  const newTotal = oldTotal + gain;
  const before = calcLevel(oldTotal);
  const after = calcLevel(newTotal);

  gs[userId] = { xp: newTotal, lastMsg: now };
  saveStore(store);
  scheduleSave(guildId);

  return {
    gained: gain,
    totalXp: newTotal,
    oldLevel: before.level,
    newLevel: after.level,
    currentXp: after.currentXp,
    needed: after.needed,
    leveledUp: after.level > before.level,
    cfg,
  };
}

function getLeaderboard(guildId, limit = 10) {
  const store = getStore();
  const gs = getGuildStore(store, guildId);
  const rows = Object.entries(gs)
    .map(([userId, u]) => {
      const totalXp = Math.max(0, Math.floor(Number(u?.xp) || 0));
      const calc = calcLevel(totalXp);
      return { userId, ...calc };
    })
    .sort((a, b) => b.totalXp - a.totalXp || a.userId.localeCompare(b.userId))
    .slice(0, Math.max(1, Math.min(50, Math.floor(Number(limit) || 10))));
  return rows;
}

function getRank(guildId, userId) {
  const store = getStore();
  const gs = getGuildStore(store, guildId);
  const rows = Object.entries(gs)
    .map(([uid, u]) => ({ userId: uid, totalXp: Math.max(0, Math.floor(Number(u?.xp) || 0)) }))
    .sort((a, b) => b.totalXp - a.totalXp || a.userId.localeCompare(b.userId));
  const idx = rows.findIndex(r => r.userId === userId);
  return idx >= 0 ? idx + 1 : null;
}

module.exports = { xpForLevel, calcLevel, getUser, getConfig, addMessageXp, getLeaderboard, getRank };
