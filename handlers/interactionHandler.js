const { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder, EmbedBuilder } = require('discord.js');
const configHelper = require('../configHelper');
const commands = require('../commands');
const buttonHandler = require('./buttonHandler');

function checkCooldown(userId, cmdName, cooldowns) {
  const key = `${userId}_${cmdName}`;
  const now = Date.now();
  if (cooldowns.size > 500) {
    for (const [k, v] of cooldowns) if (v < now) cooldowns.delete(k);
  }
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

      if (interaction.commandName !== 'help' && !configHelper.isOwner(interaction.user.id)) {
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
      await buttonHandler.handleButton(interaction, interaction.client);
      if (!interaction.replied && !interaction.deferred && !interaction.customId.startsWith('dmhis_')) {
        console.warn(`[Button] Khong co handler cho customId: ${interaction.customId}`);
        await interaction.deferUpdate().catch(e => console.error('[Button] deferUpdate that bai:', e.message));
      }
    }
    else if (interaction.isModalSubmit()) {
      await buttonHandler.handleModal(interaction, interaction.client);
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

module.exports = { handleInteractionCreate };
