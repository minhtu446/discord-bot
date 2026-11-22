const { createCanvas, loadImage, registerFont } = require('canvas');
const path = require('path');
const fs = require('fs');

const FONT_DIRS = [path.join(__dirname, '..', 'docs', 'fonts'), path.join(__dirname, '..', 'fonts')];
const FONT_FILES = [
  { file: 'BeVietnamPro-Regular.ttf', family: 'BeVietnamPro' },
  { file: 'BeVietnamPro-Bold.ttf', family: 'BeVietnamPro', weight: 'bold' },
  { file: 'Montserrat.ttf', family: 'Montserrat' },
];
let fontsReady = false;
function ensureFonts() {
  if (fontsReady) return;
  fontsReady = true;
  for (const f of FONT_FILES) {
    for (const dir of FONT_DIRS) {
      const fp = path.join(dir, f.file);
      if (!fs.existsSync(fp)) continue;
      try { registerFont(fp, { family: f.family, ...(f.weight ? { weight: f.weight } : {}) }); } catch {}
      break;
    }
  }
}

function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

function fitText(ctx, text, maxWidth) {
  let t = String(text || '');
  if (ctx.measureText(t).width <= maxWidth) return t;
  while (t.length > 1 && ctx.measureText(t + '…').width > maxWidth) t = t.slice(0, -1);
  return t + '…';
}

async function loadImageSafe(src, timeoutMs = 8000) {
  if (!src) return null;
  try {
    const p = loadImage(src);
    const t = new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), timeoutMs));
    return await Promise.race([p, t]);
  } catch { return null; }
}

function hexToRgba(hex, a = 1) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '').trim());
  if (!m) return `rgba(88,101,242,${a})`;
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  return `rgba(${r},${g},${b},${a})`;
}

async function generateRankCard({ user, member, rank, level, currentXp, needed, totalXp, cfg }) {
  ensureFonts();
  const W = 934, H = 282;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');
  const rc = cfg?.rankCard || {};
  const accent = /^#[0-9a-fA-F]{6}$/.test(rc.accent) ? rc.accent : '#5865F2';
  const textColor = /^#[0-9a-fA-F]{6}$/.test(rc.textColor) ? rc.textColor : '#ffffff';
  const bgColor = /^#[0-9a-fA-F]{6}$/.test(rc.bgColor) ? rc.bgColor : '#23272a';

  // Background
  ctx.fillStyle = bgColor;
  ctx.fillRect(0, 0, W, H);
  const bgImg = await loadImageSafe(rc.bgUrl);
  if (bgImg) {
    const scale = Math.max(W / bgImg.width, H / bgImg.height);
    const dw = bgImg.width * scale, dh = bgImg.height * scale;
    ctx.drawImage(bgImg, (W - dw) / 2, (H - dh) / 2, dw, dh);
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.fillRect(0, 0, W, H);
  } else {
    const g = ctx.createLinearGradient(0, 0, W, H);
    g.addColorStop(0, hexToRgba(accent, 0.25));
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }

  // Panel
  roundRect(ctx, 24, 24, W - 48, H - 48, 20);
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.fill();

  const showAvatar = rc.showAvatar !== false;
  const showProgress = rc.showProgress !== false;
  const avatarSize = 160;
  const avatarX = 60;
  const avatarY = (H - avatarSize) / 2;
  const rightX = showAvatar ? avatarX + avatarSize + 40 : 60;
  const rightW = W - rightX - 60;

  // Avatar
  if (showAvatar) {
    const avatarUrl = (member || user)?.displayAvatarURL?.({ extension: 'png', size: 256 }) || user?.displayAvatarURL?.({ extension: 'png', size: 256 });
    const av = await loadImageSafe(avatarUrl);
    ctx.save();
    ctx.beginPath();
    ctx.arc(avatarX + avatarSize / 2, avatarY + avatarSize / 2, avatarSize / 2, 0, Math.PI * 2);
    ctx.closePath();
    ctx.clip();
    if (av) {
      ctx.drawImage(av, avatarX, avatarY, avatarSize, avatarSize);
    } else {
      ctx.fillStyle = '#5865F2';
      ctx.fillRect(avatarX, avatarY, avatarSize, avatarSize);
    }
    ctx.restore();
    ctx.strokeStyle = accent;
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.arc(avatarX + avatarSize / 2, avatarY + avatarSize / 2, avatarSize / 2 - 2, 0, Math.PI * 2);
    ctx.stroke();
  }

  // Text
  const name = String(member?.displayName || user?.username || 'User');
  ctx.fillStyle = textColor;
  ctx.font = 'bold 42px BeVietnamPro, Montserrat, sans-serif';
  ctx.fillText(fitText(ctx, name, rightW - 180), rightX, 95);

  ctx.fillStyle = hexToRgba(textColor, 0.75);
  ctx.font = '24px BeVietnamPro, Montserrat, sans-serif';
  ctx.fillText(fitText(ctx, `@${user?.username || ''}`, rightW - 180), rightX, 128);

  // Rank/Level right side
  ctx.textAlign = 'right';
  ctx.fillStyle = hexToRgba(textColor, 0.75);
  ctx.font = '24px BeVietnamPro, Montserrat, sans-serif';
  ctx.fillText('RANK', W - 60, 72);
  ctx.fillText('LEVEL', W - 170, 72);
  ctx.fillStyle = textColor;
  ctx.font = 'bold 40px BeVietnamPro, Montserrat, sans-serif';
  ctx.fillText(rank ? `#${rank}` : '#?', W - 60, 110);
  ctx.fillStyle = accent;
  ctx.fillText(String(level ?? 0), W - 170, 110);
  ctx.textAlign = 'left';

  // XP
  const xpText = `${Math.max(0, currentXp || 0)} / ${Math.max(1, needed || 1)} XP`;
  const totalText = `Tổng: ${Math.max(0, totalXp || 0)} XP`;
  ctx.fillStyle = hexToRgba(textColor, 0.85);
  ctx.font = '22px BeVietnamPro, Montserrat, sans-serif';
  const xpW = ctx.measureText(xpText).width;
  ctx.fillText(xpText, W - 60 - xpW, 170);
  ctx.fillText(totalText, rightX, 170);

  // Progress bar
  if (showProgress) {
    const barX = rightX;
    const barY = 190;
    const barW = W - 60 - rightX;
    const barH = 34;
    roundRect(ctx, barX, barY, barW, barH, 17);
    ctx.fillStyle = 'rgba(255,255,255,0.15)';
    ctx.fill();
    const pct = Math.max(0, Math.min(1, (Number(currentXp) || 0) / Math.max(1, Number(needed) || 1)));
    const fillW = Math.max(barH, barW * pct);
    roundRect(ctx, barX, barY, fillW, barH, 17);
    const pg = ctx.createLinearGradient(barX, 0, barX + barW, 0);
    pg.addColorStop(0, accent);
    pg.addColorStop(1, hexToRgba(accent, 0.7));
    ctx.fillStyle = pg;
    ctx.fill();
  }

  return canvas.toBuffer('image/png');
}

async function generateLeaderboardCard({ guildName, rows, cfg }) {
  ensureFonts();
  const W = 960;
  const rowH = 64;
  const pad = 28;
  const headerH = 110;
  const H = headerH + pad + rows.length * rowH + pad;
  const canvas = createCanvas(W, Math.max(320, H));
  const ctx = canvas.getContext('2d');
  const rc = cfg?.rankCard || {};
  const accent = /^#[0-9a-fA-F]{6}$/.test(rc.accent) ? rc.accent : '#5865F2';
  const textColor = /^#[0-9a-fA-F]{6}$/.test(rc.textColor) ? rc.textColor : '#ffffff';
  const bgColor = /^#[0-9a-fA-F]{6}$/.test(rc.bgColor) ? rc.bgColor : '#23272a';

  ctx.fillStyle = bgColor;
  ctx.fillRect(0, 0, W, canvas.height);
  const bgImg = await loadImageSafe(rc.bgUrl);
  if (bgImg) {
    const scale = Math.max(W / bgImg.width, canvas.height / bgImg.height);
    const dw = bgImg.width * scale, dh = bgImg.height * scale;
    ctx.drawImage(bgImg, (W - dw) / 2, (canvas.height - dh) / 2, dw, dh);
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.fillRect(0, 0, W, canvas.height);
  }

  ctx.fillStyle = textColor;
  ctx.font = 'bold 40px BeVietnamPro, Montserrat, sans-serif';
  ctx.fillText(fitText(ctx, `Bảng xếp hạng - ${guildName || 'Server'}`, W - pad * 2), pad, 58);
  ctx.fillStyle = hexToRgba(textColor, 0.7);
  ctx.font = '22px BeVietnamPro, Montserrat, sans-serif';
  ctx.fillText(`Top ${rows.length}`, pad, 90);

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const y = headerH + i * rowH;
    roundRect(ctx, pad, y, W - pad * 2, rowH - 8, 12);
    ctx.fillStyle = i < 3 ? hexToRgba(accent, 0.22 - i * 0.04) : 'rgba(255,255,255,0.06)';
    ctx.fill();

    ctx.fillStyle = i === 0 ? '#f1c40f' : i === 1 ? '#bdc3c7' : i === 2 ? '#cd7f32' : textColor;
    ctx.font = 'bold 28px BeVietnamPro, Montserrat, sans-serif';
    ctx.fillText(`#${i + 1}`, pad + 18, y + 38);

    const av = await loadImageSafe(r.avatarUrl);
    const ax = pad + 90, ay = y + 8, as = 40;
    ctx.save();
    ctx.beginPath(); ctx.arc(ax + as / 2, ay + as / 2, as / 2, 0, Math.PI * 2); ctx.closePath(); ctx.clip();
    if (av) ctx.drawImage(av, ax, ay, as, as);
    else { ctx.fillStyle = accent; ctx.fillRect(ax, ay, as, as); }
    ctx.restore();

    ctx.fillStyle = textColor;
    ctx.font = 'bold 24px BeVietnamPro, Montserrat, sans-serif';
    ctx.fillText(fitText(ctx, r.name || r.userId, W - 420), ax + 56, y + 36);

    ctx.textAlign = 'right';
    ctx.fillStyle = hexToRgba(textColor, 0.85);
    ctx.font = '22px BeVietnamPro, Montserrat, sans-serif';
    ctx.fillText(`Level ${r.level} • ${r.totalXp} XP`, W - pad - 18, y + 36);
    ctx.textAlign = 'left';
  }

  return canvas.toBuffer('image/png');
}

module.exports = { generateRankCard, generateLeaderboardCard };
