const violations = new Map();
const rateLimitMap = new Map();
const VIOLATION_WINDOW = 3600000;
const VIOLATION_LIMIT = 3;

function pruneMaps() {
  const now = Date.now();
  for (const [userId, entries] of violations) {
    const valid = entries.filter(t => now - t < VIOLATION_WINDOW);
    if (valid.length === 0) violations.delete(userId);
    else violations.set(userId, valid);
  }
  for (const [userId, entry] of rateLimitMap) {
    if (now - entry.firstMsg > 60000) rateLimitMap.delete(userId);
  }
}
setInterval(pruneMaps, 60000);

function addViolation(userId) {
  pruneMaps();
  const entries = violations.get(userId) || [];
  entries.push(Date.now());
  violations.set(userId, entries);
  return entries.length;
}

function getViolationCount(userId) {
  pruneMaps();
  const entries = violations.get(userId);
  return entries ? entries.length : 0;
}

function isSuspiciousText(text) {
  if (!text || text.length < 3) return false;
  const specialCharCount = (text.match(/[^a-zA-Z0-9À-ỹà-ỹ\s]/g) || []).length;
  const ratio = specialCharCount / text.length;
  return ratio > 0.5;
}

function isSuspiciousFormatting(text) {
  const patterns = [
    /(.)\1{4,}/,
    /[A-Z\s]{20,}/,
    /(?:.\u200B){5,}/,
    /(?:.\u200D){5,}/,
  ];
  return patterns.some(p => p.test(text));
}

async function check(message, ocrText) {
  const userId = message.author.id;
  let action = null;
  let reason = null;

  if (ocrText && ocrText.trim()) {
    const cleaned = ocrText.replace(/[^a-zA-ZÀ-ỹà-ỹ]/g, '').toLowerCase();
    if (cleaned.length < 3) {
      action = 'warn';
      reason = 'OCR text quá ngắn, không đủ để phân tích';
    }
  }

  if (isSuspiciousText(message.content)) {
    action = 'delete';
    reason = 'Tin nhắn có >50% ký tự đặc biệt';
  }

  if (!action && isSuspiciousFormatting(message.content)) {
    action = 'warn';
    reason = 'Định dạng tin nhắn đáng ngờ';
  }

  if (action) addViolation(userId);

  const count = getViolationCount(userId);
  if (count >= VIOLATION_LIMIT) {
    action = 'delete';
    reason = `Tái phạm lần ${count}/${VIOLATION_LIMIT} trong 1h`;
  }

  if (action === 'warn' && count >= 2) {
    action = 'delete';
    reason = `Cảnh báo lần ${count}, nâng lên xoá`;
  }

  return { action, reason, violationCount: count };
}

function checkRateLimit(userId) {
  const now = Date.now();
  const entry = rateLimitMap.get(userId);
  if (!entry) {
    rateLimitMap.set(userId, { count: 1, firstMsg: now });
    return false;
  }
  if (now - entry.firstMsg > 5000) {
    rateLimitMap.set(userId, { count: 1, firstMsg: now });
    return false;
  }
  entry.count++;
  if (entry.count > 8) return true;
  return false;
}

module.exports = { check, addViolation, getViolationCount, checkRateLimit };
