const jsonCache = require('./jsonCache');
const dataHelper = require('./dataHelper');

const gameChannelsPath = jsonCache.getPath('gameChannels.json');

function isGameChannel(channelId) {
  const gameChannels = jsonCache.readJSONObject(gameChannelsPath);
  if (gameChannels[channelId]) return true;
  const found = dataHelper.findSetupOwnerAcrossGuilds(channelId);
  return found !== null;
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
