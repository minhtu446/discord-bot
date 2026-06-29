const jsonCache = require('../jsonCache');
const bannedWordsPath = jsonCache.getPath('bannedWords.json');

const LEET_MAP = {
  '0': 'o', '1': 'i', '2': 'z', '3': 'e', '4': 'a', '5': 's',
  '6': 'g', '7': 't', '8': 'b', '9': 'p',
  '@': 'a', '$': 's', '!': 'i', '+': 't',
};

const NORMALIZE_MAP = {
  'á': 'a', 'à': 'a', 'ả': 'a', 'ã': 'a', 'ạ': 'a',
  'â': 'a', 'ấ': 'a', 'ầ': 'a', 'ẩ': 'a', 'ẫ': 'a', 'ậ': 'a',
  'ă': 'a', 'ắ': 'a', 'ằ': 'a', 'ẳ': 'a', 'ẵ': 'a', 'ặ': 'a',
  'é': 'e', 'è': 'e', 'ẻ': 'e', 'ẽ': 'e', 'ẹ': 'e',
  'ê': 'e', 'ế': 'e', 'ề': 'e', 'ể': 'e', 'ễ': 'e', 'ệ': 'e',
  'í': 'i', 'ì': 'i', 'ỉ': 'i', 'ĩ': 'i', 'ị': 'i',
  'ó': 'o', 'ò': 'o', 'ỏ': 'o', 'õ': 'o', 'ọ': 'o',
  'ô': 'o', 'ố': 'o', 'ồ': 'o', 'ổ': 'o', 'ỗ': 'o', 'ộ': 'o',
  'ơ': 'o', 'ớ': 'o', 'ờ': 'o', 'ở': 'o', 'ỡ': 'o', 'ợ': 'o',
  'ú': 'u', 'ù': 'u', 'ủ': 'u', 'ũ': 'u', 'ụ': 'u',
  'ư': 'u', 'ứ': 'u', 'ừ': 'u', 'ử': 'u', 'ữ': 'u', 'ự': 'u',
  'ý': 'y', 'ỳ': 'y', 'ỷ': 'y', 'ỹ': 'y', 'ỵ': 'y',
  'đ': 'd',
};

function cleanText(text) {
  let result = '';
  for (const c of text.toLowerCase()) {
    const code = c.charCodeAt(0);
    const leet = LEET_MAP[c];
    if (leet) { result += leet; continue; }
    if (code >= 0xFF01 && code <= 0xFF5E) { result += String.fromCharCode(code - 0xFEE0); continue; }
    if (code === 0x3000) { result += ' '; continue; }
    result += NORMALIZE_MAP[c] || c;
  }
  result = result.replace(/[.,\-_\s0-9]+/g, '');
  result = result.replace(/[^a-z]/g, '');
  return result;
}

let cleanedCache = [];

function refreshCache() {
  const bannedWords = jsonCache.readJSONArray(bannedWordsPath);
  cleanedCache = bannedWords.map(w => cleanText(w.toLowerCase())).filter(w => w.length > 0);
}

refreshCache();

async function checkMessage(message) {
  const rawContent = (message.cleanContent || '').toLowerCase();
  if (!rawContent) return false;
  if (cleanedCache.length === 0) return false;

  const cleaned = cleanText(rawContent);
  for (const word of cleanedCache) {
    if (cleaned.includes(word)) return true;
  }
  for (const word of jsonCache.readJSONArray(bannedWordsPath)) {
    if (rawContent.includes(word.toLowerCase())) return true;
  }
  return false;
}

function levenshtein(a, b) {
  const m = a.length, n = b.length;
  const dp = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] : Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]) + 1;
    }
  }
  return dp[m][n];
}

function fuzzyMatch(cleaned, word) {
  if (cleaned.includes(word)) return true;
  const maxDist = word.length <= 3 ? 0 : word.length <= 5 ? 1 : 2;
  if (maxDist === 0) return false;
  for (let i = 0; i <= cleaned.length - word.length; i++) {
    const seg = cleaned.substring(i, i + word.length);
    if (levenshtein(seg, word) <= maxDist) return true;
  }
  return false;
}

async function checkContent(content) {
  const raw = (content || '').toLowerCase();
  if (!raw) return false;
  if (cleanedCache.length === 0) return false;

  const cleaned = cleanText(raw);
  for (const word of cleanedCache) {
    if (fuzzyMatch(cleaned, word)) return true;
  }
  for (const word of jsonCache.readJSONArray(bannedWordsPath)) {
    if (raw.includes(word.toLowerCase())) return true;
  }
  return false;
}

module.exports = { check: checkMessage, checkContent, cleanText, refreshCache };
