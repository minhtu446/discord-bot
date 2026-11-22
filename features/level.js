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

function normalizeCfg(cfg = {}) {
  const xpMin = Math.max(1, Math.min(1000, Math.floor(Number(cfg.xpMin) || 15)));
  const xpMaxRaw = Math.max(1, Math.min(1000, Math.floor(Number(cfg.xpMax) || 25)));
  const xpMax = Math.max(xpMin, xpMaxRaw);
  const baseXp = Math.max(1, Math.min(100000, Math.floor(Number(cfg.baseXp) || 100)));
  const stepXp = Math.max(0, Math.min(100000, Math.floor(Number(cfg.stepXp) || 50)));
  const rankDisplay = ['ui', 'image', 'both'].includes(String(cfg.rankDisplay)) ? String(cfg.rankDisplay) : 'ui';
  const rc = cfg.rankCard && typeof cfg.rankCard === 'object' ? cfg.rankCard : {};
  const lb = cfg.leaderboard && typeof cfg.leaderboard === 'object' ? cfg.leaderboard : {};
  return {
    enabled: cfg.enabled !== false,
    xpMin,
    xpMax,
    cooldown: Math.max(10, Math.min(3600, Math.floor(Number(cfg.cooldown) || 60))),
    baseXp,
    stepXp,
    channelId: /^\d{15,20}$/.test(String(cfg.channelId || '')) ? String(cfg.channelId) : '',
    message: typeof cfg.message === 'string' && cfg.message.trim() ? cfg.message.trim().slice(0, 500) : '🎉 {user} đã lên **level {level}**!',
    rankDisplay,
    rankCard: {
      bgUrl: typeof rc.bgUrl === 'string' ? rc.bgUrl.trim().slice(0, 1000) : '',
      bgColor: /^#[0-9a-fA-F]{6}$/.test(String(rc.bgColor || '')) ? String(rc.bgColor) : '#23272a',
      accent: /^#[0-9a-fA-F]{6}$/.test(String(rc.accent || '')) ? String(rc.accent) : '#5865F2',
      textColor: /^#[0-9a-fA-F]{6}$/.test(String(rc.textColor || '')) ? String(rc.textColor) : '#ffffff',
      showAvatar: rc.showAvatar !== false,
      showProgress: rc.showProgress !== false,
    },
    leaderboard: {
      enabled: lb.enabled !== false,
      topN: Math.max(1, Math.min(50, Math.floor(Number(lb.topN) || 10))),
      display: ['ui', 'image', 'both'].includes(String(lb.display)) ? String(lb.display) : 'ui',
      public: lb.public !== false,
      channelId: /^\d{15,20}$/.test(String(lb.channelId || '')) ? String(lb.channelId) : '',
      title: typeof lb.title === 'string' && lb.title.trim() ? lb.title.trim().slice(0, 256) : '🏆 Bảng xếp hạng - {server}',
    },
  };
}

function getConfig(guildId) {
  const cfg = webConfig.getFeature(guildId, 'level') || {};
  return normalizeCfg(cfg);
}

function xpForLevel(level, cfg = {}) {
  const l = Math.max(0, Math.floor(Number(level) || 0));
  const c = cfg && cfg.baseXp != null ? normalizeCfg(cfg) : { baseXp: 100, stepXp: 50 };
  return Math.max(1, Math.floor(c.baseXp + c.stepXp * l));
}

function calcLevel(totalXp, cfg = {}) {
  let xp = Math.max(0, Math.floor(Number(totalXp) || 0));
  let level = 0;
  const norm = cfg && cfg.baseXp != null ? normalizeCfg(cfg) : { baseXp: 100, stepXp: 50 };
  while (xp >= xpForLevel(level, norm)) {
    xp -= xpForLevel(level, norm);
    level++;
    if (level > 9999) break;
  }
  return { level, currentXp: xp, needed: xpForLevel(level, norm), totalXp: Math.max(0, Math.floor(Number(totalXp) || 0)) };
}

function getGuildStore(store, guildId) {
  if (!store[guildId] || typeof store[guildId] !== 'object') store[guildId] = {};
  return store[guildId];
}

function getUser(guildId, userId) {
  const cfg = getConfig(guildId);
  const store = getStore();
  const gs = getGuildStore(store, guildId);
  const u = gs[userId] && typeof gs[userId] === 'object' ? gs[userId] : {};
  const totalXp = Math.max(0, Math.floor(Number(u.xp) || 0));
  const calc = calcLevel(totalXp, cfg);
  return { ...calc, lastMsg: Number(u.lastMsg) || 0, cfg };
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
  const before = calcLevel(oldTotal, cfg);
  const after = calcLevel(newTotal, cfg);

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
  const cfg = getConfig(guildId);
  const store = getStore();
  const gs = getGuildStore(store, guildId);
  const rows = Object.entries(gs)
    .map(([userId, u]) => {
      const totalXp = Math.max(0, Math.floor(Number(u?.xp) || 0));
      const calc = calcLevel(totalXp, cfg);
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

module.exports = { xpForLevel, calcLevel, getUser, getConfig, addMessageXp, getLeaderboard, getRank, normalizeCfg };
