const { spawn } = require('child_process');
const path = require('path');
const wordFilter = require('./wordFilter');

let pyProcess = null;
let pyBuffer = '';
let pendingResolve = null;
let requestQueue = [];
let processing = false;

function startPython() {
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
    setTimeout(startPython, 1000);
  });

  return true;
}

function sendToPython(action, payload) {
  return new Promise((resolve) => {
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

async function checkOCRSpace(buffer) {
  const apiKey = process.env.OCRSPACE_API_KEY;
  if (!apiKey) {
    console.log('[OCR.space] No API key');
    return false;
  }
  if (buffer.length > 950 * 1024) {
    console.log('[OCR.space] Image too large, skipping');
    return false;
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
      return false;
    }
    const text = data.ParsedResults.map(r => r.ParsedText).join(' ').trim();
    if (!text) {
      console.log('[OCR.space] No text');
      return false;
    }
    console.log(`[OCR.space] Text: "${text}"`);
    if (wordFilter.checkContent(text, true)) {
      console.log('[OCR.space] BAD content detected');
      return true;
    }
    return false;
  } catch (e) {
    if (e.name === 'AbortError') console.error('[OCR.space] Timeout');
    else console.error('[OCR.space] Error:', e.message);
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

async function checkBufferImage(buffer) {
  console.log('[imageFilter] Processing image...');
  const b64 = buffer.toString('base64');
  const easyPromise = (async () => {
    try { return await sendToPython('ocr', { image: b64 }); }
    catch { return null; }
  })();
  const ocrPromise = checkOCRSpace(buffer);
  const ocrSpaceBad = await ocrPromise;
  if (ocrSpaceBad) {
    console.log('[OCR.space] BAD content detected');
    return true;
  }
  const easyResult = await easyPromise;
  if (easyResult && easyResult.texts && easyResult.texts.length > 0) {
    const text = easyResult.texts.join(' ');
    console.log(`[OCR] EasyOCR: ${easyResult.count} blocks`);
    for (let i = 0; i < easyResult.texts.length; i++) {
      console.log(`[OCR] Block ${i}: "${easyResult.texts[i]}"`);
    }
    if (wordFilter.checkContent(text, true)) {
      console.log('[OCR] BAD content detected');
      return true;
    }
    for (const block of easyResult.texts) {
      if (wordFilter.checkContent(block, true)) {
        console.log('[OCR] BAD content detected in block');
        return true;
      }
    }
    console.log('[OCR] Content OK');
    return false;
  }
  if (easyResult && easyResult.error) {
    console.error('[imageFilter] EasyOCR error:', easyResult.error);
  }
  if (!easyResult || !easyResult.texts || easyResult.texts.length === 0) {
    console.log('[OCR] No text extracted from EasyOCR');
  }
  return false;
}

process.on('exit', () => {
  if (pyProcess) pyProcess.kill();
});

startPython();

module.exports = { checkBufferImage };
