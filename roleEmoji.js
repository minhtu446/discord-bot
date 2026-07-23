const emojiRegex = /\p{Extended_Pictographic}/u;
const jsonCache = require('./jsonCache');
const { retryFetch } = require('./utils');
const noemojiPath = jsonCache.getPath('noemojiRoles.json');

function getSkipRoles() {
  return jsonCache.readJSONArray(noemojiPath);
}

function addSkipRole(id) {
  const list = getSkipRoles();
  if (!list.includes(id)) {
    list.push(id);
    jsonCache.writeJSON(noemojiPath, list);
  }
}

function removeSkipRole(id) {
  let list = getSkipRoles();
  list = list.filter(r => r !== id);
  jsonCache.writeJSON(noemojiPath, list);
}

function listSkipRoles() {
  return [...getSkipRoles()];
}

function getEmojiPrefix(member) {
  const skip = getSkipRoles();
  const roles = [...member.roles.cache.values()]
    .filter(r => r.id !== member.guild.id && !skip.includes(r.id))
    .sort((a, b) => b.position - a.position);
  for (const role of roles) {
    const m = role.name.match(emojiRegex);
    if (m) return m[0];
  }
  return null;
}

function stripEmoji(name) {
  return name.replace(/^[\p{Extended_Pictographic}\u{FE0F}\u{200D}\s]+/u, '').trim();
}

async function updateMember(member) {
  if (member.user.bot) return;
  const emoji = getEmojiPrefix(member);

  if (emoji) {
    const displayBase = stripEmoji(member.user.displayName) || member.user.displayName;
    const target = `${emoji} ${displayBase}`;
    if (member.nickname !== target) {
      try {
        await member.setNickname(target, 'Auto emoji from roles');
      } catch (e) {
        if (e.code !== 50013) console.error(`[roleEmoji] setNickname: ${e.message}`);
      }
    }
  } else {
    const curNick = member.nickname || '';
    const stripped = stripEmoji(curNick);
    if (stripped !== curNick) {
      const target = stripped === member.user.displayName ? null : stripped;
      try {
        await member.setNickname(target, 'Remove emoji - no matching role');
      } catch {} 
    }
  }
}

async function debugRoles(guild) {
  const roles = [...guild.roles.cache.values()]
    .filter(r => r.name.match(/\p{Extended_Pictographic}/u))
    .map(r => `${r.name} (${r.id}, pos=${r.position})`);
  console.log(`[roleEmoji] Emoji roles in ${guild.name}:`, roles.length ? roles : 'none');
  const skip = getSkipRoles();
  console.log(`[roleEmoji] Skipped role IDs:`, skip);
}

async function updateGuild(guild) {
  const members = await retryFetch(() => guild.members.fetch());
  const batch = [...members.values()].filter(m => !m.user.bot);
  for (let i = 0; i < batch.length; i += 10) {
    await Promise.allSettled(batch.slice(i, i + 10).map(m => updateMember(m)));
  }
}

async function updateRoleMembers(guild, roleId) {
  const members = await retryFetch(() => guild.members.fetch());
  const batch = [...members.values()].filter(m => !m.user.bot && m.roles.cache.has(roleId));
  for (let i = 0; i < batch.length; i += 10) {
    await Promise.allSettled(batch.slice(i, i + 10).map(m => updateMember(m)));
  }
}

let intervalHandle = null;

function startInterval(client) {
  if (intervalHandle) clearInterval(intervalHandle);
  intervalHandle = setInterval(async () => {
    for (const [, guild] of client.guilds.cache) {
      try { await updateGuild(guild); } catch {}
    }
  }, 2 * 60 * 1000);
}

function stopInterval() {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
}

async function init(client) {
  for (const [, guild] of client.guilds.cache) {
    try { await updateGuild(guild); }
    catch (e) { console.error(`[roleEmoji] init error for ${guild.name}: ${e.message}`); }
  }
  startInterval(client);
}

module.exports = { init, updateMember, updateGuild, updateRoleMembers, addSkipRole, removeSkipRole, listSkipRoles, stopInterval };
