// features/music.js — phát DANH SÁCH NHẠC cấu hình trên web (/playmusic).
// • Web (thẻ 🎵 Nhạc) quản playlist per-guild trong nhóm 'music' của cfg: mỗi bài có
//   url/title/thumb + `rep` (lặp lại bài đó 0-99) + `pa` (Dừng ↔ Tiếp tục); playlist có
//   `plays` = số vòng phát (nhập `8*` hoặc `*` = vô hạn).
// • /playmusic: bot nạp playlist (bỏ bài đang Dừng) → phát đúng thứ tự → hết vòng quay lại
//   nếu còn vòng; panel hiện thumbnail + link bài đang phát. Panel 1 message/guild,
//   edit tại chỗ; nút ⏸/⏵ · ⏭ · ⏹ nằm trên Discord (thêm/xoá bài chỉ làm trên web).
// • Restart (~5h40m trên Actions) KHÔNG còn mất nhạc: hàng đợi lưu data/musicState.json
//   (d1-sync tự đẩy/pull qua D1) — bot khởi động lại sẽ TỰ vào voice và phát tiếp từ chỗ dở.
const { joinVoiceChannel, createAudioPlayer, createAudioResource, NoSubscriberBehavior, StreamType, VoiceConnectionStatus, entersState, AudioPlayerStatus } = require('@discordjs/voice');
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle, StringSelectMenuBuilder, StringSelectMenuOptionBuilder } = require('discord.js');
const { spawn } = require('node:child_process');
const { pipeline } = require('node:stream/promises');
const { Transform } = require('node:stream');
const jsonCache = require('../jsonCache');
const webConfig = require('../webConfig');

const ffmpegPath = require('ffmpeg-static');
// @distube/ytdl-core 5.x: API mới là CLASS Ytdl (một phiên YouTube/instance — visitorData + PO token dùng chung).
const { Ytdl } = require('@distube/ytdl-core');
const ytdlClient = new Ytdl();

// ─── Cookie YouTube — QUA BỨC TƯỜNG "Sign in to confirm you're not a bot" ────
// YouTube chặn IP datacenter (GitHub Actions) khi getInfo không có phiên đăng nhập.
// Ưu tiên FILE yt-cookie.txt (Netscape export nhiều dòng — .env không giữ được nhiều dòng);
// không có file thì dùng env YT_COOKIE (Cookie header đơn dòng). Không có cả hai → bỏ qua.
const fs = require('node:fs');
const path = require('node:path');
const COOKIE_FILE = path.join(__dirname, '..', 'yt-cookie.txt');
let _cookieLoaded = false;
function loadYouTubeCookie() {
  if (_cookieLoaded) return;
  _cookieLoaded = true;
  let cookie = '';
  try {
    if (fs.existsSync(COOKIE_FILE)) cookie = fs.readFileSync(COOKIE_FILE, 'utf8');
  } catch {}
  if (!cookie && process.env.YT_COOKIE) cookie = String(process.env.YT_COOKIE);
  cookie = String(cookie || '').trim();
  if (!cookie) return;
  try {
    ytdlClient.setCookie(cookie);
    console.log('[Music] Đã nạp cookie YouTube (' + (cookie.includes('\n') ? 'Netscape, ' + cookie.split('\n').filter(l => l.trim() && !l.startsWith('#')).length + ' dòng' : 'Cookie header') + ').');
  } catch (e) {
    const msg = String((e && e.message) || e);
    console.error('[Music] setCookie lỗi: ' + msg + (msg.includes('SAPISID') ? ' — Cookie phải export từ trình duyệt ĐÃ ĐĂNG NHẬP YouTube (thiếu SAPISID).' : ''));
  }
}
loadYouTubeCookie();

// ─── Đa nguồn: SoundCloud (chính) · YouTube (playlist cũ) · Spotify (mượn đường) · mp3/radio ──
// SoundCloud không cần login/cookie, không bot-wall — search/getInfo/download tự đủ (kể cả bài HLS).
let scdl = null;
try { scdl = require('soundcloud-downloader').default; } catch (e) { console.error('[Music] soundcloud-downloader thiếu:', (e && e.message) || e); }
// Spotify KHÔNG phát trực tiếp được (DRM — mọi bot đều vậy): đọc tên bài + ca sĩ từ link
// rồi tìm bản tương ứng trên SoundCloud để phát.
let spotifyGetTracks = null;
try {
  const sf = require('spotify-url-info');
  if (typeof sf === 'function' && typeof fetch === 'function') spotifyGetTracks = sf(fetch).getTracks;
} catch {}

// Radio trực tuyến: stream mp3 mở — ffmpeg đọc URL trực tiếp, ∞ LIVE.
// LƯU Ý: SomaFM chặn cả IP datacenter (GitHub Actions) LẪN Cloudflare → đã bỏ hẳn.
// Danh sách dưới đã test SỐNG qua worker relay (và thường cả trực tiếp từ IP nhà):
// 5 kênh Radio Paradise + 5 kênh FIP/Mouv (Radio France) + KEXP + NTS 1/2.
const RADIO_STATIONS = [
  { id: 'rp-main', name: '🎛️ Radio Paradise — Main Mix', url: 'https://stream.radioparadise.com/mp3-192' },
  { id: 'rp-mellow', name: '🌙 Radio Paradise — Mellow', url: 'https://stream.radioparadise.com/mellow-192' },
  { id: 'rp-rock', name: '🎸 Radio Paradise — Rock', url: 'https://stream.radioparadise.com/rock-192' },
  { id: 'rp-global', name: '🌍 Radio Paradise — Global', url: 'https://stream.radioparadise.com/global-192' },
  { id: 'rp-beyond', name: '🚀 Radio Paradise — Beyond', url: 'https://stream.radioparadise.com/beyond-192' },
  { id: 'fip', name: '🇫🇷 FIP — eclectic', url: 'https://icecast.radiofrance.fr/fip-midfi.mp3' },
  { id: 'fip-jazz', name: '🎷 FIP Jazz', url: 'https://icecast.radiofrance.fr/fipjazz-midfi.mp3' },
  { id: 'fip-groove', name: '🎧 FIP Groove — soul / funk', url: 'https://icecast.radiofrance.fr/fipgroove-midfi.mp3' },
  { id: 'fip-electro', name: '⚡ FIP Electro', url: 'https://icecast.radiofrance.fr/fipelectro-midfi.mp3' },
  { id: 'mouv', name: '🎤 Mouv — hip-hop / rap', url: 'https://icecast.radiofrance.fr/mouv-midfi.mp3' },
  { id: 'kexp', name: '🎸 KEXP — indie (Seattle)', url: 'https://kexp-mp3-128.streamguys1.com/kexp128.mp3' },
  { id: 'nts1', name: '🎧 NTS 1 — London', url: 'https://stream-relay-geo.ntslive.net/stream' },
  { id: 'nts2', name: '🎧 NTS 2 — London', url: 'https://stream-relay-geo.ntslive.net/stream2' },
];

// Kênh kế tiếp trong danh sách radio (quay vòng) — dùng chung cho nút ⏭ và tự xoay khi stream chết.
function nextRadioStation(url) {
  const idx = RADIO_STATIONS.findIndex(x => String(x.url) === String(url));
  return RADIO_STATIONS[(idx + 1 + RADIO_STATIONS.length) % RADIO_STATIONS.length] || RADIO_STATIONS[0];
}

// Tham số ffmpeg DÙNG CHUNG cho mọi nguồn — BẮT BUỘC có '-' ở cuối (ghi PCM thô ra stdout).
// Thiếu '-' = ffmpeg báo "At least one output file must be specified" → 0 byte → không bao giờ có tiếng.
function ffmpegArgsForInput() {
  return ['-analyzeduration', '0', '-loglevel', 'error', '-i', 'pipe:0', '-vn', '-f', 's16le', '-ar', '48000', '-ac', '2', '-'];
}
function ffmpegArgsForUrl(url, headers) {
  const a = ['-analyzeduration', '0', '-loglevel', 'error'];
  if (headers) a.push('-headers', String(headers));   // input option — phải đứng trước -i
  a.push('-i', String(url), '-vn', '-f', 's16le', '-ar', '48000', '-ac', '2', '-');
  return a;
}

// Radio qua Cloudflare Worker relay: IP GitHub Actions bị SomaFM/Radio Paradise chặn (treo),
// IP Cloudflare thì không. Không có BOT_KEY (chạy máy nhà) → phát trực tiếp như cũ.
function relayRadioInput(stationUrl) {
  const key = webConfig.botKey();
  const base = String(webConfig.WORKER || '').replace(/\/+$/, '');
  if (!key || !base) return { url: String(stationUrl), headers: '', relay: false };
  return {
    url: base + '/radio/relay?u=' + encodeURIComponent(String(stationUrl)),
    headers: 'x-bot-key: ' + key + '\r\n',
    relay: true,
  };
}

// Chặn treo vô hạn khi mạng bị drop/vuốt im lặng (SoundCloud API đôi khi treo thay vì lỗi).
function withTimeout(p, ms, label) {
  const src = Promise.resolve().then(() => p);
  src.catch(() => {});   // race đã bắt lỗi; chặn unhandledRejection nếu promise về muộn
  return Promise.race([
    src,
    new Promise((_, rej) => {
      const t = setTimeout(() => rej(new Error((label || 'timeout') + ' quá ' + ms + 'ms')), ms);
      if (t.unref) t.unref();
    }),
  ]);
}

// Như withTimeout nhưng cho Promise<Readable>: timeout → stream về MUỘN được destroy
// (tránh rò rỉ + 'error' không listener làm chết process).
async function downloadStreamWithTimeout(makeDl, ms, label) {
  let timedOut = false;
  const p = Promise.resolve().then(makeDl);
  p.catch(() => {});
  try {
    return await Promise.race([
      p,
      new Promise((_, rej) => {
        const t = setTimeout(() => { timedOut = true; rej(new Error((label || 'timeout') + ' quá ' + ms + 'ms')); }, ms);
        if (t.unref) t.unref();
      }),
    ]);
  } catch (e) {
    if (timedOut) p.then(d => { try { if (d && typeof d.destroy === 'function') d.destroy(); } catch {} }).catch(() => {});
    throw e;
  }
}

// /play: THAY hàng đợi thay vì xếp cuối? — chưa phát gì, hoặc đang radio ∞ (bài xếp sau sẽ không bao giờ tới lượt).
function shouldReplaceQueue(state) {
  const cur = state.queue[state.pos];
  return state.pos < 0 || !state.queue.length || !!(cur && cur.source === 'radio');
}

const QUEUE_MAX = 50;
const AUTO_LEAVE_MS = 2 * 60 * 1000;
const panelsPath = jsonCache.getPath('musicPanels.json');

// guildId → state (RAM): { queue, pos, repeatLeft, playsLeft, paused, player, connection, res, startedAt, pausedAt, idleTimer, failTimer, note }
const states = new Map();

// ─── Lưu state phát (data/musicState.json — d1-sync tự đẩy qua D1) ───────────
// Mục tiêu: sau restart bot TỰ phát tiếp từ bài đang dở (kênh voice còn người mới tự vào).
const statePath = jsonCache.getPath('musicState.json');
const RESUME_MAX_AGE = 15 * 60 * 1000;
const _stateDirty = new Set();
let _stateFlushTimer = null;

function loadSavedMusicState() {
  try {
    const o = jsonCache.readJSONObject(statePath);
    return (o && typeof o.guilds === 'object' && o.guilds) ? o.guilds : {};
  } catch { return {}; }
}

function markStateDirty(gid) {
  _stateDirty.add(String(gid));
  if (_stateFlushTimer) return;
  _stateFlushTimer = setTimeout(() => { _stateFlushTimer = null; try { flushMusicState(); } catch {} }, 3000);
  if (_stateFlushTimer.unref) _stateFlushTimer.unref();
}

function flushMusicState() {
  const all = loadSavedMusicState();
  for (const gid of _stateDirty) {
    const state = stateOf(gid);
    // Không kết nối / không phát bài nào → xoá (không có gì để phát tiếp sau restart)
    if (!state.connection || state.pos < 0 || !state.queue.length) { delete all[gid]; continue; }
    all[gid] = {
      voiceId: state.voiceId || (state.connection.joinConfig ? state.connection.joinConfig.channelId : '') || '',
      pos: state.pos,
      playsLeft: state.playsLeft === Infinity ? Infinity : state.playsLeft,
      paused: !!state.paused,
      updatedAt: Date.now(),
      queue: state.queue.map(it => ({ url: it.url, id: it.id, title: it.title, thumb: it.thumb, dur: it.dur, rep: it.rep, source: it.source })),
    };
  }
  _stateDirty.clear();
  try { jsonCache.writeJSON(statePath, { guilds: all }); jsonCache.flushSync(statePath); } catch {}
}

// Kill đột ngột (SIGTERM handover) → cố xả state đã đánh dấu trước khi tắt.
process.on('exit', () => { try { if (_stateDirty.size) flushMusicState(); } catch {} });

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

// Nhặt link YouTube (modal ➕ của panel "UI đầy đủ" + test) — tương đương chuẩn hoá worker:
// watch?v= | youtu.be | /shorts/ | /live/ | /embed/ → watch?v=<id 11 ký tự>.
function collectYouTubeLinks(text) {
  const out = [];
  const re = /https?:\/\/(?:www\.|m\.|music\.)?(?:youtube\.com\/(?:watch\?v=|shorts\/|live\/|embed\/)|youtu\.be\/)([\w-]{11})/gi;
  for (const m of String(text || '').matchAll(re)) {
    const id = /^[\w-]{11}$/.test(String(m[1] || '')) ? m[1] : '';
    const url = id ? `https://www.youtube.com/watch?v=${id}` : '';
    if (id && !out.some(x => x.id === id)) out.push({ url, id });
  }
  return out.slice(0, 10);
}

function ytId(url) {
  const hit = String(url || '').match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([\w-]{11})/i);
  return hit ? hit[1] : '';
}

// ─── Nhận diện nguồn link: yt (mặc định cho link cũ) · sc · spotify · mp3 ─────
function detectSource(url) {
  const u = String(url || '').trim();
  if (!u) return '';
  if (/^https?:\/\/(open\.)?spotify\.com\/(track|album|playlist)/i.test(u)) return 'spotify';
  if (/^https?:\/\/(?:www\.|m\.)?soundcloud\.com\/[\w\-./]+/i.test(u) || /^https?:\/\/snd\.sc\/[\w-]+/i.test(u)) return 'sc';
  if (/^https?:\/\/[^\s?#]+\.(mp3|ogg|oga|m4a|wav|opus|flac)([?#]|$)/i.test(u)) return 'mp3';
  if (/youtube\.com|youtu\.be/i.test(u)) return 'yt';
  return '';
}

// id định danh bài trong hàng đợi: YouTube giữ ytId (tương thích playlist cũ), nguồn khác = chính URL.
function songId(url) {
  const y = ytId(url);
  return y || String(url || '').trim();
}

// Nhặt link YouTube + SoundCloud từ text (modal ➕ của panel) — tối đa 10 link.
function collectLinks(text) {
  const out = [];
  const seen = new Set();
  for (const m of String(text || '').matchAll(/https?:\/\/(?:www\.|m\.|music\.)?(?:youtube\.com\/(?:watch\?v=|shorts\/|live\/|embed\/)|youtu\.be\/)([\w-]{11})/gi)) {
    const url = `https://www.youtube.com/watch?v=${m[1]}`;
    if (!seen.has(url)) { seen.add(url); out.push({ url, source: 'yt' }); }
  }
  for (const m of String(text || '').matchAll(/https?:\/\/(?:www\.|m\.)?soundcloud\.com\/[\w\-./]+/gi)) {
    const u = m[0].replace(/[.,;)\]]+$/, '');
    if (!seen.has(u)) { seen.add(u); out.push({ url: u, source: 'sc' }); }
  }
  return out.slice(0, 10);
}

// ─── SoundCloud helpers ───────────────────────────────────────────────────────
// Tìm bài theo tên (kiểu Dyno): lọc kết quả có thời lượng hợp lý 1–20 phút để bỏ "rác".
async function scSearchTrack(query) {
  if (!scdl) throw new Error('soundcloud-downloader chưa cài');
  const r = await scdl.search({ query: String(query || '').slice(0, 150), resourceType: 'tracks' });
  const list = (r && r.collection) || [];
  const good = list.filter(t => t && t.permalink_url && Number(t.duration) >= 60000 && Number(t.duration) <= 1200000);
  return good[0] || list[0] || null;
}

// Link Spotify → tên bài + ca sĩ → tìm bản tương ứng trên SoundCloud.
async function resolveSpotifyToSc(url) {
  if (!spotifyGetTracks) throw new Error('spotify-url-info chưa cài');
  const tracks = await spotifyGetTracks(String(url));
  const t = Array.isArray(tracks) ? tracks[0] : null;
  if (!t || !t.name) throw new Error('Không đọc được bài từ link Spotify');
  const q = [t.artist, t.name].filter(Boolean).join(' ').trim();
  const sc = await scSearchTrack(q);
  if (!sc) throw new Error('Không tìm thấy "' + q + '" trên SoundCloud');
  return { sc, spName: q };
}

function stateOf(guildId) {
  const gid = String(guildId);
  if (!states.has(gid)) {
    states.set(gid, { queue: [], pos: -1, repeatLeft: 0, playsLeft: Infinity, paused: false, player: null, connection: null, res: null, startedAt: 0, pausedAt: 0, idleTimer: null, failTimer: null, ff: null, dl: null, consecFail: 0, lastAdvanceAt: 0, loadingSong: false, pendingPos: null, voiceId: '', note: '' });
  }
  return states.get(gid);
}

// Số vòng phát danh sách: '8*'/'*'/'inf' → Infinity; số → tối thiểu 1 vòng; thiếu → cũ cfg.loopInf, cuối cùng vô hạn.
function parsePlays(cfg) {
  if (!cfg) return Infinity;
  const s = String(cfg.plays == null ? '' : cfg.plays).trim();
  if (Number.isFinite(Number(cfg.plays)) && String(cfg.plays).trim() !== '') return Math.max(1, Number(cfg.plays));
  if (/^\d{1,4}$/.test(s)) return Math.max(1, Number(s));
  if (s === '*' || /^inf$/i.test(s) || /\*$/.test(s)) return Infinity;
  if (cfg.loopInf === true) return Infinity;   // config cũ hữu dụng còn
  return Infinity;                              // mặc định web '*' = phát vĩnh viễn
}

function playsIsInf(cfg) {
  return parsePlays(cfg) === Infinity;
}

// Nạp playlist từ config web: bỏ bài pa (Dừng), chuẩn hoá item (rep/rep clamp ở worker).
function buildQueueFromCfg(state, cfg) {
  const pl = cfg && Array.isArray(cfg.playlist) ? cfg.playlist : [];
  state.queue = pl.filter(x => x && x.url && x.pa !== true).slice(0, QUEUE_MAX).map(x => ({
    url: String(x.url),
    id: songId(String(x.url)),
    source: detectSource(String(x.url)) || 'yt',
    title: String(x.title || '') || String(x.url),
    thumb: (x.thumb && /^https:\/\//.test(x.thumb)) ? String(x.thumb) : '',
    dur: Number(x.dur) || 0,
    rep: Math.max(0, Math.min(99, Number(x.rep) || 0)),
    info: null, fail: 0,
  }));
  state.pos = -1;
  state.repeatLeft = 0;
  state.playsLeft = parsePlays(cfg);
}

// Pure: quyết định sau khi 1 lần phát kết thúc.
// 'replay' = lặp lại bài (còn rep), 'play' = bài kế trong vòng, 'wrap' = hết vòng → vòng mới
// (caller tự đếm playsLeft-- khi finite), 'stop' = hết vòng cuối / không có gì về.
function advanceAfterFinish(state, cfg, fromPos) {
  const total = state.queue.length;
  if (!total) return { act: 'stop' };
  if (state.repeatLeft > 0) return { act: 'replay', pos: fromPos };
  const nextPos = fromPos + 1;
  if (nextPos < total) return { act: 'play', pos: nextPos };
  const inf = playsIsInf(cfg);
  const left = state.playsLeft;
  if (inf) return { act: 'wrap', pos: 0 };
  if (Number.isFinite(left) && left > 1) return { act: 'wrap', pos: 0 };
  return { act: 'stop' };
}

// Danh sách id bị Dừng trên web bây giờ (để nhảy qua bài bị Dừng giữa chừng).
function pausedIdSet(cfg) {
  const pl = cfg && Array.isArray(cfg.playlist) ? cfg.playlist : [];
  return new Set(pl.filter(x => x && x.pa === true).map(x => songId(String(x.url))).filter(Boolean));
}

// ─── Đồng bộ hàng đợi RAM khi web đổi playlist LÚC ĐANG PHÁT ─────────────────
// Thêm bài mới → vào hàng; gỡ bài → khỏi hàng; đổi rep → cập nhật; Dừng → bị bỏ khi chọn kế.
// Bài đang phát còn trong playlist → GIỮ NGUYÊN vị trí phát (không restart, không mất chỗ).
function syncQueueWithCfg(state, cfg) {
  if (!state.queue.length) return;   // chưa phát gì — /playmusic sẽ nạp lại từ cfg
  const cur = state.queue[state.pos] || null;
  if (cur && cur.source === 'radio') return;   // đang radio: playlist web KHÔNG được kéo vào hàng đợi (radio ∞)
  const pl = (Array.isArray(cfg.playlist) ? cfg.playlist : []).filter(x => x && x.url && x.pa !== true).slice(0, QUEUE_MAX);
  const byId = new Map();
  for (const it of state.queue) byId.set(it.id, it);
  const nextQueue = pl.map(x => {
    const id = songId(String(x.url));
    const old = byId.get(id);
    const rep = Math.max(0, Math.min(99, Number(x.rep) || 0));
    return old ? { ...old, url: String(x.url), rep } : {
      url: String(x.url), id, source: detectSource(String(x.url)) || 'yt',
      title: String(x.title || '') || String(x.url),
      thumb: (x.thumb && /^https:\/\//.test(String(x.thumb))) ? String(x.thumb) : '',
      dur: Number(x.dur) || 0, rep, info: null, fail: 0,
    };
  });
  state.queue = nextQueue;
  if (cur) {
    let idx = state.queue.findIndex(it => it.id === cur.id);
    if (idx < 0) { state.queue.push(cur); idx = state.queue.length - 1; }   // bài đang phát bị xoá → phát nốt rồi handleIdle tự sang kế
    state.pos = idx;
    state.repeatLeft = Math.min(state.repeatLeft, state.queue[idx].rep);
  } else {
    state.pos = -1;
  }
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

const MUSIC_COLOR = 0xED4245;   // màu mặc định (đỏ Discord) — trước khi có config màu
// Màu embed theo-guild: từ web thẻ 🎵 (music.color, hex #rrggbb); rác/rỗng → mặc định.
function embedColor(cfg) {
  const s = String((cfg || {}).color || '').trim().toLowerCase();
  const hit = /^#?([0-9a-f]{6})$/.exec(s);
  return hit ? parseInt(hit[1], 16) : MUSIC_COLOR;
}

// Lỗi engine nhạc (hụt tiếng/lỗi stream) — ghi state + console + POST /bot/diag cho web hiển thị ngay.
function setMusicError(gid, stage, msg) {
  const state = stateOf(gid);
  state.lastErr = { t: Date.now(), stage: String(stage || '').slice(0, 40), msg: String(msg || '').slice(0, 300) };
  console.error(`[Music] ${stage} (${gid}): ${msg}`);
  webConfig.postDiag(gid, stage, msg);   // fire-and-forget — postDiag tự nuốt lỗi, không crash nhạc
}

function panelPayload(guild, state, cfg) {
  // ĐỌC MODE TRƯỚC: tick "Panel Discord gọn" (mặc định) → chỉ embed; bỏ tick → đầy nút.
  const compact = !(cfg && cfg.compactUi === false);
  const cur = state.queue[state.pos] || null;
  const vol = Math.round(cfg && Number.isFinite(cfg.volume) ? cfg.volume : 100);
  const inf = playsIsInf(cfg);
  const left = state.playsLeft;
  const playsTxt = inf ? '♾️ vô hạn' : (Number.isFinite(left) ? `còn ${Math.max(1, left)} vòng` : '—');

  let desc;
  if (cur) {
    const isRadio = cur.source === 'radio';
    const repTxt = (cur.rep | 0) > 0 ? `${cur.rep} lần (còn ${state.repeatLeft})` : 'Tắt';
    const timeLine = isRadio
      ? `⏱ 🔴 LIVE · 🔊 ${vol}%${state.paused ? ' · ⏸ **Tạm dừng**' : ''}`
      : `⏱ ${fmtTime(elapsedMs(state) / 1000)} / ${fmtTime(cur.dur)} · 🔊 ${vol}% · 🔂 ${repTxt} · 🔁 ${playsTxt}${state.paused ? ' · ⏸ **Tạm dừng**' : ''}`;
    const head = isRadio
      ? `📡 **Đang phát radio:** ${cur.title}\n`
      : `🎵 **Đang phát:** [${cur.title}](${cur.url})\n` + `🔗 <${cur.url}>\n`;
    desc = head + timeLine + `\n\n` +
      `📜 **Danh sách (${state.queue.length}/${QUEUE_MAX})**${state.note ? '\n' + state.note : ''}\n` +
      state.queue.slice(0, 10).map((it, i) => {
        // radio → text trần (link stream vô nghĩa); bài thường → markdown link
        const bullet = `${i === state.pos ? '▶️' : (i + 1) + '.'}`;
        const t = (it.title || it.url).slice(0, 70);
        return it.source === 'radio' ? `${bullet} ${t}` : `${bullet} [${t}](${it.url})`;
      }).join('\n') +
      (state.queue.length > 10 ? `\n… và ${state.queue.length - 10} bài nữa` : '');
  } else {
    desc = `📭 ${state.queue.length ? 'Tạm nghỉ' : 'Danh sách trống'} (${state.queue.length}/${QUEUE_MAX}).\n` +
      (state.queue.length ? '' : '➕ Thêm bài ' + (compact ? 'trên web: thẻ 🎵 Nhạc → 📃 Danh sách nhac → ＋ Thêm' : 'qua nút ➕ trên panel hoặc trên web') + `. Sau đó gõ \`/playmusic\`.\n`) +
      `🔊 ${vol}% · 🔁 ${playsTxt}${state.note ? '\n' + state.note : ''}`;
  }

  // Panel "UI đầy đủ" (web BỎ tick "Panel Discord gọn"): nút ⏸/⏵ · ⏮ · ⏭ · 🔁 · ➕ + select bài/âm lượng/lặp/số vòng.
  // Tick (mặc định) → chỉ embed thông tin như cũ. Tối đa 5 hàng Discord.
  const embed = new EmbedBuilder()
    .setTitle('🎧 Phát nhạc')
    .setColor(embedColor(cfg))
    .setDescription(desc)
    .setFooter({ text: compact ? 'Danh sách/lặp/volume chỉnh trên web · gõ /playmusic để phát' : '📲 Điều khiển qua panel · cấu hình gốc chỉnh trên web' });
  if (cur && cur.thumb && /^https:\/\//.test(cur.thumb)) {
    embed.setThumbnail(cur.thumb);   // avatar bài đang phát (thumbnail từ web)
  }

  const rows = [];
  if (!compact) {
    rows.push(new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('music_toggle')
        .setLabel(state.paused ? '⏵ Tiếp tục' : '⏸ Tạm dừng')
        .setStyle(state.paused ? ButtonStyle.Success : ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('music_prev').setLabel('⏮ Lùi bài').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('music_skip').setLabel('⏭ Bài sau').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('music_replay').setLabel('🔁 Phát lại').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('music_add').setLabel('➕ Thêm bài').setStyle(ButtonStyle.Success),
    ));
    if (state.queue.length > 0) {
      const opts = state.queue.slice(0, 10).map((it, i) => new StringSelectMenuOptionBuilder()
        .setLabel(`${i + 1}. ${(it.title || it.url).slice(0, 90)}`)
        .setValue(String(i))
        .setDefault(i === state.pos));
      rows.push(new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId('music_queue')
          .setPlaceholder('⏭ Chọn bài để nhảy tới…')
          .addOptions(opts),
      ));
    }
    // Volume: nhập số bằng modal (bấm nút 🔊 → ô nhập 0–100) — select 11 mức cũ bỏ cho gọn.
    rows.push(new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('music_volset')
        .setLabel(`🔊 Âm lượng: ${vol}%`)
        .setStyle(ButtonStyle.Secondary),
    ));
    const curSel = state.queue[state.pos] || null;
    const curRepVal = curSel && (curSel.rep | 0) > 0 ? String(curSel.rep | 0) : 'off';
    rows.push(new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId('music_rep')
        .setPlaceholder(`🔂 Lặp bài này: ${curRepVal === 'off' ? 'Tắt' : curRepVal + ' lần'}`)
        .addOptions([['off', 'Tắt'], ['1', 'Phát thêm 1 lần'], ['2', 'Phát thêm 2 lần'], ['3', 'Phát thêm 3 lần'], ['5', 'Phát thêm 5 lần'], ['10', 'Phát thêm 10 lần']]
          .map(([v, n]) => new StringSelectMenuOptionBuilder().setLabel(n).setValue(v).setDefault(curRepVal === v))),
    ));
    const curPlays = parsePlays(cfg);
    const curPlaysVal = playsIsInf(cfg) ? 'inf' : String(Math.min(10, Math.max(1, curPlays)));
    rows.push(new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId('music_plays')
        .setPlaceholder(`🎈 Số vòng phát danh sách: ${inf ? '♾️ vô hạn' : (Number.isFinite(curPlays) ? curPlays + ' vòng' : '—')}`)
        .addOptions([['1', '1 vòng'], ['2', '2 vòng'], ['3', '3 vòng'], ['5', '5 vòng'], ['10', '10 vòng'], ['inf', '♾️ Vô hạn']]
          .map(([v, n]) => new StringSelectMenuOptionBuilder().setLabel(n).setValue(v).setDefault(curPlaysVal === v))),
    ));
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

// Ngắt stream cũ (ffmpeg + download) — không để 2 luồng cùng chạy tốn CPU/băng thông.
function stopStreams(ff, dl) {
  try { if (dl) dl.destroy(); } catch {}
  try { if (ff) ff.kill('SIGKILL'); } catch {}
}

// Sang bài kế khả dụng (bỏ bài Dừng trên web); hết hàng → vòng mới hoặc kết thúc.
// Chỉ advance khi player đang Idle (bài mới đã lên → event cũ bị bỏ).
async function advanceToNext(client, gid) {
  const state = stateOf(gid);
  if (!state.connection) return;
  if (state.player && state.player.state && state.player.state.status !== AudioPlayerStatus.Idle) return;
  const cfg = webConfig.getFeature(gid, 'music') || {};
  if (!state.queue.length) return endOfQueue(client, gid, cfg);
  const wrap = playsIsInf(cfg) || (Number.isFinite(state.playsLeft) && state.playsLeft > 1);
  const next = nextPlayablePos(state, state.pos + 1, wrap, cfg);
  if (next !== null) {
    if (next <= state.pos && Number.isFinite(state.playsLeft)) state.playsLeft--;
    state.repeatLeft = state.queue[next].rep | 0;
    return playAt(client, gid, next);
  }
  return endOfQueue(client, gid, cfg);
}

// Tự sang bài kế sau delay — BÀI LỖI KHÔNG ĐƯỢC LÀM DANH SÁCH ĐÓNG BĂNG.
// retrySame=true → thử lại chính bài đó (lỗi tạm thời); false → sang bài kế.
function scheduleAdvance(client, guildId, msDelay, retrySame) {
  const gid = String(guildId);
  const state = stateOf(gid);
  clearTimeout(state.failTimer);
  state.failTimer = setTimeout(() => {
    state.failTimer = null;
    const st = stateOf(gid);
    if (retrySame && st.queue[st.pos]) playAt(client, gid, st.pos).catch(() => {});
    else advanceToNext(client, gid).catch(() => {});
  }, msDelay);
  if (state.failTimer.unref) state.failTimer.unref();
}

// Hết giới hạn chuỗi lỗi (5 bài liên tiếp) → dừng + note rõ, tránh lặp vô hạn khi mạng chặn nguồn nhạc.
async function failCapReached(client, gid, reason) {
  const state = stateOf(gid);
  state.consecFail = 0;
  await endOfQueue(client, gid, webConfig.getFeature(gid, 'music') || {});
  state.note = '⚠️ ' + String(reason || '').slice(0, 180) + ' — dừng phát. Gõ /play, /radio hoặc /playmusic để thử lại.';
  await refreshPanel(client, gid);
}

// Bài lỗi khi nạp info (mọi nguồn) — skip IM LẶNG (chi tiết lỗi đã vào console + /bot/diag):
// fail 1 → thử lại chính bài đó sau 4s; fail 2 → bỏ bài, sang bài kế sau 1.5s.
async function failSongInfo(client, guildId, state, item, e) {
  const gid = String(guildId);
  item.fail = (item.fail || 0) + 1;
  state.consecFail = (state.consecFail || 0) + 1;
  if (state.consecFail >= 5) {
    await failCapReached(client, gid, `${state.consecFail} bài lỗi liên tiếp (nguồn nhạc/mạng?)`);
    return;
  }
  if (item.fail >= 2) {
    const p = state.queue.indexOf(item);
    if (p >= 0) state.queue.splice(p, 1);
    if (state.pos > p) state.pos--;   // hàng đợi dồn lên — pos vẫn trỏ đúng bài kế
    await refreshPanel(client, gid);
    clearTimeout(state.failTimer);
    state.failTimer = setTimeout(() => {
      state.failTimer = null;
      const st = stateOf(gid);
      if (st.pos < st.queue.length) playAt(client, gid, st.pos).catch(() => {});   // p trỏ sang bài kế sau splice
      else advanceToNext(client, gid).catch(() => {});
    }, 1500);
    if (state.failTimer.unref) state.failTimer.unref();
    return;
  }
  await refreshPanel(client, gid);
  return scheduleAdvance(client, gid, 4000, true);
}

// stdin: nhận stream audio từ ytdl; stdout: PCM s16le 48kHz stereo cho @discordjs/voice.
// '-vn' bỏ hẳn ảnh; '-loglevel error' chỉ in LỖI — stderr được bắt để chẩn đoán hụt tiếng qua /bot/diag.
function spawnFfmpegInput(gid) {
  const ff = spawn(ffmpegPath, ffmpegArgsForInput());
  let errN = 0;
  if (ff.stderr) ff.stderr.on('data', d => {
    const line = String(d).trim().split('\n')[0];
    if (line && ++errN <= 3) setMusicError(gid, 'ffmpeg', line.slice(0, 160));   // tối đa 3 dòng/quá trình — không spam
  });
  ff.on('error', e => setMusicError(gid, 'ffmpeg-spawn', String((e && e.message) || e)));
  return ff;
}

// ffmpeg đọc TRỰC TIẾP URL (radio stream / file mp3 trên web / Discord CDN) — không cần pipe.
function spawnFfmpegUrl(gid, inputUrl, headers) {
  const ff = spawn(ffmpegPath, ffmpegArgsForUrl(inputUrl, headers));
  let errN = 0;
  if (ff.stderr) ff.stderr.on('data', d => {
    const line = String(d).trim().split('\n')[0];
    if (line && ++errN <= 3) setMusicError(gid, 'ffmpeg', line.slice(0, 160));
  });
  ff.on('error', e => setMusicError(gid, 'ffmpeg-spawn', String((e && e.message) || e)));
  return ff;
}

// Player dùng chung mọi nguồn (tạo 1 lần + gắn listener Idle/error đúng 1 lần).
function ensurePlayer(client, guildId, state) {
  const player = state.player || createAudioPlayer({ behaviors: { noSubscriber: NoSubscriberBehavior.Pause } });
  state.player = player;
  if (player.listenerCount(AudioPlayerStatus.Idle) === 0) {
    player.on(AudioPlayerStatus.Idle, () => handleIdle(client, String(guildId)).catch(() => {}));
  }
  if (player.listenerCount('error') === 0) {
    player.on('error', e => {
      setMusicError(String(guildId), 'player', String((e && (e.message || (e.error && e.error.message))) || 'player error'));
      handleIdle(client, String(guildId)).catch(() => {});
    });
  }
  return player;
}

// SoundCloud: scdl stream → ffmpeg stdin. Đo byte bơm vào trong 4.5s — 'live' mới coi là phát được
// (m3u8stream của scdl tự xử lý cả bài HLS → luôn ra byte mp3, chỉ cần 1 đường pipe duy nhất).
// LƯU Ý: scdl.download() là ASYNC (trả Promise<Readable>) — phải await; gọi .on() trên Promise sẽ nổ
// TypeError làm cả lệnh /play chết im lặng (không diag). Timeout 15s chống treo khi mạng drop.
async function pumpPipeAttempt(gid, makeDl) {
  const ff = spawnFfmpegInput(gid);
  const counter = new Transform({ transform(c, enc, cb) { this.bytes = (this.bytes || 0) + c.length; cb(null, c); } });
  let dl = null;
  try {
    dl = await downloadStreamWithTimeout(makeDl, 15000, 'scdl download');
    if (!dl || typeof dl.on !== 'function') throw new Error('dl không phải stream (API đổi?)');
  } catch (e) {
    setMusicError(gid, 'scdl', String((e && e.message) || e).slice(0, 160));
    try { ff.kill('SIGKILL'); } catch {}
    return { outcome: 'no-source', ff, dl: null, bytes: 0 };
  }
  dl.on('error', e => setMusicError(gid, 'scdl-download', String((e && e.message) || e).slice(0, 160)));
  pipeline(dl, counter, ff.stdin).catch(e => {
    if ((counter.bytes || 0) < 1024) setMusicError(gid, 'pipeline-sc', String((e && e.message) || e).slice(0, 160));
  });
  return new Promise(res => {
    let done = false;
    const finish = outcome => { if (done) return; done = true; clearTimeout(t); clearInterval(iv); res({ outcome, ff, dl, bytes: counter.bytes || 0 }); };
    const t = setTimeout(() => finish((counter.bytes || 0) >= 2048 ? 'live' : 'no-bytes'), 4500);
    const iv = setInterval(() => { if ((counter.bytes || 0) >= 2048) finish('live'); }, 300);
    ff.once('exit', () => finish((counter.bytes || 0) >= 2048 ? 'live' : 'ffmpeg-dead'));
    ff.once('error', () => {});
  });
}

// Radio/mp3: ffmpeg đọc URL trực tiếp (radio có thể qua worker relay + header bot key) — đếm byte stdout 4.5s.
function pumpUrlAttempt(gid, inputUrl, headers) {
  return new Promise(res => {
    const ff = spawnFfmpegUrl(gid, inputUrl, headers);
    let bytes = 0, done = false;
    const onData = c => { bytes += c.length; };
    if (ff.stdout) ff.stdout.on('data', onData);
    const finish = outcome => {
      if (done) return; done = true; clearTimeout(t); clearInterval(iv);
      try { if (ff.stdout) ff.stdout.removeListener('data', onData); } catch {}
      res({ outcome, ff, dl: null, bytes });
    };
    const t = setTimeout(() => finish(bytes >= 2048 ? 'live' : 'no-bytes'), 4500);
    const iv = setInterval(() => { if (bytes >= 2048) finish('live'); }, 300);
    ff.once('exit', () => finish(bytes >= 2048 ? 'live' : 'ffmpeg-dead'));
    ff.once('error', () => {});
  });
}

// Vào voice nếu chưa vào: ưu tiên voice của người dùng → cfg.channelId (web) → kênh voice thường.
async function ensureVoice(client, guildId, state, cfg, preferredVoiceId) {
  if (state.connection) return true;
  const g = client.guilds.cache.get(String(guildId));
  const fallback = guessVoiceChannel(g);
  const target = preferredVoiceId || cfg.channelId || (fallback ? fallback.id : null);
  if (!target) {
    state.note = '🎧 Không vào được voice — ai đó hãy đứng trong voice rồi gõ `/playmusic`.';
    return false;
  }
  try {
    state.connection = await joinVoice(client, guildId, target);
    state.voiceId = String(target);
    return true;
  } catch (e) {
    state.note = '🎧 Không vào được kênh voice (cần quyền Connect & Speak).';
    return false;
  }
}

// Sang bài thứ pos (caller lo playsLeft/repeatLeft khi sang vòng — xem handleIdle).
// Tuần tự hoá: bấm skip nhanh liên tiếp → chỉ request MỚI NHẤT được phát (không 2 luồng song song).
async function playAt(client, guildId, pos) {
  const state = stateOf(String(guildId));
  state.pendingPos = pos;
  if (state.loadingSong) return;
  state.loadingSong = true;
  try {
    while (state.pendingPos != null) {
      const p = state.pendingPos;
      state.pendingPos = null;
      await playAtNow(client, String(guildId), p);
    }
  } finally { state.loadingSong = false; }
}

async function playAtNow(client, guildId, pos) {
  const state = stateOf(guildId);
  const cfg = webConfig.getFeature(String(guildId), 'music') || {};
  if (!state.queue.length) return;
  clearTimeout(state.failTimer);
  state.pos = Math.max(0, Math.min(pos, state.queue.length - 1));
  const item = state.queue[state.pos];
  state.paused = false;
  state.note = '';
  const prevFf = state.ff, prevDl = state.dl;

  let src = item.source || detectSource(item.url) || 'yt';
  if (src === 'spotify') src = 'sc';   // spotify đã được resolve thành bài SoundCloud trước khi vào hàng
  item.source = src;
  const player = ensurePlayer(client, guildId, state);

  // ── Nguồn KHÔNG phải YouTube: SoundCloud (pipe scdl) · radio/mp3 (ffmpeg đọc URL trực tiếp) ──
  if (src !== 'yt') {
    if (src === 'sc' && !item.info && scdl) {
      try {
        const si = await scdl.getInfo(item.url);
        item.info = si;
        if (!item.title) item.title = String(si.title || '') || item.url;
        if (!item.thumb && si.artwork_url) item.thumb = String(si.artwork_url).replace('-large', '-t500x500');
        item.dur = Math.round((Number(si.duration) || Number(si.full_duration) || 0) / 1000);
      } catch (e) {
        setMusicError(guildId, 'sc-getInfo', String((e && e.message) || e).slice(0, 200));
        return failSongInfo(client, guildId, state, item, e);
      }
    }
    // Radio: lần 1 qua worker relay (IP Actions bị nguồn chặn), lần 2 thử trực tiếp (nếu chạy IP nhà).
    const relay = src === 'radio' ? relayRadioInput(item.url) : null;
    let ff = null, dl = null;
    for (let attempt = 1; attempt <= 2 && !ff; attempt++) {
      if (src === 'sc') {
        const r = await pumpPipeAttempt(guildId, () => scdl.download(item.url));
        if (r.outcome === 'live') { ff = r.ff; dl = r.dl; break; }
        setMusicError(guildId, 'sc-stream', `${r.bytes} byte (${r.outcome}) trong 4.5s (lần ${attempt}/2) — ${item.title || item.url}`);
        killAttempt(r);
      } else {
        const input = relay && attempt === 1 ? relay : { url: item.url, headers: '', relay: false };
        const r = await pumpUrlAttempt(guildId, input.url, input.headers || undefined);
        if (r.outcome === 'live') { ff = r.ff; break; }
        setMusicError(guildId, 'url-stream', `${r.bytes} byte (${r.outcome}, ${input.relay ? 'relay' : 'direct'}) trong 4.5s (lần ${attempt}/2) — ${item.title || item.url}`);
        try { r.ff.kill('SIGKILL'); } catch {}
      }
    }
    if (!ff) {
      state.consecFail = (state.consecFail || 0) + 1;
      // Radio: cho thử đủ 1 vòng 9 kênh (kênh chết → XOAY kênh kế), bài thường: 5 lần liên tiếp.
      const cap = item.source === 'radio' ? RADIO_STATIONS.length : 5;
      if (state.consecFail >= cap) {
        await failCapReached(client, guildId, item.source === 'radio'
          ? 'Không phát được kênh radio nào (mạng/IP chặn?)'
          : `Không lấy được âm thanh ${cap} lần liên tiếp (nguồn/mạng?)`);
        return;
      }
      // Radio: kênh chết → tự xoay sang kênh KẾ (không phát lại chính kênh chết như trước).
      if (item.source === 'radio') {
        const nxt = nextRadioStation(item.url);
        state.queue = [{ url: nxt.url, id: String(nxt.url), source: 'radio', title: nxt.name, thumb: '', dur: 0, rep: 0, info: null, fail: 0 }];
        state.pos = 0;
        state.repeatLeft = 0;
        state.playsLeft = Infinity;
        await refreshPanel(client, guildId);
        clearTimeout(state.failTimer);
        state.failTimer = setTimeout(() => {
          state.failTimer = null;
          playAt(client, guildId, 0).catch(() => {});
        }, 4000);
        if (state.failTimer.unref) state.failTimer.unref();
        return;
      }
      // (im lặng — tự sang bài kế; lỗi đã ghi console + /bot/diag)
      await refreshPanel(client, guildId);
      return scheduleAdvance(client, guildId, 4000, false);
    }
    const v = Number(cfg.volume);
    state.vol = Number.isFinite(v) ? v : 100;
    try {
      state.res = createAudioResource(ff.stdout, { inputType: StreamType.Raw, inlineVolume: true });
      if (state.res.volumeTransformer) state.res.volumeTransformer.setVolume(state.vol / 100); // VolumeTransformer: 1.0 = 100%
      state.ff = ff; state.dl = dl;
      player.play(state.res);
    } catch (e) {
      stopStreams(ff, dl);
      state.ff = null; state.dl = null; state.res = null;
      state.consecFail = (state.consecFail || 0) + 1;
      if (state.consecFail >= 5) { await failCapReached(client, guildId, 'Không phát được 5 lần liên tiếp'); return; }
      // (im lặng — tự sang bài kế; lỗi đã ghi console + /bot/diag)
      await refreshPanel(client, guildId);
      return scheduleAdvance(client, guildId, 3000, false);
    }
    // Bài mới đã lên → ngắt luồng của BÀI TRƯỚC.
    stopStreams(prevFf, prevDl);
    state.consecFail = 0;
    state.startedAt = Date.now();
    state.pausedAt = 0;
    markStateDirty(String(guildId));
    await refreshPanel(client, guildId);
    return;
  }

  // ── YouTube (playlist cũ): getInfo + stream ytdl — giữ nguyên luồng cũ ──
  let info = item.info;
  if (!info) {
    try {
      info = await ytdlClient.getInfo(item.url);
    } catch (e) {
      setMusicError(guildId, 'yt-getInfo', String((e && e.message) || e).slice(0, 200));
      return failSongInfo(client, guildId, state, item, e);
    }
    item.info = info;
    if (!item.title) item.title = (info.videoDetails && info.videoDetails.title) || item.url;
    if (!item.thumb) {
      const th = (info.videoDetails && info.videoDetails.thumbnails) || [];
      item.thumb = th.length ? th[th.length - 1].url : '';
    }
    item.dur = Number(info.videoDetails && info.videoDetails.lengthSeconds) || 0;
  }

  // Nguồn âm thanh: ytdl stream → ffmpeg (s16le) → opus (volume xử lý bởi inlineVolume).
  // 5.x: download() nhận luôn info (URL hết hạn tự tra lại); filter CŨ 'audioonly' thay bằng
  // bộ tiêu chí { hasAudio: true, hasVideo: false }; chunkSize (thay dlChunkSize cũ).
  // MUỐN BIẾT AI GÂY HỤT TIẾNG → đo từng chặng: đếm byte bơm vào ffmpeg (counter) + bắt
  // stderr ffmpeg + lỗi pipeline → ghi /bot/diag. Nếu KHÔNG có byte nào trong 4.5s
  // (ffmpeg chết/not nhận dữ liệu) → getInfo LẠI và THỬ 1 LẦN NỮA (URL chết hết hạn).
  const DL_OPTS = { hasAudio: true, hasVideo: false, quality: 'highestaudio', chunkSize: 4 << 20 };
  // pump() dựng 1 lần nạp: dl → counter → ff.stdin. Kết quả 'live' (≥2KB đã chảy) mới hợp lệ;
  // rút là bằng byte=0 khi 4.5s hết hạn → 'no-bytes' (mạng/YouTube) hoặc 'ffmpeg-dead' (ffmpeg chết sớm).
  function pumpAttempt() {
    return new Promise(res => {
      const ff = spawnFfmpegInput(gid);
      const counter = new Transform({ transform(c, enc, cb) { this.bytes = (this.bytes || 0) + c.length; cb(null, c); } });
      const dl = ytdlClient.download(info, DL_OPTS);
      dl.on('error', e => setMusicError(gid, 'ytdl-download', String((e && e.message) || e)));
      pipeline(dl, counter, ff.stdin).catch(e => {
        // lỗi giữa chừng khi bài đang phát là bình thường (skip/đổi bài); lỗi ĐỨT SỚM (dưới 1KB) mới là bệnh.
        if ((counter.bytes || 0) < 1024) setMusicError(gid, 'pipeline', String((e && e.message) || e));
      });
      let done = false;
      const finish = outcome => { if (done) return; done = true; clearTimeout(t); clearInterval(iv); res({ outcome, ff, counter, dl, bytes: counter.bytes || 0 }); };
      const t = setTimeout(() => finish((counter.bytes || 0) >= 2048 ? 'live' : 'no-bytes'), 4500);
      const iv = setInterval(() => { if ((counter.bytes || 0) >= 2048) finish('live'); }, 300);
      ff.once('exit', () => finish((counter.bytes || 0) >= 2048 ? 'live' : 'ffmpeg-dead'));
      ff.once('error', () => {});   // lỗi spawn đã ghi trong spawnFfmpegInput; tránh uncaught khi ff chết ầm ĩ
    });
  }
  function killAttempt(o) { try { if (o && o.dl) o.dl.destroy(); } catch {} try { if (o && o.ff) o.ff.kill('SIGKILL'); } catch {} }

  let live = null;
  for (let attempt = 1; attempt <= 2 && !live; attempt++) {
    if (attempt === 2) {
      // Lần 1 không có byte → URL roomó có thể chết: getInfo LẠI rồi thử lần cuối.
      item.info = null;
      try {
        info = await ytdlClient.getInfo(item.url);
        item.info = info;
      } catch (e) {
        setMusicError(gid, 'getInfo-retry', String((e && e.message) || e));
        break;
      }
    }
    const r = await pumpAttempt();
    if (r.outcome === 'live') {
      live = r;
    } else {
      setMusicError(gid, 'stream-' + r.outcome, `${r.bytes} byte trong 4.5s (lần ${attempt}/2) — ${item.title || item.url}`);
      killAttempt(r);   // dọn tiến trình cũ trước khi thử lại
    }
  }
  if (!live) {
    state.consecFail = (state.consecFail || 0) + 1;
    if (state.consecFail >= 5) {
      await failCapReached(client, guildId, 'Không lấy được âm thanh YouTube 5 bài liên tiếp (mạng/IP chặn?)');
      return;
    }
    // (im lặng — tự sang bài kế; lỗi đã ghi console + /bot/diag)
    await refreshPanel(client, guildId);
    return scheduleAdvance(client, guildId, 4000, false);
  }
  const ff = live.ff;
  const v = Number(cfg.volume);
  state.vol = Number.isFinite(v) ? v : 100;
  try {
    state.res = createAudioResource(ff.stdout, { inputType: StreamType.Raw, inlineVolume: true });
    if (state.res.volumeTransformer) state.res.volumeTransformer.setVolume(state.vol / 100); // VolumeTransformer: 1.0 = 100%
    state.ff = live.ff; state.dl = live.dl;
    player.play(state.res);
  } catch (e) {
    // play() văng (stream đã kết thúc ngay khi tạo resource…) → ngắt luồng mới + tự sang bài kế.
    stopStreams(live.ff, live.dl);
    state.ff = null; state.dl = null; state.res = null;
    state.consecFail = (state.consecFail || 0) + 1;
    if (state.consecFail >= 5) { await failCapReached(client, guildId, 'Không phát được 5 bài liên tiếp'); return; }
    // (im lặng — tự sang bài kế; lỗi đã ghi console + /bot/diag)
    await refreshPanel(client, guildId);
    return scheduleAdvance(client, guildId, 3000, false);
  }
  // Bài mới đã lên → ngắt ffmpeg/dl của BÀI TRƯỚC (bài cũ vẫn chạy luông khi bị thay resource).
  stopStreams(prevFf, prevDl);
  state.consecFail = 0;
  state.startedAt = Date.now();
  state.pausedAt = 0;
  markStateDirty(String(guildId));
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
  // Bài MỚI đã được play() (player không Idle nữa) → event Idle này là cũ, bỏ qua.
  if (state.player && state.player.state && state.player.state.status !== AudioPlayerStatus.Idle) return;
  // 1 lần kết thúc chỉ advance 1 lần: handler 'error' + event 'Idle' có thể cùng bắn.
  if (Date.now() - (state.lastAdvanceAt || 0) < 1200) return;
  state.lastAdvanceAt = Date.now();
  markStateDirty(gid);
  const cfg = webConfig.getFeature(gid, 'music') || {};
  const dec = advanceAfterFinish(state, cfg, state.pos);
  if (dec.act === 'replay') {
    state.repeatLeft--;
    await playAt(client, gid, dec.pos);
    return;
  }
  if (dec.act === 'play') {
    // Bài kế (có thể bị Dừng trên web giữa chừng) → nhảy qua hết chuỗi Dừng.
    const next = nextPlayablePos(state, dec.pos, false, cfg);
    if (next === null) { await endOfQueue(client, gid, cfg); return; }
    state.repeatLeft = state.queue[next].rep | 0;
    await playAt(client, gid, next);
    return;
  }
  if (dec.act === 'wrap') {
    if (Number.isFinite(state.playsLeft)) state.playsLeft--;
    const first = nextPlayablePos(state, 0, true, cfg);
    if (first === null) { await endOfQueue(client, gid, cfg); return; }
    state.repeatLeft = state.queue[first].rep | 0;
    await playAt(client, gid, first);
    return;
  }
  await endOfQueue(client, gid, cfg);
}

// pos khả dụng kế (từ `from` đi tới, cho phép quay vòng khi wrap), bỏ qua bài bị Dừng trên web bây giờ.
function nextPlayablePos(state, from, wrap, cfg) {
  const pausedNow = pausedIdSet(cfg);
  for (let i = Math.max(0, from); i < state.queue.length; i++) {
    if (!pausedNow.has(state.queue[i].id)) return i;
  }
  if (!wrap) return null;
  for (let i = 0; i <= Math.min(from, state.queue.length - 1); i++) {
    if (!pausedNow.has(state.queue[i].id)) return i;
  }
  return null;
}

async function endOfQueue(client, gid, cfg) {
  const state = stateOf(gid);
  state.pos = -1;
  state.note = '🌅 Hết danh sách — bot rời voice sau 2 phút nếu không thêm gì mới.';
  await refreshPanel(client, gid);
  clearTimeout(state.failTimer);
  markStateDirty(gid);
  state.idleTimer = setTimeout(() => forceLeave(client, gid).catch(() => {}), AUTO_LEAVE_MS);
}

// Dừng + rời voice (giữ panel message để lần sau edit tiếp, không xoá entry).
async function forceLeave(client, guildId) {
  const state = stateOf(guildId);
  clearTimeout(state.idleTimer);
  clearTimeout(state.failTimer);
  stopStreams(state.ff, state.dl);
  if (state.connection) { try { state.connection.destroy(); } catch {} }
  state.connection = null; state.player = null; state.res = null;
  state.ff = null; state.dl = null; state.voiceId = '';
  state.queue = []; state.pos = -1; state.repeatLeft = 0; state.playsLeft = Infinity; state.paused = false;
  state.startedAt = 0; state.pausedAt = 0; state.consecFail = 0;
  state.note = '👋 Bot đã rời voice. Gõ /playmusic hoặc thêm bài trên web để nghe tiếp.';
  markStateDirty(String(guildId));
  await refreshPanel(client, guildId);
}

// Đang phát mà danh sách trên web bị dọn trống → bot rời voice ngay (panel note rõ).
async function forceLeaveAfterEmpty(interaction, client, gid) {
  await forceLeave(client, gid);
  return interaction.editReply({ content: '📭 Danh sách nhac trống (hoặc mọi bài đang Dừng trên web) — thêm bài rồi gõ `/playmusic` lại.' });
}

// ─── Lệnh /playmusic ──────────────────────────────────────────────────────────

// Tạo panel MỚI (xoá panel cũ cho kênh sạch) — dùng chung /playmusic · /play · /radio.
async function createPanel(interaction, client, gid, state, cfg) {
  const oldEntry = getPanelEntry(gid);
  if (oldEntry) {
    const oldChannel = client.channels.cache.get(oldEntry.channelId);
    if (oldChannel && oldChannel.isTextBased()) {
      const oldMsg = await oldChannel.messages.fetch(oldEntry.messageId).catch(() => null);
      if (oldMsg && oldMsg.deletable) await oldMsg.delete().catch(() => {});
    }
  }
  const sent = await interaction.channel.send(panelPayload(interaction.guild, state, cfg));
  upsertPanel({ guildId: gid, channelId: sent.channelId, messageId: sent.id });
  return sent;
}

// Bot đang đứng voice khác → chuyển sang kênh của người dùng. false = không vào được.
async function moveToUserVoice(client, gid, state, voiceChannel) {
  if (!voiceChannel) return true;
  const nowChannelId = state.connection && state.connection.joinConfig ? state.connection.joinConfig.channelId : null;
  if (nowChannelId === String(voiceChannel.id)) return true;
  if (state.connection) { try { state.connection.destroy(); } catch {} }
  state.connection = null;
  try {
    state.connection = await joinVoice(client, gid, voiceChannel.id);
    state.voiceId = String(voiceChannel.id);
    return true;
  } catch { return false; }
}

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
  if (voiceChannel && !(await moveToUserVoice(client, gid, state, voiceChannel))) {
    return interaction.editReply({ content: '❌ Không vào được kênh voice của bạn (bot cần quyền Connect & Speak).' });
  }

  // Nạp DANH SÁCH TRÊN WEB (bỏ bài Dừng) rồi phát từ đầu theo cấu hình.
  buildQueueFromCfg(state, cfg);
  clearTimeout(state.idleTimer);
  clearTimeout(state.failTimer);
  state.note = '';

  if (!state.queue.length) {
    // Danh sách trống (hoặc tất cả bài đang Dừng trên web): nếu bot còn đứng voice thì rời luôn.
    if (state.connection) return forceLeaveAfterEmpty(interaction, client, gid);
  } else {
    const ok = await ensureVoice(client, gid, state, cfg, voiceChannel && voiceChannel.id);
    if (!ok) {
      await refreshPanel(client, gid);
      return interaction.editReply({ content: '⚠️ ' + state.note });
    }
  }

  // Panel MỚI mỗi lần /playmusic ở vị trí mới nhất (cuối kênh) — xoá panel cũ cho kênh sạch.
  await createPanel(interaction, client, gid, state, cfg);

  if (!state.queue.length) {
    return interaction.editReply({ content: '📭 Danh sách nhac trống — thêm bài trên web (thẻ 🎵 Nhạc → ＋ Thêm) rồi gõ `/playmusic` lại.' });
  }
  state.repeatLeft = state.queue[0].rep | 0;
  await playAt(client, gid, 0);
  return interaction.editReply({ content: `🎧 Phát danh sách (${state.queue.length} bài${playsIsInf(cfg) ? ', lặp ♾️' : ''})!` });
}

// ─── Lệnh /play — kiểu Dyno: gõ tên bài hoặc link, phát ngay ──────────────────
// Nhận: tên bài (tìm SoundCloud) · link SoundCloud · link YouTube · link Spotify
// (đọc tên → tìm bản SoundCloud) · link .mp3 trực tiếp · file mp3 đính kèm.
async function playQuery(interaction, client) {
  const gid = String(interaction.guildId);
  const cfg = webConfig.getFeature(gid, 'music') || {};
  if (cfg.enabled === false) {
    return interaction.reply({ content: '❌ Tính năng **nhạc** đang tắt trên web. Vào web → thẻ 🎵 Nhạc để bật.', flags: 64 });
  }
  const voiceChannel = interaction.member && interaction.member.voice && interaction.member.voice.channel;
  if (!voiceChannel && !cfg.channelId) {
    return interaction.reply({ content: '🎧 Bạn phải đang trong 1 kênh voice (hoặc đặt kênh voice mặc định trên web) trước!', flags: 64 });
  }
  const query = String((interaction.options && interaction.options.getString('query')) || '').trim();
  const file = interaction.options && interaction.options.getAttachment ? interaction.options.getAttachment('file') : null;
  if (!query && !file) {
    return interaction.reply({ content: '❌ Gõ tên bài (vd: `/play phao em chon lac`), dán link SoundCloud / YouTube / Spotify / mp3, hoặc kèm file mp3.', flags: 64 });
  }
  await interaction.deferReply({ flags: 64 }).catch(() => {});
  const state = stateOf(gid);
  if (!(await moveToUserVoice(client, gid, state, voiceChannel))) {
    return interaction.editReply({ content: '❌ Không vào được kênh voice của bạn (bot cần quyền Connect & Speak).' });
  }
  if (!state.connection) {
    const ok = await ensureVoice(client, gid, state, cfg, voiceChannel && voiceChannel.id);
    if (!ok) return interaction.editReply({ content: '⚠️ ' + state.note });
  }

  // Phân tích nguồn → item hàng đợi.
  let item = null, note = '';
  try {
    if (file && /\.(mp3|m4a|ogg|oga|wav|opus|flac)$/i.test(String(file.name || ''))) {
      item = { url: String(file.url), id: songId(String(file.url)), source: 'mp3', title: String(file.name).slice(0, 200), thumb: '', dur: 0, rep: 0, info: null, fail: 0 };
    } else if (/^https?:\/\//i.test(query)) {
      const src = detectSource(query);
      if (src === 'spotify') {
        const { sc, spName } = await resolveSpotifyToSc(query);
        item = { url: String(sc.permalink_url), id: songId(String(sc.permalink_url)), source: 'sc', title: String(sc.title || ''), thumb: sc.artwork_url ? String(sc.artwork_url).replace('-large', '-t500x500') : '', dur: Math.round((Number(sc.duration) || 0) / 1000), rep: 0, info: null, fail: 0 };
        note = '🔄 Spotify không phát trực tiếp được (DRM) — đã tìm bản tương ứng trên SoundCloud: ' + spName;
      } else if (src === 'sc') {
        item = { url: query, id: songId(query), source: 'sc', title: '', thumb: '', dur: 0, rep: 0, info: null, fail: 0 };
      } else if (src === 'mp3') {
        item = { url: query, id: songId(query), source: 'mp3', title: decodeURIComponent(String(query).split('?')[0].split('/').pop() || '') || query, thumb: '', dur: 0, rep: 0, info: null, fail: 0 };
      } else {
        item = { url: query, id: songId(query), source: 'yt', title: '', thumb: '', dur: 0, rep: 0, info: null, fail: 0 };
      }
    } else {
      const sc = await scSearchTrack(query);
      if (!sc) {
        return interaction.editReply({ content: '🔎 Không tìm thấy bài "' + query.slice(0, 80) + '" trên SoundCloud — thử link hoặc gõ đủ tên bài + ca sĩ hơn.' });
      }
      item = { url: String(sc.permalink_url), id: songId(String(sc.permalink_url)), source: 'sc', title: String(sc.title || ''), thumb: sc.artwork_url ? String(sc.artwork_url).replace('-large', '-t500x500') : '', dur: Math.round((Number(sc.duration) || 0) / 1000), rep: 0, info: null, fail: 0 };
    }
  } catch (e) {
    const msg = String((e && e.message) || e).slice(0, 200);
    setMusicError(gid, 'play-resolve', msg);   // lỗi tìm bài/Spotify cũng lên /bot/diag để chẩn đoán từ xa
    return interaction.editReply({ content: '❌ Không nạp được bài: ' + msg.slice(0, 160) });
  }
  if (!item) return interaction.editReply({ content: '❌ Không hiểu yêu cầu — gõ tên bài hoặc dán link.' });

  clearTimeout(state.idleTimer);
  clearTimeout(state.failTimer);
  state.note = note;

  if (shouldReplaceQueue(state)) {
    // Chưa phát gì (hoặc đang RADIO ∞ — bài xếp sau sẽ không bao giờ tới lượt) → phát NGAY bài này.
    state.queue = [item];
    state.pos = 0;
    state.repeatLeft = item.rep | 0;
    state.playsLeft = 1;
    state.consecFail = 0;
    await createPanel(interaction, client, gid, state, cfg);
    try { await playAt(client, gid, 0); } catch (e) {
      setMusicError(gid, 'play-start', String((e && e.message) || e).slice(0, 200));
      return interaction.editReply({ content: '❌ Lỗi phát: ' + String((e && e.message) || e).slice(0, 140) });
    }
    return interaction.editReply({ content: '🎧 Đang phát: ' + (item.title || item.url).slice(0, 120) });
  }
  // Đang phát → xếp hàng cuối (kiểu Dyno).
  if (state.queue.length >= QUEUE_MAX) {
    return interaction.editReply({ content: '📭 Hàng đợi đã đủ ' + QUEUE_MAX + ' bài.' });
  }
  state.queue.push(item);
  await refreshPanel(client, gid);
  return interaction.editReply({ content: '➕ Đã xếp hàng (vị trí ' + state.queue.length + '): ' + (item.title || item.url).slice(0, 120) });
}

// ─── Lệnh /radio — radio trực tuyến (∞ LIVE, stream mp3 mở) ───────────────────
async function startRadio(interaction, client) {
  const gid = String(interaction.guildId);
  const cfg = webConfig.getFeature(gid, 'music') || {};
  if (cfg.enabled === false) {
    return interaction.reply({ content: '❌ Tính năng **nhạc** đang tắt trên web. Vào web → thẻ 🎵 Nhạc để bật.', flags: 64 });
  }
  const voiceChannel = interaction.member && interaction.member.voice && interaction.member.voice.channel;
  if (!voiceChannel && !cfg.channelId) {
    return interaction.reply({ content: '🎧 Bạn phải đang trong 1 kênh voice (hoặc đặt kênh voice mặc định trên web) trước!', flags: 64 });
  }
  const row = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId('music_radio_pick')
      .setPlaceholder('📡 Chọn kênh radio…')
      .addOptions(RADIO_STATIONS.map(s => new StringSelectMenuOptionBuilder().setLabel(s.name).setValue(s.id))),
  );
  return interaction.reply({ content: '📡 Chọn kênh radio (phát ∞ LIVE · ⏭ đổi kênh):', components: [row], flags: 64 });
}

// Chọn kênh radio (select menu) → vào voice + phát ngay + panel mới.
async function handleRadioPick(interaction, client) {
  const gid = String(interaction.guildId);
  const val = (interaction.values && interaction.values[0]) || '';
  const st = RADIO_STATIONS.find(x => x.id === val);
  if (!st) return interaction.deferUpdate().catch(() => {});
  await interaction.update({ content: '📡 Đang phát radio: ' + st.name, components: [] }).catch(() => {});
  const cfg = webConfig.getFeature(gid, 'music') || {};
  const voiceChannel = interaction.member && interaction.member.voice && interaction.member.voice.channel;
  const state = stateOf(gid);
  if (voiceChannel && !(await moveToUserVoice(client, gid, state, voiceChannel))) {
    return interaction.followUp({ content: '❌ Không vào được kênh voice của bạn (bot cần quyền Connect & Speak).', flags: 64 });
  }
  if (!state.connection) {
    const ok = await ensureVoice(client, gid, state, cfg, voiceChannel && voiceChannel.id);
    if (!ok) return interaction.followUp({ content: '⚠️ ' + state.note, flags: 64 });
  }
  clearTimeout(state.idleTimer);
  clearTimeout(state.failTimer);
  state.queue = [{ url: st.url, id: String(st.url), source: 'radio', title: st.name, thumb: '', dur: 0, rep: 0, info: null, fail: 0 }];
  state.pos = 0;
  state.repeatLeft = 0;
  state.playsLeft = Infinity;   // stream chết → tự nối lại cùng kênh
  state.note = '';
  await createPanel(interaction, client, gid, state, cfg);
  await playAt(client, gid, 0);
}

// ─── Bấm nút (route từ buttonHandler) ────────────────────────────────────────

async function handleButton(interaction, client) {
  const gid = String(interaction.guildId);
  const id = interaction.customId;
  const cfg = webConfig.getFeature(gid, 'music') || {};
  const state = stateOf(gid);

  if (!state.connection && !['music_stop', 'music_add', 'music_volset'].includes(id)) {
    return interaction.reply({ content: '🎧 Bot chưa vào voice (có thể do bot vừa restart). Gõ `/playmusic` để bắt đầu lại.', flags: 64 });
  }
  if (id === 'music_add') {
    const modal = new ModalBuilder()
      .setCustomId('music_add_modal')
      .setTitle('➕ Thêm bài vào danh sách');
    modal.addComponents(new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('m_links')
        .setLabel('Link YouTube hoặc SoundCloud (1 link / dòng)')
        .setStyle(TextInputStyle.Paragraph)
        .setMaxLength(500)
        .setRequired(true)
    ));
    return interaction.showModal(modal).catch(() => {});
  }
  if (id === 'music_volset') {
    // Volume chỉnh bằng ô nhập số (modal) — điền luôn giá trị hiện tại cho nhanh.
    const modal = new ModalBuilder()
      .setCustomId('music_vol_modal')
      .setTitle('🔊 Âm lượng panel');
    modal.addComponents(new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('m_v')
        .setLabel('Nhập số 0–100 (hiện tại: ' + (state.vol != null ? state.vol : Math.round(Number(cfg.volume) || 100)) + ')')
        .setStyle(TextInputStyle.Short)
        .setMaxLength(3)
        .setRequired(true)
    ));
    return interaction.showModal(modal).catch(() => {});
  }
  if (id === 'music_toggle') {
    if (!state.player) return interaction.reply({ content: '🎧 Chưa có bài nào đang phát.', flags: 64 });
    if (state.paused) { state.player.unpause(); state.paused = false; state.startedAt += Date.now() - state.pausedAt; state.pausedAt = 0; }
    else { state.player.pause(); state.paused = true; state.pausedAt = Date.now(); }
    markStateDirty(gid);
    await interaction.deferUpdate().catch(() => {});
    return refreshPanel(client, gid);
  }
  if (id === 'music_skip') {
    if (!state.queue.length) return interaction.reply({ content: '📭 Danh sách trống.', flags: 64 });
    await interaction.deferUpdate().catch(() => {});
    // Radio: ⏭ = đổi sang kênh KẾ (quay vòng danh sách kênh).
    const curRadio = state.queue[state.pos];
    if (curRadio && curRadio.source === 'radio') {
      const nxt = nextRadioStation(curRadio.url);
      state.queue = [{ url: nxt.url, id: String(nxt.url), source: 'radio', title: nxt.name, thumb: '', dur: 0, rep: 0, info: null, fail: 0 }];
      state.pos = 0;
      state.repeatLeft = 0;
      clearTimeout(state.failTimer);
      return playAt(client, gid, 0);
    }
    // Sang bài kế khả dụng (bỏ bài Dừng trên web); hết hàng → sang vòng mới hoặc kết thúc.
    const next = nextPlayablePos(state, state.pos + 1, playsIsInf(cfg) || (Number.isFinite(state.playsLeft) && state.playsLeft > 1), cfg);
    if (next !== null) {
      if (next <= state.pos) { if (Number.isFinite(state.playsLeft)) state.playsLeft--; }
      state.repeatLeft = state.queue[next].rep | 0;
      return playAt(client, gid, next);
    }
    return endOfQueue(client, gid, cfg);
  }
  if (id === 'music_prev') {
    if (!state.queue.length) return interaction.reply({ content: '📭 Danh sách trống.', flags: 64 });
    await interaction.deferUpdate().catch(() => {});
    // Lùi về bài trước khả dụng; lawner quay vòng nếu wrap (đếm playsLeft như sang vòng mới).
    const prev = prevPlayablePos(state, state.pos === -1 ? 0 : state.pos, cfg);
    if (prev === null) return refreshPanel(client, gid);
    if (prev > state.pos) { if (Number.isFinite(state.playsLeft) && state.playsLeft > 1) state.playsLeft--; }
    state.repeatLeft = state.queue[prev].rep | 0;
    return playAt(client, gid, prev);
  }
  if (id === 'music_replay') {
    if (!state.player || state.pos < 0 || !state.queue[state.pos]) return interaction.reply({ content: '🎧 Chưa có bài nào đang phát.', flags: 64 });
    await interaction.deferUpdate().catch(() => {});
    return playAt(client, gid, state.pos);
  }
  if (id === 'music_stop') {
    await interaction.deferUpdate().catch(() => {});
    return forceLeave(client, gid);
  }
}

// ─── Select menu trên panel (UI đầy đủ): nhảy bài · volume · lặp bài · số vòng ──

async function handleSelect(interaction, client) {
  const gid = String(interaction.guildId);
  const id = String(interaction.customId || '');
  const cfg = { ...(webConfig.getFeature(gid, 'music') || {}) };
  const state = stateOf(gid);
  const val = (interaction.values && interaction.values[0] != null) ? String(interaction.values[0]) : '';

  if (id === 'music_radio_pick') {
    return handleRadioPick(interaction, client);
  }

  if (id === 'music_queue') {
    if (!state.queue.length) return interaction.reply({ content: '📭 Danh sách trống.', flags: 64 });
    const idx = parseInt(val, 10);
    if (!Number.isFinite(idx) || idx < 0 || idx >= state.queue.length) return interaction.deferUpdate().catch(() => {});
    const pausedNow = pausedIdSet(cfg);
    if (pausedNow.has(state.queue[idx].id)) {
      return interaction.reply({ content: '⏸ Bài này đang ở trạng thái **Dừng** trên web — bấm Tiếp tục trên web để phát.', flags: 64 });
    }
    await interaction.deferUpdate().catch(() => {});
    state.repeatLeft = state.queue[idx].rep | 0;
    await playAt(client, gid, idx);
    return;
  }

  if (id === 'music_rep') {
    const cur = state.queue[state.pos];
    if (!cur) return interaction.reply({ content: '🎧 Chưa có bài nào đang phát.', flags: 64 });
    const n = val === 'off' ? 0 : Math.round(Number(val));
    if (!Number.isFinite(n) || n < 0 || n > 99) return interaction.deferUpdate().catch(() => {});
    await interaction.deferUpdate().catch(() => {});
    cur.rep = n;
    state.repeatLeft = n;
    // Đồng bộ item tương ứng trong config web (queue item là bản CLONE từ cfg).
    if (Array.isArray(cfg.playlist)) {
      const idx = cfg.playlist.findIndex(x => x && songId(String(x.url)) === cur.id);
      if (idx >= 0) cfg.playlist[idx] = { ...cfg.playlist[idx], rep: n };
    }
    webConfig.pushMusicCfg(gid, cfg).catch(() => {});
    await refreshPanel(client, gid);
    return;
  }

  if (id === 'music_plays') {
    await interaction.deferUpdate().catch(() => {});
    if (val === 'inf') { cfg.plays = '*'; state.playsLeft = Infinity; }
    else {
      const n = Math.round(Number(val));
      if (!Number.isFinite(n) || n < 1 || n > 1000) return refreshPanel(client, gid);
      cfg.plays = String(n);
      state.playsLeft = n;
    }
    webConfig.pushMusicCfg(gid, cfg).catch(() => {});
    await refreshPanel(client, gid);
    return;
  }

  return interaction.deferUpdate().catch(() => {});
}

// ─── Bài trước khả dụng (⏮): đi lùi vòng tròn, bỏ bài bị Dừng trên web ────────
// (từ `from` đi lùi, cho phép quay vòng — trả i luôn "trước" vị trí phát hiện tại)
function prevPlayablePos(state, from, cfg) {
  const n = state.queue.length;
  if (!n) return null;
  const pausedNow = pausedIdSet(cfg);
  let i = ((from - 1) % n + n) % n;
  for (let step = 0; step < n; step++) {
    if (!pausedNow.has(state.queue[i].id)) return i;
    i = (i - 1 + n) % n;
  }
  return null;
}

// ─── Modal ➕ Thêm bài (panel UI đầy đủ) — route từ buttonHandler.handleModal ──

async function handleModal(interaction, client) {
  const gid = String(interaction.guildId);
  const mid = String(interaction.customId || '');

  // Modal volume (bấm nút 🔊 trên panel): nhập số 0–100 → áp + ghi ngược web.
  if (mid === 'music_vol_modal') {
    const raw = interaction.fields && typeof interaction.fields.getTextInputValue === 'function' ? interaction.fields.getTextInputValue('m_v') : '';
    const v = Math.round(Number(String(raw || '').trim()));
    if (!Number.isFinite(v) || v < 0 || v > 100) {
      return interaction.reply({ content: '❌ Âm lượng phải là số từ 0 đến 100 (đã nhận: ' + (String(raw || '').trim().slice(0, 20) || 'trống') + ').', flags: 64 });
    }
    const cfg = { ...(webConfig.getFeature(gid, 'music') || {}) };
    cfg.volume = v;
    const state = stateOf(gid);
    state.vol = v;
    if (state.res && state.res.volumeTransformer) { try { state.res.volumeTransformer.setVolume(v / 100); } catch {} }
    webConfig.pushMusicCfg(gid, cfg).catch(() => {});   // ghi ngược web — fire-and-forget
    await refreshPanel(client, gid).catch(() => {});
    return interaction.reply({ content: '🔊 Đã đặt âm lượng **' + v + '%** (ghi ngược về web).', flags: 64 });
  }

  if (mid !== 'music_add_modal') return;
  const cfg = { ...(webConfig.getFeature(gid, 'music') || {}) };
  if (cfg.enabled === false) {
    return interaction.reply({ content: '❌ Tính năng **nhạc** đang tắt trên web. Vào web → thẻ 🎵 Nhạc để bật.', flags: 64 });
  }
  await interaction.deferReply({ flags: 64 }).catch(() => {});
  const raw = interaction.fields && typeof interaction.fields.getTextInputValue === 'function' ? interaction.fields.getTextInputValue('m_links') : '';
  const links = collectLinks(raw);
  if (!links.length) {
    return interaction.editReply({ content: '❌ Không có link hợp lệ nào (nhận YouTube: watch?v=…, youtu.be/…, /shorts/… · SoundCloud: soundcloud.com/…).' });
  }
  const pl = Array.isArray(cfg.playlist) ? cfg.playlist.slice() : [];
  let added = 0, skipped = 0, failed = 0;
  for (const L of links) {
    if (pl.length >= QUEUE_MAX) break;   // cap 50 (khác với giới hạn đưa vào modal là 10 link)
    if (pl.some(x => x && x.url === L.url)) { skipped++; continue; }
    let title = L.url, thumb = '', dur = 0;
    try {
      if (L.source === 'sc') {
        if (!scdl) { failed++; continue; }
        const si = await scdl.getInfo(L.url);            // bot tự tra tên + thumb qua SoundCloud API
        title = String(si.title || '') || title;
        thumb = si.artwork_url ? String(si.artwork_url).replace('-large', '-t500x500') : '';
        dur = Math.round((Number(si.duration) || Number(si.full_duration) || 0) / 1000);
      } else {
        const inf = await ytdlClient.getInfo(L.url);          // bot tự tra tên + thumb, khỏi qua /yt/info
        title = (inf.videoDetails && inf.videoDetails.title) || title;
        const th = (inf.videoDetails && inf.videoDetails.thumbnails) || [];
        const t = th.length ? String(th[th.length - 1].url) : '';
        thumb = /^https:\/\/(?:i\.ytimg\.com|img\.youtube\.com)\/[\w\-./?=&%]+$/.test(t) ? t : '';
        dur = Number(inf.videoDetails && inf.videoDetails.lengthSeconds) || 0;
      }
    } catch (e) { failed++; continue; }
    pl.push({ url: L.url, title: String(title).slice(0, 200), thumb, dur, rep: 0, pa: false });
    added++;
  }
  if (!added && !skipped) {
    return interaction.editReply({ content: `❌ Không nạp được bài mới (${failed}/${links.length} link lỗi — riêng tư/đã xoá?).` });
  }
  cfg.playlist = pl;
  const save = await webConfig.pushMusicCfg(gid, cfg);
  if (!save.ok) {
    return interaction.editReply({ content: `⚠️ Đã thêm ${added} bài vào hàng chờ phiên này nhưng KHÔNG ghi ngược web được (${save.error || 'lỗi'}) — thử lại sau.` });
  }
  // Bơm bài mới vào hàng đợi RAM (giữ nguyên pos/repeatLeft bài đang phát).
  const state = stateOf(gid);
  if (state.queue.length) {
    for (const it of cfg.playlist) {
      const nid = songId(String(it.url));
      if (it.pa !== true && !state.queue.some(x => x.id === nid) && state.queue.length < QUEUE_MAX) {
        state.queue.push({
          url: String(it.url), id: nid, source: detectSource(String(it.url)) || 'yt',
          title: String(it.title || '') || String(it.url),
          thumb: String(it.thumb || ''), dur: Number(it.dur) || 0,
          rep: Math.max(0, Math.min(99, Number(it.rep) || 0)), info: null, fail: 0
        });
      }
    }
  }
  await refreshPanel(client, gid);
  return interaction.editReply({ content: `➕ Đã thêm ${added} bài${skipped ? ` (bỏ qua ${skipped} trùng)` : ''}${failed ? ` — ${failed} link lỗi` : ''} vào danh sách.` });
}

// ─── init (ClientReady): quét panel; web đổi cấu hình → áp dụng ngay ─────────

async function init(client) {
  // web đổi cấu hình nhạc: volume áp tức thì; bài đang phát bị Dừng → sang bài kế; tắt → rời voice.
  webConfig.onConfigChange(async (client2, gid) => {
    const cfg = webConfig.getFeature(gid, 'music') || {};
    const state = stateOf(gid);
    if (cfg.enabled === false && state.connection) return forceLeave(client2, gid).catch(() => {});
    if (state.res && state.res.volumeTransformer && Number.isFinite(cfg.volume)) {
      state.vol = cfg.volume;
      state.res.volumeTransformer.setVolume(cfg.volume / 100);
    }
    // Đồng bộ hàng đợi RAM với playlist trên web (thêm/gỡ/đổi rep) — KHÔNG restart bài đang phát.
    syncQueueWithCfg(state, cfg);
    // Bài đang phát vừa bị Dừng trên web → input dừng bài, handleIdle tự quyết bài kế / vòng mới.
    const cur = state.queue[state.pos];
    if (cur && pausedIdSet(cfg).has(cur.id)) {
      state.repeatLeft = 0;
      if (state.player) { try { state.player.stop(); } catch {} }
    }
    markStateDirty(gid);
    await refreshPanel(client2, gid).catch(() => {});
  });

  // Sau restart: quét panel cũ theo guild, đánh dấu "hàng đợi đã reset".
  // Dọn luôn entry rác (guild không còn bot, entry test cũ như p1/c1/m1).
  const entriesNow = getList();
  const validEntries = entriesNow.filter(p => p && p.guildId && client.guilds.cache.has(p.guildId));
  if (validEntries.length !== entriesNow.length) savePanels(validEntries);
  for (const [gid] of client.guilds.cache) {
    const entry = getPanelEntry(gid);
    if (!entry) continue;
    const channel = client.channels.cache.get(entry.channelId);
    if (!channel || !channel.messages) continue;
    const msg = await channel.messages.fetch(entry.messageId).catch(() => null);
    if (!msg) { removePanel(gid); continue; }
    const state = stateOf(gid);
    state.note = '🔄 Bot vừa khởi động lại — hàng đợi trong RAM đã reset. Tự phát tiếp nếu trước đó đang nghe; nếu không, gõ `/playmusic`.';
    state.queue = []; state.pos = -1; state.player = null; state.connection = null;
    await msg.edit(panelPayload(client.guilds.cache.get(gid), state, webConfig.getFeature(gid, 'music'))).catch(() => {});
  }

  // Tự phát tiếp sau restart: đọc state đã lưu (<15 phút), vào lại voice nếu kênh CÒN NGƯỜI.
  // CHỜ ~6s: VoiceState của người trong voice chưa kịp cache ngay lúc ClientReady —
  // kiểm tra sớm sẽ tưởng "kênh trống" và bỏ tự phát tiếp oan.
  setTimeout(() => { resumeAfterRestart(client).catch(() => {}); }, 6000);

  // Probe chẩn đoán mạng ~18s sau boot (sau resume): radio + SoundCloud lấy được TIẾNG từ runner?
  // Kết quả ghi /bot/diag (stage probe-radio / probe-sc) — biết ngay IP Actions có bị chặn nguồn nào.
  setTimeout(() => { runBootProbe(client).catch(() => {}); }, 18000);
}

// ─── Tự phát tiếp sau restart (~5h40m Actions handover) ──────────────────────
// State được lưu data/musicState.json qua d1-sync; quá 15 phút coi như bỏ (ai nghe tự gõ lại).
async function resumeAfterRestart(client) {
  const saved = loadSavedMusicState();
  const now = Date.now();
  const gids = Object.keys(saved);
  if (!gids.length) return;
  for (const gid of gids) {
    const ms = saved[gid];
    try {
      const guild = client.guilds.cache.get(gid);
      if (!guild || !ms || now - (Number(ms.updatedAt) || 0) > RESUME_MAX_AGE) { delete saved[gid]; continue; }
      const cfg = webConfig.getFeature(gid, 'music') || {};
      if (cfg.enabled === false) { delete saved[gid]; continue; }
      const voiceCh = ms.voiceId ? guild.channels.cache.get(String(ms.voiceId)) : null;
      if (!voiceCh || !voiceCh.isVoiceBased()) { delete saved[gid]; continue; }
      // Chỉ tự vào khi kênh voice CÒN NGƯỜI THẬT — không bắt bot độc thoại một mình.
      const humans = voiceCh.members ? [...voiceCh.members.values()].filter(m => !m.user.bot).length : 0;
      if (humans === 0) {
        const state = stateOf(gid);
        state.note = '🌙 Kênh voice đã trống sau khi bot restart — gõ /playmusic khi muốn nghe tiếp.';
        await refreshPanel(client, gid).catch(() => {});
        delete saved[gid];
        continue;
      }
      const state = stateOf(gid);
      state.queue = (Array.isArray(ms.queue) ? ms.queue : []).slice(0, QUEUE_MAX)
        .map(x => ({
          url: String(x.url || ''),
          id: x.id || songId(String(x.url || '')),
          source: x.source || detectSource(String(x.url || '')) || 'yt',
          title: String(x.title || '') || String(x.url || ''),
          thumb: (x.thumb && /^https:\/\//.test(String(x.thumb))) ? String(x.thumb) : '',
          dur: Number(x.dur) || 0,
          rep: Math.max(0, Math.min(99, Number(x.rep) || 0)),
          info: null, fail: 0,
        }))
        .filter(x => x.id);
      if (!state.queue.length) { delete saved[gid]; continue; }
      state.pos = Math.max(0, Math.min(Number(ms.pos) || 0, state.queue.length - 1));
      state.playsLeft = (Number.isFinite(ms.playsLeft) && ms.playsLeft >= 1) ? Math.floor(ms.playsLeft) : Infinity;
      state.repeatLeft = state.queue[state.pos].rep | 0;
      state.connection = await joinVoice(client, gid, voiceCh.id);
      state.voiceId = String(voiceCh.id);
      state.note = '🔄 Bot restart — tự phát tiếp từ chỗ đang dở.';
      const wantPaused = ms.paused === true;
      await playAt(client, gid, state.pos);
      if (wantPaused && state.player) {
        try { state.player.pause(); state.paused = true; state.pausedAt = Date.now(); markStateDirty(gid); } catch {}
      }
      console.log('[Music] Đã tự phát tiếp sau restart ở guild ' + gid + ' (voice ' + voiceCh.id + ', ' + state.queue.length + ' bài).');
    } catch (e) {
      console.error('[Music] resume lỗi (' + gid + '):', (e && e.message) || e);
      delete saved[gid];
    }
  }
  try { jsonCache.writeJSON(statePath, { guilds: saved }); jsonCache.flushSync(statePath); } catch {}
}

// ─── Probe mạng mỗi lần boot → /bot/diag ─────────────────────────────────────
// Chạy thử ĐÚNG pipeline ffmpeg của trình phát trên runner (không phải chỉ ping URL):
// đếm PCM stdout — biết ngay nguồn nào lấy được TIẾNG từ IP GitHub Actions.
function probePcm(args, ms) {
  return new Promise(res => {
    let ff = null;
    try { ff = spawn(ffmpegPath, args); } catch (e) { return res({ ok: false, bytes: 0, err: String((e && e.message) || e).slice(0, 120) }); }
    let bytes = 0, err = '', done = false;
    const finish = () => {
      if (done) return; done = true;
      clearTimeout(t);
      try { ff.kill('SIGKILL'); } catch {}
      res({ ok: bytes >= 2048, bytes, err: err.slice(0, 120) });
    };
    if (ff.stdout) ff.stdout.on('data', c => { bytes += c.length; if (bytes >= 2048) finish(); });
    if (ff.stderr) ff.stderr.on('data', d => { if (!err) err = String(d).trim().split('\n')[0] || ''; });
    ff.once('exit', finish);
    ff.once('error', e => { err = String((e && e.message) || e).slice(0, 120); finish(); });
    const t = setTimeout(finish, ms);
    if (t.unref) t.unref();
  });
}

function probePipePcm(dl, ms) {
  return new Promise(res => {
    let ff = null;
    try { ff = spawn(ffmpegPath, ffmpegArgsForInput()); } catch (e) { return res({ ok: false, bytes: 0, err: String((e && e.message) || e).slice(0, 120) }); }
    let bytes = 0, err = '', done = false;
    const finish = () => {
      if (done) return; done = true;
      clearTimeout(t);
      try { dl.destroy(); } catch {}
      try { ff.kill('SIGKILL'); } catch {}
      res({ ok: bytes >= 2048, bytes, err: err.slice(0, 120) });
    };
    pipeline(dl, ff.stdin).catch(e => { if (!err) err = String((e && e.message) || e).slice(0, 120); });
    if (ff.stdout) ff.stdout.on('data', c => { bytes += c.length; if (bytes >= 2048) finish(); });
    if (ff.stderr) ff.stderr.on('data', d => { if (!err) err = String(d).trim().split('\n')[0] || ''; });
    ff.once('exit', finish);
    ff.once('error', finish);
    const t = setTimeout(finish, ms);
    if (t.unref) t.unref();
  });
}

async function runBootProbe(client) {
  const gid = client.guilds.cache.keys().next().value;
  if (!gid) return;
  // (A) Tầng HTTP: Node fetch qua relay (KHÔNG qua ffmpeg) — tách lỗi đường mạng khỏi lỗi ffmpeg.
  try {
    const input = relayRadioInput(RADIO_STATIONS[0].url);
    const t0 = Date.now();
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 8000);
    let bytes = 0, status = 0, errMsg = '';
    try {
      const r = await fetch(input.url, { headers: input.headers ? { 'x-bot-key': webConfig.botKey() } : {}, signal: ac.signal });
      status = r.status;
      if (r.ok && r.body) {
        const rd = r.body.getReader();
        while (bytes < 65536 && Date.now() - t0 < 7000) {
          const { done, value } = await rd.read();
          if (done) break;
          bytes += value ? value.length : 0;
        }
        try { await rd.cancel(); } catch {}
      }
    } catch (e) { errMsg = String((e && e.message) || e).slice(0, 100); }
    clearTimeout(timer);
    webConfig.postDiag(gid, 'probe-relay-http',
      `${bytes >= 2048 ? 'OK' : 'FAIL'} status=${status} ${bytes} byte ${Date.now() - t0}ms${errMsg ? ' · ' + errMsg : ''}`).catch(() => {});
  } catch (e) { /* probe không được làm phiền bot */ }
  // (B) Radio: các kênh song song, probe ĐÚNG đường phát (relay khi có BOT_KEY) — kênh nào ra PCM?
  try {
    const viaRelay = !!webConfig.botKey();
    const results = await Promise.all(RADIO_STATIONS.map(async s => {
      const input = relayRadioInput(s.url);
      const r = await probePcm(ffmpegArgsForUrl(input.url, input.headers || undefined), 9000);
      return { id: s.id, ok: r.ok, err: r.err };
    }));
    const ok = results.filter(x => x.ok).map(x => x.id);
    const bad = results.filter(x => !x.ok);
    const sample = bad.length && bad[0].err ? ' · lỗi mẫu: ' + bad[0].err : '';
    webConfig.postDiag(gid, 'probe-radio',
      `OK ${ok.length}/${RADIO_STATIONS.length} (${ok.join(', ') || '—'})` +
      (bad.length ? ' · CHẾT: ' + bad.map(x => x.id).join(', ') : '') +
      (viaRelay ? ' · qua relay' : ' · trực tiếp') + sample).catch(() => {});
  } catch (e) { /* probe không được làm phiền bot */ }
  // SoundCloud: search → download → ffmpeg → PCM (toàn bộ đường /play).
  try {
    if (!scdl) {
      webConfig.postDiag(gid, 'probe-sc', 'FAIL: chưa cài soundcloud-downloader').catch(() => {});
      return;
    }
    const sr = await withTimeout(scdl.search({ query: 'lofi chill', resourceType: 'tracks' }), 12000, 'sc search');
    const t = (sr && sr.collection || [])[0];
    if (!t) {
      webConfig.postDiag(gid, 'probe-sc', 'FAIL: search 0 kết quả').catch(() => {});
      return;
    }
    let dl = null;
    try {
      dl = await downloadStreamWithTimeout(() => scdl.download(t.permalink_url), 15000, 'sc download');
      if (!dl || typeof dl.on !== 'function') throw new Error('dl không phải stream');
      const pr = await probePipePcm(dl, 6000);
      webConfig.postDiag(gid, 'probe-sc',
        `${pr.ok ? 'OK' : 'FAIL'} (${pr.bytes} byte PCM) — search + stream${pr.err ? ' · ' + pr.err : ''}`).catch(() => {});
    } catch (e) {
      webConfig.postDiag(gid, 'probe-sc', 'FAIL: ' + String((e && e.message) || e).slice(0, 150)).catch(() => {});
      try { if (dl) dl.destroy(); } catch {}
    }
  } catch (e) {
    webConfig.postDiag(gid, 'probe-sc', 'FAIL: ' + String((e && e.message) || e).slice(0, 150)).catch(() => {});
  }
}

module.exports = {
  sendPanel, playQuery, startRadio, handleButton, handleSelect, handleModal, init, refreshPanel,
  panelPayload, collectYouTubeLinks, collectLinks, detectSource, songId, scSearchTrack, resolveSpotifyToSc,
  advanceAfterFinish, buildQueueFromCfg, parsePlays, playsIsInf,
  ytId, nextPlayablePos, prevPlayablePos, pausedIdSet, syncQueueWithCfg,
  flushMusicState, loadSavedMusicState, RADIO_STATIONS,
  nextRadioStation, shouldReplaceQueue, relayRadioInput, ffmpegArgsForInput, ffmpegArgsForUrl, withTimeout,
  _stateOf: stateOf, _removePanel: removePanel, _ytdlClient: ytdlClient, _markStateDirty: markStateDirty,
  _pumpPipeAttempt: pumpPipeAttempt, _pumpUrlAttempt: pumpUrlAttempt,
  QUEUE_MAX, AUTO_LEAVE_MS,
};
