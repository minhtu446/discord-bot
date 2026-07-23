const jsonCache = require('../jsonCache');

const badWordsPath = jsonCache.getPath('badWords.json');

function loadBadWords() {
  return jsonCache.readJSONArray(badWordsPath);
}

function addBadWord(word) {
  const list = loadBadWords();
  const normal = normalizeText(word, true);
  if (!normal) return list;
  if (!list.includes(normal)) {
    list.push(normal);
    jsonCache.writeJSON(badWordsPath, list);
  }
  return list;
}

function removeBadWord(word) {
  const normal = normalizeText(word, true);
  if (!normal) return loadBadWords();
  let list = loadBadWords();
  list = list.filter(w => w !== normal);
  jsonCache.writeJSON(badWordsPath, list);
  return list;
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
  [/0/g, 'o'], [/1/g, 'i'], [/2/g, 'a'], [/3/g, 'e'], [/4/g, 'a'],
  [/5/g, 's'], [/6/g, 'g'], [/7/g, 'l'], [/8/g, 'b'], [/9/g, 'g'],
  [/b/g, 'h'], [/c/g, 'e'], [/d/g, 'h'], [/f/g, 'p'], [/@/g, 'j'],
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
  t = t.replace(/\s+/g, '');
  return t;
}

function ocrFuzzyMatch(normalText, badCompact) {
  if (!normalText || !badCompact) return false;
  const clean = normalText.replace(/\s+/g, '');
  if (clean.includes(badCompact)) return true;
  const chars = clean.split('').map(c => {
    const v = OCR_VARIANTS[c];
    return v ? [c, ...v] : [c];
  });
  for (let i = 0; i <= chars.length - badCompact.length; i++) {
    let match = true;
    for (let j = 0; j < badCompact.length; j++) {
      if (!chars[i + j].includes(badCompact[j])) {
        match = false;
        break;
      }
    }
    if (match) return true;
  }
  return false;
}

function checkContent(text, isOcr) {
  if (!text) return false;
  const normal = normalizeText(text);
  const compact = normal.replace(/[^a-z0-9]/g, '');
  const list = loadBadWords();
  for (const bad of list) {
    if (normal.includes(bad)) return true;
    const badCompact = bad.replace(/\s+/g, '');
    if (compact.includes(bad)) return true;
    if (normal.includes(badCompact)) return true;
    if (compact.includes(badCompact)) return true;
    if (isOcr) {
      const ocr = ocrNormalize(text);
      if (ocr.includes(badCompact)) return true;
      if (ocrFuzzyMatch(normal, badCompact)) return true;
    }
  }
  return false;
}

module.exports = { loadBadWords, addBadWord, removeBadWord, checkContent, normalizeText };