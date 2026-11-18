const roleEmoji = require('../roleEmoji');

async function handleUserUpdate(oldUser, newUser) {
  if (oldUser.displayName !== newUser.displayName) {
    for (const [, guild] of newUser.client.guilds.cache) {
      try {
        let member = guild.members.cache.get(newUser.id);
        if (!member) {
          member = await guild.members.fetch(newUser.id).catch(() => null);
        }
        // Truyền tên cũ + tên mới: roleEmoji chỉ đổi nick do bot tạo (nick trùng tên
        // tài khoản cũ), còn nick người dùng tự đặt thì giữ nguyên.
        if (member) {
          roleEmoji.updateMember(member, {
            prevDisplayName: oldUser.displayName,
            displayName: newUser.displayName
          });
        }
      } catch {}
    }
  }
}

module.exports = { handleUserUpdate };
