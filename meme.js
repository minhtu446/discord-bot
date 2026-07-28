let cachedMemes = [];
let lastFetch = 0;
const CACHE_TTL = 10 * 60 * 1000;

async function fetchImgflip() {
  const now = Date.now();
  if (cachedMemes.length === 0 || now - lastFetch > CACHE_TTL) {
    try {
      const res = await fetch('https://api.imgflip.com/get_memes');
      if (res.ok) {
        const data = await res.json();
        if (data?.data?.memes?.length) {
          cachedMemes = data.data.memes;
          lastFetch = now;
        }
      }
    } catch (e) {
      console.error('[Meme] Imgflip error:', e.message);
    }
  }
  if (cachedMemes.length === 0) return null;
  const meme = cachedMemes[Math.floor(Math.random() * cachedMemes.length)];
  return { url: meme.url, title: meme.name };
}

async function fetchMemeApi() {
  try {
    const res = await fetch('https://meme-api.com/gimme');
    if (!res.ok) return null;
    const data = await res.json();
    if (data.url) return { url: data.url, title: data.title || '' };
  } catch (e) {
    console.error('[Meme] meme-api.com error:', e.message);
  }
  return null;
}

async function generateMeme() {
  const sources = [fetchImgflip, fetchMemeApi];
  const shuffled = sources.sort(() => Math.random() - 0.5);
  for (const fetcher of shuffled) {
    const result = await fetcher();
    if (result) return result;
  }
  return null;
}

module.exports = { generateMeme };
