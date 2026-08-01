const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const jsonCache = require('../jsonCache');
const activeGamesPath = jsonCache.getPath('activeGames.json');

const MOVE_TIME_LIMIT = 4000;
const EMPTY = '⬜';
const PLAYER = '❌';
const BOT = '⭕';
const P2 = '⭕';

function getWinLen(size) {
  return size <= 4 ? 3 : 4;
}

function createBoard(size = 5) {
  return Array(size).fill(null).map(() => Array(size).fill(EMPTY));
}

function boardToButtons(board, gameId, disabled = false) {
  const size = board.length;
  const rows = [];
  for (let r = 0; r < size; r++) {
    const row = new ActionRowBuilder();
    for (let c = 0; c < size; c++) {
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

function checkWinner(board, winLen) {
  const size = board.length;
  for (let r = 0; r < size; r++) {
    for (let c = 0; c <= size - winLen; c++) {
      const piece = board[r][c];
      if (piece === EMPTY) continue;
      let win = true;
      for (let k = 1; k < winLen; k++) { if (board[r][c + k] !== piece) { win = false; break; } }
      if (win) return piece;
    }
  }
  for (let r = 0; r <= size - winLen; r++) {
    for (let c = 0; c < size; c++) {
      const piece = board[r][c];
      if (piece === EMPTY) continue;
      let win = true;
      for (let k = 1; k < winLen; k++) { if (board[r + k][c] !== piece) { win = false; break; } }
      if (win) return piece;
    }
  }
  for (let r = 0; r <= size - winLen; r++) {
    for (let c = 0; c <= size - winLen; c++) {
      const piece = board[r][c];
      if (piece === EMPTY) continue;
      let win = true;
      for (let k = 1; k < winLen; k++) { if (board[r + k][c + k] !== piece) { win = false; break; } }
      if (win) return piece;
    }
  }
  for (let r = winLen - 1; r < size; r++) {
    for (let c = 0; c <= size - winLen; c++) {
      const piece = board[r][c];
      if (piece === EMPTY) continue;
      let win = true;
      for (let k = 1; k < winLen; k++) { if (board[r - k][c + k] !== piece) { win = false; break; } }
      if (win) return piece;
    }
  }
  return null;
}

function isFull(board) {
  return board.every(row => row.every(cell => cell !== EMPTY));
}

function getAvailable(board, nearOnly = false) {
  const size = board.length;
  const avail = [];
  if (nearOnly) {
    const seen = new Set();
    let hasPieces = false;
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        if (board[r][c] !== EMPTY) {
          hasPieces = true;
          for (let dr = -1; dr <= 1; dr++) {
            for (let dc = -1; dc <= 1; dc++) {
              const nr = r + dr, nc = c + dc;
              if (nr >= 0 && nr < size && nc >= 0 && nc < size && board[nr][nc] === EMPTY) {
                const k = nr * size + nc;
                if (!seen.has(k)) { seen.add(k); avail.push([nr, nc]); }
              }
            }
          }
        }
      }
    }
    if (!hasPieces) {
      for (let r = 0; r < size; r++)
        for (let c = 0; c < size; c++)
          if (board[r][c] === EMPTY) avail.push([r, c]);
    }
  } else {
    for (let r = 0; r < size; r++)
      for (let c = 0; c < size; c++)
        if (board[r][c] === EMPTY) avail.push([r, c]);
  }
  return avail;
}

function getAllLines(board) {
  const size = board.length;
  const lines = [];
  for (let r = 0; r < size; r++) { const row = []; for (let c = 0; c < size; c++) row.push(board[r][c]); lines.push(row); }
  for (let c = 0; c < size; c++) { const col = []; for (let r = 0; r < size; r++) col.push(board[r][c]); lines.push(col); }
  const d1 = [], d2 = [];
  for (let i = 0; i < size; i++) { d1.push(board[i][i]); d2.push(board[i][size - 1 - i]); }
  lines.push(d1, d2);
  return lines;
}

function scoreLine(line, piece) {
  const other = piece === BOT ? PLAYER : BOT;
  if (line.some(c => c === other)) return 0;
  const count = line.filter(c => c === piece).length;
  const e = line.filter(c => c === EMPTY).length;
  if (count === 0 || e === 0) return 0;
  return Math.pow(10, count) * (e + 1);
}

function evaluateBoard(board, botPiece, playerPiece, winLen) {
  let score = 0;
  for (const line of getAllLines(board)) {
    score += scoreLine(line, botPiece);
    score -= scoreLine(line, playerPiece) * 1.1;
  }
  return score;
}

function evaluate(board, botPiece, playerPiece, winLen) {
  const win = checkWinner(board, winLen);
  if (win === botPiece) return 1000000;
  if (win === playerPiece) return -1000000;
  if (isFull(board)) return 0;
  return evaluateBoard(board, botPiece, playerPiece, winLen);
}

function findInstantWin(board, piece, winLen) {
  const avail = getAvailable(board);
  for (const [r, c] of avail) {
    board[r][c] = piece;
    if (checkWinner(board, winLen)) { board[r][c] = EMPTY; return [r, c]; }
    board[r][c] = EMPTY;
  }
  return null;
}

const transTable = new Map();
const ttDepth = new Map();
let searchAborted = false;

function isEmptyBoard(board) {
  for (const row of board) for (const cell of row) if (cell !== EMPTY) return false;
  return true;
}

function boardKey(board, size) {
  let best = null;
  for (let rot = 0; rot < 4; rot++) {
    for (let mir = 0; mir < 2; mir++) {
      let key = '';
      for (let r = 0; r < size; r++) {
        for (let c = 0; c < size; c++) {
          let rr = r, cc = c;
          for (let i = 0; i < rot; i++) { const t = rr; rr = cc; cc = size - 1 - t; }
          if (mir) cc = size - 1 - cc;
          const cell = board[rr][cc];
          key += cell === EMPTY ? '0' : (cell === BOT ? '2' : '1');
        }
      }
      if (best === null || key < best) best = key;
    }
  }
  return best;
}

function orderMoves(board, avail, piece, size, winLen) {
  avail.sort((a, b) => {
    board[a[0]][a[1]] = piece;
    const sa = evaluateBoard(board, BOT, PLAYER, winLen);
    board[a[0]][a[1]] = EMPTY;
    board[b[0]][b[1]] = piece;
    const sb = evaluateBoard(board, BOT, PLAYER, winLen);
    board[b[0]][b[1]] = EMPTY;
    if (sa !== sb) return sb - sa;
    const center = Math.floor(size / 2);
    const da = Math.abs(a[0] - center) + Math.abs(a[1] - center);
    const db = Math.abs(b[0] - center) + Math.abs(b[1] - center);
    return da - db;
  });
}

function negamax(board, size, winLen, side, depth, maxDepth, deadline) {
  const key = boardKey(board, size) + side;
  if (ttDepth.has(key) && ttDepth.get(key) >= maxDepth - depth) return transTable.get(key);
  if (checkWinner(board, winLen)) return -1;
  if (isFull(board)) return 0;
  if (depth >= maxDepth) {
    const h = evaluateBoard(board, BOT, PLAYER, winLen);
    const scaled = Math.tanh(h / 2000);
    return side === 0 ? scaled : -scaled;
  }
  if (Date.now() > deadline) { searchAborted = true; return 0; }
  const avail = getAvailable(board, true);
  if (avail.length === 0) return 0;
  const piece = side === 0 ? BOT : PLAYER;
  orderMoves(board, avail, piece, size, winLen);
  let best = -Infinity;
  let nodeAborted = false;
  for (const [r, c] of avail) {
    if (Date.now() > deadline) { searchAborted = true; nodeAborted = true; break; }
    board[r][c] = piece;
    const val = -negamax(board, size, winLen, 1 - side, depth + 1, maxDepth, deadline);
    board[r][c] = EMPTY;
    if (val > best) best = val;
    if (best >= 1) break;
  }
  if (best === -Infinity) best = 0;
  if (!nodeAborted) {
    transTable.set(key, best);
    ttDepth.set(key, maxDepth - depth);
  }
  return best;
}

function botMove(board, botPiece, playerPiece, winLen) {
  let instant = findInstantWin(board, botPiece, winLen);
  if (instant) return instant;
  instant = findInstantWin(board, playerPiece, winLen);
  if (instant) return instant;

  const size = board.length;
  if (isEmptyBoard(board)) return [Math.floor(size / 2), Math.floor(size / 2)];

  const avail = getAvailable(board, true);
  orderMoves(board, avail, botPiece, size, winLen);

  const deadline = Date.now() + MOVE_TIME_LIMIT;
  const remaining = avail.length;
  let bestMove = avail[0];

  for (let maxDepth = 1; maxDepth <= remaining; maxDepth++) {
    if (Date.now() > deadline) break;
    searchAborted = false;
    let iterBest = -Infinity;
    let iterMove = null;
    for (const [r, c] of avail) {
      if (Date.now() > deadline) { searchAborted = true; break; }
      board[r][c] = botPiece;
      const val = -negamax(board, size, winLen, 1, 1, maxDepth, deadline);
      board[r][c] = EMPTY;
      if (val > iterBest) { iterBest = val; iterMove = [r, c]; }
      if (iterBest >= 1) break;
    }
    if (!searchAborted && iterMove) bestMove = iterMove;
    if (!searchAborted && (iterBest >= 1 || maxDepth >= remaining)) break;
  }
  return bestMove;
}

const games = {};

function saveToDisk() {
  const data = {};
  for (const [uid, g] of Object.entries(games)) {
    data[uid] = { id: uid, gameId: g.gameId, userId: g.userId, channelId: g.channelId, mode: 'ai', boardMsgId: g.boardMsgId, controlMsgId: g.controlMsgId, timestamp: Date.now(), board: g.board, size: g.size };
  }
  for (const [gid, g] of Object.entries(pvpGames)) {
    data[gid] = { id: gid, gameId: gid, p1: g.p1, p2: g.p2, channelId: g.channelId, mode: 'pvp', boardMsgId: g.boardMsgId, controlMsgId: g.controlMsgId, timestamp: Date.now(), turn: g.turn, board: g.board, size: g.size };
  }
  jsonCache.writeJSON(activeGamesPath, data);
}

function userHasActiveGame(userId) {
  if (games[userId]) return true;
  for (const g of Object.values(pvpGames)) {
    if (g.p1 === userId || g.p2 === userId) return true;
  }
  return false;
}

function hasActiveGame(customId) {
  for (const [uid, g] of Object.entries(games)) {
    if (customId.includes(g.gameId)) return true;
  }
  for (const [gid, g] of Object.entries(pvpGames)) {
    if (customId.includes(gid)) return true;
  }
  return false;
}

function cleanStaleGames() {
  const data = jsonCache.readJSONObject(activeGamesPath);
  for (const key of Object.keys(data)) {
    if (!games[key] && !pvpGames[key]) delete data[key];
  }
  jsonCache.writeJSON(activeGamesPath, data);
}

function cancelGame(customId) {
  for (const [uid, g] of Object.entries(games)) {
    if (customId.includes(g.gameId)) {
      delete games[uid];
      saveToDisk();
      return true;
    }
  }
  for (const [gid, g] of Object.entries(pvpGames)) {
    if (customId.includes(gid)) {
      delete pvpGames[gid];
      saveToDisk();
      return true;
    }
  }
  return false;
}

function getEndRow(channelId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`caro_replay_${channelId}`).setLabel('Chơi Caro ❌⭕').setStyle(ButtonStyle.Primary)
  );
}

async function startGame(interaction, client, size = 5) {
  const userId = interaction.user.id;
  const channelId = interaction.channel.id;

  if (userHasActiveGame(userId)) {
    return interaction.reply({ content: '❌ Bạn đang có game đang chơi!', flags: 64 });
  }

  const board = createBoard(size);
  const gameId = `${userId}_${Date.now()}`;
  const botPiece = BOT;
  const playerPiece = PLAYER;
  const winLen = getWinLen(size);

  games[userId] = { board, gameId, userId, botPiece, playerPiece, channelId, size, winLen };

  let firstTurn = Math.random() < 0.5 ? 'player' : 'bot';
  if (firstTurn === 'bot') {
    const center = Math.floor(size / 2);
    board[center][center] = botPiece;
  }

  const embed = new EmbedBuilder()
    .setTitle(`🎮 Caro ${size}x${size}`)
    .setDescription(firstTurn === 'player' ? 'Lượt bạn (❌)' : 'Lượt Bot (⭕)')
    .setColor(0x5865F2);

  await interaction.reply({
    embeds: [embed],
    components: boardToButtons(board, gameId)
  });
  const boardMsg = await interaction.fetchReply();

  const cancelRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`ttt_cancel_${gameId}`).setLabel('❌ Hủy trận').setStyle(ButtonStyle.Danger)
  );
  const cancelMsg = await interaction.channel.send({ content: '🎮 Điều khiển trận đấu:', components: [cancelRow] });

  games[userId].boardMsgId = boardMsg.id;
  games[userId].controlMsgId = cancelMsg.id;
  saveToDisk();

  await _attachAICollectors(boardMsg, cancelMsg, games[userId]);
}

const pvpGames = {};

async function startPlayerGame(owner, opponentId, channel, revokeAccess, size = 5) {
  const board = createBoard(size);
  const gameId = `pvp_${owner.id}_${opponentId}_${Date.now()}`;
  const p1Piece = PLAYER;
  const p2Piece = P2;
  const winLen = getWinLen(size);
  let turn = Math.random() < 0.5 ? opponentId : owner.id;

  pvpGames[gameId] = { board, gameId, p1: owner.id, p2: opponentId, turn, revokeAccess, channelId: channel.id, size, winLen };

  const firstName = turn === owner.id ? (owner.user.globalName || owner.user.username) : `<@${turn}>`;
  const firstPiece = turn === owner.id ? p1Piece : p2Piece;

  let embed = new EmbedBuilder()
    .setTitle(`🎮 Caro ${size}x${size} PvP`)
    .setDescription(`Lượt ${firstName} (${firstPiece})`)
    .setColor(0x5865F2);

  const boardMsg = await channel.send({ embeds: [embed], components: boardToButtons(board, gameId) });

  const controlRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`ttt_pvp_cancel_${gameId}`).setLabel('❌ Hủy trận').setStyle(ButtonStyle.Danger)
  );
  const controlMsg = await channel.send({ content: '🎮 Điều khiển trận đấu:', components: [controlRow] });

  pvpGames[gameId].boardMsgId = boardMsg.id;
  pvpGames[gameId].controlMsgId = controlMsg.id;
  saveToDisk();

  await _attachPvPCollectors(boardMsg, controlMsg, pvpGames[gameId]);
}

async function _attachAICollectors(boardMsg, cancelMsg, state) {
  const { userId, gameId, channelId, board, botPiece, playerPiece, winLen, size } = state;

  const boardCollector = boardMsg.createMessageComponentCollector({ time: 0 });
  const cancelCollector = cancelMsg.createMessageComponentCollector({ time: 0 });

  function makeEndEmbed(title, desc, color) {
    return new EmbedBuilder().setTitle(title).setDescription(desc).setColor(color);
  }

  async function cleanup() {
    delete games[userId];
    saveToDisk();
    boardCollector.stop();
    cancelCollector.stop();
  }

  async function endGame(sourceInteraction, resultEmbed) {
    try {
      const finalEmbed = EmbedBuilder.from(resultEmbed)
        .setDescription(resultEmbed.data.description || '');
      await boardMsg.edit({ embeds: [finalEmbed], components: boardToButtons(board, gameId, true) }).catch(() => {});
      await cancelMsg.delete().catch(() => {});
      await sourceInteraction.deferUpdate().catch(() => {});
      const ch = sourceInteraction.channel;
      if (ch) {
        await ch.send({ components: [getEndRow(channelId)] }).catch(() => {});
      }
    } finally {
      await cleanup();
    }
  }

  boardCollector.on('collect', async (i) => {
    try {
      try { await i.deferUpdate(); } catch (e) { return; }

      if (i.user.id !== userId) return i.followUp({ content: '❌ Không phải game của bạn!', flags: 64 }).catch(() => {});

      const parts = i.customId.split('_');
      const [r, c] = [parseInt(parts[3]), parseInt(parts[4])];

      if (board[r][c] !== EMPTY) return i.followUp({ content: '❌ Ô này đã đánh rồi!', flags: 64 }).catch(() => {});

      board[r][c] = playerPiece;

      let win = checkWinner(board, winLen);
      if (win) {
        await endGame(i, makeEndEmbed(`🎮 Caro ${size}x${size} - BẠN THẮNG!`, 'Xin chúc mừng! 🎉', 0x00FF00));
        return;
      }

      if (isFull(board)) {
        await endGame(i, makeEndEmbed(`🎮 Caro ${size}x${size} - HÒA!`, 'Hai bên hòa nhau!', 0xFFA500));
        return;
      }

      const thinkingEmbed = new EmbedBuilder()
        .setTitle(`🎮 Caro ${size}x${size}`)
        .setDescription('Bot đang suy nghĩ... 🤖')
        .setColor(0x5865F2);
      await i.editReply({ embeds: [thinkingEmbed], components: boardToButtons(board, gameId, true) });

      const move = botMove(board, botPiece, playerPiece, winLen);
      if (move) {
        const [br, bc] = move;
        board[br][bc] = botPiece;
      }

      win = checkWinner(board, winLen);
      if (win) {
        await endGame(i, makeEndEmbed(`🎮 Caro ${size}x${size} - BOT THẮNG!`, 'Bot thắng! 🤖', 0xFF0000));
        return;
      }

      if (isFull(board)) {
        await endGame(i, makeEndEmbed(`🎮 Caro ${size}x${size} - HÒA!`, 'Hai bên hòa nhau!', 0xFFA500));
        return;
      }

      const turnEmbed = new EmbedBuilder()
        .setTitle(`🎮 Caro ${size}x${size}`)
        .setDescription('Lượt bạn (❌)')
        .setColor(0x5865F2);

      await i.editReply({ embeds: [turnEmbed], components: boardToButtons(board, gameId) });
    } catch (e) { /* interaction expired */ }
  });

  cancelCollector.on('collect', async (i) => {
    try {
      if (i.user.id !== userId) {
        await i.followUp({ content: '❌ Không phải game của bạn!', flags: 64 }).catch(() => {});
        return;
      }
      await endGame(i, makeEndEmbed(`🎮 Caro ${size}x${size}`, 'Đã hủy trận!', 0xFF0000));
    } catch (e) { /* interaction expired */ }
  });

  boardCollector.on('end', () => {
    if (games[userId]) cleanup();
  });

  cancelCollector.on('end', () => {
    if (games[userId]) cleanup();
  });
}

async function _attachPvPCollectors(boardMsg, controlMsg, state) {
  const { gameId, channelId, board, winLen, size } = state;

  const boardCollector = boardMsg.createMessageComponentCollector({ time: 0 });
  const controlCollector = controlMsg.createMessageComponentCollector({ time: 0 });

  function makeEndEmbed(title, desc, color) {
    return new EmbedBuilder().setTitle(title).setDescription(desc).setColor(color);
  }

  function cleanup() {
    delete pvpGames[gameId];
    saveToDisk();
    boardCollector.stop();
    controlCollector.stop();
  }

  async function endGame(sourceInteraction, resultEmbed) {
    try {
      const finalEmbed = EmbedBuilder.from(resultEmbed)
        .setDescription(resultEmbed.data.description || '');
      await boardMsg.edit({ embeds: [finalEmbed], components: boardToButtons(board, gameId, true) }).catch(() => {});
      await controlMsg.delete().catch(() => {});
      await sourceInteraction.deferUpdate().catch(() => {});
      const ch = sourceInteraction.channel;
      if (ch) {
        await ch.send({ components: [getEndRow(channelId)] }).catch(() => {});
      }
      if (state.revokeAccess) await state.revokeAccess();
    } finally {
      cleanup();
    }
  }

  boardCollector.on('collect', async (i) => {
    try {
      await i.deferUpdate();

      const parts = i.customId.split('_');
      const gid = parts.slice(1, -2).join('_');
      if (gid !== gameId) return;
      const game = pvpGames[gameId];
      if (!game) return;

      if (i.user.id !== game.turn) {
        await i.followUp({ content: '❌ Chưa tới lượt bạn!', flags: 64 }).catch(() => {});
        return;
      }
      if (i.user.id !== game.p1 && i.user.id !== game.p2) {
        await i.followUp({ content: '❌ Bạn không trong trận đấu này!', flags: 64 }).catch(() => {});
        return;
      }

      const [r, c] = [parseInt(parts[parts.length - 2]), parseInt(parts[parts.length - 1])];
      if (board[r][c] !== EMPTY) {
        await i.followUp({ content: '❌ Ô này đã đánh rồi!', flags: 64 }).catch(() => {});
        return;
      }

      const p1Piece = PLAYER;
      const p2Piece = P2;
      const piece = i.user.id === game.p1 ? p1Piece : p2Piece;
      board[r][c] = piece;

      const win = checkWinner(board, winLen);
      if (win) {
        const winnerName = i.user.id === game.p1 ? `<@${game.p1}>` : `<@${i.user.id}>`;
        await endGame(i, makeEndEmbed(`🎮 Caro ${size}x${size} PvP`, `${winnerName} THẮNG! 🎉`, 0x00FF00));
        return;
      }

      if (isFull(board)) {
        await endGame(i, makeEndEmbed(`🎮 Caro ${size}x${size} PvP`, 'Hai bên hòa nhau!', 0xFFA500));
        return;
      }

      game.turn = game.turn === game.p1 ? game.p2 : game.p1;
      const nextName = game.turn === game.p1 ? `<@${game.p1}>` : `<@${game.turn}>`;

      const embed = new EmbedBuilder()
        .setTitle(`🎮 Caro ${size}x${size} PvP`)
        .setDescription(`Lượt ${nextName} (${piece === p1Piece ? p2Piece : p1Piece})`)
        .setColor(0x5865F2);

      await i.editReply({ embeds: [embed], components: boardToButtons(board, gameId) });
    } catch (e) { /* interaction expired */ }
  });

  controlCollector.on('collect', async (i) => {
    try {
      const game = pvpGames[gameId];
      if (!game) return;
      if (i.user.id !== game.p1) {
        await i.followUp({ content: '❌ Chỉ chủ kênh mới được hủy trận!', flags: 64 }).catch(() => {});
        return;
      }
      await endGame(i, makeEndEmbed(`🎮 Caro ${size}x${size} PvP`, 'Đã hủy trận!', 0xFF0000));
    } catch (e) { /* interaction expired */ }
  });

  boardCollector.on('end', () => {
    if (pvpGames[gameId]) {
      if (state.revokeAccess) state.revokeAccess();
      cleanup();
    }
  });

  controlCollector.on('end', () => {
    if (pvpGames[gameId]) {
      if (state.revokeAccess) state.revokeAccess();
      cleanup();
    }
  });
}

async function restoreGames(client) {
  const data = jsonCache.readJSONObject(activeGamesPath);
  const entries = Object.entries(data);
  if (entries.length === 0) return;
  let restored = 0;

  for (const [key, entry] of entries) {
    try {
      const channel = await client.channels.fetch(entry.channelId);
      if (entry.mode === 'ai') {
        const boardMsg = await channel.messages.fetch(entry.boardMsgId);
        const cancelMsg = await channel.messages.fetch(entry.controlMsgId);

        const size = entry.size || 5;
        const winLen = getWinLen(size);
        const board = entry.board || createBoard(size);
        games[key] = {
          board, gameId: entry.gameId || key, userId: entry.userId || key,
          botPiece: BOT, playerPiece: PLAYER, size, winLen,
          channelId: entry.channelId, boardMsgId: entry.boardMsgId, controlMsgId: entry.controlMsgId
        };

        await _attachAICollectors(boardMsg, cancelMsg, games[key]);
        restored++;
      } else if (entry.mode === 'pvp') {
        const boardMsg = await channel.messages.fetch(entry.boardMsgId);
        const controlMsg = await channel.messages.fetch(entry.controlMsgId);

        const size = entry.size || 5;
        const winLen = getWinLen(size);
        const board = entry.board || createBoard(size);
        const revokeAccess = entry.p2 ? (async () => {
          try { await channel.permissionOverwrites.delete(entry.p2); } catch {}
        }) : null;

        pvpGames[key] = {
          board, gameId: key, p1: entry.p1, p2: entry.p2, turn: entry.turn || entry.p1,
          revokeAccess, channelId: entry.channelId, size, winLen,
          boardMsgId: entry.boardMsgId, controlMsgId: entry.controlMsgId
        };

        await _attachPvPCollectors(boardMsg, controlMsg, pvpGames[key]);
        restored++;
      }
    } catch (e) {
      console.error(`[Restore] Lỗi khôi phục game ${key}: ${e.message}`);
      delete data[key];
    }
  }

  jsonCache.writeJSON(activeGamesPath, data);
  if (restored > 0) console.log(`[Restore] Đã khôi phục ${restored} trận đấu`);
}

module.exports = { startGame, startPlayerGame, cleanStaleGames, hasActiveGame, userHasActiveGame, cancelGame, restoreGames, botMove };
