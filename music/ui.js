const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

function fmt(sec) {
  if (!sec || sec <= 0) return '?';
  return `${Math.floor(sec / 60)}:${(sec % 60).toString().padStart(2, '0')}`;
}

function ctrls(e) {
  const p = e.player.state.status === 'paused';
  return [
    new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('music_add_url').setLabel('🎵 Nhập URL').setStyle(ButtonStyle.Primary)),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('music_playpause').setLabel(p ? '▶️ Play' : '⏸ Pause').setStyle(p ? ButtonStyle.Success : ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('music_stop').setLabel('⏹ Stop').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId('music_loop').setLabel('🔁 Loop').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('music_volume').setLabel('🔊 Volume').setStyle(ButtonStyle.Secondary)
    ),
  ];
}

async function ui(e) {
  if (!e.ui) return;
  try {
    const item = e.queue[e.i];
    const desc = item?.info
      ? `🎶 **${item.info.title}**\n📺 ${item.info.channel} | ⏱ ${fmt(item.info.duration)}\n🔗 ${item.info.url}`
      : 'Nhấn **🎵 Nhập URL** để nhập link hoặc dùng nút điều khiển.';
    await e.ui.edit({ embeds: [new EmbedBuilder().setTitle('🎵 MUSIC PLAYER').setDescription(desc).setColor(0x5865F2).setFooter({ text: `Queue: ${e.queue.length} bài` })], components: ctrls(e) });
  } catch {}
}

async function sendMusicUI(message) {
  const { getPlayer } = require('./player');
  const e = getPlayer(message.guild.id); e.tc = message.channel;
  const item = e.queue[e.i];
  const desc = item?.info
    ? `🎶 **${item.info.title}**\n📺 ${item.info.channel} | ⏱ ${fmt(item.info.duration)}\n🔗 ${item.info.url}`
    : 'Nhấn **🎵 Nhập URL** để nhập link hoặc dùng nút điều khiển.';
  const sent = await message.reply({ embeds: [new EmbedBuilder().setTitle('🎵 MUSIC PLAYER').setDescription(desc).setColor(0x5865F2).setFooter({ text: `Queue: ${e.queue.length} bài` })], components: ctrls(e) });
  e.ui = sent;
}

module.exports = { ctrls, ui, sendMusicUI, fmt };
