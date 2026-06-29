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

async function createWelcomeCanvas(member) {
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

  const avatarSize = 130;
  const avatarX = 65;
  const centerY = h / 2 - 10;

  try {
    const avatarUrl = member.user.displayAvatarURL({ size: 512, extension: 'png' });
    const avatar = await loadImage(avatarUrl);

    ctx.save();
    const ringGrad = ctx.createLinearGradient(
      avatarX, centerY - avatarSize / 2,
      avatarX + avatarSize, centerY + avatarSize / 2
    );
    ringGrad.addColorStop(0, '#5865F2');
    ringGrad.addColorStop(0.5, '#9C27B0');
    ringGrad.addColorStop(1, '#E91E63');
    ctx.shadowColor = 'rgba(88,101,242,0.5)';
    ctx.shadowBlur = 50;
    ctx.strokeStyle = ringGrad;
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.arc(avatarX + avatarSize / 2, centerY, avatarSize / 2 + 5, 0, Math.PI * 2);
    ctx.stroke();
    ctx.shadowBlur = 0;

    ctx.beginPath();
    ctx.arc(avatarX + avatarSize / 2, centerY, avatarSize / 2, 0, Math.PI * 2);
    ctx.closePath();
    ctx.clip();
    ctx.drawImage(avatar, avatarX, centerY - avatarSize / 2, avatarSize, avatarSize);
    ctx.restore();

    ctx.save();
    ctx.shadowColor = 'rgba(88,101,242,0.25)';
    ctx.shadowBlur = 25;
    ctx.strokeStyle = 'rgba(255,255,255,0.15)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(avatarX + avatarSize / 2, centerY, avatarSize / 2 + 10, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  } catch {
    ctx.save();
    ctx.fillStyle = '#1a1538';
    ctx.shadowColor = 'rgba(88,101,242,0.4)';
    ctx.shadowBlur = 40;
    ctx.beginPath();
    ctx.arc(avatarX + avatarSize / 2, centerY, avatarSize / 2 + 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#5865F2';
    ctx.font = '56px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(member.displayName.charAt(0).toUpperCase(), avatarX + avatarSize / 2, centerY);
    ctx.restore();
  }

  const textX = avatarX + avatarSize + 60;
  const maxTextWidth = w - textX - 100;
  const fontName = fontRegistered ? 'CustomFont, ' : '';

  let name = member.displayName;
  const nameSize = name.length > 14 ? 28 : name.length > 10 ? 32 : 36;
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#ffffff';

  ctx.font = `bold ${nameSize}px ${fontName}sans-serif`;
  while (ctx.measureText(name).width > maxTextWidth && name.length > 1) {
    name = name.slice(0, -1);
  }
  ctx.fillText(name.toUpperCase(), textX, centerY - 40);

  const nameW = Math.min(ctx.measureText(name.toUpperCase()).width, maxTextWidth);
  ctx.shadowColor = 'rgba(88,101,242,0.3)';
  ctx.shadowBlur = 10;
  ctx.fillStyle = accentGrad;
  ctx.fillRect(textX, centerY - 20, nameW, 2);
  ctx.shadowBlur = 0;

  ctx.font = '15px sans-serif';
  ctx.fillStyle = 'rgba(255,255,255,0.45)';
  ctx.fillText(`@${member.user.username.toLowerCase()}`, textX, centerY + 6);

  const infoY = centerY + 45;
  const infoItems = [
    { label: 'member', value: `#${member.guild.memberCount}` },
    { label: 'id', value: member.user.id },
  ];

  infoItems.forEach((item, i) => {
    const ix = textX + i * 190;
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.2)';
    ctx.shadowBlur = 8;
    ctx.shadowOffsetY = 2;
    ctx.fillStyle = 'rgba(255,255,255,0.04)';
    ctx.beginPath();
    ctx.roundRect(ix, infoY - 2, 175, 52, 10);
    ctx.fill();
    ctx.restore();

    ctx.fillStyle = 'rgba(255,255,255,0.2)';
    ctx.font = '10px sans-serif';
    ctx.textBaseline = 'bottom';
    ctx.fillText(item.label.toUpperCase(), ix + 14, infoY + 20);

    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.font = '15px monospace';
    ctx.textBaseline = 'top';
    ctx.fillText(item.value, ix + 14, infoY + 24);
  });

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

  const buffer = canvas.toBuffer('image/png');
  return new AttachmentBuilder(buffer, { name: 'welcome.png' });
}

module.exports = { createWelcomeEmbed, createWelcomeCanvas };
