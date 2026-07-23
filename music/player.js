const { joinVoiceChannel, createAudioPlayer, createAudioResource, AudioPlayerStatus, VoiceConnectionStatus, entersState, StreamType } = require('@discordjs/voice');
const { mkStream, meta } = require('./stream');
const { ui } = require('./ui');
const data = require('./data');

const players = new Map();

async function restoreQueue(guildId, e) {
  const urls = data.loadQueue(guildId);
  if (!urls.length) return;
  const saved = data.loadSettings(guildId);
  e.vol = saved.vol ?? 1;
  e.loop = saved.loop ?? false;
  for (const url of urls) {
    e.queue.push({ url, stream: null, info: data.getCachedMeta(url) || null });
  }
}

function getPlayer(gid) {
  let e = players.get(gid);
  if (!e) {
    const p = createAudioPlayer();
    e = { player: p, connection: null, queue: [], i: -1, loop: false, vol: 1, res: null, tc: null, ui: null, _stopped: false, _retryCount: 0, _trackEnded: false, guildId: gid };
    p.on('error', er => console.error('[AP] Error:', er.message));
    p.on(AudioPlayerStatus.Idle, () => {
      if (e._stopped || !e.queue.length) { e._stopped = false; return; }
      const n = e.loop ? e.i : e.i + 1;
      if (e.i >= 0 && e.i < e.queue.length && !e._trackEnded && e._retryCount < 1) {
        e._retryCount++;
        console.log('[Idle] Track stalled, retrying...');
        play(e).catch(er => console.error('[Idle-Retry]', er));
        return;
      }
      e._retryCount = 0;
      if (n >= 0 && n < e.queue.length) { e.i = n; persistQueue(e, e.guildId); play(e).catch(er => console.error('[Idle]', er)); }
    });
    players.set(gid, e);
    restoreQueue(gid, e);
  }
  return e;
}

function preload(e) {
  const n = e.loop ? e.i : e.i + 1;
  if (n >= 0 && n < e.queue.length && !e.queue[n].stream) {
    const next = e.queue[n];
    if (!next.stream) next.stream = mkStream(next.url);
  }
  const n2 = e.loop ? e.i : e.i + 2;
  if (n2 >= 0 && n2 < e.queue.length && !e.queue[n2].stream) {
    const next = e.queue[n2];
    if (!next.stream) next.stream = mkStream(next.url);
  }
}

async function ensureConn(interaction, e) {
  if (e.connection?.state.status === VoiceConnectionStatus.Ready && e.connection.joinConfig.channelId === interaction.member.voice.channel.id) return e.connection;
  if (e.connection) e.connection.destroy();
  const c = joinVoiceChannel({ channelId: interaction.member.voice.channel.id, guildId: interaction.guild.id, adapterCreator: interaction.guild.voiceAdapterCreator, selfDeaf: false, selfMute: false });
  c.on('error', er => console.error('[VC] Error:', er));
  try {
    await entersState(c, VoiceConnectionStatus.Ready, 10_000);
    c.subscribe(e.player); e.connection = c; return c;
  } catch { c.destroy(); throw new Error('Không thể vào voice'); }
}

async function persistQueue(e, guildId) {
  const urls = e.queue.filter(q => q.url).map(q => q.url);
  data.saveQueue(guildId, urls);
}

async function play(e) {
  if (e.i < 0 || e.i >= e.queue.length) return;
  const item = e.queue[e.i];
  try {
    const s = item.stream || mkStream(item.url); item.stream = null;
    e._trackEnded = false;
    s.once('end', () => { e._trackEnded = true; });
    const r = createAudioResource(s, { inputType: StreamType.Arbitrary, inlineVolume: true });
    r.volume.setVolume(e.vol); e.res = r;
    e.player.play(r);
    preload(e);
    ui(e).catch(() => {});
  } catch (er) { console.error('[play]', er); e.tc?.send('❌ ' + er.message).catch(() => {}); preload(e); }
}

async function playMusic(interaction, url) {
  if (!url || typeof url !== 'string') return interaction.editReply({ content: '❌ URL không hợp lệ!' });
  if (!interaction.member.voice.channel) return interaction.editReply({ content: '❌ Bạn phải ở trong voice!' });
  const e = getPlayer(interaction.guild.id);
  e.tc = interaction.channel;

  await interaction.editReply({ content: '⏳ Đang xử lý...' });

  const s = mkStream(url);

  try { await ensureConn(interaction, e); }
  catch (er) { s.destroy(); return interaction.editReply({ content: '❌ ' + er.message }); }

  e.queue.push({ url, stream: s, info: null });

  if (e.player.state.status === AudioPlayerStatus.Idle && e.i < 0) {
    e.i = e.queue.length - 1;
    await play(e);
    meta(url).then(info => {
      const idx = e.queue.findIndex(q => q.url === url);
      if (idx >= 0) { e.queue[idx].info = info; ui(e).catch(() => {}); }
    });
  } else {
    await interaction.editReply({ content: `✅ Đã thêm vào hàng chờ (#${e.queue.length})` });
  }

  persistQueue(e, interaction.guild.id);
}

async function pause(interaction) {
  const e = players.get(interaction.guild.id);
  if (!e?.player) { await interaction.deferUpdate(); return interaction.followUp({ content: '❌ Không có nhạc!', flags: 64 }); }
  await interaction.deferUpdate();
  if (e.player.state.status === AudioPlayerStatus.Paused) { e.player.unpause(); await interaction.followUp({ content: '▶️', flags: 64 }); }
  else { e.player.pause(); await interaction.followUp({ content: '⏸', flags: 64 }); }
  await ui(e);
}

async function stop(interaction) {
  const e = players.get(interaction.guild.id);
  if (!e) { await interaction.deferUpdate(); return interaction.followUp({ content: '❌ Không có nhạc!', flags: 64 }); }
  await interaction.deferUpdate();
  e._stopped = true;
  e.player.stop(true); e.queue = []; e.i = -1; e.res = null;
  if (e.connection) { e.connection.destroy(); e.connection = null; }
  players.delete(interaction.guild.id);
  data.clearQueue(interaction.guild.id);
  await interaction.followUp({ content: '⏹ Đã dừng!', flags: 64 });
}

async function toggleLoop(interaction) {
  const e = players.get(interaction.guild.id);
  if (!e) { await interaction.deferUpdate(); return interaction.followUp({ content: '❌ Không có nhạc!', flags: 64 }); }
  await interaction.deferUpdate();
  e.loop = !e.loop;
  data.saveSettings(interaction.guild.id, { vol: e.vol, loop: e.loop });
  await interaction.followUp({ content: `🔁 Loop ${e.loop ? 'BẬT' : 'TẮT'}!`, flags: 64 });
}

async function setVolume(interaction) {
  const e = players.get(interaction.guild.id);
  if (!e) return interaction.reply({ content: '❌ Không có nhạc!', flags: 64 });
  const v = parseInt(interaction.fields.getTextInputValue('music_volume'), 10);
  if (isNaN(v) || v < 0 || v > 100) return interaction.reply({ content: '❌ Âm lượng từ 0-100!', flags: 64 });
  e.vol = v / 100;
  if (e.res?.volume) e.res.volume.setVolume(e.vol);
  data.saveSettings(interaction.guild.id, { vol: e.vol, loop: e.loop });
  await interaction.reply({ content: `🔊 ${v}%!`, flags: 64 });
}

module.exports = { players, getPlayer, playMusic, pause, stop, toggleLoop, setVolume, play, preload, ensureConn };
