const jsonCache = require('../jsonCache');
const webConfig = require('../webConfig');
const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');

const panelsPath = jsonCache.getPath('pickrolePanels.json');
const PER_PAGE = 20;

function parseEmoji(raw) {
  if (!raw) return null;
  const s = String(raw);
  const m = s.match(/^<a?:(\w+):(\d+)>$/);
  if (m) return { name: m[1], id: m[2], animated: s.startsWith('<a:') };
  return s;
}

function feature(guildId) {
  return webConfig.getFeature(guildId, 'pickrole') || { enabled: false, mode: 'multi', content: '', items: [] };
}

function getItems(guildId) {
  const f = feature(guildId);
  return Array.isArray(f.items) ? f.items : [];
}

function isSingle(guildId) {
  return feature(guildId).mode === 'single';
}

function makeRoleButton(guild, item) {
  const role = guild.roles.cache.get(item.roleId);
  const label = role ? role.name : 'Role đã xóa';
  const b = new ButtonBuilder()
    .setCustomId(`pickrole_t_${guild.id}_${item.roleId}`)
    .setLabel(label.slice(0, 80))
    .setStyle(ButtonStyle.Primary);
  const emoji = parseEmoji(item.emoji);
  if (emoji) {
    if (typeof emoji === 'string') b.setEmoji(emoji);
    else b.setEmoji({ name: emoji.name, id: emoji.id, animated: emoji.animated });
  }
  return b;
}

function buildPanel(guild, page = 0) {
  const items = getItems(guild.id);
  const total = items.length;
  const maxPage = total ? Math.ceil(total / PER_PAGE) - 1 : 0;
  const p = Math.max(0, Math.min(page, maxPage));
  const slice = items.slice(p * PER_PAGE, Math.min((p + 1) * PER_PAGE, total));

  const rows = [];
  for (let i = 0; i < slice.length; i += 5) {
    rows.push(new ActionRowBuilder().addComponents(slice.slice(i, i + 5).map(it => makeRoleButton(guild, it))));
  }

  if (maxPage > 0) {
    rows.push(new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`pickrole_p_${guild.id}_${Math.max(0, p - 1)}`)
        .setLabel('⬅️ Trang trước')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(p === 0),
      new ButtonBuilder()
        .setCustomId(`pickrole_p_${guild.id}_${Math.min(maxPage, p + 1)}`)
        .setLabel('Trang sau ➡️')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(p === maxPage),
    ));
  }

  const f = feature(guild.id);
  const descLines = items.map(it => {
    const role = guild.roles.cache.get(it.roleId);
    const name = role ? role.name : 'role đã xóa';
    return `${it.emoji || '·'} **@${name}**`;
  });
  const listDesc = descLines.length ? descLines.join('\n') : 'Chưa có role nào được cấu hình trên web.';
  const head = f.content ? f.content + '\n\n' : '';
  const modeNote = isSingle(guild.id)
    ? 'Mỗi người chỉ chọn được **1 role** — chọn mới sẽ bỏ role cũ.'
    : 'Chọn **nhiều role** tùy thích.';

  const embed = new EmbedBuilder()
    .setTitle('🎭 Chọn role')
    .setDescription(
      head + listDesc + '\n\n' + modeNote + '\nBấm nút tương ứng để chọn/bỏ role.'
    )
    .setColor(0x5865F2)
    .setFooter({ text: `Guild: ${guild.name}${maxPage > 0 ? ' · Trang ' + (p + 1) + '/' + (maxPage + 1) : ''}` });

  return { embeds: [embed], components: rows };
}

async function applyRole(member, guildId, roleId) {
  const f = feature(guildId);
  if (f.enabled === false) return { ok: false, msg: 'Tính năng chọn role đang tắt.' };
  const items = Array.isArray(f.items) ? f.items : [];
  if (!items.some(x => x.roleId === roleId)) {
    return { ok: false, msg: 'Role này không còn trong cấu hình pickrole.' };
  }
  const guild = member.guild;
  const role = guild.roles.cache.get(roleId);
  if (!role) return { ok: false, msg: 'Role không tồn tại trong server.' };
  if (!role.editable || role.managed) {
    return { ok: false, msg: 'Không thể gán role này (role quản trị/đặc biệt).' };
  }
  if (!member.manageable) {
    return { ok: false, msg: 'Bot không đủ quyền để thay role cho bạn.' };
  }

  const has = member.roles.cache.has(roleId);
  if (isSingle(guildId)) {
    if (has) {
      await member.roles.remove(roleId);
      return { ok: true, msg: `Đã bỏ role **@${role.name}**.` };
    }
    const owned = items.map(x => x.roleId).filter(id => id !== roleId && member.roles.cache.has(id));
    if (owned.length) await member.roles.remove(owned);
    await member.roles.add(roleId);
    return { ok: true, msg: `Đã chọn role **@${role.name}**${owned.length ? ` (bỏ ${owned.length} role cũ).` : '.'}` };
  }

  if (has) {
    await member.roles.remove(roleId);
    return { ok: true, msg: `Đã bỏ role **@${role.name}**.` };
  }
  await member.roles.add(roleId);
  return { ok: true, msg: `Đã gán role **@${role.name}**.` };
}

function getPanels() {
  return jsonCache.readJSONArray(panelsPath);
}

function upsertPanel(entry) {
  const arr = getPanels();
  const idx = arr.findIndex(p => p.guildId === entry.guildId && p.channelId === entry.channelId);
  if (idx >= 0) arr[idx] = entry;
  else arr.push(entry);
  jsonCache.writeJSON(panelsPath, arr);
}

function removePanels(guildId) {
  const arr = getPanels();
  const next = arr.filter(p => p.guildId !== guildId);
  if (next.length !== arr.length) jsonCache.writeJSON(panelsPath, next);
}

async function sendPanel(interaction) {
  const guild = interaction.guild;
  const f = feature(guild.id);
  if (f.enabled === false) {
    return interaction.reply({ content: '❌ Tính năng chọn role đang tắt. Bật trong web cấu hình server.', flags: 64 });
  }
  const items = getItems(guild.id);
  if (!items.length) {
    return interaction.reply({ content: '❌ Chưa có role nào được cấu hình trên web. Vào trang cấu hình server để thêm.', flags: 64 });
  }
  await interaction.deferReply({ flags: 64 });
  try {
    const sent = await interaction.channel.send(buildPanel(guild, 0));
    upsertPanel({ guildId: guild.id, channelId: interaction.channelId, messageId: sent.id });
    return interaction.editReply({ content: '✅ Đã tạo panel chọn role!' });
  } catch (e) {
    console.error('[pickrole] send panel lỗi:', e.message);
    return interaction.editReply({ content: '❌ Không gửi được panel (bot cần quyền gửi tin nhắn).' });
  }
}

async function refreshPanels(client, guildId) {
  const panels = getPanels().filter(p => p.guildId === guildId);
  if (!panels.length) return;
  const guild = client.guilds.cache.get(guildId);
  if (!guild) {
    removePanels(guildId);
    return;
  }
  const f = feature(guildId);
  const items = getItems(guildId);
  const active = f.enabled !== false && items.length > 0;
  for (const p of panels) {
    try {
      const channel = client.channels.cache.get(p.channelId) || await client.channels.fetch(p.channelId).catch(() => null);
      if (!channel) { removePanels(guildId); continue; }
      const old = await channel.messages.fetch(p.messageId).catch(() => null);
      if (old) await old.delete().catch(() => {});
      if (active) {
        const sent = await channel.send(buildPanel(guild, 0));
        upsertPanel({ guildId, channelId: p.channelId, messageId: sent.id });
      } else {
        removePanels(guildId);
      }
    } catch (e) {
      console.error('[pickrole] refresh panel lỗi:', e.message);
    }
  }
}

async function handleButton(interaction, client) {
  const customId = interaction.customId;

  if (customId.startsWith('pickrole_t_')) {
    const rest = customId.slice('pickrole_t_'.length);
    const i = rest.indexOf('_');
    const guildId = rest.slice(0, i);
    const roleId = rest.slice(i + 1);
    if (interaction.guildId !== guildId) {
      return interaction.reply({ content: '❌ Sai server.', flags: 64 });
    }
    await interaction.deferReply({ flags: 64 });
    try {
      const member = interaction.member;
      const r = await applyRole(member, guildId, roleId);
      return interaction.editReply({ content: r.ok ? `✅ ${r.msg}` : `❌ ${r.msg}` });
    } catch (e) {
      console.error('[pickrole] apply role lỗi:', e.message);
      return interaction.editReply({ content: '❌ Lỗi khi thay đổi role (bot cần quyền Manage Roles).' });
    }
  }

  if (customId.startsWith('pickrole_p_')) {
    const rest = customId.slice('pickrole_p_'.length);
    const i = rest.indexOf('_');
    const guildId = rest.slice(0, i);
    const page = parseInt(rest.slice(i + 1), 10) || 0;
    if (interaction.guildId !== guildId) {
      return interaction.reply({ content: '❌ Sai server.', flags: 64 });
    }
    const guild = interaction.guild;
    return interaction.update(buildPanel(guild, page)).catch(() => {});
  }
}

async function init(client) {
  webConfig.onConfigChange(async (c, gid) => {
    await refreshPanels(c, gid).catch(() => {});
  });
  for (const [gid] of client.guilds.cache) {
    await refreshPanels(client, gid).catch(() => {});
  }
}

module.exports = { sendPanel, handleButton, applyRole, buildPanel, getItems, refreshPanels, init, getPanels, upsertPanel };
