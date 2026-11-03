const { PermissionsBitField, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType } = require('discord.js');
const config = require('./config');
const jsonCache = require('./jsonCache');
const configHelper = require('./configHelper');
const dataHelper = require('./dataHelper');
const { retryFetch } = require('./utils');

const autoDeleteUsersPath = jsonCache.getPath('autoDeleteUsers.json');

const commands = {
  purge: {
    async execute(interaction, client) {
      if (!interaction.guild) return interaction.reply({ content: '❌ Lệnh này chỉ dùng được trong server!', flags: 64 });
      const amount = Math.min(interaction.options.getInteger('amount') || 1, 1000);
      const user = interaction.options.getUser('user');
      try { await interaction.deferReply({ flags: 64 }); } catch { return; }

      const channel = interaction.channel;
      let remaining = amount;
      let deleted = 0;
      let lastId = null;
      const TWO_WEEKS = 14 * 24 * 60 * 60 * 1000;

      while (remaining > 0) {
        const fetchOpts = { limit: Math.min(remaining, 100) };
        if (lastId) fetchOpts.before = lastId;
        let fetched;
        try { fetched = await channel.messages.fetch(fetchOpts); } catch (e) {
          console.log(`[purge] fetch lỗi giữa chừng, dừng lại: ${e.message}`);
          break;
        }
        if (fetched.size === 0) break;

        let toDelete = [...fetched.values()];
        if (user) toDelete = toDelete.filter(m => m.author.id === user.id);
        if (toDelete.length === 0) { lastId = fetched.last().id; continue; }

        const recent = toDelete.filter(m => Date.now() - m.createdTimestamp < TWO_WEEKS);
        const old = toDelete.filter(m => Date.now() - m.createdTimestamp >= TWO_WEEKS);

        if (recent.length > 0) {
          const bulkDeleted = await channel.bulkDelete(recent, true).catch(() => null);
          deleted += bulkDeleted ? bulkDeleted.size : 0;
        }
        if (old.length > 0) {
          for (let i = 0; i < old.length; i += 3) {
            const batch = old.slice(i, i + 3);
            const results = await Promise.allSettled(batch.map(m => m.delete().catch(() => null)));
            deleted += results.filter(r => r.status === 'fulfilled' && r.value !== null).length;
            if (i + 3 < old.length) await new Promise(r => setTimeout(r, 500));
          }
        }

        remaining -= toDelete.length;
        lastId = toDelete[toDelete.length - 1].id;
      }

      await interaction.editReply({ content: `✅ Đã xóa ${deleted} tin nhắn trong kênh <#${channel.id}>.` });
    }
  },

  mute: {
    async execute(interaction, client) {
      if (!interaction.guild) return interaction.reply({ content: '❌ Lệnh này chỉ dùng được trong server!', flags: 64 });
      const user = interaction.options.getUser('user');
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
        console.error('Lỗi mute:', e);
        await interaction.editReply({ content: '❌ Lỗi khi cấm chat!' });
      }
    }
  },

  unmute: {
    async execute(interaction, client) {
      if (!interaction.guild) return interaction.reply({ content: '❌ Lệnh này chỉ dùng được trong server!', flags: 64 });
      const user = interaction.options.getUser('user');
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

  say: {
    async execute(interaction, client) {
      if (!interaction.guild) return interaction.reply({ content: '❌ Lệnh này chỉ dùng được trong server!', flags: 64 });
      const type = interaction.options.getString('type');
      const content = interaction.options.getString('content');
      const file = interaction.options.getAttachment('file');
      const roleOption = interaction.options.getRole('role');
      const roleId = roleOption ? roleOption.id : null;
      const times = Math.min(interaction.options.getInteger('times') || 1, 5);
      await interaction.deferReply({ flags: 64 });

      if (!content && !file) {
        return interaction.editReply({ content: '❌ Vui lòng nhập nội dung hoặc tệp!' });
      }

      const payload = {};
      if (content) payload.content = content;
      if (file) payload.files = [file];

      if (type === 'dm') {
        const target = interaction.options.getUser('user');
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
          return interaction.editReply({ content: '❌ Vui lòng chọn Role!' });
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

  slowmode: {
    async execute(interaction, client) {
      if (!interaction.guild) return interaction.reply({ content: '❌ Lệnh này chỉ dùng được trong server!', flags: 64 });
      const seconds = interaction.options.getInteger('seconds');
      await interaction.channel.setRateLimitPerUser(seconds);
      await interaction.reply({ content: `✅ Đã set slowmode ${seconds}s`, flags: 64 });
    }
  },

  changelog: {
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
      const type = interaction.options.getString('type');

      if (type === 'all') {
        await interaction.deferReply({ flags: 64 });

        const roleEmoji = require('./roleEmoji');
        const wf = require('./automod/wordFilter');
        const emojiRoles = roleEmoji.listEmojiRoles();
        const owners = configHelper.listOwners();
        const autodel = jsonCache.readJSONArray(autoDeleteUsersPath);
        const setupChannels = dataHelper.getAllSetupChannelsFlat();
        const setupEntries = Object.entries(setupChannels);

        const embeds = [
          new EmbedBuilder()
            .setTitle('📋 Danh sách role có emoji')
            .setDescription(emojiRoles.length > 0 ? emojiRoles.map(id => `- <@&${id}>`).join('\n') : 'Không có')
            .setColor(0x5865F2),
          new EmbedBuilder()
            .setTitle('👑 Danh sách chủ sở hữu')
            .setDescription(owners.length > 0 ? owners.map(id => `- <@${id}>`).join('\n') : 'Không có')
            .setColor(0xFFD700),
          new EmbedBuilder()
            .setTitle('📡 Danh sách kênh setup')
            .setDescription(setupEntries.length > 0 ? setupEntries.map(([uid, chs]) => {
              const parts = [];
              if (chs.voice) parts.push(`${chs.voice}:${uid}`);
              return parts.join('\n') || 'Không có kênh';
            }).join('\n') : 'Không có')
            .setColor(0x5865F2),
          new EmbedBuilder()
            .setTitle('🗑️ Danh sách tự động xóa tin nhắn')
            .setDescription(autodel.length > 0 ? autodel.map(id => `- <@${id}>`).join('\n') : 'Không có')
            .setColor(0x57F287),
          new EmbedBuilder()
            .setTitle('🚫 Danh sách từ/cụm từ bad')
            .setDescription(wf.loadBadWords(interaction.guildId).length > 0 ? wf.loadBadWords(interaction.guildId).map(w => `- \`${w}\``).join('\n') : 'Không có')
            .setColor(0x000000),
        ];

        return interaction.editReply({ embeds });
      }

      if (type === 'emojiroles') {
        const webConfig = require('./webConfig');
        const list = webConfig.getFeature(interaction.guildId, 'emojiRole')?.roles || [];
        const desc = list.length > 0
          ? list.map(id => `- <@&${id}> (\`${id}\`)`).join('\n')
          : 'Chưa có role nào trong cấu hình web (emojiRole).';
        const embed = new EmbedBuilder()
          .setTitle('📋 Danh sách role có emoji')
          .setDescription(desc)
          .setColor(0x5865F2);
        return interaction.reply({ embeds: [embed], flags: 64 });
      }

      if (type === 'owners') {
        await interaction.deferReply({ flags: 64 });
        const owners = configHelper.listOwners();
        const embed = new EmbedBuilder()
          .setTitle('👑 Danh sách chủ sở hữu')
          .setDescription(owners.map(id => `- <@${id}> (\`${id}\`)`).join('\n'))
          .setColor(0xFFD700);
        return interaction.editReply({ embeds: [embed] });
      }

      if (type === 'autodelete') {
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

      if (type === 'badwords') {
        const wf = require('./automod/wordFilter');
        const guildName = interaction.guild?.name || 'Server';
        const list = wf.loadBadWords(interaction.guildId);
        const desc = list.length > 0
          ? list.map(w => `- \`${w}\``).join('\n')
          : 'Không có từ/cụm từ nào trong danh sách.';
        const embed = new EmbedBuilder()
          .setTitle(`🚫 Danh sách từ cấm — ${guildName}`)
          .setDescription(desc)
          .setColor(0x000000);
        return interaction.reply({ embeds: [embed], flags: 64 });
      }

      if (type === 'setup') {
        const setupChannels = dataHelper.getAllSetupChannelsFlat();
        const entries = Object.entries(setupChannels);
        const desc = entries.length > 0
          ? entries.map(([uid, chs]) => {
              const parts = [];
              if (chs.voice) parts.push(`${chs.voice}:${uid}`);
              return parts.join('\n') || 'Không có kênh';
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
      const type = interaction.options.getString('type');

      if (type === 'owners') {
        const id = interaction.options.getString('id');
        if (!id) return interaction.reply({ content: '❌ Cần nhập ID!', flags: 64 });
        await interaction.deferReply({ flags: 64 });
        if (id === config.ownerId) return interaction.editReply({ content: '❌ ID này là chủ sở hữu chính!' });
        configHelper.addOwner(id);
        return interaction.editReply({ content: `✅ Đã thêm \`${id}\` vào danh sách chủ sở hữu!` });
      }

      if (type === 'emojiroles') {
        return interaction.reply({ content: '❌ Quản lý emojiroles đã chuyển sang web cấu hình server. Chỉnh sửa qua giao diện web.', flags: 64 });
      }

      if (type === 'autodelete') {
        const id = interaction.options.getString('id');
        if (!id) return interaction.reply({ content: '❌ Cần nhập ID!', flags: 64 });
        const list = jsonCache.readJSONArray(autoDeleteUsersPath);
        if (!list.includes(id)) {
          list.push(id);
          jsonCache.writeJSON(autoDeleteUsersPath, list);
        }
        return interaction.reply({ content: `✅ Đã thêm <@${id}> vào danh sách auto xóa!`, flags: 64 });
      }

      if (type === 'badwords') {
        if (!interaction.guildId) return interaction.reply({ content: '❌ Chỉ dùng được trong server!', flags: 64 });
        const content = interaction.options.getString('content');
        if (!content) return interaction.reply({ content: '❌ Cần nhập nội dung!', flags: 64 });
        const wf = require('./automod/wordFilter');
        const added = wf.addBadWord(content, interaction.guildId);
        if (!added) return interaction.reply({ content: `⚠️ Từ \`${content}\` đã có trong danh sách!`, flags: 64 });
        return interaction.reply({ content: `✅ Đã thêm từ cấm \`${content}\` cho server này!`, flags: 64 });
      }
    }
  },

  test: {
    async execute(interaction, client) {
      const type = interaction.options.getString('type');

      if (type === 'text') {
        const content = interaction.options.getString('content');
        if (!content) return interaction.reply({ content: '❌ Cần nhập nội dung!', flags: 64 });
        const wf = require('./automod/wordFilter');
        const found = wf.checkContent(content, false, interaction.guildId);
        return interaction.reply({
          content: found
            ? `🚫 Nội dung \`${content}\` có chứa từ bad!`
            : `✅ Nội dung \`${content}\` an toàn.`,
          flags: 64,
        });
      }

      if (type === 'image') {
        const attachment = interaction.options.getAttachment('file');
        if (!attachment) return interaction.reply({ content: '❌ Cần đính kèm ảnh!', flags: 64 });
        if (!attachment.contentType?.startsWith('image/')) return interaction.reply({ content: '❌ File đính kèm phải là ảnh!', flags: 64 });
        await interaction.deferReply({ flags: 64 });
        try {
          const res = await fetch(attachment.url);
          if (!res.ok) return interaction.editReply({ content: '❌ Không thể tải ảnh!' });
          const buffer = Buffer.from(await res.arrayBuffer());
          const imageFilter = require('./automod/imageFilter');
          const r = await imageFilter.analyzeImage(buffer, interaction.guildId, attachment.contentType, interaction.client);
          const clamp = (s, n) => (s.length > n ? s.slice(0, n) + '…' : s);
          const parts = [];
          parts.push('📊 **KẾT QUẢ PHÂN TÍCH ẢNH**');
          const g = r.gemini;
          parts.push('**1️⃣ Gemini Vision**');
          if (g.error) {
            parts.push(`   Trạng thái: Lỗi — ${clamp(g.error, 200)}`);
          } else {
            parts.push(`   Model: ${g.model || 'N/A'}`);
            parts.push(`   Text: ${g.text ? '"' + clamp(g.text, 300) + '"' : '(không có chữ)'}`);
            if (g.badWords.length > 0) {
              parts.push(`   Bad words: "${g.badWords.slice(0, 10).join(', ')}"`);
            }
            parts.push(`   Kết quả: ${g.bad ? '🚫 BAD' : '✅ OK'}`);
          }
          if (r.bad) {
            parts.push(`➡️ **KẾT LUẬN**: 🚫 Ảnh chứa nội dung bad`);
          } else {
            parts.push(`➡️ **KẾT LUẬN**: ✅ Ảnh an toàn`);
          }
          const report = parts.join('\n');
          return interaction.editReply({ content: report.length > 2000 ? report.slice(0, 2000) : report });
        } catch (e) {
          return interaction.editReply({ content: `❌ Lỗi: ${e.message}` });
        }
      }
    }
  },

  setup: {
    async execute(interaction, client) {
      if (!interaction.guild) return interaction.reply({ content: '❌ Lệnh này chỉ dùng được trong server!', flags: 64 });
      let type = interaction.options.getString('type') || interaction.options.getSubcommand(false);

      if (!type) {
        return interaction.reply({ content: '❌ Không xác định được loại! Vui lòng thử lại.', flags: 64 });
      }

      if (type === 'ticket') {
        await interaction.deferReply({ flags: 64 });
        const webConfig = require('./webConfig');
        const t = webConfig.getFeature(interaction.guildId, 'ticket') || {};
        const content = (t.panel && t.panel.content && t.panel.content.trim())
          ? t.panel.content
          : 'Nhấn nút bên dưới để mở ticket hỗ trợ.';
        const color = (t.panel && typeof t.panel.color === 'number') ? t.panel.color : 0x5865F2;
        // Tiêu đề + nhãn nút: đọc từ web panel (để trống = dùng chuỗi mặc định cũ).
        const panelTitle = (t.panel && t.panel.title && String(t.panel.title).trim()) ? String(t.panel.title).trim() : '🎫 Hỗ trợ';
        const panelButton = (t.panel && t.panel.button && String(t.panel.button).trim()) ? String(t.panel.button).trim() : '🎫 Mở Ticket';
        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('create_ticket').setLabel(panelButton).setStyle(ButtonStyle.Primary)
        );
        const embed = new EmbedBuilder()
          .setTitle(panelTitle)
          .setDescription(content)
          .setColor(color);
        await interaction.channel.send({ embeds: [embed], components: [row] });
        return interaction.editReply({ content: '✅ Đã tạo UI ticket!' });
      }

      return interaction.reply({ content: `❌ Loại \`${type}\` không hợp lệ!`, flags: 64 });
    }
  },

  remove: {
    async execute(interaction, client) {
      const type = interaction.options.getString('type');

      if (type === 'autodelete') {
        const id = interaction.options.getString('id');
        if (!id) return interaction.reply({ content: '❌ Cần nhập ID!', flags: 64 });
        let list = jsonCache.readJSONArray(autoDeleteUsersPath);
        list = list.filter(u => u !== id);
        jsonCache.writeJSON(autoDeleteUsersPath, list);
        return interaction.reply({ content: `✅ Đã bỏ auto xóa cho <@${id}>`, flags: 64 });
      }

      if (type === 'owners') {
        const id = interaction.options.getString('id');
        if (!id) return interaction.reply({ content: '❌ Cần nhập ID!', flags: 64 });
        await interaction.deferReply({ flags: 64 });
        configHelper.removeOwner(id);
        return interaction.editReply({ content: `✅ Đã xóa \`${id}\` khỏi danh sách chủ sở hữu!` });
      }

      if (type === 'emojiroles') {
        return interaction.reply({ content: '❌ Quản lý emojiroles đã chuyển sang web cấu hình server.', flags: 64 });
      }

      if (type === 'badwords') {
        if (!interaction.guildId) return interaction.reply({ content: '❌ Chỉ dùng được trong server!', flags: 64 });
        const content = interaction.options.getString('content');
        if (!content) return interaction.reply({ content: '❌ Cần nhập nội dung!', flags: 64 });
        const wf = require('./automod/wordFilter');
        const removed = wf.removeBadWord(content, interaction.guildId);
        return interaction.reply({ content: removed ? `✅ Đã xóa từ cấm \`${content}\` cho server này!` : `❌ Không tìm thấy \`${content}\` trong danh sách.`, flags: 64 });
      }

    }
  },



  dmhistory: {
    async execute(interaction, client) {
      const user = interaction.options.getUser('user');
      await interaction.deferReply({ flags: 64 });

      let dmChannel;
      try {
        dmChannel = await user.createDM();
      } catch {
        return interaction.editReply({ content: `❌ Không thể tạo DM với **${user.tag}**!` });
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
        new ButtonBuilder().setCustomId('dmhis_prev').setLabel('◀').setStyle(ButtonStyle.Secondary).setDisabled(true),
        new ButtonBuilder().setCustomId('dmhis_next').setLabel('▶').setStyle(ButtonStyle.Secondary).setDisabled(totalPages <= 1),
        new ButtonBuilder().setCustomId('dmhis_delete').setLabel('🗑').setStyle(ButtonStyle.Danger),
      );

      const reply = await interaction.editReply({ embeds: [buildEmbed(0)], components: [row] });
      const collector = reply.createMessageComponentCollector({ componentType: ComponentType.Button, customId: ['dmhis_prev', 'dmhis_next', 'dmhis_delete'], time: 5 * 60 * 1000 });

      collector.on('collect', async (i) => {
        try {
          if (i.customId === 'dmhis_delete') {
            collector.stop();
            await i.update({ embeds: [], components: [], content: '🗑 Đã đóng.' });
            return;
          }

          if (i.user.id !== interaction.user.id) {
            await i.reply({ content: '❌ Bạn không thể điều khiển!', flags: 64 });
            return;
          }

          if (i.customId === 'dmhis_next') currentPage = Math.min(currentPage + 1, totalPages - 1);
          if (i.customId === 'dmhis_prev') currentPage = Math.max(currentPage - 1, 0);

          const newRow = ActionRowBuilder.from(row)
            .setComponents(
              new ButtonBuilder().setCustomId('dmhis_prev').setLabel('◀').setStyle(ButtonStyle.Secondary).setDisabled(currentPage === 0),
              new ButtonBuilder().setCustomId('dmhis_next').setLabel('▶').setStyle(ButtonStyle.Secondary).setDisabled(currentPage >= totalPages - 1),
              new ButtonBuilder().setCustomId('dmhis_delete').setLabel('🗑').setStyle(ButtonStyle.Danger),
            );

          await i.update({ embeds: [buildEmbed(currentPage)], components: [newRow] });
        } catch (e) {
          if (e.code === 10062 || e.code === 10008) return;
          console.error('[dmhistory] Button error:', e);
        }
      });

      collector.on('end', () => {
        reply.edit({ components: [] }).catch(() => {});
      });
    }
  },

  emojisync: {
    async execute(interaction, client) {
      if (!interaction.guild) return interaction.reply({ content: '❌ Lệnh này chỉ dùng được trong server!', flags: 64 });
      await interaction.deferReply({ flags: 64 });
      const roleEmoji = require('./roleEmoji');
      await roleEmoji.updateGuild(interaction.guild);
      await interaction.editReply({ content: '✅ Đã cập nhật emoji cho tất cả member trong server!' });
    }
  },

  reactionroles: {
    async execute(interaction, client) {
      if (!interaction.guild) return interaction.reply({ content: '❌ Lệnh này chỉ dùng được trong server!', flags: 64 });
      const pickrole = require('./features/pickrole');
      return pickrole.sendPanel(interaction);
    }
  },

  help: {
    async execute(interaction, client) {
      const page = interaction.options.getString('page') || 'start';

      const pages = {
        start: new EmbedBuilder()
          .setTitle('📖 Hướng dẫn sử dụng Bot — Bắt đầu')
          .setColor(0x5865F2)
          .setDescription('Chào mừng! Đây là hướng dẫn từ A-Z để sử dụng bot.\nDùng `/help page: ...` để xem từng phần.')
          .addFields(
            { name: '1️⃣ Cấu hình server', value:
              'Cấu hình server hiện được quản lý trên **web**: https://minhtu446.github.io/discord-bot/#\n' +
              '• Các trường `welcomeChannelId`, `logChannelId`, `ticketCategoryId`, `setupCategoryId`, `memberRoleId`, `dmRelayChannelId` sẽ dần được thêm lên web.' },
            { name: '2️⃣ Xem cấu hình hiện tại', value:
              '`/list type: all` — Xem toàn bộ dữ liệu bot.' },
            { name: '3️⃣ Tạo UI cho người dùng', value:
              '`/setup type: ticket` — Tạo nút mở ticket.\n' +
              '`/reactionroles` — Gửi panel chọn role (cấu hình trên web).\n' +
              'Kênh voice: thành viên bấm vào **kênh voice hub** đã cấu hình để tự tạo phòng riêng.' },
            { name: '📋 Các trang khác', value:
              '• `/help page: moderation` — Quản lý & moderation\n' +
              '• `/help page: automod` — Auto-moderation\n' +
              '• `/help page: lists` — Quản lý danh sách\n' +
              '• `/help page: misc` — Lệnh khác & prefix' },
          )
          .setFooter({ text: 'Super Bot — Trang 1/4' }),

        moderation: new EmbedBuilder()
          .setTitle('🛠️ Quản lý & Moderation')
          .setColor(0xED4245)
          .addFields(
            { name: '🗑️ Xóa tin nhắn', value:
              '`/purge amount: 50` — Xóa 50 tin nhắn gần nhất.\n' +
              '`/purge amount: 100 user: @user` — Xóa tin của user.' },
            { name: '🚫 Cấm chat', value:
              '`/mute user: @user` — Cấm user chat.\n' +
              '`/unmute user: @user` — Gỡ cấm.' },
            { name: '🔒 Khóa kênh', value:
              '`/lock` — Khóa kênh hiện tại.\n' +
              '`/unlock` — Mở kênh.' },
            { name: '💬 Gửi tin nhắn', value:
              '`/say type: bot content: Hello` — Bot gửi tin.\n' +
              '`/say type: role role: @role content: ...` — Gửi DM tới role.\n' +
              '`/say type: dm user: @user content: ...` — Gửi DM.\n' +
              '`/say type: bot times: 5` — Gửi nhiều lần.' },
            { name: '⚡ Slowmode', value:
              '`/slowmode seconds: 10` — Set slowmode 10 giây.' },
            { name: '🔍 Quét badword', value:
              '`/scan` — Quét toàn server (chỉ xem).\n' +
              '`/scan delete: true` — Quét và xóa tin badword.' },
            { name: '📊 Xem lịch sử DM', value:
              '`/dmhistory user: @user` — Xem lịch sử DM với user.' },
            { name: '🧪 Test', value:
              '`/test type: text content: ...` — Test badword.\n' +
              '`/test type: image file: [ảnh]` — Test OCR.' },
          )
          .setFooter({ text: 'Super Bot — Trang 2/4' }),

        automod: new EmbedBuilder()
          .setTitle('🛡️ Auto-Moderation')
          .setColor(0xFEE75C)
          .addFields(
            { name: '🔤 Chống badword', value:
              '• Tự động xóa tin nhắn chứa từ cấm.\n' +
              '• Hỗ trợ: text, ảnh (OCR), edit tin nhắn.\n' +
              '• Quét khi bot start: xóa toàn bộ tin cũ chứa badword.\n' +
              '• Ảnh: Gemini Vision đọc chữ + phát hiện badword.' },
            { name: '🔗 Chống link', value:
              '• Tự động xóa tin chứa link (nếu bật).' },
            { name: '🔠 Chống caps', value:
              '• Tự động xóa tin viết HOA quá nhiều (nếu bật).' },
            { name: '📸 Chống ảnh spam', value:
              '• Gemini Vision đọc ảnh → phát hiện badword trong ảnh.\n' +
              '• Timeout ~35s, không cần OCR local.' },
            { name: '✏️ Edit bypass', value:
              '• Khi user edit tin nhắn → check lại badword.\n' +
              '• Nếu match → xóa tin đã edit.' },
            { name: '⚙️ Bật/tắt', value:
              'Các tùy chỉnh: `antiSpam`, `antiLink`, `antiCaps`, `dmRelay`...' },
          )
          .setFooter({ text: 'Super Bot — Trang 3/4' }),

        lists: new EmbedBuilder()
          .setTitle('📋 Quản lý danh sách')
          .setColor(0x9B59B6)
          .addFields(
            { name: '➕ Thêm vào danh sách', value:
              '`/add type: owners id: 123` — Thêm owner.\n' +
              '`/add type: autodelete id: 123` — Auto-xóa tin user.\n' +
              '`/add type: badwords content: từ_cấm` — Thêm từ cấm.' },
            { name: '➖ Xóa khỏi danh sách', value:
              '`/remove type: owners id: 123`\n' +
              '`/remove type: autodelete id: 123`\n' +
              '`/remove type: badwords content: từ_cấm`' },
            { name: '👁️ Xem danh sách', value:
              '`/list type: all` — Xem tất cả.\n' +
              '`/list type: owners` — Danh sách owner.\n' +
              '`/list type: autodelete` — Danh sách auto-xóa.\n' +
              '`/list type: emojiroles` — Role có emoji.\n' +
              '`/list type: badwords` — Từ cấm.\n' +
              '`/list type: setup` — Kênh setup.' },
            { name: '😊 Emoji Nickname', value:
              '• Tự động thêm emoji từ role có emoji (cấu hình per-guild trên web).\n' +
              '`/emojisync` — Cập nhật emoji cho tất cả member.\n' +
              '`/list type: emojiroles` — Xem role có emoji (từ web).' },
          )
          .setFooter({ text: 'Super Bot — Trang 4/4' }),

        misc: new EmbedBuilder()
          .setTitle('📌 Lệnh khác')
          .setColor(0x5865F2)
          .addFields(
            { name: '📩 DM Relay', value:
              '• Tin nhắn DM → bot forward vào kênh relay.\n' +
              '• Bot tìm server mà user là member → forward về server đó.\n' +
              '• `/say type: dm user: @user content: ...` — Gửi DM từ bot.' },
            { name: '🎫 Ticket', value:
              '`/setup type: ticket` — Tạo nút mở ticket.\n' +
              '• User bấm nút → tạo kênh riêng.\n' +
              '• Bấm 🔒 để đóng ticket.' },
            { name: '📺 GitHub Pages', value:
              '• Web control panel: `https://minhtu446.github.io/discord-bot/`\n' +
              '• Bật/tắt/restart bot từ xa.\n' +
              '• Real-time status monitoring.' },
            { name: '⚠️ Lưu ý quan trọng', value:
              '• Bot cần **Administrator** permission trong server.\n' +
              '• Phân quyền: chỉ **owner** mới dùng được lệnh quản lý.\n' +
              '• `/help` là lệnh duy nhất ai cũng dùng được.\n' +
              '• DM bot → tự relay vào server (nếu đã cấu hình).' },
          )
          .setFooter({ text: 'Super Bot — Bonus' }),
      };

      const embed = pages[page] || pages.start;
      await interaction.reply({ embeds: [embed], flags: 64 });
    }
  },

  scan: {
    slow: true,
    async execute(interaction) {
      if (!interaction.guild) return interaction.editReply({ content: '❌ Lệnh này chỉ dùng được trong server!' });

      const shouldDelete = interaction.options.getBoolean('delete') || false;
      const wordFilter = require('./automod/wordFilter');
      const channels = interaction.guild.channels.cache.filter(c => c.isTextBased() && c.viewable);

      if (channels.size === 0) return interaction.editReply({ content: '❌ Không có kênh text nào!' });

      await interaction.editReply({ content: `🔍 Đang quét **${channels.size}** kênh...` });

      const results = [];
      let totalChecked = 0;
      let totalBad = 0;
      let scanned = 0;

      for (const [, channel] of channels) {
        scanned++;
        let lastId = null;
        let channelBad = 0;
        let channelChecked = 0;

        await interaction.editReply({ content: `🔍 Đang quét **${channel.name}** (${scanned}/${channels.size})...\nTin nhắn đã check: ${totalChecked} | Badword: ${totalBad}` }).catch(() => {});

        while (true) {
          const opts = { limit: 100 };
          if (lastId) opts.before = lastId;
          let messages;
          try {
            messages = await channel.messages.fetch(opts);
          } catch { break; }
          if (messages.size === 0) break;

          for (const [, msg] of messages) {
            if (msg.author.bot) continue;
            channelChecked++;
            totalChecked++;
            if (wordFilter.checkContent(msg.content, false, interaction.guild.id)) {
              channelBad++;
              totalBad++;
              if (shouldDelete) {
                await msg.delete().catch(() => {});
              }
            }
          }

          lastId = messages.last()?.id;
          if (messages.size < 100) break;
        }

        if (channelBad > 0) {
          results.push(`**#${channel.name}**: ${channelBad} tin nhắn${shouldDelete ? ' (đã xóa)' : ''}`);
        }
      }

      const summary = shouldDelete
        ? `✅ Đã quét **${totalChecked}** tin nhắn — xóa **${totalBad}** tin nhắn badword`
        : `✅ Đã quét **${totalChecked}** tin nhắn — tìm thấy **${totalBad}** tin nhắn badword`;

      if (results.length === 0) {
        await interaction.editReply({ content: `${summary}\n\n🎉 Không có badword nào!` }).catch(() => {});
      } else {
        const list = results.slice(0, 20).join('\n');
        const more = results.length > 20 ? `\n... và ${results.length - 20} kênh nữa` : '';
        await interaction.editReply({ content: `${summary}\n\n${list}${more}` }).catch(() => {});
      }
    }
  }
};

module.exports = commands;
