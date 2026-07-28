async function generateMeme() {
  try {
    const res = await fetch('https://meme-api.com/gimme');
    if (!res.ok) return null;
    const data = await res.json();
    if (data.url) return { url: data.url };
  } catch (e) {
    console.error('[Meme] API error:', e.message);
  }
  return null;
}

module.exports = { generateMeme };
