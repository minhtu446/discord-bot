const { ChannelType, PermissionsBitField, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const jsonCache = require('./jsonCache');
const configHelper = require('./configHelper');

const bannedGameUsersPath = jsonCache.getPath('bannedGameUsers.json');
const userChannelsPath = jsonCache.getPath('userChannels.json');
const setupChannelsPath = jsonCache.getPath('setupChannels.json');
const userTicketsPath = jsonCache.getPath('userTickets.json');

const ttt = require('./games/ttt');
const noitu = require('./games/noitu');
const keobuabao = require('./games/keobuabao');

function getSetupOwner(setupChannels, channelId) {
  for (const [uid, chs] of Object.entries(setupChannels)) {
    if (chs.chat === channelId || chs.voice === channelId) return uid;
  }
  return null;
}

async function handleButton(interaction, client) {
  const userId = interaction.user.id;
  const customId = interaction.customId;
  const settingsHelper = require('./settingsHelper');
  const s = settingsHelper.getSettings(interaction.guild?.id);

  if (customId === 'create_ticket' && s.ticket === false) {
    return interaction.reply({ content: '❌ Tính năng ticket đã bị tắt!', flags: 64 });
  }
  if (customId === 'create_game_channel' && s.gameChannel === false) {
    return interaction.reply({ content: '❌ Tính năng kênh game đã bị tắt!', flags: 64 });
  }
  if (customId === 'create_game_channel') {
    const banned = jsonCache.readJSONArray(bannedGameUsersPath);
    if (banned.includes(userId)) {
      return interaction.reply({ content: '❌ Bạn đã bị cấm dùng game!', flags: 64 });
    }

    const userChannels = jsonCache.readJSONObject(userChannelsPath);
    if (userChannels[userId]) {
      return interaction.reply({ content: '❌ Bạn đã có kênh game rồi!', flags: 64 });
    }

    await interaction.deferReply({ flags: 64 });

    try {
      const category = interaction.guild.channels.cache.get(configHelper.getConfig(interaction.guild.id, 'gameCategoryId'));
      if (!category || category.type !== ChannelType.GuildCategory) {
        return interaction.editReply({ content: '❌ Không tìm thấy danh mục game!' });
      }

      const channel = await interaction.guild.channels.create({
        name: `game-${interaction.user.username}`,
        type: ChannelType.GuildText,
        parent: category.id,
        permissionOverwrites: [
          { id: interaction.guild.roles.everyone, deny: [PermissionsBitField.Flags.ViewChannel] },
          { id: userId, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] },
          { id: client.user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] },
        ],
      });

      userChannels[userId] = channel.id;
      jsonCache.writeJSON(userChannelsPath, userChannels);

      const embed = new EmbedBuilder()
        .setTitle('🎮 Kênh Game')
        .setDescription('Chọn game để chơi bằng các nút bên dưới:')
        .setColor(0x00FF00);

      const row1 = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`game_ttt_${channel.id}`).setLabel('❌ Caro').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`game_noitu_${channel.id}`).setLabel('🔤 Nối từ').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`game_delete_${channel.id}`).setLabel('🗑️ Xóa kênh').setStyle(ButtonStyle.Danger)
      );

      const guideEmbed = new EmbedBuilder()
        .setTitle('📖 Hướng dẫn chơi')
        .setColor(0x5865F2)
        .addFields(
          { name: '❌ Caro 5x5', value: 'Đánh với AI. Bấm nút **Caro** → chọn ô để đặt ❌. Bot sẽ đặt ⭕. AI thông minh với độ sâu 12, tự động chặn nước đi của bạn. Thắng = 3 ô liên tiếp.', inline: false },
          { name: '🔤 Nối từ', value: 'Bấm nút **Nối từ** → bot ra 1 cặp từ (vd: "đen xì"). Bạn nhập cặp từ mới bắt đầu bằng từ cuối (vd: "xì hơi"). Bot tìm từ nối tiếp. Ai hết từ trước là thua!', inline: false },
          { name: '✂️🪨📄 Oẳn tù tì', value: 'Chơi ngay trong kênh này! Gửi tin nhắn: `kéo`, `búa`, hoặc `bao`. Bot sẽ trả lời kết quả ngay lập tức!', inline: false },
        )
        .setFooter({ text: 'Game chỉ dành riêng cho bạn trong kênh này!' });

      await channel.send({ content: `${interaction.user}`, embeds: [embed], components: [row1] });
      await channel.send({ embeds: [guideEmbed] });
      await interaction.editReply({ content: `✅ Đã tạo kênh game: ${channel}` });
    } catch (e) {
      console.error('Lỗi tạo kênh game:', e);
      await interaction.editReply({ content: '❌ Lỗi tạo kênh game!' });
    }
    return;
  }

  if (customId === 'create_chat_channel' || customId === 'create_voice_channel') {
    await interaction.deferReply({ flags: 64 });

    try {
      const setupChannels = jsonCache.readJSONObject(setupChannelsPath);
      const typeKey = customId === 'create_voice_channel' ? 'voice' : 'chat';
      if (setupChannels[userId] && setupChannels[userId][typeKey]) {
        return interaction.editReply({ content: `❌ Bạn đã có kênh ${typeKey} rồi! Hãy xóa kênh cũ trước khi tạo mới.` });
      }

      const category = interaction.guild.channels.cache.get(configHelper.getConfig(interaction.guild.id, 'setupCategoryId'));
      if (!category || category.type !== ChannelType.GuildCategory) {
        return interaction.editReply({ content: '❌ Không tìm thấy danh mục!' });
      }

      const isVoice = customId === 'create_voice_channel';
      const channel = await interaction.guild.channels.create({
        name: `${typeKey}-${interaction.user.username}`,
        type: isVoice ? ChannelType.GuildVoice : ChannelType.GuildText,
        parent: category.id,
        permissionOverwrites: [
          { id: interaction.guild.roles.everyone, deny: [PermissionsBitField.Flags.ViewChannel] },
          { id: userId, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory, PermissionsBitField.Flags.Connect, PermissionsBitField.Flags.Speak] },
          { id: client.user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory, PermissionsBitField.Flags.Connect, PermissionsBitField.Flags.Speak] },
        ],
      });

      if (!setupChannels[userId]) setupChannels[userId] = { chat: null, voice: null };
      setupChannels[userId][typeKey] = channel.id;
      jsonCache.writeJSON(setupChannelsPath, setupChannels);

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`setup_rename_channel_${channel.id}`).setLabel('✏️ Đổi tên').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(`setup_add_user_${channel.id}`).setLabel('➕ Thêm người').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`setup_kick_user_${channel.id}`).setLabel('👢 Đuổi').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId(`setup_delete_channel_${channel.id}`).setLabel('🗑️ Xóa kênh').setStyle(ButtonStyle.Danger)
      );

      await channel.send({ content: `${interaction.user}`, components: [row] });
      await interaction.editReply({ content: `✅ Đã tạo kênh ${typeKey}: ${channel}` });
    } catch (e) {
      console.error('Lỗi tạo kênh setup:', e);
      await interaction.editReply({ content: '❌ Lỗi tạo kênh!' });
    }
    return;
  }

  if (customId.startsWith('setup_rename_channel_')) {
    const channelId = customId.slice('setup_rename_channel_'.length);
    const setupChannels = jsonCache.readJSONObject(setupChannelsPath);
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
    const setupChannels = jsonCache.readJSONObject(setupChannelsPath);
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
    const setupChannels = jsonCache.readJSONObject(setupChannelsPath);
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

  if (customId.startsWith('setup_delete_channel_')) {
    const channelId = customId.slice('setup_delete_channel_'.length);
    const setupChannels = jsonCache.readJSONObject(setupChannelsPath);
    const owner = getSetupOwner(setupChannels, channelId);
    if (owner !== userId) {
      return interaction.reply({ content: '❌ Chỉ người tạo kênh mới được xóa!', flags: 64 });
    }
    const channel = interaction.guild.channels.cache.get(channelId);
    if (channel) {
      await channel.delete().catch(() => {});
    }

    const ownerUid = getSetupOwner(setupChannels, channelId);
    if (ownerUid) {
      if (setupChannels[ownerUid].chat === channelId) setupChannels[ownerUid].chat = null;
      if (setupChannels[ownerUid].voice === channelId) setupChannels[ownerUid].voice = null;
    }
    jsonCache.writeJSON(setupChannelsPath, setupChannels);

    await interaction.reply({ content: '🗑️ Đã xóa kênh!', flags: 64 });
    return;
  }

  if (customId === 'create_ticket') {
    const userTickets = jsonCache.readJSONObject(userTicketsPath);
    if (userTickets[userId]) {
      const existing = interaction.guild.channels.cache.get(userTickets[userId]);
      if (existing) {
        return interaction.reply({ content: `❌ Bạn đã có ticket rồi: ${existing}`, flags: 64 });
      }
      delete userTickets[userId];
      jsonCache.writeJSON(userTicketsPath, userTickets);
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
      jsonCache.writeJSON(userTicketsPath, userTickets);

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
    const userTickets = jsonCache.readJSONObject(userTicketsPath);
    for (const [uid, chId] of Object.entries(userTickets)) {
      if (chId === channelId) {
        delete userTickets[uid];
        jsonCache.writeJSON(userTicketsPath, userTickets);
        break;
      }
    }
    const channel = interaction.guild.channels.cache.get(channelId);
    if (channel) {
      await channel.delete().catch(() => {});
    }
    await interaction.reply({ content: '✅ Đã đóng ticket!', flags: 64 });
    return;
  }

  if (customId.startsWith('game_')) {
    const parts = customId.split('_');
    const gameType = parts[1];
    const channelId = parts.slice(2).join('_');

    if (interaction.channel.id !== channelId) return;

    if (gameType === 'ttt') {
      if (s.ttt === false) return interaction.reply({ content: '❌ Caro AI đã bị tắt!', flags: 64 });
      await ttt.startGame(interaction, client);
      return;
    }
    if (gameType === 'noitu') {
      if (s.noitu === false) return interaction.reply({ content: '❌ Nối từ đã bị tắt!', flags: 64 });
      await noitu.startGame(interaction, client);
      return;
    }
    if (gameType === 'delete') {
      const userChannels = jsonCache.readJSONObject(userChannelsPath);
      const entry = Object.entries(userChannels).find(([, chId]) => chId === channelId);
      if (entry) {
        delete userChannels[entry[0]];
        jsonCache.writeJSON(userChannelsPath, userChannels);
      }
      await interaction.reply({ content: '🗑️ Đang xóa kênh...', flags: 64 });
      await interaction.channel.delete().catch(() => {});
      return;
    }
  }
}

async function handleModal(interaction, client) {
  const customId = interaction.customId;

  if (customId.startsWith('noitu_modal_')) {
    await noitu.handleModal(interaction);
    return;
  }

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
        SendMessages: true,
        ReadMessageHistory: true,
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

async function handleRPS(client, message) {
  try {
    const result = await keobuabao.play(message);
    return result;
  } catch (e) {
    return false;
  }
}

module.exports = { handleButton, handleModal, handleRPS };
