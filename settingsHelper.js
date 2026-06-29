const jsonCache = require('./jsonCache');

const SETTINGS_PATH = jsonCache.getPath('guildSettings.json');
const DEFAULT_SETTINGS = {
  wordFilter: true,
  imageOcr: true,
  imageDhash: true,
  videoOcr: true,
  videoAudio: true,
  videoPattern: true,
  antiSpam: true,
  violationBan: true,
  welcomeEmbed: true,
  welcomeCanvas: true,
  autoRole: true,
  autoNickname: true,
  dmRelay: true,
  logging: true,
  music: true,
  ticket: true,
  gameChannel: true,
  rps: true,
  ttt: true,
  noitu: true,
};

const SETTING_LABELS = {
  wordFilter: 'Lọc từ cấm',
  imageOcr: 'OCR ảnh',
  imageDhash: 'Ảnh trùng',
  videoOcr: 'OCR video',
  videoAudio: 'STT video',
  videoPattern: 'Pattern video',
  antiSpam: 'Chống spam',
  violationBan: 'Cấm tự động',
  welcomeEmbed: 'Embed chào mừng',
  welcomeCanvas: 'Canvas chào mừng',
  autoRole: 'Gán role',
  autoNickname: 'Đổi biệt danh',
  dmRelay: 'Chuyển DM',
  logging: 'Ghi log',
  music: 'Nhạc',
  ticket: 'Ticket',
  gameChannel: 'Kênh game',
  rps: 'Oẳn tù tì',
  ttt: 'Caro AI',
  noitu: 'Nối từ',
};

function getSettings(guildId) {
  const all = jsonCache.readJSONObject(SETTINGS_PATH);
  return { ...DEFAULT_SETTINGS, ...(all[guildId] || {}) };
}

function setSetting(guildId, key, value) {
  const all = jsonCache.readJSONObject(SETTINGS_PATH);
  if (!all[guildId]) all[guildId] = {};
  all[guildId][key] = value;
  jsonCache.writeJSON(SETTINGS_PATH, all);
}

module.exports = { getSettings, setSetting, DEFAULT_SETTINGS, SETTING_LABELS };