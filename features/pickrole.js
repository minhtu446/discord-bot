const crypto = require('crypto');
const jsonCache = require('../jsonCache');
const webConfig = require('../webConfig');
const { EmbedBuilder } = require('discord.js');

const PANEL_TITLE = '🎭 Chọn role';
const panelsPath = jsonCache.getPath('pickrolePanels.json');

// Discord giới hạn 20 reaction mỗi tin nhắn → mỗi tin tối đa 20 role.
// Nhiều hơn 20 thì bot tách thành nhiều tin (worker giới hạn tối đa 100 role).
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
  return webConfig.getFeature(guildId, 'pickrole') || { enabled: false, mode: 'multi', title: '', content: '', items: [] };
}

function getItems(guildId) {
  const f = feature(guildId);
  return Array.isArray(f.items) ? f.items : [];
}

function isSingle(guildId) {
  return feature(guildId).mode === 'single';
}

// index = số thứ tự TIN NHẮN (mỗi tin tối đa 20 role)
function chunkItems(guild, index) {
  const items = getItems(guild.id);
  const total = items.length;
  const parts = total ? Math.ceil(total / PER_MESSAGE) : 0;
  const i = parts ? Math.max(0, Math.min(index, parts - 1)) : 0;
  const offset = i * PER_MESSAGE;
  const slice = items.slice(offset, Math.min(offset + PER_MESSAGE, total));
  return { slice, total, parts, index: i, offset };
}

// Mỗi dòng dùng MENTION THẬT của role (<@&id>) → hiện thành tag role bấm được trong Discord
function roleLine(guild, it) {
  const role = guild.roles.cache.get(it.roleId);
  if (!role) return `${it.emoji || '·'} **role đã xóa**`;
  return `${it.emoji || '·'} <@&${it.roleId}>`;
}

function buildPanel(guild, index = 0) {
  const { slice, parts, index: i } = chunkItems(guild, index);
  const f = feature(guild.id);

  const lines = slice.map(it => roleLine(guild, it));
  const listDesc = lines.length ? lines.join('\n') : 'Chưa có role nào được cấu hình trên web.';
  const head = f.content ? f.content + '\n\n' : '';
  const modeNote = isSingle(guild.id)
    ? 'Mỗi người chỉ giữ được **1 role** — thả emoji mới sẽ bỏ role cũ.'
    : 'Có thể giữ **nhiều role** cùng lúc.';

  const embed = new EmbedBuilder()
    .setTitle(f.title ? String(f.title) : PANEL_TITLE)
    .setDescription(
      head + (parts > 1 ? `**Phần ${i + 1}/${parts}**\n\n` : '') + listDesc + '\n\n' + modeNote +
      '\n**Thả emoji bên dưới để lấy role — gỡ emoji để bỏ role.**'
    )
    .setColor(0x5865F2);

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
    return { ok: true, role: r.role, msg: `Đã chọn role <@&${r.role.id}>${has ? ' (đã có sẵn).' : owned.length ? ` (bỏ ${owned.length} role cũ).` : '.'}` };
  }
  if (!has) await member.roles.add(roleId);
  return { ok: true, role: r.role, msg: has ? `Bạn đã có role <@&${r.role.id}>.` : `Đã gán role <@&${r.role.id}>.` };
}

async function removeRole(member, guildId, roleId) {
  const r = await resolveRole(member, guildId, roleId);
  if (!r.ok) return r;
  const has = member.roles.cache.has(roleId);
  if (has) await member.roles.remove(roleId);
  return { ok: true, role: r.role, msg: has ? `Đã bỏ role <@&${r.role.id}>.` : `Bạn không có role <@&${r.role.id}>.` };
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
    if (!it.emoji) continue;
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
    const sig = panelSig(guild.id);
    for (let i = 0; i < parts; i++) {
      const sent = await postPanel(interaction.channel, guild, i);
      upsertPanel({ guildId: guild.id, channelId: interaction.channelId, messageId: sent.id, index: i, sig });
    }
    const note = parts > 1 ? ` (${parts} phần)` : '';
    return interaction.editReply({ content: `✅ Đã tạo panel chọn role${note}! Thả emoji để nhận / bỏ role.` });
  } catch (e) {
    console.error('[pickrole] send panel lỗi:', e.message);
    return interaction.editReply({ content: '❌ Không gửi được panel (bot cần quyền Gửi tin nhắn và Thêm reaction).' });
  }
}

// ─── Panel MENU CHỌN cũ (đã bỏ) ───
// Giữ lại để ai còn bấm menu ở panel cũ nhận được lời nhắc, thay vì lỗi "interaction failed".
// Bot sẽ tự xoá panel cũ và đăng lại panel thả emoji khi khởi động.
async function handleSelect(interaction) {
  try {
    const content = '⚠️ Panel này đã đổi cách dùng: hãy **thả emoji** ở panel mới để nhận role (menu chọn không còn dùng).';
    if (interaction.deferred || interaction.replied) await interaction.editReply({ content }).catch(() => {});
    else await interaction.reply({ content, flags: 64 }).catch(() => {});
  } catch { /* bỏ qua */ }
  return true;
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
      // DM là ngữ cảnh riêng nên mention role không hiện được → thay bằng chữ "role"
      user.send(`❌ ${r.msg.replace(/\*\*/g, '').replace(/<@&\d+>/g, 'role')}`).catch(() => {});
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
      user.send(`❌ ${r.msg.replace(/\*\*/g, '').replace(/<@&\d+>/g, 'role')}`).catch(() => {});
    }
  } catch (e) {
    console.error('[pickrole] handleReactionRemove lỗi:', e.message);
  }
}

// Chữ ký nội dung pickrole (enabled/mode/title/content/items) — đổi gì đều nhảy sig.
function panelSig(guildId) {
  const f = feature(guildId);
  const items = Array.isArray(f.items) ? f.items : [];
  const payload = {
    enabled: f.enabled !== false,
    mode: String(f.mode || 'multi'),
    title: String(f.title || ''),
    content: String(f.content || ''),
    items: items.map(it => ({ e: String(it.emoji || ''), r: String(it.roleId || '') })),
  };
  return crypto.createHash('sha1').update(JSON.stringify(payload)).digest('hex');
}

async function fetchMsg(channel, id) {
  try { return await channel.messages.fetch(id); } catch { return null; }
}

// Reaction theo items của phần `index`: xoá sạch rồi react lại (chỉ chạy khi NỘI DUNG đổi).
async function syncReactions(msg, guild, index) {
  const { slice } = chunkItems(guild, index);
  try { await msg.reactions.removeAll(); } catch {}
  for (const it of slice) {
    if (!it.emoji) continue;
    try { await msg.react(it.emoji); } catch (e) {
      console.error(`[pickrole] react lỗi cho ${it.emoji}:`, e.message);
    }
  }
}

// Đồng bộ panel: EDIT TẠI CHỐ thay vì xoá + gửi lại.
// • sig không đổi → KHÔNG đụng gì (restart 6h / sửa welcome, ticket trên web không làm panel nhảy).
// • sig đổi → message.edit() + làm lại reaction; messageId giữ nguyên (member không mất reaction vị trí).
// • message bị xoá tay → đăng lại đúng phần đó; số phần tăng → gửi thêm; giảm → xoá message thừa.
async function refreshPanels(client, guildId) {
  const guild = client.guilds.cache.get(guildId);
  if (!guild) { removePanels(guildId); return; }
  const entries = getPanels().filter(p => p.guildId === guildId);
  const f = feature(guildId);
  const items = getItems(guildId);
  const active = f.enabled !== false && items.length > 0;
  const parts = active ? chunkItems(guild, 0).parts : 0;
  const sig = panelSig(guildId);

  // Gom entry theo kênh; entry cũ chưa có index → dồn theo thứ tự trong file.
  const byChannel = new Map();
  for (const e of entries) {
    const arr = byChannel.get(e.channelId) || [];
    if (!byChannel.has(e.channelId)) byChannel.set(e.channelId, arr);
    arr.push(e);
  }

  const next = [];
  let changed = false;

  for (const [channelId, list] of byChannel) {
    let channel = client.channels.cache.get(channelId);
    if (!channel) {
      try { channel = await client.channels.fetch(channelId); } catch {}
    }
    if (!channel) { changed = true; continue; } // kênh đã bỏ → hủy entry, message rơi ra "mồ côi"

    // 1) Số phần giảm → xoá message thừa (phần cuối danh sách).
    const keepCount = Math.min(list.length, parts);
    for (let k = keepCount; k < list.length; k++) {
      const old = await fetchMsg(channel, list[k].messageId);
      if (old) await old.delete().catch(() => {});
      changed = true;
    }

    // 2) Giữ + edit từng phần còn lại.
    for (let k = 0; k < keepCount; k++) {
      const e = list[k];
      const targetI = Math.min(Number.isInteger(e.index) ? e.index : k, Math.max(parts - 1, 0));
      const msg = await fetchMsg(channel, e.messageId);
      if (!msg) {
        // message bị xoá tay → đăng lại đúng phần này
        try {
          const sent = await postPanel(channel, guild, targetI);
          next.push({ guildId, channelId: channel.id, messageId: sent.id, index: targetI, sig });
        } catch (err) {
          console.error('[pickrole] re-post panel:', err.message);
          next.push(e);
        }
        changed = true;
        continue;
      }
      if (e.sig === sig) { next.push(e); continue; } // KHÔNG đổi gì cả
      try {
        await msg.edit(buildPanel(guild, targetI));
        await syncReactions(msg, guild, targetI);
        next.push({ guildId, channelId: channel.id, messageId: msg.id, index: targetI, sig });
      } catch (err) {
        console.error('[pickrole] edit panel:', err.message);
        next.push({ ...e, sig });
      }
      changed = true;
    }

    // 3) Số phần tăng → đăng thêm các index còn thiếu.
    const have = new Set();
    for (const e of next) if (e.channelId === channel.id) have.add(e.index);
    for (let k = 0; k < parts; k++) {
      if (have.has(k)) continue;
      try {
        const sent = await postPanel(channel, guild, k);
        next.push({ guildId, channelId: channel.id, messageId: sent.id, index: k, sig });
        changed = true;
      } catch (err) {
        console.error('[pickrole] post thêm phần:', err.message);
      }
    }
  }

  const others = getPanels().filter(p => p.guildId !== guildId);
  if (changed || next.length !== entries.length) {
    jsonCache.writeJSON(panelsPath, [...others, ...next]);
  } else if (entries.some(e => !e.sig)) {
    // Entry cũ chưa có sig nhưng message còn nguyên → chỉ bổ sung sig, không đụng Discord.
    jsonCache.writeJSON(panelsPath, [...others, ...entries.map(e => ({ ...e, sig }))]);
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
  panelTitle, isPanelMessage, panelSig, PANEL_TITLE, PER_MESSAGE,
};
