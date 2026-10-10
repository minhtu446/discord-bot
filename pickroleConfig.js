const jsonCache = require('./jsonCache');
const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');

const WORKER = 'https://clowo-locks.clowo.workers.dev';
const panelsPath = jsonCache.getPath('pickrolePanels.json');
const configCachePath = jsonCache.getPath('pickroleConfig.json');
const PER_PAGE = 20;

let configs = {};
const refreshed = {};

function botKey() {
  return process.env.BOT_KEY || '';
}

function parseEmoji(raw) {
  if (!raw) return null;
  const s = String(raw);
  const m = s.match(/^<a?:(\w+):(\d+)>$/);
  if (m) return { name: m[1], id: m[2], animated: s.startsWith('<a:') };
  return s;
}

async function fetchAllConfigs() {
  if (!botKey()) return false;
  try {
    const r = await fetch(WORKER + '/pickrole/bot/configs', {
      headers: { 'x-bot-key': botKey() },
    });
    if (!r.ok) return false;
    const data = await r.json();
    configs = (data && typeof data === 'object' && !Array.isArray(data)) ? data : {};
    jsonCache.writeJSON(configCachePath, configs);
    return true;
  } catch (e) {
    console.error('[pickrole] fetch configs lỗi:', e.message);
    return false;
  }
}

function getConfig(guildId) {
  return configs[guildId] || null;
}

function getItems(guildId) {
  const c = getConfig(guildId);
  return (c && Array.isArray(c.items)) ? c.items : [];
}

function isSingle(guildId) {
  const c = getConfig(guildId);
  return !!c && c.mode === 'single';
}

function makeRoleButton(guild, item) {
  const role = guild.roles.cache.get(item.roleId);
  const label = role ? role.name : 'Role đã xóa';
  const emoji = parseEmoji(item.emoji);
  const b = new ButtonBuilder()
    .setCustomId(`pickrole_t_${guild.id}_${item.roleId}`)
    .setLabel(label.slice(0, 80))
    .setStyle(ButtonStyle.Primary);
  if (emoji) {
    if (typeof emoji === 'string') b.setEmoji(emoji);
    else b.setEmoji({ name: emoji.name, id: emoji.id, animated: emoji.animated });
  }
  return b;
}

function buildPickPanel(guild, items, page = 0) {
  const total = items.length;
  const maxPage = total ? Math.ceil(total / PER_PAGE) - 1 : 0;
  const p = Math.max(0, Math.min(page, maxPage));
  const slice = items.slice(p * PER_PAGE, Math.min((p + 1) * PER_PAGE, total));

  const rows = [];
  for (let i = 0; i < slice.length; i += 5) {
    rows.push(new ActionRowBuilder().addComponents(slice.slice(i, i + 5).map(it => makeRoleButton(guild, it))));
  }

  if (maxPage > 0) {
    const nav = new ActionRowBuilder().addComponents(
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
    );
    rows.push(nav);
  }

  const descLines = items.map(it => {
    const role = guild.roles.cache.get(it.roleId);
    const name = role ? role.name : 'role đã xóa';
    return `${it.emoji || '·'} **@${name}**`;
  });
  const desc = descLines.length
    ? descLines.join('\n')
    : 'Chưa có role nào được cấu hình trên web.';

  const embed = new EmbedBuilder()
    .setTitle('🎭 Chọn role')
    .setDescription(
      desc + '\n\n' +
      (isSingle(guild.id)
        ? 'Mỗi người chỉ chọn được **1 role** — chọn mới sẽ bỏ role cũ.'
        : 'Chọn **nhiều role** tùy thích.') +
      '\nBấm nút tương ứng để chọn/bỏ role.'
    )
    .setColor(0x5865F2)
    .setFooter({ text: `Guild: ${guild.name}${maxPage > 0 ? ' · Trang ' + (p + 1) + '/' + (maxPage + 1) : ''}` });

  return { embeds: [embed], components: rows };
}

async function applyRole(member, guildId, roleId) {
  const items = getItems(guildId);
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

async function refreshPanels(client, guildId) {
  const panels = getPanels().filter(p => p.guildId === guildId);
  if (!panels.length) return;
  const guild = client.guilds.cache.get(guildId);
  if (!guild) {
    removePanels(guildId);
    return;
  }
  const items = getItems(guildId);
  for (const p of panels) {
    try {
      const channel = client.channels.cache.get(p.channelId);
      if (!channel) continue;
      const old = await channel.messages.fetch(p.messageId).catch(() => null);
      if (old) await old.delete().catch(() => {});
      if (items.length) {
        const sent = await channel.send(buildPickPanel(guild, items, 0));
        upsertPanel({ guildId, channelId: p.channelId, messageId: sent.id });
      }
    } catch (e) {
      console.error('[pickrole] refresh panel lỗi:', e.message);
    }
  }
}

function guildRolePayload(guild) {
  const roles = [...guild.roles.cache.values()]
    .filter(r => r.id !== guild.id)
    .map(r => ({
      id: r.id,
      name: r.name,
      color: r.color || 0,
      position: r.position,
      managed: !!(r.managed || r.tags?.botId || r.tags?.integrationId || r.tags?.premiumSubscriberRole),
      editable: Boolean(r.editable),
    }));
  const emojis = [...guild.emojis.cache.values()].map(e => ({
    id: e.id,
    name: e.name,
    animated: !!e.animated,
  }));
  return { guildId: guild.id, roles, emojis };
}

async function pushRoles(client) {
  if (!botKey()) return;
  for (const [, guild] of client.guilds.cache) {
    try {
      const r = await fetch(WORKER + '/pickrole/bot/roles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-bot-key': botKey() },
        body: JSON.stringify(guildRolePayload(guild)),
      });
      if (!r.ok) console.warn('[pickrole] push roles', guild.id, r.status);
    } catch (e) {
      console.error('[pickrole] push roles lỗi:', e.message);
    }
  }
}

let cycleLock = false;
let rolesTimer = null;

async function runCycle(client) {
  if (cycleLock) return;
  cycleLock = true;
  try {
    const ok = await fetchAllConfigs();
    if (ok) {
      for (const gid of Object.keys(configs)) {
        const cfg = configs[gid];
        if (cfg && refreshed[gid] !== cfg.rev) {
          refreshed[gid] = cfg.rev;
          await refreshPanels(client, gid).catch(() => {});
        }
      }
    }
  } finally {
    cycleLock = false;
  }
}

function startPolling(client) {
  pushRoles(client);
  runCycle(client);
  setInterval(() => runCycle(client), 30000);
  rolesTimer = setInterval(() => pushRoles(client), 300000);
}

function stopPolling() {
  if (rolesTimer) clearInterval(rolesTimer);
}

module.exports = {
  fetchAllConfigs,
  getConfig,
  getItems,
  isSingle,
  buildPickPanel,
  applyRole,
  getPanels,
  upsertPanel,
  removePanels,
  refreshPanels,
  pushRoles,
  startPolling,
  stopPolling,
};