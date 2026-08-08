const config = require('./config');

const OR_MODEL = process.env.OPENROUTER_MODEL || 'google/gemma-4-31b-it:free';
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
const TIMEOUT_MS = 60000;
const MAX_INPUT = 1500;
const MAX_TOKENS = 1024;

const SYSTEM_PROMPT = 'Bạn là Clooo-Glark, một trợ lý AI thân thiện trong một bot Discord. Khi được hỏi "bạn là ai" hoặc "tên bạn là gì", hãy trả lời bạn là Clooo-Glark. Trả lời tự nhiên bằng tiếng Việt, không lan man. Khi được yêu cầu viết code, hãy viết code đầy đủ bằng markdown code block, đừng từ chối hay trả lời vắn tắt. Nếu không rõ điều gì, hỏi lại lịch sự.';

let orFails = 0;
let skipOrUntil = 0;

function pickGeminiKey() {
  const keys = (process.env.GEMINI_KEYS || '')
    .split(',').map(k => k.trim()).filter(Boolean);
  if (keys.length === 0) return null;
  return keys[Math.floor(Math.random() * keys.length)];
}

async function callOpenRouter(content) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) return { error: 'missing OPENROUTER_API_KEY' };
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: OR_MODEL,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content },
        ],
        max_tokens: MAX_TOKENS,
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      return { error: `OpenRouter HTTP ${res.status} ${body.slice(0, 200)}` };
    }
    const data = await res.json();
    const reply = data?.choices?.[0]?.message?.content;
    if (!reply) return { error: 'OpenRouter empty reply' };
    return { reply: reply.slice(0, 2000) };
  } catch (e) {
    if (e.name === 'AbortError') return { error: 'OpenRouter timeout' };
    return { error: `OpenRouter ${e.message}` };
  } finally {
    clearTimeout(timeout);
  }
}

async function callGemini(content, apiKey) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: content }] }],
        systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
        generationConfig: { maxOutputTokens: MAX_TOKENS },
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      return { error: `Gemini HTTP ${res.status} ${body.slice(0, 200)}` };
    }
    const data = await res.json();
    const reply = data?.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('').trim();
    if (!reply) return { error: 'Gemini empty reply' };
    return { reply: reply.slice(0, 2000) };
  } catch (e) {
    if (e.name === 'AbortError') return { error: 'Gemini timeout' };
    return { error: `Gemini ${e.message}` };
  } finally {
    clearTimeout(timeout);
  }
}

async function generateReply(content) {
  let error = null;
  if (Date.now() >= skipOrUntil) {
    const or = await callOpenRouter(content);
    if (or.reply) {
      orFails = 0;
      return { reply: or.reply };
    }
    error = or.error;
    orFails++;
    if (orFails >= 3) {
      skipOrUntil = Date.now() + 300000;
      orFails = 0;
    }
  }
  const geminiKey = pickGeminiKey();
  if (geminiKey) {
    const gm = await callGemini(content, geminiKey);
    if (gm.reply) return { reply: gm.reply };
    error = error ? `${error} | ${gm.error}` : gm.error;
  }
  return { error: error || 'no provider available' };
}

async function surfaceError(message, error) {
  try {
    const logChannelId = config.logChannelId;
    if (!logChannelId) return;
    const channel = message.client.channels.cache.get(logChannelId);
    if (channel && channel.isTextBased()) {
      await channel.send(`⚠️ **AI DM reply lỗi**: \`${error}\``).catch(() => {});
    }
  } catch {}
}

async function handleMessage(message) {
  if (!message.content || !message.content.trim()) return;
  try {
    await message.channel.sendTyping().catch(() => {});
    const result = await generateReply(message.content.slice(0, MAX_INPUT));
    if (result.reply) {
      await message.channel.send(result.reply).catch(e => console.error('[AI-DM] Send reply failed:', e.message));
    } else {
      console.error('[AI-DM] Reply failed:', result.error);
      await surfaceError(message, result.error);
    }
  } catch (e) {
    console.error('[AI-DM] handleMessage error:', e.message);
  }
}

module.exports = { handleMessage };
