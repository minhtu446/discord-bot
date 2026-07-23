const { AttachmentBuilder } = require('discord.js');
const path = require('path');
const jsonCache = require('./jsonCache');

const gameChannelsPath = jsonCache.getPath('gameChannels.json');
const setupChannelsPath = jsonCache.getPath('setupChannels.json');

function isGameChannel(channelId) {
  const gameChannels = jsonCache.readJSONObject(gameChannelsPath);
  if (gameChannels[channelId]) return true;
  const setupChannels = jsonCache.readJSONObject(setupChannelsPath);
  for (const chs of Object.values(setupChannels)) {
    if (chs.chat === channelId) return true;
  }
  return false;
}

const REPLIES = {
  'ping': 'pong',
  '6': '67',
  '3': '36',
  '36': 'thanh hóa',
  '67': 'sixseven',
};

function handleMessage(message) {
  if (message.author.bot) return false;
  if (!isGameChannel(message.channel.id)) return false;

  const content = message.content.toLowerCase().trim();

  const reply = REPLIES[content];
  if (reply) {
    message.reply(reply).catch(() => {});
    return true;
  }

  return false;
}

module.exports = { handleMessage };
