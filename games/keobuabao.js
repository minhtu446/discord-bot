const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

const choices = ['kéo', 'búa', 'bao'];
const rpsEmoji = { 'kéo': '✂️', 'búa': '🪨', 'bao': '📄' };
const winMap = { 'kéo': 'bao', 'búa': 'kéo', 'bao': 'búa' };

function determineWinner(player, bot) {
  if (player === bot) return 'draw';
  if (winMap[player] === bot) return 'player';
  return 'bot';
}

function botChoice() {
  return choices[Math.floor(Math.random() * 3)];
}

async function play(message) {
  const player = message.content.toLowerCase().trim();
  if (!choices.includes(player)) return null;

  const bot = botChoice();
  const result = determineWinner(player, bot);
  const username = message.member?.displayName || message.author.username;

  let resultText, color;
  if (result === 'draw') {
    resultText = '➡ Hòa!';
    color = 0xFFA500;
  } else if (result === 'player') {
    resultText = 'Bot thua, người chơi thắng';
    color = 0x00FF00;
  } else {
    resultText = 'Bot thắng, người chơi thua';
    color = 0xFF0000;
  }

  const embed = new EmbedBuilder()
    .setTitle(`**GAME oẳn tù tì** 🎮📄🪨✂️`)
    .setDescription(
      `Tên người chơi: **${username}**\n` +
      `Bot chọn : **${bot}** ${rpsEmoji[bot]}\n` +
      `Người chơi chọn: **${player}** ${rpsEmoji[player]}\n\n` +
      `➡ **${resultText}**`
    )
    .setColor(color);

  await message.reply({ embeds: [embed] });
  return true;
}

module.exports = { play };
