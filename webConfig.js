const jsonCache = require('./jsonCache');
const { PermissionFlagsBits } = require('discord.js');

const WORKER = 'https://clowo-locks.clowo.workers.dev';
const cachePath = jsonCache.getPath('webConfig.json');
// Poll 5s: mỗi lần chỉ đọc vài dòng từ D1 (~52k dòng/ngày ≈ 1% hạn mức D1
// 5 triệu/ngày). Đủ nhanh để cấu hình lan toả gần như tức thì.
const POLL_INTERVAL = 5000;
const META_PUSH_INTERVAL = 1 * 60 * 1000;
const GUILD_LIST_INTERVAL = 45 * 1000;  // nhắc lại danh sách server bot đang ở (cho panel)
const MEMBER_CAP = 2000;

let configs = {};
const lastRev = {};

function botKey() {
  return process.env.BOT_KEY || '';
}

function defaults() {
  return {
    welcome: { enabled: true, channelId: '', content: '', bgVersion: '', backgroundUrl: '', avatarSize: 130, avatarW: 130, avatarH: 130, avatarShape: 'circle', avatarX: 65, avatarY: 150, bgX: 0, bgY: 0, bgZoom: 100, info: null, elsCustom: null, texts: [], roles: [] },
    ticket: { enabled: true, categoryId: '', panel: { content: '', color: 0x5865F2, title: '', button: '' }, ticket: { content: '', color: 0x5865F2 }, allow: [] },
    voice: { enabled: true, hubChannelId: '', categoryId: '' },
    emojiRole: { enabled: true, roles: [] },
    pickrole: { enabled: true, mode: 'multi', title: '', content: '', items: [] },
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
      admin: Boolean(r.permissions && r.permissions.has(PermissionFlagsBits.Administrator)),
      elevated: Boolean(r.permissions && r.permissions.any(
        PermissionFlagsBits.Administrator | PermissionFlagsBits.ManageGuild | PermissionFlagsBits.ManageRoles |
        PermissionFlagsBits.ModerateMembers | PermissionFlagsBits.BanMembers | PermissionFlagsBits.KickMembers |
        PermissionFlagsBits.ManageChannels
      )),
    }));
  const emojis = [...guild.emojis.cache.values()].map(e => ({ id: e.id, name: e.name, animated: !!e.animated }));
  const channels = [...guild.channels.cache.values()]
    .filter(ch => !(ch.type === 15 || ch.type === 16))
    .slice(0, 300)
    .map(ch => ({ id: ch.id, name: ch.name, type: typeof ch.type === 'number' ? ch.type : 0 }));
  const members = [...guild.members.cache.values()]
    .filter(m => !m.user.bot)
    .slice(0, MEMBER_CAP)
    .map(m => ({ id: m.id, name: m.displayName || m.user.username }));
  return { guildId: guild.id, roles, emojis, members, channels };
}

async function pushMeta(client, guildId) {
  if (!botKey()) return;
  const guilds = guildId
    ? [client.guilds.cache.get(String(guildId))].filter(Boolean)
    : [...client.guilds.cache.values()];
  for (const guild of guilds) {
    // Thử gửi meta tối đa 2 lần: lỗi mạng/HTTP → chờ 5s thử lại cho danh sách kênh/role/emoji kịp cập nhật.
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const r = await fetch(WORKER + '/bot/meta', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-bot-key': botKey() },
          body: JSON.stringify(buildMeta(guild)),
        });
        if (r.ok) break;
        console.warn('[webConfig] push meta', guild.id, r.status, (attempt === 1 ? '— thử lại sau 5s' : '— đã thử 2 lần'));
      } catch (e) {
        console.error('[webConfig] push meta lỗi:', guild.id, e.message, (attempt === 1 ? '— thử lại sau 5s' : '— đã thử 2 lần'));
      }
      if (attempt === 1) await new Promise(res => setTimeout(res, 5000));
    }
  }
}

const listeners = [];
function onConfigChange(fn) { listeners.push(fn); }

// Danh sách server bot đang ở — panel ẩn thẻ server bot đã bị kick dựa vào đây.
// Chỉ ghi khi danh sách đổi nên hầu như không tiêu hạn mức ghi.
let _lastGuildSig = null;
async function pushGuilds(client) {
  if (!botKey()) return;
  const ids = [...client.guilds.cache.keys()].map(String).sort();
  // Metadata server để footer web hiện avatar: id/name/icon + số người (xếp 5 đông nhất).
  const guilds = client.guilds.cache.map(g => ({
    id: g.id,
    name: String(g.name || '').slice(0, 100),
    icon: typeof g.icon === 'string' ? g.icon : null,
    members: g.memberCount || 0
  })).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  // Chữ ký gồm id + số người → server thêm/bớt thành viên cũng tự bơm lại theo chu kỳ.
  const sig = ids.join(',') + ':' + guilds.map(g => g.members).join(',');
  if (sig === _lastGuildSig) return;
  _lastGuildSig = sig;
  try {
    const r = await fetch(WORKER + '/bot/guilds', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-bot-key': botKey() },
      body: JSON.stringify({ guildIds: ids, guilds })
    });
    if (!r.ok) console.warn('[webConfig] push guilds HTTP', r.status);
  } catch (e) {
    console.error('[webConfig] push guilds lỗi:', e.message);
  }
}

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
      // Bot không còn ở server này (bị kick/khách) — không áp listener cho guild đã
      // rời. Vẫn ghi nhớ rev để khi bot quay lại sẽ không chạy listener thừa.
      if (!client.guilds.cache.has(gid)) {
        if (lastRev[gid] !== rev) { lastRev[gid] = rev; dirty = true; }
        continue;
      }
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
let guildTimer = null;

async function start(client) {
  loadCache();
  for (const [, guild] of client.guilds.cache) {
    try {
      await guild.members.fetch();
      await guild.channels.fetch();
    } catch {}
  }
  await fetchAllConfigs();
  pushGuilds(client);
  pushMeta(client);
  runCycle(client);
  pollTimer = setInterval(() => runCycle(client), POLL_INTERVAL);
  metaTimer = setInterval(() => pushMeta(client), META_PUSH_INTERVAL);
  // Nhắc lại danh sách guild theo chu kỳ — pushGuilds tự bỏ qua khi chưa đổi,
  // nên panel luôn thấy server mới thêm mà không tiêu hạn mức ghi.
  guildTimer = setInterval(() => pushGuilds(client), GUILD_LIST_INTERVAL);
  if (pollTimer.unref) pollTimer.unref();
  if (metaTimer.unref) metaTimer.unref();
  if (guildTimer.unref) guildTimer.unref();
}

function stop() {
  if (pollTimer) clearInterval(pollTimer);
  if (metaTimer) clearInterval(metaTimer);
  if (guildTimer) clearInterval(guildTimer);
  pollTimer = null;
  metaTimer = null;
  guildTimer = null;
}

module.exports = { start, stop, getGuild, getFeature, getRev, onConfigChange, pushMeta, pushGuilds, fetchAllConfigs, buildMeta, defaults, botKey, WORKER };
