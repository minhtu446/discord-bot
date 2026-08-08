const config = require('./config');

const MODEL = process.env.OPENROUTER_MODEL || 'google/gemma-4-31b-it:free';
const OWNER_ID = config.ownerId;
const TIMEOUT_MS = 60000;
const MAX_INPUT = 1500;
const MAX_TOKENS = 300;

async function generateReply(userName, content) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    console.log('[AI-DM] No OPENROUTER_API_KEY');
    return null;
  }
  const prompt = content.slice(0, MAX_INPUT);
  const system = 'Bạn là một trợ lý AI thân thiện trong một bot Discord. Trả lời ngắn gọn, tự nhiên, dùng tiếng Việt. Nếu không rõ điều gì, hỏi lại lịch sự.';
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
        model: MODEL,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: prompt },
        ],
        max_tokens: MAX_TOKENS,
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      console.error('[AI-DM] OpenRouter HTTP', res.status, await res.text().catch(() => ''));
      return null;
    }
    const data = await res.json();
    const reply = data?.choices?.[0]?.message?.content;
    if (!reply) {
      console.error('[AI-DM] Empty reply from OpenRouter');
      return null;
    }
    return reply.slice(0, 2000);
  } catch (e) {
    if (e.name === 'AbortError') console.error('[AI-DM] OpenRouter timeout');
    else console.error('[AI-DM] OpenRouter error:', e.message);
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function handleMessage(message) {
  if (message.author.id === OWNER_ID) return;
  if (!message.content || !message.content.trim()) return;
  try {
    await message.channel.sendTyping().catch(() => {});
    const reply = await generateReply(message.author.username, message.content);
    if (reply) {
      await message.channel.send(reply).catch(e => console.error('[AI-DM] Send reply failed:', e.message));
    }
  } catch (e) {
    console.error('[AI-DM] handleMessage error:', e.message);
  }
}

module.exports = { handleMessage };
