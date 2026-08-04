const { PermissionsBitField, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType } = require('discord.js');
const config = require('./config');
const jsonCache = require('./jsonCache');
const configHelper = require('./configHelper');
const dataHelper = require('./dataHelper');
const { retryFetch } = require('./utils');

const bannedGameUsersPath = jsonCache.getPath('bannedGameUsers.json');
const autoDeleteUsersPath = jsonCache.getPath('autoDeleteUsers.json');
const gameChannelsPath = jsonCache.getPath('gameChannels.json');

const ALL_CONFIG_FIELDS = [
  'welcomeChannelId', 'logChannelId',
  'ticketCategoryId', 'memberRoleId',
  'setupCategoryId', 'dmRelayChannelId'
];

let autoStatusTimeout = null;
let countdownTimeout = null;

function startAutoStatus(client) {
  stopAutoStatus();
  let lastValue = '';
  console.log('[AutoStatus] Started');
  const tick = async () => {
    try {
      const vnMs = Date.now() + 7 * 3600 * 1000;
      const d = new Date(vnMs);
      const hh = String(d.getUTCHours()).padStart(2, '0');
      const mm = String(d.getUTCMinutes()).padStart(2, '0');
      const dd = d.getUTCDate();
      const mo = d.getUTCMonth() + 1;
      const value = `${hh}:${mm} | ${dd}/${mo}`;
      if (value !== lastValue) {
        await client.user.setActivity(value, { type: 3 });
        lastValue = value;
        console.log(`[AutoStatus] OK: ${value}`);
      }
    } catch (e) {
      console.error('[AutoStatus] Error:', e.message);
      lastValue = '';
    }
    autoStatusTimeout = setTimeout(tick, 10000);
  };
  tick();
}

function stopAutoStatus() {
  if (autoStatusTimeout) {
    clearTimeout(autoStatusTimeout);
    autoStatusTimeout = null;
  }
}

function startCountdownStatus(client, target, note) {
  stopAutoStatus();
  stopCountdownStatus();
  console.log('[Countdown] Started');
  const suffix = note ? ` ${note}` : '';
  const tick = async () => {
    try {
      const remain = target - Date.now();
      if (remain <= 0) {
        stopCountdownStatus();
        await client.user.setActivity('🎉 Đã đến lúc!', { type: 3 });
        console.log('[Countdown] Đã kết thúc!');
        return;
      }
      const days = Math.floor(remain / 86400000);
      const hours = Math.floor((remain % 86400000) / 3600000);
      const mins = Math.floor((remain % 3600000) / 60000);
      let value;
      if (days > 0) value = `⏳ Còn ${days} ngày ${hours} giờ ${mins} phút${suffix}`;
      else if (hours > 0) value = `⏳ Còn ${hours} giờ ${mins} phút${suffix}`;
      else value = `⏳ Còn ${mins} phút${suffix}`;
      await client.user.setActivity(value, { type: 3 });
      console.log(`[Countdown] OK: ${value}`);
    } catch (e) {
      console.error('[Countdown] Error:', e.message);
    }
    countdownTimeout = setTimeout(tick, 10000);
  };
  tick();
}

function stopCountdownStatus() {
  if (countdownTimeout) {
    clearTimeout(countdownTimeout);
    countdownTimeout = null;
  }
}

function parseCountdownTime(str) {
  const s = str.trim();
  let m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2}))?$/);
  if (m) {
    var day = +m[1], month = +m[2], year = +m[3];
    var hour = m[4] ? +m[4] : 0, min = m[5] ? +m[5] : 0;
  } else {
    m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:\s+(\d{1,2}):(\d{2}))?$/);
    if (!m) return NaN;
    var year = +m[1], month = +m[2], day = +m[3];
    var hour = m[4] ? +m[4] : 0, min = m[5] ? +m[5] : 0;
  }
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || min > 59) return NaN;
  const d = new Date(year, month - 1, day, hour, min, 0, 0);
  if (d.getDate() !== day || d.getMonth() !== month - 1 || d.getFullYear() !== year) return NaN;
  return d.getTime();
}

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
        const setupChannels = dataHelper.getAllSetupChannelsFlat();
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
              if (chs.chat) parts.push(`${chs.chat}:${uid}`);
              if (chs.voice) parts.push(`${chs.voice}:${uid}`);
              return parts.join('\n') || 'Không có kênh';
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
            .setDescription(wf.loadBadWords(interaction.guildId).length > 0 ? wf.loadBadWords(interaction.guildId).map(w => `- \`${w}\``).join('\n') : 'Không có')
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
              if (chs.chat) parts.push(`${chs.chat}:${uid}`);
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
        if (!interaction.guildId) return interaction.reply({ content: '❌ Chỉ dùng được trong server!', flags: 64 });
        const content = interaction.options.getString('nội_dung');
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
      const type = interaction.options.getString('loại');

      if (type === 'text') {
        const content = interaction.options.getString('nội_dung');
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

        if (field && value) {
          await interaction.deferReply({ flags: 64 });
          configHelper.setGuildField(guildId, field, value);
          return interaction.editReply({ content: `✅ Đã set \`${field}\` = \`${value}\` cho nhóm \`${guildId}\`` });
        }

        const labels = {
          welcomeChannelId: '📱 Welcome Channel',
          logChannelId: '📋 Log Channel',
          ticketCategoryId: '🎫 Ticket Category',
          memberRoleId: '👤 Member Role',
          setupCategoryId: '📁 Setup Category',
          dmRelayChannelId: '📩 DM Relay Channel',
        };
        const row1 = new ActionRowBuilder();
        const row2 = new ActionRowBuilder();
        let i = 0;
        for (const key of ALL_CONFIG_FIELDS) {
          const val = configHelper.getConfig(guildId, key);
          const btn = new ButtonBuilder()
            .setCustomId(`config_edit_${key}`)
            .setLabel(labels[key] || key)
            .setStyle(val ? ButtonStyle.Success : ButtonStyle.Secondary);
          if (i < 3) row1.addComponents(btn); else row2.addComponents(btn);
          i++;
        }

        let desc = '';
        for (const key of ALL_CONFIG_FIELDS) {
          const val = configHelper.getConfig(guildId, key);
          desc += `**${labels[key]}:** \`${val || '❌ Chưa set'}\`\n`;
        }
        const embed = new EmbedBuilder()
          .setTitle('⚙️ Cấu hình Server')
          .setDescription(desc)
          .setFooter({ text: `Guild: ${guildId} — Bấm nút để đổi` })
          .setColor(0x5865F2);

        return interaction.reply({ embeds: [embed], components: [row1, row2], flags: 64 });
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
        if (overrideKeys.length === 0) {
          embed.addFields({ name: 'ℹ️', value: 'Chưa có override — dùng config.json' });
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

      if (type === 'reset') {
        await interaction.deferReply({ flags: 64 });
        configHelper.resetAllGuildConfigs();
        return interaction.editReply({ content: '✅ Đã reset config tất cả nhóm về mặc định!' });
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
        if (!interaction.guildId) return interaction.reply({ content: '❌ Chỉ dùng được trong server!', flags: 64 });
        const content = interaction.options.getString('nội_dung');
        if (!content) return interaction.reply({ content: '❌ Cần nhập nội dung!', flags: 64 });
        const wf = require('./automod/wordFilter');
        const removed = wf.removeBadWord(content, interaction.guildId);
        return interaction.reply({ content: removed ? `✅ Đã xóa từ cấm \`${content}\` cho server này!` : `❌ Không tìm thấy \`${content}\` trong danh sách.`, flags: 64 });
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

  setstatus: {
    slow: true,
    async execute(interaction, client) {
      const statusPath = jsonCache.getPath('botStatus.json');
      const text = interaction.options.getString('nội_dung');
      const auto = interaction.options.getBoolean('auto');
      const countdownStr = interaction.options.getString('đếm_ngược');
      const note = interaction.options.getString('nghi_chú');

      if (countdownStr) {
        const target = parseCountdownTime(countdownStr);
        if (isNaN(target)) {
          return interaction.editReply({ content: '❌ Sai định dạng thời gian! Dùng: `DD/MM/YYYY HH:mm` (VD: `15/08/2026 12:00`)' });
        }
        if (target <= Date.now()) {
          return interaction.editReply({ content: '❌ Thời điểm đếm ngược phải ở tương lai!' });
        }
        stopAutoStatus(client);
        stopCountdownStatus();
        jsonCache.writeJSON(statusPath, { type: 'countdown', target, note });
        startCountdownStatus(client, target, note);
        const days = Math.floor((target - Date.now()) / 86400000);
        const hours = Math.floor(((target - Date.now()) % 86400000) / 3600000);
        const mins = Math.floor(((target - Date.now()) % 3600000) / 60000);
        const noteText = note ? ` (ghi chú: ${note})` : '';
        return interaction.editReply({ content: `✅ Đã bật đếm ngược: còn **${days} ngày ${hours} giờ ${mins} phút**!${noteText}` });
      }

      if (auto) {
        stopCountdownStatus();
        jsonCache.writeJSON(statusPath, '__AUTO__');
        startAutoStatus(client);
        return interaction.editReply({ content: '✅ Đã bật chế độ tự động — trạng thái sẽ hiện **thời gian real-time**!' });
      }

      if (!text) {
        stopAutoStatus(client);
        stopCountdownStatus();
        jsonCache.writeJSON(statusPath, null);
        client.user.setActivity('/help | Super Bot', { type: 3 });
        return interaction.editReply({ content: '✅ Đã reset trạng thái về mặc định!' });
      }

      stopAutoStatus(client);
      stopCountdownStatus();
      jsonCache.writeJSON(statusPath, text);
      client.user.setActivity(text, { type: 3 });
      await interaction.editReply({ content: `✅ Đã đổi trạng thái thành: \`${text}\`` });
    }
  },

  help: {
    async execute(interaction, client) {
      const page = interaction.options.getString('trang') || 'start';

      const pages = {
        start: new EmbedBuilder()
          .setTitle('📖 Hướng dẫn sử dụng Bot — Bắt đầu')
          .setColor(0x5865F2)
          .setDescription('Chào mừng! Đây là hướng dẫn từ A-Z để sử dụng bot.\nDùng `/help trang: ...` để xem từng phần.')
          .addFields(
            { name: '1️⃣ Cấu hình server', value:
              '`/setup loại: config` — Ghi đè cấu hình cho server.\n' +
              'Các trường cần set:\n' +
              '• `welcomeChannelId` — Kênh chào mừng\n' +
              '• `logChannelId` — Kênh log\n' +
              '• `ticketCategoryId` — Danh mục ticket\n' +
              '• `setupCategoryId` — Danh mục kênh tạm\n' +
              '• `memberRoleId` — Role thành viên\n' +
              '• `dmRelayChannelId` — Kênh relay DM\n\n' +
              'VD: `/setup loại: config trường: logChannelId giá_trị: 123456`' },
            { name: '2️⃣ Xem cấu hình hiện tại', value:
              '`/setup loại: info` — Xem config server hiện tại.\n' +
              '`/list loại: all` — Xem toàn bộ dữ liệu bot.' },
            { name: '3️⃣ Tạo UI cho người dùng', value:
              '`/setup loại: ticket` — Tạo nút mở ticket.\n' +
              '`/setup loại: channelandgame` — Tạo nút tạo kênh + game.\n' +
              '`/setup loại: khuvuichoi` — Tạo khu vui chơi (kênh chat + voice).\n' +
              '`/setup loại: ui` — Tạo embed tùy chỉnh.' },
            { name: '📋 Các trang khác', value:
              '• `/help trang: quanly` — Quản lý & moderation\n' +
              '• `/help trang: game` — Game & giải trí\n' +
              '• `/help trang: automod` — Auto-moderation\n' +
              '• `/help trang: list` — Quản lý danh sách\n' +
              '• `/help trang: khac` — Lệnh khác & prefix' },
          )
          .setFooter({ text: 'Super Bot — Trang 1/5' }),

        quanly: new EmbedBuilder()
          .setTitle('🛠️ Quản lý & Moderation')
          .setColor(0xED4245)
          .addFields(
            { name: '🗑️ Xóa tin nhắn', value:
              '`/xoa số_lượng: 50` — Xóa 50 tin nhắn gần nhất.\n' +
              '`/xoa số_lượng: 100 người_dùng: @user` — Xóa tin của user.\n' +
              '`/xoa số_lượng: 50 id_acc: 123` — Xóa tin trong DM.' },
            { name: '🚫 Cấm chat', value:
              '`/camchat người_dùng: @user` — Cấm user chat.\n' +
              '`/htcamchat người_dùng: @user` — Gỡ cấm.' },
            { name: '🔒 Khóa kênh', value:
              '`/lock` — Khóa kênh hiện tại.\n' +
              '`/unlock` — Mở kênh.' },
            { name: '💬 Gửi tin nhắn', value:
              '`/msg loại: bot nội_dung: Hello` — Bot gửi tin.\n' +
              '`/msg loại: role role_id: 123 nội_dung: ...` — Gửi đến role.\n' +
              '`/msg loại: dm người_dùng: @user nội_dung: ...` — Gửi DM.\n' +
              '`/msg loại: bot số_lần: 5` — Gửi nhiều lần.' },
            { name: '⚡ Slowmode', value:
              '`/setslowmode giây: 10` — Set slowmode 10 giây.' },
            { name: '🔍 Quét badword', value:
              '`/scan` — Quét toàn server (chỉ xem).\n' +
              '`/scan xóa: true` — Quét và xóa tin badword.' },
            { name: '📊 Xem lịch sử DM', value:
              '`/dmhis id: 123` — Xem lịch sử DM với user.' },
            { name: '🧪 Test', value:
              '`/test loại: text nội_dung: ...` — Test badword.\n' +
              '`/test loại: image tệp: [ảnh]` — Test OCR.' },
          )
          .setFooter({ text: 'Super Bot — Trang 2/5' }),

        game: new EmbedBuilder()
          .setTitle('🎮 Game & Giải trí')
          .setColor(0x57F287)
          .addFields(
            { name: '❌ Caro (Tic-Tac-Toe)', value:
              '• Tạo kênh game: `/setup loại: channelandgame` → bấm nút **Caro**.\n' +
              '• Chế độ: 3×3, 4×4 (thắng 3), 5×5 (thắng 4).\n' +
              '• Chơi với AI (độ sâu 12) hoặc thách đấu người khác.' },
            { name: '🏓 Ping Pong', value:
              '• Tạo kênh game: `/setup loại: channelandgame` → bấm **Ping Pong**.\n' +
              '• Gõ `ping` → bot trả `pong`.\n' +
              '• Chuỗi đặc biệt: `6` → `67`, `3` → `36`, `36` → Thanh Hóa, `67` → SixSeven.\n' +
              '• Gõ `sixseven` → bot gửi meme!' },
            { name: '✂️🪨📄 Oẳn tù tì', value:
              '• Gửi tin nhắn: `kéo`, `búa`, hoặc `bao`.\n' +
              '• Bot trả kết quả ngay.' },
            { name: '🖼️ Meme', value:
              '`!meme` — Bot gửi 1 ảnh meme ngẫu nhiên.\n' +
              'Nguồn: Imgflip, meme-api.com, zachl.tech (xáo trộn mỗi lần).' },
            { name: '🎰 Khu vui chơi', value:
              '`/setup loại: khuvuichoi` — Tạo kênh chat + voice tạm.\n' +
              'Người dùng bấm nút để tạo kênh riêng.\n' +
              'Có nút: Đổi tên, thêm người, đuổi, xóa kênh, game.' },
          )
          .setFooter({ text: 'Super Bot — Trang 3/5' }),

        automod: new EmbedBuilder()
          .setTitle('🛡️ Auto-Moderation')
          .setColor(0xFEE75C)
          .addFields(
            { name: '🔤 Chống badword', value:
              '• Tự động xóa tin nhắn chứa từ cấm.\n' +
              '• Hỗ trợ: text, ảnh (OCR), edit tin nhắn.\n' +
              '• Quét khi bot start: xóa toàn bộ tin cũ chứa badword.\n' +
              '• OCR: EasyOCR (local) + OCR.space API song song.' },
            { name: '🔗 Chống link', value:
              '• Tự động xóa tin chứa link (nếu bật).' },
            { name: '🔠 Chống caps', value:
              '• Tự động xóa tin viết HOA quá nhiều (nếu bật).' },
            { name: '📸 Chống ảnh spam', value:
              '• OCR ảnh → phát hiện badword trong ảnh.\n' +
              '• DễOCR + OCR.space song song, timeout 25s.' },
            { name: '✏️ Edit bypass', value:
              '• Khi user edit tin nhắn → check lại badword.\n' +
              '• Nếu match → xóa tin đã edit.' },
            { name: '⚙️ Bật/tắt', value:
              'Các tùy chỉnh: `antiSpam`, `antiLink`, `antiCaps`, `dmRelay`...' },
          )
          .setFooter({ text: 'Super Bot — Trang 4/5' }),

        list: new EmbedBuilder()
          .setTitle('📋 Quản lý danh sách')
          .setColor(0x9B59B6)
          .addFields(
            { name: '➕ Thêm vào danh sách', value:
              '`/add loại: camdunggame id: 123` — Cấm user dùng game.\n' +
              '`/add loại: owner id: 123` — Thêm owner.\n' +
              '`/add loại: noemojirole id: 123` — Role bỏ qua emoji.\n' +
              '`/add loại: tudongxoa id: 123` — Auto-xóa tin user.\n' +
              '`/add loại: bad nội_dung: từ_cấm` — Thêm từ cấm.' },
            { name: '➖ Xóa khỏi danh sách', value:
              '`/removefromlist loại: camdunggame id: 123`\n' +
              '`/removefromlist loại: owner id: 123`\n' +
              '`/removefromlist loại: bad nội_dung: từ_cấm`' },
            { name: '👁️ Xem danh sách', value:
              '`/list loại: all` — Xem tất cả.\n' +
              '`/list loại: owner` — Danh sách owner.\n' +
              '`/list loại: camdunggame` — Danh sách cấm game.\n' +
              '`/list loại: tudongxoa` — Danh sách auto-xóa.\n' +
              '`/list loại: noemojirole` — Role bỏ qua emoji.\n' +
              '`/list loại: gamechannels` — Kênh game.\n' +
              '`/list loại: bad` — Từ cấm.\n' +
              '`/list loại: setup` — Kênh setup.' },
            { name: '😊 Emoji Nickname', value:
              '• Tự động thêm emoji từ role cao nhất vào tên.\n' +
              '`/emojiup` — Cập nhật emoji cho tất cả member.\n' +
              '`/add loại: noemojirole id: ...` — Bỏ qua role.' },
          )
          .setFooter({ text: 'Super Bot — Trang 5/5' }),

        khac: new EmbedBuilder()
          .setTitle('📌 Lệnh khác')
          .setColor(0x5865F2)
          .addFields(
            { name: '🔄 Đổi trạng thái bot', value:
              '`/setstatus nội_dung: Hello!` — Đổi text trạng thái.\n' +
              '`/setstatus auto: true` — Bật chế độ đồng hồ (HH:MM | DD/MM).\n' +
              '`/setstatus đếm_ngược: 15/08/2026 12:00 nghi_chú: sinh nhật bé` — Đếm ngược kèm ghi chú.\n' +
              '`/setstatus` (bỏ trống) — Reset về mặc định.' },
            { name: '📩 DM Relay', value:
              '• Tin nhắn DM → bot forward vào kênh relay.\n' +
              '• Bot tìm server mà user là member → forward về server đó.\n' +
              '• `/dm` — Gửi tin nhắn DM từ bot.' },
            { name: '🎫 Ticket', value:
              '`/setup loại: ticket` — Tạo nút mở ticket.\n' +
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

      const shouldDelete = interaction.options.getBoolean('xóa') || false;
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
module.exports.startAutoStatus = startAutoStatus;
module.exports.stopAutoStatus = stopAutoStatus;
module.exports.startCountdownStatus = startCountdownStatus;
module.exports.stopCountdownStatus = stopCountdownStatus;
