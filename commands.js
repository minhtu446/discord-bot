const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType } = require('discord.js');
const config = require('./config');
const jsonCache = require('./jsonCache');
const configHelper = require('./configHelper');
const dataHelper = require('./dataHelper');
const { retryFetch } = require('./utils');
const muteScheduler = require('./muteScheduler');

const autoDeleteUsersPath = jsonCache.getPath('autoDeleteUsers.json');

// Ghi log hành động moderation vào kênh log của guild (nếu server cấu hình và bật logging).
function logModAction(guild, client, text) {
  try {
    const settingsHelper = require('./settingsHelper');
    const s = settingsHelper.getSettings(guild.id);
    if (s && s.logging === false) return;
    const logChannelId = configHelper.getConfig(guild.id, 'logChannelId');
    const ch = logChannelId && client.channels.cache.get(logChannelId);
    if (ch && ch.isTextBased()) ch.send({ content: text }).catch(() => {});
  } catch { /* log là phụ — không văng */ }
}

const commands = {
  clean: {
    async execute(interaction, client) {
      if (!interaction.guild) return interaction.reply({ content: '❌ Lệnh này chỉ dùng được trong server!', flags: 64 });
      const amount = Math.min(interaction.options.getInteger('amount') || 1, 1000);
      const member = interaction.options.getUser('member');
      const reason = interaction.options.getString('reason');
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
          console.log(`[clean] fetch lỗi giữa chừng, dừng lại: ${e.message}`);
          break;
        }
        if (fetched.size === 0) break;

        let toDelete = [...fetched.values()];
        if (member) toDelete = toDelete.filter(m => m.author.id === member.id);
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
      logModAction(interaction.guild, client,
        `🗑️ **${interaction.user.tag}** đã xóa **${deleted}** tin nhắn trong **#${channel.name}**` +
        (member ? ` của **${member.tag}**` : '') + (reason ? ` — lý do: ${reason}` : ''));
    }
  },

  mute: {
    async execute(interaction, client) {
      if (!interaction.guild) return interaction.reply({ content: '❌ Lệnh này chỉ dùng được trong server!', flags: 64 });
      const user = interaction.options.getUser('member');
      const reason = interaction.options.getString('reason');
      const rawDur = interaction.options.getString('duration');
      let durMs = null;
      if (rawDur) {
        durMs = muteScheduler.parseDuration(rawDur);
        if (!durMs) {
          return interaction.reply({ content: '❌ Thời hạn không hợp lệ! Dùng dạng `30s`, `10m`, `2h`, `7d` (tối đa `28d`). Bỏ trống = cấm vĩnh viễn.', flags: 64 });
        }
      }
      await interaction.deferReply({ flags: 64 });
      let member;
      try { member = await interaction.guild.members.fetch(user.id); } catch {
        return interaction.editReply({ content: '❌ Không tìm thấy người dùng này trong server!' });
      }
      try {
        let mutedRole = interaction.guild.roles.cache.find(r => r.name === 'Muted');
        if (!mutedRole) {
          mutedRole = await interaction.guild.roles.create({ name: 'Muted', permissions: [] });
          for (const [, c] of interaction.guild.channels.cache) {
            try { await c.permissionOverwrites.create(mutedRole, { SendMessages: false, Speak: false }); } catch {}
          }
        }
        await member.roles.add(mutedRole);
        let extra = '';
        if (durMs) {
          const until = muteScheduler.scheduleMute(interaction.guildId, user.id, durMs);
          extra = ` trong **${muteScheduler.fmtDuration(durMs)}** (tự gỡ <t:${Math.floor(until / 1000)}:t>)`;
        } else {
          muteScheduler.clearMute(interaction.guildId, user.id); // mute vĩnh viễn → bỏ hẹn giờ cũ (nếu có)
        }
        await interaction.editReply({ content: `✅ Đã cấm chat ${user.tag}${extra}` });
        logModAction(interaction.guild, client,
          `🔇 **${interaction.user.tag}** đã cấm chat **${user.tag}**${durMs ? ` (${muteScheduler.fmtDuration(durMs)})` : ' (vĩnh viễn)'}` +
          (reason ? ` — lý do: ${reason}` : ''));
      } catch (e) {
        console.error('Lỗi mute:', e);
        await interaction.editReply({ content: '❌ Lỗi khi cấm chat!' });
      }
    }
  },

  unmute: {
    async execute(interaction, client) {
      if (!interaction.guild) return interaction.reply({ content: '❌ Lệnh này chỉ dùng được trong server!', flags: 64 });
      const user = interaction.options.getUser('member');
      const reason = interaction.options.getString('reason');
      await interaction.deferReply({ flags: 64 });
      let member;
      try { member = await interaction.guild.members.fetch(user.id); } catch {
        return interaction.editReply({ content: '❌ Không tìm thấy người dùng này trong server!' });
      }
      const mutedRole = interaction.guild.roles.cache.find(r => r.name === 'Muted');
      if (mutedRole) await member.roles.remove(mutedRole);
      muteScheduler.clearMute(interaction.guildId, user.id); // unmute tay → bỏ hẹn giờ
      await interaction.editReply({ content: `✅ Đã gỡ cấm chat ${user.tag}` });
      logModAction(interaction.guild, client,
        `🔊 **${interaction.user.tag}** đã gỡ cấm chat **${user.tag}**` + (reason ? ` — lý do: ${reason}` : ''));
    }
  },

  lock: {
    async execute(interaction, client) {
      if (!interaction.guild) return interaction.reply({ content: '❌ Lệnh này chỉ dùng được trong server!', flags: 64 });
      const reason = interaction.options.getString('reason');
      await interaction.channel.permissionOverwrites.edit(interaction.guild.roles.everyone, {
        SendMessages: false
      }).catch(() => interaction.channel.permissionOverwrites.create(interaction.guild.roles.everyone, {
        SendMessages: false
      }));
      await interaction.reply({ content: '🔒 Kênh đã bị khóa!', flags: 64 });
      logModAction(interaction.guild, client,
        `🔒 **${interaction.user.tag}** đã khóa kênh **#${interaction.channel.name}**` + (reason ? ` — lý do: ${reason}` : ''));
    }
  },

  unlock: {
    async execute(interaction, client) {
      if (!interaction.guild) return interaction.reply({ content: '❌ Lệnh này chỉ dùng được trong server!', flags: 64 });
      const reason = interaction.options.getString('reason');
      const everyone = interaction.guild.roles.everyone;
      await interaction.channel.permissionOverwrites.edit(everyone, {
        SendMessages: null
      }).catch(() => {});
      await interaction.reply({ content: '🔓 Kênh đã mở khóa!', flags: 64 });
      logModAction(interaction.guild, client,
        `🔓 **${interaction.user.tag}** đã mở khóa kênh **#${interaction.channel.name}**` + (reason ? ` — lý do: ${reason}` : ''));
    }
  },

  say: {
    async execute(interaction, client) {
      if (!interaction.guild) return interaction.reply({ content: '❌ Lệnh này chỉ dùng được trong server!', flags: 64 });
      const content = interaction.options.getString('message');
      const file = interaction.options.getAttachment('attachment');
      await interaction.deferReply({ flags: 64 });

      if (!content && !file) {
        return interaction.editReply({ content: '❌ Nhập nội dung hoặc đính kèm file!' });
      }

      const payload = {};
      if (content) payload.content = content;
      if (file) payload.files = [file];
      await interaction.channel.send(payload);
      return interaction.editReply({ content: '✅ Đã gửi tin nhắn!' });
    }
  },

  dm: {
    async execute(interaction, client) {
      if (!interaction.guild) return interaction.reply({ content: '❌ Lệnh này chỉ dùng được trong server!', flags: 64 });
      const targetUser = interaction.options.getUser('user');
      const targetRoleOpt = interaction.options.getRole('role');
      const content = interaction.options.getString('message');
      const file = interaction.options.getAttachment('attachment');
      await interaction.deferReply({ flags: 64 });

      if (!targetUser && !targetRoleOpt) return interaction.editReply({ content: '❌ Chọn `user` hoặc `role` để gửi DM!' });
      if (targetUser && targetRoleOpt) return interaction.editReply({ content: '❌ Chỉ chọn MỘT trong hai: `user` hoặc `role`!' });
      if (!content && !file) return interaction.editReply({ content: '❌ Nhập nội dung hoặc đính kèm file!' });

      const payload = {};
      if (content) payload.content = content;
      if (file) payload.files = [file];

      if (targetUser) {
        try {
          await targetUser.send(payload);
        } catch (e) {
          return interaction.editReply({ content: `❌ Không thể gửi DM cho ${targetUser.tag}! (đã tắt DM hoặc không có mutual server)` });
        }
        return interaction.editReply({ content: `✅ Đã gửi DM cho ${targetUser.tag}!` });
      }

      // Mass-DM cho member có role — chú ý: gửi hàng loạt dễ bị report spam, dùng tiết kiệm.
      try {
        const guild = interaction.guild;
        const roleId = targetRoleOpt.id;
        const role = await guild.roles.fetch(roleId).catch(() => null);
        if (!role) return interaction.editReply({ content: '❌ Không tìm thấy role trong server!' });

        await retryFetch(() => guild.members.fetch());
        const members = guild.members.cache.filter(m => m.roles.cache.has(role.id));
        if (members.size === 0) return interaction.editReply({ content: `❌ Không có member nào có role **${role.name}**!` });

        let sent = 0, failed = 0;
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
        return interaction.editReply({ content: `✅ Đã gửi DM cho **${sent}**/${members.size} member có role **${role.name}**${failed > 0 ? ` (${failed} thất bại)` : ''}!` });
      } catch (e) {
        console.error('Lỗi dm role:', e.message);
        return interaction.editReply({ content: `❌ Lỗi: ${e.message}` });
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

  config: {
    async execute(interaction, client) {
      const sub = interaction.options.getSubcommand();

      if (sub === 'view') {
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

      if (sub === 'emojiroles') {
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

      if (sub === 'channels') {
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

  badwords: {
    async execute(interaction, client) {
      const sub = interaction.options.getSubcommand();

      if (sub === 'add') {
        if (!interaction.guildId) return interaction.reply({ content: '❌ Chỉ dùng được trong server!', flags: 64 });
        const word = interaction.options.getString('word');
        if (!word) return interaction.reply({ content: '❌ Cần nhập từ cấm!', flags: 64 });
        const wf = require('./automod/wordFilter');
        const added = wf.addBadWord(word, interaction.guildId);
        if (!added) return interaction.reply({ content: `⚠️ Từ \`${word}\` đã có trong danh sách!`, flags: 64 });
        return interaction.reply({ content: `✅ Đã thêm từ cấm \`${word}\` cho server này!`, flags: 64 });
      }

      if (sub === 'remove') {
        if (!interaction.guildId) return interaction.reply({ content: '❌ Chỉ dùng được trong server!', flags: 64 });
        const word = interaction.options.getString('word');
        if (!word) return interaction.reply({ content: '❌ Cần nhập từ cấm!', flags: 64 });
        const wf = require('./automod/wordFilter');
        const removed = wf.removeBadWord(word, interaction.guildId);
        return interaction.reply({ content: removed ? `✅ Đã xóa từ cấm \`${word}\` cho server này!` : `❌ Không tìm thấy \`${word}\` trong danh sách.`, flags: 64 });
      }

      if (sub === 'list') {
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
    }
  },

  autodelete: {
    async execute(interaction, client) {
      const sub = interaction.options.getSubcommand();

      if (sub === 'add') {
        const u = interaction.options.getUser('user');
        const list = jsonCache.readJSONArray(autoDeleteUsersPath);
        if (!list.includes(u.id)) {
          list.push(u.id);
          jsonCache.writeJSON(autoDeleteUsersPath, list);
        }
        return interaction.reply({ content: `✅ Đã thêm <@${u.id}> vào danh sách auto xóa!`, flags: 64 });
      }

      if (sub === 'remove') {
        const u = interaction.options.getUser('user');
        let list = jsonCache.readJSONArray(autoDeleteUsersPath);
        list = list.filter(x => x !== u.id);
        jsonCache.writeJSON(autoDeleteUsersPath, list);
        return interaction.reply({ content: `✅ Đã bỏ auto xóa cho <@${u.id}>`, flags: 64 });
      }

      if (sub === 'list') {
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
    }
  },

  owner: {
    async execute(interaction, client) {
      const sub = interaction.options.getSubcommand();

      if (sub === 'add') {
        const u = interaction.options.getUser('user');
        await interaction.deferReply({ flags: 64 });
        if (u.id === config.ownerId) return interaction.editReply({ content: '❌ User này là chủ sở hữu chính!' });
        configHelper.addOwner(u.id);
        return interaction.editReply({ content: `✅ Đã thêm <@${u.id}> vào danh sách chủ sở hữu!` });
      }

      if (sub === 'remove') {
        const u = interaction.options.getUser('user');
        await interaction.deferReply({ flags: 64 });
        configHelper.removeOwner(u.id);
        return interaction.editReply({ content: `✅ Đã gỡ <@${u.id}> khỏi danh sách chủ sở hữu!` });
      }

      if (sub === 'list') {
        await interaction.deferReply({ flags: 64 });
        const owners = configHelper.listOwners();
        const embed = new EmbedBuilder()
          .setTitle('👑 Danh sách chủ sở hữu')
          .setDescription(owners.length > 0 ? owners.map(id => `- <@${id}> (\`${id}\`)`).join('\n') : 'Không có ai.')
          .setColor(0xFFD700);
        return interaction.editReply({ embeds: [embed] });
      }
    }
  },

  dmlogs: {
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
          console.error('[dmlogs] Button error:', e);
        }
      });

      collector.on('end', () => {
        reply.edit({ components: [] }).catch(() => {});
      });
    }
  },

  automod: {
    slow: true,
    async execute(interaction, client) {
      const sub = interaction.options.getSubcommand();

      if (sub === 'scan') {
        if (!interaction.guild) return interaction.editReply({ content: '❌ Lệnh này chỉ dùng được trong server!' });

        const shouldDelete = interaction.options.getBoolean('delete_messages') || false;
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
        return;
      }

      if (sub === 'test') {
        const type = interaction.options.getString('type');

        if (type === 'text') {
          const content = interaction.options.getString('content');
          if (!content) return interaction.editReply({ content: '❌ Cần nhập nội dung!' });
          const wf = require('./automod/wordFilter');
          const found = wf.checkContent(content, false, interaction.guildId);
          return interaction.editReply({
            content: found
              ? `🚫 Nội dung \`${content}\` có chứa từ bad!`
              : `✅ Nội dung \`${content}\` an toàn.`,
          });
        }

        if (type === 'image') {
          const attachment = interaction.options.getAttachment('attachment');
          if (!attachment) return interaction.editReply({ content: '❌ Cần đính kèm ảnh!' });
          if (!attachment.contentType?.startsWith('image/')) return interaction.editReply({ content: '❌ File đính kèm phải là ảnh!' });
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

  playmusic: {
    async execute(interaction, client) {
      if (!interaction.guild) return interaction.reply({ content: '❌ Lệnh này chỉ dùng được trong server!', flags: 64 });
      const music = require('./features/music');
      return music.sendPanel(interaction, client);
    }
  },

  radio: {
    async execute(interaction, client) {
      if (!interaction.guild) return interaction.reply({ content: '❌ Lệnh này chỉ dùng được trong server!', flags: 64 });
      const music = require('./features/music');
      return music.startRadio(interaction, client);
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
              '`/config view` — Xem toàn bộ dữ liệu bot.\n' +
              '`/config emojiroles` — Xem role có emoji.\n' +
              '`/config channels` — Xem kênh voice hub đã tạo.' },
            { name: '3️⃣ Tạo UI cho người dùng', value:
              '`/ticket` — Gửi panel mở ticket.\n' +
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
              '`/clean amount: 50` — Xóa 50 tin nhắn gần nhất.\n' +
              '`/clean amount: 100 member: @member` — Xóa tin của member.\n' +
              '`/clean amount: 50 reason: dọn kênh` — Ghi lý do vào log.' },
            { name: '🚫 Cấm chat', value:
              '`/mute member: @user` — Cấm chat (vĩnh viễn).\n' +
              '`/mute member: @user duration: 10m` — Cấm có hạn (30s/10m/2h/7d).\n' +
              '`/unmute member: @user` — Gỡ cấm.' },
            { name: '🔒 Khóa kênh', value:
              '`/lock` — Khóa kênh hiện tại.\n' +
              '`/unlock` — Mở kênh.' },
            { name: '💬 Bot gửi tin nhắn', value:
              '`/say message: Hello` — Bot gửi vào kênh hiện tại.' },
            { name: '📩 Gửi DM', value:
              '`/dm user: @user message: ...` — Gửi DM 1 người.\n' +
              '`/dm role: @role message: ...` — Gửi DM cho member có role (hàng loạt).' },
            { name: '⚡ Slowmode', value:
              '`/slowmode seconds: 10` — Set slowmode 10 giây.' },
            { name: '📊 Xem lịch sử DM', value:
              '`/dmlogs user: @user` — Xem lịch sử DM với user.' },
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
            { name: '🛠️ Lệnh điều khiển', value:
              '`/automod scan` — Quét toàn server (chỉ xem).\n' +
              '`/automod scan delete_messages: true` — Quét + xóa tin badword.\n' +
              '`/automod test type: text content: ...` — Test thử một text.\n' +
              '`/automod test type: image attachment: [ảnh]` — Test OCR ảnh.' },
            { name: '⚙️ Quản lý từ cấm', value:
              '`/badwords add word: từ_cấm` — Thêm từ cấm.\n' +
              '`/badwords remove word: từ_cấm` — Gỡ từ cấm.\n' +
              '`/badwords list` — Xem danh sách từ cấm.' },
          )
          .setFooter({ text: 'Super Bot — Trang 3/4' }),

        lists: new EmbedBuilder()
          .setTitle('📋 Quản lý danh sách')
          .setColor(0x9B59B6)
          .addFields(
            { name: '👑 Chủ sở hữu', value:
              '`/owner add user: @user` — Thêm chủ sở hữu.\n' +
              '`/owner remove user: @user` — Gỡ chủ sở hữu.\n' +
              '`/owner list` — Xem danh sách.' },
            { name: '🗑️ Auto-xóa tin nhắn', value:
              '`/autodelete add user: @user` — Tự xóa tin của user.\n' +
              '`/autodelete remove user: @user` — Gỡ khỏi danh sách.\n' +
              '`/autodelete list` — Xem danh sách.' },
            { name: '👁️ Xem toàn bộ', value:
              '`/config view` — Xem tất cả danh sách một lúc.' },
            { name: '😊 Emoji Nickname', value:
              '• Tự động thêm emoji từ role có emoji (cấu hình per-guild trên web).\n' +
              '`/emojisync` — Cập nhật emoji cho tất cả member.\n' +
              '`/config emojiroles` — Xem role có emoji (từ web).' },
          )
          .setFooter({ text: 'Super Bot — Trang 4/4' }),

        misc: new EmbedBuilder()
          .setTitle('📌 Lệnh khác')
          .setColor(0x5865F2)
          .addFields(
            { name: '📩 DM Relay', value:
              '• Tin nhắn DM → bot forward vào kênh relay.\n' +
              '• Bot tìm server mà user là member → forward về server đó.\n' +
              '• `/dm user: @user message: ...` — Gửi DM từ bot.' },
            { name: '🎫 Ticket', value:
              '`/ticket` — Gửi panel mở ticket.\n' +
              '• User bấm nút → tạo kênh riêng.\n' +
              '• Bấm 🔒 để đóng ticket.' },
            { name: '📺 GitHub Pages', value:
              '• Web control panel: `https://minhtu446.github.io/discord-bot/`\n' +
              '• Bật/tắt/restart bot từ xa.\n' +
              '• Real-time status monitoring.' },
            { name: '🎵 Nhạc', value:
              '`/playmusic` — Phát danh sách nhạc đã tạo trên web (phải ở trong voice).\n' +
              '`/radio` — Radio trực tuyến ∞ LIVE (lofi, chill, 80s…).\n' +
              '• Thêm/xoá bài, lặp từng bài (0–99), Dừng ↔ Tiếp tục, số lần phát danh sách (`8*` = vô hạn) chỉnh ở thẻ 🎵 Nhạc trên web.\n' +
              '• Bài YouTube dùng cookie YouTube đã cấu hình; nếu chưa có/hết hạn bot tự phát bản SoundCloud tương ứng.\n' +
              '• Panel có nút **⏹ Kết thúc** (dừng + rời voice), ⏸/⏵ · ⏭ · chọn bài trong list.\n' +
              '• Bot phát đúng cấu hình web, hiện thumbnail + link bài đang phát.' },
            { name: '⚠️ Lưu ý quan trọng', value:
              '• Bot cần **Administrator** permission trong server.\n' +
              '• Phân quyền: quản trị qua **web panel**.\n' +
              '• DM bot → tự relay vào server (nếu đã cấu hình).' },
          )
          .setFooter({ text: 'Super Bot — Bonus' }),
      };

      const embed = pages[page] || pages.start;
      await interaction.reply({ embeds: [embed], flags: 64 });
    }
  },

  ticket: {
    async execute(interaction, client) {
      if (!interaction.guild) return interaction.reply({ content: '❌ Lệnh này chỉ dùng được trong server!', flags: 64 });
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
  },
};

module.exports = commands;
