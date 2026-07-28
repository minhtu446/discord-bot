const FUNNY_TITLES = [
  'Khi bạn', 'Mẹ bạn', 'Ông bà bạn', 'Bạn thân', 'Thằng bạn',
  'Boss', 'Sếp', 'Thầy giáo', 'Người yêu', 'Crush',
  'Em bé', 'Con mèo', 'Admin', 'Mod', 'Bot',
];

async function generateMeme(userText) {
  try {
    const res = await fetch('https://meme-api.com/gimme');
    if (!res.ok) return null;
    const data = await res.json();
    if (data.url) return { url: data.url, title: data.title || '' };
  } catch (e) {
    console.error('[Meme] API error:', e.message);
  }
  return null;
}

module.exports = { generateMeme };
