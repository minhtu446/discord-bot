const wordFilter = require('./wordFilter');
const config = require('../config');

const GEMINI_MODEL = process.env.GEMINI_BADWORD_MODEL || 'gemini-3.6-flash';
const GEMINI_TIMEOUT_MS = 35000;
const MAX_IMAGE_BYTES = 15 * 1024 * 1024;
const TOKEN_COOLDOWN_MS = 60 * 1000;
const MAX_PARALLEL = 2;
const MAX_ATTEMPTS = 2;

let keyIndex = 0;
const tokenCooldownUntil = [];

const pendingJobs = [];
let activeCount = 0;

function getKeys() {
  const raw = process.env.GEMINI_BADWORD_KEY || '';
  const keys = raw.split(',').map(s => s.trim()).filter(Boolean);
  return keys;
}

function enqueue(task) {
  return new Promise((resolve, reject) => {
    pendingJobs.push({ task, resolve, reject });
    drain();
  });
}

function drain() {
  while (activeCount < MAX_PARALLEL && pendingJobs.length > 0) {
    const job = pendingJobs.shift();
    activeCount++;
    Promise.resolve()
      .then(job.task)
      .then(job.resolve)
      .catch(job.reject)
      .finally(() => {
        activeCount--;
        drain();
      });
  }
}

const OCR_PROMPT = `Đây là một ảnh. Hãy đọc toàn bộ chữ xuất hiện trong ảnh (kể cả chữ viết tay, in đậm, in nghiêng, chữ nhỏ).
Trả về CHỈ một đối tượng JSON (không markdown, không gì khác) với 3 trường:
- "text": chuỗi gồm các cụm chữ đọc được, mỗi cụm cách nhau bằng dấu cách 2 lần. Để rỗng "" nếu ảnh không có chữ.
- "bad": true nếu ảnh chứa từ ngữ thô tục, chửi thề, xúc phạm, tục tĩu, ám chỉ nhạy cảm bằng tiếng Việt hoặc bất kỳ ngôn ngữ nào. Ngược lại false.
- "badWords": mảng các từ/cụm từ thô tục tìm thấy, để [] nếu không có.
Không được thêm bất cứ gì ngoài JSON.`;

function clampModelText(s, max) {
  const t = (s || '').trim();
  return t.length > max ? t.slice(0, max) + '…' : t;
}

function maskKey(key) {
  const k = String(key || '');
  return k.length > 8 ? `...${k.slice(-8)}` : k;
}

function isQuotaExhausted(status, body) {
  if (status === 429) return true;
  const up = (body || '').toUpperCase();
  return up.includes('RESOURCE_EXHAUSTED') || up.includes('RATE_LIMIT') || up.includes('QUOTA');
}

async function notifyQuotaExhausted(client, detail) {
  const reason = detail || 'không xác định';
  console.error(`[imageFilter] ⚠️ Gemini badword HẾT TOKEN/QUOTA! Không scan được ảnh này. (${reason})`);
  try {
    const logChannelId = config.logChannelId;
    if (logChannelId && client) {
      const channel = client.channels.cache.get(logChannelId);
      if (channel && channel.isTextBased()) {
        await channel.send(
          `⚠️ **Gemini badword HẾT TOKEN/QUOTA!**\nẢnh này tạm không được scan cho tới khi quota/rate-limit reset (~60s).\nLý do: \`${(reason || '').slice(0, 500)}\``
        );
      }
    }
  } catch {}
}

async function callGeminiVision(buffer, mimeType, client) {
  const keys = getKeys();
  if (keys.length === 0) return { error: 'Không có API key Gemini badword' };
  if (buffer.length > MAX_IMAGE_BYTES) {
    return { error: 'Ảnh quá lớn (>15MB), bỏ qua' };
  }
  const b64 = buffer.toString('base64');
  const now = Date.now();

  const order = [];
  for (let i = 0; i < keys.length; i++) {
    const idx = (keyIndex + i) % keys.length;
    if ((tokenCooldownUntil[idx] || 0) <= now) order.push(idx);
  }
  if (order.length === 0) order.push(keyIndex % keys.length);

  const attempts = Math.min(order.length, MAX_ATTEMPTS);
  let lastError = null;
  for (let a = 0; a < attempts; a++) {
    const idx = order[a];
    const apiKey = keys[idx];
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), GEMINI_TIMEOUT_MS);
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': apiKey,
        },
        body: JSON.stringify({
          contents: [{
            parts: [
              { inline_data: { mime_type: mimeType || 'image/png', data: b64 } },
              { text: OCR_PROMPT },
            ],
          }],
          generationConfig: { responseMimeType: 'application/json' },
        }),
        signal: controller.signal,
      });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        const detail = `Gemini HTTP ${res.status} ${body.slice(0, 200)}`;
        if (isQuotaExhausted(res.status, body)) {
          tokenCooldownUntil[idx] = Date.now() + TOKEN_COOLDOWN_MS;
          lastError = { error: detail, key: apiKey };
          continue;
        }
        return { error: detail };
      }
      const data = await res.json();
      const candidate = data?.candidates?.[0];
      const raw = candidate?.content?.parts?.map(p => p.text || '').join('') || '';
      if (!raw) return { error: 'Gemini empty reply' };
      let parsed = null;
      try {
        parsed = JSON.parse(raw);
      } catch {
        const m = raw.match(/\{[\s\S]*\}/);
        if (m) {
          try { parsed = JSON.parse(m[0]); } catch { parsed = null; }
        }
      }
      if (!parsed || typeof parsed !== 'object') {
        return { error: 'Gemini reply không phải JSON' };
      }
      keyIndex = (idx + 1) % keys.length;
      return {
        model: GEMINI_MODEL,
        text: String(parsed.text || '').trim(),
        bad: !!parsed.bad,
        badWords: Array.isArray(parsed.badWords) ? parsed.badWords.map(String) : [],
      };
    } catch (e) {
      if (e.name === 'AbortError') {
        tokenCooldownUntil[idx] = Date.now() + TOKEN_COOLDOWN_MS;
        lastError = { error: 'Gemini timeout', key: apiKey };
        continue;
      }
      lastError = { error: `Gemini ${e.message}`, key: apiKey };
      continue;
    } finally {
      clearTimeout(timeout);
    }
  }

  if (lastError) {
    const keyNote = maskKey(lastError.key);
    const detail = lastError.key
      ? `${lastError.error} (key ${keyNote} bị cooldown, đã thử ${attempts} key)`
      : lastError.error;
    await notifyQuotaExhausted(client, detail);
    return { error: detail };
  }
  return { error: 'Gemini fail' };
}

async function analyzeImageInternal(buffer, guildId, mimeType, client) {
  console.log('[imageFilter] Processing image via Gemini vision...');
  const report = {
    bad: false,
    matched: null,
    gemini: { text: '', bad: false, badWords: [], error: null, skipped: false },
  };
  const g = await callGeminiVision(buffer, mimeType, client);
  if (g.error) {
    console.error('[imageFilter] Gemini error:', g.error);
    report.gemini.error = g.error;
    return report;
  }
  report.gemini.text = clampModelText(g.text, 1000);
  report.gemini.bad = g.bad;
  report.gemini.badWords = g.badWords;
  report.bad = g.bad;
  if (g.text) {
    console.log('[imageFilter] Gemini text:', JSON.stringify(g.text.slice(0, 300)));
    const hit = wordFilter.checkContentDetailed(g.text, true, guildId);
    if (hit) {
      console.error(`[imageFilter] BAD content detected: "${hit.word}" (via ${hit.mode})`);
      report.bad = true;
      report.matched = hit;
    }
  }
  if (report.bad) {
    console.log('[imageFilter] Image flagged as BAD');
  } else {
    console.log('[imageFilter] Image OK');
  }
  return report;
}

async function analyzeImageFromUrl(url, guildId, mimeType, client) {
  const res = await fetch(url).catch(() => null);
  if (!res) return { bad: false, matched: null, gemini: { text: '', bad: false, badWords: [], error: 'Không tải được ảnh', skipped: false } };
  const arrBuf = await res.arrayBuffer().catch(() => null);
  if (!arrBuf) return { bad: false, matched: null, gemini: { text: '', bad: false, badWords: [], error: 'Không đọc được ảnh', skipped: false } };
  return analyzeImageInternal(Buffer.from(arrBuf), guildId, mimeType, client);
}

async function analyzeImage(buffer, guildId, mimeType, client) {
  return enqueue(() => analyzeImageInternal(buffer, guildId, mimeType, client));
}

async function checkBufferImage(url, guildId, mimeType, client) {
  const report = await enqueue(() => analyzeImageFromUrl(url, guildId, mimeType, client));
  return report.bad;
}

async function checkBufferImageReport(url, guildId, mimeType, client) {
  return enqueue(() => analyzeImageFromUrl(url, guildId, mimeType, client));
}

module.exports = { checkBufferImage, checkBufferImageReport, analyzeImage };