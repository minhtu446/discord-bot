const configHelper = require('../configHelper');
const roleEmoji = require('../roleEmoji');
const welcome = require('../features/welcome');

async function handleGuildMemberAdd(member) {
  const gid = member.guild.id;
  const settingsHelper = require('../settingsHelper');
  const s = settingsHelper.getSettings(gid);

  if (s.autoRole !== false) {
    try {
      const roleId = configHelper.getConfig(gid, 'memberRoleId');
      if (roleId) {
        const role = member.guild.roles.cache.get(roleId);
        if (role) await member.roles.add(role);
      }
    } catch (e) { console.error('Lỗi gán role:', e); }
  }

  if (s.welcomeEmbed === false && s.welcomeCanvas === false) return;

  try {
    const welcomeChannelId = configHelper.getConfig(gid, 'welcomeChannelId');
    const welcomeChannel = member.client.channels.cache.get(welcomeChannelId);
    if (!welcomeChannel) return;

    const payload = { content: `🎉 Chào mừng ${member} đã đến với server!` };

    if (s.welcomeEmbed !== false) {
      const msgData = welcome.createWelcomeEmbed(member);
      payload.embeds = msgData.embeds;
    }

    if (s.welcomeCanvas !== false) {
      const attachment = await welcome.createWelcomeCanvas(member).catch(() => null);
      if (attachment) {
        payload.files = [attachment];
        if (payload.embeds) payload.embeds[0].setImage('attachment://welcome.png');
      }
    }

    await welcomeChannel.send(payload);
  } catch (e) { console.error('Lỗi welcome:', e); }
}

async function handleGuildMemberUpdate(oldMember, newMember) {
  const settingsHelper = require('../settingsHelper');
  const s = settingsHelper.getSettings(newMember.guild.id);
  if (s.autoNickname === false) return;

  const oldRoles = oldMember.roles.cache.map(r => r.id).sort().join(',');
  const newRoles = newMember.roles.cache.map(r => r.id).sort().join(',');
  const nicknameChanged = oldMember.nickname !== newMember.nickname;
  if (oldRoles !== newRoles || nicknameChanged) {
    roleEmoji.updateMember(newMember);
  }
}

module.exports = { handleGuildMemberAdd, handleGuildMemberUpdate };
