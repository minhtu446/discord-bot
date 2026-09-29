const config = require('../config');
const jsonCache = require('../jsonCache');
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

  if (!message.guild) {
    const dmRelay = require('./dmRelay');
    const relayTarget = await dmRelay.getRelayTarget(message.client, message.author.id);
    if (relayTarget) {
      if (message.channel.partial) await message.channel.fetch().catch(() => {});
      const content = `[${message.author.tag}]: ${message.content || ''}`;
      const files = [];
      for (const [, att] of message.attachments) {
        if (!att.contentType || !att.contentType.startsWith('image/')) continue;
        try {
          const res = await fetch(att.url).catch(() => null);
          if (!res) continue;
          const arrBuf = await res.arrayBuffer().catch(() => null);
          if (!arrBuf) continue;
          const name = att.name || `image_${Date.now()}.png`;
          files.push(new AttachmentBuilder(Buffer.from(arrBuf), { name }));
        } catch {}
      }
      try {
        if (files.length > 0) {
          await relayTarget.channel.send({ content, files });
        } else if (message.content) {
          await relayTarget.channel.send(content);
        }
      } catch (e) {
        console.error('Forward failed:', e.message);
      }
    }

    return;
  }

  const wordFilter = require('../automod/wordFilter');
  if (s.antibad !== false && wordFilter.checkContent(message.content, false, guildId)) {
    console.log(`[AntiBad] Deleted text from ${message.author.tag}:`, JSON.stringify(message.content));
    await message.delete().catch(() => {});
    return;
  }

  if (s.antibad !== false && message.attachments.size > 0) {
    const imageFilter = require('../automod/imageFilter');
    for (const [, att] of message.attachments) {
      if (att.contentType && att.contentType.startsWith('image/')) {
        try {
          if (await imageFilter.checkBufferImage(att.url, guildId, att.contentType, message.client)) {
            console.log(`[AntiBad] Deleted image from ${message.author.tag}:`, att.url);
            await message.delete().catch(e => console.error(`[AntiBad] Delete failed: ${e.message}`));
            return;
          }
        } catch {}
      }
    }
  }

  const autoDelete = readAutoDelete();
  if (autoDelete.includes(message.author.id)) {
    await message.delete().catch(() => {});
    return;
  }
  } catch (e) {
    console.error('[handleMessageCreate] ERROR:', e);
  }
}

async function handleMessageUpdate(oldMessage, newMessage) {
  try {
    if (newMessage.author?.bot) return;
    if (!newMessage.guild) return;

    const settingsHelper = require('../settingsHelper');
    const s = settingsHelper.getSettings(newMessage.guild.id);

    if (s.antibad !== false && newMessage.content) {
      const wordFilter = require('../automod/wordFilter');
      if (wordFilter.checkContent(newMessage.content, false, newMessage.guildId)) {
        console.log(`[AntiBad] Deleted edited text from ${newMessage.author.tag}:`, JSON.stringify(newMessage.content));
        await newMessage.delete().catch(() => {});
        return;
      }
    }

    if (s.antibad !== false && newMessage.attachments?.size > 0) {
      const imageFilter = require('../automod/imageFilter');
      for (const [, att] of newMessage.attachments) {
        if (att.contentType && att.contentType.startsWith('image/')) {
          try {
            if (await imageFilter.checkBufferImage(att.url, newMessage.guildId, att.contentType, newMessage.client)) {
              console.log(`[AntiBad] Deleted edited image from ${newMessage.author.tag}:`, att.url);
              await newMessage.delete().catch(() => {});
              return;
            }
          } catch {}
        }
      }
    }
  } catch (e) {
    console.error('[handleMessageUpdate] ERROR:', e);
  }
}

module.exports = { handleMessageCreate, handleMessageUpdate };
