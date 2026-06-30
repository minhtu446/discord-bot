const { GoogleGenerativeAI } = require('@google/generative-ai');

const KEYS = (process.env.GEMINI_API_KEYS || '').split(',').filter(Boolean);
let keyIndex = 0;
let clients = KEYS.map(k => ({ key: k, client: new GoogleGenerativeAI(k), fails: 0 }));

const MAX_FAILS = 3;
const TIMEOUT = 30000;

function getClient() {
  if (clients.length === 0) return null;
  const start = keyIndex;
  while (true) {
    const c = clients[keyIndex];
    if (c.fails < MAX_FAILS) return c;
    keyIndex = (keyIndex + 1) % clients.length;
    if (keyIndex === start) break;
  }
  return clients[keyIndex];
}

function markFail(client) {
  client.fails++;
  if (client.fails >= MAX_FAILS) {
    console.log(`[Gemini] Key ${client.key.substring(0, 15)}... đã hết hạn, chuyển key khác`);
  }
  keyIndex = (keyIndex + 1) % clients.length;
}

function resetFails() {
  for (const c of clients) c.fails = 0;
}

async function analyzeVideoFrames(frames, prompt) {
  if (clients.length === 0) return null;

  let gc = getClient();
  if (!gc) {
    resetFails();
    gc = getClient();
    if (!gc) return null;
  }

  try {
    const model = gc.client.getGenerativeModel({ model: 'gemini-1.5-flash' });

    const content = [
      { text: prompt },
      ...frames.map(frame => ({
        inlineData: { mimeType: 'image/png', data: frame.toString('base64') }
      }))
    ];

    const result = await Promise.race([
      model.generateContent({ contents: [{ role: 'user', parts: content }] }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), TIMEOUT))
    ]);

    const text = result.response.text().toLowerCase().trim();
    return text.startsWith('yes') || text.startsWith('có') || text === 'true' || text === '1';
  } catch (e) {
    console.error('[Gemini] analyzeVideoFrames error:', e.message);
    markFail(gc);
    return null;
  }
}

const AIHOI_PROMPT = `Phân tích các frame từ video này và trả lời CHỈ MỘT TỪ: "YES" nếu video có nội dung AI hỏi (AI begging, AI-generated voice hoặc text begging, quảng cáo bot, link lừa đảo), "NO" nếu không.`;

async function checkAiHoi(frames) {
  return await analyzeVideoFrames(frames, AIHOI_PROMPT);
}

module.exports = { checkAiHoi, analyzeVideoFrames };
