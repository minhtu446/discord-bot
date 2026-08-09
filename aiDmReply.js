const config = require('./config');
const jsonCache = require('./jsonCache');

const OR_MODEL = process.env.OPENROUTER_MODEL || 'google/gemma-4-31b-it:free';
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
const TIMEOUT_MS = 60000;
const MAX_INPUT = 1500;
const OR_MAX_TOKENS = 4096;
const GEMINI_MAX_OUTPUT = 8192;
const MAX_CONTINUATIONS = 3;
const MAX_HISTORY = 20;
const MAX_ENTRY_CHARS = 300;
const MAX_CONTEXT = 4000;

const historyPath = jsonCache.getPath('aiDmHistory.json');
const conversationHistory = jsonCache.readJSONObject(historyPath);

const BASE_SYSTEM_PROMPT = 'Bạn là Clowo, một trợ lý AI thân thiện trong một bot Discord. Chỉ giới thiệu tên khi được hỏi trực tiếp "bạn là ai" hoặc "tên bạn là gì". Không tự giới thiệu lại bản thân trong mọi câu trả lời. Với tin nhắn ngắn như "ồ", "ok", "hi", hãy đáp lại tự nhiên theo ngữ cảnh cuộc trò chuyện, không chào hỏi lại từ đầu. Trả lời tự nhiên bằng tiếng Việt, không lan man. Khi được yêu cầu viết code, hãy viết code đầy đủ bằng markdown code block, đừng từ chối hay trả lời vắn tắt. Khi giải bài tập lập trình, đi thẳng vào lời giải: ý tưởng ngắn gọn + code hoàn chỉnh bằng markdown code block, không chào hỏi dài dòng. Nếu không rõ điều gì, hỏi lại lịch sự.';

function vietnamNow() {
  try {
    return new Intl.DateTimeFormat('vi-VN', {
      timeZone: 'Asia/Ho_Chi_Minh',
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
    }).format(new Date());
  } catch {
    return new Date().toString();
  }
}

function buildSystemPrompt() {
  return `${BASE_SYSTEM_PROMPT}\n\nThời gian hiện tại: ${vietnamNow()} (giờ Việt Nam, múi giờ Asia/Ho_Chi_Minh). Khi được hỏi về giờ/ngày/tháng/năm hoặc đếm ngày còn lại đến một dịp, hãy dựa vào thời gian này và tính toán theo năm hiện tại.`;
}

let orFails = 0;
let skipOrUntil = 0;

function pickGeminiKey() {
  const keys = (process.env.GEMINI_KEYS || '')
    .split(',').map(k => k.trim()).filter(Boolean);
  if (keys.length === 0) return null;
  return keys[Math.floor(Math.random() * keys.length)];
}

async function callOpenRouter(content, prevReply) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) return { error: 'missing OPENROUTER_API_KEY' };
  const messages = [
    { role: 'system', content: buildSystemPrompt() },
    { role: 'user', content },
  ];
  if (prevReply) {
    messages.push({ role: 'assistant', content: prevReply });
    messages.push({ role: 'user', content: 'Tiếp tục chính xác từ chỗ dừng, không lặp lại phần đã viết.' });
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ model: OR_MODEL, messages, max_tokens: OR_MAX_TOKENS }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      return { error: `OpenRouter HTTP ${res.status} ${body.slice(0, 200)}` };
    }
    const data = await res.json();
    const choice = data?.choices?.[0];
    const reply = choice?.message?.content;
    if (!reply) return { error: 'OpenRouter empty reply' };
    if (choice?.finish_reason === 'length') {
      console.error('[AI-DM] OpenRouter finish_reason=length');
    }
    return { reply: reply.trim(), truncated: choice?.finish_reason === 'length' };
  } catch (e) {
    if (e.name === 'AbortError') return { error: 'OpenRouter timeout' };
    return { error: `OpenRouter ${e.message}` };
  } finally {
    clearTimeout(timeout);
  }
}

async function callGemini(content, apiKey, prevReply) {
  const contents = [{ parts: [{ text: content }] }];
  if (prevReply) {
    contents.push({ role: 'model', parts: [{ text: prevReply }] });
    contents.push({ role: 'user', parts: [{ text: 'Tiếp tục chính xác từ chỗ dừng, không lặp lại phần đã viết.' }] });
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents,
        systemInstruction: { parts: [{ text: buildSystemPrompt() }] },
        generationConfig: { maxOutputTokens: GEMINI_MAX_OUTPUT },
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      return { error: `Gemini HTTP ${res.status} ${body.slice(0, 200)}` };
    }
    const data = await res.json();
    const candidate = data?.candidates?.[0];
    const reply = candidate?.content?.parts?.map(p => p.text || '').join('');
    if (!reply) return { error: 'Gemini empty reply' };
    const fr = candidate?.finishReason;
    if (fr && fr !== 'STOP') {
      console.error(`[AI-DM] Gemini finishReason=${fr}`);
    }
    return { reply: reply.trim(), truncated: fr === 'MAX_TOKENS' || fr === 'SAFETY' || fr === 'OTHER' };
  } catch (e) {
    if (e.name === 'AbortError') return { error: 'Gemini timeout' };
    return { error: `Gemini ${e.message}` };
  } finally {
    clearTimeout(timeout);
  }
}

async function generateWithContinuation(callOnce, label) {
  let accumulated = '';
  for (let i = 0; i < MAX_CONTINUATIONS; i++) {
    const res = await callOnce(accumulated || null);
    if (res.error) {
      if (accumulated) {
        console.error(`[AI-DM] ${label} continuation error after partial reply: ${res.error}`);
        return { reply: accumulated };
      }
      return { error: res.error };
    }
    accumulated = accumulated ? `${accumulated}\n${res.reply}` : res.reply;
    if (!res.truncated) return { reply: accumulated };
  }
  console.error(`[AI-DM] ${label} hit max continuations (${MAX_CONTINUATIONS})`);
  return { reply: accumulated };
}

async function generateReply(content) {
  let error = null;
  const geminiKey = pickGeminiKey();
  if (geminiKey) {
    const gm = await generateWithContinuation(prev => callGemini(content, geminiKey, prev), 'Gemini');
    if (gm.reply) return { reply: gm.reply };
    error = gm.error;
  } else {
    error = 'missing GEMINI_KEYS';
  }
  if (Date.now() < skipOrUntil) {
    return { error: error || 'no provider' };
  }
  const or = await generateWithContinuation(prev => callOpenRouter(content, prev), 'OpenRouter');
  if (or.reply) {
    orFails = 0;
    return { reply: or.reply };
  }
  orFails++;
  if (orFails >= 3) {
    skipOrUntil = Date.now() + 300000;
    orFails = 0;
  }
  error = error ? `${error} | ${or.error}` : or.error;
  return { error: error || 'no provider available' };
}

function addHistory(userId, role, content) {
  if (!userId || !content || !content.trim()) return;
  const text = content.trim().slice(0, MAX_ENTRY_CHARS);
  const arr = conversationHistory[userId] || [];
  arr.push({ role, content: text });
  if (arr.length > MAX_HISTORY) arr.splice(0, arr.length - MAX_HISTORY);
  conversationHistory[userId] = arr;
  jsonCache.writeJSON(historyPath, conversationHistory);
}

function buildContext(userId, current) {
  const arr = conversationHistory[userId] || [];
  const lines = [];
  for (const entry of arr) {
    lines.push(`${entry.role === 'assistant' ? 'Clowo' : 'Người dùng'}: ${entry.content}`);
  }
  let context = lines.join('\n');
  const currentText = current.trim();
  if (context) {
    context += `\nNgười dùng: ${currentText}`;
  } else {
    context = currentText;
  }
  return context.slice(0, MAX_CONTEXT);
}

function splitReply(text, maxLen = 2000) {
  const parts = [];
  let remaining = text;
  while (remaining.length > 0) {
    if (remaining.length <= maxLen) {
      parts.push(remaining);
      break;
    }
    let cut = remaining.lastIndexOf('\n', maxLen);
    if (cut <= 0) cut = remaining.lastIndexOf(' ', maxLen);
    if (cut <= 0) cut = maxLen;
    parts.push(remaining.slice(0, cut));
    remaining = remaining.slice(cut).trim();
  }
  return parts;
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
  const userId = message.author.id;
  addHistory(userId, 'user', message.content);
  try {
    await message.channel.sendTyping().catch(() => {});
    const result = await generateReply(buildContext(userId, message.content.slice(0, MAX_INPUT)));
    if (result.reply) {
      for (const part of splitReply(result.reply)) {
        await message.channel.send(part).catch(e => console.error('[AI-DM] Send reply failed:', e.message));
      }
      addHistory(userId, 'assistant', result.reply);
    } else {
      console.error('[AI-DM] Reply failed:', result.error);
      await surfaceError(message, result.error);
    }
  } catch (e) {
    console.error('[AI-DM] handleMessage error:', e.message);
  }
}

module.exports = { handleMessage, addHistory };
