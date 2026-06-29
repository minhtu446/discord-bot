const roleEmoji = require('../roleEmoji');

async function handleGuildRoleUpdate(oldRole, newRole) {
  const oldEmoji = (oldRole.name.match(/\p{Extended_Pictographic}/u) || [])[0] || null;
  const newEmoji = (newRole.name.match(/\p{Extended_Pictographic}/u) || [])[0] || null;
  if (oldEmoji !== newEmoji) {
    roleEmoji.updateRoleMembers(newRole.guild, newRole.id);
  }
}

module.exports = { handleGuildRoleUpdate };
