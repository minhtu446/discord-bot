const { PermissionsBitField, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType } = require('discord.js');
const config = require('./config');
const jsonCache = require('./jsonCache');
const configHelper = require('./configHelper');
const { retryFetch } = require('./utils');

const bannedGameUsersPath = jsonCache.getPath('bannedGameUsers.json');
const autoDeleteUsersPath = jsonCache.getPath('autoDeleteUsers.json');
const gameChannelsPath = jsonCache.getPath('gameChannels.json');

const settingsHelper = require('./settingsHelper');

const ALL_CONFIG_FIELDS = [
  'welcomeChannelId', 'logChannelId',
  'ticketCategoryId', 'memberRoleId',
  'setupCategoryId', 'dmRelayChannelId'
];

const commands = {
  xoa: {
    async execute(interaction, client) {
      const amount = Math.min(interaction.options.getInteger('số_lượng') || 1, 1000);
      const user = interaction.options.getUser('người_dùng');
      const dmUserId = interaction.options.getString('id_acc');
      try { await interaction.deferReply({ flags: 64 }); } catch { return; }

      let channel;
      let isDM = false;
      if (dmUserId) {
        let dmUser;
        try { dmUser = await client.users.fetch(dmUserId); } catch {
          return interaction.editReply({ content: `❌ Không tìm thấy user ID \`${dmUserId}\`!` });
        }
        try { channel = await dmUser.createDM(); } catch {
          return interaction.editReply({ content: `❌ Không thể tạo DM với user này!` });
        }
        isDM = true;
      } else {
        if (!interaction.guild) { isDM = true; }
        channel = interaction.channel;
      }

      let remaining = amount;
      let deleted = 0;
      let lastId = null;
      const TWO_WEEKS = 14 * 24 * 60 * 60 * 1000;

      while (remaining > 0) {
        const fetchOpts = { limit: Math.min(remaining, 100) };
        if (lastId) fetchOpts.before = lastId;
        const fetched = await channel.messages.fetch(fetchOpts);
        if (fetched.size === 0) break;

        let toDelete = [...fetched.values()];
        if (user) toDelete = toDelete.filter(m => m.author.id === user.id);
        if (toDelete.length === 0) { lastId = fetched.last().id; continue; }

        if (isDM) {
          toDelete = toDelete.filter(m => m.author.id === client.user.id);
          if (toDelete.length === 0) { lastId = fetched.last().id; continue; }
          for (let i = 0; i < toDelete.length; i += 5) {
            const batch = toDelete.slice(i, i + 5);
            const results = await Promise.allSettled(batch.map(m =>
              m.delete().catch(e => {
                if (e.code !== 10008) console.log(`[xoa DM] fail ${m.id}: ${e.code} ${e.message}`);
                return null;
              })
            ));
            deleted += results.filter(r => r.status === 'fulfilled' && r.value !== null).length;
          }
          remaining -= toDelete.length;
          lastId = toDelete[toDelete.length - 1].id;
          continue;
        }

        const recent = toDelete.filter(m => Date.now() - m.createdTimestamp < TWO_WEEKS);
        const old = toDelete.filter(m => Date.now() - m.createdTimestamp >= TWO_WEEKS);

        if (recent.length > 0) {
          await channel.bulkDelete(recent, true).catch(() => {});
        }
        if (old.length > 0) {
          for (let i = 0; i < old.length; i += 3) {
            const batch = old.slice(i, i + 3);
            await Promise.allSettled(batch.map(m => m.delete().catch(() => {})));
            if (i + 3 < old.length) await new Promise(r => setTimeout(r, 500));
          }
        }

        deleted += toDelete.length;
        remaining -= toDelete.length;
        lastId = toDelete[toDelete.length - 1].id;
      }

      const where = isDM ? `DM` : `kênh <#${channel.id}>`;
      await interaction.editReply({ content: `✅ Đã xóa ${deleted} tin nhắn trong ${where}.` });
    }
  },

  camchat: {
    async execute(interaction, client) {
      if (!interaction.guild) return interaction.reply({ content: '❌ Lệnh này chỉ dùng được trong server!', flags: 64 });
      const user = interaction.options.getUser('người_dùng');
      await interaction.deferReply({ flags: 64 });
      let member;
      try { member = await interaction.guild.members.fetch(user.id); } catch {
        return interaction.editReply({ content: '❌ Không tìm thấy người dùng này trong server!' });
      }
      try {
        const mutedRole = interaction.guild.roles.cache.find(r => r.name === 'Muted');
        if (!mutedRole) {
          const r = await interaction.guild.roles.create({ name: 'Muted', permissions: [] });
          for (const [, c] of interaction.guild.channels.cache) {
            try { await c.permissionOverwrites.create(r, { SendMessages: false, Speak: false }); } catch {}
          }
          await member.roles.add(r);
        } else {
          await member.roles.add(mutedRole);
        }
        await interaction.editReply({ content: `✅ Đã cấm chat ${user.tag}` });
      } catch (e) {
        console.error('Lỗi camchat:', e);
        await interaction.editReply({ content: '❌ Lỗi khi cấm chat!' });
      }
    }
  },

  htcamchat: {
    async execute(interaction, client) {
      if (!interaction.guild) return interaction.reply({ content: '❌ Lệnh này chỉ dùng được trong server!', flags: 64 });
      const user = interaction.options.getUser('người_dùng');
      await interaction.deferReply({ flags: 64 });
      let member;
      try { member = await interaction.guild.members.fetch(user.id); } catch {
        return interaction.editReply({ content: '❌ Không tìm thấy người dùng này trong server!' });
      }
      const mutedRole = interaction.guild.roles.cache.find(r => r.name === 'Muted');
      if (mutedRole) await member.roles.remove(mutedRole);
      await interaction.editReply({ content: `✅ Đã gỡ cấm chat ${user.tag}` });
    }
  },

  lock: {
    async execute(interaction, client) {
      if (!interaction.guild) return interaction.reply({ content: '❌ Lệnh này chỉ dùng được trong server!', flags: 64 });
      await interaction.channel.permissionOverwrites.edit(interaction.guild.roles.everyone, {
        SendMessages: false
      }).catch(() => interaction.channel.permissionOverwrites.create(interaction.guild.roles.everyone, {
        SendMessages: false
      }));
      await interaction.reply({ content: '🔒 Kênh đã bị khóa!', flags: 64 });
    }
  },

  unlock: {
    async execute(interaction, client) {
      if (!interaction.guild) return interaction.reply({ content: '❌ Lệnh này chỉ dùng được trong server!', flags: 64 });
      const everyone = interaction.guild.roles.everyone;
      await interaction.channel.permissionOverwrites.edit(everyone, {
        SendMessages: null
      }).catch(() => {});
      await interaction.reply({ content: '🔓 Kênh đã mở khóa!', flags: 64 });
    }
  },

  msg: {
    async execute(interaction, client) {
      if (!interaction.guild) return interaction.reply({ content: '❌ Lệnh này chỉ dùng được trong server!', flags: 64 });
      const type = interaction.options.getString('loại');
      const content = interaction.options.getString('nội_dung');
      const file = interaction.options.getAttachment('tệp');
      const roleId = interaction.options.getString('role_id');
      const times = interaction.options.getInteger('số_lần') || 1;
      await interaction.deferReply({ flags: 64 });

      if (!content && !file) {
        return interaction.editReply({ content: '❌ Vui lòng nhập nội dung hoặc tệp!' });
      }

      const payload = {};
      if (content) payload.content = content;
      if (file) payload.files = [file];

      if (type === 'dm') {
        const target = interaction.options.getUser('người_dùng');
        if (!target) return interaction.editReply({ content: '❌ Vui lòng chọn người dùng!' });
        try {
          for (let i = 0; i < times; i++) {
            await target.send(payload);
          }
          await interaction.editReply({ content: `✅ Đã gửi DM ${times} lần cho ${target.tag}!` });
        } catch (e) {
          await interaction.editReply({ content: `❌ Không thể gửi DM cho ${target.tag}! (đã tắt DM hoặc không có mutual server)` });
        }
        return;
      }

      if (type === 'role') {
        if (!roleId) {
          return interaction.editReply({ content: '❌ Vui lòng nhập ID role!' });
        }
        try {
          const guild = interaction.guild;
          const role = await guild.roles.fetch(roleId).catch(() => null);
          if (!role) return interaction.editReply({ content: `❌ Không tìm thấy role ID \`${roleId}\` trong server!` });

          await retryFetch(() => guild.members.fetch());
          const members = guild.members.cache.filter(m => m.roles.cache.has(role.id));
          if (members.size === 0) return interaction.editReply({ content: `❌ Không có member nào có role **${role.name}**!` });

          let sent = 0, failed = 0;
          for (let t = 0; t < times; t++) {
            for (const [, member] of members) {
              try {
                const dm = await member.user.createDM();
                await dm.send(payload);
                sent++;
              } catch {
                failed++;
              }
              await new Promise(r => setTimeout(r, 200));
            }
          }
          return interaction.editReply({ content: `✅ Đã gửi DM cho **${sent}**/${members.size * times} member × ${times} lần có role **${role.name}**${failed > 0 ? ` (${failed} thất bại)` : ''}!` });
        } catch (e) {
          console.error('Lỗi msg role:', e.message);
          return interaction.editReply({ content: `❌ Lỗi: ${e.message}` });
        }
      } else {
        for (let i = 0; i < times; i++) {
          await interaction.channel.send(payload);
        }
        await interaction.editReply({ content: `✅ Đã gửi ${times} tin nhắn!` });
      }
    }
  },

  setslowmode: {
    async execute(interaction, client) {
      if (!interaction.guild) return interaction.reply({ content: '❌ Lệnh này chỉ dùng được trong server!', flags: 64 });
      const seconds = interaction.options.getInteger('giây');
      await interaction.channel.setRateLimitPerUser(seconds);
      await interaction.reply({ content: `✅ Đã set slowmode ${seconds}s`, flags: 64 });
    }
  },

  update: {
    async execute(interaction, client) {
      if (!interaction.guild) return interaction.reply({ content: '❌ Lệnh này chỉ dùng được trong server!', flags: 64 });
      await interaction.deferReply({ flags: 64 });
      const embed = new EmbedBuilder()
        .setTitle('📢 Cập nhật bot')
        .setDescription('Bot đã được cập nhật với nhiều tính năng mới!')
        .addFields({ name: 'Phiên bản', value: 'v1.0.0' })
        .setColor(0x00FF00)
        .setTimestamp();
      await interaction.channel.send({ embeds: [embed] });
      await interaction.editReply({ content: '✅ Đã gửi update!' });
    }
  },



  list: {
    async execute(interaction, client) {
      const type = interaction.options.getString('loại');

      if (type === 'all') {
        await interaction.deferReply({ flags: 64 });

        const roleEmoji = require('./roleEmoji');
        const wf = require('./automod/wordFilter');
        const noemoji = roleEmoji.listSkipRoles();
        const owners = configHelper.listOwners();
        const banned = jsonCache.readJSONArray(bannedGameUsersPath);
        const autodel = jsonCache.readJSONArray(autoDeleteUsersPath);
        const channels = jsonCache.readJSONArray(gameChannelsPath);
        const setupChannelsPath = jsonCache.getPath('setupChannels.json');
        const setupChannels = jsonCache.readJSONObject(setupChannelsPath);
        const setupEntries = Object.entries(setupChannels);

        const embeds = [
          new EmbedBuilder()
            .setTitle('📋 Danh sách role bỏ qua emoji')
            .setDescription(noemoji.length > 0 ? noemoji.map(id => `- <@&${id}>`).join('\n') : 'Không có')
            .setColor(0x5865F2),
          new EmbedBuilder()
            .setTitle('👑 Danh sách chủ sở hữu')
            .setDescription(owners.length > 0 ? owners.map(id => `- <@${id}>`).join('\n') : 'Không có')
            .setColor(0xFFD700),
          new EmbedBuilder()
            .setTitle('📡 Danh sách kênh setup')
            .setDescription(setupEntries.length > 0 ? setupEntries.map(([uid, chs]) => {
              const parts = [];
              if (chs.chat) parts.push(`Chat: <#${chs.chat}>`);
              if (chs.voice) parts.push(`Voice: <#${chs.voice}>`);
              return `- <@${uid}>: ${parts.join(', ') || 'Không có kênh'}`;
            }).join('\n') : 'Không có')
            .setColor(0x5865F2),
          new EmbedBuilder()
            .setTitle('🎮 Danh sách cấm dùng game')
            .setDescription(banned.length > 0 ? banned.map(id => `- <@${id}>`).join('\n') : 'Không có')
            .setColor(0xED4245),
          new EmbedBuilder()
            .setTitle('🗑️ Danh sách tự động xóa tin nhắn')
            .setDescription(autodel.length > 0 ? autodel.map(id => `- <@${id}>`).join('\n') : 'Không có')
            .setColor(0x57F287),
          new EmbedBuilder()
            .setTitle('🎯 Danh sách kênh game')
            .setDescription(channels.length > 0 ? channels.map(id => `- <#${id}>`).join('\n') : 'Không có')
            .setColor(0x9B59B6),
          new EmbedBuilder()
            .setTitle('🚫 Danh sách từ/cụm từ bad')
            .setDescription(wf.loadBadWords().length > 0 ? wf.loadBadWords().map(w => `- \`${w}\``).join('\n') : 'Không có')
            .setColor(0x000000),
        ];

        return interaction.editReply({ embeds });
      }

      if (type === 'noemojirole') {
        const roleEmoji = require('./roleEmoji');
        const list = roleEmoji.listSkipRoles();
        const desc = list.length > 0
          ? list.map(id => `- <@&${id}> (\`${id}\`)`).join('\n')
          : 'Không có role nào trong danh sách.';
        const embed = new EmbedBuilder()
          .setTitle('📋 Danh sách role bỏ qua emoji')
          .setDescription(desc)
          .setColor(0x5865F2);
        return interaction.reply({ embeds: [embed], flags: 64 });
      }

      if (type === 'owner') {
        await interaction.deferReply({ flags: 64 });
        const owners = configHelper.listOwners();
        const embed = new EmbedBuilder()
          .setTitle('👑 Danh sách chủ sở hữu')
          .setDescription(owners.map(id => `- <@${id}> (\`${id}\`)`).join('\n'))
          .setColor(0xFFD700);
        return interaction.editReply({ embeds: [embed] });
      }

      if (type === 'camdunggame') {
        const list = jsonCache.readJSONArray(bannedGameUsersPath);
        const desc = list.length > 0
          ? list.map(id => `- <@${id}> (\`${id}\`)`).join('\n')
          : 'Không có ai trong danh sách.';
        const embed = new EmbedBuilder()
          .setTitle('🎮 Danh sách cấm dùng game')
          .setDescription(desc)
          .setColor(0xED4245);
        return interaction.reply({ embeds: [embed], flags: 64 });
      }

      if (type === 'tudongxoa') {
        const list = jsonCache.readJSONArray(autoDeleteUsersPath);
        const desc = list.length > 0
          ? list.map(id => `- <@${id}> (\`${id}\`)`).join('\n')
          : 'Không có ai trong danh sách.';
        const embed = new EmbedBuilder()
          .setTitle('🗑️ Danh sách tự động xóa tin nhắn')
          .setDescription(desc)
          .setColor(0x57F287);
        return interaction.reply({ embeds: [embed], flags: 64 });
      }

      if (type === 'gamechannels') {
        const list = jsonCache.readJSONArray(gameChannelsPath);
        const desc = list.length > 0
          ? list.map(id => `- <#${id}> (\`${id}\`)`).join('\n')
          : 'Không có kênh nào trong danh sách.';
        const embed = new EmbedBuilder()
          .setTitle('🎯 Danh sách kênh game')
          .setDescription(desc)
          .setColor(0x9B59B6);
        return interaction.reply({ embeds: [embed], flags: 64 });
      }

      if (type === 'bad') {
        const wf = require('./automod/wordFilter');
        const list = wf.loadBadWords();
        const desc = list.length > 0
          ? list.map(w => `- \`${w}\``).join('\n')
          : 'Không có từ/cụm từ nào trong danh sách.';
        const embed = new EmbedBuilder()
          .setTitle('🚫 Danh sách từ/cụm từ bad')
          .setDescription(desc)
          .setColor(0x000000);
        return interaction.reply({ embeds: [embed], flags: 64 });
      }

      if (type === 'setup') {
        const setupChannelsPath = jsonCache.getPath('setupChannels.json');
        const setupChannels = jsonCache.readJSONObject(setupChannelsPath);
        const entries = Object.entries(setupChannels);
        const desc = entries.length > 0
          ? entries.map(([uid, chs]) => {
              const parts = [];
              if (chs.chat) parts.push(`Kênh chat: <#${chs.chat}>`);
              if (chs.voice) parts.push(`Kênh voice: <#${chs.voice}>`);
              return `- <@${uid}>: ${parts.join(', ') || 'Không có kênh'}`;
            }).join('\n')
          : 'Không có kênh nào được tạo.';
        const embed = new EmbedBuilder()
          .setTitle('📡 Danh sách kênh setup')
          .setDescription(desc)
          .setColor(0x5865F2);
        return interaction.reply({ embeds: [embed], flags: 64 });
      }
    }
  },

  add: {
    async execute(interaction, client) {
      const type = interaction.options.getString('loại');

      if (type === 'camdunggame') {
        const id = interaction.options.getString('id');
        if (!id) return interaction.reply({ content: '❌ Cần nhập ID!', flags: 64 });
        const list = jsonCache.readJSONArray(bannedGameUsersPath);
        if (!list.includes(id)) {
          list.push(id);
          jsonCache.writeJSON(bannedGameUsersPath, list);
        }
        return interaction.reply({ content: `✅ Đã cấm <@${id}> dùng game!`, flags: 64 });
      }

      if (type === 'owner') {
        const id = interaction.options.getString('id');
        if (!id) return interaction.reply({ content: '❌ Cần nhập ID!', flags: 64 });
        await interaction.deferReply({ flags: 64 });
        if (id === config.ownerId) return interaction.editReply({ content: '❌ ID này là chủ sở hữu chính!' });
        configHelper.addOwner(id);
        return interaction.editReply({ content: `✅ Đã thêm \`${id}\` vào danh sách chủ sở hữu!` });
      }

      if (type === 'noemojirole') {
        const id = interaction.options.getString('id');
        if (!id) return interaction.reply({ content: '❌ Cần nhập ID role!', flags: 64 });
        const roleEmoji = require('./roleEmoji');
        roleEmoji.addSkipRole(id);
        await interaction.deferReply({ flags: 64 });
        await roleEmoji.updateRoleMembers(interaction.guild, id);
        return interaction.editReply({ content: `✅ Đã thêm role \`${id}\` vào danh sách bỏ qua emoji và xóa emoji khỏi member!` });
      }

      if (type === 'tudongxoa') {
        const id = interaction.options.getString('id');
        if (!id) return interaction.reply({ content: '❌ Cần nhập ID!', flags: 64 });
        const list = jsonCache.readJSONArray(autoDeleteUsersPath);
        if (!list.includes(id)) {
          list.push(id);
          jsonCache.writeJSON(autoDeleteUsersPath, list);
        }
        return interaction.reply({ content: `✅ Đã thêm <@${id}> vào danh sách auto xóa!`, flags: 64 });
      }

      if (type === 'bad') {
        const content = interaction.options.getString('nội_dung');
        if (!content) return interaction.reply({ content: '❌ Cần nhập nội dung!', flags: 64 });
        const wf = require('./automod/wordFilter');
        wf.addBadWord(content);
        return interaction.reply({ content: `✅ Đã thêm từ/cụm từ bad: \`${content}\``, flags: 64 });
      }
    }
  },

  test: {
    async execute(interaction, client) {
      const type = interaction.options.getString('loại');

      if (type === 'text') {
        const content = interaction.options.getString('nội_dung');
        if (!content) return interaction.reply({ content: '❌ Cần nhập nội dung!', flags: 64 });
        const wf = require('./automod/wordFilter');
        const found = wf.checkContent(content);
        return interaction.reply({
          content: found
            ? `🚫 Nội dung \`${content}\` có chứa từ bad!`
            : `✅ Nội dung \`${content}\` an toàn.`,
          flags: 64,
        });
      }

      if (type === 'image') {
        const attachment = interaction.options.getAttachment('tệp');
        if (!attachment) return interaction.reply({ content: '❌ Cần đính kèm ảnh!', flags: 64 });
        if (!attachment.contentType?.startsWith('image/')) return interaction.reply({ content: '❌ File đính kèm phải là ảnh!', flags: 64 });
        await interaction.deferReply({ flags: 64 });
        try {
          const res = await fetch(attachment.url);
          if (!res.ok) return interaction.editReply({ content: '❌ Không thể tải ảnh!' });
          const buffer = Buffer.from(await res.arrayBuffer());
          const imageFilter = require('./automod/imageFilter');
          const found = await imageFilter.checkBufferImage(buffer);
          return interaction.editReply({
            content: found
              ? '🚫 Ảnh chứa nội dung bad (phát hiện qua OCR)!'
              : '✅ Ảnh an toàn (không phát hiện nội dung bad).',
          });
        } catch (e) {
          return interaction.editReply({ content: `❌ Lỗi: ${e.message}` });
        }
      }
    }
  },

  setup: {
    async execute(interaction, client) {
      if (!interaction.guild) return interaction.reply({ content: '❌ Lệnh này chỉ dùng được trong server!', flags: 64 });
      let type = interaction.options.getString('loại') || interaction.options.getSubcommand(false);

      if (!type) {
        return interaction.reply({ content: '❌ Không xác định được loại! Vui lòng thử lại.', flags: 64 });
      }

      if (type === 'ticket') {
        await interaction.deferReply({ flags: 64 });
        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('create_ticket').setLabel('🎫 Mở Ticket').setStyle(ButtonStyle.Primary)
        );
        const embed = new EmbedBuilder()
          .setTitle('🎫 Hỗ trợ')
          .setDescription('Nhấn nút bên dưới để mở ticket hỗ trợ.')
          .setColor(0x5865F2);
        await interaction.channel.send({ embeds: [embed], components: [row] });
        return interaction.editReply({ content: '✅ Đã tạo UI ticket!' });
      }

      if (type === 'ui') {
        await interaction.deferReply({ flags: 64 });
        const embed = new EmbedBuilder()
          .setTitle(interaction.options.getString('tiêu_đề'))
          .setDescription(interaction.options.getString('nội_dung'))
          .setColor(0x5865F2);
        await interaction.channel.send({ embeds: [embed] });
        return interaction.editReply({ content: '✅ Đã gửi UI!' });
      }

      if (type === 'channelandgame') {
        await interaction.deferReply();
        const embed = new EmbedBuilder()
          .setDescription('Tạo kênh voice và kênh chat (kênh game)')
          .setColor(0x5865F2);
        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('create_chat_channel').setLabel('💬 Kênh Chat').setStyle(ButtonStyle.Primary),
          new ButtonBuilder().setCustomId('create_voice_channel').setLabel('🔊 Kênh Voice').setStyle(ButtonStyle.Secondary)
        );
        return interaction.editReply({ embeds: [embed], components: [row] });
      }

      if (type === 'khuvuichoi') {
        await interaction.deferReply();
        const gameChannels = jsonCache.readJSONObject(gameChannelsPath);
        const channelId = interaction.channel.id;
        const isGame = gameChannels[channelId];

        if (isGame) {
          delete gameChannels[channelId];
          jsonCache.writeJSON(gameChannelsPath, gameChannels);
          return interaction.editReply({ content: `✅ Đã tắt khu vui chơi trong kênh <#${channelId}>!` });
        }

        gameChannels[channelId] = true;
        jsonCache.writeJSON(gameChannelsPath, gameChannels);

        const guideEmbed = new EmbedBuilder()
          .setTitle('🎮 Khu vui chơi')
          .setColor(0x5865F2)
          .addFields(
            { name: '❌ Caro', value: 'Bấm nút **Caro** để chọn chế độ (AI hoặc chơi với người). Bot tự động chặn nước đi. Thắng = 4 ô liên tiếp.', inline: false },
            { name: '🏓 Ping Pong', value: 'Gõ \`ping\` → bot trả lời \`pong\`. Thử chuỗi: \`6\`, \`3\`, \`36\`, \`67\`, \`sixseven\`! Ai gõ \`sixseven\`/\`sixsenven\` sẽ được ảnh meme 🖼️', inline: false },
            { name: '✂️🪨📄 Oẳn tù tì', value: 'Gửi tin nhắn: \`kéo\`, \`búa\`, hoặc \`bao\`. Bot trả lời kết quả ngay!', inline: false },
          );

        const gameRow = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`game_caro_${channelId}`).setLabel('❌⭕ Caro').setStyle(ButtonStyle.Primary),
          new ButtonBuilder().setCustomId(`game_pingpong_${channelId}`).setLabel('🏓 Ping Pong').setStyle(ButtonStyle.Success),
        );

        await interaction.channel.send({ embeds: [guideEmbed], components: [gameRow] });
        return interaction.editReply({ content: `✅ Đã biến <#${channelId}> thành khu vui chơi! Chạy lại lệnh để tắt.` });
      }

      if (type === 'config') {
        const guildId = interaction.options.getString('id_nhóm') || interaction.guildId;
        const field = interaction.options.getString('trường');
        const value = interaction.options.getString('giá_trị');
        if (!field || !value) {
          return interaction.reply({ content: '❌ Cần nhập trường và giá trị! VD: `/setup loại: config trường: welcomeChannelId giá_trị: 123456789`', flags: 64 });
        }
        await interaction.deferReply({ flags: 64 });
        configHelper.setGuildField(guildId, field, value);
        return interaction.editReply({ content: `✅ Đã set \`${field}\` = \`${value}\` cho nhóm \`${guildId}\`` });
      }

      if (type === 'info') {
        const guildId = interaction.options.getString('id_nhóm');
        if (!guildId) {
          return interaction.reply({ content: '❌ Cần nhập id_nhóm! VD: `/setup loại: info id_nhóm: 123456789`', flags: 64 });
        }
        await interaction.deferReply({ flags: 64 });
        const guildConfig = configHelper.getGuildConfig(guildId);
        const overrideKeys = Object.keys(guildConfig).filter(k => ALL_CONFIG_FIELDS.includes(k));
        const embed = new EmbedBuilder()
          .setTitle(`📋 Config ID — Nhóm ${guildId}`)
          .setColor(0x5865F2);
        if (configHelper.isDefaultGuild(guildId) && overrideKeys.length === 0) {
          embed.addFields({ name: 'ℹ️', value: 'Server mặc định — dùng config.json' });
        }
        let desc = '';
        for (const key of ALL_CONFIG_FIELDS) {
          const val = configHelper.getConfig(guildId, key);
          const isOverride = guildConfig[key] !== undefined;
          desc += `**${key}:** \`${val || '❌ Chưa set'}\`${isOverride ? ' ⚡(override)' : ''}\n`;
        }
        embed.setDescription(desc);
        if (overrideKeys.length > 0) {
          let overrides = '';
          for (const key of overrideKeys) overrides += `**${key}:** \`${guildConfig[key]}\`\n`;
          embed.addFields({ name: 'Giá trị ghi đè', value: overrides });
        }
        return interaction.editReply({ embeds: [embed] });
      }

      return interaction.reply({ content: `❌ Loại \`${type}\` không hợp lệ!`, flags: 64 });
    }
  },

  removefromlist: {
    async execute(interaction, client) {
      const type = interaction.options.getString('loại');

      if (type === 'camdunggame') {
        const id = interaction.options.getString('id');
        if (!id) return interaction.reply({ content: '❌ Cần nhập ID!', flags: 64 });
        let list = jsonCache.readJSONArray(bannedGameUsersPath);
        list = list.filter(u => u !== id);
        jsonCache.writeJSON(bannedGameUsersPath, list);
        return interaction.reply({ content: `✅ Đã gỡ cấm game cho <@${id}>`, flags: 64 });
      }

      if (type === 'tudongxoa') {
        const id = interaction.options.getString('id');
        if (!id) return interaction.reply({ content: '❌ Cần nhập ID!', flags: 64 });
        let list = jsonCache.readJSONArray(autoDeleteUsersPath);
        list = list.filter(u => u !== id);
        jsonCache.writeJSON(autoDeleteUsersPath, list);
        return interaction.reply({ content: `✅ Đã bỏ auto xóa cho <@${id}>`, flags: 64 });
      }

      if (type === 'owner') {
        const id = interaction.options.getString('id');
        if (!id) return interaction.reply({ content: '❌ Cần nhập ID!', flags: 64 });
        await interaction.deferReply({ flags: 64 });
        configHelper.removeOwner(id);
        return interaction.editReply({ content: `✅ Đã xóa \`${id}\` khỏi danh sách chủ sở hữu!` });
      }

      if (type === 'noemojirole') {
        const id = interaction.options.getString('id');
        if (!id) return interaction.reply({ content: '❌ Cần nhập ID!', flags: 64 });
        const roleEmoji = require('./roleEmoji');
        roleEmoji.removeSkipRole(id);
        await interaction.deferReply({ flags: 64 });
        await roleEmoji.updateRoleMembers(interaction.guild, id);
        return interaction.editReply({ content: `✅ Đã xóa role \`${id}\` khỏi danh sách bỏ qua emoji và cập nhật lại emoji cho member!` });
      }

      if (type === 'bad') {
        const content = interaction.options.getString('nội_dung');
        if (!content) return interaction.reply({ content: '❌ Cần nhập nội dung!', flags: 64 });
        const wf = require('./automod/wordFilter');
        wf.removeBadWord(content);
        return interaction.reply({ content: `✅ Đã xóa từ/cụm từ bad: \`${content}\``, flags: 64 });
      }

    }
  },



  dmhis: {
    async execute(interaction, client) {
      const userId = interaction.options.getString('id');
      await interaction.deferReply({ flags: 64 });

      let user;
      try {
        user = await client.users.fetch(userId);
      } catch {
        return interaction.editReply({ content: `❌ Không tìm thấy user ID \`${userId}\`!` });
      }

      let dmChannel;
      try {
        dmChannel = await user.createDM();
      } catch {
        return interaction.editReply({ content: `❌ Không thể tạo DM với user này!` });
      }

      let allMessages = [];
      let lastId;
      while (true) {
        const fetched = await dmChannel.messages.fetch({ limit: 100, before: lastId });
        if (fetched.size === 0) break;
        allMessages.push(...fetched.values());
        lastId = fetched.last().id;
        if (allMessages.length >= 500) break;
      }

      if (allMessages.length === 0) {
        return interaction.editReply({ content: `📭 Không có tin nhắn nào trong DM với **${user.tag}**.` });
      }

      allMessages.reverse();
      const pageSize = 10;
      const totalPages = Math.ceil(allMessages.length / pageSize);
      let currentPage = 0;

      function buildEmbed(page) {
        const start = page * pageSize;
        const pageMsgs = allMessages.slice(start, start + pageSize);
        const embed = new EmbedBuilder()
          .setTitle(`💬 Lịch sử DM với ${user.tag}`)
          .setColor(0x5865F2)
          .setFooter({ text: `Trang ${page + 1}/${totalPages} • Tổng ${allMessages.length} tin` });

        for (const msg of pageMsgs) {
          const author = msg.author.id === client.user.id ? '🤖 Bot' : `👤 ${msg.author.tag}`;
          const time = `<t:${Math.floor(msg.createdTimestamp / 1000)}:f>`;
          let parts = [];
          if (msg.content) parts.push(msg.content);
          if (msg.attachments.size > 0) {
            parts.push(msg.attachments.map(a => `📎 [${a.name}](${a.url})`).join('\n'));
          }
          const value = parts.length > 0 ? parts.join('\n').slice(0, 800) : '*[sticker/embed]*';
          embed.addFields({ name: `${author} — ${time}`, value });
        }
        return embed;
      }

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('prev').setLabel('◀').setStyle(ButtonStyle.Secondary).setDisabled(true),
        new ButtonBuilder().setCustomId('next').setLabel('▶').setStyle(ButtonStyle.Secondary).setDisabled(totalPages <= 1),
        new ButtonBuilder().setCustomId('delete').setLabel('🗑').setStyle(ButtonStyle.Danger),
      );

      const reply = await interaction.editReply({ embeds: [buildEmbed(0)], components: [row] });
      const collector = reply.createMessageComponentCollector({ componentType: ComponentType.Button });

      collector.on('collect', async (i) => {
        try {
          if (i.customId === 'delete') {
            collector.stop();
            await i.update({ embeds: [], components: [], content: '🗑 Đã đóng.' });
            return;
          }

          if (i.user.id !== interaction.user.id) {
            await i.reply({ content: '❌ Bạn không thể điều khiển!', flags: 64 });
            return;
          }

          if (i.customId === 'next') currentPage = Math.min(currentPage + 1, totalPages - 1);
          if (i.customId === 'prev') currentPage = Math.max(currentPage - 1, 0);

          const newRow = ActionRowBuilder.from(row)
            .setComponents(
              new ButtonBuilder().setCustomId('prev').setLabel('◀').setStyle(ButtonStyle.Secondary).setDisabled(currentPage === 0),
              new ButtonBuilder().setCustomId('next').setLabel('▶').setStyle(ButtonStyle.Secondary).setDisabled(currentPage >= totalPages - 1),
              new ButtonBuilder().setCustomId('delete').setLabel('🗑').setStyle(ButtonStyle.Danger),
            );

          await i.update({ embeds: [buildEmbed(currentPage)], components: [newRow] });
        } catch (e) {
          if (e.code === 10062 || e.code === 10008) return;
          console.error('[dmhis] Button error:', e);
        }
      });

      collector.on('end', () => {
        reply.edit({ components: [] }).catch(() => {});
      });
    }
  },

  emojiup: {
    async execute(interaction, client) {
      if (!interaction.guild) return interaction.reply({ content: '❌ Lệnh này chỉ dùng được trong server!', flags: 64 });
      await interaction.deferReply({ flags: 64 });
      const roleEmoji = require('./roleEmoji');
      await roleEmoji.updateGuild(interaction.guild);
      await interaction.editReply({ content: '✅ Đã cập nhật emoji cho tất cả member trong server!' });
    }
  },

  settile: {
    async execute(interaction, client) {
      const statusPath = jsonCache.getPath('botStatus.json');
      const text = interaction.options.getString('nội_dung');

      if (!text) {
        jsonCache.writeJSON(statusPath, null);
        client.user.setActivity('/help | Super Bot', { type: 3 });
        return interaction.reply({ content: '✅ Đã reset trạng thái về mặc định!', flags: 64 });
      }

      jsonCache.writeJSON(statusPath, text);
      client.user.setActivity(text, { type: 3 });
      await interaction.reply({ content: `✅ Đã đổi trạng thái thành: \`${text}\``, flags: 64 });
    }
  },

  setting: {
    async execute(interaction, client) {
      if (!interaction.guild) return interaction.reply({ content: '❌ Lệnh này chỉ dùng được trong server!', flags: 64 });
      const s = settingsHelper.getSettings(interaction.guildId);
      const labels = settingsHelper.SETTING_LABELS;
      const embed = new EmbedBuilder()
        .setTitle('⚙️ Cài đặt tính năng')
        .setColor(0x5865F2)
        .setDescription('Bật/tắt các tính năng của bot cho server này.')
        .addFields(
          Object.keys(labels).map(k => ({
            name: labels[k],
            value: s[k] ? '✅ **Bật**' : '❌ **Tắt**',
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
            .setStyle(s[k] ? ButtonStyle.Success : ButtonStyle.Danger))
        ));
      }

      await interaction.reply({ embeds: [embed], components: rows, flags: 64 });
    }
  },

  help: {
    async execute(interaction, client) {
      const embed = new EmbedBuilder()
        .setTitle('📖 Hướng dẫn sử dụng Bot')
        .setColor(0x5865F2)
        .setDescription('Bot hỗ trợ quản lý server với nhiều tính năng tự động hóa.')
        .addFields(

          { name: '🎫 **Ticket & Game**', value:
            'Dùng `/setup loại: ticket/game` để tạo UI ticket/game.\n' +
            'Người dùng nhấn nút để mở kênh riêng.' },
          { name: '🔊 **Tạo kênh tạm**', value:
            'Dùng `/setup loại: channel` để tạo UI tạo kênh chat/voice tạm thời.' },
          { name: '🎮 **Game**', value:
            'Chơi Tic-Tac-Toe với AI (độ sâu 12, phát hiện thắng/chặn ngay).' },
          { name: '😊 **Emoji Nickname**', value:
            'Tự động thêm emoji từ role cao nhất vào đầu tên.\n' +
            'Dùng `/add loại: noemojirole` để bỏ qua role nhất định.\n' +
            'Dùng `/emojiup` để cập nhật hàng loạt.' },
          { name: '⚙️ **Quản lý**', value:
            '`/xoa` — Xóa tin nhắn (tối đa 1000).\n' +
            '`/camchat` / `/htcamchat` — Cấm/gỡ cấm chat.\n' +
            '`/lock` / `/unlock` — Khóa/mở kênh.\n' +
            '`/settile` — Đổi trạng thái bot.\n' +
            '`/setup loại: config` — Cấu hình ID cho server.' },
          { name: '📋 **Danh sách**', value:
            '`/add` — Thêm vào danh sách (từ cấm, ảnh cấm, game, owner, ...).\n' +
            '`/list` — Xem danh sách.\n' +
            '`/removefromlist` — Xóa khỏi danh sách.' },
          { name: '📩 **DM Relay**', value:
            'Tin nhắn DM gửi đến bot được relay vào kênh `dmRelayChannelId`.\n' +
            'Dùng `/dm` để gửi DM từ bot.' },
          { name: '🛠️ **Cấu hình**', value:
            'Dùng `/setup loại: config` để ghi đè cấu hình cho server.\n' +
            'Dùng `/setup loại: info` để xem cấu hình hiện tại.' },
        )
        .setFooter({ text: 'Super Bot — Hỗ trợ server 24/7' });

      await interaction.reply({ embeds: [embed], flags: 64 });
    }
  }
};

module.exports = commands;
