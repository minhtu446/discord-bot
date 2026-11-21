const config = require('./config');
const jsonCache = require('./jsonCache');
const { execSync } = require('child_process');

const GUILD_CONFIG_PATH = jsonCache.getPath('guildConfigs.json');

function getGuildConfig(guildId) {
  const all = jsonCache.readJSONObject(GUILD_CONFIG_PATH);
  return all[guildId] || {};
}

function getConfig(guildId, key) {
  const guild = getGuildConfig(guildId);
  if (guild[key] !== undefined) return guild[key];
  return config[key] !== undefined ? config[key] : null;
}

function setGuildField(guildId, field, value) {
  if (!field || !guildId) return;
  const all = jsonCache.readJSONObject(GUILD_CONFIG_PATH);
  if (!all[guildId]) all[guildId] = {};
  all[guildId][field] = value;
  jsonCache.writeJSON(GUILD_CONFIG_PATH, all);
  jsonCache.flushSync(GUILD_CONFIG_PATH);
  syncNow();
}

function sleepSync(ms) {
  const sab = new Int32Array(new SharedArrayBuffer(4));
  Atomics.wait(sab, 0, 0, ms);
}

function syncNow() {
  const ws = process.env.GITHUB_WORKSPACE || __dirname;
  for (let i = 0; i < 3; i++) {
    try {
      execSync('node d1-sync.js push', { cwd: ws, stdio: 'ignore', timeout: 15000 });
      return;
    } catch (e) {
      if (i < 2) sleepSync(1000 * (i + 1));
    }
  }
  console.error('[configHelper] syncNow failed after 3 attempts');
}

module.exports = { getConfig, getGuildConfig, setGuildField };
