const { joinVoiceChannel, createAudioPlayer, createAudioResource, AudioPlayerStatus, VoiceConnectionStatus, entersState, StreamType } = require('@discordjs/voice');
const { spawn } = require('child_process');
const { PassThrough } = require('stream');
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

const players = new Map();
const MAX_CONCURRENT_DLP = 4;
let dlpCount = 0;
const dlpQueue = [];

function runDlp(args) {
  return new Promise((resolve, reject) => {
    const exec = () => {
      dlpCount++;
      const proc = spawn('yt-dlp', args);
      const chunks = [];
      const errChunks = [];
      proc.stdout.on('data', d => chunks.push(d));
      proc.stderr.on('data', d => errChunks.push(d));
      proc.on('error', e => { dlpCount--; processQueue(); reject(e); });
      proc.on('close', code => {
        dlpCount--; processQueue();
        const out = Buffer.concat(chunks).toString().trim();
        const err = Buffer.concat(errChunks).toString().trim();
        if (code === 0 && out) resolve(out);
        else reject(new Error('yt-dlp: ' + (out || err)));
      });
    };
    if (dlpCount < MAX_CONCURRENT_DLP) exec();
    else dlpQueue.push(exec);
  });
}

function processQueue() {
  while (dlpQueue.length > 0 && dlpCount < MAX_CONCURRENT_DLP) {
    dlpQueue.shift()();
  }
}

async function getVideoInfo(url) {
  const args = ['--dump-json', '--no-warnings', '--no-check-certificate', '--extractor-retries', '1', url];
  const json = await runDlp(args);
  const data = JSON.parse(json.split('\n')[0]);
  return {
    title: data.title || 'Không rõ',
    thumbnail: data.thumbnail || '',
    duration: data.duration || 0,
    channel: data.channel || data.uploader || 'Không rõ',
    url: data.webpage_url || url,
    isLive: data.is_live || false,
  };
}

function formatDuration(sec) {
  if (!sec || sec <= 0) return '?';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function getPlayer(guildId) {
  let entry = players.get(guildId);
  if (!entry) {
    const player = createAudioPlayer();
    entry = {
      player, connection: null, queue: [],
      currentIndex: -1, loop: false, volume: 1,
      currentResource: null, textChannel: null, uiMessage: null, nowPlayingMsg: null, vidMsg: null,
    };
    player.on('error', e => console.error('[AudioPlayer] Error:', e.message));
    player.on(AudioPlayerStatus.Idle, () => {
      const nextIdx = entry.loop ? entry.currentIndex : entry.currentIndex + 1;
      if (nextIdx >= 0 && nextIdx < entry.queue.length) {
        entry.currentIndex = nextIdx;
        playTrack(entry).catch(e => console.error('[Idle] playTrack error:', e));
      }
    });
    players.set(guildId, entry);
  }
  return entry;
}

async function ensureConnection(interaction, entry) {
  if (entry.connection && entry.connection.state.status === VoiceConnectionStatus.Ready
    && entry.connection.joinConfig.channelId === interaction.member.voice.channel.id) {
    return entry.connection;
  }
  if (entry.connection) entry.connection.destroy();
  const connection = joinVoiceChannel({
    channelId: interaction.member.voice.channel.id,
    guildId: interaction.guild.id,
    adapterCreator: interaction.guild.voiceAdapterCreator,
    selfDeaf: false, selfMute: false,
  });
  connection.on('error', e => console.error('[Voice] Error:', e));
  try {
    await entersState(connection, VoiceConnectionStatus.Ready, 20_000);
    connection.subscribe(entry.player);
    entry.connection = connection;
    return connection;
  } catch (e) {
    console.error('[Voice] Connection timeout:', e);
    connection.destroy();
    throw new Error('Không thể kết nối voice channel sau 20s');
  }
}

async function sendNowPlaying(entry) {
  const item = entry.queue[entry.currentIndex];
  if (!item || !item.info || !entry.textChannel) return;
  const info = item.info;
  const desc = `🎬 **${info.title}**\n📺 ${info.channel} | ⏱ ${formatDuration(info.duration)}`;
  const embed = new EmbedBuilder()
    .setTitle('🎬 RẠP CHIẾU PHIM')
    .setDescription(desc)
    .setColor(0x00FF00)
    .setImage(info.thumbnail || null)
    .setFooter({ text: `#${entry.currentIndex + 1}/${entry.queue.length}` });
  try {
    if (entry.nowPlayingMsg) {
      await entry.nowPlayingMsg.edit({ embeds: [embed] }).catch(() => {});
    } else {
      entry.nowPlayingMsg = await entry.textChannel.send({ embeds: [embed] });
    }
    if (entry.vidMsg) {
      await entry.vidMsg.edit({ content: info.url }).catch(() => {});
    } else {
      entry.vidMsg = await entry.textChannel.send({ content: info.url });
    }
  } catch {}
}

async function playTrack(entry) {
  if (entry.currentIndex < 0 || entry.currentIndex >= entry.queue.length) return;
  const item = entry.queue[entry.currentIndex];
  try {
    let stream;
    if (item.stream) {
      stream = item.stream;
    } else {
      const proc = spawn('yt-dlp', [
        '--format', 'bestaudio/best',
        '--output', '-',
        '--quiet', '--no-warnings', '--no-check-certificate',
        '--extractor-retries', '1',
        item.videoUrl
      ]);
      proc.stderr.on('data', () => {});
      proc.on('error', e => {
        console.error('[yt-dlp] process error:', e);
        if (entry.textChannel) entry.textChannel.send('❌ Lỗi tải nhạc!').catch(() => {});
      });
      stream = proc.stdout;
      item.proc = proc;
    }

    const resource = createAudioResource(stream, { inputType: StreamType.Arbitrary, inlineVolume: true });
    resource.volume.setVolume(entry.volume);
    entry.currentResource = resource;
    entry.player.play(resource);

    await sendNowPlaying(entry);

    const nextIdx = entry.currentIndex + 1;
    if (nextIdx < entry.queue.length && !entry.queue[nextIdx].stream) {
      startStream(entry.queue[nextIdx]);
    }
  } catch (e) {
    console.error('[playTrack] Error:', e);
    if (entry.textChannel) entry.textChannel.send('❌ Lỗi phát nhạc: ' + e.message).catch(() => {});
  }
}

function startStream(item) {
  if (item.proc || item.stream) return;
  const proc = spawn('yt-dlp', [
    '--format', 'bestaudio/best',
    '--output', '-',
    '--quiet', '--no-warnings', '--no-check-certificate',
    '--extractor-retries', '1',
    item.videoUrl
  ]);
  const passthrough = new PassThrough();
  proc.stdout.pipe(passthrough);
  proc.stderr.on('data', () => {});
  proc.on('error', () => {});
  proc.on('close', () => { passthrough.destroy(); });
  item.proc = proc;
  item.stream = passthrough;
}

async function playMusic(interaction, url) {
  if (!url || typeof url !== 'string') {
    return interaction.editReply({ content: '❌ URL không hợp lệ!' });
  }
  const member = interaction.member;
  if (!member.voice.channel) {
    return interaction.editReply({ content: '❌ Bạn phải ở trong kênh voice để phát nhạc!' });
  }
  const guildId = interaction.guild.id;
  const entry = getPlayer(guildId);
  entry.textChannel = interaction.channel;
  entry.guildId = guildId;

  await interaction.editReply({ content: '⏳ Đang tải thông tin video...' });

  let info;
  try {
    info = await getVideoInfo(url);
  } catch (e) {
    return interaction.editReply({ content: '❌ Không thể lấy thông tin video: ' + e.message });
  }

  const item = { videoUrl: url, proc: null, stream: null, info };
  entry.queue.push(item);

  try {
    await ensureConnection(interaction, entry);
  } catch (e) {
    return interaction.editReply({ content: '❌ ' + e.message });
  }

  if (entry.player.state.status === AudioPlayerStatus.Idle && entry.currentIndex < 0) {
    entry.currentIndex = entry.queue.length - 1;
    await interaction.editReply({ content: `⏳ Đang phát: **${info.title}**` });
    await playTrack(entry);
  } else {
    await interaction.editReply({ content: `✅ **${info.title}** đã thêm vào hàng chờ (vị trí #${entry.queue.length})` });
  }
}

function buildControls(entry) {
  const isPaused = entry.player.state.status === AudioPlayerStatus.Paused;
  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('music_add_url').setLabel('🎵 Nhập URL').setStyle(ButtonStyle.Primary)
  );
  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('music_playpause').setLabel(isPaused ? '▶️ Play' : '⏸ Pause').setStyle(isPaused ? ButtonStyle.Success : ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('music_stop').setLabel('⏹ Stop').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId('music_loop').setLabel('🔁 Loop').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('music_volume').setLabel('🔊 Volume').setStyle(ButtonStyle.Secondary)
  );
  return [row1, row2];
}

async function updateUI(entry) {
  if (!entry.uiMessage) return;
  try {
    const item = entry.queue[entry.currentIndex];
    let desc;
    if (item && item.info) {
      const info = item.info;
      desc = `🎶 Đang phát: **${info.title}**\n📺 ${info.channel} | ⏱ ${formatDuration(info.duration)}\n🔗 ${info.url}`;
    } else {
      desc = 'Nhấn **🎵 Nhập URL** để nhập link hoặc dùng nút điều khiển.';
    }
    const embed = new EmbedBuilder()
      .setTitle('🎵 MUSIC PLAYER')
      .setDescription(desc)
      .setColor(0x5865F2)
      .setFooter({ text: `Hàng chờ: ${entry.queue.length} bài` });
    await entry.uiMessage.edit({ embeds: [embed], components: buildControls(entry) });
  } catch {}
}

async function pause(interaction) {
  const entry = players.get(interaction.guild.id);
  if (!entry || !entry.player) {
    return interaction.reply({ content: '❌ Không có nhạc đang phát!', flags: 64 });
  }
  const isPaused = entry.player.state.status === AudioPlayerStatus.Paused;
  if (isPaused) {
    entry.player.unpause();
    await interaction.reply({ content: '▶️ Đã tiếp tục!', flags: 64 });
  } else {
    entry.player.pause();
    await interaction.reply({ content: '⏸ Đã tạm dừng!', flags: 64 });
  }
  await updateUI(entry);
}

async function stop(interaction) {
  const entry = players.get(interaction.guild.id);
  if (!entry) {
    return interaction.reply({ content: '❌ Không có nhạc đang phát!', flags: 64 });
  }
  for (const item of entry.queue) {
    if (item.proc) { try { item.proc.kill(); } catch {} }
  }
  entry.player.stop(true);
  entry.queue = [];
  entry.currentIndex = -1;
  entry.currentResource = null;
  if (entry.nowPlayingMsg) {
    try { await entry.nowPlayingMsg.delete(); } catch {}
    entry.nowPlayingMsg = null;
  }
  if (entry.vidMsg) {
    try { await entry.vidMsg.delete(); } catch {}
    entry.vidMsg = null;
  }
  if (entry.connection) {
    entry.connection.destroy();
    entry.connection = null;
  }
  players.delete(interaction.guild.id);
  await interaction.reply({ content: '⏹ Đã dừng và thoát kênh voice!', flags: 64 });
}

async function toggleLoop(interaction) {
  const entry = players.get(interaction.guild.id);
  if (!entry) {
    return interaction.reply({ content: '❌ Không có nhạc đang phát!', flags: 64 });
  }
  entry.loop = !entry.loop;
  await interaction.reply({ content: `🔁 Loop ${entry.loop ? 'BẬT' : 'TẮT'}!`, flags: 64 });
}

async function setVolume(interaction) {
  const entry = players.get(interaction.guild.id);
  if (!entry) {
    return interaction.reply({ content: '❌ Không có nhạc đang phát!', flags: 64 });
  }
  const value = interaction.fields.getTextInputValue('music_volume');
  const vol = parseInt(value, 10);
  if (isNaN(vol) || vol < 0 || vol > 100) {
    return interaction.reply({ content: '❌ Âm lượng phải từ 0 đến 100!', flags: 64 });
  }
  entry.volume = vol / 100;
  if (entry.currentResource && entry.currentResource.volume) {
    entry.currentResource.volume.setVolume(entry.volume);
  }
  await interaction.reply({ content: `🔊 Âm lượng đã chỉnh về ${vol}%!`, flags: 64 });
}

async function sendMusicUI(message) {
  const guildId = message.guild.id;
  const entry = getPlayer(guildId);
  entry.textChannel = message.channel;
  entry.guildId = guildId;

  const item = entry.queue[entry.currentIndex];
  let desc;
  if (item && item.info) {
    const info = item.info;
    desc = `🎶 Đang phát: **${info.title}**\n📺 ${info.channel} | ⏱ ${formatDuration(info.duration)}\n🔗 ${info.url}`;
  } else {
    desc = 'Nhấn **🎵 Nhập URL** để nhập link hoặc dùng nút điều khiển.';
  }
  const embed = new EmbedBuilder()
    .setTitle('🎵 MUSIC PLAYER')
    .setDescription(desc)
    .setColor(0x5865F2)
    .setFooter({ text: `Hàng chờ: ${entry.queue.length} bài` });
  const sent = await message.reply({ embeds: [embed], components: buildControls(entry) });
  entry.uiMessage = sent;
}

module.exports = { sendMusicUI, playMusic, pause, stop, toggleLoop, setVolume, getPlayer };
