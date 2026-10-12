const jsonCache = require('../jsonCache');
const webConfig = require('../webConfig');
const { EmbedBuilder } = require('discord.js');

const PANEL_TITLE = '🎭 Chọn role';
const panelsPath = jsonCache.getPath('pickrolePanels.json');
const PER_MESSAGE = 20;

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
  return webConfig.getFeature(guildId, 'pickrole') || { enabled: false, mode: 'multi', content: '', items: [] };
}

function getItems(guildId) {
  const f = feature(guildId);
  return Array.isArray(f.items) ? f.items : [];
}

function isSingle(guildId) {
  return feature(guildId).mode === 'single';
}

function chunkItems(guild, index) {
  const items = getItems(guild.id);
  const total = items.length;
  const parts = total ? Math.ceil(total / PER_MESSAGE) : 0;
  const i = parts ? Math.max(0, Math.min(index, parts - 1)) : 0;
  const slice = items.slice(i * PER_MESSAGE, Math.min((i + 1) * PER_MESSAGE, total));
  return { slice, total, parts, index: i };
}

function buildPanel(guild, index = 0) {
  const { slice, parts, index: i } = chunkItems(guild, index);
  const f = feature(guild.id);

  const descLines = slice.map(it => {
    const role = guild.roles.cache.get(it.roleId);
    const name = role ? role.name : 'role đã xóa';
    return `${it.emoji || '·'} **@${name}**`;
  });
  const listDesc = descLines.length ? descLines.join('\n') : 'Chưa có role nào được cấu hình trên web.';
  const head = f.content ? f.content + '\n\n' : '';
  const modeNote = isSingle(guild.id)
    ? 'Mỗi người chỉ giữ được **1 role** — chọn mới sẽ bỏ role cũ.'
    : 'Có thể giữ **nhiều role** cùng lúc.';

  const embed = new EmbedBuilder()
    .setTitle(PANEL_TITLE)
    .setDescription(
      head + (parts > 1 ? `**Phần ${i + 1}/${parts}**\n\n` : '') + listDesc + '\n\n' + modeNote +
      '\n**Thả emoji bên dưới để lấy role. Gỡ emoji để bỏ role.**'
    )
    .setColor(0x5865F2)
    .setFooter({ text: `Guild: ${guild.name}` });

  return { embeds: [embed] };
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
  if (!role.editable || role.managed) {
    return { ok: false, msg: 'Không thể gán role này (role quản trị/đặc biệt).' };
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
    return { ok: true, msg: `Đã chọn role **@${r.role.name}**${has ? ' (đã có sẵn).' : owned.length ? ` (bỏ ${owned.length} role cũ).` : '.'}` };
  }
  if (!has) await member.roles.add(roleId);
  return { ok: true, msg: has ? `Bạn đã có role **@${r.role.name}**.` : `Đã gán role **@${r.role.name}**.` };
}

async function removeRole(member, guildId, roleId) {
  const r = await resolveRole(member, guildId, roleId);
  if (!r.ok) return r;
  const has = member.roles.cache.has(roleId);
  if (has) await member.roles.remove(roleId);
  return { ok: true, msg: has ? `Đã bỏ role **@${r.role.name}**.` : `Bạn không có role **@${r.role.name}**.` };
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
  const sent = await channel.send(buildPanel(guild, index));
  const { slice } = chunkItems(guild, index);
  for (const it of slice) {
    try {
      await sent.react(it.emoji);
    } catch (e) {
      console.error(`[pickrole] react lỗi cho ${it.emoji}:`, e.message);
    }
  }
  return sent;
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
    let last = null;
    for (let i = 0; i < parts; i++) {
      last = await postPanel(interaction.channel, guild, i);
      upsertPanel({ guildId: guild.id, channelId: interaction.channelId, messageId: last.id });
    }
    const note = parts > 1 ? ` (${parts} phần)` : '';
    return interaction.editReply({ content: `✅ Đã tạo panel chọn role${note}! Thả emoji để lấy role.` });
  } catch (e) {
    console.error('[pickrole] send panel lỗi:', e.message);
    return interaction.editReply({ content: '❌ Không gửi được panel (bot cần quyền gửi tin nhắn và thêm reaction).' });
  }
}

function isPanelMessage(message) {
  if (!message || !Array.isArray(message.embeds) || !message.embeds.length) return false;
  return String(message.embeds[0].title || '') === PANEL_TITLE;
}

function matchItem(guildId, emoji) {
  const key = reactionKey(emoji);
  if (!key) return null;
  return getItems(guildId).find(it => itemKey(it.emoji) === key) || null;
}

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
  handleReactionAdd, handleReactionRemove, addRole, removeRole,
};