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
  syncToGitHub();
}

function isOwner(userId) {
  if (userId === config.ownerId) return true;
  const owners = jsonCache.readJSONArray(EXTRA_OWNERS_PATH);
  return owners.includes(userId);
}

function sleepSync(ms) {
  const sab = new Int32Array(new SharedArrayBuffer(4));
  Atomics.wait(sab, 0, 0, ms);
}

function syncGitPush(ws, message) {
  const token = process.env.BOT_PAT;
  if (token) {
    execSync(`git remote set-url origin https://x-access-token:${token}@github.com/minhtu446/discord-bot.git`, { cwd: ws, stdio: 'pipe' });
  }
  execSync('git add data/', { cwd: ws, stdio: 'pipe' });
  const out = execSync('git diff --cached --quiet || echo dirty', { cwd: ws, stdio: 'pipe' });
  if (!out.toString().includes('dirty')) {
    console.log('[GitSync] No config changes, skip push');
    return;
  }
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      execSync(`git commit -m "${message}"`, { cwd: ws, stdio: 'pipe' });
      execSync('git push origin main', { cwd: ws, stdio: 'pipe', timeout: 30000 });
      console.log('[GitSync] Config pushed to GitHub');
      return;
    } catch (e) {
      console.error(`[GitSync] Push attempt ${attempt} failed: ${e.message}`);
      if (attempt < 3) {
        sleepSync(2000);
        try {
          execSync('git pull --rebase origin main', { cwd: ws, stdio: 'pipe', timeout: 30000 });
          execSync('git add data/', { cwd: ws, stdio: 'pipe' });
        } catch (rebaseErr) {
          console.error('[GitSync] Rebase after conflict failed:', rebaseErr.message);
        }
      }
    }
  }
  console.error('[GitSync] Push failed after 3 attempts');
}

function syncToGitHub() {
  const ws = process.env.GITHUB_WORKSPACE || process.cwd();
  try {
    syncGitPush(ws, `auto: sync config ${new Date().toISOString()}`);
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

function resetAllGuildConfigs() {
  jsonCache.writeJSON(GUILD_CONFIG_PATH, {});
  jsonCache.flushSync(GUILD_CONFIG_PATH);
  syncToGitHub();
}

module.exports = { getConfig, getGuildConfig, setGuildField, isOwner, addOwner, removeOwner, listOwners, resetAllGuildConfigs };
