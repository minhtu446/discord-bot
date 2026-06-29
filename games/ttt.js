const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, ComponentType } = require('discord.js');

const SIZE = 5;
const MOVE_TIME_LIMIT = 2000;
const MAX_DEPTH = 12;
const EMPTY = '⬜';
const PLAYER = '❌';
const BOT = '⭕';

function createBoard() {
  return Array(SIZE).fill(null).map(() => Array(SIZE).fill(EMPTY));
}

function boardToButtons(board, gameId, disabled = false) {
  const rows = [];
  for (let r = 0; r < SIZE; r++) {
    const row = new ActionRowBuilder();
    for (let c = 0; c < SIZE; c++) {
      row.addComponents(
        new ButtonBuilder()
          .setCustomId(`ttt_${gameId}_${r}_${c}`)
          .setLabel(board[r][c])
          .setStyle(
            board[r][c] === PLAYER ? ButtonStyle.Danger :
            board[r][c] === BOT ? ButtonStyle.Primary :
            ButtonStyle.Secondary
          )
          .setDisabled(disabled || board[r][c] !== EMPTY)
      );
    }
    rows.push(row);
  }
  return rows;
}

function checkWinner(board) {
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c <= SIZE - 5; c++) {
      if (board[r][c] !== EMPTY && board[r][c] === board[r][c + 1] && board[r][c] === board[r][c + 2] && board[r][c] === board[r][c + 3] && board[r][c] === board[r][c + 4])
        return board[r][c];
    }
  }
  for (let r = 0; r <= SIZE - 5; r++) {
    for (let c = 0; c < SIZE; c++) {
      if (board[r][c] !== EMPTY && board[r][c] === board[r + 1][c] && board[r][c] === board[r + 2][c] && board[r][c] === board[r + 3][c] && board[r][c] === board[r + 4][c])
        return board[r][c];
    }
  }
  for (let r = 0; r <= SIZE - 5; r++) {
    for (let c = 0; c <= SIZE - 5; c++) {
      if (board[r][c] !== EMPTY && board[r][c] === board[r + 1][c + 1] && board[r][c] === board[r + 2][c + 2] && board[r][c] === board[r + 3][c + 3] && board[r][c] === board[r + 4][c + 4])
        return board[r][c];
    }
  }
  for (let r = 4; r < SIZE; r++) {
    for (let c = 0; c <= SIZE - 5; c++) {
      if (board[r][c] !== EMPTY && board[r][c] === board[r - 1][c + 1] && board[r][c] === board[r - 2][c + 2] && board[r][c] === board[r - 3][c + 3] && board[r][c] === board[r - 4][c + 4])
        return board[r][c];
    }
  }
  return null;
}

function isFull(board) {
  return board.every(row => row.every(cell => cell !== EMPTY));
}

function getAvailable(board) {
  const avail = [];
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      if (board[r][c] === EMPTY) avail.push([r, c]);
    }
  }
  return avail;
}

function getAllLines(board) {
  const lines = [];
  for (let r = 0; r < SIZE; r++) { const row = []; for (let c = 0; c < SIZE; c++) row.push(board[r][c]); lines.push(row); }
  for (let c = 0; c < SIZE; c++) { const col = []; for (let r = 0; r < SIZE; r++) col.push(board[r][c]); lines.push(col); }
  const d1 = [], d2 = [];
  for (let i = 0; i < SIZE; i++) { d1.push(board[i][i]); d2.push(board[i][SIZE - 1 - i]); }
  lines.push(d1, d2);
  return lines;
}

function scoreLine(line, piece) {
  const other = piece === BOT ? PLAYER : BOT;
  if (line.some(c => c === other)) return 0;
  const count = line.filter(c => c === piece).length;
  if (count === 5) return 1000000;
  if (count === 0) return 0;
  const e = line.filter(c => c === EMPTY).length;
  return Math.pow(10, count) * (e + 1);
}

function evaluateBoard(board, botPiece, playerPiece) {
  let score = 0;
  for (const line of getAllLines(board)) {
    score += scoreLine(line, botPiece);
    score -= scoreLine(line, playerPiece) * 1.1;
  }
  return score;
}

function evaluate(board, botPiece, playerPiece) {
  const win = checkWinner(board);
  if (win === botPiece) return 1000000;
  if (win === playerPiece) return -1000000;
  if (isFull(board)) return 0;
  return evaluateBoard(board, botPiece, playerPiece);
}

function findInstantWin(board, piece) {
  const avail = getAvailable(board);
  for (const [r, c] of avail) {
    board[r][c] = piece;
    if (checkWinner(board)) { board[r][c] = EMPTY; return [r, c]; }
    board[r][c] = EMPTY;
  }
  return null;
}

function minimax(board, depth, isMax, alpha, beta, botPiece, playerPiece, deadline) {
  if (Date.now() > deadline) return evaluate(board, botPiece, playerPiece);
  const win = checkWinner(board);
  if (win) return evaluate(board, botPiece, playerPiece);
  if (isFull(board) || depth >= MAX_DEPTH) return evaluate(board, botPiece, playerPiece);

  const avail = getAvailable(board);
  if (isMax) {
    let best = -Infinity;
    for (const [r, c] of avail) {
      if (Date.now() > deadline) return best;
      board[r][c] = botPiece;
      const val = minimax(board, depth + 1, false, alpha, beta, botPiece, playerPiece, deadline);
      board[r][c] = EMPTY;
      if (val > best) best = val;
      if (val > alpha) alpha = val;
      if (beta <= alpha) break;
    }
    return best;
  } else {
    let best = Infinity;
    for (const [r, c] of avail) {
      if (Date.now() > deadline) return best;
      board[r][c] = playerPiece;
      const val = minimax(board, depth + 1, true, alpha, beta, botPiece, playerPiece, deadline);
      board[r][c] = EMPTY;
      if (val < best) best = val;
      if (val < beta) beta = val;
      if (beta <= alpha) break;
    }
    return best;
  }
}

function botMove(board, botPiece, playerPiece) {
  let instant = findInstantWin(board, botPiece);
  if (instant) return instant;
  instant = findInstantWin(board, playerPiece);
  if (instant) return instant;

  const avail = getAvailable(board);
  if (avail.length === 0) return null;

  const center = Math.floor(SIZE / 2);
  avail.sort((a, b) => {
    board[a[0]][a[1]] = botPiece;
    const sa = evaluateBoard(board, botPiece, playerPiece);
    board[a[0]][a[1]] = EMPTY;
    board[b[0]][b[1]] = botPiece;
    const sb = evaluateBoard(board, botPiece, playerPiece);
    board[b[0]][b[1]] = EMPTY;
    if (sa !== sb) return sb - sa;
    const da = Math.abs(a[0] - center) + Math.abs(a[1] - center);
    const db = Math.abs(b[0] - center) + Math.abs(b[1] - center);
    return da - db;
  });

  const deadline = Date.now() + MOVE_TIME_LIMIT;
  let bestVal = -Infinity;
  let bestMove = avail[0];

  for (const [r, c] of avail) {
    if (Date.now() > deadline) break;
    board[r][c] = botPiece;
    const val = minimax(board, 0, false, -Infinity, Infinity, botPiece, playerPiece, deadline);
    board[r][c] = EMPTY;
    if (val > bestVal) { bestVal = val; bestMove = [r, c]; }
  }
  return bestMove;
}

const games = {};

function getReplayRow(channelId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`game_ttt_${channelId}`).setLabel('❌ Chơi TTT').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`game_noitu_${channelId}`).setLabel('🔤 Chơi NOITU').setStyle(ButtonStyle.Success)
  );
}

async function startGame(interaction, client) {
  const userId = interaction.user.id;
  const channelId = interaction.channel.id;

  if (games[userId]) {
    return interaction.reply({ content: '❌ Bạn đang có game đang chơi!', flags: 64 });
  }

  await interaction.deferReply();

  const board = createBoard();
  const gameId = `${userId}_${Date.now()}`;
  const botPiece = BOT;
  const playerPiece = PLAYER;

  games[userId] = { board, gameId, botPiece, playerPiece };

  let firstTurn = Math.random() < 0.5 ? 'player' : 'bot';
  if (firstTurn === 'bot') {
    const center = Math.floor(SIZE / 2);
    board[center][center] = botPiece;
  }

  const embed = new EmbedBuilder()
    .setTitle('🎮 Caro 5x5')
    .setDescription(firstTurn === 'player' ? 'Lượt bạn (❌)' : 'Lượt Bot (⭕)')
    .setColor(0x5865F2);

  await interaction.editReply({
    embeds: [embed],
    components: boardToButtons(board, gameId)
  });
  const boardMsg = await interaction.fetchReply();

  const cancelRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`ttt_cancel_${gameId}`).setLabel('❌ Hủy trận').setStyle(ButtonStyle.Danger)
  );
  const cancelMsg = await interaction.channel.send({ content: '🎮 Điều khiển trận đấu:', components: [cancelRow] });

  const boardCollector = boardMsg.createMessageComponentCollector({ time: 0 });
  const cancelCollector = cancelMsg.createMessageComponentCollector({ time: 0 });

  function makeEndEmbed(title, desc, color) {
    return new EmbedBuilder().setTitle(title).setDescription(desc).setColor(color);
  }

  async function cleanup() {
    delete games[userId];
    boardCollector.stop();
    cancelCollector.stop();
  }

  async function endGame(sourceInteraction, resultEmbed) {
    const embedText = board.map(r => r.join('')).join('\n');
    const finalEmbed = EmbedBuilder.from(resultEmbed)
      .setDescription((resultEmbed.data.description || '') + '\n\n' + embedText + '\n\n⬆️ Bấm nút dưới để chơi lại');

    await boardMsg.edit({ embeds: [finalEmbed], components: [getReplayRow(channelId)] });
    await cancelMsg.delete().catch(() => {});
    await sourceInteraction.deferUpdate().catch(() => {});
    await cleanup();
  }

  boardCollector.on('collect', async (i) => {
    try {
      if (i.user.id !== userId) return i.reply({ content: '❌ Không phải game của bạn!', flags: 64 });

      const parts = i.customId.split('_');
      const [r, c] = [parseInt(parts[3]), parseInt(parts[4])];

    if (board[r][c] !== EMPTY) return i.reply({ content: '❌ Ô này đã đánh rồi!', flags: 64 });

    board[r][c] = playerPiece;

    let win = checkWinner(board);
    if (win) {
      await endGame(i, makeEndEmbed('🎮 Caro 5x5 - BẠN THẮNG!', 'Xin chúc mừng! 🎉', 0x00FF00));
      return;
    }

    if (isFull(board)) {
      await endGame(i, makeEndEmbed('🎮 Caro 5x5 - HÒA!', 'Hai bên hòa nhau!', 0xFFA500));
      return;
    }

    const move = botMove(board, botPiece, playerPiece);
    if (move) {
      const [br, bc] = move;
      board[br][bc] = botPiece;
    }

    win = checkWinner(board);
    if (win) {
      await endGame(i, makeEndEmbed('🎮 Caro 5x5 - BOT THẮNG!', 'Bot thắng! 🤖', 0xFF0000));
      return;
    }

    if (isFull(board)) {
      await endGame(i, makeEndEmbed('🎮 Caro 5x5 - HÒA!', 'Hai bên hòa nhau!', 0xFFA500));
      return;
    }

    const turnEmbed = new EmbedBuilder()
      .setTitle('🎮 Caro 5x5')
      .setDescription('Lượt bạn (❌)')
      .setColor(0x5865F2);

    await i.update({ embeds: [turnEmbed], components: boardToButtons(board, gameId) });
    } catch (e) { /* interaction expired */ }
  });

  cancelCollector.on('collect', async (i) => {
    try {
      if (i.user.id !== userId) return i.reply({ content: '❌ Không phải game của bạn!', flags: 64 });
      await endGame(i, makeEndEmbed('🎮 Caro 5x5', 'Đã hủy trận!', 0xFF0000));
    } catch (e) { /* interaction expired */ }
  });

  boardCollector.on('end', () => {
    if (games[userId]) cleanup();
  });

  cancelCollector.on('end', () => {
    if (games[userId]) cleanup();
  });
}

module.exports = { startGame };
