const emojiStart = /^[\p{Extended_Pictographic}\u{FE0F}\u{200D}]+/u;
const jsonCache = require('./jsonCache');
const webConfig = require('./webConfig');
const settingsHelper = require('./settingsHelper');
const { retryFetch } = require('./utils');

// Discord giới hạn biệt danh 32 ký tự (tính theo code point).
const NICK_MAX = 32;

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

// Ghép "emoji + space + tên" nhưng cắt tên cho vừa 32 ký tự của Discord
// (tên tài khoản có thể dài 32 ký tự → thêm emoji là vượt, setNickname sẽ lỗi 50035).
function fitNick(emoji, base) {
  const emojiChars = Array.from(emoji || '');
  const room = NICK_MAX - emojiChars.length - 1;
  if (room <= 0) return emojiChars.slice(0, NICK_MAX).join('');
  const baseChars = Array.from(base || '').slice(0, room).join('');
  return baseChars ? emoji + ' ' + baseChars : emoji;
}

// Tắt "Đổi biệt danh" trong cài đặt server → không đụng biệt danh (mọi đường gọi).
function autoNickEnabled(gid) {
  try { return settingsHelper.getSettings(gid).autoNickname !== false; } catch { return true; }
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

async function updateMember(member, opts) {
  if (!member || !member.user || member.user.bot) return;
  if (member.id === member.guild.ownerId) return; // Discord cấm bot đổi biệt danh của chủ server
  if (!autoNickEnabled(member.guild.id)) return;
  const emoji = getEmojiPrefix(member);
  const curNick = member.nickname || '';
  // `opts.displayName` = tên mới từ sự kiện UserUpdate (tránh cache user còn cũ).
  const displayName = (opts && opts.displayName) || member.user.displayName || '';
  const displayBase = stripEmoji(displayName) || displayName;
  const curBase = stripEmoji(curNick);
  // Tên tài khoản CŨ — chỉ có khi user vừa đổi tên. Nick hiện tại trùng đúng tên cũ
  // = nick do bot tạo (không phải nick tự đặt) → phải theo tên tài khoản mới.
  const prevBase = opts && opts.prevDisplayName
    ? (stripEmoji(opts.prevDisplayName) || opts.prevDisplayName)
    : '';

  if (emoji) {
    const followDisplay = !curBase || (prevBase && curBase === prevBase);
    const base = followDisplay ? displayBase : curBase;
    const target = fitNick(emoji, base);
    if (curNick !== target) {
      try {
        await member.setNickname(target, 'Auto emoji from roles');
      } catch (e) { logNickError(e); }
    }
  } else {
    if (curBase !== curNick) {
      const target = curBase === displayBase ? null : curBase;
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
  const skip = getGuildEmojiRoles(guild.id);
  console.log(`[roleEmoji] Emoji role IDs:`, skip);
}

async function fetchMembers(guild) {
  try {
    if (guild.members.cache.size > 1) return [...guild.members.cache.values()];
    const fetched = await retryFetch(() => guild.members.fetch());
    return [...fetched.values()];
  } catch {
    return [...guild.members.cache.values()];
  }
}

async function updateGuild(guild) {
  if (!isEnabled(guild?.id)) return;
  const ownerId = guild.ownerId;
  const batch = (await fetchMembers(guild)).filter(m => !m.user.bot && m.id !== ownerId);
  for (let i = 0; i < batch.length; i += 10) {
    await Promise.allSettled(batch.slice(i, i + 10).map(m => updateMember(m)));
  }
}

async function updateRoleMembers(guild, roleId) {
  if (!isEnabled(guild?.id)) return;
  const ownerId = guild.ownerId;
  const batch = (await fetchMembers(guild)).filter(m => !m.user.bot && m.id !== ownerId && m.roles.cache.has(roleId));
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
  }, 3 * 60 * 1000);
}

function stopInterval() {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
}

async function init(client) {
  // Áp ngay khi cấu hình emojiRole được lưu trên web (bot phát hiện rev đổi)
  webConfig.onConfigChange(async (c, gid) => {
    const guild = c.guilds.cache.get(gid);
    if (!guild || !isEnabled(gid)) return;
    try { await updateGuild(guild); } catch (e) { console.error(`[roleEmoji] resync ${gid}:`, e.message); }
  });
  for (const [, guild] of client.guilds.cache) {
    try { if (isEnabled(guild.id)) await updateGuild(guild); }
    catch (e) { console.error(`[roleEmoji] init error for ${guild.name}: ${e.message}`); }
  }
  startInterval(client);
}

module.exports = { init, updateMember, updateGuild, updateRoleMembers, addEmojiRole, removeEmojiRole, listEmojiRoles, stopInterval };
