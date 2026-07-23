const config = require('../config');
const gameplay = require('../gameplay');
const replyHandler = require('../replyHandler');
const jsonCache = require('../jsonCache');
const configHelper = require('../configHelper');
const path = require('path');
const { AttachmentBuilder } = require('discord.js');

const autoDeletePath = jsonCache.getPath('autoDeleteUsers.json');
const processedMessages = new Map();

function readAutoDelete() {
  return jsonCache.readJSONArray(autoDeletePath);
}

function cleanupProcessed() {
  if (processedMessages.size <= 500) return;
  const cutoff = Date.now() - 30000;
  for (const [id, ts] of processedMessages) {
    if (ts < cutoff) processedMessages.delete(id);
  }
}

async function handleMessageCreate(message) {
  try {
  if (message.author.bot) {
    const autoDelete = readAutoDelete();
    if (autoDelete.includes(message.author.id)) {
      await message.delete().catch(() => {});
    }
    return;
  }

  const now = Date.now();
  if (processedMessages.has(message.id)) return;
  processedMessages.set(message.id, now);
  cleanupProcessed();

  const settingsHelper = require('../settingsHelper');
  const guildId = message.guild?.id || config.guildId;
  const s = settingsHelper.getSettings(guildId);

  const wordFilter = require('../automod/wordFilter');
  if (wordFilter.checkContent(message.content)) {
    console.log(`[AntiBad] Deleted text from ${message.author.tag}:`, JSON.stringify(message.content));
    await message.delete().catch(() => {});
    return;
  }

  if (message.attachments.size > 0) {
    const imageFilter = require('../automod/imageFilter');
    for (const [, att] of message.attachments) {
      if (att.contentType && att.contentType.startsWith('image/')) {
        try {
          const res = await fetch(att.url).catch(() => null);
          if (!res) continue;
          const arrBuf = await res.arrayBuffer().catch(() => null);
          if (!arrBuf) continue;
          const buffer = Buffer.from(arrBuf);
          if (buffer && await imageFilter.checkBufferImage(buffer)) {
            console.log(`[AntiBad] Deleted image from ${message.author.tag}:`, att.url);
            await message.delete().catch(e => console.error(`[AntiBad] Delete failed: ${e.message}`));
            return;
          }
        } catch {}
      }
    }
  }

  if (!message.guild) {
    if (!s.dmRelay) return;
    if (message.channel.partial) await message.channel.fetch().catch(() => {});
    const configHelper = require('../configHelper');
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

  const autoDelete = readAutoDelete();
  if (autoDelete.includes(message.author.id)) {
    await message.delete().catch(() => {});
    return;
  }

  const isOwner = configHelper.isOwner(message.author.id);

  const lower = message.content.trim().toLowerCase();
  if (lower === 'bestmemeoftheyear') {
    const img = new AttachmentBuilder(path.join(__dirname, '..', 'assets', 'bestmeme.png'));
    await message.reply({ files: [img] }).catch(() => {});
  }

  if (s.music !== false && lower === 'playmusic') {
    if (!isOwner) { await message.reply({ content: '❌ Bạn không có quyền dùng lệnh này!' }).catch(() => {}); return; }
    const voiceChannel = message.member.voice.channel;
    if (!voiceChannel) {
      await message.reply({ content: '❌ Bạn phải ở trong kênh voice để dùng PLAYMUSIC!' }).catch(() => {});
      return;
    }
    await music.sendMusicUI(message);
    setTimeout(() => message.delete().catch(() => {}), 500);
    return;
  }

  if (s.ttt !== false && lower === 'playcaro') {
    if (!isOwner) { await message.reply({ content: '❌ Bạn không có quyền dùng lệnh này!' }).catch(() => {}); return; }
    const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('caro_play').setLabel('🎮 Mở Caro').setStyle(ButtonStyle.Primary),
    );
    const botMsg = await message.channel.send({ content: `👋 ${message.author}, bấm nút bên dưới để chơi Caro:`, components: [row] });
    setTimeout(() => botMsg.delete().catch(() => {}), 30000);
    return;
  }

  if (replyHandler.handleMessage(message)) return;

  if (s.rps !== false) {
    const gameResult = await gameplay.handleRPS(message.client, message);
    if (gameResult) return;
  }
  } catch (e) {
    console.error('[handleMessageCreate] ERROR:', e);
  }
}

async function handleMessageUpdate(oldMessage, newMessage) {
  return;
}

module.exports = { handleMessageCreate, handleMessageUpdate };
