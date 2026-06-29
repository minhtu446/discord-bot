const { spawn } = require('child_process');
const prism = require('prism-media');

async function test() {
  // 1. Spawn yt-dlp
  const proc = spawn('yt-dlp', [
    '-f', 'bestaudio',
    '-o', '-',
    '--no-check-certificate',
    '--no-warnings',
    '--prefer-free-formats',
    '--add-header', 'referer:youtube.com',
    '--add-header', 'user-agent:Mozilla/5.0',
    'https://www.youtube.com/watch?v=dQw4w9WgXcQ'
  ], { stdio: ['ignore', 'pipe', 'pipe'] });
  proc.stderr.on('data', () => {});

  // 2. FFmpeg to convert WebM to PCM (matching @discordjs/voice args)
  const ffmpeg = new prism.FFmpeg({
    args: ['-analyzeduration', '0', '-loglevel', '0', '-i', '-', '-f', 's16le', '-ar', '48000', '-ac', '2', '-']
  });

  let ffmpegBytes = 0;
  let ffmpegChunks = 0;
  ffmpeg.on('data', (chunk) => {
    ffmpegBytes += chunk.length;
    ffmpegChunks++;
    if (ffmpegChunks <= 3) console.log('FFmpeg chunk:', chunk.length, 'bytes');
  });
  ffmpeg.on('end', () => console.log('FFmpeg ended, total:', ffmpegBytes, 'bytes in', ffmpegChunks, 'chunks'));
  ffmpeg.on('error', (e) => console.error('FFmpeg error:', e.message));

  // Pipe yt-dlp to FFmpeg 
  proc.stdout.pipe(ffmpeg);

  // Also capture stderr from the FFmpeg process
  // prism-media FFmpeg is a Duplex, we can monitor its internal process
  // But prism doesn't expose the child process easily

  setTimeout(() => {
    console.log('After 20s: FFmpeg output =', ffmpegBytes, 'bytes in', ffmpegChunks, 'chunks');
    console.log('yt-dlp stdout readableLength:', proc.stdout.readableLength);
    proc.kill();
    process.exit(0);
  }, 20000);
}

test().catch(e => { console.error('Error:', e); process.exit(1); });
