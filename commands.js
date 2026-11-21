const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType, PermissionFlagsBits, ChannelType } = require('discord.js');
const config = require('./config');
const jsonCache = require('./jsonCache');
const configHelper = require('./configHelper');
const dataHelper = require('./dataHelper');
const { retryFetch } = require('./utils');
const muteScheduler = require('./muteScheduler');

const autoDeleteUsersPath = jsonCache.getPath('autoDeleteUsers.json');
const warnsPath = jsonCache.getPath('warns.json');

function getWarnMap() {
  return jsonCache.readJSONObject(warnsPath);
}

function saveWarnMap(all) {
  jsonCache.writeJSON(warnsPath, all);
  jsonCache.flushSync(warnsPath);
}

function getWarns(guildId, userId) {
  const all = getWarnMap();
  return Array.isArray(all[guildId]?.[userId]) ? all[guildId][userId] : [];
}

function addWarn(guildId, userId, entry) {
  const all = getWarnMap();
  if (!all[guildId]) all[guildId] = {};
  if (!Array.isArray(all[guildId][userId])) all[guildId][userId] = [];
  all[guildId][userId].push(entry);
  saveWarnMap(all);
  return entry;
}

function removeWarn(guildId, userId, warnId) {
  const all = getWarnMap();
  const list = Array.isArray(all[guildId]?.[userId]) ? all[guildId][userId] : [];
  const idx = list.findIndex(w => w.id === warnId);
  if (idx === -1) return null;
  const [removed] = list.splice(idx, 1);
  all[guildId][userId] = list;
  saveWarnMap(all);
  return removed;
}

function clearWarns(guildId, userId) {
  const all = getWarnMap();
  const list = Array.isArray(all[guildId]?.[userId]) ? all[guildId][userId] : [];
  all[guildId][userId] = [];
  saveWarnMap(all);
  return list.length;
}

function makeWarnId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function logModAction(guild, client, text) {
  try {
    const settingsHelper = require('./settingsHelper');
    const s = settingsHelper.getSettings(guild.id);
    if (s && s.logging === false) return;
    const logChannelId = configHelper.getConfig(guild.id, 'logChannelId');
    const ch = logChannelId && client.channels.cache.get(logChannelId);
    if (ch && ch.isTextBased()) ch.send({ content: text }).catch(() => {});
  } catch {}
}

function parseDuration(input) {
  if (!input) return null;
  const m = String(input).trim().match(/^(\d+)\s*(s|m|h|d)$/i);
  if (!m) return NaN;
  const n = Number(m[1]);
  const unit = m[2].toLowerCase();
  const mult = { s: 1000, m: 60000, h: 3600000, d: 86400000 }[unit];
  return n * mult;
}

function fmtDuration(ms) {
  if (!ms || ms <= 0) return 'vĩnh viễn';
  const sec = Math.round(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h`;
  const day = Math.round(hr / 24);
  return `${day}d`;
}

function canModerate(interaction, targetMember, actionLabel) {
  if (!targetMember) return { ok: true };
  if (targetMember.id === interaction.user.id) return { ok: false, msg: `❌ Bạn không thể ${actionLabel} chính mình!` };
  if (targetMember.id === interaction.client.user.id) return { ok: false, msg: `❌ Tôi không thể ${actionLabel} chính mình!` };
  if (targetMember.id === interaction.guild.ownerId) return { ok: false, msg: `❌ Không thể ${actionLabel} chủ sở hữu server!` };
  const actor = interaction.member;
  if (actor && actor.roles?.highest && targetMember.roles?.highest && actor.id !== interaction.guild.ownerId) {
    if (targetMember.roles.highest.position >= actor.roles.highest.position) {
      return { ok: false, msg: `❌ Bạn không thể ${actionLabel} người có role cao hơn hoặc bằng bạn!` };
    }
  }
  const me = interaction.guild.members.me;
  if (me && targetMember.roles?.highest && targetMember.roles.highest.position >= me.roles.highest.position) {
    return { ok: false, msg: `❌ Tôi không thể ${actionLabel} người có role cao hơn hoặc bằng bot!` };
  }
  return { ok: true };
}

async function ensureGuild(interaction) {
  if (interaction.guild) return true;
  const payload = { content: '❌ Lệnh này chỉ dùng được trong server!', flags: 64 };
  if (interaction.deferred || interaction.replied) await interaction.editReply(payload).catch(() => {});
  else await interaction.reply(payload).catch(() => {});
  return false;
}

async function ensurePerm(interaction, perm, label) {
  if (interaction.memberPermissions?.has(perm)) return true;
  const payload = { content: `❌ Bạn cần quyền **${label}** để dùng lệnh này!`, flags: 64 };
  if (interaction.deferred || interaction.replied) await interaction.editReply(payload).catch(() => {});
  else await interaction.reply(payload).catch(() => {});
  return false;
}

function getTargetChannel(interaction, optName = 'channel') {
  const ch = interaction.options.getChannel(optName);
  return ch || interaction.channel;
}

const commands = {
  clean: {
    async execute(interaction, client) {
      if (!await ensureGuild(interaction)) return;
      if (!await ensurePerm(interaction, PermissionFlagsBits.ManageMessages, 'Manage Messages')) return;
      const amount = interaction.options.getInteger('amount');
      const targetUser = interaction.options.getUser('member');
      const reason = interaction.options.getString('reason');
      await interaction.reply({ content: `🔄 Đang xóa ${amount} tin nhắn${targetUser ? ` của ${targetUser.tag}` : ''}...`, flags: 64 });
      let deleted = 0;
      let lastId;
      try {
        while (deleted < amount) {
          const fetched = await interaction.channel.messages.fetch({ limit: 100, before: lastId });
          if (fetched.size === 0) break;
          let msgs = [...fetched.values()];
          if (targetUser) msgs = msgs.filter(m => m.author.id === targetUser.id);
          if (msgs.length === 0) { lastId = fetched.last().id; continue; }
          const remaining = amount - deleted;
          const toDelete = msgs.slice(0, remaining);
          const recent = toDelete.filter(m => Date.now() - m.createdTimestamp < 14 * 24 * 60 * 60 * 1000);
          const old = toDelete.filter(m => Date.now() - m.createdTimestamp >= 14 * 24 * 60 * 60 * 1000);
          if (recent.length > 0) {
            const result = await interaction.channel.bulkDelete(recent, true);
            deleted += result.size;
          }
          for (const msg of old) {
            try { await msg.delete(); deleted++; } catch {}
            await new Promise(r => setTimeout(r, 350));
          }
          lastId = fetched.last().id;
        }
        await interaction.editReply({ content: `✅ Đã xóa ${deleted} tin nhắn!` });
        logModAction(interaction.guild, client,
          `🗑️ **${interaction.user.tag}** đã xóa ${deleted} tin nhắn trong <#${interaction.channel.id}>`
          + (targetUser ? ` (lọc: ${targetUser.tag})` : '')
          + (reason ? ` — lý do: ${reason}` : ''));
      } catch (e) {
        console.error('Lỗi xóa tin nhắn:', e);
        await interaction.editReply({ content: `❌ Lỗi khi xóa tin nhắn! Đã xóa được ${deleted}.` }).catch(() => {});
      }
    }
  },

  mute: {
    async execute(interaction, client) {
      if (!await ensureGuild(interaction)) return;
      if (!await ensurePerm(interaction, PermissionFlagsBits.ModerateMembers, 'Moderate Members')) return;
      await interaction.deferReply({ flags: 64 });
      const member = interaction.options.getMember('member');
      const durationStr = interaction.options.getString('duration');
      const reason = interaction.options.getString('reason');
      if (!member) return interaction.editReply({ content: '❌ Không tìm thấy member trong server!' });
      const modCheck = canModerate(interaction, member, 'mute');
      if (!modCheck.ok) return interaction.editReply({ content: modCheck.msg });

      const ms = parseDuration(durationStr);
      if (Number.isNaN(ms)) return interaction.editReply({ content: '❌ Thời hạn không hợp lệ! Dùng dạng: `30s`, `10m`, `2h`, `7d` hoặc bỏ trống để mute vĩnh viễn.' });
      if (ms !== null && ms <= 0) return interaction.editReply({ content: '❌ Thời hạn phải lớn hơn 0!' });
      if (ms !== null && ms > 28 * 24 * 60 * 60 * 1000) return interaction.editReply({ content: '❌ Timeout Discord tối đa 28 ngày. Dùng thời hạn ngắn hơn hoặc bỏ trống để mute vĩnh viễn.' });

      try {
        if (ms === null) {
          let role = interaction.guild.roles.cache.find(r => r.name === 'Muted');
          if (!role) {
            role = await interaction.guild.roles.create({ name: 'Muted', color: 0x555555, permissions: [], reason: 'Tạo role Muted tự động' });
          }
          const channels = [...interaction.guild.channels.cache.values()];
          await Promise.all(channels.map(ch =>
            ch.permissionOverwrites.edit(role, { SendMessages: false, AddReactions: false, Speak: false }).catch(() => {})
          ));
          await member.roles.add(role, reason || 'Muted by command');
          await interaction.editReply({ content: `✅ Đã mute vĩnh viễn ${member.user.tag}!` });
          logModAction(interaction.guild, client, `🔇 **${interaction.user.tag}** đã mute vĩnh viễn **${member.user.tag}**` + (reason ? ` — lý do: ${reason}` : ''));
        } else {
          await member.timeout(ms, reason || 'Muted by command');
          muteScheduler.schedule(member.id, interaction.guild.id, ms, client);
          const until = `<t:${Math.floor((Date.now() + ms) / 1000)}:R>`;
          await interaction.editReply({ content: `✅ Đã mute ${member.user.tag} trong ${fmtDuration(ms)} (hết hạn ${until}).` });
          logModAction(interaction.guild, client, `🔇 **${interaction.user.tag}** đã mute **${member.user.tag}** trong ${fmtDuration(ms)}` + (reason ? ` — lý do: ${reason}` : ''));
        }
      } catch (e) {
        console.error('Lỗi mute:', e);
        await interaction.editReply({ content: `❌ Không thể mute member: ${e.message || 'Lỗi không xác định'}` }).catch(() => {});
      }
    }
  },

  unmute: {
    async execute(interaction, client) {
      if (!await ensureGuild(interaction)) return;
      if (!await ensurePerm(interaction, PermissionFlagsBits.ModerateMembers, 'Moderate Members')) return;
      await interaction.deferReply({ flags: 64 });
      const member = interaction.options.getMember('member');
      const reason = interaction.options.getString('reason');
      if (!member) return interaction.editReply({ content: '❌ Không tìm thấy member trong server!' });
      const modCheck = canModerate(interaction, member, 'unmute');
      if (!modCheck.ok) return interaction.editReply({ content: modCheck.msg });

      try {
        let did = false;
        if (member.communicationDisabledUntilTimestamp && member.communicationDisabledUntilTimestamp > Date.now()) {
          await member.timeout(null, reason || 'Unmuted by command');
          muteScheduler.clear(member.id, interaction.guild.id);
          did = true;
        }
        const role = interaction.guild.roles.cache.find(r => r.name === 'Muted');
        if (role && member.roles.cache.has(role.id)) {
          await member.roles.remove(role, reason || 'Unmuted by command');
          did = true;
        }
        if (!did) return interaction.editReply({ content: `⚠️ **${member.user.tag}** hiện không bị mute.` });
        await interaction.editReply({ content: `✅ Đã unmute ${member.user.tag}!` });
        logModAction(interaction.guild, client, `🔊 **${interaction.user.tag}** đã unmute **${member.user.tag}**` + (reason ? ` — lý do: ${reason}` : ''));
      } catch (e) {
        console.error('Lỗi unmute:', e);
        await interaction.editReply({ content: `❌ Không thể unmute member: ${e.message || 'Lỗi không xác định'}` }).catch(() => {});
      }
    }
  },

  kick: {
    async execute(interaction, client) {
      if (!await ensureGuild(interaction)) return;
      if (!await ensurePerm(interaction, PermissionFlagsBits.KickMembers, 'Kick Members')) return;
      await interaction.deferReply({ flags: 64 });
      const member = interaction.options.getMember('member');
      const reason = interaction.options.getString('reason') || 'Không có lý do';
      if (!member) return interaction.editReply({ content: '❌ Không tìm thấy member trong server!' });
      const modCheck = canModerate(interaction, member, 'kick');
      if (!modCheck.ok) return interaction.editReply({ content: modCheck.msg });
      if (!member.kickable) return interaction.editReply({ content: '❌ Tôi không có quyền kick member này (kiểm tra role bot/permission).' });
      try {
        await member.kick(`${reason} — bởi ${interaction.user.tag}`);
        await interaction.editReply({ content: `✅ Đã kick **${member.user.tag}**.` });
        logModAction(interaction.guild, client, `👢 **${interaction.user.tag}** đã kick **${member.user.tag}** — lý do: ${reason}`);
      } catch (e) {
        console.error('Lỗi kick:', e);
        await interaction.editReply({ content: `❌ Không thể kick: ${e.message || 'Lỗi không xác định'}` }).catch(() => {});
      }
    }
  },

  ban: {
    async execute(interaction, client) {
      if (!await ensureGuild(interaction)) return;
      if (!await ensurePerm(interaction, PermissionFlagsBits.BanMembers, 'Ban Members')) return;
      await interaction.deferReply({ flags: 64 });
      const user = interaction.options.getUser('member');
      const deleteSeconds = interaction.options.getInteger('delete_messages') || 0;
      const reason = interaction.options.getString('reason') || 'Không có lý do';
      if (!user) return interaction.editReply({ content: '❌ Thiếu user.' });
      const member = interaction.guild.members.cache.get(user.id) || await interaction.guild.members.fetch(user.id).catch(() => null);
      const modCheck = canModerate(interaction, member, 'ban');
      if (!modCheck.ok) return interaction.editReply({ content: modCheck.msg });
      if (member && !member.bannable) return interaction.editReply({ content: '❌ Tôi không có quyền ban member này (kiểm tra role bot/permission).' });
      try {
        await interaction.guild.members.ban(user.id, { deleteMessageSeconds: deleteSeconds, reason: `${reason} — bởi ${interaction.user.tag}` });
        await interaction.editReply({ content: `✅ Đã ban **${user.tag}**.` });
        logModAction(interaction.guild, client, `🔨 **${interaction.user.tag}** đã ban **${user.tag}** (${user.id}) — lý do: ${reason}`);
      } catch (e) {
        console.error('Lỗi ban:', e);
        await interaction.editReply({ content: `❌ Không thể ban: ${e.message || 'Lỗi không xác định'}` }).catch(() => {});
      }
    }
  },

  unban: {
    async execute(interaction, client) {
      if (!await ensureGuild(interaction)) return;
      if (!await ensurePerm(interaction, PermissionFlagsBits.BanMembers, 'Ban Members')) return;
      await interaction.deferReply({ flags: 64 });
      const userId = String(interaction.options.getString('user_id') || '').trim();
      const reason = interaction.options.getString('reason') || 'Không có lý do';
      if (!/^\d{15,20}$/.test(userId)) return interaction.editReply({ content: '❌ `user_id` không hợp lệ. Cần ID Discord (15-20 chữ số).' });
      try {
        const banInfo = await interaction.guild.bans.fetch(userId).catch(() => null);
        if (!banInfo) return interaction.editReply({ content: '❌ Không tìm thấy user này trong danh sách ban.' });
        await interaction.guild.members.unban(userId, `${reason} — bởi ${interaction.user.tag}`);
        await interaction.editReply({ content: `✅ Đã unban **${banInfo.user.tag}** (${userId}).` });
        logModAction(interaction.guild, client, `♻️ **${interaction.user.tag}** đã unban **${banInfo.user.tag}** (${userId}) — lý do: ${reason}`);
      } catch (e) {
        console.error('Lỗi unban:', e);
        await interaction.editReply({ content: `❌ Không thể unban: ${e.message || 'Lỗi không xác định'}` }).catch(() => {});
      }
    }
  },

  warn: {
    async execute(interaction, client) {
      if (!await ensureGuild(interaction)) return;
      if (!await ensurePerm(interaction, PermissionFlagsBits.ModerateMembers, 'Moderate Members')) return;
      const sub = interaction.options.getSubcommand();
      const member = interaction.options.getMember('member');
      const user = interaction.options.getUser('member');
      if (!user) return interaction.reply({ content: '❌ Thiếu member.', flags: 64 });

      if (sub === 'add') {
        await interaction.deferReply({ flags: 64 });
        const modCheck = canModerate(interaction, member, 'warn');
        if (!modCheck.ok) return interaction.editReply({ content: modCheck.msg });
        const reason = interaction.options.getString('reason') || 'Không có lý do';
        const entry = addWarn(interaction.guildId, user.id, {
          id: makeWarnId(),
          reason,
          by: interaction.user.id,
          byTag: interaction.user.tag,
          at: Date.now(),
        });
        const total = getWarns(interaction.guildId, user.id).length;
        await interaction.editReply({ content: `✅ Đã warn **${user.tag}** (ID warn: \`${entry.id}\`). Tổng: **${total}** cảnh cáo.\nLý do: ${reason}` });
        logModAction(interaction.guild, client, `⚠️ **${interaction.user.tag}** đã warn **${user.tag}** (${entry.id}) — lý do: ${reason}`);
        return;
      }

      if (sub === 'list') {
        await interaction.deferReply({ flags: 64 });
        const warns = getWarns(interaction.guildId, user.id);
        if (!warns.length) return interaction.editReply({ content: `✅ **${user.tag}** không có cảnh cáo nào.` });
        const recent = warns.slice(-10).reverse();
        const lines = recent.map((w, i) => {
          const when = w.at ? `<t:${Math.floor(w.at / 1000)}:R>` : 'không rõ thời gian';
          const by = w.by ? `<@${w.by}>` : (w.byTag || 'không rõ');
          return `**${i + 1}.** \`${w.id}\` — ${w.reason || 'Không có lý do'}\n   Bởi: ${by} • ${when}`;
        });
        const embed = new EmbedBuilder()
          .setTitle(`⚠️ Cảnh cáo của ${user.tag}`)
          .setDescription(lines.join('\n\n').slice(0, 4096))
          .setColor(0xFEE75C)
          .setFooter({ text: `Tổng ${warns.length} cảnh cáo${warns.length > 10 ? ' • hiển thị 10 cảnh cáo gần nhất' : ''}` });
        return interaction.editReply({ embeds: [embed] });
      }

      if (sub === 'remove') {
        await interaction.deferReply({ flags: 64 });
        const warnId = String(interaction.options.getString('id') || '').trim();
        const removed = removeWarn(interaction.guildId, user.id, warnId);
        if (!removed) return interaction.editReply({ content: `❌ Không tìm thấy warn \`${warnId}\` của **${user.tag}**.` });
        await interaction.editReply({ content: `✅ Đã xóa warn \`${warnId}\` của **${user.tag}**.` });
        logModAction(interaction.guild, client, `🧹 **${interaction.user.tag}** đã xóa warn \`${warnId}\` của **${user.tag}**`);
        return;
      }

      if (sub === 'clear') {
        await interaction.deferReply({ flags: 64 });
        const count = clearWarns(interaction.guildId, user.id);
        await interaction.editReply({ content: `✅ Đã xóa **${count}** cảnh cáo của **${user.tag}**.` });
        logModAction(interaction.guild, client, `🧹 **${interaction.user.tag}** đã xóa toàn bộ ${count} cảnh cáo của **${user.tag}**`);
        return;
      }
    }
  },

  lock: {
    async execute(interaction, client) {
      if (!await ensureGuild(interaction)) return;
      if (!await ensurePerm(interaction, PermissionFlagsBits.ManageChannels, 'Manage Channels')) return;
      const channel = getTargetChannel(interaction);
      const reason = interaction.options.getString('reason');
      if (!channel?.isTextBased?.()) return interaction.reply({ content: '❌ Kênh không hợp lệ.', flags: 64 });
      await interaction.deferReply({ flags: 64 });
      try {
        await channel.permissionOverwrites.edit(interaction.guild.roles.everyone, { SendMessages: false });
        await interaction.editReply({ content: `🔒 Đã khóa ${channel}!` });
        logModAction(interaction.guild, client, `🔒 **${interaction.user.tag}** đã khóa kênh ${channel}` + (reason ? ` — lý do: ${reason}` : ''));
      } catch (e) {
        console.error('Lỗi lock:', e);
        await interaction.editReply({ content: `❌ Không thể khóa kênh: ${e.message || 'Lỗi không xác định'}` }).catch(() => {});
      }
    }
  },

  unlock: {
    async execute(interaction, client) {
      if (!await ensureGuild(interaction)) return;
      if (!await ensurePerm(interaction, PermissionFlagsBits.ManageChannels, 'Manage Channels')) return;
      const channel = getTargetChannel(interaction);
      const reason = interaction.options.getString('reason');
      if (!channel?.isTextBased?.()) return interaction.reply({ content: '❌ Kênh không hợp lệ.', flags: 64 });
      await interaction.deferReply({ flags: 64 });
      try {
        await channel.permissionOverwrites.edit(interaction.guild.roles.everyone, { SendMessages: null });
        await interaction.editReply({ content: `🔓 Đã mở khóa ${channel}!` });
        logModAction(interaction.guild, client, `🔓 **${interaction.user.tag}** đã mở khóa kênh ${channel}` + (reason ? ` — lý do: ${reason}` : ''));
      } catch (e) {
        console.error('Lỗi unlock:', e);
        await interaction.editReply({ content: `❌ Không thể mở khóa kênh: ${e.message || 'Lỗi không xác định'}` }).catch(() => {});
      }
    }
  },

  slowmode: {
    async execute(interaction, client) {
      if (!await ensureGuild(interaction)) return;
      if (!await ensurePerm(interaction, PermissionFlagsBits.ManageChannels, 'Manage Channels')) return;
      const seconds = interaction.options.getInteger('seconds');
      const channel = getTargetChannel(interaction);
      if (!channel?.isTextBased?.() || typeof channel.setRateLimitPerUser !== 'function') {
        return interaction.reply({ content: '❌ Kênh này không hỗ trợ slowmode.', flags: 64 });
      }
      await interaction.deferReply({ flags: 64 });
      try {
        await channel.setRateLimitPerUser(seconds, `Slowmode bởi ${interaction.user.tag}`);
        await interaction.editReply({ content: seconds === 0 ? `✅ Đã tắt slowmode cho ${channel}.` : `✅ Đã đặt slowmode ${seconds}s cho ${channel}.` });
        logModAction(interaction.guild, client, `🐌 **${interaction.user.tag}** đặt slowmode ${seconds}s cho ${channel}`);
      } catch (e) {
        console.error('Lỗi slowmode:', e);
        await interaction.editReply({ content: `❌ Không thể đặt slowmode: ${e.message || 'Lỗi không xác định'}` }).catch(() => {});
      }
    }
  },

  say: {
    async execute(interaction, client) {
      if (!await ensureGuild(interaction)) return;
      if (!await ensurePerm(interaction, PermissionFlagsBits.ManageMessages, 'Manage Messages')) return;
      const message = interaction.options.getString('message');
      const attachment = interaction.options.getAttachment('attachment');
      const channel = getTargetChannel(interaction);
      if (!message && !attachment) return interaction.reply({ content: '❌ Bạn phải nhập tin nhắn hoặc đính kèm file!', flags: 64 });
      if (!channel?.isTextBased?.()) return interaction.reply({ content: '❌ Kênh đích không hợp lệ.', flags: 64 });
      await interaction.deferReply({ flags: 64 });
      try {
        const payload = {};
        if (message) payload.content = message;
        if (attachment) payload.files = [attachment.url];
        await channel.send(payload);
        await interaction.editReply({ content: `✅ Đã gửi tin nhắn đến ${channel}!` });
      } catch (e) {
        console.error('Lỗi say:', e);
        await interaction.editReply({ content: `❌ Không thể gửi tin nhắn: ${e.message || 'Lỗi không xác định'}` }).catch(() => {});
      }
    }
  },

  dm: {
    async execute(interaction, client) {
      if (!await ensureGuild(interaction)) return;
      if (!await ensurePerm(interaction, PermissionFlagsBits.ManageMessages, 'Manage Messages')) return;
      const message = interaction.options.getString('message');
      const attachment = interaction.options.getAttachment('attachment');
      const targetUser = interaction.options.getUser('user');
      const targetRole = interaction.options.getRole('role');

      if (!message && !attachment) return interaction.reply({ content: '❌ Bạn phải nhập nội dung hoặc đính kèm file!', flags: 64 });
      if (!targetUser && !targetRole) return interaction.reply({ content: '❌ Bạn phải chọn user hoặc role!', flags: 64 });
      if (targetUser && targetRole) return interaction.reply({ content: '❌ Chỉ chọn một: user hoặc role!', flags: 64 });

      await interaction.deferReply({ flags: 64 });

      const payload = {};
      if (message) payload.content = message;
      if (attachment) payload.files = [attachment.url];

      if (targetUser) {
        try {
          await targetUser.send(payload);
          return interaction.editReply({ content: `✅ Đã gửi DM đến **${targetUser.tag}**!` });
        } catch (e) {
          console.error('Lỗi gửi DM:', e);
          return interaction.editReply({ content: '❌ Không thể gửi DM! User có thể đã tắt DM.' });
        }
      }

      try {
        await interaction.guild.members.fetch();
        const members = targetRole.members.filter(m => !m.user.bot);
        if (members.size === 0) return interaction.editReply({ content: '❌ Không có member nào trong role này!' });

        await interaction.editReply({ content: `🔄 Đang gửi DM đến ${members.size} members...` });

        let success = 0;
        let fail = 0;
        for (const [, member] of members) {
          try {
            await member.send(payload);
            success++;
          } catch { fail++; }
          await new Promise(r => setTimeout(r, 1000));
        }

        return interaction.editReply({ content: `✅ Đã gửi DM đến role **${targetRole.name}**!\n📨 Thành công: ${success} | ❌ Thất bại: ${fail}` });
      } catch (e) {
        console.error('Lỗi gửi DM role:', e);
        return interaction.editReply({ content: '❌ Lỗi khi gửi DM hàng loạt!' });
      }
    }
  },

  dmlogs: {
    async execute(interaction, client) {
      if (!await ensureGuild(interaction)) return;
      if (!await ensurePerm(interaction, PermissionFlagsBits.ManageMessages, 'Manage Messages')) return;
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
          .setFooter({ text: `Trang ${page + 1}/${totalPages} • Tổng ${allMessages.length} tin nhắn` })
          .setTimestamp();
        const lines = pageMsgs.map(m => {
          const time = `<t:${Math.floor(m.createdTimestamp / 1000)}:R>`;
          const author = m.author.id === client.user.id ? '🤖 Bot' : `👤 ${m.author.tag}`;
          const content = m.content ? (m.content.length > 100 ? m.content.slice(0, 100) + '...' : m.content) : '*[Không có nội dung]*';
          const atts = m.attachments.size > 0 ? ` 📎(${m.attachments.size})` : '';
          return `${time} ${author}: ${content}${atts}`;
        });
        embed.setDescription(lines.join('\n'));
        return embed;
      }

      function buildRow(page) {
        return new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('dmhis_prev').setLabel('◀️').setStyle(ButtonStyle.Secondary).setDisabled(page === 0),
          new ButtonBuilder().setCustomId('dmhis_page').setLabel(`${page + 1}/${totalPages}`).setStyle(ButtonStyle.Primary).setDisabled(true),
          new ButtonBuilder().setCustomId('dmhis_next').setLabel('▶️').setStyle(ButtonStyle.Secondary).setDisabled(page === totalPages - 1),
          new ButtonBuilder().setCustomId('dmhis_delete').setLabel('🗑️').setStyle(ButtonStyle.Danger),
        );
      }

      const reply = await interaction.editReply({ embeds: [buildEmbed(currentPage)], components: [buildRow(currentPage)] });
      const collector = reply.createMessageComponentCollector({ componentType: ComponentType.Button, time: 300000 });
      collector.on('collect', async (i) => {
        if (i.user.id !== interaction.user.id) return i.reply({ content: '❌ Chỉ người dùng lệnh mới bấm được!', flags: 64 });
        try {
          if (i.customId === 'dmhis_prev') { currentPage = Math.max(0, currentPage - 1); await i.update({ embeds: [buildEmbed(currentPage)], components: [buildRow(currentPage)] }); }
          else if (i.customId === 'dmhis_next') { currentPage = Math.min(totalPages - 1, currentPage + 1); await i.update({ embeds: [buildEmbed(currentPage)], components: [buildRow(currentPage)] }); }
          else if (i.customId === 'dmhis_delete') { await i.update({ content: '✅ Đã đóng lịch sử DM.', embeds: [], components: [] }); collector.stop(); }
        } catch (e) {
          if (e.code !== 10062 && e.code !== 10008) console.error('[dmlogs] Button error:', e);
        }
      });
      collector.on('end', () => { reply.edit({ components: [] }).catch(() => {}); });
    }
  },

  config: {
    async execute(interaction, client) {
      if (!await ensureGuild(interaction)) return;
      if (!await ensurePerm(interaction, PermissionFlagsBits.ManageGuild, 'Manage Guild')) return;
      const sub = interaction.options.getSubcommand();
      if (sub === 'view') {
        const guildId = interaction.guildId;
        const configKeys = ['welcomeChannelId', 'logChannelId', 'ticketCategoryId', 'setupCategoryId', 'memberRoleId', 'dmRelayChannelId'];
        let configLines = '';
        for (const key of configKeys) {
          const val = configHelper.getConfig(guildId, key);
          configLines += `**${key}:** ${val ? `<#${val}> (${val})` : '❌ Chưa đặt'}\n`;
        }
        const autoDeleteUsers = jsonCache.readJSONArray(autoDeleteUsersPath);
        const wf = require('./automod/wordFilter');
        const embeds = [
          new EmbedBuilder().setTitle('⚙️ Cấu hình bot').setDescription(configLines || 'Chưa có cấu hình.').setColor(0x5865F2),
          new EmbedBuilder().setTitle('🗑️ Danh sách tự động xóa tin nhắn').setDescription(autoDeleteUsers.length > 0 ? autoDeleteUsers.map(id => `- <@${id}>`).join('\n') : 'Không có').setColor(0x57F287),
          new EmbedBuilder().setTitle('🚫 Danh sách từ/cụm từ bad').setDescription(wf.loadBadWords(guildId).length > 0 ? wf.loadBadWords(guildId).map(w => `- \`${w}\``).join('\n') : 'Không có').setColor(0x000000),
        ];
        return interaction.reply({ embeds, flags: 64 });
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
        const embed = new EmbedBuilder().setTitle('📋 Danh sách kênh setup').setDescription(desc.slice(0, 4096)).setColor(0x5865F2);
        return interaction.reply({ embeds: [embed], flags: 64 });
      }
    }
  },

  badwords: {
    async execute(interaction, client) {
      if (!await ensureGuild(interaction)) return;
      if (!await ensurePerm(interaction, PermissionFlagsBits.ManageGuild, 'Manage Guild')) return;
      const wf = require('./automod/wordFilter');
      const sub = interaction.options.getSubcommand();
      if (sub === 'add') {
        const word = interaction.options.getString('word').toLowerCase().trim();
        if (!word) return interaction.reply({ content: '❌ Từ không hợp lệ!', flags: 64 });
        const words = wf.loadBadWords(interaction.guildId);
        if (words.includes(word)) return interaction.reply({ content: `⚠️ \`${word}\` đã có trong danh sách!`, flags: 64 });
        words.push(word);
        wf.saveBadWords(words, interaction.guildId);
        return interaction.reply({ content: `✅ Đã thêm \`${word}\` vào danh sách bad words!`, flags: 64 });
      }
      if (sub === 'remove') {
        const word = interaction.options.getString('word').toLowerCase().trim();
        let words = wf.loadBadWords(interaction.guildId);
        if (!words.includes(word)) return interaction.reply({ content: `⚠️ \`${word}\` không có trong danh sách!`, flags: 64 });
        words = words.filter(w => w !== word);
        wf.saveBadWords(words, interaction.guildId);
        return interaction.reply({ content: `✅ Đã xóa \`${word}\` khỏi danh sách!`, flags: 64 });
      }
      if (sub === 'list') {
        const words = wf.loadBadWords(interaction.guildId);
        const embed = new EmbedBuilder()
          .setTitle('🚫 Danh sách bad words')
          .setDescription(words.length > 0 ? words.map(w => `- \`${w}\``).join('\n').slice(0, 4096) : 'Chưa có từ nào.')
          .setColor(0xED4245);
        return interaction.reply({ embeds: [embed], flags: 64 });
      }
    }
  },

  autodelete: {
    async execute(interaction, client) {
      if (!await ensureGuild(interaction)) return;
      if (!await ensurePerm(interaction, PermissionFlagsBits.ManageGuild, 'Manage Guild')) return;
      const sub = interaction.options.getSubcommand();
      const list = jsonCache.readJSONArray(autoDeleteUsersPath);
      if (sub === 'add') {
        const user = interaction.options.getUser('user');
        if (list.includes(user.id)) return interaction.reply({ content: `⚠️ ${user.tag} đã có trong danh sách!`, flags: 64 });
        list.push(user.id);
        jsonCache.writeJSON(autoDeleteUsersPath, list);
        return interaction.reply({ content: `✅ Đã thêm ${user.tag} vào danh sách tự động xóa!`, flags: 64 });
      }
      if (sub === 'remove') {
        const user = interaction.options.getUser('user');
        if (!list.includes(user.id)) return interaction.reply({ content: `⚠️ ${user.tag} không có trong danh sách!`, flags: 64 });
        const next = list.filter(id => id !== user.id);
        jsonCache.writeJSON(autoDeleteUsersPath, next);
        return interaction.reply({ content: `✅ Đã xóa ${user.tag} khỏi danh sách!`, flags: 64 });
      }
      if (sub === 'list') {
        const embed = new EmbedBuilder()
          .setTitle('🗑️ Danh sách auto-delete')
          .setDescription(list.length > 0 ? list.map(id => `- <@${id}> (\`${id}\`)`).join('\n').slice(0, 4096) : 'Không có user nào.')
          .setColor(0x5865F2);
        return interaction.reply({ embeds: [embed], flags: 64 });
      }
    }
  },

  automod: {
    slow: true,
    async execute(interaction, client) {
      if (!await ensureGuild(interaction)) return;
      if (!await ensurePerm(interaction, PermissionFlagsBits.ManageGuild, 'Manage Guild')) return;
      const sub = interaction.options.getSubcommand();

      if (sub === 'scan') {
        const shouldDelete = interaction.options.getBoolean('delete_messages') || false;
        const wordFilter = require('./automod/wordFilter');
        const channels = interaction.guild.channels.cache.filter(c => c.isTextBased() && c.viewable);
        if (channels.size === 0) return interaction.editReply({ content: '❌ Không có kênh text nào!' });

        await interaction.editReply({ content: `🔍 Đang quét **${channels.size}** kênh...` });
        const results = [];
        let totalScanned = 0;
        let totalFound = 0;
        let totalDeleted = 0;

        for (const [, channel] of channels) {
          try {
            let lastId = null;
            let channelFound = 0;
            let channelDeleted = 0;
            let fetched = 0;
            while (fetched < 500) {
              const options = { limit: 100 };
              if (lastId) options.before = lastId;
              const messages = await channel.messages.fetch(options).catch(() => null);
              if (!messages || messages.size === 0) break;
              fetched += messages.size;
              lastId = messages.last().id;
              for (const [, msg] of messages) {
                totalScanned++;
                if (msg.author.bot) continue;
                const content = String(msg.content || '');
                if (!content) continue;
                const hit = wordFilter.checkContent(content, false, interaction.guildId);
                if (!hit) continue;
                totalFound++;
                channelFound++;
                if (shouldDelete) {
                  try { await msg.delete(); totalDeleted++; channelDeleted++; } catch {}
                }
              }
              if (messages.size < 100) break;
            }
            if (channelFound > 0) results.push({ channel: channel.name, found: channelFound, deleted: channelDeleted });
          } catch {}
        }

        const lines = results.slice(0, 20).map(r => `• **#${r.channel}**: ${r.found} tin${shouldDelete ? `, đã xóa ${r.deleted}` : ''}`);
        const embed = new EmbedBuilder()
          .setTitle('🔍 Kết quả quét automod')
          .setColor(totalFound > 0 ? 0xED4245 : 0x57F287)
          .setDescription([
            `Đã quét: **${totalScanned}** tin nhắn trong **${channels.size}** kênh.`,
            `Phát hiện: **${totalFound}** tin chứa badword.`,
            shouldDelete ? `Đã xóa: **${totalDeleted}** tin.` : 'Chế độ: chỉ xem (không xóa).',
            lines.length ? '\n' + lines.join('\n') : '',
          ].join('\n').slice(0, 4096));
        return interaction.editReply({ content: '', embeds: [embed] });
      }

      if (sub === 'test') {
        const type = interaction.options.getString('type');
        const content = interaction.options.getString('content');
        const attachment = interaction.options.getAttachment('attachment');

        if (type === 'text') {
          const text = String(content || '').trim();
          if (!text) return interaction.editReply({ content: '❌ Bạn cần nhập `content` để test text.' });
          const wordFilter = require('./automod/wordFilter');
          const hit = wordFilter.checkContentDetailed(text, false, interaction.guildId);
          return interaction.editReply({
            content: hit ? `🚫 Phát hiện badword: **${hit.word}** (${hit.mode})` : '✅ Không phát hiện badword trong nội dung này.',
          });
        }

        if (type === 'image') {
          if (!attachment) return interaction.editReply({ content: '❌ Bạn cần đính kèm `attachment` để test image.' });
          const imageFilter = require('./automod/imageFilter');
          await interaction.editReply({ content: '🔍 Đang kiểm tra ảnh...' });
          try {
            const res = await retryFetch(attachment.url);
            const buf = Buffer.from(await res.arrayBuffer());
            const mime = attachment.contentType || 'image/png';
            const r = await imageFilter.analyzeImage(buf, interaction.guildId, mime, client);
            if (r.gemini?.error) return interaction.editReply({ content: `⚠️ Lỗi kiểm tra ảnh: ${r.gemini.error}` });
            if (r.bad) {
              const reason = r.matched ? `badword "${r.matched.word}" (${r.matched.mode})` : (r.gemini?.bad ? 'Gemini flagged' : 'flagged');
              return interaction.editReply({ content: `🚫 Ảnh bị gắn cờ. Lý do: ${reason}` });
            }
            return interaction.editReply({ content: '✅ Ảnh không bị gắn cờ.' });
          } catch (e) {
            console.error('Lỗi automod test image:', e);
            return interaction.editReply({ content: `❌ Lỗi kiểm tra ảnh: ${e.message || 'unknown'}` });
          }
        }
      }
    }
  },

  reactionroles: {
    async execute(interaction, client) {
      if (!await ensureGuild(interaction)) return;
      if (!await ensurePerm(interaction, PermissionFlagsBits.ManageRoles, 'Manage Roles')) return;
      const sub = interaction.options.getSubcommand?.() || 'panel';
      if (sub === 'panel') {
        const pickrole = require('./features/pickrole');
        return pickrole.sendPanel(interaction);
      }
    }
  },

  ticket: {
    async execute(interaction, client) {
      if (!await ensureGuild(interaction)) return;
      if (!await ensurePerm(interaction, PermissionFlagsBits.ManageChannels, 'Manage Channels')) return;
      const sub = interaction.options.getSubcommand?.() || 'panel';

      if (sub === 'panel') {
        await interaction.deferReply({ flags: 64 });
        const webConfig = require('./webConfig');
        const t = webConfig.getFeature(interaction.guildId, 'ticket') || {};
        const content = (t.panel && t.panel.content && t.panel.content.trim()) ? t.panel.content : 'Nhấn nút bên dưới để mở ticket hỗ trợ.';
        const color = (t.panel && typeof t.panel.color === 'number') ? t.panel.color : 0x5865F2;
        const panelTitle = (t.panel && t.panel.title && String(t.panel.title).trim()) ? String(t.panel.title).trim() : '🎫 Hỗ trợ';
        const panelButton = (t.panel && t.panel.button && String(t.panel.button).trim()) ? String(t.panel.button).trim() : '🎫 Mở Ticket';
        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('create_ticket').setLabel(panelButton.slice(0, 80)).setStyle(ButtonStyle.Primary)
        );
        const embed = new EmbedBuilder().setTitle(panelTitle.slice(0, 256)).setDescription(content.slice(0, 4096)).setColor(color);
        if (t.panel && t.panel.thumbnailUrl) embed.setThumbnail(t.panel.thumbnailUrl);
        if (t.panel && t.panel.imageUrl) embed.setImage(t.panel.imageUrl);
        if (t.panel && t.panel.footerText) embed.setFooter({ text: String(t.panel.footerText).slice(0, 2048) });
        await interaction.channel.send({ embeds: [embed], components: [row] });
        return interaction.editReply({ content: '✅ Đã tạo panel ticket!' });
      }

      if (sub === 'close') {
        await interaction.deferReply({ flags: 64 });
        const reason = interaction.options.getString('reason') || 'Không có lý do';
        const channelId = interaction.channelId;
        const userTickets = dataHelper.getUserTickets(interaction.guildId);
        const ownerEntry = Object.entries(userTickets).find(([, chId]) => chId === channelId);
        if (!ownerEntry) {
          return interaction.editReply({ content: '❌ Kênh này không phải ticket đang mở (hoặc không được bot quản lý).' });
        }
        delete userTickets[ownerEntry[0]];
        dataHelper.setUserTickets(interaction.guildId, userTickets);
        await interaction.editReply({ content: `✅ Đang đóng ticket... Lý do: ${reason}` });
        logModAction(interaction.guild, client, `🔒 **${interaction.user.tag}** đã đóng ticket <#${channelId}> — lý do: ${reason}`);
        setTimeout(() => { interaction.channel.delete(`Ticket closed by ${interaction.user.tag}: ${reason}`).catch(() => {}); }, 1500);
        return;
      }
    }
  },

  welcome: {
    async execute(interaction, client) {
      if (!await ensureGuild(interaction)) return;
      if (!await ensurePerm(interaction, PermissionFlagsBits.ManageGuild, 'Manage Guild')) return;
      const sub = interaction.options.getSubcommand?.() || 'test';
      if (sub === 'test') {
        await interaction.deferReply({ flags: 64 });
        const target = interaction.options.getMember('member') || interaction.member;
        if (!target) return interaction.editReply({ content: '❌ Không tìm thấy member.' });

        const webConfig = require('./webConfig');
        const welcome = require('./features/welcome');
        const welcomeBg = require('./features/welcomeBg');
        const w = webConfig.getFeature(interaction.guildId, 'welcome') || {};
        const webActive = w.enabled !== false && /^\d{15,20}$/.test(String(w.channelId || ''));

        try {
          if (webActive) {
            const content = (w.content && w.content.trim()) ? welcome.interpolateWelcome(w.content, target) : `🎉 Chào mừng ${target} đã đến với server!`;
            const bg = await welcomeBg.load(interaction.guildId, w.bgVersion).catch(() => null);
            const attachment = await welcome.createWelcomeCanvas(target, w, bg).catch(() => null);
            const payload = { content: `**[TEST]** ${content}` };
            if (attachment) payload.files = [attachment];
            await interaction.editReply(payload);
            return;
          }

          const settingsHelper = require('./settingsHelper');
          const s = settingsHelper.getSettings(interaction.guildId);
          const payload = { content: `**[TEST]** 🎉 Chào mừng ${target} đã đến với server!` };
          if (s.welcomeEmbed !== false) {
            const msgData = welcome.createWelcomeEmbed(target);
            payload.embeds = msgData.embeds;
          }
          if (s.welcomeCanvas !== false) {
            const attachment = await welcome.createWelcomeCanvas(target).catch(() => null);
            if (attachment) {
              payload.files = [attachment];
              if (payload.embeds) payload.embeds[0].setImage('attachment://welcome.png');
            }
          }
          await interaction.editReply(payload);
        } catch (e) {
          console.error('Lỗi welcome test:', e);
          await interaction.editReply({ content: `❌ Lỗi test welcome: ${e.message || 'unknown'}` }).catch(() => {});
        }
      }
    }
  },

  ping: {
    async execute(interaction, client) {
      const sent = await interaction.reply({ content: '🏓 Pong...', fetchReply: true, flags: 64 });
      const latency = sent.createdTimestamp - interaction.createdTimestamp;
      const ws = Math.round(client.ws.ping);
      await interaction.editReply({ content: `🏓 Pong!\n• Độ trễ phản hồi: **${latency}ms**\n• WebSocket: **${ws}ms**` }).catch(() => {});
    }
  },

  userinfo: {
    async execute(interaction, client) {
      if (!await ensureGuild(interaction)) return;
      const user = interaction.options.getUser('user') || interaction.user;
      const member = interaction.guild.members.cache.get(user.id) || await interaction.guild.members.fetch(user.id).catch(() => null);
      const roles = member ? member.roles.cache.filter(r => r.id !== interaction.guild.id).sort((a, b) => b.position - a.position).map(r => `${r}`).slice(0, 20) : [];
      const embed = new EmbedBuilder()
        .setTitle(`👤 Thông tin: ${user.tag}`)
        .setThumbnail(user.displayAvatarURL({ size: 256 }))
        .setColor(member?.displayHexColor && member.displayHexColor !== '#000000' ? member.displayHexColor : 0x5865F2)
        .addFields(
          { name: 'ID', value: `\`${user.id}\``, inline: true },
          { name: 'Bot', value: user.bot ? 'Có' : 'Không', inline: true },
          { name: 'Tạo tài khoản', value: `<t:${Math.floor(user.createdTimestamp / 1000)}:F> (<t:${Math.floor(user.createdTimestamp / 1000)}:R>)`, inline: false },
        );
      if (member) {
        embed.addFields(
          { name: 'Vào server', value: member.joinedTimestamp ? `<t:${Math.floor(member.joinedTimestamp / 1000)}:F> (<t:${Math.floor(member.joinedTimestamp / 1000)}:R>)` : 'Không rõ', inline: false },
          { name: `Roles [${member.roles.cache.size - 1}]`, value: roles.length ? roles.join(', ').slice(0, 1024) : 'Không có', inline: false },
        );
        if (member.premiumSinceTimestamp) embed.addFields({ name: 'Boost server', value: `<t:${Math.floor(member.premiumSinceTimestamp / 1000)}:R>`, inline: true });
      } else {
        embed.addFields({ name: 'Trong server', value: 'Không phải thành viên server (hoặc không fetch được).', inline: false });
      }
      await interaction.reply({ embeds: [embed], flags: 64 });
    }
  },

  serverinfo: {
    async execute(interaction, client) {
      if (!await ensureGuild(interaction)) return;
      const g = interaction.guild;
      await g.members.fetch().catch(() => {});
      const owner = await client.users.fetch(g.ownerId).catch(() => null);
      const channels = g.channels.cache;
      const text = channels.filter(c => c.isTextBased()).size;
      const voice = channels.filter(c => c.isVoiceBased()).size;
      const categories = channels.filter(c => c.type === ChannelType.GuildCategory).size;
      const embed = new EmbedBuilder()
        .setTitle(`📊 Thông tin server: ${g.name}`)
        .setThumbnail(g.iconURL({ size: 256 }))
        .setColor(0x5865F2)
        .addFields(
          { name: 'ID', value: `\`${g.id}\``, inline: true },
          { name: 'Chủ server', value: owner ? `${owner.tag} (\`${g.ownerId}\`)` : `\`${g.ownerId}\``, inline: true },
          { name: 'Tạo lúc', value: `<t:${Math.floor(g.createdTimestamp / 1000)}:F> (<t:${Math.floor(g.createdTimestamp / 1000)}:R>)`, inline: false },
          { name: 'Thành viên', value: `${g.memberCount}`, inline: true },
          { name: 'Roles', value: `${g.roles.cache.size}`, inline: true },
          { name: 'Emoji', value: `${g.emojis.cache.size}`, inline: true },
          { name: 'Kênh', value: `Text: ${text} • Voice: ${voice} • Category: ${categories}`, inline: false },
          { name: 'Boost', value: `Level ${g.premiumTier} • ${g.premiumSubscriptionCount || 0} boosts`, inline: true },
        );
      if (g.description) embed.setDescription(g.description.slice(0, 4096));
      if (g.bannerURL()) embed.setImage(g.bannerURL({ size: 1024 }));
      await interaction.reply({ embeds: [embed], flags: 64 });
    }
  },

  avatar: {
    async execute(interaction, client) {
      const user = interaction.options.getUser('user') || interaction.user;
      const member = interaction.guild ? (interaction.guild.members.cache.get(user.id) || await interaction.guild.members.fetch(user.id).catch(() => null)) : null;
      const avatarUrl = user.displayAvatarURL({ size: 4096, extension: 'png', forceStatic: false });
      const embed = new EmbedBuilder()
        .setTitle(`🖼️ Avatar của ${user.tag}`)
        .setImage(avatarUrl)
        .setColor(member?.displayHexColor && member.displayHexColor !== '#000000' ? member.displayHexColor : 0x5865F2)
        .setDescription(`[Mở ảnh gốc](${avatarUrl})`);
      if (member && member.avatar) {
        const serverAvatar = member.displayAvatarURL({ size: 4096, extension: 'png', forceStatic: false });
        embed.addFields({ name: 'Avatar server', value: `[Mở ảnh](${serverAvatar})` });
      }
      await interaction.reply({ embeds: [embed], flags: 64 });
    }
  },

  help: {
    async execute(interaction, client) {
      const page = interaction.options.getString('page') || 'start';
      const pages = {
        start: new EmbedBuilder()
          .setTitle('📖 Hướng dẫn sử dụng Bot')
          .setColor(0x5865F2)
          .setDescription('Dùng `/help page: ...` để xem từng nhóm lệnh.')
          .addFields(
            { name: '🛡️ Kiểm duyệt', value: '`/clean /mute /unmute /kick /ban /unban /warn /lock /unlock /slowmode`', inline: false },
            { name: '🤖 Auto-moderation', value: '`/badwords /automod /autodelete`', inline: false },
            { name: '🎫 Tính năng', value: '`/ticket /reactionroles /welcome` (cấu hình chi tiết ở web panel)', inline: false },
            { name: '🧰 Tiện ích & Hệ thống', value: '`/say /dm /dmlogs /ping /userinfo /serverinfo /avatar /config /help`', inline: false },
          ),
        moderation: new EmbedBuilder()
          .setTitle('🛡️ Kiểm duyệt')
          .setColor(0xED4245)
          .addFields(
            { name: '/clean', value: '`amount` bắt buộc, `member?`, `reason?` — xóa hàng loạt tin nhắn.', inline: false },
            { name: '/mute /unmute', value: 'Timeout hoặc role Muted vĩnh viễn. `duration`: `30s/10m/2h/7d`.', inline: false },
            { name: '/kick /ban /unban', value: 'Kick/ban member, unban bằng `user_id`. `ban` có `delete_messages` (giây).', inline: false },
            { name: '/warn', value: '`add/list/remove/clear` — cảnh cáo có lịch sử, lưu theo server.', inline: false },
            { name: '/lock /unlock /slowmode', value: 'Quản lý kênh; có thể chọn `channel?`.', inline: false },
          ),
        automod: new EmbedBuilder()
          .setTitle('🤖 Auto-moderation')
          .setColor(0xFEE75C)
          .addFields(
            { name: '/badwords', value: '`add/remove/list` — quản lý từ cấm.', inline: false },
            { name: '/automod', value: '`scan` quét badword, `test` kiểm tra text/image.', inline: false },
            { name: '/autodelete', value: '`add/remove/list` — tự xóa tin nhắn của user.', inline: false },
          ),
        features: new EmbedBuilder()
          .setTitle('🎫 Ticket / Pick Role / Welcome')
          .setColor(0x57F287)
          .addFields(
            { name: '/ticket', value: '`panel` gửi panel mở ticket, `close` đóng ticket hiện tại.', inline: false },
            { name: '/reactionroles', value: '`panel` gửi panel chọn role bằng emoji (cấu hình ở web panel).', inline: false },
            { name: '/welcome', value: '`test` xem thử tin nhắn/ảnh chào mừng. Cấu hình chi tiết ở web panel.', inline: false },
            { name: 'Web panel', value: 'https://minhtu446.github.io/discord-bot/# — cấu hình Welcome/Ticket/Pick Role và các tính năng.', inline: false },
          ),
        misc: new EmbedBuilder()
          .setTitle('🧰 Tiện ích & Hệ thống')
          .setColor(0x5865F2)
          .addFields(
            { name: '/say /dm /dmlogs', value: 'Gửi tin nhắn qua bot, gửi DM, xem lịch sử DM.', inline: false },
            { name: '/ping /userinfo /serverinfo /avatar', value: 'Thông tin bot, thành viên, server, avatar.', inline: false },
            { name: '/config', value: '`view` xem cấu hình, `channels` xem kênh setup.', inline: false },
          ),
      };
      const embed = pages[page] || pages.start;
      await interaction.reply({ embeds: [embed], flags: 64 });
    }
  },
};

module.exports = commands;
