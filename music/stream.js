const { spawn } = require('child_process');
const { PassThrough } = require('stream');
const cache = require('./data');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36';
const BUFFER_SIZE = 512 * 1024;
const SPAWN_TIMEOUT = 15000;
const MAX_ATTEMPTS = 2;

function mkStream(url) {
  const s = new PassThrough({ highWaterMark: BUFFER_SIZE });
  let attempts = 0;

  function spawnProc() {
    attempts++;
    const proc = spawn('yt-dlp', [
      '--quiet', '--no-warnings', '--no-check-certificate',
      '--user-agent', UA, '--add-header', 'Referer:https://www.youtube.com',
      '-f', 'bestaudio[ext=webm]/bestaudio[ext=m4a]/bestaudio/best',
      '-o', '-', url,
    ]);
    s._proc = proc;
    let gotData = false;
    const timer = setTimeout(() => {
      if (!gotData) {
        proc.kill();
        if (attempts < MAX_ATTEMPTS) spawnProc();
        else s.destroy(new Error('yt-dlp timeout'));
      }
    }, SPAWN_TIMEOUT);
    proc.stdout.once('data', () => { gotData = true; clearTimeout(timer); });
    proc.stdout.pipe(s, { end: false });
    proc.on('error', (er) => {
      clearTimeout(timer);
      if (attempts < MAX_ATTEMPTS) spawnProc();
      else s.destroy(er);
    });
    proc.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0 && !s.destroyed && attempts < MAX_ATTEMPTS) spawnProc();
    });
  }

  spawnProc();
  s.on('close', () => { if (s._proc && !s._proc.killed) s._proc.kill(); s._proc = null; });
  return s;
}

async function meta(url) {
  const cached = cache.getCachedMeta(url);
  if (cached) return cached;

  try {
    const proc = spawn('yt-dlp', [
      '--quiet', '--no-warnings', '--no-check-certificate',
      '--user-agent', UA, '--add-header', 'Referer:https://www.youtube.com',
      '--print', '%(title)s', '--print', '%(thumbnail)s',
      '--print', '%(duration)s', '--print', '%(channel)s', '--print', '%(webpage_url)s', url,
    ]);
    const c = []; proc.stdout.on('data', d => c.push(d));
    await new Promise((res, rej) => { proc.stdout.on('end', res); proc.on('error', rej); proc.on('close', () => { if (!proc.stdout.destroyed) res(); }); setTimeout(() => rej(new Error('meta timeout')), 15000); });
    const l = Buffer.concat(c).toString().trim().split('\n');
    const info = { title: l[0] || '?', thumbnail: l[1] || '', duration: parseInt(l[2]) || 0, channel: l[3] || '?', url: l[4] || url };
    cache.setCachedMeta(url, info);
    return info;
  } catch { return { title: '?', thumbnail: '', duration: 0, channel: '?', url }; }
}

module.exports = { mkStream, meta };
