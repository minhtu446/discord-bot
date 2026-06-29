const jsonCache = require('./jsonCache');
const aiEngine = require('./aiEngine');

const wordsPath = jsonCache.getPath('noituWords.json');
const validWordsPath = jsonCache.getPath('validWords.json');
const noituChannelsPath = jsonCache.getPath('noituChannels.json');

let validWords = null;
const activeChannels = new Map();

function getLastWord(pair) { return pair.split(' ')[1]; }
function getFirstWord(pair) { return pair.split(' ')[0]; }

function isValidWord(word) {
  if (!validWords) {
    validWords = new Set(jsonCache.readJSONArray(validWordsPath));
  }
  return validWords.has(word);
}

function arePartsValid(word) {
  const parts = word.split(' ');
  return parts.length === 2 && isValidWord(parts[0]) && isValidWord(parts[1]);
}

async function arePartsValidAI(word) {
  const parts = word.split(' ');
  if (parts.length !== 2) return false;
  const results = await Promise.all(parts.map(p => aiEngine.checkWordMeaning(p)));
  return results.every(r => r === true);
}

function loadChannels() {
  const data = jsonCache.readJSONObject(noituChannelsPath);
  for (const [chId, state] of Object.entries(data)) {
    activeChannels.set(chId, state);
  }
}

function saveChannels() {
  const obj = {};
  for (const [chId, state] of activeChannels) {
    obj[chId] = state;
  }
  jsonCache.writeJSON(noituChannelsPath, obj);
}

async function initChannel(channel, silent) {
  const wordList = jsonCache.readJSONArray(wordsPath);
  if (wordList.length === 0) return;

  const startWord = wordList[Math.floor(Math.random() * wordList.length)];
  const state = {
    currentPair: startWord,
    usedWords: [startWord],
    wordList: [...wordList],
    channelId: channel.id,
  };
  activeChannels.set(channel.id, state);
  saveChannels();

  if (silent) return;

  const { EmbedBuilder } = require('discord.js');
  const embed = new EmbedBuilder()
    .setTitle('🔤 Nối từ Cộng đồng')
    .setDescription(`**Từ bắt đầu:** \`\`\`\n${startWord}\n\`\`\`\nAi cũng có thể nhắn tin nối tiếp trong kênh này!\n✅ Bot sẽ thả tick nếu đúng, ❌ xóa nếu sai.`)
    .setColor(0x5865F2);

  await channel.send({ embeds: [embed] });
}

async function sendError(message, text) {
  await message.delete().catch(() => {});
  const msg = await message.channel.send({ content: `${message.author} ${text}` }).catch(() => {});
  if (msg) setTimeout(() => msg.delete().catch(() => {}), 4000);
}

async function handleMessage(message) {
  if (message.author.bot) return false;
  const state = activeChannels.get(message.channel.id);
  if (!state) return false;

  const content = message.content.toLowerCase().trim();
  const parts = content.split(' ');

  if (parts.length !== 2) {
    await sendError(message, `❌ "${content}" không đúng! Cần nhập 2 từ (vd: \`đen xì\`)`);
    return true;
  }

  if (!isValidWord(content)) {
    await sendError(message, `❌ "${content}" không phải từ tiếng Việt có nghĩa!`);
    return true;
  }

  if (!arePartsValid(content)) {
    const aiOk = await arePartsValidAI(content);
    if (!aiOk) {
      await sendError(message, `❌ "${content}" có từ không có nghĩa trong tiếng Việt!`);
      return true;
    }
  }

  const lastWord = getLastWord(state.currentPair);
  const firstWord = getFirstWord(content);

  if (firstWord !== lastWord) {
    await sendError(message, `❌ Từ đầu phải là **${lastWord}**! "${content}" sai rồi.`);
    return true;
  }

  if (state.usedWords.includes(content)) {
    await sendError(message, `❌ "${content}" đã được dùng trước đó!`);
    return true;
  }

  try { await message.react('✅'); } catch {}

  state.usedWords.push(content);
  state.currentPair = content;

  if (!state.wordList.includes(content)) {
    state.wordList.push(content);
    jsonCache.writeJSON(wordsPath, state.wordList);
  }

  saveChannels();

  return true;
}

async function cleanupChannel(channelId) {
  activeChannels.delete(channelId);
  const data = jsonCache.readJSONObject(noituChannelsPath);
  delete data[channelId];
  jsonCache.writeJSON(noituChannelsPath, data);
}

function isActive(channelId) {
  return activeChannels.has(channelId);
}

loadChannels();

module.exports = { initChannel, handleMessage, cleanupChannel, isActive };
