const jsonCache = require('./jsonCache');

const DM_AI_SETTINGS_PATH = jsonCache.getPath('dmAiDisabled.json');

function getDisabledMap() {
  return jsonCache.readJSONObject(DM_AI_SETTINGS_PATH);
}

function isDisabled(guildId, userId) {
  if (!guildId || !userId) return false;
  const all = getDisabledMap();
  return !!(all[guildId] && all[guildId][userId]);
}

function setDisabled(guildId, userId, disabled) {
  if (!guildId || !userId) return;
  const all = getDisabledMap();
  if (!all[guildId]) all[guildId] = {};
  if (disabled) {
    all[guildId][userId] = true;
  } else {
    delete all[guildId][userId];
  }
  jsonCache.writeJSON(DM_AI_SETTINGS_PATH, all);
}

module.exports = { isDisabled, setDisabled };
