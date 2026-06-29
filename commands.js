const { PermissionsBitField, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType } = require('discord.js');
const config = require('./config');
const jsonCache = require('./jsonCache');
const configHelper = require('./configHelper');

const bannedWordsPath = jsonCache.getPath('bannedWords.json');
const bannedImagesPath = jsonCache.getPath('bannedImages.json');
const bannedGameUsersPath = jsonCache.getPath('bannedGameUsers.json');
const autoDeleteUsersPath = jsonCache.getPath('autoDeleteUsers.json');

const antiaihoianh = require('./automod/imageFilter');
const antiaiho = require('./automod/wordFilter');
const settingsHelper = require('./settingsHelper');

const ALL_CONFIG_FIELDS = [
  'welcomeChannelId', 'logChannelId',
  'ticketCategoryId', 'gameCategoryId', 'memberRoleId',
  'setupCategoryId', 'dmRelayChannelId'
];

const commands = {
  xoa: {
    async execute(interaction, client) {
      const amount = Math.min(interaction.options.getInteger('số_lượng') || 1, 1000);
      const user = interaction.options.getUser('người_dùng');
      await interaction.deferReply({ flags: 64 });

      let remaining = amount;
      let deleted = 0;
      let lastId = null;
      const TWO_WEEKS = 14 * 24 * 60 * 60 * 1000;

      while (remaining > 0) {
        const fetchOpts = { limit: Math.min(remaining, 100) };
        if (lastId) fetchOpts.before = lastId;
        const fetched = await interaction.channel.messages.fetch(fetchOpts);
        if (fetched.size === 0) break;

        let toDelete = [...fetched.values()];
        if (user) toDelete = toDelete.filter(m => m.author.id === user.id);
        if (toDelete.length === 0) { lastId = fetched.last().id; continue; }

        const recent = toDelete.filter(m => Date.now() - m.createdTimestamp < TWO_WEEKS);
        const old = toDelete.filter(m => Date.now() - m.createdTimestamp >= TWO_WEEKS);

        if (recent.length > 0) {
          await interaction.channel.bulkDelete(recent, true).catch(() => {});
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

      await interaction.editReply({ content: `✅ Đã xóa ${deleted} tin nhắn.` });
    }
  },

  camchat: {
    async execute(interaction, client) {
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
      const everyone = interaction.guild.roles.everyone;
      await interaction.channel.permissionOverwrites.edit(everyone, {
        SendMessages: null
      }).catch(() => {});
      await interaction.reply({ content: '🔓 Kênh đã mở khóa!', flags: 64 });
    }
  },

  msg: {
    async execute(interaction, client) {
      const type = interaction.options.getString('loại');
      const targetId = interaction.options.getString('id');
      const content = interaction.options.getString('nội_dung');
      const file = interaction.options.getAttachment('tệp');
      await interaction.deferReply({ flags: 64 });

      if (!content && !file) {
        return interaction.editReply({ content: '❌ Vui lòng nhập nội dung hoặc tệp!' });
      }

      const payload = {};
      if (content) payload.content = content;
      if (file) payload.files = [file];

      if (type === 'dm') {
        if (!targetId) {
          return interaction.editReply({ content: '❌ Vui lòng nhập ID người nhận!' });
        }
        try {
          let user;
          try {
            user = await client.users.fetch(targetId, { force: true });
          } catch {
            return interaction.editReply({ content: `❌ ID \`${targetId}\` không hợp lệ!` });
          }
          try {
            const dm = await user.createDM();
            await dm.send(payload);
            return interaction.editReply({ content: `✅ Đã gửi DM cho **${user.tag}**!` });
          } catch (err) {
            if (err.code === 50007) {
              let invite = '';
              try {
                const guild = interaction.guild;
                if (guild) {
                  const ch = guild.channels.cache.find(c => c.isTextBased() && !c.isDMBased()) || interaction.channel;
                  const inv = await ch.createInvite({ maxAge: 86400, maxUses: 1, reason: 'Mời người ngoài server' });
                  invite = `\nLink mời: ${inv.url} (hết hạn sau 24h, 1 lần dùng)`;
                }
              } catch {}
              return interaction.editReply({ content: `❌ Không thể DM **${user.tag}**! Người dùng cần vào server trước hoặc từng nhắn bot.\n📨 Hãy gửi link mời cho họ để họ tham gia server, sau đó thử lại.${invite}` });
            }
            console.error('Lỗi msg dm:', err.message);
            return interaction.editReply({ content: `❌ Lỗi khi gửi DM: ${err.message}` });
          }
        } catch (e) {
          console.error('Lỗi msg dm:', e.message);
          await interaction.editReply({ content: `❌ Lỗi: ${e.message}` });
        }
      } else {
        await interaction.channel.send(payload);
        await interaction.editReply({ content: '✅ Đã gửi tin nhắn!' });
      }
    }
  },

  setslowmode: {
    async execute(interaction, client) {
      const seconds = interaction.options.getInteger('giây');
      await interaction.channel.setRateLimitPerUser(seconds);
      await interaction.reply({ content: `✅ Đã set slowmode ${seconds}s`, flags: 64 });
    }
  },

  update: {
    async execute(interaction, client) {
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

  botucam: {
    async execute(interaction, client) {
      const amount = interaction.options.getInteger('số_lượng');
      const user = interaction.options.getUser('người_dùng');
      await interaction.deferReply({ flags: 64 });

      const messages = await interaction.channel.messages.fetch({ limit: Math.min(amount, 100) });
      const list = jsonCache.readJSONArray(bannedWordsPath);
      let deleted = 0;

      for (const [, msg] of messages) {
        if (user && msg.author.id !== user.id) continue;
        const content = msg.cleanContent.toLowerCase().replace(/[^a-z]/g, '');
        if (list.some(w => content.includes(w))) {
          await msg.delete().catch(() => {});
          deleted++;
        }
      }
      await interaction.editReply({ content: `✅ Đã xóa ${deleted} tin nhắn vi phạm.` });
    }
  },

  list: {
    async execute(interaction, client) {
      const type = interaction.options.getString('loại');

      if (type === 'anti') {
        const words = jsonCache.readJSONArray(bannedWordsPath);
        const images = jsonCache.readJSONArray(bannedImagesPath);
        const bannedUsers = jsonCache.readJSONArray(bannedGameUsersPath);
        const autoDelete = jsonCache.readJSONArray(autoDeleteUsersPath);

        let desc = '';
        desc += `**Từ cấm:** \`${words.length}\` từ\n`;
        if (words.length > 0) desc += `> ${words.slice(0, 20).join(', ')}${words.length > 20 ? `... (+${words.length - 20})` : ''}\n\n`;

        desc += `**Ảnh cấm:** \`${images.length}\` ảnh\n\n`;

        desc += `**User cấm game:** \`${bannedUsers.length}\` user\n`;
        if (bannedUsers.length > 0) desc += `> ${bannedUsers.map(id => `<@${id}>`).join(', ')}\n\n`;

        desc += `**Auto xóa:** \`${autoDelete.length}\` user\n`;
        if (autoDelete.length > 0) desc += `> ${autoDelete.map(id => `<@${id}>`).join(', ')}`;

        const embed = new EmbedBuilder()
          .setTitle('🛡️ Danh sách anti')
          .setDescription(desc || 'Không có dữ liệu')
          .setColor(0x5865F2);
        return interaction.reply({ embeds: [embed], flags: 64 });
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
    }
  },

  add: {
    async execute(interaction, client) {
      const type = interaction.options.getString('loại');

      if (type === 'anhbay') {
        const image = interaction.options.getAttachment('ảnh');
        if (!image) return interaction.reply({ content: '❌ Cần đính kèm ảnh!', flags: 64 });
        await interaction.deferReply({ flags: 64 });
        const hash = await antiaihoianh.getDHash(image.url).catch(() => null);
        if (!hash) return interaction.editReply({ content: '❌ Không thể xử lý ảnh.' });
        const imgList = jsonCache.readJSONArray(bannedImagesPath);
        if (imgList.find(h => h.hash === hash)) return interaction.editReply({ content: '⚠️ Ảnh này đã có trong danh sách!' });
        imgList.push({ hash, url: image.url });
        jsonCache.writeJSON(bannedImagesPath, imgList);
        return interaction.editReply({ content: `✅ Đã thêm ảnh vào danh sách cấm! (\`${hash}\`)` });
      }

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

      if (type === 'tucam') {
        const word = interaction.options.getString('văn_bản');
        const file = interaction.options.getAttachment('tệp');
        if (!word && !file) return interaction.reply({ content: '❌ Cần nhập từ hoặc đính kèm file!', flags: 64 });
        await interaction.deferReply({ flags: 64 });
        const list = jsonCache.readJSONArray(bannedWordsPath);
        let count = 0;
        if (word) {
          const w = word.toLowerCase();
          if (!list.includes(w)) { list.push(w); count++; }
        }
        if (file) {
          try {
            const res = await fetch(file.url);
            const text = await res.text();
            const words = text.split(/[\n\r,]+/).map(w => w.trim().toLowerCase()).filter(Boolean);
            words.forEach(w => { if (!list.includes(w)) { list.push(w); count++; } });
          } catch { return interaction.editReply({ content: '❌ Không thể đọc file!' }); }
        }
        jsonCache.writeJSON(bannedWordsPath, list);
        antiaiho.refreshCache();
        return interaction.editReply({ content: `✅ Đã thêm ${count} từ vào danh sách cấm!` });
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
    }
  },

  setup: {
    async execute(interaction, client) {
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

      if (type === 'noitucc') {
        await interaction.deferReply({ flags: 64 });
        try {
          const noituChannel = require('./noituChannel');
          await noituChannel.initChannel(interaction.channel, false, true);
          await interaction.editReply({ content: `✅ Đã kích hoạt nối từ cộng đồng trong kênh này! Ai cũng có thể nhắn từ nối.` });
        } catch (e) {
          console.error('Lỗi noitucc:', e);
          await interaction.editReply({ content: '❌ Lỗi kích hoạt nối từ!' });
        }
        return;
      }

      if (type === 'channelandgame') {
        await interaction.deferReply();
        const embed = new EmbedBuilder()
          .setTitle('Tạo kênh & Game')
          .setDescription('Chọn loại kênh muốn tạo:')
          .setColor(0x5865F2);
        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('create_game_channel').setLabel('🎮 Kênh Game').setStyle(ButtonStyle.Success),
          new ButtonBuilder().setCustomId('create_chat_channel').setLabel('💬 Kênh Chat').setStyle(ButtonStyle.Primary),
          new ButtonBuilder().setCustomId('create_voice_channel').setLabel('🔊 Kênh Voice').setStyle(ButtonStyle.Secondary)
        );
        return interaction.editReply({ embeds: [embed], components: [row] });
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

      if (type === 'tucam') {
        const word = interaction.options.getString('văn_bản');
        const image = interaction.options.getAttachment('ảnh');
        if (!word && !image) return interaction.reply({ content: '❌ Cần nhập từ hoặc đính kèm ảnh!', flags: 64 });
        await interaction.deferReply({ flags: 64 });
        if (word) {
          let list = jsonCache.readJSONArray(bannedWordsPath);
          list = list.filter(w => w !== word.toLowerCase());
          jsonCache.writeJSON(bannedWordsPath, list);
          antiaiho.refreshCache();
        }
        if (image) {
          const hash = await antiaihoianh.getDHash(image.url).catch(() => null);
          if (hash) {
            let imgList = jsonCache.readJSONArray(bannedImagesPath);
            imgList = imgList.filter(h => h.hash !== hash);
            jsonCache.writeJSON(bannedImagesPath, imgList);
          }
        }
        return interaction.editReply({ content: '✅ Đã xóa khỏi danh sách cấm!' });
      }
    }
  },

  test: {
    async execute(interaction, client) {
      const image = interaction.options.getAttachment('ảnh');
      const video = interaction.options.getAttachment('video');
      const word = interaction.options.getString('từ');
      await interaction.deferReply({ flags: 64 });

      if (word) {
        const list = jsonCache.readJSONArray(bannedWordsPath);
        const cleaned = word.toLowerCase().replace(/[^a-z]/g, '');
        const found = list.some(w => cleaned.includes(w));
        return interaction.editReply({ content: found ? '⚠️ Từ này có trong danh sách cấm!' : '✅ Từ này an toàn.' });
      }
      if (image) {
        const hash = await antiaihoianh.getDHash(image.url).catch(() => null);
        if (!hash) return interaction.editReply({ content: '❌ Không thể xử lý ảnh.' });
        const imgList = jsonCache.readJSONArray(bannedImagesPath);
        const match = imgList.find(h => {
          let diff = 0;
          for (let i = 0; i < hash.length; i++) {
            if (hash[i] !== h.hash[i]) diff++;
          }
          return diff < 6;
        });
        return interaction.editReply({ content: match ? '⚠️ Ảnh này đã có trong danh sách cấm!' : '✅ Ảnh này an toàn.' });
      }
      if (video) {
        await interaction.editReply({ content: '⏳ Đang xử lý video...' });
        try {
          const result = await antiaihoianh.testVideo(video.url);
          if (!result) return interaction.editReply({ content: '❌ Không thể trích xuất âm thanh từ video.' });
          let msg = `🔁 Lặp: ${result.repetition ? '⚠️' : '✅'}\n`;
          msg += `📈 Earrape: ${result.earrape ? '⚠️' : '✅'}\n`;
          msg += `🗣️ Giọng: ${result.voice ? '⚠️' : '✅'}\n`;
          msg += `🎤 **Transcript:**\n${(result.transcript || '').substring(0, 1500)}`;
          const banned = antiaihoianh.checkBanned(result.transcript || '');
          msg += `\n\n${banned ? '⚠️ Có từ cấm!' : '✅ Không có từ cấm.'}`;
          return interaction.editReply({ content: msg });
        } catch (e) {
          return interaction.editReply({ content: `❌ Lỗi: ${e.message.substring(0, 200)}` });
        }
      }
      await interaction.editReply({ content: '❌ Vui lòng cung cấp ảnh, video hoặc từ để test.' });
    }
  },

  dm: {
    async execute(interaction, client) {
      const target = interaction.options.getUser('người_dùng');
      const content = interaction.options.getString('nội_dung');
      await interaction.deferReply({ flags: 64 });

      try {
        await target.send({ content: `📨 **${interaction.user.tag}**: ${content}` });
        await interaction.editReply({ content: `✅ Đã gửi DM cho ${target.tag}!` });
      } catch (e) {
        await interaction.editReply({ content: `❌ Không thể gửi DM cho ${target.tag}! (người dùng đã tắt DM hoặc không có mutual server)` });
      }
    }
  },

  emojiup: {
    async execute(interaction, client) {
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
          { name: '🛡️ **Automod**', value:
            '**Từ cấm:** Tự động phát hiện và xóa tin nhắn chứa từ nhạy cảm (có hỗ trợ leet speak, normalize).\n' +
            '**Ảnh cấm:** Quét OCR và dHash để phát hiện ảnh vi phạm.\n' +
            '**Video/Âm thanh:** Dùng Whisper STT + ffmpeg frame extraction.\n' +
            '**Chống spam:** >8 tin nhắn/5s → timeout 10s, 3 lần vi phạm → cấm chat 1h.' },
          { name: '🎫 **Ticket & Game**', value:
            'Dùng `/setup loại: ticket/game` để tạo UI ticket/game.\n' +
            'Người dùng nhấn nút để mở kênh riêng.' },
          { name: '🔊 **Tạo kênh tạm**', value:
            'Dùng `/setup loại: channel` để tạo UI tạo kênh chat/voice tạm thời.' },
          { name: '🎮 **Game**', value:
            'Chơi Tic-Tac-Toe với AI (độ sâu 12, phát hiện thắng/chặn ngay).\n' +
            'Các game khác qua kênh game tạm.' },
          { name: '🎵 **Nhạc**', value:
            'Phát nhạc YouTube với lệnh `PLAYMUSIC <từ khóa>` trong chat.\n' +
            'Hỗ trợ phát trực tiếp, fetch metadata qua yt-dlp.' },
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
