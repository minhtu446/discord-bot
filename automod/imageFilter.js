const wordFilter = require('./wordFilter');

const GEMINI_MODEL = process.env.GEMINI_BADWORD_MODEL || 'gemini-3.6-flash';
const GEMINI_TIMEOUT_MS = 35000;
const MAX_IMAGE_BYTES = 15 * 1024 * 1024;

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

async function callGeminiVision(buffer, mimeType) {
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
      return { error: `Gemini HTTP ${res.status} ${body.slice(0, 200)}` };
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
    return {
      model: GEMINI_MODEL,
      text: String(parsed.text || '').trim(),
      bad: !!parsed.bad,
      badWords: Array.isArray(parsed.badWords) ? parsed.badWords.map(String) : [],
    };
  } catch (e) {
    if (e.name === 'AbortError') return { error: 'Gemini timeout' };
    return { error: `Gemini ${e.message}` };
  } finally {
    clearTimeout(timeout);
  }
}

async function analyzeImage(buffer, guildId, mimeType) {
  console.log('[imageFilter] Processing image via Gemini vision...');
  const report = {
    bad: false,
    matched: null,
    gemini: { text: '', bad: false, badWords: [], error: null, skipped: false },
  };
  const g = await callGeminiVision(buffer, mimeType);
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

async function checkBufferImage(buffer, guildId, mimeType) {
  const report = await analyzeImage(buffer, guildId, mimeType);
  return report.bad;
}

async function checkBufferImageReport(buffer, guildId, mimeType) {
  return analyzeImage(buffer, guildId, mimeType);
}

module.exports = { checkBufferImage, checkBufferImageReport, analyzeImage };