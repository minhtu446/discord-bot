const { ChannelType, PermissionsBitField, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const configHelper = require('../configHelper');
const dataHelper = require('../dataHelper');

function getSetupOwner(setupChannels, channelId) {
  return dataHelper.getSetupOwner(setupChannels, channelId);
}

function isChannelLocked(channel) {
  const everyoneId = channel.guild.roles.everyone.id;
  const overwrite = channel.permissionOverwrites.cache.get(everyoneId);
  return !!overwrite && overwrite.deny.has(PermissionsBitField.Flags.ViewChannel);
}

function buildManageRows(channelId, isLocked) {
  const manageRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`setup_rename_channel_${channelId}`).setLabel('✏️ Đổi tên').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`setup_add_user_${channelId}`).setLabel('➕ Thêm người').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`setup_kick_user_${channelId}`).setLabel('👢 Đuổi').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(`setup_delete_channel_${channelId}`).setLabel('🗑️ Xóa kênh').setStyle(ButtonStyle.Danger)
  );

  const lockButton = isLocked
    ? new ButtonBuilder().setCustomId(`setup_toggle_lock_${channelId}`).setLabel('🔓 Mở khoá').setStyle(ButtonStyle.Success)
    : new ButtonBuilder().setCustomId(`setup_toggle_lock_${channelId}`).setLabel('🔒 Khoá kênh').setStyle(ButtonStyle.Primary);

  const lockRow = new ActionRowBuilder().addComponents(lockButton);

  return [manageRow, lockRow];
}

async function handleCreateVoiceChannel(interaction, userId) {
  await interaction.deferReply({ flags: 64 });

  try {
    const guildId = interaction.guild.id;
    const setupChannels = dataHelper.getSetupChannels(guildId);
    const existingId = setupChannels[userId]?.voice;
    if (existingId) {
      const existingChannel = interaction.guild.channels.cache.get(existingId);
      if (existingChannel) {
        return interaction.editReply({ content: `❌ Bạn đã có kênh voice rồi: ${existingChannel}` });
      }
      setupChannels[userId].voice = null;
      dataHelper.setSetupChannels(guildId, setupChannels);
    }

    const category = interaction.guild.channels.cache.get(configHelper.getConfig(interaction.guild.id, 'setupCategoryId'));
    if (!category || category.type !== ChannelType.GuildCategory) {
      return interaction.editReply({ content: '❌ Không tìm thấy danh mục!' });
    }

    const channel = await interaction.guild.channels.create({
      name: `voice-${interaction.user.username}`,
      type: ChannelType.GuildVoice,
      parent: category.id,
      permissionOverwrites: [
        { id: interaction.guild.roles.everyone, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.Connect, PermissionsBitField.Flags.Speak] },
        { id: userId, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.Connect, PermissionsBitField.Flags.Speak] },
        { id: interaction.client.user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.Connect, PermissionsBitField.Flags.Speak] },
      ],
    });

    if (!setupChannels[userId]) setupChannels[userId] = { voice: null };
    setupChannels[userId].voice = channel.id;
    dataHelper.setSetupChannels(guildId, setupChannels);

    await channel.send({ content: `${interaction.user}`, components: buildManageRows(channel.id, false) });
    await interaction.editReply({ content: `✅ Đã tạo kênh voice: ${channel}` });
  } catch (e) {
    console.error('Lỗi tạo kênh voice:', e);
    await interaction.editReply({ content: '❌ Lỗi tạo kênh!' });
  }
}

async function handleButton(interaction, client) {
  const userId = interaction.user.id;
  const customId = interaction.customId;
  const settingsHelper = require('../settingsHelper');
  const s = settingsHelper.getSettings(interaction.guild?.id);

  if (customId === 'create_ticket' && s.ticket === false) {
    return interaction.reply({ content: '❌ Tính năng ticket đã bị tắt!', flags: 64 });
  }

  if (customId === 'create_voice_channel') {
    return handleCreateVoiceChannel(interaction, userId);
  }

  if (customId.startsWith('setup_rename_channel_')) {
    const channelId = customId.slice('setup_rename_channel_'.length);
    const setupChannels = dataHelper.getSetupChannels(interaction.guild.id);
    const owner = getSetupOwner(setupChannels, channelId);
    if (owner !== userId) {
      return interaction.reply({ content: '❌ Chỉ người tạo kênh mới được đổi tên!', flags: 64 });
    }
    const channel = interaction.guild.channels.cache.get(channelId);
    if (!channel) {
      return interaction.reply({ content: '❌ Không tìm thấy kênh!', flags: 64 });
    }
    const modal = new ModalBuilder()
      .setCustomId(`setup_rename_modal_${channelId}`)
      .setTitle('Đổi tên kênh');
    const input = new TextInputBuilder()
      .setCustomId('new_name')
      .setLabel('Tên mới cho kênh')
      .setStyle(TextInputStyle.Short)
      .setValue(channel.name)
      .setRequired(true);
    modal.addComponents(new ActionRowBuilder().addComponents(input));
    await interaction.showModal(modal);
    return;
  }

  if (customId.startsWith('setup_add_user_')) {
    const channelId = customId.slice('setup_add_user_'.length);
    const setupChannels = dataHelper.getSetupChannels(interaction.guild.id);
    const owner = getSetupOwner(setupChannels, channelId);
    if (owner !== userId) {
      return interaction.reply({ content: '❌ Chỉ người tạo kênh mới được thêm người!', flags: 64 });
    }
    const modal = new ModalBuilder()
      .setCustomId(`setup_add_user_modal_${channelId}`)
      .setTitle('Thêm người vào kênh');
    const input = new TextInputBuilder()
      .setCustomId('user_id')
      .setLabel('ID người dùng')
      .setStyle(TextInputStyle.Short)
      .setRequired(true);
    modal.addComponents(new ActionRowBuilder().addComponents(input));
    await interaction.showModal(modal);
    return;
  }

  if (customId.startsWith('setup_kick_user_')) {
    const channelId = customId.slice('setup_kick_user_'.length);
    const setupChannels = dataHelper.getSetupChannels(interaction.guild.id);
    const owner = getSetupOwner(setupChannels, channelId);
    if (owner !== userId) {
      return interaction.reply({ content: '❌ Chỉ người tạo kênh mới được đuổi người!', flags: 64 });
    }
    const modal = new ModalBuilder()
      .setCustomId(`setup_kick_user_modal_${channelId}`)
      .setTitle('Đuổi người khỏi kênh');
    const input = new TextInputBuilder()
      .setCustomId('user_id')
      .setLabel('ID người dùng')
      .setStyle(TextInputStyle.Short)
      .setRequired(true);
    modal.addComponents(new ActionRowBuilder().addComponents(input));
    await interaction.showModal(modal);
    return;
  }

  if (customId.startsWith('setup_toggle_lock_')) {
    const channelId = customId.slice('setup_toggle_lock_'.length);
    const setupChannels = dataHelper.getSetupChannels(interaction.guild.id);
    const owner = getSetupOwner(setupChannels, channelId);
    if (owner !== userId) {
      return interaction.reply({ content: '❌ Chỉ người tạo kênh mới được thay đổi quyền kênh!', flags: 64 });
    }

    await interaction.deferReply({ flags: 64 });

    try {
      const channel = interaction.guild.channels.cache.get(channelId);
      if (!channel) {
        return interaction.editReply({ content: '❌ Không tìm thấy kênh!' });
      }

      const everyoneId = interaction.guild.roles.everyone.id;
      const wasLocked = isChannelLocked(channel);

      if (wasLocked) {
        await channel.permissionOverwrites.edit(
          everyoneId,
          { allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.Connect, PermissionsBitField.Flags.Speak] },
          { reason: `Mở khoá kênh bởi ${interaction.user.tag}` }
        );
        await interaction.message.edit({ components: buildManageRows(channelId, false) }).catch(() => {});
        await interaction.editReply({ content: '🔓 Đã **mở khoá** kênh! Mọi người đều có thể thấy và vào.' });
      } else {
        await channel.permissionOverwrites.edit(
          everyoneId,
          { deny: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.Connect] },
          { reason: `Khoá kênh bởi ${interaction.user.tag}` }
        );

        let removed = 0;
        for (const [memberId, member] of channel.members) {
          if (memberId === owner || memberId === client.user.id) continue;
          const overwrite = channel.permissionOverwrites.cache.get(memberId);
          if (overwrite && overwrite.allow.has(PermissionsBitField.Flags.ViewChannel)) continue;
          await member.voice.disconnect().catch(() => {});
          removed++;
        }

        await interaction.message.edit({ components: buildManageRows(channelId, true) }).catch(() => {});
        await interaction.editReply({
          content: '🔒 Đã **khoá** kênh! Người khác sẽ không thấy kênh này nữa.'
            + (removed > 0 ? `\n👢 Đã đuổi **${removed}** người đang ở trong kênh.` : ''),
        });
      }
    } catch (e) {
      console.error('Lỗi đổi quyền kênh:', e);
      await interaction.editReply({ content: '❌ Lỗi khi thay đổi quyền kênh! (bot cần quyền Manage Channels)' });
    }
    return;
  }

  if (customId.startsWith('setup_delete_channel_')) {
    const channelId = customId.slice('setup_delete_channel_'.length);
    const guildId = interaction.guild.id;
    const setupChannels = dataHelper.getSetupChannels(guildId);
    const owner = getSetupOwner(setupChannels, channelId);
    if (owner !== userId) {
      return interaction.reply({ content: '❌ Chỉ người tạo kênh mới được xóa!', flags: 64 });
    }

    if (owner) {
      if (setupChannels[owner].voice === channelId) setupChannels[owner].voice = null;
    }
    dataHelper.setSetupChannels(guildId, setupChannels);

    await interaction.reply({ content: '🗑️ Đã xóa kênh!', flags: 64 });

    const channel = interaction.guild.channels.cache.get(channelId);
    if (channel) {
      await channel.delete().catch(() => {});
    }
    return;
  }

  if (customId === 'create_ticket') {
    const guildId = interaction.guild.id;
    const userTickets = dataHelper.getUserTickets(guildId);
    if (userTickets[userId]) {
      const existing = interaction.guild.channels.cache.get(userTickets[userId]);
      if (existing) {
        return interaction.reply({ content: `❌ Bạn đã có ticket rồi: ${existing}`, flags: 64 });
      }
      delete userTickets[userId];
      dataHelper.setUserTickets(guildId, userTickets);
    }

    await interaction.deferReply({ flags: 64 });

    try {
      const category = interaction.guild.channels.cache.get(configHelper.getConfig(interaction.guild.id, 'ticketCategoryId'));
      const channel = await interaction.guild.channels.create({
        name: `ticket-${interaction.user.username}`,
        type: ChannelType.GuildText,
        parent: category ? category.id : undefined,
        permissionOverwrites: [
          { id: interaction.guild.roles.everyone, deny: [PermissionsBitField.Flags.ViewChannel] },
          { id: userId, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] },
          { id: client.user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] },
        ],
      });

      userTickets[userId] = channel.id;
      dataHelper.setUserTickets(guildId, userTickets);

      const closeRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`close_ticket_${channel.id}`).setLabel('🔒 Đóng ticket').setStyle(ButtonStyle.Danger)
      );

      await channel.send({ content: `${interaction.user} Chào mừng đến với ticket hỗ trợ!`, components: [closeRow] });
      await interaction.editReply({ content: `✅ Đã tạo ticket: ${channel}` });
    } catch (e) {
      console.error('Lỗi tạo ticket:', e);
      await interaction.editReply({ content: '❌ Lỗi tạo ticket!' });
    }
    return;
  }

  if (customId.startsWith('close_ticket_')) {
    const channelId = customId.slice('close_ticket_'.length);
    const guildId = interaction.guild.id;
    const userTickets = dataHelper.getUserTickets(guildId);
    for (const [uid, chId] of Object.entries(userTickets)) {
      if (chId === channelId) {
        delete userTickets[uid];
        dataHelper.setUserTickets(guildId, userTickets);
        break;
      }
    }
    await interaction.reply({ content: '✅ Đã đóng ticket!', flags: 64 }).catch(() => {});

    const channel = interaction.guild.channels.cache.get(channelId);
    if (channel) {
      await channel.delete().catch(() => {});
    }
    return;
  }

  if (customId.startsWith('dmhis_')) {
    return;
  }
}

async function handleModal(interaction) {
  const customId = interaction.customId;

  if (customId.startsWith('setup_rename_modal_')) {
    const channelId = customId.slice('setup_rename_modal_'.length);
    const newName = interaction.fields.getTextInputValue('new_name');
    await interaction.deferReply({ flags: 64 });

    try {
      const channel = interaction.guild.channels.cache.get(channelId);
      if (!channel) {
        return interaction.editReply({ content: '❌ Không tìm thấy kênh!' });
      }
      await channel.setName(newName);
      await interaction.editReply({ content: `✅ Đã đổi tên kênh thành **${newName}**!` });
    } catch (e) {
      console.error('Lỗi đổi tên:', e);
      await interaction.editReply({ content: '❌ Lỗi đổi tên kênh!' });
    }
    return;
  }

  if (customId.startsWith('setup_add_user_modal_')) {
    const channelId = customId.slice('setup_add_user_modal_'.length);
    const targetId = interaction.fields.getTextInputValue('user_id');
    await interaction.deferReply({ flags: 64 });

    try {
      const member = await interaction.guild.members.fetch(targetId);
      const channel = interaction.guild.channels.cache.get(channelId);
      if (!channel) {
        return interaction.editReply({ content: '❌ Không tìm thấy kênh!' });
      }

      const isVoice = channel.type === ChannelType.GuildVoice;
      await channel.permissionOverwrites.create(member.id, {
        ViewChannel: true,
        Connect: isVoice,
        Speak: isVoice,
      });

      await interaction.editReply({ content: `✅ Đã thêm ${member.user.tag} vào kênh!` });
    } catch (e) {
      console.error('Lỗi thêm người:', e);
      await interaction.editReply({ content: '❌ Không tìm thấy user hoặc lỗi khi thêm!' });
    }
    return;
  }

  if (customId.startsWith('setup_kick_user_modal_')) {
    const channelId = customId.slice('setup_kick_user_modal_'.length);
    const targetId = interaction.fields.getTextInputValue('user_id');
    await interaction.deferReply({ flags: 64 });

    try {
      const channel = interaction.guild.channels.cache.get(channelId);
      if (!channel) {
        return interaction.editReply({ content: '❌ Không tìm thấy kênh!' });
      }

      if (targetId === interaction.user.id) {
        return interaction.editReply({ content: '❌ Bạn không thể đuổi chính mình!' });
      }

      const isVoice = channel.type === ChannelType.GuildVoice;
      if (isVoice) {
        const member = channel.members.get(targetId);
        if (member) await member.voice.disconnect().catch(() => {});
      }

      await channel.permissionOverwrites.delete(targetId).catch(() => {});

      await interaction.editReply({ content: `✅ Đã đuổi <@${targetId}> khỏi kênh!` });
    } catch (e) {
      console.error('Lỗi đuổi người:', e);
      await interaction.editReply({ content: '❌ Không tìm thấy user hoặc lỗi khi đuổi!' });
    }
    return;
  }
}

module.exports = { handleButton, handleModal };
