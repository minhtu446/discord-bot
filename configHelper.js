const config = require('./config');
const jsonCache = require('./jsonCache');
const { execSync } = require('child_process');

const GUILD_CONFIG_PATH = jsonCache.getPath('guildConfigs.json');
const EXTRA_OWNERS_PATH = jsonCache.getPath('extraOwners.json');

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
}

function isOwner(userId) {
  if (userId === config.ownerId) return true;
  const owners = jsonCache.readJSONArray(EXTRA_OWNERS_PATH);
  return owners.includes(userId);
}

function syncToGitHub() {
  const ws = process.env.GITHUB_WORKSPACE || process.cwd();
  try {
    execSync('git add data/extraOwners.json', { cwd: ws, stdio: 'pipe' });
    const out = execSync('git diff --cached --quiet || echo dirty', { cwd: ws, stdio: 'pipe' });
    if (out.toString().includes('dirty')) {
      execSync('git commit -m "auto: update extraOwners"', { cwd: ws, stdio: 'pipe' });
      execSync('git push origin main', { cwd: ws, stdio: 'pipe' });
    }
  } catch (e) {
    console.error('[GitSync]', e.message);
  }
}

function addOwner(userId) {
  const owners = jsonCache.readJSONArray(EXTRA_OWNERS_PATH);
  if (!owners.includes(userId)) {
    owners.push(userId);
    jsonCache.writeJSON(EXTRA_OWNERS_PATH, owners);
    jsonCache.flushSync(EXTRA_OWNERS_PATH);
    syncToGitHub();
  }
}

function removeOwner(userId) {
  let owners = jsonCache.readJSONArray(EXTRA_OWNERS_PATH);
  if (owners.includes(userId)) {
    owners = owners.filter(id => id !== userId);
    jsonCache.writeJSON(EXTRA_OWNERS_PATH, owners);
    jsonCache.flushSync(EXTRA_OWNERS_PATH);
    syncToGitHub();
  }
}

function listOwners() {
  const extra = jsonCache.readJSONArray(EXTRA_OWNERS_PATH);
  return [config.ownerId, ...extra];
}

function isDefaultGuild(guildId) {
  return guildId === DEFAULT_GUILD;
}

module.exports = { getConfig, getGuildConfig, setGuildField, isOwner, addOwner, removeOwner, listOwners };
