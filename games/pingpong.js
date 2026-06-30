const { EmbedBuilder } = require('discord.js');

async function start(interaction) {
  const embed = new EmbedBuilder()
    .setTitle('🏓 Ping Pong')
    .setDescription(
      'Gõ tin nhắn để bot trả lời:\n\n' +
      '`ping` → pong\n' +
      '`6` → 67\n' +
      '`3` → 36\n' +
      '`36` → thanh hóa\n' +
      '`67` → sixseven\n' +
      '`sixseven` / `sixsenven` → 🖼️ ảnh meme\n\n' +
      '*Chơi ngay trong chat!*'
    )
    .setColor(0x00FF00);

  await interaction.reply({ embeds: [embed] });
}

module.exports = { start };
