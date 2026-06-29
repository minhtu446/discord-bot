const jsonCache = require('./jsonCache');
const dictPath = jsonCache.getPath('dict.json');
const validWordsPath = jsonCache.getPath('validWords.json');

let wordDict = null;
let validWordsSet = null;

function getMeaning(word) {
  if (!wordDict) {
    try { wordDict = jsonCache.readJSONObject(dictPath); } catch { wordDict = {}; }
  }
  const defs = wordDict[word];
  if (!defs || defs.length === 0) return null;
  return defs[0];
}

function loadValidWords() {
  if (!validWordsSet) {
    try { validWordsSet = new Set(jsonCache.readJSONArray(validWordsPath)); } catch { validWordsSet = new Set(); }
  }
  return validWordsSet;
}

function getLastWord(pair) { return pair.split(' ')[1]; }
function getFirstWord(pair) { return pair.split(' ')[0]; }

function isVietnameseWord(w) {
  return /^[a-zàáảãạâầấẩẫậăằắẳẵặèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵđ]+$/.test(w)
    && w.length >= 2;
}

let allTokenSet = null;
let tokenFreqMap = null;

function buildTokenData() {
  if (allTokenSet) return;
  allTokenSet = new Set();
  tokenFreqMap = {};

  const validSet = loadValidWords();
  for (const w of validSet) {
    const parts = w.split(' ');
    for (const t of parts) {
      allTokenSet.add(t);
      tokenFreqMap[t] = (tokenFreqMap[t] || 0) + 1;
    }
  }

  if (!wordDict) {
    try { wordDict = jsonCache.readJSONObject(dictPath); } catch { wordDict = {}; }
  }
  for (const key of Object.keys(wordDict)) {
    const parts = key.split(' ');
    for (const t of parts) {
      allTokenSet.add(t);
      tokenFreqMap[t] = (tokenFreqMap[t] || 0) + 1;
    }
  }
}

function isCommonWord(w) {
  buildTokenData();
  return allTokenSet.has(w) && (tokenFreqMap[w] || 0) >= 2;
}

const SAFE_SECONDS = new Set([
  'sinh', 'học', 'viên', 'gia', 'sĩ', 'trưởng', 'sư', 'khách',
  'điện', 'đường', 'hội', 'phòng', 'viện', 'cục', 'bộ', 'sở', 'ty',
  'hóa', 'lý', 'học', 'thuật', 'nghệ',
  'sơn', 'thủy', 'lâm', 'ngư', 'điền',
  'kinh', 'tế', 'chính', 'trị', 'văn', 'hóa', 'xã', 'hội',
  'quốc', 'dân', 'quân', 'binh', 'sĩ', 'tướng',
  'tình', 'nghĩa', 'đạo', 'đức', 'lý',
  'phát', 'triển', 'tiến', 'hóa', 'cải', 'tạo',
  'tập', 'hành', 'nghiệp', 'công', 'tác',
  'trường', 'lớp', 'ban', 'khoa', 'ngành',
  'giáo', 'dục', 'đào', 'tạo',
  'thương', 'mại', 'dịch', 'vụ',
  'khoa', 'kỹ', 'thuật', 'công', 'nghệ',
  'thông', 'tin', 'truyền', 'thông',
  'ngôn', 'ngữ', 'tiếng', 'lời',
  'thơ', 'văn', 'truyện', 'sách', 'báo',
  'nhạc', 'hát', 'ca', 'đàn',
  'tranh', 'ảnh', 'hình', 'vẽ',
  'cầu', 'đường', 'phố', 'làng', 'xóm',
  'nhà', 'cửa', 'vườn', 'ruộng', 'đất',
  'nước', 'biển', 'sông', 'suối', 'hồ',
  'trời', 'mây', 'mưa', 'gió', 'bão',
  'lửa', 'than', 'củi', 'đèn',
  'cơm', 'bánh', 'trái', 'rau', 'quả',
  'áo', 'quần', 'giày', 'nón', 'mũ',
  'xe', 'tàu', 'máy', 'đồng', 'hồ',
  'bàn', 'ghế', 'giường', 'tủ', 'cửa',
  'vàng', 'bạc', 'đồng', 'sắt', 'thép',
  'người', 'mặt', 'tay', 'chân', 'đầu',
  'mắt', 'tai', 'miệng', 'mũi', 'lưỡi',
  'lòng', 'dạ', 'tâm', 'hồn', 'thân',
  'sức', 'lực', 'tài', 'trí', 'đức',
  'tuổi', 'đời', 'thế', 'gian',
  'danh', 'tiếng', 'giá', 'trị',
  'lợi', 'ích', 'hại', 'phúc', 'họa',
  'ơn', 'nghĩa', 'thù', 'hận',
  'vui', 'buồn', 'sướng', 'khổ',
  'xinh', 'đẹp', 'xấu', 'tốt', 'xấu',
  'lành', 'dữ', 'hiền', 'ác',
  'to', 'nhỏ', 'cao', 'thấp', 'lớn', 'bé',
  'nặng', 'nhẹ', 'sâu', 'nông', 'rộng', 'hẹp',
  'xa', 'gần', 'trên', 'dưới', 'trong', 'ngoài',
  'trái', 'phải', 'trước', 'sau', 'giữa',
  'trăm', 'ngàn', 'nghìn', 'triệu', 'tỷ',
  'nay', 'mai', 'hôm', 'ngày', 'tháng', 'năm',
  'xuân', 'hạ', 'thu', 'đông',
  'đông', 'tây', 'nam', 'bắc', 'trung',
  'mới', 'cũ', 'non', 'già', 'trẻ',
  'đầy', 'vơi', 'cạn', 'sâu',
  'ngọt', 'mặn', 'chua', 'cay', 'đắng',
  'thơm', 'thối', 'hôi', 'tanh',
  'sáng', 'tối', 'đen', 'trắng', 'xanh', 'đỏ',
  'tím', 'vàng', 'nâu', 'hồng', 'xám',
  'mềm', 'cứng', 'dẻo', 'giòn',
  'nóng', 'lạnh', 'ấm', 'mát',
  'khô', 'ướt', 'bẩn', 'sạch',
  'nhanh', 'chậm', 'gấp', 'vội',
  'khéo', 'vụng', 'khôn', 'dại',
  'thẳng', 'cong', 'xiên', 'ngang', 'dọc',
  'một', 'hai', 'ba', 'bốn', 'năm', 'sáu', 'bảy', 'tám', 'chín', 'mười'
]);

const usedNewPairs = new Set();

function buildReverseIndex(wordIndex) {
  const rev = new Map();
  for (const [first, pairs] of wordIndex) {
    for (const pair of pairs) {
      const last = getLastWord(pair);
      if (!rev.has(last)) rev.set(last, []);
      rev.get(last).push(first);
    }
  }
  return rev;
}

function generateSmartCompound(lastWord, usedWords, wordIndex) {
  buildTokenData();
  const usedSet = new Set(usedWords);

  if (!isCommonWord(lastWord)) return null;

  const candidates = wordIndex.get(lastWord) || [];
  const existingSeconds = new Set(candidates.map(c => getLastWord(c)));

  const secondScores = new Map();

  // Strategy 1: Word web - use reverse index to find related words
  const revIndex = buildReverseIndex(wordIndex);
  const relatedFirsts = revIndex.get(lastWord) || [];

  for (const rf of relatedFirsts) {
    const rPairs = wordIndex.get(rf) || [];
    for (const rp of rPairs) {
      const sw = getLastWord(rp);
      if (existingSeconds.has(sw)) continue;
      const pair = lastWord + ' ' + sw;
      if (usedSet.has(pair) || usedNewPairs.has(pair)) continue;
      if (!isVietnameseWord(sw) || !isCommonWord(sw)) continue;
      let score = (tokenFreqMap[sw] || 0) + (getMeaning(pair) ? 50 : 0) + Math.random() * 15;
      if (!secondScores.has(sw) || score > secondScores.get(sw).score) {
        secondScores.set(sw, { word: pair, score });
      }
    }
  }

  // Strategy 2: Use safe compound suffixes
  if (secondScores.size < 3) {
    for (const sw of SAFE_SECONDS) {
      if (existingSeconds.has(sw)) continue;
      const pair = lastWord + ' ' + sw;
      if (usedSet.has(pair) || usedNewPairs.has(pair)) continue;
      if (!isVietnameseWord(sw)) continue;
      let score = (tokenFreqMap[sw] || 0) + (getMeaning(pair) ? 30 : 0) + Math.random() * 10 + 5;
      secondScores.set(sw, { word: pair, score });
    }
  }

  if (secondScores.size === 0) return null;

  const sorted = [...secondScores.values()].sort((a, b) => b.score - a.score);
  const pick = Math.random() < 0.2
    ? sorted[Math.floor(Math.random() * Math.min(3, sorted.length))]
    : sorted[0];

  usedNewPairs.add(pick.word);
  usedSet.add(pick.word);

  if (!wordIndex.has(lastWord)) wordIndex.set(lastWord, []);
  wordIndex.get(lastWord).push(pick.word);

  return { word: pick.word, meaning: getMeaning(pick.word), fromAI: true };
}

function isValidPair(pair) {
  const parts = pair.split(' ');
  if (parts.length !== 2) return false;
  const valid = loadValidWords();
  return valid.has(parts[0]) && valid.has(parts[1]);
}

function heuristicWithFallback(lastWord, usedWords, wordIndex) {
  const usedSet = new Set(usedWords);
  const candidates = wordIndex.get(lastWord);

  if (candidates && candidates.length > 0) {
    const available = candidates.filter(c => !usedSet.has(c) && isValidPair(c));
    if (available.length > 0) {
      const scored = available.map(c => {
        const last = getLastWord(c);
        const conts = wordIndex.get(last);
        const contCount = conts ? conts.filter(x => !usedSet.has(x)).length : 0;
        let score = contCount === 0 ? 100
          : contCount <= 3 ? 80
          : contCount <= 10 ? 40 + Math.random() * 20
          : Math.random() * 30;
        if (getMeaning(c)) score += 5;
        return { word: c, score, meaning: getMeaning(c), fromAI: false };
      });
      scored.sort((a, b) => b.score - a.score);
      const pick = Math.random() < 0.15
        ? scored[Math.floor(Math.random() * Math.min(3, scored.length))]
        : scored[0];
      return pick;
    }
  }

  return null;
}

function getNextWord(lastWord, usedWords, wordIndex) {
  return heuristicWithFallback(lastWord, usedWords, wordIndex);
}

const wordValidityCache = new Map();

function checkWordMeaning(word) {
  word = word.toLowerCase().trim();
  if (wordValidityCache.has(word)) return wordValidityCache.get(word);

  const valid = loadValidWords();
  if (valid.has(word)) { wordValidityCache.set(word, true); return true; }

  const meaning = getMeaning(word);
  if (meaning) { wordValidityCache.set(word, true); return true; }

  wordValidityCache.set(word, false);
  return false;
}

module.exports = { getNextWord, checkWordMeaning };
