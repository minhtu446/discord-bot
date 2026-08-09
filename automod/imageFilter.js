const { spawn } = require('child_process');
const path = require('path');
const wordFilter = require('./wordFilter');

let pyProcess = null;
let pyBuffer = '';
let pendingResolve = null;
let requestQueue = [];
let processing = false;

let crashCount = 0;
let crashWindow = [];
let easyOcrDisabled = false;

function startPython() {
  if (easyOcrDisabled) return false;
  const scriptPath = path.join(__dirname, 'easyocr_server.py');
  try {
    pyProcess = spawn('python', [scriptPath], {
      stdio: ['pipe', 'pipe', 'pipe'],
      encoding: 'utf-8',
    });
  } catch (e) {
    console.error('[imageFilter] Failed to spawn Python:', e.message);
    pyProcess = null;
    return false;
  }

  pyProcess.stdout.on('data', (data) => {
    pyBuffer += data.toString();
    const lines = pyBuffer.split('\n');
    pyBuffer = lines.pop() || '';
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const result = JSON.parse(trimmed);
        if (pendingResolve) {
          const r = pendingResolve;
          pendingResolve = null;
          r(result);
        }
      } catch (e) {
        if (pendingResolve) {
          const r = pendingResolve;
          pendingResolve = null;
          r(null);
        }
      }
    }
  });

  pyProcess.stderr.on('data', (data) => {
    const msg = data.toString().trim();
    if (msg && !msg.includes('UserWarning') && !msg.includes('pinned memory')) {
      console.error('[imageFilter] Python stderr:', msg);
    }
  });

  pyProcess.on('exit', (code) => {
    console.log('[imageFilter] Python process exited:', code);
    pyProcess = null;
    if (pendingResolve) {
      const r = pendingResolve;
      pendingResolve = null;
      r(null);
    }
    const now = Date.now();
    crashWindow = crashWindow.filter(t => now - t < 3600000);
    crashWindow.push(now);
    crashCount = crashWindow.length;
    if (crashCount >= 5) {
      console.log('[imageFilter] Too many crashes in 1h, disabling EasyOCR permanently for this session');
      easyOcrDisabled = true;
      return;
    }
    const delays = [1000, 5000, 30000, 120000];
    const delay = delays[Math.min(crashCount - 1, delays.length - 1)];
    console.log(`[imageFilter] Restarting Python in ${delay}ms (crash #${crashCount})`);
    setTimeout(startPython, delay);
  });

  return true;
}

function sendToPython(action, payload) {
  return new Promise((resolve) => {
    if (easyOcrDisabled) return resolve(null);
    if (!pyProcess) {
      if (!startPython()) return resolve(null);
    }
    pendingResolve = resolve;
    try {
      const cmd = JSON.stringify({ action, ...payload }) + '\n';
      pyProcess.stdin.write(cmd, 'utf-8');
    } catch (e) {
      pendingResolve = null;
      resolve(null);
    }
    setTimeout(() => {
      if (pendingResolve) {
        const r = pendingResolve;
        pendingResolve = null;
        r(null);
      }
    }, 120000);
  });
}

async function checkOCRSpace(buffer, guildId) {
  const apiKey = process.env.OCRSPACE_API_KEY;
  if (!apiKey) {
    console.log('[OCR.space] No API key');
    return { bad: false, text: '' };
  }
  if (buffer.length > 950 * 1024) {
    console.log('[OCR.space] Image too large, skipping');
    return { bad: false, text: '' };
  }
  const b64 = buffer.toString('base64');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);
  try {
    const body = new URLSearchParams({
      apikey: apiKey,
      base64Image: `data:image/png;base64,${b64}`,
      language: 'vnm',
      OCREngine: '2',
    });
    const res = await fetch('https://api.ocr.space/parse/image', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
      signal: controller.signal,
    });
    const data = await res.json();
    if (data.IsErroredOnProcessing || !data.ParsedResults) {
      console.error('[OCR.space] Error:', data.ErrorMessage || 'unknown');
      return { bad: false, text: '' };
    }
    const text = data.ParsedResults.map(r => r.ParsedText).join(' ').trim();
    if (!text) {
      console.log('[OCR.space] No text');
      return { bad: false, text: '' };
    }
    console.log(`[OCR.space] Text: "${text}"`);
    if (wordFilter.checkContent(text, true, guildId)) {
      console.log('[OCR.space] BAD content detected');
      return { bad: true, text };
    }
    return { bad: false, text };
  } catch (e) {
    if (e.name === 'AbortError') console.error('[OCR.space] Timeout');
    else console.error('[OCR.space] Error:', e.message);
    return { bad: false, text: '' };
  } finally {
    clearTimeout(timeout);
  }
}

function pickGeminiKey() {
  const keys = (process.env.GEMINI_KEYS || '')
    .split(',').map(k => k.trim()).filter(Boolean);
  if (keys.length === 0) return null;
  return keys[Math.floor(Math.random() * keys.length)];
}

async function checkGeminiVision(buffer, guildId, mimeType) {
  const apiKey = pickGeminiKey();
  if (!apiKey) {
    console.log('[Gemini Vision] No API key');
    return false;
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);
  try {
    const res = await fetch(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=' + apiKey,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            parts: [
              { text: 'Nhận diện toàn bộ chữ xuất hiện trong ảnh này, kể cả chữ 3D, nhòa, biến dạng, nghiêng hoặc bị tách rời. Liệt kê chính xác mọi chữ tìm được. Nếu không có chữ nào, chỉ trả về KHONG_CO_CHU.' },
              { inlineData: { mimeType: mimeType || 'image/png', data: buffer.toString('base64') } },
            ],
          }],
        }),
        signal: controller.signal,
      }
    );
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      console.error('[Gemini Vision] HTTP', res.status, body.slice(0, 200));
      return false;
    }
    const data = await res.json();
    const text = data?.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('').trim();
    if (!text || text.toUpperCase() === 'KHONG_CO_CHU') {
      console.log('[Gemini Vision] No text');
      return false;
    }
    console.log(`[Gemini Vision] Text: "${text.slice(0, 300)}"`);
    return wordFilter.checkContent(text, true, guildId);
  } catch (e) {
    if (e.name === 'AbortError') console.error('[Gemini Vision] Timeout');
    else console.error('[Gemini Vision] Error:', e.message);
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

async function checkBufferImage(buffer, guildId, mimeType) {
  console.log('[imageFilter] Processing image...');
  const b64 = buffer.toString('base64');
  const easyPromise = (async () => {
    try { return await sendToPython('ocr', { image: b64 }); }
    catch { return null; }
  })();
  const ocrPromise = checkOCRSpace(buffer, guildId);
  const ocrResult = await ocrPromise;
  if (ocrResult.bad) {
    console.log('[OCR.space] BAD content detected');
    return true;
  }
  const easyResult = await easyPromise;
  const extractedParts = [];
  if (ocrResult.text) extractedParts.push(ocrResult.text);
  if (easyResult && easyResult.texts && easyResult.texts.length > 0) {
    console.log(`[OCR] EasyOCR: ${easyResult.count} blocks`);
    for (let i = 0; i < easyResult.texts.length; i++) {
      console.log(`[OCR] Block ${i}: "${easyResult.texts[i]}"`);
      extractedParts.push(easyResult.texts[i]);
    }
    const text = easyResult.texts.join(' ');
    if (wordFilter.checkContent(text, true, guildId)) {
      console.log('[OCR] BAD content detected');
      return true;
    }
    for (const block of easyResult.texts) {
      if (wordFilter.checkContent(block, true, guildId)) {
        console.log('[OCR] BAD content detected in block');
        return true;
      }
    }
    console.log('[OCR] Content OK');
  } else if (easyResult && easyResult.error) {
    console.error('[imageFilter] EasyOCR error:', easyResult.error);
  } else {
    console.log('[OCR] No text extracted from EasyOCR');
  }

  const extracted = extractedParts.join(' ').trim().replace(/\s+/g, '');
  if (extracted.length <= 10) {
    console.log('[imageFilter] OCR read little/no text, running Gemini Vision...');
    const visionBad = await checkGeminiVision(buffer, guildId, mimeType);
    if (visionBad) {
      console.log('[Gemini Vision] BAD content detected');
      return true;
    }
    console.log('[Gemini Vision] Content OK');
  }

  return false;
}

process.on('exit', () => {
  if (pyProcess) pyProcess.kill();
});

startPython();

module.exports = { checkBufferImage };
