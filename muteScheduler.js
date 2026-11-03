// Hẹn giờ gỡ role "Muted" khi /mute có thời hạn.
// Dữ liệu lưu mutes.json (jsonCache) → sống qua restart: mỗi 60s quét 1 lần,
// hết hạn là gỡ role. Không dùng setTimeout dài (Node giới hạn ~24,8 ngày).
const jsonCache = require('./jsonCache');
const configHelper = require('./configHelper');

const mutesPath = jsonCache.getPath('mutes.json');
const CHECK_MS = 60 * 1000;
const MAX_MS = 28 * 24 * 60 * 60 * 1000; // 28 ngày

function getList() {
  return jsonCache.readJSONArray(mutesPath);
}

// '30s' | '10m' | '2h' | '7d' → ms. Bỏ trống / sai format / vượt 28 ngày → null (vĩnh viễn).
function parseDuration(raw) {
  if (raw === null || raw === undefined) return null;
  const s = String(raw).trim().toLowerCase();
  if (!s) return null;
  const m = s.match(/^(\d+)(s|m|h|d)$/);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  const ms = m[2] === 's' ? n * 1000 : m[2] === 'm' ? n * 60000 : m[2] === 'h' ? n * 3600000 : n * 86400000;
  if (!Number.isFinite(ms) || ms <= 0 || ms > MAX_MS) return null;
  return ms;
}

function key(e) { return `${e.guildId}:${e.userId}`; }

// Đặt/gia hạn mute có hạn cho 1 user (ghi đè hẹn giờ cũ nếu có).
function scheduleMute(guildId, userId, ms) {
  const until = Date.now() + ms;
  const list = getList();
  const k = `${guildId}:${userId}`;
  const next = list.filter(e => key(e) !== k);
  next.push({ guildId: String(guildId), userId: String(userId), until });
  jsonCache.writeJSON(mutesPath, next);
  return until;
}

// Xoá hẹn giờ của user (mute thủ công / unmute).
function clearMute(guildId, userId) {
  const list = getList();
  const k = `${guildId}:${userId}`;
  const next = list.filter(e => key(e) !== k);
  if (next.length !== list.length) jsonCache.writeJSON(mutesPath, next);
}

// Thời gian còn lại của hẹn giờ mute (ms) hoặc null nếu không có.
function remainingMs(guildId, userId) {
  const k = `${guildId}:${userId}`;
  const e = getList().find(x => key(x) === k);
  if (!e) return null;
  return Math.max(0, e.until - Date.now());
}

// ms → chữ dễ đọc: 90s → "1m30s", 5400s → "1h30m", 2 ngày → "2 ngày 3 giờ".
function fmtDuration(ms) {
  const s = Math.ceil(Math.abs(ms) / 1000);
  if (s >= 86400) {
    const d = Math.floor(s / 86400), h = Math.round((s % 86400) / 3600);
    return h ? `${d} ngày ${h} giờ` : `${d} ngày`;
  }
  if (s >= 3600) {
    const h = Math.floor(s / 3600), m = Math.round((s % 3600) / 60);
    return m ? `${h}h${m}m` : `${h}h`;
  }
  if (s >= 60) {
    const m = Math.floor(s / 60), sec = s % 60;
    return sec ? `${m}m${sec}s` : `${m}m`;
  }
  return `${s}s`;
}

// Gửi log vào kênh log guild nếu cấu hình (và không bị tắt logging).
function logToGuild(client, guildId, text) {
  try {
    const settingsHelper = require('./settingsHelper');
    const s = settingsHelper.getSettings(guildId);
    if (s && s.logging === false) return;
    const id = configHelper.getConfig(guildId, 'logChannelId');
    const ch = id && client.channels.cache.get(id);
    if (ch && ch.isTextBased()) ch.send({ content: text }).catch(() => {});
  } catch { /* log channel là phụ — không văng */ }
}

// Quét danh sách: gỡ role Muted cho entry đã hết hạn.
// Member rời server / role Muted bị xoá → bỏ entry; gỡ lỗi (thiếu quyền) → giữ retry.
async function sweep(client) {
  const list = getList();
  if (!list.length) return;
  const now = Date.now();
  const expired = list.filter(e => Number.isFinite(e.until) && e.until <= now);
  if (!expired.length) return;

  const keep = list.filter(e => Number.isFinite(e.until) && e.until > now);

  for (const e of expired) {
    const guild = client.guilds.cache.get(String(e.guildId));
    if (!guild) continue; // bot rời server → bỏ entry
    const mutedRole = guild.roles.cache.find(r => r.name === 'Muted');
    if (!mutedRole) continue; // role bị xoá tay → coi như đã gỡ
    let member = null;
    try { member = await guild.members.fetch(String(e.userId)); } catch { member = null; }
    if (!member) continue; // member rời server → bỏ entry
    try {
      await member.roles.remove(mutedRole);
      logToGuild(client, guild.id, `⏰ Tự động gỡ cấm chat **${member.user.tag}** (mute hết hạn)`);
      await new Promise(r => setTimeout(r, 250));
    } catch (err) {
      keep.push(e); // thiếu quyền → thử lại lần quét sau
      console.error(`[muteScheduler] gỡ role ${member.user.tag} lỗi: ${err.message}`);
    }
  }

  if (keep.length !== list.length) jsonCache.writeJSON(mutesPath, keep);
}

function start(client) {
  sweep(client).catch(() => {});
  const timer = setInterval(() => {
    sweep(client).catch(e => console.error('[muteScheduler] sweep lỗi:', e.message));
  }, CHECK_MS);
  if (timer.unref) timer.unref();
}

module.exports = { parseDuration, fmtDuration, scheduleMute, clearMute, remainingMs, start };
