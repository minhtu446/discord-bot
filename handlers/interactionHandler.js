const { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder, EmbedBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const configHelper = require('../configHelper');
const commands = require('../commands');
const gameplay = require('../gameplay');

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

      if (command.slow && !interaction.replied && !interaction.deferred) {
        await interaction.deferReply({ flags: 64 }).catch(() => {});
      }

      await command.execute(interaction, interaction.client);
    }
    else if (interaction.isButton()) {
      if (interaction.customId.startsWith('config_edit_')) {
        await handleConfigEditButton(interaction);
        return;
      }
      await gameplay.handleButton(interaction, interaction.client);
      if (!interaction.replied && !interaction.deferred) {
        await interaction.deferUpdate().catch(() => {});
      }
    }
    else if (interaction.isModalSubmit()) {
      if (interaction.customId.startsWith('config_modal_')) {
        await handleConfigModal(interaction);
        return;
      }
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
      await interaction.reply(      { content: '❌ Bot vừa khởi động lại, hãy thao tác lại!', flags: 64 }).catch(() => {});
    }
  }
}

const CONFIG_LABELS = {
  welcomeChannelId: '📱 Welcome Channel',
  logChannelId: '📋 Log Channel',
  ticketCategoryId: '🎫 Ticket Category',
  memberRoleId: '👤 Member Role',
  setupCategoryId: '📁 Setup Category',
  dmRelayChannelId: '📩 DM Relay Channel',
};

async function handleConfigEditButton(interaction) {
  if (!configHelper.isOwner(interaction.user.id)) {
    return interaction.reply({ content: '❌ Bạn không có quyền!', flags: 64 });
  }
  const field = interaction.customId.replace('config_edit_', '');
  const guildId = interaction.guildId;
  const current = configHelper.getConfig(guildId, field) || '';

  const modal = new ModalBuilder()
    .setCustomId(`config_modal_${field}`)
    .setTitle(`Đổi ${CONFIG_LABELS[field] || field}`);
  const input = new TextInputBuilder()
    .setCustomId('new_value')
    .setLabel(`Nhập ID mới cho ${field}`)
    .setStyle(TextInputStyle.Short)
    .setValue(current)
    .setPlaceholder('Nhập channel ID hoặc role ID...')
    .setRequired(true);
  modal.addComponents(new ActionRowBuilder().addComponents(input));
  await interaction.showModal(modal);
}

async function handleConfigModal(interaction) {
  if (!configHelper.isOwner(interaction.user.id)) {
    return interaction.reply({ content: '❌ Bạn không có quyền!', flags: 64 });
  }
  const field = interaction.customId.replace('config_modal_', '');
  const newValue = interaction.fields.getTextInputValue('new_value').trim();
  const guildId = interaction.guildId;

  configHelper.setGuildField(guildId, field, newValue);

  const embed = new EmbedBuilder()
    .setTitle('⚙️ Cấu hình Server')
    .setColor(0x5865F2);

  let desc = '';
  for (const key of Object.keys(CONFIG_LABELS)) {
    const val = key === field ? newValue : (configHelper.getConfig(guildId, key) || '❌ Chưa set');
    desc += `**${CONFIG_LABELS[key]}:** \`${val}\`${key === field ? ' ⚡' : ''}\n`;
  }
  embed.setDescription(desc).setFooter({ text: `Guild: ${guildId} — Đã cập nhật ${field}` });

  const row1 = new ActionRowBuilder();
  const row2 = new ActionRowBuilder();
  let i = 0;
  for (const key of Object.keys(CONFIG_LABELS)) {
    const val = key === field ? newValue : (configHelper.getConfig(guildId, key) || null);
    const btn = new ButtonBuilder()
      .setCustomId(`config_edit_${key}`)
      .setLabel(CONFIG_LABELS[key])
      .setStyle(val ? ButtonStyle.Success : ButtonStyle.Secondary);
    if (i < 3) row1.addComponents(btn); else row2.addComponents(btn);
    i++;
  }

  await interaction.reply({ content: `✅ Đã cập nhật \`${field}\` = \`${newValue}\``, embeds: [embed], components: [row1, row2], flags: 64 });
}

module.exports = { handleInteractionCreate };
