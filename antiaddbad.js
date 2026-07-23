const violations = new Map();
const VIOLATION_WINDOW = 3600000;
const VIOLATION_LIMIT = 3;

function pruneViolations() {
  const now = Date.now();
  for (const [userId, entries] of violations) {
    const valid = entries.filter(t => now - t < VIOLATION_WINDOW);
    if (valid.length === 0) violations.delete(userId);
    else violations.set(userId, valid);
  }
}

function addViolation(userId) {
  pruneViolations();
  const entries = violations.get(userId) || [];
  entries.push(Date.now());
  violations.set(userId, entries);
  return entries.length;
}

function getViolationCount(userId) {
  pruneViolations();
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

  if (action) {
    addViolation(userId);
  }

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

module.exports = { check, addViolation, getViolationCount };