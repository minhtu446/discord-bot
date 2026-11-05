// features/music.js — nghe nhạc trong Discord (@discordjs/voice + @distube/ytdl-core).
// • Mỗi server 1 kết nối nhạc riêng — hàng đợi / đếm lặp là RAM theo guildId, không trộn giữa các server.
// • Volume / số lần phát 1 bài / lặp vĩnh viễn cấu hình trên WEB (nhóm 'music' trong cfg guild) —
//   Discord chỉ còn nút ⏸/⏵ · ⏭ · ⏹ + ➕ thêm link (modal). Panel là 1 message/guild, edit tại chỗ.
// • Restart 6h làm mất hàng đợi (RAM) — panel hiện dòng nhắc, thêm mới config web không đổi.
const { joinVoiceChannel, createAudioPlayer, createAudioResource, NoSubscriberBehavior, StreamType, VoiceConnectionStatus, entersState, AudioPlayerStatus } = require('@discordjs/voice');
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle, StringSelectMenuBuilder } = require('discord.js');
const { spawn } = require('node:child_process');
const { pipeline } = require('node:stream/promises');
const jsonCache = require('../jsonCache');
const webConfig = require('../webConfig');

const ffmpegPath = require('ffmpeg-static');
const ytdl = require('@distube/ytdl-core');

const QUEUE_MAX = 50;
const AUTO_LEAVE_MS = 2 * 60 * 1000;
const panelsPath = jsonCache.getPath('musicPanels.json');

// guildId → state (RAM): { queue, pos, repeatLeft, paused, player, connection, res, startedAt, pausedAt, idleTimer, note }
const states = new Map();

function getList() {
  const arr = jsonCache.readJSONArray(panelsPath);
  return Array.isArray(arr) ? arr.slice(0, 200) : [];
}

function savePanels(arr) {
  jsonCache.writeJSON(panelsPath, arr);
}

function getPanelEntry(guildId) {
  return getList().find(p => p.guildId === String(guildId)) || null;
}

function upsertPanel(entry) {
  const arr = getList();
  const i = arr.findIndex(p => p.guildId === entry.guildId);
  if (i >= 0) arr[i] = entry;
  else arr.push(entry);
  savePanels(arr);
}

function removePanel(guildId) {
  const arr = getList();
  const next = arr.filter(p => p.guildId !== String(guildId));
  if (next.length !== arr.length) savePanels(next);
}

// ─── Helpers thuần (test được) ───────────────────────────────────────────────

// Nhặt link YouTube từ nội dung modal (một hoặc nhiều link). v1 chỉ nhận YouTube.
function collectYouTubeLinks(text) {
  const out = [];
  const re = /https?:\/\/(?:www\.|m\.|music\.)?(?:youtube\.com\/watch\?v=|youtu\.be\/)[\w-]{11}[^\s"'<>]*/gi;
  for (const m of String(text || '').match(re) || []) {
    let id = null;
    try { id = ytdl.getVideoID(m); } catch { id = null; }
    if (id && ytdl.validateID(id) && !out.some(x => x.id === id)) {
      out.push({ url: `https://www.youtube.com/watch?v=${id}`, id });
    }
  }
  return out.slice(0, 10);
}

function stateOf(guildId) {
  const gid = String(guildId);
  if (!states.has(gid)) {
    states.set(gid, { queue: [], pos: -1, repeatLeft: 0, paused: false, player: null, connection: null, res: null, startedAt: 0, pausedAt: 0, idleTimer: null, note: '' });
  }
  return states.get(gid);
}

// Pure: quyết định sau khi một bài phát xong (dựa vào repeatLeft + web cfg.repeat/loopInf).
// 'replay' = phát lại chính bài đó (đếm lặp còn dư), 'play' = sang bài khác, 'stop' = hết.
function advanceAfterFinish(state, cfg, fromPos) {
  const total = state.queue.length;
  if (!total) return { act: 'stop' };
  if (state.repeatLeft > 0) return { act: 'replay', pos: fromPos };
  const nextPos = fromPos + 1;
  if (nextPos < total) return { act: 'play', pos: nextPos };
  if (cfg && cfg.loopInf) return { act: 'play', pos: 0 }; // lặp cả hàng vĩnh viễn
  return { act: 'stop' };
}

function fmtTime(s) {
  const n = Math.max(0, Math.floor(Number(s) || 0));
  const h = Math.floor(n / 3600), m = Math.floor((n % 3600) / 60), sec = n % 60;
  return (h ? `${h}:${String(m).padStart(2, '0')}` : `${m}`) + ':' + String(sec).padStart(2, '0');
}

// Thời gian đã phát của bài hiện tại (tạm dừng thì đóng băng tại thời điểm pause).
function elapsedMs(state) {
  if (!state.startedAt) return 0;
  const now = state.paused ? state.pausedAt : Date.now();
  return Math.max(0, now - state.startedAt);
}

// ─── Panel (embed + components) ──────────────────────────────────────────────

function panelPayload(guild, state, cfg) {
  const cur = state.queue[state.pos] || null;
  const vol = Math.round(cfg && Number.isFinite(cfg.volume) ? cfg.volume : 100);
  const repeat = cfg ? Math.max(0, Math.min(10, cfg.repeat | 0)) : 0;
  const loopInf = cfg ? !!cfg.loopInf : false;

  let desc;
  if (cur) {
    const rep = loopInf ? '∞ **vĩnh viễn**' : (repeat > 0 ? `${repeat} lần (còn ${state.repeatLeft})` : 'Tắt');
    desc = `🎵 **Đang phát:** [${cur.title}](${cur.url})\n` +
      `⏱ ${fmtTime(elapsedMs(state) / 1000)} / ${fmtTime(cur.dur)} · 🔊 ${vol}% · 🔂 ${rep}${state.paused ? ' · ⏸ **Tạm dừng**' : ''}\n\n` +
      `📜 **Hàng chờ (${state.queue.length}/${QUEUE_MAX})**${state.note ? '\n' + state.note : ''}\n` +
      state.queue.slice(0, 10).map((it, i) => `${i === state.pos ? '▶️' : (i + 1) + '.'} [${(it.title || it.url).slice(0, 70)}](${it.url})`).join('\n') +
      (state.queue.length > 10 ? `\n… và ${state.queue.length - 10} bài nữa` : '');
  } else {
    desc = `📭 Hàng chờ trống (${state.queue.length}/${QUEUE_MAX}).\n➕ Bấm **Thêm link** (hoặc gõ \`/playmusic\`) để bắt đầu.\n` +
      `🔊 ${vol}% · 🔂 ${loopInf ? '∞ vĩnh viễn' : (repeat > 0 ? `Lặp ${repeat} lần` : 'Tắt')} — chỉnh trên web.${state.note ? '\n' + state.note : ''}`;
  }

  const embed = new EmbedBuilder()
    .setTitle('🎧 Phát nhạc')
    .setColor(0xED4245)
    .setDescription(desc)
    .setFooter({ text: 'Bấm nút để điều khiển · volume/lặp cấu hình trên web' });

  const rows = [];
  rows.push(new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('music_toggle')
      .setLabel(state.paused ? '⏵ Tiếp tục' : '⏸ Tạm dừng')
      .setStyle(state.paused ? ButtonStyle.Success : ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('music_skip').setLabel('⏭ Bỏ qua').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('music_stop').setLabel('⏹ Kết thúc').setStyle(ButtonStyle.Danger),
  ));
  rows.push(new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('music_add').setLabel('➕ Thêm link').setStyle(ButtonStyle.Success),
  ));
  if (state.queue.length > 0) {
    const sel = new StringSelectMenuBuilder()
      .setCustomId('music_queue')
      .setPlaceholder('🎡 Chọn bài để nhảy tới…')
      .addOptions(state.queue.slice(0, 10).map((it, i) => ({
        label: String((it.title || it.url).slice(0, 90)),
        value: String(i),
      })));
    rows.push(new ActionRowBuilder().addComponents(sel));
  }
  return { embeds: [embed], components: rows, content: null }; // content:null = xoá ghi chú ack cũ khi edit lại panel
}

// ─── Voice + engine ──────────────────────────────────────────────────────────

async function joinVoice(client, guildId, voiceChannelId) {
  const guild = client.guilds.cache.get(String(guildId));
  if (!guild || !voiceChannelId) throw new Error('not-joinable');
  const conn = joinVoiceChannel({
    channelId: voiceChannelId,
    guildId: String(guildId),
    adapterCreator: guild.voiceAdapterCreator,
  });
  await entersState(conn, VoiceConnectionStatus.Ready, 15_000);
  return conn;
}

// Kênh voice dự phòng trong guild (kênh voice đầu tiên mà bot có thể vào).
function guessVoiceChannel(guild) {
  if (!guild) return null;
  const me = guild.members.me;
  return guild.channels.cache.filter(c => c.isVoiceBased() && (!me || c.permissionsFor(me).has(['Connect', 'Speak']))).first() || null;
}

function spawnFfmpegInput() {
  // stdin: nhận stream audio từ ytdl; stdout: PCM s16le 48kHz stereo cho @discordjs/voice.
  return spawn(ffmpegPath, ['-analyzeduration', '0', '-loglevel', '0', '-i', 'pipe:0', '-f', 's16le', '-ar', '48000', '-ac', '2']);
}

// Phát bài tại state.pos. Không đụng repeatLeft (người gọi lo việc này — phát lại phải giữ nguyên).
async function playAt(client, guildId, pos, opts = {}) {
  const state = stateOf(guildId);
  const cfg = webConfig.getFeature(String(guildId), 'music') || {};
  if (!state.queue.length) return;
  state.pos = Math.max(0, Math.min(pos, state.queue.length - 1));
  const item = state.queue[state.pos];
  state.paused = false;
  state.note = '';

  // Bảo đảm bot đang ở voice (nếu caller chưa vào).
  if (!state.connection) {
    const g = client.guilds.cache.get(String(guildId));
    const fallback = guessVoiceChannel(g);
    const target = opts.voiceChannelId || cfg.channelId || (fallback ? fallback.id : null);
    if (!target) {
      state.note = '🎧 Không vào được voice — ai đó hãy đứng trong voice rồi gõ `/playmusic`.';
      await refreshPanel(client, guildId);
      return;
    }
    try {
      state.connection = await joinVoice(client, guildId, target);
    } catch (e) {
      state.note = '🎧 Không vào được kênh voice (cần quyền Connect & Speak).';
      await refreshPanel(client, guildId);
      return;
    }
  }

  let info = item.info;
  if (!info) {
    try {
      info = await ytdl.getBasicInfo(item.url);
    } catch (e) {
      item.fail = (item.fail || 0) + 1;
      state.note = `⚠️ [${item.title || item.url}] không đọc được (${String(e.message).slice(0, 60)}) — ${item.fail >= 2 ? 'bỏ bài này.' : 'bấm ⏭ để thử.'}`;
      if (item.fail >= 2) {
        const p = state.queue.indexOf(item);
        if (p >= 0) state.queue.splice(p, 1);
        if (state.pos >= state.queue.length) state.pos = state.queue.length - 1;
      }
      await refreshPanel(client, guildId);
      return;
    }
    item.info = info;
    item.title = (info.videoDetails && info.videoDetails.title) || item.title || item.url;
    item.dur = Number(info.videoDetails && info.videoDetails.lengthSeconds) || 0;
  }

  const player = state.player || createAudioPlayer({ behaviors: { noSubscriber: NoSubscriberBehavior.Pause } });
  state.player = player;
  if (player.listenerCount(AudioPlayerStatus.Idle) === 0) {
    player.on(AudioPlayerStatus.Idle, () => handleIdle(client, String(guildId)).catch(() => {}));
  }
  if (player.listenerCount('error') === 0) {
    player.on('error', () => handleIdle(client, String(guildId)).catch(() => {}));
  }

  // Nguồn âm thanh: ytdl stream → ffmpeg (s16le) → opus (volume xử lý bởi inlineVolume).
  const ff = spawnFfmpegInput();
  pipeline(ytdl.downloadFromInfo(info, { filter: 'audioonly', quality: 'highestaudio', dlChunkSize: 4 << 20 }), ff.stdin).catch(() => {});
  state.res = createAudioResource(ff.stdout, { inputType: StreamType.Raw, inlineVolume: true });
  const v = Number(cfg.volume);
  state.vol = Number.isFinite(v) ? v : 100;
  try {
    if (state.res.volumeTransformer) state.res.volumeTransformer.setVolume(state.vol / 100); // VolumeTransformer: 1.0 = 100%
    player.play(state.res);
  } catch (e) {
    state.note = '⚠️ Không phát được bài này — bấm ⏭ để sang bài khác.';
  }
  state.startedAt = Date.now();
  state.pausedAt = 0;
  await refreshPanel(client, guildId);
}

// ─── Panel edit tại chỗ ──────────────────────────────────────────────────────

async function refreshPanel(client, guildId) {
  const state = stateOf(guildId);
  const cfg = webConfig.getFeature(String(guildId), 'music') || {};
  const guild = client.guilds.cache.get(String(guildId));
  if (!guild) return null;
  const entry = getPanelEntry(guildId);
  if (!entry) return null;
  const channel = client.channels.cache.get(entry.channelId);
  if (!channel || !channel.messages) return null;
  let msg = null;
  try { msg = await channel.messages.fetch(entry.messageId); } catch { return null; }
  await msg.edit(panelPayload(guild, state, cfg)).catch(() => {});
  return msg;
}

// ─── Sự kiện player ──────────────────────────────────────────────────────────

async function handleIdle(client, guildId) {
  const gid = String(guildId);
  const state = stateOf(gid);
  const cfg = webConfig.getFeature(gid, 'music') || {};
  const dec = advanceAfterFinish(state, cfg, state.pos);
  if (dec.act === 'replay') {
    state.repeatLeft--;
    await playAt(client, gid, dec.pos);
    return;
  }
  if (dec.act === 'play') {
    state.repeatLeft = Math.max(0, cfg.repeat | 0);
    await playAt(client, gid, dec.pos);
    return;
  }
  // Hết hàng chờ → hẹn rời voice sau 2 phút; thêm bài/nút sẽ huỷ hẹn.
  state.pos = -1;
  state.note = '🌅 Hết hàng chờ — bot rời voice sau 2 phút nếu không thêm bài nào.';
  await refreshPanel(client, gid);
  clearTimeout(state.idleTimer);
  state.idleTimer = setTimeout(() => forceLeave(client, gid).catch(() => {}), AUTO_LEAVE_MS);
}

// Dừng + rời voice (giữ panel message để lần sau edit tiếp, không xoá entry).
async function forceLeave(client, guildId) {
  const state = stateOf(guildId);
  clearTimeout(state.idleTimer);
  if (state.connection) { try { state.connection.destroy(); } catch {} }
  state.connection = null; state.player = null; state.res = null;
  state.queue = []; state.pos = -1; state.repeatLeft = 0; state.paused = false;
  state.startedAt = 0; state.pausedAt = 0;
  state.note = '👋 Bot đã rời voice. Gõ /playmusic hoặc bấm ➕ để nghe tiếp.';
  await refreshPanel(client, guildId);
}

// ─── Lệnh /playmusic ─────────────────────────────────────────────────────────

async function sendPanel(interaction, client) {
  const gid = String(interaction.guildId);
  const cfg = webConfig.getFeature(gid, 'music') || {};
  if (cfg.enabled === false) {
    return interaction.reply({ content: '❌ Tính năng **nhạc** đang tắt trên web. Vào web → thẻ 🎵 Nhạc để bật.', flags: 64 });
  }
  const voiceChannel = interaction.member && interaction.member.voice && interaction.member.voice.channel;
  if (!voiceChannel && !cfg.channelId) {
    return interaction.reply({ content: '🎧 Bạn phải đang trong 1 kênh voice (hoặc đặt kênh voice mặc định trên web — thẻ 🎵 Nhạc) trước!', flags: 64 });
  }

  // Ack ngay trong 3s (join voice + fetch panel có thể lâu hơn).
  await interaction.deferReply({ flags: 64 }).catch(() => {});

  const state = stateOf(gid);
  // Bot đang ở kênh voice khác → chuyển sang kênh của bạn.
  const nowChannelId = state.connection && state.connection.joinConfig ? state.connection.joinConfig.channelId : null;
  if (voiceChannel && nowChannelId !== String(voiceChannel.id)) {
    if (state.connection) { try { state.connection.destroy(); } catch {} }
    state.connection = null;
    try {
      state.connection = await joinVoice(client, gid, voiceChannel.id);
    } catch (e) {
      return interaction.editReply({ content: '❌ Không vào được kênh voice của bạn (bot cần quyền Connect & Speak).' });
    }
  }

  try {
    await connectionAlive(client, gid, state);
  } catch { /* để flow ngoài tự báo */ }

  // Panel 1 message/guild: có entry → edit tại chỗ; message bị xoá → gửi mới.
  let entry = getPanelEntry(gid);
  let sent = null;
  if (entry) {
    const channel = client.channels.cache.get(entry.channelId);
    if (channel && channel.isTextBased()) {
      try { sent = await channel.messages.fetch(entry.messageId); } catch { sent = null; }
    }
  }
  if (!sent) {
    const payload = panelPayload(interaction.guild, state, cfg);
    sent = await interaction.channel.send(payload);
    upsertPanel({ guildId: gid, channelId: sent.channelId, messageId: sent.id });
  } else {
    await sent.edit(panelPayload(interaction.guild, state, cfg)).catch(() => {});
  }

  clearTimeout(state.idleTimer);
  state.note = '';
  return interaction.editReply({ content: '🎧 Panel nhạc sẵn sàng! Bấm **➕ Thêm link** để bắt đầu hoặc dùng nút điều khiển.' });
}

// Connection có thể đã ngắt (restart piece/robot kicked) — thử dựng lại.
async function connectionAlive(client, gid, state) {
  if (!state.connection) return false;
  try {
    await entersState(state.connection, VoiceConnectionStatus.Ready, 5_000);
    return true;
  } catch {
    try { state.connection.destroy(); } catch {}
    state.connection = null; state.player = null; state.res = null;
    return false;
  }
}

// ─── Bấm nút (route từ buttonHandler) ────────────────────────────────────────

async function handleButton(interaction, client) {
  const gid = String(interaction.guildId);
  const id = interaction.customId;
  const cfg = webConfig.getFeature(gid, 'music') || {};
  const state = stateOf(gid);

  if (id === 'music_add') {
    const modal = new ModalBuilder().setCustomId('music_add_modal').setTitle('➕ Thêm vào hàng chờ');
    modal.addComponents(new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('music_add_links')
        .setLabel('Dán link YouTube (mỗi dòng 1 link)')
        .setStyle(TextInputStyle.Paragraph)
        .setMaxLength(1000)
        .setPlaceholder('https://www.youtube.com/watch?v=...')
        .setRequired(true),
    ));
    return interaction.showModal(modal);
  }

  if (!state.connection && id !== 'music_stop') {
    return interaction.reply({ content: '🎧 Bot chưa vào voice (có thể do bot vừa restart). Gõ `/playmusic` để bắt đầu lại.', flags: 64 });
  }
  if (id === 'music_toggle') {
    if (!state.player) return interaction.reply({ content: '🎧 Chưa có bài nào đang phát.', flags: 64 });
    if (state.paused) { state.player.unpause(); state.paused = false; state.startedAt += Date.now() - state.pausedAt; state.pausedAt = 0; }
    else { state.player.pause(); state.paused = true; state.pausedAt = Date.now(); }
    await interaction.deferUpdate().catch(() => {});
    return refreshPanel(client, gid);
  }
  if (id === 'music_skip') {
    if (!state.queue.length) return interaction.reply({ content: '📭 Hàng chờ trống.', flags: 64 });
    // Đếm lặp reset theo web.repeat cho bài kế.
    state.repeatLeft = Math.max(0, cfg.repeat | 0);
    await interaction.deferUpdate().catch(() => {});
    const next = state.pos + 1;
    if (next < state.queue.length) return playAt(client, gid, next);
    if (cfg.loopInf) return playAt(client, gid, 0);
    state.pos = -1;
    state.note = '🌅 Hết hàng chờ — bot rời voice sau 2 phút nếu không thêm bài nào.';
    await refreshPanel(client, gid);
    clearTimeout(state.idleTimer);
    state.idleTimer = setTimeout(() => forceLeave(client, gid).catch(() => {}), AUTO_LEAVE_MS);
    return;
  }
  if (id === 'music_stop') {
    await interaction.deferUpdate().catch(() => {});
    return forceLeave(client, gid);
  }
}

// ─── Select hàng chờ (nhảy tới bài) ──────────────────────────────────────────

async function handleSelect(interaction, client) {
  const gid = String(interaction.guildId);
  const cfg = webConfig.getFeature(gid, 'music') || {};
  const state = stateOf(gid);
  if (!state.queue.length) return interaction.reply({ content: '📭 Hàng chờ trống.', flags: 64 });
  const idx = parseInt(interaction.values[0], 10);
  if (!Number.isFinite(idx) || idx < 0 || idx >= state.queue.length) return interaction.deferUpdate().catch(() => {});
  state.repeatLeft = Math.max(0, cfg.repeat | 0);
  await interaction.deferUpdate().catch(() => {});
  await playAt(client, gid, idx);
}

// ─── Modal thêm link ─────────────────────────────────────────────────────────

async function handleModal(interaction, client) {
  const gid = String(interaction.guildId);
  const cfg = webConfig.getFeature(gid, 'music') || {};
  const state = stateOf(gid);
  const raw = String(interaction.fields.getTextInputValue('music_add_links') || '');
  const links = collectYouTubeLinks(raw);
  if (!links.length) return interaction.reply({ content: '❌ Không thấy link YouTube hợp lệ nào Bạn dán.', flags: 64 });

  await interaction.deferUpdate().catch(() => {});
  let added = 0, fullNote = '';
  for (const { url, id } of links) {
    if (state.queue.length >= QUEUE_MAX) { fullNote = ` (⚠️ hàng chờ đầy ${QUEUE_MAX} — phần sau bị bỏ)`; break; }
    let title = url, dur = 0, info = null;
    try {
      info = await ytdl.getBasicInfo(url);
      title = info.videoDetails.title;
      dur = Number(info.videoDetails.lengthSeconds) || 0;
    } catch { title = 'Video không rõ tên (' + id + ')'; }
    state.queue.push({ url, id, title, dur, info, fail: 0 });
    added++;
  }

  clearTimeout(state.idleTimer);
  // Bot chưa phát gì / vừa hết hàng → phát luôn bài vừa thêm (vào voice của người nhắn).
  const willStart = !state.player || state.pos < 0;
  if (willStart) {
    const voiceChannel = interaction.member && interaction.member.voice && interaction.member.voice.channel;
    state.repeatLeft = Math.max(0, cfg.repeat | 0);
    try {
      await playAt(client, gid, state.pos + 1, { voiceChannelId: voiceChannel && voiceChannel.id });
    } catch (e) {
      state.note = '⚠️ Không phát ngay được: ' + String(e && e.message ? e.message : e).slice(0, 80);
      await refreshPanel(client, gid);
    }
  } else {
    await refreshPanel(client, gid);
  }
  const line = `✅ Đã thêm **${added}** bài vào hàng chờ${fullNote}!`;
  try {
    if (interaction.deferred) return interaction.editReply({ content: line });
    return interaction.reply({ content: line, flags: 64 });
  } catch { /* người dùng có thể đã đóng tab */ }
}

// ─── init (ClientReady): scan panel; web đổi cấu hình → áp dụng ngay ─────────

async function init(client) {
  // web đổi volume/repeat/loopInf/bật-tắt: volume áp tức thì cho bài đang phát; tắt → rời voice.
  webConfig.onConfigChange(async (client2, gid) => {
    const cfg = webConfig.getFeature(gid, 'music') || {};
    const state = stateOf(gid);
    if (cfg.enabled === false && state.connection) return forceLeave(client2, gid).catch(() => {});
    if (state.res && state.res.volumeTransformer && Number.isFinite(cfg.volume)) {
      state.vol = cfg.volume;
      state.res.volumeTransformer.setVolume(cfg.volume / 100);
      await refreshPanel(client2, gid).catch(() => {});
    }
  });

  // Sau restart: quét panel cũ theo guild, đánh dấu "hàng đợi đã reset".
  for (const [gid] of client.guilds.cache) {
    const entry = getPanelEntry(gid);
    if (!entry) continue;
    const channel = client.channels.cache.get(entry.channelId);
    if (!channel || !channel.messages) continue;
    const msg = await channel.messages.fetch(entry.messageId).catch(() => null);
    if (!msg) { removePanel(gid); continue; }
    const state = stateOf(gid);
    state.note = '🔄 Bot vừa khởi động lại — hàng chờ trong RAM đã reset. Bấm ➕ để thêm lại.';
    state.queue = []; state.pos = -1; state.player = null; state.connection = null;
    await msg.edit(panelPayload(client.guilds.cache.get(gid), state, webConfig.getFeature(gid, 'music'))).catch(() => {});
  }
}

module.exports = {
  sendPanel, handleButton, handleSelect, handleModal, init, refreshPanel,
  panelPayload, collectYouTubeLinks, advanceAfterFinish,
  _stateOf: stateOf, _removePanel: removePanel,
  QUEUE_MAX, AUTO_LEAVE_MS,
};
