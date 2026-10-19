const { EmbedBuilder, AttachmentBuilder } = require('discord.js');
const { createCanvas, loadImage, registerFont } = require('canvas');
const path = require('path');
const fs = require('fs');

const fontPath = path.join(__dirname, '..', 'fonts');
let fontRegistered = false;

function registerFonts() {
  if (fontRegistered) return;
  try {
    const fontsDir = fs.readdirSync(fontPath);
    const ttfFiles = fontsDir.filter(f => f.endsWith('.ttf') || f.endsWith('.otf'));
    if (ttfFiles.length > 0) {
      registerFont(path.join(fontPath, ttfFiles[0]), { family: 'CustomFont' });
      fontRegistered = true;
      return;
    }
  } catch {}
  fontRegistered = true;
}

function createWelcomeEmbed(member) {
  const embed = new EmbedBuilder()
    .setTitle('🎉 Chào mừng bạn mới!')
    .setDescription(
      `👤 **Tên hiển thị:** ${member.displayName}\n` +
      `📧 **Tên tài khoản:** @${member.user.username}\n` +
      `🆔 **ID:** \`${member.user.id}\`\n` +
      `🎯 **Thành viên thứ:** #${member.guild.memberCount}`
    )
    .setColor(0x5865F2)
    .setTimestamp();
  return { embeds: [embed] };
}

function avatarPath(ctx, x, y, size, shape) {
  if (shape === 'square') { ctx.rect(x, y, size, size); return; }
  if (shape === 'rounded') { ctx.roundRect(x, y, size, size, size * 0.18); return; }
  ctx.arc(x + size / 2, y + size / 2, size / 2, 0, Math.PI * 2);
}

function interpolateWelcome(tpl, member) {
  return String(tpl)
    .replace(/\{mention\}/gi, `<@${member.user.id}>`)
    .replace(/\{user\}/gi, member.displayName)
    .replace(/\{server\}/gi, member.guild.name)
    .replace(/\{count\}/gi, String(member.guild.memberCount));
}

const WTEXT_FAMILIES = { sans: 'sans-serif', serif: 'serif', mono: 'monospace' };

function drawWelcomeTexts(ctx, opts, member) {
  const list = Array.isArray(opts.texts) ? opts.texts.slice(0, 12) : [];
  if (!list.length) return;
  const fontName = fontRegistered ? 'CustomFont, ' : '';
  for (const t of list) {
    const raw = typeof t.text === 'string' ? t.text : '';
    if (!raw.trim()) continue;
    const text = interpolateWelcome(raw, member);
    const size = Math.max(8, Math.min(96, Number(t.size) || 28));
    const family = WTEXT_FAMILIES[t.font] || 'sans-serif';
    const align = t.align === 'left' ? 'left' : (t.align === 'right' ? 'right' : 'center');
    const x = Math.max(-100, Math.min(1200, Number(t.x) || 450));
    const y = Math.max(-100, Math.min(700, Number(t.y) || 225));
    ctx.save();
    ctx.font = `${t.italic ? 'italic ' : ''}${t.bold ? 'bold ' : ''}${size}px ${fontName}${family}`;
    ctx.textBaseline = 'top';
    ctx.textAlign = align;
    // Khung ô chữ: nếu người dùng đã đặt w/h thì dùng, ngược lại bám theo chữ (giống panel).
    const tw = ctx.measureText(text).width;
    const hasW = Number.isFinite(Number(t.w)) && Number(t.w) > 0;
    const hasH = Number.isFinite(Number(t.h)) && Number(t.h) > 0;
    const fw = hasW ? Math.max(10, Math.min(900, Number(t.w))) : tw;
    const fh = hasH ? Math.max(8, Math.min(400, Number(t.h))) : size * 1.25;
    if (t.box) {
      const pad = Math.max(6, size * 0.3);
      const bx = align === 'left' ? x : (align === 'right' ? x - fw : x - fw / 2);
      ctx.fillStyle = 'rgba(0,0,0,0.4)';
      ctx.beginPath();
      ctx.roundRect(bx - pad, y - pad * 0.5, fw + pad * 2, fh + pad, Math.min(10, size * 0.35));
      ctx.fill();
    }
    if (t.shadow !== false) {
      ctx.shadowColor = 'rgba(0,0,0,0.55)';
      ctx.shadowBlur = Math.max(4, size * 0.25);
      ctx.shadowOffsetY = 2;
    }
    ctx.fillStyle = /^#[0-9a-fA-F]{6}$/.test(String(t.color || '')) ? t.color : '#ffffff';
    ctx.fillText(text, x, y);
    ctx.restore();
  }
}

// Khối tên + @username + 2 ô — PHẢI GIỐNG HỆT panel (wInfoRect/wInfoLayout trong docs/index.html).
function welcomeInfoRect(opts, avatarX, avatarSize) {
  const defX = Math.round(avatarX + avatarSize + 60);
  const defY = Math.round(450 / 2 - 10 - 58);
  const defW = Math.max(120, Math.round(900 - defX - 100));
  const inf = opts && opts.info;
  if (inf && typeof inf === 'object' && Number.isFinite(Number(inf.x))) {
    const cl = (v, mn, mx, d) => Math.max(mn, Math.min(mx, Math.round(Number(v) || d)));
    return {
      x: cl(inf.x, -100, 1200, defX),
      y: cl(inf.y, -100, 700, defY),
      w: cl(inf.w, 120, 900, defW),
      h: cl(inf.h, 50, 400, 153)
    };
  }
  return { x: defX, y: defY, w: defW, h: 153 };
}

function drawWelcomeInfo(ctx, opts, member, accentGrad, fontName, avatarX, avatarSize) {
  const info = welcomeInfoRect(opts, avatarX, avatarSize);
  let name = member.displayName;
  const base = name.length > 14 ? 28 : (name.length > 10 ? 32 : 36);
  const nameSize = Math.max(12, Math.min(60, Math.min(base, Math.round(info.h * 0.28))));
  const nameCY = info.y + nameSize / 2;
  const userY = nameCY + 46;
  const boxTop = nameCY + 83;
  const boxH = Math.max(24, Math.min(200, info.y + info.h - boxTop));
  const boxW = Math.min(175, Math.max(90, (info.w - 15) / 2));

  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#ffffff';
  ctx.font = `bold ${nameSize}px ${fontName}sans-serif`;
  while (ctx.measureText(name).width > info.w && name.length > 1) name = name.slice(0, -1);
  const nameUp = name.toUpperCase();
  ctx.fillText(nameUp, info.x, nameCY);

  const nameW = Math.min(ctx.measureText(nameUp).width, Math.max(0, info.w));
  ctx.save();
  ctx.shadowColor = 'rgba(88,101,242,0.3)';
  ctx.shadowBlur = 10;
  ctx.fillStyle = accentGrad;
  ctx.fillRect(info.x, nameCY + 20, nameW, 2);
  ctx.restore();

  ctx.font = '15px sans-serif';
  ctx.fillStyle = 'rgba(255,255,255,0.45)';
  ctx.fillText(`@${member.user.username.toLowerCase()}`, info.x, userY);

  const items = [
    { label: 'member', value: `#${member.guild.memberCount}` },
    { label: 'id', value: member.user.id }
  ];
  items.forEach((item, i) => {
    const ix = info.x + i * (boxW + 15);
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.2)';
    ctx.shadowBlur = 8;
    ctx.shadowOffsetY = 2;
    ctx.fillStyle = 'rgba(255,255,255,0.04)';
    ctx.beginPath();
    ctx.roundRect(ix, boxTop - 2, boxW, boxH, 10);
    ctx.fill();
    ctx.restore();

    ctx.fillStyle = 'rgba(255,255,255,0.2)';
    ctx.font = '10px sans-serif';
    ctx.textBaseline = 'bottom';
    ctx.textAlign = 'left';
    ctx.fillText(item.label.toUpperCase(), ix + 14, boxTop + 20);

    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.font = '15px monospace';
    ctx.textBaseline = 'top';
    ctx.fillText(item.value, ix + 14, boxTop + 24);
  });
}

async function createWelcomeCanvas(member, opts = {}, bg) {
  const backgroundUrl = typeof opts.backgroundUrl === 'string' ? opts.backgroundUrl.trim() : '';
  const avatarSize = Math.max(60, Math.min(400, Number(opts.avatarSize) || 130));
  const shape = ['circle', 'square', 'rounded'].includes(opts.avatarShape) ? opts.avatarShape : 'circle';

  registerFonts();

  const W = 1800;
  const H = 900;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');
  ctx.scale(2, 2);

  const w = 900, h = 450;

  const bgGrad = ctx.createLinearGradient(0, 0, w, h);
  bgGrad.addColorStop(0, '#0a0814');
  bgGrad.addColorStop(0.3, '#100d20');
  bgGrad.addColorStop(0.6, '#1a1238');
  bgGrad.addColorStop(1, '#0c091a');
  ctx.fillStyle = bgGrad;
  ctx.fillRect(0, 0, w, h);

  let bgImage = null;
  if (bg && bg.length) {
    try { bgImage = await loadImage(bg); } catch (e) { console.error('[welcome] ảnh nền lỗi:', e.message); }
  } else if (backgroundUrl) {
    try { bgImage = await loadImage(backgroundUrl); } catch (e) { console.error('[welcome] không tải được ảnh nền:', backgroundUrl); }
  }
  if (bgImage) {
    const z = Math.max(0.5, Math.min(3, (Number(opts.bgZoom) || 100) / 100));
    const scale = Math.max(w / bgImage.width, h / bgImage.height) * z;
    const dw = bgImage.width * scale;
    const dh = bgImage.height * scale;
    const dx = (w - dw) / 2 + (Number(opts.bgX) || 0);
    const dy = (h - dh) / 2 + (Number(opts.bgY) || 0);
    ctx.drawImage(bgImage, dx, dy, dw, dh);
    ctx.fillStyle = 'rgba(0,0,0,0.38)';
    ctx.fillRect(0, 0, w, h);
  }

  const glows = [
    { x: 120, y: -30, r: 450, c: 'rgba(88,101,242,0.06)' },
    { x: 500, y: 80, r: 380, c: 'rgba(156,39,176,0.04)' },
    { x: 750, y: -50, r: 400, c: 'rgba(233,30,99,0.05)' },
  ];
  for (const g of glows) {
    const grad = ctx.createRadialGradient(g.x, g.y, 10, g.x, g.y, g.r);
    grad.addColorStop(0, g.c);
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);
  }

  const accentGrad = ctx.createLinearGradient(0, 0, w, 0);
  accentGrad.addColorStop(0, '#5865F2');
  accentGrad.addColorStop(0.3, '#7c4dff');
  accentGrad.addColorStop(0.6, '#e040a0');
  accentGrad.addColorStop(1, '#ff6f6f');
  ctx.fillStyle = accentGrad;
  ctx.fillRect(0, 0, w, 4);
  ctx.fillRect(0, h - 4, w, 4);

  ctx.save();
  ctx.globalAlpha = 0.03;
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 0.5;
  for (let x = 0; x < w; x += 70) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x - 30, h);
    ctx.stroke();
  }
  for (let y = 0; y < h; y += 70) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y - 30);
    ctx.stroke();
  }
  ctx.restore();

  ctx.save();
  ctx.shadowColor = 'rgba(88,101,242,0.15)';
  ctx.shadowBlur = 50;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 6;
  ctx.fillStyle = 'rgba(255,255,255,0.02)';
  ctx.beginPath();
  ctx.roundRect(30, 25, w - 60, h - 50, 28);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.06)';
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.restore();

  ctx.save();
  ctx.globalAlpha = 0.3;
  const lGrad = ctx.createLinearGradient(30, 25, 30, h - 25);
  lGrad.addColorStop(0, '#5865F2');
  lGrad.addColorStop(0.5, '#e040a0');
  lGrad.addColorStop(1, '#5865F2');
  ctx.fillStyle = lGrad;
  ctx.beginPath();
  ctx.roundRect(30, 25, 5, h - 50, [3, 0, 0, 3]);
  ctx.fill();
  ctx.restore();

  ctx.save();
  ctx.globalAlpha = 0.06;
  ctx.font = `bold 120px ${fontRegistered ? 'CustomFont, ' : ''}sans-serif`;
  ctx.fillStyle = '#ffffff';
  ctx.textBaseline = 'bottom';
  ctx.textAlign = 'right';
  ctx.fillText('WELCOME', w - 45, 95);
  ctx.restore();

  const avatarX = Math.max(10, Math.min(860, Number(opts.avatarX) || 65));
  const centerY = h / 2 - 10;
  const avatarY = Math.max(10, Math.min(450 - avatarSize, Number(opts.avatarY) || (centerY - avatarSize / 2)));

  try {
    const avatarUrl = member.user.displayAvatarURL({ size: 512, extension: 'png' });
    const avatar = await loadImage(avatarUrl);

    ctx.save();
    const ringGrad = ctx.createLinearGradient(avatarX, avatarY, avatarX + avatarSize, avatarY + avatarSize);
    ringGrad.addColorStop(0, '#5865F2');
    ringGrad.addColorStop(0.5, '#9C27B0');
    ringGrad.addColorStop(1, '#E91E63');
    ctx.shadowColor = 'rgba(88,101,242,0.5)';
    ctx.shadowBlur = 50;
    ctx.strokeStyle = ringGrad;
    ctx.lineWidth = 5;
    ctx.beginPath();
    avatarPath(ctx, avatarX - 5, avatarY - 5, avatarSize + 10, shape);
    ctx.stroke();
    ctx.shadowBlur = 0;

    ctx.beginPath();
    avatarPath(ctx, avatarX, avatarY, avatarSize, shape);
    ctx.closePath();
    ctx.clip();
    ctx.drawImage(avatar, avatarX, avatarY, avatarSize, avatarSize);
    ctx.restore();

    ctx.save();
    ctx.shadowColor = 'rgba(88,101,242,0.25)';
    ctx.shadowBlur = 25;
    ctx.strokeStyle = 'rgba(255,255,255,0.15)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    avatarPath(ctx, avatarX - 10, avatarY - 10, avatarSize + 20, shape);
    ctx.stroke();
    ctx.restore();
  } catch {
    ctx.save();
    ctx.fillStyle = '#1a1538';
    ctx.shadowColor = 'rgba(88,101,242,0.4)';
    ctx.shadowBlur = 40;
    ctx.beginPath();
    avatarPath(ctx, avatarX, avatarY, avatarSize, shape);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#5865F2';
    ctx.font = `${Math.round(avatarSize * 0.43)}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(member.displayName.charAt(0).toUpperCase(), avatarX + avatarSize / 2, avatarY + avatarSize / 2);
    ctx.restore();
  }

  const fontName = fontRegistered ? 'CustomFont, ' : '';
  drawWelcomeInfo(ctx, opts, member, accentGrad, fontName, avatarX, avatarSize);

  const now = new Date();
  const dayNames = ['chủ nhật', 'thứ hai', 'thứ ba', 'thứ tư', 'thứ năm', 'thứ sáu', 'thứ bảy'];
  const monthNames = ['tháng 1', 'tháng 2', 'tháng 3', 'tháng 4', 'tháng 5', 'tháng 6', 'tháng 7', 'tháng 8', 'tháng 9', 'tháng 10', 'tháng 11', 'tháng 12'];
  const day = dayNames[now.getDay()];
  const date = now.getDate();
  const month = monthNames[now.getMonth()];
  const year = now.getFullYear();
  const dateStr = `${day}, ${date} ${month} ${year}`;

  try {
    const guildIcon = member.guild.iconURL({ size: 64, extension: 'png' });
    if (guildIcon) {
      const icon = await loadImage(guildIcon);
      ctx.save();
      ctx.shadowColor = 'rgba(0,0,0,0.3)';
      ctx.shadowBlur = 10;
      ctx.beginPath();
      ctx.arc(42, h - 42, 16, 0, Math.PI * 2);
      ctx.closePath();
      ctx.clip();
      ctx.drawImage(icon, 26, h - 58, 32, 32);
      ctx.restore();
    }
  } catch {}

  ctx.fillStyle = 'rgba(255,255,255,0.25)';
  ctx.font = '12px sans-serif';
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.fillText(member.guild.name, 68, h - 42);

  ctx.fillStyle = 'rgba(255,255,255,0.15)';
  ctx.textAlign = 'right';
  ctx.fillText(dateStr, w - 50, h - 42);
  ctx.textAlign = 'left';

  const dotGrad = ctx.createLinearGradient(80, 38, 220, 38);
  dotGrad.addColorStop(0, '#5865F2');
  dotGrad.addColorStop(1, '#e040a0');
  ctx.save();
  for (let i = 0; i < 5; i++) {
    ctx.globalAlpha = 0.12 - i * 0.018;
    const t = i / 4;
    const grad = ctx.createRadialGradient(0, 0, 1, 0, 0, 1);
    const r = 2 + i * 2;
    ctx.fillStyle = `hsl(${240 + i * 12}, 80%, 65%)`;
    ctx.beginPath();
    ctx.arc(85 + i * 32, 38, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();

  drawWelcomeTexts(ctx, opts, member);

  const buffer = canvas.toBuffer('image/png');
  return new AttachmentBuilder(buffer, { name: 'welcome.png' });
}

module.exports = { createWelcomeEmbed, createWelcomeCanvas, interpolateWelcome };
