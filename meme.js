const SUBS = ['vietnam'];

async function generateMeme() {
  for (const sub of SUBS) {
    try {
      const res = await fetch(`https://meme-api.com/gimme/${sub}`);
      if (!res.ok) continue;
      const data = await res.json();
      if (data.url) return { url: data.url };
    } catch (e) {
      console.error(`[Meme] ${sub} error:`, e.message);
    }
  }
  try {
    const res = await fetch('https://meme-api.com/gimme');
    if (res.ok) {
      const data = await res.json();
      if (data.url) return { url: data.url };
    }
  } catch (e) {}
  return null;
}

module.exports = { generateMeme };
