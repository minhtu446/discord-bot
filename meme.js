const config = require('./config');

let templates = null;
let lastFetch = 0;
const CACHE_TTL = 3600000;

const IMGFLIP_USER = config.imgflipUsername || 'SuperBotMeme2024';
const IMGFLIP_PASS = config.imgflipPassword || 'meme2024bot';

const FUNNY_TOPS = [
  'Khi bạn', 'Mẹ bạn', 'Ông bà bạn', 'Bạn thân', 'Thằng bạn', 'Con bạn',
  'Boss', 'Sếp', 'Thầy giáo', 'Người yêu', 'Crush', 'Hàng xóm',
  'Em bé', 'Con mèo', 'Con chó', 'Admin', 'Mod', 'Bot',
];

const FUNNY_BOTTOMS = [
  'nhìn thấy tin này', 'đọc được câu này', 'đang làm cái này',
  'biết sự thật', 'gặp hôm nay', 'nghe tin đó',
  'nhắn tin xong', 'thấy meme này', 'đang online',
  'vừa tỉnh dậy', 'đang ăn cơm', 'đang tắm',
];

async function fetchTemplates() {
  if (templates && Date.now() - lastFetch < CACHE_TTL) return templates;
  try {
    const res = await fetch('https://api.imgflip.com/get_memes');
    const data = await res.json();
    if (data.success && data.data?.memes) {
      templates = data.data.memes.filter(m => m.box_count <= 2);
      lastFetch = Date.now();
    }
  } catch {}
  return templates || [];
}

function randomFrom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

async function generateMeme(userText) {
  const list = await fetchTemplates();
  if (!list.length) return null;

  const template = randomFrom(list);
  let text0, text1;

  if (userText) {
    text0 = randomFrom(FUNNY_TOPS);
    text1 = userText;
  } else {
    text0 = randomFrom(FUNNY_TOPS);
    text1 = randomFrom(FUNNY_BOTTOMS);
  }

  const body = new URLSearchParams();
  body.append('template_id', template.id);
  body.append('username', IMGFLIP_USER);
  body.append('password', IMGFLIP_PASS);
  body.append('text0', text0);
  body.append('text1', text1);

  const res = await fetch('https://api.imgflip.com/caption_image', {
    method: 'POST',
    body,
  });
  const data = await res.json();
  if (data.success && data.data?.url) return data.data.url;
  console.error('[Meme] Imgflip error:', data.error_message);
  return null;
}

module.exports = { generateMeme };
