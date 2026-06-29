const jsonCache = require('../jsonCache');

const userChannelsPath = jsonCache.getPath('userChannels.json');
const userTicketsPath = jsonCache.getPath('userTickets.json');
const setupChannelsPath = jsonCache.getPath('setupChannels.json');

function cleanObjectByChannelId(data, channelId) {
  let changed = false;
  for (const [uid, chId] of Object.entries(data)) {
    if (chId === channelId) {
      delete data[uid];
      changed = true;
    }
  }
  return changed;
}

async function handleChannelDelete(channel) {
  try {
    const gameData = jsonCache.readJSONObject(userChannelsPath);
    if (cleanObjectByChannelId(gameData, channel.id)) {
      jsonCache.writeJSON(userChannelsPath, gameData);
    }
  } catch (e) { /* ignore */ }

  try {
    const ticketData = jsonCache.readJSONObject(userTicketsPath);
    if (cleanObjectByChannelId(ticketData, channel.id)) {
      jsonCache.writeJSON(userTicketsPath, ticketData);
    }
  } catch (e) { /* ignore */ }

  try {
    const noituChannel = require('../noituChannel');
    noituChannel.cleanupChannel(channel.id);
  } catch (e) { /* ignore */ }
}

async function cleanStaleChannels(client) {
  let cleaned = 0;

  try {
    const userChannels = jsonCache.readJSONObject(userChannelsPath);
    for (const [uid, chId] of Object.entries(userChannels)) {
      try {
        const ch = await client.channels.fetch(chId).catch(() => null);
        if (!ch) {
          delete userChannels[uid];
          cleaned++;
        }
      } catch { delete userChannels[uid]; cleaned++; }
    }
    jsonCache.writeJSON(userChannelsPath, userChannels);
  } catch (e) { /* ignore */ }

  try {
    const userTickets = jsonCache.readJSONObject(userTicketsPath);
    for (const [uid, chId] of Object.entries(userTickets)) {
      try {
        const ch = await client.channels.fetch(chId).catch(() => null);
        if (!ch) {
          delete userTickets[uid];
          cleaned++;
        }
      } catch { delete userTickets[uid]; cleaned++; }
    }
    jsonCache.writeJSON(userTicketsPath, userTickets);
  } catch (e) { /* ignore */ }

  try {
    const setupChannels = jsonCache.readJSONObject(setupChannelsPath);
    for (const [uid, chs] of Object.entries(setupChannels)) {
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
      if (!chs.chat && !chs.voice) delete setupChannels[uid];
    }
    jsonCache.writeJSON(setupChannelsPath, setupChannels);
  } catch (e) { /* ignore */ }

  console.log(`[Cleanup] Đã dọn ${cleaned} kênh không còn tồn tại`);
  return cleaned;
}

module.exports = { handleChannelDelete, cleanStaleChannels };
