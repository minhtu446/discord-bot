const settingsHelper = require('../settingsHelper');
const configHelper = require('../configHelper');

async function getRelayTarget(client, userId) {
  for (const [, guild] of client.guilds.cache) {
    const s = settingsHelper.getSettings(guild.id);
    if (s.dmRelay === false) continue;
    const member = await guild.members.fetch(userId).catch(() => null);
    if (!member) continue;
    const relayChannelId = configHelper.getConfig(guild.id, 'dmRelayChannelId');
    if (!relayChannelId) continue;
    const channel = client.channels.cache.get(relayChannelId);
    if (!channel) continue;
    const label = member.displayName || member.user?.username || 'user';
    return { channel, label };
  }
  return null;
}

async function relayBotMessage(client, userId, text) {
  try {
    const target = await getRelayTarget(client, userId);
    if (!target) return false;
    await target.channel.send(`[🤖 Clowo ➜ @${target.label}]: ${text}`);
    return true;
  } catch (e) {
    console.error('[DMRelay] Relay bot reply failed:', e.message);
    return false;
  }
}

module.exports = { getRelayTarget, relayBotMessage };