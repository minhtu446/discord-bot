const { ChannelType, PermissionsBitField, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const jsonCache = require('./jsonCache');
const configHelper = require('./configHelper');

const bannedGameUsersPath = jsonCache.getPath('bannedGameUsers.json');
const userChannelsPath = jsonCache.getPath('userChannels.json');
const setupChannelsPath = jsonCache.getPath('setupChannels.json');
const userTicketsPath = jsonCache.getPath('userTickets.json');
const pvpGrantsPath = jsonCache.getPath('pvpAccessGrants.json');

const ttt = require('./games/ttt');
const pingpong = require('./games/pingpong');
const keobuabao = require('./games/keobuabao');

function addPvPGrant(channelId, opponentId, ownerId) {
  const grants = jsonCache.readJSONArray(pvpGrantsPath);
  grants.push({ channelId, opponentId, ownerId, grantedAt: Date.now() });
  jsonCache.writeJSON(pvpGrantsPath, grants);
}

function removePvPGrant(channelId, opponentId) {
  let grants = jsonCache.readJSONArray(pvpGrantsPath);
  grants = grants.filter(g => !(g.channelId === channelId && g.opponentId === opponentId));
  jsonCache.writeJSON(pvpGrantsPath, grants);
}

async function cleanupPvPGrants(client) {
  const grants = jsonCache.readJSONArray(pvpGrantsPath);
  if (grants.length === 0) return;
  let revoked = 0;
  for (const g of grants) {
    try {
      const ch = client.channels.cache.get(g.channelId) || await client.channels.fetch(g.channelId).catch(() => null);
      if (ch) {
        await ch.permissionOverwrites.delete(g.opponentId).catch(() => {});
        revoked++;
      }
    } catch { revoked++; }
  }
  jsonCache.writeJSON(pvpGrantsPath, []);
  console.log(`[Cleanup] Đã thu hồi quyền cho ${revoked} người chơi PvP cũ`);
}

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

  if (customId === 'create_chat_channel' || customId === 'create_voice_channel') {
    await interaction.deferReply({ flags: 64 });

    try {
      const setupChannels = jsonCache.readJSONObject(setupChannelsPath);
      const typeKey = customId === 'create_voice_channel' ? 'voice' : 'chat';
      const existingId = setupChannels[userId]?.[typeKey];
      if (existingId) {
        const existingChannel = interaction.guild.channels.cache.get(existingId);
        if (existingChannel) {
          return interaction.editReply({ content: `❌ Bạn đã có kênh ${typeKey} rồi: ${existingChannel}` });
        }
        setupChannels[userId][typeKey] = null;
        jsonCache.writeJSON(setupChannelsPath, setupChannels);
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

      const components = [row];

      if (!isVoice) {
        const gameRow = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`setup_game_ttt_${channel.id}`).setLabel('❌ Caro').setStyle(ButtonStyle.Primary),
          new ButtonBuilder().setCustomId(`setup_game_pingpong_${channel.id}`).setLabel('🏓 Ping Pong').setStyle(ButtonStyle.Success),
        );
        components.push(gameRow);

        const guideEmbed = new EmbedBuilder()
          .setTitle('📖 Hướng dẫn game')
          .setColor(0x5865F2)
          .addFields(
            { name: '❌ Caro', value: 'Bấm **Caro** để bắt đầu. Chọn 3×3, 4×4 (thắng 3 ô) hoặc 5×5 (thắng 4 ô). Chơi với AI hoặc người khác.', inline: false },
            { name: '🏓 Ping Pong', value: 'Gõ \`ping\` → bot trả lời \`pong\`. Thử chuỗi: \`6\`, \`3\`, \`36\`, \`67\`, \`sixseven\`! Ai gõ \`sixseven\`/ \`sixsenven\` sẽ được ảnh meme 🖼️', inline: false },
            { name: '✂️🪨📄 Oẳn tù tì', value: 'Gửi tin nhắn: \`kéo\`, \`búa\`, hoặc \`bao\`. Bot trả lời kết quả ngay!', inline: false },
          );

        await channel.send({ embeds: [guideEmbed] });
      }

      await channel.send({ content: `${interaction.user}`, components: components });
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

    const ownerUid = getSetupOwner(setupChannels, channelId);
    if (ownerUid) {
      if (setupChannels[ownerUid].chat === channelId) setupChannels[ownerUid].chat = null;
      if (setupChannels[ownerUid].voice === channelId) setupChannels[ownerUid].voice = null;
    }
    jsonCache.writeJSON(setupChannelsPath, setupChannels);

    await interaction.reply({ content: '🗑️ Đã xóa kênh!', flags: 64 });

    const channel = interaction.guild.channels.cache.get(channelId);
    if (channel) {
      await channel.delete().catch(() => {});
    }
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
    await interaction.reply({ content: '✅ Đã đóng ticket!', flags: 64 }).catch(() => {});
    const channel = interaction.guild.channels.cache.get(channelId);
    if (channel) {
      await channel.delete().catch(() => {});
    }
    return;
  }

  if (customId === 'setup_game_ttt' || customId.startsWith('setup_game_ttt_')) {
    if (s.ttt === false) return interaction.reply({ content: '❌ Caro AI đã bị tắt!', flags: 64 });
    const sizeRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('ttt_size_3').setLabel('3×3 (3 ô thắng)').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('ttt_size_4').setLabel('4×4 (3 ô thắng)').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('ttt_size_5').setLabel('5×5 (4 ô thắng - PC)').setStyle(ButtonStyle.Primary),
    );
    await interaction.reply({ content: 'Chọn kích thước bảng Caro:', components: [sizeRow], flags: 64 });
    return;
  }

  if (customId.startsWith('ttt_size_')) {
    if (s.ttt === false) return interaction.reply({ content: '❌ Caro AI đã bị tắt!', flags: 64 });
    const size = customId.split('_')[2];
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`ttt_vs_ai_${size}`).setLabel('🤖 Chơi với AI').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`ttt_vs_player_btn_${size}`).setLabel('👤 Chơi với người').setStyle(ButtonStyle.Success),
    );
    await interaction.reply({ content: `Chọn chế độ cho Caro ${size}x${size}:`, components: [row], flags: 64 });
    return;
  }

  if (customId.startsWith('ttt_vs_ai_')) {
    if (s.ttt === false) return interaction.reply({ content: '❌ Caro AI đã bị tắt!', flags: 64 });
    const size = parseInt(customId.split('_')[3]);
    await ttt.startGame(interaction, client, size);
    return;
  }

  if (customId.startsWith('ttt_vs_player_btn_')) {
    const size = customId.split('_')[4];
    const modal = new ModalBuilder()
      .setCustomId(`ttt_vs_player_modal_${size}`)
      .setTitle(`Chơi Caro ${size}x${size} với người`);
    const input = new TextInputBuilder()
      .setCustomId('opponent_id')
      .setLabel('ID hoặc mention người chơi')
      .setPlaceholder('VD: 123456789012345678 hoặc @username')
      .setStyle(TextInputStyle.Short)
      .setRequired(true);
    modal.addComponents(new ActionRowBuilder().addComponents(input));
    await interaction.showModal(modal);
    return;
  }

  if (customId === 'setup_game_pingpong' || customId.startsWith('setup_game_pingpong_')) {
    await pingpong.start(interaction);
    return;
  }

  if (customId === 'caro_play') {
    if (s.ttt === false) return interaction.reply({ content: '❌ Caro AI đã bị tắt!', flags: 64 });
    const sizeRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('ttt_size_3').setLabel('3×3 (3 ô thắng)').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('ttt_size_4').setLabel('4×4 (3 ô thắng)').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('ttt_size_5').setLabel('5×5 (4 ô thắng - PC)').setStyle(ButtonStyle.Primary),
    );
    await interaction.deferUpdate();
    await interaction.message.delete().catch(() => {});
    await interaction.followUp({ content: 'Chọn kích thước bảng Caro:', components: [sizeRow], flags: 64 });
    return;
  }

  if (customId.startsWith('caro_replay_')) {
    if (s.ttt === false) return interaction.reply({ content: '❌ Caro AI đã bị tắt!', flags: 64 });
    const sizeRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('ttt_size_3').setLabel('3×3 (3 ô thắng)').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('ttt_size_4').setLabel('4×4 (3 ô thắng)').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('ttt_size_5').setLabel('5×5 (4 ô thắng - PC)').setStyle(ButtonStyle.Primary),
    );
    await interaction.reply({ content: 'Chọn kích thước bảng Caro:', components: [sizeRow], flags: 64 });
    return;
  }

  if (customId.startsWith('game_ttt_') || customId.startsWith('game_caro_')) {
    if (s.ttt === false) return interaction.reply({ content: '❌ Caro AI đã bị tắt!', flags: 64 });
    const sizeRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('ttt_size_3').setLabel('3×3 (3 ô thắng)').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('ttt_size_4').setLabel('4×4 (3 ô thắng)').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('ttt_size_5').setLabel('5×5 (4 ô thắng - PC)').setStyle(ButtonStyle.Primary),
    );
    await interaction.reply({ content: 'Chọn kích thước bảng Caro:', components: [sizeRow], flags: 64 });
    return;
  }

  if (customId.startsWith('game_pingpong_')) {
    await pingpong.start(interaction);
    return;
  }

  if (customId.startsWith('game_delete_')) {
    const channelId = customId.slice('game_delete_'.length);
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

  if (customId.startsWith('end_')) {
    await interaction.deferUpdate().catch(() => {});
    return;
  }

  if (customId.startsWith('ttt_')) {
    if (customId.startsWith('ttt_pvp_cancel_') || customId.startsWith('ttt_cancel_')) {
      await interaction.deferUpdate().catch(() => {});
      return;
    }

    if (ttt.hasActiveGame(customId)) return;

    await interaction.deferUpdate().catch(() => {});
    const parts = customId.split('_');
    const gid = parts.slice(1, -2).join('_');
    if (gid) {
      const active = jsonCache.readJSONObject(jsonCache.getPath('activeGames.json'));
      if (active[gid]) { delete active[gid]; jsonCache.writeJSON(jsonCache.getPath('activeGames.json'), active); }
    }

    const sizeRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('ttt_size_3').setLabel('3×3 (3 ô thắng)').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('ttt_size_4').setLabel('4×4 (3 ô thắng)').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('ttt_size_5').setLabel('5×5 (4 ô thắng - PC)').setStyle(ButtonStyle.Primary),
    );
    await interaction.followUp({ content: 'Trận cũ đã kết thúc - chọn kích thước mới:', components: [sizeRow], flags: 64 }).catch(() => {});
  }
}

async function handleModal(interaction, client) {
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

  if (customId.startsWith('ttt_vs_player_modal_')) {
    const size = parseInt(customId.split('_')[4]) || 5;
    const rawId = interaction.fields.getTextInputValue('opponent_id').trim();
    const match = rawId.match(/(\d{17,20})/);
    const opponentId = match ? match[1] : rawId;
    if (!/^\d{17,20}$/.test(opponentId)) {
      return interaction.reply({ content: '❌ ID không hợp lệ! Hãy nhập ID số hoặc mention người chơi.', flags: 64 });
    }
    if (opponentId === interaction.user.id) {
      return interaction.reply({ content: '❌ Bạn không thể chơi với chính mình!', flags: 64 });
    }
    await interaction.deferReply({ flags: 64 });

    try {
      const member = await interaction.guild.members.fetch(opponentId);
      const channel = interaction.channel;

      if (channel.type !== ChannelType.GuildText) {
        return interaction.editReply({ content: '❌ Chỉ chơi được trong kênh text!' });
      }

      const existingOverwrite = channel.permissionOverwrites.cache.get(opponentId);
      if (!existingOverwrite || !existingOverwrite.allow.has(PermissionsBitField.Flags.ViewChannel)) {
        await channel.permissionOverwrites.create(opponentId, {
          ViewChannel: true,
          SendMessages: true,
          ReadMessageHistory: true,
        });
      }
      if (ttt.userHasActiveGame(interaction.user.id)) {
        await interaction.editReply({ content: '❌ Bạn đang có game đang chơi! Hãy kết thúc game cũ trước.' });
        return;
      }
      if (ttt.userHasActiveGame(opponentId)) {
        await interaction.editReply({ content: `❌ <@${opponentId}> đang có game đang chơi!` });
        if (existingOverwrite) {
          await channel.permissionOverwrites.delete(opponentId).catch(() => {});
        }
        return;
      }
      addPvPGrant(channel.id, opponentId, interaction.user.id);

      const msg = await interaction.editReply({ content: `✅ Đã thêm ${member.user.tag} vào kênh! Bắt đầu game ${size}x${size}...`, fetchReply: true });

      await ttt.startPlayerGame(
        { user: interaction.user, id: interaction.user.id },
        opponentId,
        channel,
        async () => {
          removePvPGrant(channel.id, opponentId);
          try {
            await channel.permissionOverwrites.delete(opponentId);
          } catch (e) { /* ignore */ }
        },
        size
      );

      await msg.delete().catch(() => {});
    } catch (e) {
      console.error('Lỗi tạo game PvP:', e);
      await interaction.editReply({ content: '❌ Không tìm thấy user hoặc lỗi khi tạo game!' });
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

module.exports = { handleButton, handleModal, handleRPS, cleanupPvPGrants };
