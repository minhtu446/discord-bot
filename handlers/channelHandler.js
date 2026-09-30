const { ChannelType } = require('discord.js');
const jsonCache = require('../jsonCache');
const dataHelper = require('../dataHelper');

const VOICE_EMPTY_DELETE_DELAY = 30000;
const pendingVoiceDeletes = new Map();

function cancelPendingVoiceDelete(channelId) {
  const timer = pendingVoiceDeletes.get(channelId);
  if (timer) {
    clearTimeout(timer);
    pendingVoiceDeletes.delete(channelId);
  }
}

function forgetSetupChannel(guildId, channelId) {
  const setupChannels = dataHelper.getSetupChannels(guildId);
  const owner = dataHelper.getSetupOwner(setupChannels, channelId);
  if (!owner) return;
  const chs = setupChannels[owner];
  if (!chs) return;
  chs.voice = null;
  if (!chs.voice) delete setupChannels[owner];
  dataHelper.setSetupChannels(guildId, setupChannels);
}

function scheduleVoiceDelete(channel) {
  cancelPendingVoiceDelete(channel.id);
  const timer = setTimeout(async () => {
    pendingVoiceDeletes.delete(channel.id);
    try {
      const found = dataHelper.findSetupOwnerAcrossGuilds(channel.id);
      if (found) {
        forgetSetupChannel(found.guildId, channel.id);
        await channel.delete('Kênh voice không còn ai, tự động dọn');
      }
    } catch (e) {
      console.error('[AutoDelete] Lỗi xóa kênh voice:', e.message);
    }
  }, VOICE_EMPTY_DELETE_DELAY);
  if (typeof timer.unref === 'function') timer.unref();
  pendingVoiceDeletes.set(channel.id, timer);
}

async function handleVoiceStateUpdate(oldState, newState) {
  try {
    const joinedId = newState?.channelId;
    if (joinedId) cancelPendingVoiceDelete(joinedId);

    const leftId = oldState?.channelId;
    if (!leftId || leftId === joinedId) return;
    if (!dataHelper.findSetupOwnerAcrossGuilds(leftId)) return;

    const channel = newState.guild.channels.cache.get(leftId);
    if (!channel || channel.type !== ChannelType.GuildVoice) return;
    if (channel.members.size > 0) return;

    scheduleVoiceDelete(channel);
  } catch (e) {
    console.error('[AutoDelete] handleVoiceStateUpdate:', e.message);
  }
}

async function handleChannelDelete(channel) {
  cancelPendingVoiceDelete(channel.id);
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
        if (chs.voice === channel.id) chs.voice = null;
        if (!chs.voice) {
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
      if (chs.voice) {
        try {
          const ch = await client.channels.fetch(chs.voice).catch(() => null);
          if (!ch) {
            chs.voice = null;
            cleaned++;
          }
        } catch { chs.voice = null; cleaned++; }
      }
      if (!chs.voice) delete guildData[uid];
    }
    dataHelper.setSetupChannels(guildId, guildData);
  }

  console.log(`[Cleanup] Đã dọn ${cleaned} kênh không còn tồn tại`);
  return cleaned;
}

module.exports = { handleChannelDelete, cleanStaleChannels, handleVoiceStateUpdate };
