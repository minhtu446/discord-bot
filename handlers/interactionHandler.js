const { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder, EmbedBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const configHelper = require('../configHelper');
const commands = require('../commands');
const gameplay = require('../gameplay');
const settingsHelper = require('../settingsHelper');

function checkCooldown(userId, cmdName, cooldowns) {
  const key = `${userId}_${cmdName}`;
  const now = Date.now();
  const cooldown = cooldowns.get(key);
  if (cooldown && now < cooldown) return Math.ceil((cooldown - now) / 1000);
  cooldowns.set(key, now + 2 * 1000);
  return 0;
}

async function handleInteractionCreate(interaction) {
  try {
    if (interaction.isChatInputCommand()) {
      const command = commands[interaction.commandName];
      if (!command) return;

      if (!configHelper.isOwner(interaction.user.id)) {
        return interaction.reply({ content: '❌ Bạn không có quyền dùng lệnh này!', flags: 64 });
      }



      const cooldown = checkCooldown(interaction.user.id, interaction.commandName, interaction.client.cooldowns);
      if (cooldown > 0) {
        return interaction.reply({ content: `⏳ Vui lòng đợi ${cooldown}s trước khi dùng lại lệnh này!`, flags: 64 });
      }

      await command.execute(interaction, interaction.client);
    }
    else if (interaction.isButton()) {
      if (interaction.customId.startsWith('setting_')) {
        await handleSettingButton(interaction);
        return;
      }
      await gameplay.handleButton(interaction, interaction.client);
    }
    else if (interaction.isModalSubmit()) {
      await gameplay.handleModal(interaction, interaction.client);
    }
  } catch (e) {
    if (e.code === 10062 || e.code === 10003) return;
    const wait = e.data?.retry_after || e.retry_after;
    if (wait) {
      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({ content: `⚠️ Đang bị rate limit, thử lại sau ${Math.ceil(wait)}s...`, flags: 64 }).catch(() => {});
      }
      return;
    }
    console.error('Lỗi interaction:', e);
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({ content: '❌ Đã xảy ra lỗi!', flags: 64 }).catch(() => {});
    }
  }
}

async function handleSettingButton(interaction) {
  const key = interaction.customId.replace('setting_', '');
  const s = settingsHelper.getSettings(interaction.guildId);
  const labels = settingsHelper.SETTING_LABELS;
  const newVal = !s[key];
  settingsHelper.setSetting(interaction.guildId, key, newVal);

  const updated = settingsHelper.getSettings(interaction.guildId);
  const embed = new EmbedBuilder()
    .setTitle('⚙️ Cài đặt tính năng')
    .setColor(0x5865F2)
    .setDescription('Bật/tắt các tính năng của bot cho server này.')
    .addFields(
      Object.keys(labels).map(k => ({
        name: labels[k],
        value: updated[k] ? '✅ **Bật**' : '❌ **Tắt**',
        inline: true,
      }))
    );

  const keys = Object.keys(labels);
  const rows = [];
  for (let i = 0; i < keys.length; i += 5) {
    rows.push(new ActionRowBuilder().addComponents(
      keys.slice(i, i + 5).map(k => new ButtonBuilder()
        .setCustomId('setting_' + k)
        .setLabel(labels[k].substring(0, 20))
        .setStyle(updated[k] ? ButtonStyle.Success : ButtonStyle.Danger))
    ));
  }

  await interaction.update({ embeds: [embed], components: rows });
}

module.exports = { handleInteractionCreate };
