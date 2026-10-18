const jsonCache = require('../jsonCache');
const webConfig = require('../webConfig');
const { EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder, StringSelectMenuOptionBuilder } = require('discord.js');

const PANEL_TITLE = '🎭 Chọn role';
const panelsPath = jsonCache.getPath('pickrolePanels.json');

// Discord giới hạn: tối đa 25 lựa chọn mỗi menu, tối đa 5 menu mỗi tin
// => 125 role mỗi tin nhắn (trước đây dùng reaction nên chỉ được 20/tin).
const PER_MENU = 25;
const MENUS_PER_MESSAGE = 5;
const PER_MESSAGE = PER_MENU * MENUS_PER_MESSAGE;
const DESC_BUDGET = 3400; // embed description tối đa 4096 ký tự

function parseEmoji(raw) {
  if (!raw) return null;
  const s = String(raw);
  const m = s.match(/^<a?:(\w+):(\d+)>$/);
  if (m) return { name: m[1], id: m[2], animated: s.startsWith('<a:') };
  return s;
}

function itemKey(raw) {
  const p = parseEmoji(raw);
  if (!p) return null;
  return typeof p === 'string' ? p : p.id;
}

function reactionKey(emoji) {
  if (!emoji) return null;
  return emoji.id || (typeof emoji.name === 'string' ? emoji.name : null);
}

function feature(guildId) {
  return webConfig.getFeature(guildId, 'pickrole') || { enabled: false, mode: 'multi', title: '', content: '', items: [] };
}

function getItems(guildId) {
  const f = feature(guildId);
  return Array.isArray(f.items) ? f.items : [];
}

function isSingle(guildId) {
  return feature(guildId).mode === 'single';
}

// index = số thứ tự TIN NHẮN (mỗi tin tối đa 125 role)
function chunkItems(guild, index) {
  const items = getItems(guild.id);
  const total = items.length;
  const parts = total ? Math.ceil(total / PER_MESSAGE) : 0;
  const i = parts ? Math.max(0, Math.min(index, parts - 1)) : 0;
  const offset = i * PER_MESSAGE;
  const slice = items.slice(offset, Math.min(offset + PER_MESSAGE, total));
  return { slice, total, parts, index: i, offset };
}

// mỗi tin nhắn chứa tối đa 5 menu (mỗi menu 25 role)
function menuRows(guild, slice, offset) {
  const single = isSingle(guild.id);
  const rows = [];
  for (let s = 0; s < slice.length && rows.length < MENUS_PER_MESSAGE; s += PER_MENU) {
    const part = slice.slice(s, s + PER_MENU);
    const chunk = Math.floor((offset + s) / PER_MENU);
    const from = offset + s + 1;
    const to = offset + s + part.length;
    const menu = new StringSelectMenuBuilder()
      .setCustomId(`pickrole:sel:${guild.id}:${chunk}`)
      .setPlaceholder(single ? 'Chọn 1 role...' : `Chọn role (${from}–${to})...`)
      .setMinValues(0)
      .setMaxValues(single ? 1 : Math.min(part.length, PER_MENU));
    for (const it of part) {
      const role = guild.roles.cache.get(it.roleId);
      const opt = new StringSelectMenuOptionBuilder()
        .setValue(String(it.roleId))
        .setLabel(String((role && role.name) || 'role đã xóa').slice(0, 100));
      const em = parseEmoji(it.emoji);
      if (em) {
        try {
          if (typeof em === 'string') opt.setEmoji(em);
          else opt.setEmoji({ id: em.id, name: em.name, animated: em.animated });
        } catch {
          // emoji không hợp lệ với menu thì bỏ qua, không làm hỏng cả panel
        }
      }
      menu.addOptions(opt);
    }
    rows.push(new ActionRowBuilder().addComponents(menu));
  }
  return rows;
}

function buildPanel(guild, index = 0) {
  const { slice, parts, index: i } = chunkItems(guild, index);
  const f = feature(guild.id);

  const lines = [];
  let budget = DESC_BUDGET;
  for (const it of slice) {
    const role = guild.roles.cache.get(it.roleId);
    const name = role ? role.name : 'role đã xóa';
    const line = `${it.emoji || '·'} **@${name}**`;
    if (line.length + 1 > budget) break;
    lines.push(line);
    budget -= line.length + 1;
  }
  if (lines.length < slice.length) {
    lines.push(`… và **${slice.length - lines.length}** role khác (xem trong menu bên dưới).`);
  }
  const listDesc = lines.length ? lines.join('\n') : 'Chưa có role nào được cấu hình trên web.';
  const head = f.content ? f.content + '\n\n' : '';
  const modeNote = isSingle(guild.id)
    ? 'Mỗi người chỉ giữ được **1 role** — chọn role mới sẽ thay role cũ.'
    : 'Có thể giữ **nhiều role** cùng lúc — chọn để nhận, bỏ chọn để gỡ.';

  const embed = new EmbedBuilder()
    .setTitle(f.title ? String(f.title) : PANEL_TITLE)
    .setDescription(
      head + (parts > 1 ? `**Phần ${i + 1}/${parts}**\n\n` : '') + listDesc + '\n\n' + modeNote +
      '\n**Chọn trong menu bên dưới để nhận / bỏ role.**'
    )
    .setColor(0x5865F2);

  return { embeds: [embed], components: menuRows(guild, slice, i * PER_MESSAGE) };
}

async function resolveRole(member, guildId, roleId) {
  const f = feature(guildId);
  if (f.enabled === false) return { ok: false, msg: 'Tính năng chọn role đang tắt.' };
  const items = Array.isArray(f.items) ? f.items : [];
  if (!items.some(x => x.roleId === roleId)) {
    return { ok: false, msg: 'Role này không còn trong cấu hình pickrole.' };
  }
  const role = member.guild.roles.cache.get(roleId);
  if (!role) return { ok: false, msg: 'Role không tồn tại trong server.' };
  if (role.managed) {
    return { ok: false, msg: 'Role này là role hệ thống/integration, server không cho gán.' };
  }
  if (!role.editable) {
    return { ok: false, msg: 'Bot chưa quản lý được role này. Hãy kéo role bot lên **trên** role này và bật quyền **Manage Roles**, rồi thử lại.' };
  }
  if (!member.manageable) {
    return { ok: false, msg: 'Bot không đủ quyền để thay role cho bạn.' };
  }
  return { ok: true, role };
}

async function addRole(member, guildId, roleId) {
  const r = await resolveRole(member, guildId, roleId);
  if (!r.ok) return r;
  const has = member.roles.cache.has(roleId);
  if (isSingle(guildId)) {
    const owned = Array.isArray(feature(guildId).items)
      ? feature(guildId).items.map(x => x.roleId)
          .filter(id => id !== roleId && member.roles.cache.has(id))
      : [];
    if (owned.length) await member.roles.remove(owned);
    if (!has) await member.roles.add(roleId);
    return { ok: true, role: r.role, msg: `Đã chọn role **@${r.role.name}**${has ? ' (đã có sẵn).' : owned.length ? ` (bỏ ${owned.length} role cũ).` : '.'}` };
  }
  if (!has) await member.roles.add(roleId);
  return { ok: true, role: r.role, msg: has ? `Bạn đã có role **@${r.role.name}**.` : `Đã gán role **@${r.role.name}**.` };
}

async function removeRole(member, guildId, roleId) {
  const r = await resolveRole(member, guildId, roleId);
  if (!r.ok) return r;
  const has = member.roles.cache.has(roleId);
  if (has) await member.roles.remove(roleId);
  return { ok: true, role: r.role, msg: has ? `Đã bỏ role **@${r.role.name}**.` : `Bạn không có role **@${r.role.name}**.` };
}

function getPanels() {
  return jsonCache.readJSONArray(panelsPath).slice(0, 200);
}

function upsertPanel(entry) {
  const arr = getPanels();
  const idx = arr.findIndex(p => p.messageId === entry.messageId);
  if (idx >= 0) arr[idx] = entry;
  else arr.push(entry);
  jsonCache.writeJSON(panelsPath, arr);
}

function removePanels(guildId) {
  const arr = getPanels();
  const next = arr.filter(p => p.guildId !== guildId);
  if (next.length !== arr.length) jsonCache.writeJSON(panelsPath, next);
}

async function postPanel(channel, guild, index) {
  return channel.send(buildPanel(guild, index));
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
    const { parts } = chunkItems(guild, 0);
    for (let i = 0; i < parts; i++) {
      const sent = await postPanel(interaction.channel, guild, i);
      upsertPanel({ guildId: guild.id, channelId: interaction.channelId, messageId: sent.id });
    }
    const note = parts > 1 ? ` (${parts} phần)` : '';
    return interaction.editReply({ content: `✅ Đã tạo panel chọn role${note}! Chọn trong menu để nhận / bỏ role.` });
  } catch (e) {
    console.error('[pickrole] send panel lỗi:', e.message);
    return interaction.editReply({ content: '❌ Không gửi được panel (bot cần quyền gửi tin nhắn kèm menu).' });
  }
}

// ─── Xử lý menu chọn role (StringSelectMenu) ───
async function handleSelect(interaction) {
  const id = String(interaction.customId || '');
  if (!id.startsWith('pickrole:sel:')) return false;
  try {
    const guild = interaction.guild;
    const parts = id.split(':');
    const guildId = parts[2];
    const chunk = Math.max(0, parseInt(parts[3], 10) || 0);
    if (!guild || !guildId || guildId !== interaction.guildId) return true;

    const items = getItems(guildId);
    const offset = chunk * PER_MENU;
    const slice = items.slice(offset, offset + PER_MENU);
    const byRole = new Map(slice.map(it => [String(it.roleId), it]));
    const picked = new Set((interaction.values || []).map(String));

    const member = guild.members.cache.get(interaction.user.id)
      || await guild.members.fetch(interaction.user.id).catch(() => null);
    if (!member) {
      await interaction.reply({ content: '❌ Không tìm thấy thành viên của bạn trong server.', flags: 64 }).catch(() => {});
      return true;
    }

    if (!interaction.deferred && !interaction.replied) {
      await interaction.deferReply({ flags: 64 }).catch(() => {});
    }

    const has = new Set(member.roles.cache.keys());
    const added = new Map();
    const removed = new Map();
    const failed = [];

    const doAdd = async (roleId) => {
      const r = await addRole(member, guildId, roleId);
      if (r.ok) {
        has.add(roleId);
        if (!added.has(roleId)) added.set(roleId, (r.role && r.role.name) || roleId);
      } else failed.push(r.msg);
    };
    const doRemove = async (roleId) => {
      const r = await removeRole(member, guildId, roleId);
      if (r.ok) {
        has.delete(roleId);
        if (!removed.has(roleId)) removed.set(roleId, (r.role && r.role.name) || roleId);
      } else failed.push(r.msg);
    };

    // 1) Bỏ những role của menu này đang có mà người dùng đã bỏ chọn
    for (const roleId of byRole.keys()) {
      if (picked.has(roleId)) continue;
      if (has.has(roleId)) await doRemove(roleId);
    }
    // 2) Chế độ 1 role: bỏ mọi role pickrole khác (ở các menu khác)
    if (isSingle(guildId)) {
      const keep = picked.size ? [...picked][0] : null;
      for (const it of items) {
        const roleId = String(it.roleId);
        if (roleId === keep) continue;
        if (has.has(roleId)) await doRemove(roleId);
      }
    }
    // 3) Thêm role được chọn
    for (const roleId of picked) {
      if (!byRole.has(roleId)) continue;
      if (!has.has(roleId)) await doAdd(roleId);
    }

    const lines = [];
    if (added.size) lines.push('✅ Đã thêm: ' + [...added.values()].map(n => `**@${n}**`).join(', '));
    if (removed.size) lines.push('➖ Đã bỏ: ' + [...removed.values()].map(n => `**@${n}**`).join(', '));
    if (failed.length) lines.push('⚠️ ' + failed.join('\n⚠️ '));
    if (!lines.length) lines.push('Không có thay đổi nào.');
    const content = lines.join('\n').slice(0, 1900);
    if (interaction.deferred || interaction.replied) await interaction.editReply({ content }).catch(() => {});
    else await interaction.reply({ content, flags: 64 }).catch(() => {});
    return true;
  } catch (e) {
    console.error('[pickrole] handleSelect lỗi:', e.message);
    try {
      const content = '❌ Có lỗi khi đổi role, thử lại sau.';
      if (interaction.deferred || interaction.replied) await interaction.editReply({ content });
      else await interaction.reply({ content, flags: 64 });
    } catch { /* bỏ qua */ }
    return true;
  }
}

function panelTitle(guildId) {
  try {
    const f = feature(guildId);
    return (f && f.title) ? String(f.title) : PANEL_TITLE;
  } catch { return PANEL_TITLE; }
}

function isPanelMessage(message) {
  if (!message || !Array.isArray(message.embeds) || !message.embeds.length) return false;
  const gid = message.guildId || (message.guild && message.guild.id);
  return String(message.embeds[0].title || '') === panelTitle(gid);
}

function matchItem(guildId, emoji) {
  const key = reactionKey(emoji);
  if (!key) return null;
  return getItems(guildId).find(it => itemKey(it.emoji) === key) || null;
}

// Giữ lại để tương thích với các panel reaction cũ (panel cũ bị xoá khi bot khởi động)
async function handleReactionAdd(reaction, user, client) {
  try {
    if (user.bot) return;
    try { if (reaction.partial) await reaction.fetch(); } catch { return; }
    const message = reaction.message;
    try { if (message && message.partial) await message.fetch(); } catch { return; }
    if (!message) return;
    const guildId = message.guildId || (message.guild && message.guild.id);
    if (!guildId) return;
    if (!isPanelMessage(message) || message.author?.id !== client.user.id) return;
    const item = matchItem(guildId, reaction.emoji);
    if (!item) return;
    const guild = client.guilds.cache.get(guildId);
    const member = guild ? (guild.members.cache.get(user.id) || await guild.members.fetch(user.id).catch(() => null)) : null;
    if (!member) return;
    const r = await addRole(member, guildId, item.roleId);
    if (!r.ok) {
      console.warn('[pickrole] add role:', r.msg);
      user.send(`❌ ${r.msg.replace(/\*\*/g, '')}`).catch(() => {});
    }
  } catch (e) {
    console.error('[pickrole] handleReactionAdd lỗi:', e.message);
  }
}

async function handleReactionRemove(reaction, user, client) {
  try {
    if (user.bot) return;
    try { if (reaction.partial) await reaction.fetch(); } catch { return; }
    const message = reaction.message;
    try { if (message && message.partial) await message.fetch(); } catch { return; }
    if (!message) return;
    const guildId = message.guildId || (message.guild && message.guild.id);
    if (!guildId) return;
    if (!isPanelMessage(message) || message.author?.id !== client.user.id) return;
    const item = matchItem(guildId, reaction.emoji);
    if (!item) return;
    const guild = client.guilds.cache.get(guildId);
    const member = guild ? (guild.members.cache.get(user.id) || await guild.members.fetch(user.id).catch(() => null)) : null;
    if (!member) return;
    const r = await removeRole(member, guildId, item.roleId);
    if (!r.ok) {
      console.warn('[pickrole] remove role:', r.msg);
      user.send(`❌ ${r.msg.replace(/\*\*/g, '')}`).catch(() => {});
    }
  } catch (e) {
    console.error('[pickrole] handleReactionRemove lỗi:', e.message);
  }
}

async function refreshPanels(client, guildId) {
  const panels = getPanels().filter(p => p.guildId === guildId);
  if (!panels.length) return;
  const guild = client.guilds.cache.get(guildId);
  if (!guild) { removePanels(guildId); return; }
  const f = feature(guildId);
  const items = getItems(guildId);
  const active = f.enabled !== false && items.length > 0;
  const channels = new Set();
  for (const p of panels) {
    try {
      const channel = client.channels.cache.get(p.channelId) || await client.channels.fetch(p.channelId).catch(() => null);
      if (!channel) continue;
      channels.add(channel.id);
      const old = await channel.messages.fetch(p.messageId).catch(() => null);
      if (old) await old.delete().catch(() => {});
    } catch (e) {
      console.error('[pickrole] refresh panel (xoá cũ) lỗi:', e.message);
    }
  }
  removePanels(guildId);
  if (!active) return;
  const { parts } = chunkItems(guild, 0);
  for (const channelId of channels) {
    const channel = client.channels.cache.get(channelId);
    if (!channel) continue;
    for (let i = 0; i < parts; i++) {
      try {
        const sent = await postPanel(channel, guild, i);
        upsertPanel({ guildId, channelId: channel.id, messageId: sent.id });
      } catch (e) {
        console.error('[pickrole] refresh panel (re-post) lỗi:', e.message);
      }
    }
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

module.exports = {
  sendPanel, buildPanel, getItems, refreshPanels, init, getPanels, upsertPanel,
  handleReactionAdd, handleReactionRemove, handleSelect, addRole, removeRole,
  panelTitle, isPanelMessage, PANEL_TITLE, PER_MENU, MENUS_PER_MESSAGE, PER_MESSAGE,
};
