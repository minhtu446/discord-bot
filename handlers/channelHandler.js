const jsonCache = require('../jsonCache');
const dataHelper = require('../dataHelper');

async function handleChannelDelete(channel) {
  try {
    const found = dataHelper.findUserChannelAcrossGuilds(channel.id);
    if (found) {
      const userChannels = dataHelper.getUserChannels(found.guildId);
      delete userChannels[found.userId];
      dataHelper.setUserChannels(found.guildId, userChannels);
    }
  } catch (e) { /* ignore */ }

  try {
    const found = dataHelper.findUserTicketAcrossGuilds(channel.id);
    if (found) {
      const userTickets = dataHelper.getUserTickets(found.guildId);
      delete userTickets[found.userId];
      dataHelper.setUserTickets(found.guildId, userTickets);
    }
  } catch (e) { /* ignore */ }

  try {
    const found = dataHelper.findSetupOwnerAcrossGuilds(channel.id);
    if (found) {
      const setupChannels = dataHelper.getSetupChannels(found.guildId);
      const chs = setupChannels[found.userId];
      if (chs) {
        if (chs.chat === channel.id) chs.chat = null;
        if (chs.voice === channel.id) chs.voice = null;
        if (!chs.chat && !chs.voice) {
          delete setupChannels[found.userId];
        }
        dataHelper.setSetupChannels(found.guildId, setupChannels);
      }
    }
  } catch (e) { /* ignore */ }
}

async function cleanStaleChannels(client) {
  let cleaned = 0;

  const allUserChannels = jsonCache.readJSONObject(jsonCache.getPath('userChannels.json'));
  for (const [guildId, guildData] of Object.entries(allUserChannels)) {
    for (const [uid, chId] of Object.entries(guildData)) {
      try {
        const ch = await client.channels.fetch(chId).catch(() => null);
        if (!ch) {
          delete guildData[uid];
          cleaned++;
        }
      } catch { delete guildData[uid]; cleaned++; }
    }
    dataHelper.setUserChannels(guildId, guildData);
  }

  const allUserTickets = jsonCache.readJSONObject(jsonCache.getPath('userTickets.json'));
  for (const [guildId, guildData] of Object.entries(allUserTickets)) {
    for (const [uid, chId] of Object.entries(guildData)) {
      try {
        const ch = await client.channels.fetch(chId).catch(() => null);
        if (!ch) {
          delete guildData[uid];
          cleaned++;
        }
      } catch { delete guildData[uid]; cleaned++; }
    }
    dataHelper.setUserTickets(guildId, guildData);
  }

  const allSetupChannels = jsonCache.readJSONObject(jsonCache.getPath('setupChannels.json'));
  for (const [guildId, guildData] of Object.entries(allSetupChannels)) {
    for (const [uid, chs] of Object.entries(guildData)) {
      for (const type of ['chat', 'voice']) {
        const chId = chs[type];
        if (!chId) continue;
        try {
          const ch = await client.channels.fetch(chId).catch(() => null);
          if (!ch) {
            delete chs[type];
            cleaned++;
          }
        } catch { delete chs[type]; cleaned++; }
      }
      if (!chs.chat && !chs.voice) delete guildData[uid];
    }
    dataHelper.setSetupChannels(guildId, guildData);
  }

  console.log(`[Cleanup] Đã dọn ${cleaned} kênh không còn tồn tại`);
  return cleaned;
}

module.exports = { handleChannelDelete, cleanStaleChannels };
