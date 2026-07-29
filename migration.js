const jsonCache = require('./jsonCache');

function isUserId(id) {
  return typeof id === 'string' && /^\d{17,20}$/.test(id);
}

function isChannelId(id) {
  return typeof id === 'string' && /^\d{17,20}$/.test(id);
}

function isOldSetupFormat(data) {
  if (typeof data !== 'object' || data === null) return false;
  const keys = Object.keys(data);
  if (keys.length === 0) return false;
  const firstKey = keys[0];
  if (!isUserId(firstKey)) return false;
  const val = data[firstKey];
  return val && typeof val === 'object' && ('chat' in val || 'voice' in val);
}

function isOldUserChannelsFormat(data) {
  if (typeof data !== 'object' || data === null) return false;
  const keys = Object.keys(data);
  if (keys.length === 0) return false;
  const firstKey = keys[0];
  if (!isUserId(firstKey)) return false;
  return isChannelId(data[firstKey]);
}

function isOldUserTicketsFormat(data) {
  return isOldUserChannelsFormat(data);
}

async function migrateFile(filePath, label, client, extractChannelIds) {
  const data = jsonCache.readJSONObject(filePath);
  if (!data || Object.keys(data).length === 0) return 0;

  if (isOldSetupFormat(data)) {
    console.log(`[Migration] ${label}: Detect old format, migrating...`);
    const migrated = {};
    for (const [userId, chs] of Object.entries(data)) {
      const channelIds = extractChannelIds(chs);
      let guildId = null;
      for (const chId of channelIds) {
        if (!chId) continue;
        try {
          const ch = client.channels.cache.get(chId) || await client.channels.fetch(chId).catch(() => null);
          if (ch && ch.guild) { guildId = ch.guild.id; break; }
        } catch {}
      }
      if (!guildId) {
        guildId = '__unknown__';
        console.log(`[Migration] ${label}: Channel ${channelIds.join(',')} for user ${userId} — guild not found, using __unknown__`);
      }
      if (!migrated[guildId]) migrated[guildId] = {};
      migrated[guildId][userId] = chs;
    }
    jsonCache.writeJSON(filePath, migrated);
    jsonCache.flushSync(filePath);
    const count = Object.keys(data).length;
    console.log(`[Migration] ${label}: Migrated ${count} entries`);
    return count;
  }

  if (isOldUserChannelsFormat(data)) {
    console.log(`[Migration] ${label}: Detect old format, migrating...`);
    const migrated = {};
    for (const [userId, chId] of Object.entries(data)) {
      let guildId = null;
      try {
        const ch = client.channels.cache.get(chId) || await client.channels.fetch(chId).catch(() => null);
        if (ch && ch.guild) guildId = ch.guild.id;
      } catch {}
      if (!guildId) {
        guildId = '__unknown__';
        console.log(`[Migration] ${label}: Channel ${chId} for user ${userId} — guild not found, using __unknown__`);
      }
      if (!migrated[guildId]) migrated[guildId] = {};
      migrated[guildId][userId] = chId;
    }
    jsonCache.writeJSON(filePath, migrated);
    jsonCache.flushSync(filePath);
    const count = Object.keys(data).length;
    console.log(`[Migration] ${label}: Migrated ${count} entries`);
    return count;
  }

  console.log(`[Migration] ${label}: Already new format, skipping`);
  return 0;
}

function migrateBadWords() {
  const badWordsPath = jsonCache.getPath('badWords.json');
  const data = jsonCache.readJSON(badWordsPath);
  if (Array.isArray(data) || (data && typeof data === 'object' && '_global' in data)) {
    console.log(`[Migration] badWords: Detect old format, converting to empty per-guild...`);
    jsonCache.writeJSON(badWordsPath, {});
    jsonCache.flushSync(badWordsPath);
    console.log(`[Migration] badWords: Cleared legacy data, each guild starts fresh.`);
    return 1;
  }
  console.log(`[Migration] badWords: Already new format, skipping`);
  return 0;
}

async function migrate(client) {
  console.log('[Migration] Starting data migration...');
  const setupPath = jsonCache.getPath('setupChannels.json');
  const userChannelsPath = jsonCache.getPath('userChannels.json');
  const userTicketsPath = jsonCache.getPath('userTickets.json');

  let total = 0;
  total += await migrateFile(setupPath, 'setupChannels', client, (chs) => [chs.chat, chs.voice]);
  total += await migrateFile(userChannelsPath, 'userChannels', client, (chId) => [chId]);
  total += await migrateFile(userTicketsPath, 'userTickets', client, (chId) => [chId]);

  total += migrateBadWords();

  if (total > 0) {
    console.log(`[Migration] Done! Migrated ${total} total entries`);
  } else {
    console.log('[Migration] No migration needed');
  }
}

module.exports = { migrate };
