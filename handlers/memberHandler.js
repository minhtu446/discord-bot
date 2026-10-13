const configHelper = require('../configHelper');
const roleEmoji = require('../roleEmoji');
const welcome = require('../features/welcome');
const webConfig = require('../webConfig');

async function assignRole(member, roleId) {
  try {
    const role = member.guild.roles.cache.get(roleId);
    if (role && role.editable && !role.managed) await member.roles.add(role);
  } catch (e) { console.error('[welcome] gán role ban đầu:', e.message); }
}

async function handleGuildMemberAdd(member) {
  const gid = member.guild.id;
  const settingsHelper = require('../settingsHelper');
  const s = settingsHelper.getSettings(gid);
  const w = webConfig.getFeature(gid, 'welcome') || {};
  const webActive = w.enabled !== false && /^\d{15,20}$/.test(String(w.channelId || ''));

  if (webActive) {
    for (const rid of (Array.isArray(w.roles) ? w.roles : [])) await assignRole(member, rid);
    try {
      const channel = member.client.channels.cache.get(w.channelId);
      if (!channel) return;
      const content = (w.content && w.content.trim())
        ? welcome.interpolateWelcome(w.content, member)
        : `🎉 Chào mừng ${member} đã đến với server!`;
      const welcomeBg = require('../features/welcomeBg');
      const bg = await welcomeBg.load(gid, w.bgVersion).catch(() => null);
      const attachment = await welcome.createWelcomeCanvas(member, w, bg).catch(() => null);
      const payload = { content };
      if (attachment) payload.files = [attachment];
      await channel.send(payload);
    } catch (e) { console.error('Lỗi welcome (web):', e); }
    return;
  }

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
