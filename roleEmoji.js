const emojiStart = /^[\p{Extended_Pictographic}\u{FE0F}\u{200D}]+/u;
const jsonCache = require('./jsonCache');
const webConfig = require('./webConfig');
const { retryFetch } = require('./utils');

const emojiRolesPath = jsonCache.getPath('emojiRoles.json'); // legacy, kept for compatibility

function getLegacyEmojiRoles() {
  try { return jsonCache.readJSONArray(emojiRolesPath); } catch { return []; }
}

function getGuildEmojiRoles(guildId) {
  if (!guildId) return [];
  const f = webConfig.getFeature(guildId, 'emojiRole') || {};
  return Array.isArray(f.roles) ? f.roles : [];
}

function isEnabled(guildId) {
  if (!guildId) return false;
  const f = webConfig.getFeature(guildId, 'emojiRole') || {};
  return f.enabled !== false;
}

function addEmojiRole(id) {
  // Legacy global management disabled in favor of web config; kept as no-op
  const list = getLegacyEmojiRoles();
  if (id && !list.includes(id)) {
    list.push(id);
    try { jsonCache.writeJSON(emojiRolesPath, list); } catch {}
  }
}

function removeEmojiRole(id) {
  let list = getLegacyEmojiRoles();
  list = list.filter(r => r !== id);
  try { jsonCache.writeJSON(emojiRolesPath, list); } catch {}
}

function listEmojiRoles(guildId) {
  if (guildId) return [...getGuildEmojiRoles(guildId)];
  return [...getLegacyEmojiRoles()];
}

function getEmojiPrefix(member) {
  const gid = member?.guild?.id;
  if (!isEnabled(gid)) return null;
  const allow = getGuildEmojiRoles(gid);
  const roles = [...member.roles.cache.values()]
    .filter(r => r.id !== member.guild.id && allow.includes(r.id))
    .sort((a, b) => b.position - a.position);
  for (const role of roles) {
    const s = role.name.trim().match(emojiStart);
    if (s) return s[0];
  }
  return null;
}

function stripEmoji(name) {
  return (name || '').replace(/^[\p{Extended_Pictographic}\u{FE0F}\u{200D}\s]+/u, '').trim();
}

let warnedNoPerm = false;
function logNickError(e) {
  if (!e) return;
  if (e.code === 50013) {
    if (!warnedNoPerm) {
      warnedNoPerm = true;
      console.warn('[roleEmoji] Không thể đổi biệt danh — cần bật quyền Manage Nicknames cho role bot và đặt role bot cao hơn thành viên mục tiêu.');
    }
  } else {
    console.error('[roleEmoji] setNickname:', e.message);
  }
}

async function updateMember(member) {
  if (member.user.bot) return;
  const emoji = getEmojiPrefix(member);
  const curNick = member.nickname || '';

  if (emoji) {
    const base = stripEmoji(curNick) || stripEmoji(member.user.displayName) || member.user.displayName;
    const target = `${emoji} ${base}`;
    if (curNick !== target) {
      try {
        await member.setNickname(target, 'Auto emoji from roles');
      } catch (e) { logNickError(e); }
    }
  } else {
    const stripped = stripEmoji(curNick);
    if (stripped !== curNick) {
      const target = stripped === member.user.displayName ? null : stripped;
      try {
        await member.setNickname(target, 'Remove emoji - no matching role');
      } catch (e) { logNickError(e); }
    }
  }
}

async function debugRoles(guild) {
  const roles = [...guild.roles.cache.values()]
    .filter(r => r.name.trim().match(emojiStart))
    .map(r => `${r.name} (${r.id}, pos=${r.position})`);
  console.log(`[roleEmoji] Emoji roles in ${guild.name}:`, roles.length ? roles : 'none');
  const skip = getEmojiRoles();
  console.log(`[roleEmoji] Emoji role IDs:`, skip);
}

async function updateGuild(guild) {
  if (!isEnabled(guild?.id)) return;
  const members = await retryFetch(() => guild.members.fetch());
  const batch = [...members.values()].filter(m => !m.user.bot);
  for (let i = 0; i < batch.length; i += 10) {
    await Promise.allSettled(batch.slice(i, i + 10).map(m => updateMember(m)));
  }
}

async function updateRoleMembers(guild, roleId) {
  if (!isEnabled(guild?.id)) return;
  const members = await retryFetch(() => guild.members.fetch());
  const batch = [...members.values()].filter(m => !m.user.bot && m.roles.cache.has(roleId));
  for (let i = 0; i < batch.length; i += 10) {
    await Promise.allSettled(batch.slice(i, i + 10).map(m => updateMember(m)));
  }
}

let intervalHandle = null;
let syncing = false;

function startInterval(client) {
  if (intervalHandle) clearInterval(intervalHandle);
  intervalHandle = setInterval(async () => {
    if (syncing) return;
    syncing = true;
    try {
      for (const [, guild] of client.guilds.cache) {
        try { if (isEnabled(guild.id)) await updateGuild(guild); } catch {}
      }
    } finally {
      syncing = false;
    }
  }, 10 * 60 * 1000);
}

function stopInterval() {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
}

async function init(client) {
  for (const [, guild] of client.guilds.cache) {
    try { if (isEnabled(guild.id)) await updateGuild(guild); }
    catch (e) { console.error(`[roleEmoji] init error for ${guild.name}: ${e.message}`); }
  }
  startInterval(client);
}

module.exports = { init, updateMember, updateGuild, updateRoleMembers, addEmojiRole, removeEmojiRole, listEmojiRoles, stopInterval };
