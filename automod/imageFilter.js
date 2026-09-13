const wordFilter = require('./wordFilter');
const config = require('../config');

const GEMINI_MODEL = process.env.GEMINI_BADWORD_MODEL || 'gemini-3.6-flash';
const GEMINI_TIMEOUT_MS = 35000;
const MAX_IMAGE_BYTES = 15 * 1024 * 1024;
const QUOTA_NOTIFY_COOLDOWN_MS = 10 * 60 * 1000;
const FAILURE_WINDOW_MS = 5 * 60 * 1000;
const FAILURE_THRESHOLD = 3;
const BREAKER_COOLDOWN_MS = 2 * 60 * 1000;

let lastQuotaNotifiedAt = 0;
let consecutiveFailures = 0;
let firstFailureAt = 0;
let rateLimitedUntil = 0;

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

function isQuotaExhausted(status, body) {
  if (status === 429) return true;
  const up = (body || '').toUpperCase();
  return up.includes('RESOURCE_EXHAUSTED') || up.includes('RATE_LIMIT') || up.includes('QUOTA');
}

async function notifyQuotaExhausted(client, detail) {
  const reason = detail || 'không xác định';
  const now = Date.now();
  if (now - lastQuotaNotifiedAt < QUOTA_NOTIFY_COOLDOWN_MS) return;
  console.error(`[imageFilter] ⚠️ Gemini badword HẾT TOKEN/QUOTA! Ảnh tạm không được scan. (${reason})`);
  let sent = false;
  try {
    const logChannelId = config.logChannelId;
    if (logChannelId && client) {
      const channel = client.channels.cache.get(logChannelId);
      if (channel && channel.isTextBased()) {
        await channel.send(
          `⚠️ **Gemini badword HẾT TOKEN/QUOTA!**\nẢnh tạm không được scan cho tới khi quota/rate-limit reset.\nLý do: \`${(reason || '').slice(0, 500)}\``
        ).catch(() => {});
        sent = true;
      }
    }
  } catch {}
  if (sent) lastQuotaNotifiedAt = now;
}

function markFailure() {
  const now = Date.now();
  if (firstFailureAt === 0) firstFailureAt = now;
  consecutiveFailures += 1;
  if (now - firstFailureAt > FAILURE_WINDOW_MS) {
    consecutiveFailures = 1;
    firstFailureAt = now;
  }
  if (consecutiveFailures >= FAILURE_THRESHOLD) {
    rateLimitedUntil = now + BREAKER_COOLDOWN_MS;
  }
}

function resetFailures() {
  consecutiveFailures = 0;
  firstFailureAt = 0;
}

async function callGeminiVision(buffer, mimeType, client) {
  const apiKey = process.env.GEMINI_BADWORD_KEY;
  if (!apiKey) return { error: 'Không có API key Gemini badword' };
  if (buffer.length > MAX_IMAGE_BYTES) {
    return { error: 'Ảnh quá lớn (>15MB), bỏ qua' };
  }
  const b64 = buffer.toString('base64');
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
      markFailure();
      if (isQuotaExhausted(res.status, body)) {
        await notifyQuotaExhausted(client, detail);
      }
      return { error: detail };
    }
    const data = await res.json();
    const candidate = data?.candidates?.[0];
    const raw = candidate?.content?.parts?.map(p => p.text || '').join('') || '';
    if (!raw) { markFailure(); return { error: 'Gemini empty reply' }; }
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
      markFailure();
      return { error: 'Gemini reply không phải JSON' };
    }
    resetFailures();
    return {
      model: GEMINI_MODEL,
      text: String(parsed.text || '').trim(),
      bad: !!parsed.bad,
      badWords: Array.isArray(parsed.badWords) ? parsed.badWords.map(String) : [],
    };
  } catch (e) {
    markFailure();
    if (e.name === 'AbortError') return { error: 'Gemini timeout' };
    return { error: `Gemini ${e.message}` };
  } finally {
    clearTimeout(timeout);
  }
}

async function analyzeImage(buffer, guildId, mimeType, client) {
  console.log('[imageFilter] Processing image via Gemini vision...');
  const report = {
    bad: false,
    matched: null,
    gemini: { text: '', bad: false, badWords: [], error: null, skipped: false },
  };
  if (rateLimitedUntil > Date.now()) {
    const wait = Math.ceil((rateLimitedUntil - Date.now()) / 1000);
    report.gemini.skipped = true;
    report.gemini.error = `Gemini đang rate-limited (nhiều ảnh/phút), tạm dừng scan ~${wait}s`;
    console.error('[imageFilter] Gemini rate-limited, skip scan:', report.gemini.error);
    await notifyQuotaExhausted(client, report.gemini.error + ". Tự thử lại sau ~" + wait + "s");
    return report;
  }
  const g = await callGeminiVision(buffer, mimeType, client);
  if (g.error) {
    console.error('[imageFilter] Gemini error:', g.error);
    report.gemini.error = g.error;
    if (consecutiveFailures >= FAILURE_THRESHOLD && rateLimitedUntil > Date.now()) {
      await notifyQuotaExhausted(
        client,
        `${g.error}. Phát hiện rate-limit (${consecutiveFailures} lần thất bại liên tiếp), tạm dừng scan ~2 phút.`
      );
    }
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

async function checkBufferImage(buffer, guildId, mimeType, client) {
  const report = await analyzeImage(buffer, guildId, mimeType, client);
  return report.bad;
}

async function checkBufferImageReport(buffer, guildId, mimeType, client) {
  return analyzeImage(buffer, guildId, mimeType, client);
}

module.exports = { checkBufferImage, checkBufferImageReport, analyzeImage };