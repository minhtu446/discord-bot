const { spawn } = require('child_process');
const path = require('path');
const wordFilter = require('./wordFilter');

let pyProcess = null;
let pyBuffer = '';
let requestQueue = [];

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
      const r = requestQueue.shift();
      if (!r) continue;
      try {
        r(JSON.parse(trimmed));
      } catch {
        r(null);
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
    let r;
    while ((r = requestQueue.shift())) r(null);
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
    requestQueue.push(resolve);
    try {
      const cmd = JSON.stringify({ action, ...payload }) + '\n';
      pyProcess.stdin.write(cmd, 'utf-8');
    } catch (e) {
      const idx = requestQueue.indexOf(resolve);
      if (idx !== -1) requestQueue.splice(idx, 1);
      resolve(null);
    }
    setTimeout(() => {
      const idx = requestQueue.indexOf(resolve);
      if (idx !== -1) {
        requestQueue.splice(idx, 1);
        resolve(null);
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

async function analyzeImage(buffer, guildId, mimeType) {
  console.log('[imageFilter] Processing image...');
  const b64 = buffer.toString('base64');
  const easyPromise = (async () => {
    try { return await sendToPython('ocr', { image: b64 }); }
    catch { return null; }
  })();
  const ocrResult = await checkOCRSpace(buffer, guildId);
  const report = {
    bad: false,
    ocrSpace: { text: ocrResult.text || '', bad: !!ocrResult.bad, reason: ocrResult.reason || null },
    easyOcr: { count: 0, texts: [], error: null, bad: false, skipped: false },
  };
  if (ocrResult.bad) {
    console.log('[OCR.space] BAD content detected');
    report.bad = true;
    report.easyOcr.skipped = true;
    return report;
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

  return report;
}

async function checkBufferImage(buffer, guildId, mimeType) {
  const report = await analyzeImage(buffer, guildId, mimeType);
  return report.bad;
}

async function checkBufferImageReport(buffer, guildId, mimeType) {
  return analyzeImage(buffer, guildId, mimeType);
}

process.on('exit', () => {
  if (pyProcess) pyProcess.kill();
});

startPython();

module.exports = { checkBufferImage, checkBufferImageReport, analyzeImage };
