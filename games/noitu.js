const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const jsonCache = require('../jsonCache');
const aiEngine = require('../aiEngine');

const wordsPath = jsonCache.getPath('noituWords.json');
const validWordsPath = jsonCache.getPath('validWords.json');
let validWords = null;

function getLastWord(pair) { return pair.split(' ')[1]; }

const THINK_DELAY = 1500;

const games = {};

function getReplayRow(channelId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`game_ttt_${channelId}`).setLabel('❌ Chơi TTT').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`game_noitu_${channelId}`).setLabel('🔤 Chơi NOITU').setStyle(ButtonStyle.Success)
  );
}

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

function getFirstWord(pair) { return pair.split(' ')[0]; }

async function startGame(interaction, client) {
  const userId = interaction.user.id;
  const channelId = interaction.channel.id;

  if (games[userId]) {
    return interaction.reply({ content: '❌ Bạn đang có game đang chơi!', flags: 64 });
  }

  await interaction.deferReply();

  const wordList = jsonCache.readJSONArray(wordsPath);
  if (wordList.length === 0) {
    return interaction.editReply({ content: '❌ Danh sách từ trống!' });
  }

  const index = new Map();
  for (const w of wordList) {
    const key = getFirstWord(w);
    if (!index.has(key)) index.set(key, []);
    index.get(key).push(w);
  }

  const currentPair = wordList[Math.floor(Math.random() * wordList.length)];
  const gameId = `${userId}_${Date.now()}`;
  games[userId] = { currentPair, gameId, usedWords: [currentPair], wordList: [...wordList], index };

  const embed = new EmbedBuilder()
    .setTitle('🔤 Nối từ')
    .setDescription(`\`\`\`\n${currentPair}\n\`\`\`\n*Nhập từ nối tiếp!*`)
    .setColor(0x5865F2);

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`noitu_input_${gameId}`).setLabel('✏️ Nhập từ').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`noitu_cancel_${gameId}`).setLabel('❌ Hủy trận').setStyle(ButtonStyle.Danger)
  );

  await interaction.editReply({ embeds: [embed], components: [row] });
  const msg = await interaction.fetchReply();

  const collector = msg.createMessageComponentCollector({ time: 0 });

  collector.on('collect', async (i) => {
    try {
      if (i.user.id !== userId) {
        await i.reply({ content: '❌ Không phải game của bạn!', flags: 64 }).catch(() => {});
        return;
      }

      if (i.customId === `noitu_cancel_${gameId}`) {
        delete games[userId];
        collector.stop();
        await i.update({
          embeds: [new EmbedBuilder().setTitle('🔤 Nối từ').setDescription('Đã hủy trận!').setColor(0xFF0000)],
          components: [getReplayRow(channelId)]
        }).catch(() => {});
        return;
      }

      if (i.customId === `noitu_input_${gameId}`) {
        const modal = new ModalBuilder()
          .setCustomId(`noitu_modal_${gameId}`)
          .setTitle('Nhập từ nối');
        const input = new TextInputBuilder()
          .setCustomId('noitu_word')
          .setLabel('Nhập cụm 2 từ (vd: đen xì)')
          .setStyle(TextInputStyle.Short)
          .setRequired(true);
        const row2 = new ActionRowBuilder().addComponents(input);
        modal.addComponents(row2);
        await i.showModal(modal).catch(() => {});
      }
    } catch (e) { /* interaction expired */ }
  });

  collector.on('end', () => {
    if (games[userId]) delete games[userId];
  });
}

async function handleModal(interaction) {
  const customId = interaction.customId;
  if (!customId.startsWith('noitu_modal_')) return false;

  const gameId = customId.replace('noitu_modal_', '');
  const userId = interaction.user.id;
  const channelId = interaction.channel.id;

  const game = games[userId];
  if (!game || game.gameId !== gameId) {
    await interaction.reply({ content: '❌ Game đã kết thúc!', flags: 64 });
    return true;
  }

  const userWord = interaction.fields.getTextInputValue('noitu_word').toLowerCase().trim();
  const parts = userWord.split(' ');

  if (parts.length !== 2) {
    await interaction.reply({ content: '❌ Nhập 2 từ (vd: đen xì)', flags: 64 });
    return true;
  }

  if (!isValidWord(userWord)) {
    await interaction.reply({ content: `❌ **${userWord}** không phải từ tiếng Việt!`, flags: 64 });
    return true;
  }

  if (!arePartsValid(userWord)) {
    const aiOk = await arePartsValidAI(userWord);
    if (!aiOk) {
      await interaction.reply({ content: `❌ **${userWord}** có từ không có nghĩa trong tiếng Việt!`, flags: 64 });
      return true;
    }
  }

  const lastWord = getLastWord(game.currentPair);
  const firstWord = getFirstWord(userWord);

  if (firstWord !== lastWord) {
    await interaction.reply({ content: `❌ Từ đầu phải là **${lastWord}**!`, flags: 64 });
    return true;
  }

  if (game.usedWords.includes(userWord)) {
    await interaction.reply({ content: '❌ Từ đã dùng!', flags: 64 });
    return true;
  }

  game.usedWords.push(userWord);
  game.currentPair = userWord;

  if (!game.wordList.includes(userWord)) {
    game.wordList.push(userWord);
    const key = getFirstWord(userWord);
    if (!game.index.has(key)) game.index.set(key, []);
    game.index.get(key).push(userWord);
    jsonCache.writeJSON(wordsPath, game.wordList);
  }

  const lastW = getLastWord(userWord);

  await interaction.deferUpdate();
  try { await interaction.channel.sendTyping(); } catch {}
  await new Promise(r => setTimeout(r, THINK_DELAY));

  const aiResult = await aiEngine.getNextWord(lastW, game.usedWords, game.index);
  if (!aiResult) {
    delete games[userId];
    const winEmbed = new EmbedBuilder()
      .setTitle('🏆 BẠN THẮNG!')
      .setDescription(`Bot hết từ! Từ cuối: **${userWord}**`)
      .setColor(0x00FF00);
    await interaction.update({ embeds: [winEmbed], components: [getReplayRow(channelId)] });
    return true;
  }

  game.usedWords.push(aiResult.word);
  game.currentPair = aiResult.word;

  if (aiResult.fromAI && !game.wordList.includes(aiResult.word)) {
    game.wordList.push(aiResult.word);
    jsonCache.writeJSON(wordsPath, game.wordList);
  }

  let desc = `\`\`\`\n🧑 ${userWord}\n🤖 ${aiResult.word}\n\`\`\`\n`;
  if (aiResult.meaning) desc += `📖 "${aiResult.word}": ${aiResult.meaning}\n`;
  if (aiResult.fromAI) desc += `🤖 Bot vừa học từ mới!\n`;
  desc += `\n*Lượt bạn!*`;

  const embed = new EmbedBuilder()
    .setTitle('🔤 Nối từ')
    .setDescription(desc)
    .setColor(0x5865F2);

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`noitu_input_${gameId}`).setLabel('✏️ Nhập từ').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`noitu_cancel_${gameId}`).setLabel('❌ Hủy trận').setStyle(ButtonStyle.Danger)
  );

  await interaction.editReply({ embeds: [embed], components: [row] });
  return true;
}

module.exports = { startGame, handleModal };
