const fs = require('fs');
const path = require('path');

(function loadEnv() {
  try {
    const envPath = path.join(__dirname, '.env');
    if (fs.existsSync(envPath)) {
      const content = fs.readFileSync(envPath, 'utf8');
      for (const line of content.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eqIdx = trimmed.indexOf('=');
        if (eqIdx === -1) continue;
        const key = trimmed.substring(0, eqIdx).trim();
        const value = trimmed.substring(eqIdx + 1).trim();
        process.env[key] = value;
      }
    }
  } catch {}
})();

let raw = {};
try {
  raw = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8'));
} catch {
  try {
    raw = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.example.json'), 'utf8'));
  } catch {}
}

const ENV_MAP = {
  token: 'DISCORD_TOKEN',
  hfToken: 'HF_TOKEN',
  ownerId: 'OWNER_ID',
  clientId: 'CLIENT_ID',
  guildId: 'GUILD_ID',
  welcomeChannelId: 'WELCOME_CHANNEL_ID',
  logChannelId: 'LOG_CHANNEL_ID',
  ticketCategoryId: 'TICKET_CATEGORY_ID',
  memberRoleId: 'MEMBER_ROLE_ID',
  setupCategoryId: 'SETUP_CATEGORY_ID',
  dmRelayChannelId: 'DM_RELAY_CHANNEL_ID',
};

const config = {};
for (const [key, envVar] of Object.entries(ENV_MAP)) {
  config[key] = process.env[envVar] !== undefined ? process.env[envVar] : raw[key];
}
for (const [key, envVar] of Object.entries(LIST_MAP)) {
  const v = process.env[envVar] !== undefined ? process.env[envVar] : raw[key];
  config[key] = typeof v === 'string' ? v.split(',').map(s => s.trim()).filter(Boolean) : (Array.isArray(v) ? v : []);
}

module.exports = config;
