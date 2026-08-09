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
  if (process.env.DISABLE_EASYOCR === '1') {
    if (!easyOcrDisabled) {
      easyOcrDisabled = true;
      console.log('[imageFilter] EasyOCR disabled via DISABLE_EASYOCR=1');
    }
    return false;
  }
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
    return { bad: false, text: '', reason: 'Không có API key' };
  }
  if (buffer.length > 950 * 1024) {
    console.log('[OCR.space] Image too large, skipping');
    return { bad: false, text: '', reason: 'Ảnh quá lớn (>950KB), bỏ qua' };
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
      return { bad: false, text: '', reason: 'Lỗi xử lý: ' + (data.ErrorMessage || 'unknown') };
    }
    const text = data.ParsedResults.map(r => r.ParsedText).join(' ').trim();
    if (!text) {
      console.log('[OCR.space] No text');
      return { bad: false, text: '', reason: 'Không đọc được chữ' };
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
    return { bad: false, text: '', reason: e.name === 'AbortError' ? 'Timeout' : ('Lỗi: ' + e.message) };
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

const GEMINI_VISION_MODELS = ['gemini-2.5-flash', 'gemini-2.0-flash'];

async function callGeminiVision(model, apiKey, buffer, mimeType, signal) {
  return fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
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
      signal,
    }
  );
}

function sleepMs(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function checkGeminiVision(buffer, guildId, mimeType) {
  const apiKey = pickGeminiKey();
  if (!apiKey) {
    console.log('[Gemini Vision] No API key');
    return { bad: false, text: '', status: 'no_key', detail: 'Không có GEMINI_KEYS' };
  }
  if (buffer.length > 19 * 1024 * 1024) {
    console.log('[Gemini Vision] Image too large for Gemini, skipping');
    return { bad: false, text: '', status: 'too_large', detail: 'Ảnh >19MB, bỏ qua' };
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 45000);
  try {
    for (const model of GEMINI_VISION_MODELS) {
      for (let attempt = 1; attempt <= 3; attempt++) {
        const res = await callGeminiVision(model, apiKey, buffer, mimeType, controller.signal);
        if (res.status === 429) {
          const retryAfter = parseInt(res.headers.get('retry-after') || '0', 10);
          const wait = retryAfter > 0 ? retryAfter * 1000 : attempt * 3000;
          console.log(`[Gemini Vision] ${model} HTTP 429 (attempt ${attempt}), retrying in ${wait}ms`);
          await sleepMs(wait);
          continue;
        }
        if (!res.ok) {
          const body = await res.text().catch(() => '');
          console.error(`[Gemini Vision] ${model} HTTP ${res.status}`, body.slice(0, 200));
          return { bad: false, text: '', status: 'http_error', detail: `HTTP ${res.status}` };
        }
        const data = await res.json();
        const candidate = data?.candidates?.[0];
        const text = candidate?.content?.parts?.map(p => p.text || '').join('').trim();
        if (candidate?.finishReason && candidate.finishReason !== 'STOP') {
          console.error(`[Gemini Vision] ${model} finishReason=${candidate.finishReason}`);
          return { bad: false, text: '', status: 'blocked', detail: `Gemini chặn (${candidate.finishReason})` };
        }
        if (!text || text.toUpperCase() === 'KHONG_CO_CHU') {
          console.log(`[Gemini Vision] ${model} No text`);
          return { bad: false, text: '', status: 'ok_no_text', detail: null };
        }
        console.log(`[Gemini Vision] ${model} Text: "${text.slice(0, 300)}"`);
        return { bad: wordFilter.checkContent(text, true, guildId), text, status: 'ok', detail: null };
      }
    }
    return { bad: false, text: '', status: 'http_error', detail: 'HTTP 429 — hết quota sau retry & fallback' };
  } catch (e) {
    if (e.name === 'AbortError') console.error('[Gemini Vision] Timeout');
    else console.error('[Gemini Vision] Error:', e.message);
    return { bad: false, text: '', status: 'timeout', detail: e.name === 'AbortError' ? 'Timeout' : ('Lỗi: ' + e.message) };
  } finally {
    clearTimeout(timeout);
  }
}

async function analyzeImage(buffer, guildId, mimeType) {
  console.log('[imageFilter] Processing image...');
  const b64 = buffer.toString('base64');
  const easyPromise = (async () => {
    try { return await sendToPython('ocr', { image: b64 }); }
    catch { return null; }
  })();
  const ocrPromise = checkOCRSpace(buffer, guildId);
  const ocrResult = await ocrPromise;
  const report = {
    bad: false,
    ocrSpace: { text: ocrResult.text || '', bad: !!ocrResult.bad, reason: ocrResult.reason || null },
    easyOcr: { count: 0, texts: [], error: null, bad: false },
    geminiVision: { ran: false, text: '', bad: false, skippedReason: null, status: null, detail: null },
    warning: null,
  };
  if (ocrResult.bad) {
    console.log('[OCR.space] BAD content detected');
    report.bad = true;
  }
  const easyResult = await easyPromise;
  const extractedParts = [];
  if (ocrResult.text) extractedParts.push(ocrResult.text);
  if (easyResult && easyResult.texts && easyResult.texts.length > 0) {
    console.log(`[OCR] EasyOCR: ${easyResult.count} blocks`);
    report.easyOcr.count = easyResult.count || easyResult.texts.length;
    report.easyOcr.texts = easyResult.texts;
    for (let i = 0; i < easyResult.texts.length; i++) {
      console.log(`[OCR] Block ${i}: "${easyResult.texts[i]}"`);
      extractedParts.push(easyResult.texts[i]);
    }
    const text = easyResult.texts.join(' ');
    if (wordFilter.checkContent(text, true, guildId)) {
      console.log('[OCR] BAD content detected');
      report.easyOcr.bad = true;
      report.bad = true;
    }
    for (const block of easyResult.texts) {
      if (wordFilter.checkContent(block, true, guildId)) {
        console.log('[OCR] BAD content detected in block');
        report.easyOcr.bad = true;
        report.bad = true;
      }
    }
    console.log('[OCR] Content OK');
  } else if (easyResult && easyResult.error) {
    console.error('[imageFilter] EasyOCR error:', easyResult.error);
    report.easyOcr.error = easyResult.error;
  } else {
    console.log('[OCR] No text extracted from EasyOCR');
  }

  const extracted = extractedParts.join(' ').trim().replace(/\s+/g, '');
  if (extracted.length <= 10) {
    console.log('[imageFilter] OCR read little/no text, running Gemini Vision...');
    report.geminiVision.ran = true;
    const vision = await checkGeminiVision(buffer, guildId, mimeType);
    report.geminiVision.status = vision.status;
    report.geminiVision.detail = vision.detail;
    if (vision.bad) {
      console.log('[Gemini Vision] BAD content detected');
      report.geminiVision.bad = true;
      report.bad = true;
    }
    if (vision.text) report.geminiVision.text = vision.text;
    if (vision.status && vision.status !== 'ok' && vision.status !== 'ok_no_text') {
      report.warning = `Gemini Vision thất bại (${vision.status}${vision.detail ? ': ' + vision.detail : ''}) — không xác định được ảnh có bad hay không`;
      console.error(`[imageFilter] ${report.warning}`);
    } else {
      console.log('[Gemini Vision] Content OK');
    }
  } else {
    report.geminiVision.skippedReason = 'OCR đọc đủ text, không cần chạy';
  }

  return report;
}

async function checkBufferImage(buffer, guildId, mimeType) {
  const report = await analyzeImage(buffer, guildId, mimeType);
  return report.bad;
}

process.on('exit', () => {
  if (pyProcess) pyProcess.kill();
});

startPython();

module.exports = { checkBufferImage, analyzeImage };
