const roleEmoji = require('../roleEmoji');

async function handleUserUpdate(oldUser, newUser) {
  if (oldUser.displayName !== newUser.displayName) {
    for (const [, guild] of newUser.client.guilds.cache) {
      try {
        let member = guild.members.cache.get(newUser.id);
        if (!member) {
          member = await guild.members.fetch(newUser.id).catch(() => null);
        }
        if (member) roleEmoji.updateMember(member);
      } catch {}
    }
  }
}

module.exports = { handleUserUpdate };
