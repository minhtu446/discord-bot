const sharp = require('sharp');
const Tesseract = require('tesseract.js');
const { spawn } = require('child_process');
const jsonCache = require('../jsonCache');
const wordFilter = require('./wordFilter');

const config = require('../config');

const bannedImagesPath = jsonCache.getPath('bannedImages.json');
const bannedWordsPath = jsonCache.getPath('bannedWords.json');
const ocrCache = new Map();
const OCR_CACHE_MAX = 200;
const HF_TIMEOUT = 15000;
const TESS_TIMEOUT = 8000;
const HF_MODEL = 'Qwen/Qwen3-VL-8B-Instruct';
let ocrConcurrent = 0;
const MAX_CONCURRENT_OCR = 2;

let sttConcurrent = 0;
const MAX_CONCURRENT_STT = 2;
const WHISPER_TIMEOUT = 60000;
const MAX_AUDIO_SIZE = 10 * 1024 * 1024;
const FFMPEG_TIMEOUT = 60000;
const DEMUCS_TIMEOUT = 120000;

function pruneCache() {
  if (ocrCache.size > OCR_CACHE_MAX) {
    const entries = [...ocrCache.entries()];
    const toDelete = entries.slice(0, entries.length - OCR_CACHE_MAX);
    toDelete.forEach(([k]) => ocrCache.delete(k));
  }
}
setInterval(pruneCache, 30000);

async function getBuffer(url) {
  const resp = await fetch(url);
  return Buffer.from(await resp.arrayBuffer());
}

async function getDHashFromBuffer(buffer) {
  const { data } = await sharp(buffer)
    .resize(9, 8, { fit: 'fill' })
    .grayscale()
    .raw()
    .toBuffer({ resolveWithObject: true });

  let hash = '';
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      hash += data[y * 9 + x] > data[y * 9 + x + 1] ? '1' : '0';
    }
  }
  return hash;
}

function hammingDistance(hash1, hash2) {
  let diff = 0;
  for (let i = 0; i < hash1.length; i++) {
    if (hash1[i] !== hash2[i]) diff++;
  }
  return diff;
}

async function hfOcr(imageBuffer) {
  const base64 = imageBuffer.toString('base64');
  const dataUri = 'data:image/png;base64,' + base64;

  const resp = await fetch('https://router.huggingface.co/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + config.hfToken,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: HF_MODEL,
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: 'Read all text in this image exactly, return only the raw text:' },
          { type: 'image_url', image_url: { url: dataUri } },
        ],
      }],
      max_tokens: 200,
    }),
    signal: AbortSignal.timeout(HF_TIMEOUT),
  });

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error('HF API ' + resp.status + ': ' + errText.substring(0, 100));
  }

  const json = await resp.json();
  return json.choices?.[0]?.message?.content || '';
}

async function tesseractOcr(imageBuffer) {
  const img = sharp(imageBuffer).grayscale();
  const stats = await img.clone().stats();
  const median = stats.channels[0].median;

  const processed = await img
    .resize(1000, 1000, { fit: 'inside', withoutEnlargement: true })
    .linear(1.5, -(median * 0.25))
    .normalize()
    .sharpen({ sigma: 1, m1: 0, m2: 1, x1: 2, y2: 8, y3: 8 })
    .png()
    .toBuffer();

  const result = await Promise.race([
    Tesseract.recognize(processed, 'vie+eng'),
    new Promise((_, reject) => setTimeout(() => reject(new Error('OCR timeout')), TESS_TIMEOUT))
  ]);
  return result.data.text || '';
}

function checkBanned(text) {
  if (!text.trim()) return false;
  return wordFilter.checkContent(text);
}

function getMediaType(attachment) {
  const ct = (attachment.contentType || '').toLowerCase();
  if (ct.startsWith('image/')) return 'image';
  if (ct.startsWith('video/')) return 'video';
  if (ct.startsWith('audio/')) return 'audio';

  const url = (attachment.url || '').toLowerCase();
  if (/\.(png|jpg|jpeg|gif|webp|bmp|tiff?)(\?|$)/.test(url)) return 'image';
  if (/\.(mp4|webm|mov|avi|mkv|flv|wmv)(\?|$)/.test(url)) return 'video';
  if (/\.(mp3|wav|ogg|flac|m4a|wma|opus)(\?|$)/.test(url)) return 'audio';

  return null;
}

async function getFrameFromVideo(videoUrl, seekSeconds) {
  return new Promise((resolve, reject) => {
    const proc = spawn('ffmpeg', [
      '-user-agent', 'Mozilla/5.0',
      '-ss', String(seekSeconds || 1),
      '-i', videoUrl,
      '-vframes', '1',
      '-f', 'image2pipe',
      '-codec:v', 'png',
      '-',
    ]);
    const chunks = [];
    const errChunks = [];
    proc.stdout.on('data', d => chunks.push(d));
    proc.stderr.on('data', d => errChunks.push(d));
    proc.on('error', reject);
    proc.on('close', code => {
      if (code === 0 && chunks.length > 0) resolve(Buffer.concat(chunks));
      else reject(new Error('ffmpeg: ' + Buffer.concat(errChunks).toString().substring(0, 300)));
    });
    const timer = setTimeout(() => { proc.kill(); reject(new Error('ffmpeg timeout')); }, FFMPEG_TIMEOUT);
    proc.on('close', () => clearTimeout(timer));
  });
}

function parseWavToSamples(buffer) {
  const header = 44;
  const data = new Int16Array(buffer.buffer, buffer.byteOffset + header, (buffer.length - header) / 2);
  const samples = new Float32Array(data.length);
  for (let i = 0; i < data.length; i++) samples[i] = data[i] / 32768;
  return samples;
}

function fftMagnitudes(samples) {
  const n = samples.length;
  const re = new Float64Array(samples);
  const im = new Float64Array(n);
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = -2 * Math.PI / len;
    const wRe = Math.cos(ang), wIm = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cRe = 1, cIm = 0;
      for (let j = 0; j < len / 2; j++) {
        const uRe = re[i + j], uIm = im[i + j];
        const vRe = re[i + j + len / 2] * cRe - im[i + j + len / 2] * cIm;
        const vIm = re[i + j + len / 2] * cIm + im[i + j + len / 2] * cRe;
        re[i + j] = uRe + vRe; im[i + j] = uIm + vIm;
        re[i + j + len / 2] = uRe - vRe; im[i + j + len / 2] = uIm - vIm;
        const tmp = cRe * wRe - cIm * wIm;
        cIm = cRe * wIm + cIm * wRe;
        cRe = tmp;
      }
    }
  }
  const mags = new Float64Array(n / 2);
  for (let i = 0; i < n / 2; i++) mags[i] = Math.sqrt(re[i] * re[i] + im[i] * im[i]);
  return mags;
}

function spectralProfile(samples) {
  const mags = fftMagnitudes(samples);
  const sr = 16000;
  const n = mags.length * 2;
  const bands = [
    { lo: 85, hi: 300 },
    { lo: 300, hi: 600 },
    { lo: 600, hi: 1000 },
    { lo: 1000, hi: 1500 },
    { lo: 1500, hi: 2000 },
    { lo: 2000, hi: 3000 },
  ];
  return bands.map(b => {
    const lo = Math.floor(b.lo / sr * n);
    const hi = Math.ceil(b.hi / sr * n);
    let e = 0;
    for (let i = lo; i < hi && i < mags.length; i++) e += mags[i];
    return e;
  });
}

function cosineSim(a, b) {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const d = Math.sqrt(na) * Math.sqrt(nb);
  return d === 0 ? 0 : dot / d;
}

function detectRepetition(samples) {
  const winSize = 16000;
  const hopSize = 8000;
  const numWindows = Math.floor((samples.length - winSize) / hopSize) + 1;
  if (numWindows < 3) return false;

  const features = [];
  for (let i = 0; i < numWindows; i++) {
    const start = i * hopSize;
    features.push(spectralProfile(samples.slice(start, start + winSize)));
  }

  let similarCount = 0;
  for (let i = 1; i < features.length; i++) {
    if (cosineSim(features[i - 1], features[i]) > 0.85) similarCount++;
    else similarCount = 0;
    if (similarCount >= 2) return true;
  }
  return false;
}

function detectVoice(samples) {
  if (samples.length < 16000) return false;
  const mags = fftMagnitudes(samples.slice(0, 16000));
  const sr = 16000;
  const n = mags.length * 2;
  const voiceLo = Math.floor(200 / sr * n);
  const voiceHi = Math.ceil(4000 / sr * n);
  const totalLo = Math.floor(50 / sr * n);
  const totalHi = Math.ceil(8000 / sr * n);
  let voiceE = 0, totalE = 0;
  for (let i = totalLo; i < totalHi && i < mags.length; i++) {
    totalE += mags[i];
    if (i >= voiceLo && i <= voiceHi) voiceE += mags[i];
  }
  return totalE > 0 && (voiceE / totalE) > 0.35;
}

function detectEarrape(samples) {
  const winSize = 800;
  const numWindows = Math.floor(samples.length / winSize);
  if (numWindows < 10) return false;

  const rmsValues = [];
  for (let i = 0; i < numWindows; i++) {
    const start = i * winSize;
    let sum = 0;
    for (let j = 0; j < winSize; j++) sum += samples[start + j] * samples[start + j];
    rmsValues.push(Math.sqrt(sum / winSize));
  }

  let runningAvg = rmsValues[0];
  let spikeCount = 0;
  for (let i = 1; i < rmsValues.length; i++) {
    if (rmsValues[i] > runningAvg * 2.5 && rmsValues[i] > 0.05) {
      spikeCount++;
      if (spikeCount >= 3) return true;
    }
    runningAvg = runningAvg * 0.95 + rmsValues[i] * 0.05;
  }
  return false;
}

async function separateVocals(audioBuffer) {
  console.log('[Demucs] separating vocals, size:', (audioBuffer.length / 1024).toFixed(0), 'KB');
  const resp = await fetch('https://router.huggingface.co/hf-inference/models/facebook/demucs', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + config.hfToken,
      'Content-Type': 'audio/wav',
    },
    body: audioBuffer,
    signal: AbortSignal.timeout(DEMUCS_TIMEOUT),
  });
  if (!resp.ok) {
    const errText = await resp.text().catch(() => '');
    console.log('[Demucs] API error:', resp.status, errText.substring(0, 100));
    throw new Error('Demucs API ' + resp.status);
  }
  const result = await resp.json();
  if (Array.isArray(result)) {
    const vocals = result.find(r => r.label === 'vocals');
    if (vocals && vocals.blob) {
      const buf = Buffer.from(vocals.blob, 'base64');
      console.log('[Demucs] got vocals:', (buf.length / 1024).toFixed(0), 'KB');
      return buf;
    }
  }
  throw new Error('Demucs no vocals found');
}

function getAudioQuick(videoUrl) {
  return new Promise((resolve, reject) => {
    const proc = spawn('ffmpeg', [
      '-user-agent', 'Mozilla/5.0',
      '-ss', '0',
      '-t', '2',
      '-i', videoUrl,
      '-vn',
      '-acodec', 'pcm_s16le',
      '-ar', '16000',
      '-ac', '1',
      '-af', 'highpass=f=200,lowpass=f=4000,afftdn=nf=-25',
      '-f', 'wav',
      '-',
    ]);
    const chunks = [];
    proc.stdout.on('data', d => chunks.push(d));
    proc.stderr.on('data', () => {});
    proc.on('error', reject);
    proc.on('close', code => {
      if (code === 0 && chunks.length > 0) resolve(Buffer.concat(chunks));
      else reject(new Error('quick audio fail'));
    });
    const timer = setTimeout(() => { proc.kill(); reject(new Error('quick audio timeout')); }, 10000);
    proc.on('close', () => clearTimeout(timer));
  });
}

async function getAudioFromVideo(videoUrl) {
  return new Promise((resolve, reject) => {
    const proc = spawn('ffmpeg', [
      '-user-agent', 'Mozilla/5.0',
      '-i', videoUrl,
      '-vn',
      '-acodec', 'pcm_s16le',
      '-ar', '16000',
      '-ac', '1',
      '-af', 'highpass=f=200,lowpass=f=4000,afftdn=nf=-25',
      '-t', '60',
      '-f', 'wav',
      '-',
    ]);
    const chunks = [];
    const errChunks = [];
    proc.stdout.on('data', d => chunks.push(d));
    proc.stderr.on('data', d => errChunks.push(d));
    proc.on('error', reject);
    proc.on('close', code => {
      if (code === 0 && chunks.length > 0) resolve(Buffer.concat(chunks));
      else reject(new Error('ffmpeg audio: ' + Buffer.concat(errChunks).toString().substring(0, 300)));
    });
    const timer = setTimeout(() => { proc.kill(); reject(new Error('ffmpeg audio timeout')); }, FFMPEG_TIMEOUT);
    proc.on('close', () => clearTimeout(timer));
  });
}

async function whisperTranscribe(audioBuffer, mimeType, model) {
  const url = 'https://router.huggingface.co/hf-inference/models/' + (model || 'openai/whisper-large-v3-turbo');
  console.log('[Whisper] calling', model, 'size:', (audioBuffer.length / 1024).toFixed(0), 'KB');
  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + config.hfToken,
      'Content-Type': mimeType,
    },
    body: audioBuffer,
    signal: AbortSignal.timeout(WHISPER_TIMEOUT),
  });
  if (!resp.ok) {
    const errText = await resp.text().catch(() => '');
    console.log('[Whisper] API error:', resp.status, errText.substring(0, 100));
    throw new Error('Whisper API ' + resp.status + ': ' + errText.substring(0, 100));
  }
  const json = await resp.json();
  console.log('[Whisper] result:', (json.text || '').substring(0, 200));
  return json.text || '';
}

async function whisperTranscribeVi(audioBuffer, mimeType) {
  const text = await whisperTranscribe(audioBuffer, mimeType, 'openai/whisper-large-v3').catch(async () => {
    return await whisperTranscribe(audioBuffer, mimeType, 'openai/whisper-large-v3-turbo').catch(() => '');
  });
  return text;
}

const LOCAL_PYTHON = 'python';
const AUDIO_PROCESSOR = require('path').join(__dirname, '..', 'audio_processor.py');

async function localTranscribe(audioBuffer) {
  const tmpDir = require('os').tmpdir();
  const tmpFile = require('path').join(tmpDir, 'vocal_' + Date.now() + '.wav');
  try {
    require('fs').writeFileSync(tmpFile, audioBuffer);
    const proc = require('child_process').spawn(LOCAL_PYTHON, [AUDIO_PROCESSOR, tmpFile]);
    const chunks = [];
    proc.stdout.on('data', d => chunks.push(d));
    const timer = setTimeout(() => { proc.kill(); }, 120000);
    const code = await new Promise((resolve) => { proc.on('close', resolve); });
    clearTimeout(timer);
    if (code !== 0) throw new Error('python exit ' + code);
    const text = JSON.parse(Buffer.concat(chunks).toString().trim());
    if (text.error) throw new Error(text.error.substring(0, 100));
    return (text.text || '').trim();
  } finally {
    try { require('fs').unlinkSync(tmpFile); } catch {}
  }
}

async function checkBufferImage(buffer, cacheKey) {
  const bannedImages = jsonCache.readJSONArray(bannedImagesPath);
  const hash = await getDHashFromBuffer(buffer);

  for (const banned of bannedImages) {
    if (hammingDistance(hash, banned.hash) < 6) return true;
  }

  if (ocrCache.has(cacheKey)) return ocrCache.get(cacheKey) === true;
  if (ocrConcurrent >= MAX_CONCURRENT_OCR) return false;

  let isBanned = false;
  ocrConcurrent++;
  try {
    const hfText = await hfOcr(buffer);
    isBanned = checkBanned(hfText);
  } catch (hfErr) {
    try {
      const tessText = await tesseractOcr(buffer);
      isBanned = checkBanned(tessText);
    } catch (tessErr) {
      isBanned = false;
    }
  }
  ocrConcurrent--;
  ocrCache.set(cacheKey, isBanned);
  pruneCache();
  return isBanned;
}

async function check(message, settings) {
  try {
    for (const attachment of message.attachments.values()) {
      const type = getMediaType(attachment);
      if (!type) continue;

      if (type === 'image') {
        const buffer = await getBuffer(attachment.url);
        const cacheKey = attachment.url.split('?')[0];

        if (settings?.imageDhash === false && settings?.imageOcr === false) continue;

        if (settings?.imageDhash === false) {
          if (await checkOcrOnly(buffer, cacheKey)) return true;
        } else if (settings?.imageOcr === false) {
          if (await checkDhashOnly(buffer, cacheKey)) return true;
        } else {
          if (await checkBufferImage(buffer, cacheKey)) return true;
        }
      }

      else if (type === 'video') {
        const cacheKey = attachment.url.split('?')[0] + '_video';
        if (ocrCache.has(cacheKey)) {
          if (ocrCache.get(cacheKey)) return true;
          continue;
        }

        if (settings?.videoOcr !== false) {
          try {
            for (const ts of [1, 10, 30, 60]) {
              try {
                const rawFrame = await getFrameFromVideo(attachment.url, ts);
                const frame = await sharp(rawFrame).png().toBuffer();
                const isBanned = await checkBufferImage(frame, cacheKey + '_f' + ts);
                if (isBanned) {
                  ocrCache.set(cacheKey, true);
                  pruneCache();
                  return true;
                }
              } catch (e) { /* skip failed frame */ }
            }
          } catch (e) {
            console.error('Video frame skip:', e.message);
          }
        }

        if (settings?.videoPattern !== false) {
          try {
            const quickAudio = await getAudioQuick(attachment.url);
            if (quickAudio && quickAudio.length > 0) {
              const qSamples = parseWavToSamples(quickAudio);
              const qRepeat = detectRepetition(qSamples);
              const qEarrape = detectEarrape(qSamples);
              const qVoice = detectVoice(qSamples);
              console.log('[Video] quick pattern - repeat:', qRepeat, 'earrape:', qEarrape, 'voice:', qVoice);
              if ((qRepeat && qVoice) || qEarrape) {
                ocrCache.set(cacheKey, true);
                pruneCache();
                return true;
              }
            }
          } catch (e) { /* quick check skip */ }

          if (settings?.videoAudio === false) { ocrCache.set(cacheKey, false); pruneCache(); continue; }
          if (sttConcurrent >= MAX_CONCURRENT_STT) continue;
          sttConcurrent++;
          try {
            const rawAudio = await getAudioFromVideo(attachment.url);
            if (rawAudio.length <= MAX_AUDIO_SIZE) {
              const samples = parseWavToSamples(rawAudio);
              const isRepeated = detectRepetition(samples);
              const isEarrape = detectEarrape(samples);
              const isVoice = detectVoice(samples);
              console.log('[Video] full pattern - repeat:', isRepeated, 'earrape:', isEarrape, 'voice:', isVoice);
              if ((isRepeated && isVoice) || isEarrape) {
                sttConcurrent--;
                ocrCache.set(cacheKey, true);
                pruneCache();
                return true;
              }
            }
          } catch (e) {
            console.error('Video pattern skip:', e.message);
          }
          sttConcurrent--;
        }

        if (settings?.videoAudio !== false) {
          if (sttConcurrent >= MAX_CONCURRENT_STT) { ocrCache.set(cacheKey, false); pruneCache(); continue; }
          sttConcurrent++;
          try {
            const rawAudio = await getAudioFromVideo(attachment.url);
            if (rawAudio.length <= MAX_AUDIO_SIZE) {
              const transcript = await localTranscribe(rawAudio).catch(async () => {
                const vocalAudio = await separateVocals(rawAudio).catch(() => rawAudio);
                if (vocalAudio.length > MAX_AUDIO_SIZE) return '';
                return await whisperTranscribeVi(vocalAudio, 'audio/wav');
              });
              console.log('[Video] transcript:', transcript?.substring(0, 200));
              if (checkBanned(transcript || '')) {
                sttConcurrent--;
                ocrCache.set(cacheKey, true);
                pruneCache();
                return true;
              }
            } else {
              console.log('[Video] audio too large:', rawAudio.length);
            }
          } catch (e) {
            console.error('Video audio skip:', e.message);
          }
          sttConcurrent--;
        }

        ocrCache.set(cacheKey, false);
        pruneCache();
      }

      else if (type === 'audio') {
        if (settings?.videoAudio === false) continue;

        const cacheKey = attachment.url.split('?')[0] + '_audio';
        if (ocrCache.has(cacheKey)) {
          if (ocrCache.get(cacheKey)) return true;
          continue;
        }
        if (sttConcurrent >= MAX_CONCURRENT_STT) continue;

        sttConcurrent++;
        let isBanned = false;
        try {
          const buffer = await getBuffer(attachment.url);
          if (buffer.length > MAX_AUDIO_SIZE) {
            isBanned = false;
          } else {
            const transcript = await whisperTranscribeVi(buffer, (attachment.contentType || 'audio/mpeg'));
            isBanned = checkBanned(transcript);
          }
        } catch (e) {
          isBanned = false;
        }
        sttConcurrent--;
        ocrCache.set(cacheKey, isBanned);
        pruneCache();
        if (isBanned) return true;
      }
    }
    return false;
  } catch (e) {
    return false;
  }
}

async function checkDhashOnly(buffer, cacheKey) {
  const bannedImages = jsonCache.readJSONArray(bannedImagesPath);
  const hash = await getDHashFromBuffer(buffer);
  for (const banned of bannedImages) {
    if (hammingDistance(hash, banned.hash) < 6) return true;
  }
  return false;
}

async function checkOcrOnly(buffer, cacheKey) {
  if (ocrCache.has(cacheKey)) return ocrCache.get(cacheKey) === true;
  if (ocrConcurrent >= MAX_CONCURRENT_OCR) return false;
  let isBanned = false;
  ocrConcurrent++;
  try {
    const hfText = await hfOcr(buffer);
    isBanned = checkBanned(hfText);
  } catch (hfErr) {
    try {
      const tessText = await tesseractOcr(buffer);
      isBanned = checkBanned(tessText);
    } catch (tessErr) {
      isBanned = false;
    }
  }
  ocrConcurrent--;
  ocrCache.set(cacheKey, isBanned);
  pruneCache();
  return isBanned;
}

async function checkImageUrl(imageUrl) {
  try {
    const bannedImages = jsonCache.readJSONArray(bannedImagesPath);
    const buffer = await getBuffer(imageUrl);
    const hash = await getDHashFromBuffer(buffer);
    for (const banned of bannedImages) {
      if (hammingDistance(hash, banned.hash) < 6) return true;
    }
    return false;
  } catch (e) {
    return false;
  }
}

async function getDHash(url) {
  return getDHashFromBuffer(await getBuffer(url));
}

async function testVideo(videoUrl) {
  const rawAudio = await getAudioFromVideo(videoUrl);
  if (!rawAudio || rawAudio.length === 0) return null;
  if (rawAudio.length > MAX_AUDIO_SIZE) return null;
  const samples = parseWavToSamples(rawAudio);
  const result = {
    repetition: detectRepetition(samples),
    earrape: detectEarrape(samples),
    voice: detectVoice(samples),
    transcript: '',
  };
  try {
    result.transcript = await localTranscribe(rawAudio);
  } catch {
    const vocalAudio = await separateVocals(rawAudio).catch(() => rawAudio);
    if (vocalAudio && vocalAudio.length > 0) {
      result.transcript = await whisperTranscribeVi(vocalAudio, 'audio/wav');
    }
  }
  return result;
}

module.exports = { getDHash, check, checkImageUrl, testVideo, checkBanned };
