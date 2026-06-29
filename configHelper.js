const config = require('./config');
const jsonCache = require('./jsonCache');

const GUILD_CONFIG_PATH = jsonCache.getPath('guildConfigs.json');
const EXTRA_OWNERS_PATH = jsonCache.getPath('extraOwners.json');
const DEFAULT_GUILD = '1451217022523277503';

function getGuildConfig(guildId) {
  const all = jsonCache.readJSONObject(GUILD_CONFIG_PATH);
  return all[guildId] || {};
}

function getConfig(guildId, key) {
  const guild = getGuildConfig(guildId);
  if (guild[key] !== undefined) return guild[key];
  if (guildId === DEFAULT_GUILD) return config[key] !== undefined ? config[key] : null;
  return null;
}

function setGuildField(guildId, field, value) {
  if (!field || !guildId) return;
  const all = jsonCache.readJSONObject(GUILD_CONFIG_PATH);
  if (!all[guildId]) all[guildId] = {};
  all[guildId][field] = value;
  jsonCache.writeJSON(GUILD_CONFIG_PATH, all);
}

function isOwner(userId) {
  if (userId === config.ownerId) return true;
  const owners = jsonCache.readJSONArray(EXTRA_OWNERS_PATH);
  return owners.includes(userId);
}

function addOwner(userId) {
  const owners = jsonCache.readJSONArray(EXTRA_OWNERS_PATH);
  if (!owners.includes(userId)) {
    owners.push(userId);
    jsonCache.writeJSON(EXTRA_OWNERS_PATH, owners);
  }
}

function removeOwner(userId) {
  let owners = jsonCache.readJSONArray(EXTRA_OWNERS_PATH);
  if (owners.includes(userId)) {
    owners = owners.filter(id => id !== userId);
    jsonCache.writeJSON(EXTRA_OWNERS_PATH, owners);
  }
}

function listOwners() {
  const extra = jsonCache.readJSONArray(EXTRA_OWNERS_PATH);
  return [config.ownerId, ...extra];
}

function isDefaultGuild(guildId) {
  return guildId === DEFAULT_GUILD;
}

module.exports = { getConfig, getGuildConfig, setGuildField, isOwner, addOwner, removeOwner, listOwners, isDefaultGuild };
