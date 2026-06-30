const config = require('../config');
const wordFilter = require('../automod/wordFilter');
const imageFilter = require('../automod/imageFilter');
const antiSpam = require('../automod/antiSpam');
const music = require('../music');
const gameplay = require('../gameplay');
const replyHandler = require('../replyHandler');
const jsonCache = require('../jsonCache');

const autoDeletePath = jsonCache.getPath('autoDeleteUsers.json');

function readAutoDelete() {
  return jsonCache.readJSONArray(autoDeletePath);
}

async function handleMessageCreate(message) {
  if (message.author.bot) {
    const autoDelete = readAutoDelete();
    if (autoDelete.includes(message.author.id)) {
      await message.delete().catch(() => {});
    }
    return;
  }

  const configHelper = require('../configHelper');
  const settingsHelper = require('../settingsHelper');
  const guildId = message.guild?.id || config.guildId;
  const s = settingsHelper.getSettings(guildId);

  if (!message.guild) {
    if (!s.dmRelay) return;
    if (message.channel.partial) await message.channel.fetch().catch(() => {});
    const relayChannelId = configHelper.getConfig(config.guildId, 'dmRelayChannelId') || '1513050183754318007';
    const channel = message.client.channels.cache.get(relayChannelId);
    if (channel) {
      const files = message.attachments.map(a => a.url);
      const content = `[${message.author.tag}]: ${message.content || ''}`;
      try {
        if (files.length > 0) {
          await channel.send({ content, files });
        } else {
          await channel.send(content);
        }
      } catch (e) {
        console.error('Forward failed:', e.message);
      }
    }
    return;
  }

  if (!configHelper.isOwner(message.author.id) && s.antiSpam !== false && antiSpam.checkRateLimit(message.author.id)) {
    try {
      await message.member.timeout(10_000, 'Spam').catch(() => {});
    } catch {}
    await message.delete().catch(() => {});
    return;
  }

  const autoDelete = readAutoDelete();
  if (autoDelete.includes(message.author.id)) {
    await message.delete().catch(() => {});
    return;
  }

  if (s.music !== false && message.content.trim().toUpperCase() === 'PLAYMUSIC') {
    const voiceChannel = message.member.voice.channel;
    if (!voiceChannel) {
      await message.reply({ content: '❌ Bạn phải ở trong kênh voice để dùng PLAYMUSIC!' }).catch(() => {});
      return;
    }
    await music.sendMusicUI(message);
    return;
  }

  if (replyHandler.handleMessage(message)) return;

  if (s.rps !== false) {
    const gameResult = await gameplay.handleRPS(message.client, message);
    if (gameResult) return;
  }

  if (s.wordFilter !== false) {
    const banned = await wordFilter.check(message);
    if (banned) {
      const count = antiSpam.addViolation(message.author.id);
      await message.delete().catch(() => {});
      await message.author.send('⚠️ Tin nhắn của bạn đã bị xóa do chứa nội dung không phù hợp!').catch(() => {});
      if (s.violationBan !== false && count >= 5) {
        await message.member.ban({ reason: 'Tự động cấm: vi phạm nội dung quá nhiều lần' }).catch(() => {});
      }
      return;
    }
  }

  if (message.attachments.size > 0) {
    const imgBanned = await imageFilter.check(message, s);
    if (imgBanned) {
      const count = antiSpam.addViolation(message.author.id);
      await message.delete().catch(() => {});
      await message.author.send('⚠️ Tệp của bạn đã bị xóa do vi phạm!').catch(() => {});
      if (s.violationBan !== false && count >= 5) {
        await message.member.ban({ reason: 'Tự động cấm: vi phạm nội dung quá nhiều lần' }).catch(() => {});
      }
      return;
    }
  }

  if (s.antiSpam !== false) {
    const fallback = await antiSpam.check(message, null);
    if (fallback.action === 'delete') {
      await message.delete().catch(() => {});
      await message.author.send(`⚠️ Tin nhắn đã bị xóa! (${fallback.reason})`).catch(() => {});
    }
  }
}

async function handleMessageUpdate(oldMessage, newMessage) {
  if (newMessage.author?.bot || !newMessage.guild) return;
  const s = newMessage.guild ? require('../settingsHelper').getSettings(newMessage.guild.id) : {};
  if (s.wordFilter === false) return;
  const banned = await wordFilter.check(newMessage);
  if (banned) {
    await newMessage.delete().catch(() => {});
    await newMessage.author.send('⚠️ Tin nhắn đã sửa của bạn bị xóa do chứa nội dung không phù hợp!').catch(() => {});
  }
}

module.exports = { handleMessageCreate, handleMessageUpdate };
