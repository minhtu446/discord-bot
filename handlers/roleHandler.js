const roleEmoji = require('../roleEmoji');
let pushTimer = null;

async function handleGuildRoleUpdate(oldRole, newRole) {
  const oldEmoji = (oldRole.name.match(/\p{Extended_Pictographic}/u) || [])[0] || null;
  const newEmoji = (newRole.name.match(/\p{Extended_Pictographic}/u) || [])[0] || null;
  if (oldEmoji !== newEmoji) {
    roleEmoji.updateRoleMembers(newRole.guild, newRole.id);
  }

  try {
    const pickrole = require('../pickroleConfig');
    if (pushTimer) clearTimeout(pushTimer);
    pushTimer = setTimeout(() => {
      pushTimer = null;
      pickrole.pushRoles(newRole.guild.client);
    }, 5000);
  } catch (e) {
    console.error('[roleHandler] push roles debounce lỗi:', e.message);
  }
}

module.exports = { handleGuildRoleUpdate };
