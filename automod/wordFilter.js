const fs = require('fs');
const jsonCache = require('../jsonCache');

const badWordsPath = jsonCache.getPath('badWords.txt');

let badWordsCache = null;

function ensureFile() {
  if (!fs.existsSync(badWordsPath)) {
    fs.writeFileSync(badWordsPath, '', 'utf8');
  }
}

function parseFile() {
  ensureFile();
  const data = {};
  const content = fs.readFileSync(badWordsPath, 'utf8');
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const match = trimmed.match(/^\[(\d{17,20})\]:\s*(.*)$/);
    if (!match) continue;
    const words = match[2].split(',').map(w => w.trim()).filter(Boolean);
    if (words.length > 0) data[match[1]] = words;
  }
  return data;
}

function getBadWordsData() {
  if (badWordsCache) return badWordsCache;
  badWordsCache = parseFile();
  try {
    fs.watchFile(badWordsPath, () => {
      badWordsCache = null;
    });
  } catch {}
  return badWordsCache;
}

function writeFile(data) {
  ensureFile();
  const lines = [];
  for (const [guildId, words] of Object.entries(data)) {
    if (words.length > 0) {
      lines.push(`[${guildId}]: ${words.join(', ')}`);
    }
  }
  fs.writeFileSync(badWordsPath, lines.join('\n'), 'utf8');
}

function loadBadWords(guildId) {
  if (!guildId) return [];
  const data = getBadWordsData();
  return data[guildId] || [];
}

function addBadWord(word, guildId) {
  if (!guildId) return false;
  const normal = normalizeText(word, true);
  if (!normal) return false;
  const data = getBadWordsData();
  if (!data[guildId]) data[guildId] = [];
  if (data[guildId].includes(normal)) return false;
  data[guildId].push(normal);
  writeFile(data);
  return true;
}

function removeBadWord(word, guildId) {
  if (!guildId) return false;
  const normal = normalizeText(word, true);
  if (!normal) return false;
  const data = getBadWordsData();
  if (!data[guildId]) return false;
  const idx = data[guildId].indexOf(normal);
  if (idx === -1) return false;
  data[guildId].splice(idx, 1);
  writeFile(data);
  return true;
}

function stripMarkdown(text) {
  return text
    .replace(/\|\|/g, '')
    .replace(/~~/g, '')
    .replace(/```?/g, '')
    .replace(/\*\*\*/g, '')
    .replace(/___/g, '')
    .replace(/\*\*/g, '')
    .replace(/__/g, '')
    .replace(/(?<!\w)\*(?!\w)/g, '')
    .replace(/(?<!\w)_(?!\w)/g, '')
    .replace(/^\s*>>>\s*/gm, '')
    .replace(/^\s*>\s*/gm, '')
    .replace(/^\s*-#\s+/gm, '');
}

function stripDiacritics(text) {
  const map = {
    'à':'a','á':'a','ả':'a','ã':'a','ạ':'a','ă':'a','ắ':'a','ằ':'a','ẳ':'a','ẵ':'a','ặ':'a','â':'a','ấ':'a','ầ':'a','ẩ':'a','ẫ':'a','ậ':'a',
    'è':'e','é':'e','ẻ':'e','ẽ':'e','ẹ':'e','ê':'e','ế':'e','ề':'e','ể':'e','ễ':'e','ệ':'e',
    'ì':'i','í':'i','ỉ':'i','ĩ':'i','ị':'i',
    'ò':'o','ó':'o','ỏ':'o','õ':'o','ọ':'o','ô':'o','ố':'o','ồ':'o','ổ':'o','ỗ':'o','ộ':'o','ơ':'o','ớ':'o','ờ':'o','ở':'o','ỡ':'o','ợ':'o',
    'ù':'u','ú':'u','ủ':'u','ũ':'u','ụ':'u','ư':'u','ứ':'u','ừ':'u','ử':'u','ữ':'u','ự':'u',
    'ỳ':'y','ý':'y','ỷ':'y','ỹ':'y','ỵ':'y',
    'đ':'d',
    'À':'A','Á':'A','Ả':'A','Ã':'A','Ạ':'A','Ă':'A','Ắ':'A','Ằ':'A','Ẳ':'A','Ẵ':'A','Ặ':'A','Â':'A','Ấ':'A','Ầ':'A','Ẩ':'A','Ẫ':'A','Ậ':'A',
    'È':'E','É':'E','Ẻ':'E','Ẽ':'E','Ẹ':'E','Ê':'E','Ế':'E','Ề':'E','Ể':'E','Ễ':'E','Ệ':'E',
    'Ì':'I','Í':'I','Ỉ':'I','Ĩ':'I','Ị':'I',
    'Ò':'O','Ó':'O','Ỏ':'O','Õ':'O','Ọ':'O','Ô':'O','Ố':'O','Ồ':'O','Ổ':'O','Ỗ':'O','Ộ':'O','Ơ':'O','Ớ':'O','Ờ':'O','Ở':'O','Ỡ':'O','Ợ':'O',
    'Ù':'U','Ú':'U','Ủ':'U','Ũ':'U','Ụ':'U','Ư':'U','Ứ':'U','Ừ':'U','Ử':'U','Ữ':'U','Ự':'U',
    'Ỳ':'Y','Ý':'Y','Ỷ':'Y','Ỹ':'Y','Ỵ':'Y',
    'Đ':'D',
    'ä':'a','Ä':'A','ë':'e','Ë':'E','ï':'i','Ï':'I','ö':'o','Ö':'O','ü':'u','Ü':'U',
  };
  return text.replace(/[^\x00-\x7F]/g, c => map[c] || c);
}

function normalizeText(text, forWord) {
  if (!text) return '';
  let result = stripMarkdown(text);
  result = stripDiacritics(result);
  result = result.replace(/\s+/g, ' ');
  result = result.trim();
  result = result.toLowerCase();
  if (forWord) result = result.replace(/[^a-z0-9 ]/g, '');
  return result;
}

const OCR_SUBS = [
  [/0/g, 'o'], [/1/g, 'i'], [/3/g, 'e'], [/4/g, 'a'],
  [/5/g, 's'], [/7/g, 'l'], [/8/g, 'b'],
  [/¡/g, 'i'], [/!/g, 'i'], [/\|/g, 'i'], [/\//g, 'i'],
];

const OCR_VARIANTS = {
  '0': ['o', 'a', 'd', 'c'],
  '1': ['i', 'l', '!', '|', '/', '\\'],
  '2': ['a', 'z', 'o', 'e'],
  '3': ['e', 'a', 'm', '8'],
  '4': ['a', 'h'],
  '5': ['s'],
  '6': ['g', 'b', 'i', 'd'],
  '7': ['l', 't', 'i', 'f'],
  '8': ['b', 'a', 'h', 'o', 's'],
  '9': ['g', 'q', 'j'],
  'a': ['o', 'e', 'd', 'g', '8', 'q'],
  'b': ['h', 'd', 'i', 'l', 'p'],
  'c': ['e', 'o', 'a'],
  'd': ['b', 'h', 'cl', 'o'],
  'e': ['a', 'o', 'c', '8'],
  'f': ['p', 't', 'h', 'l', 'b'],
  'g': ['y', 'q', '9', 'j'],
  'h': ['b', 'n', 'k', 'm', 'd'],
  'i': ['l', '1', '!', '|', '/', 'j', 'b'],
  'j': ['i', 'l', '!', '1'],
  'k': ['h', 'n', 'x', 'lc'],
  'l': ['i', '1', '!', '|', '/', 'I'],
  'm': ['n', 'rn', 'nn', 'h'],
  'n': ['h', 'm', 'r', 'u'],
  'o': ['a', 'e', '0', 'c', 'd'],
  'p': ['f', 'b', 'd'],
  'q': ['g', 'o', 'a', '9', 'd'],
  'r': ['n', 'm'],
  's': ['5', 'a', 'e'],
  't': ['l', 'f', '7', 'i', '1'],
  'u': ['v', 'n', 'i', 'o', 'a'],
  'v': ['u', 'y'],
  'w': ['v', 'u', 'vv'],
  'x': ['y', 'k'],
  'y': ['g', 'v', 'u', 'j'],
  '|': ['i', 'l', '1', '!'],
  '/': ['i', 'l', '1'],
  '\\': ['i', 'l'],
  '!': ['i', 'l', '1', '|'],
  '@': ['j', 'a'],
  '#': ['h'],
  '$': ['s'],
  '&': ['8', 'a', 'e'],
  '*': ['x'],
};

function ocrNormalize(text) {
  let t = normalizeText(text);
  t = t.replace(/[[\](){}"'`.,:;!@#\/\\|_~^=+*<>\-]/g, '');
  for (const [re, sub] of OCR_SUBS) {
    t = t.replace(re, sub);
  }
  return t.replace(/\s+/g, ' ').trim();
}

function fuzzyWordMatch(textWord, badWord) {
  if (textWord === badWord) return true;
  if (badWord.length >= 3 && textWord.includes(badWord)) return true;
  if (badWord.length < 3 || textWord.length <= badWord.length) return false;
  const allowed = badWord.length >= 6 ? 2 : 1;
  for (let start = 0; start + badWord.length <= textWord.length; start++) {
    let mismatch = 0;
    let ok = true;
    for (let i = 0; i < badWord.length; i++) {
      const c = textWord[start + i];
      if (c === badWord[i]) continue;
      const variants = OCR_VARIANTS[c];
      if (variants && variants.includes(badWord[i])) {
        mismatch++;
        if (mismatch > allowed) { ok = false; break; }
      } else { ok = false; break; }
    }
    if (ok) return true;
  }
  return false;
}

function ocrFuzzyMatch(ocrText, bad) {
  if (!ocrText || !bad) return false;
  const textWords = ocrText.split(/\s+/).filter(Boolean);
  const badWords = bad.split(/\s+/).filter(Boolean);
  if (textWords.length === 0 || badWords.length === 0) return false;
  const merged = badWords.join('');
  for (let i = 0; i < textWords.length; i++) {
    if (textWords[i] === merged) return true;
    if (i + badWords.length <= textWords.length) {
      let all = true;
      for (let j = 0; j < badWords.length; j++) {
        if (!fuzzyWordMatch(textWords[i + j], badWords[j])) { all = false; break; }
      }
      if (all) return true;
    }
  }
  return false;
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function checkContentDetailed(text, isOcr, guildId) {
  if (!text) return null;
  const normal = normalizeText(text);
  if (!normal) return null;
  const compact = normal.replace(/[^a-z0-9]/g, '');
  const list = loadBadWords(guildId);
  for (const bad of list) {
    if (bad.includes(' ')) {
      const pattern = '(^|[^a-z0-9])' + escapeRe(bad).replace(/\s+/g, '\\s+') + '([^a-z0-9]|$)';
      if (new RegExp(pattern, 'i').test(normal)) {
        return { matched: true, word: bad, mode: 'phrase' };
      }
      if (isOcr && ocrFuzzyMatch(ocrNormalize(text), bad)) {
        return { matched: true, word: bad, mode: 'ocr-fuzzy' };
      }
      continue;
    }
    if (normal.includes(bad)) return { matched: true, word: bad, mode: 'substring' };
    if (compact.includes(bad)) return { matched: true, word: bad, mode: 'compact' };
    if (isOcr && ocrFuzzyMatch(ocrNormalize(text), bad)) {
      return { matched: true, word: bad, mode: 'ocr-fuzzy' };
    }
  }
  return null;
}

function checkContent(text, isOcr, guildId) {
  return checkContentDetailed(text, isOcr, guildId) !== null;
}

module.exports = { loadBadWords, addBadWord, removeBadWord, checkContent, checkContentDetailed, normalizeText };
