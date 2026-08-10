const jsonCache = require('./jsonCache');

const setupChannelsPath = jsonCache.getPath('setupChannels.json');
const userChannelsPath = jsonCache.getPath('userChannels.json');
const userTicketsPath = jsonCache.getPath('userTickets.json');

function getSetupChannels(guildId) {
  const all = jsonCache.readJSONObject(setupChannelsPath);
  return all[guildId] || {};
}

function setSetupChannels(guildId, data) {
  const all = jsonCache.readJSONObject(setupChannelsPath);
  all[guildId] = data;
  jsonCache.writeJSON(setupChannelsPath, all);
}

function getSetupOwner(setupChannels, channelId) {
  for (const [uid, chs] of Object.entries(setupChannels)) {
    if (chs.chat === channelId || chs.voice === channelId) return uid;
  }
  return null;
}

function findSetupOwnerAcrossGuilds(channelId) {
  const all = jsonCache.readJSONObject(setupChannelsPath);
  for (const [guildId, guildData] of Object.entries(all)) {
    const owner = getSetupOwner(guildData, channelId);
    if (owner) return { guildId, userId: owner };
  }
  return null;
}

function getUserChannels(guildId) {
  const all = jsonCache.readJSONObject(userChannelsPath);
  return all[guildId] || {};
}

function setUserChannels(guildId, data) {
  const all = jsonCache.readJSONObject(userChannelsPath);
  all[guildId] = data;
  jsonCache.writeJSON(userChannelsPath, all);
}

function findUserChannelAcrossGuilds(channelId) {
  const all = jsonCache.readJSONObject(userChannelsPath);
  for (const [guildId, guildData] of Object.entries(all)) {
    for (const [uid, chId] of Object.entries(guildData)) {
      if (chId === channelId) return { guildId, userId: uid };
    }
  }
  return null;
}

function getUserTickets(guildId) {
  const all = jsonCache.readJSONObject(userTicketsPath);
  return all[guildId] || {};
}

function setUserTickets(guildId, data) {
  const all = jsonCache.readJSONObject(userTicketsPath);
  all[guildId] = data;
  jsonCache.writeJSON(userTicketsPath, all);
}

function findUserTicketAcrossGuilds(channelId) {
  const all = jsonCache.readJSONObject(userTicketsPath);
  for (const [guildId, guildData] of Object.entries(all)) {
    for (const [uid, chId] of Object.entries(guildData)) {
      if (chId === channelId) return { guildId, userId: uid };
    }
  }
  return null;
}

function getAllSetupChannelsFlat() {
  const all = jsonCache.readJSONObject(setupChannelsPath);
  const flat = {};
  for (const [, guildData] of Object.entries(all)) {
    for (const [uid, chs] of Object.entries(guildData)) {
      flat[uid] = chs;
    }
  }
  return flat;
}

function getAllUserChannelsFlat() {
  const all = jsonCache.readJSONObject(userChannelsPath);
  const flat = {};
  for (const [, guildData] of Object.entries(all)) {
    for (const [uid, chId] of Object.entries(guildData)) {
      flat[uid] = chId;
    }
  }
  return flat;
}

function getAllUserTicketsFlat() {
  const all = jsonCache.readJSONObject(userTicketsPath);
  const flat = {};
  for (const [, guildData] of Object.entries(all)) {
    for (const [uid, chId] of Object.entries(guildData)) {
      flat[uid] = chId;
    }
  }
  return flat;
}

module.exports = {
  getSetupChannels, setSetupChannels, getSetupOwner, findSetupOwnerAcrossGuilds,
  getUserChannels, setUserChannels, findUserChannelAcrossGuilds,
  getUserTickets, setUserTickets, findUserTicketAcrossGuilds,
  getAllSetupChannelsFlat, getAllUserChannelsFlat, getAllUserTicketsFlat,
};
