const config = require('../config');
const jsonCache = require('../jsonCache');
const { AttachmentBuilder, EmbedBuilder } = require('discord.js');

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

  const raw = String(message.content || '').trim();
  if (/^!rank(?:\s|$)/i.test(raw)) {
    try {
      const parts = raw.split(/\s+/).slice(1);
      let target = message.author;
      if (parts[0]) {
        const m = parts[0].match(/^<@!?(\d{15,20})>$/) || parts[0].match(/^(\d{15,20})$/);
        if (m) target = await message.client.users.fetch(m[1]).catch(() => message.author);
      }
      const member = message.guild.members.cache.get(target.id) || await message.guild.members.fetch(target.id).catch(() => null);
      const level = require('../features/level');
      const cfg = level.getConfig(guildId);
      const info = level.getUser(guildId, target.id);
      const rankPos = level.getRank(guildId, target.id);
      const mode = ['ui', 'image', 'both'].includes(cfg.rankDisplay) ? cfg.rankDisplay : 'ui';

      const makeEmbed = () => {
        const barLen = 20;
        const filled = Math.max(0, Math.min(barLen, Math.round((info.currentXp / Math.max(1, info.needed)) * barLen)));
        const bar = '█'.repeat(filled) + '░'.repeat(barLen - filled);
        return new EmbedBuilder()
          .setTitle(`📈 Xếp hạng của ${target.username}`)
          .setThumbnail(target.displayAvatarURL({ size: 256 }))
          .setColor(member?.displayHexColor && member.displayHexColor !== '#000000' ? member.displayHexColor : 0x5865F2)
          .addFields(
            { name: 'Hạng', value: rankPos ? `#${rankPos}` : 'Chưa có', inline: true },
            { name: 'Level', value: `${info.level}`, inline: true },
            { name: 'Tổng XP', value: `${info.totalXp}`, inline: true },
            { name: 'Tiến độ', value: `\`${bar}\`\n${info.currentXp}/${info.needed} XP (còn ${Math.max(0, info.needed - info.currentXp)} XP)`, inline: false },
          );
      };

      if (mode === 'ui') {
        await message.reply({ embeds: [makeEmbed()], allowedMentions: { repliedUser: false } }).catch(() => {});
      } else {
        const { generateRankCard } = require('../features/rankCard');
        const buf = await generateRankCard({ user: target, member, rank: rankPos, level: info.level, currentXp: info.currentXp, needed: info.needed, totalXp: info.totalXp, cfg });
        const file = new AttachmentBuilder(buf, { name: 'rank.png' });
        const payload = { files: [file], allowedMentions: { repliedUser: false } };
        if (mode === 'both') payload.embeds = [makeEmbed().setImage('attachment://rank.png').setThumbnail(null)];
        await message.reply(payload).catch(() => {});
      }
    } catch (e) {
      console.error('[!rank] error:', e.message);
      await message.reply({ content: '❌ Không thể hiển thị rank lúc này.', allowedMentions: { repliedUser: false } }).catch(() => {});
    }
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

  try {
    const level = require('../features/level');
    const res = level.addMessageXp(message);
    if (res?.leveledUp) {
      const cfg = res.cfg;
      const msg = String(cfg.message || '🎉 {user} đã lên **level {level}**!')
        .replace(/\{user\}/g, `<@${message.author.id}>`)
        .replace(/\{level\}/g, String(res.newLevel))
        .replace(/\{xp\}/g, String(res.totalXp));
      const target = cfg.channelId ? (message.guild.channels.cache.get(cfg.channelId) || message.channel) : message.channel;
      if (target?.isTextBased?.()) target.send({ content: msg, allowedMentions: { users: [message.author.id] } }).catch(() => {});
    }
  } catch (e) {
    console.error('[level] xp error:', e.message);
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
