const { EmbedBuilder, AttachmentBuilder } = require('discord.js');
const { createCanvas, loadImage, registerFont } = require('canvas');
const path = require('path');
const fs = require('fs');

// ─── Phông chữ ───
// Bộ font nằm trong docs/fonts/*.ttf (cùng bản web dùng qua @font-face) — không nhân đôi dung lượng.
//
// QUAN TRỌNG: node-canvas KHÔNG nhận tham số `family`/`weight` của registerFont — nó đọc
// tên family NGAY TRONG tệp (name table, nameID 1 hoặc 16) và đăng ký dưới đúng tên đó
// (xem node_modules/canvas/src/register_font.cc → get_family_name). Vì vậy `family` dưới
// đây PHẢI là tên family thật trong tệp, nếu sai canvas sẽ âm thầm rơi về Sans.
// Tên đã kiểm chứng bằng cách tái hiện get_family_name() cho từng tệp.
const FONT_DIRS = [
  path.join(__dirname, '..', 'docs', 'fonts'),
  path.join(__dirname, '..', 'fonts')
];

// key (lưu trong config) → { label, family (tên THẬT trong tệp), regular, bold }
// (chỉ phông `sans`/`serif`/`mono` là dùng font hệ thống; còn lại là tệp trong docs/fonts).
const WELCOME_FONTS = {
  sans: { label: 'Mặc định (không chân)', family: 'sans-serif', file: null },
  serif: { label: 'Mặc định (có chân)', family: 'serif', file: null },
  mono: { label: 'Mặc định (đều)', family: 'monospace', file: null },
  bevietnam: { label: 'Be Vietnam Pro', family: 'Be Vietnam Pro', regular: 'BeVietnamPro-Regular.ttf', bold: 'BeVietnamPro-Bold.ttf' },
  montserrat: { label: 'Montserrat', family: 'Montserrat', regular: 'Montserrat.ttf', bold: null },
  oswald: { label: 'Oswald', family: 'Oswald', regular: 'Oswald.ttf', bold: null },
  playfair: { label: 'Playfair Display', family: 'Playfair Display', regular: 'PlayfairDisplay.ttf', bold: null },
  dancing: { label: 'Dancing Script', family: 'Dancing Script', regular: 'DancingScript.ttf', bold: null },
  slab: { label: 'Roboto Slab', family: 'Roboto Slab', regular: 'RobotoSlab.ttf', bold: null },
  rubik: { label: 'Rubik', family: 'Rubik', regular: 'Rubik.ttf', bold: null },
  kanit: { label: 'Kanit', family: 'Kanit', regular: 'Kanit-Regular.ttf', bold: 'Kanit-Bold.ttf' },
  bebas: { label: 'Bebas Neue', family: 'Bebas Neue', regular: 'BebasNeue-Regular.ttf', bold: null },
  lobster: { label: 'Lobster', family: 'Lobster', regular: 'Lobster-Regular.ttf', bold: null },
  pacifico: { label: 'Pacifico', family: 'Pacifico', regular: 'Pacifico-Regular.ttf', bold: null }
};

// key → true nếu tệp đã được registerFont thành công (để quyết định ghép font-family).
const registeredFamilies = {};
let fontRegistered = false;

// Tìm tệp font theo tên trong các thư mục dự phòng.
function findFontFile(name) {
  for (const dir of FONT_DIRS) {
    for (const e of ['.ttf', '.otf']) {
      const fp = path.join(dir, String(name).replace(/\.(ttf|otf)$/i, '') + e);
      if (fs.existsSync(fp)) return fp;
    }
  }
  return null;
}

function registerFonts() {
  if (fontRegistered) return;
  fontRegistered = true;
  for (const key of Object.keys(WELCOME_FONTS)) {
    const f = WELCOME_FONTS[key];
    if (!f.regular) continue;
    const reg = findFontFile(f.regular);
    if (!reg) continue; // thiếu tệp ⇒ rơi về phông hệ thống, không lỗi.
    try {
      // node-canvas BẮT BUỘC tham số 2, nhưng bên trong nó BỎ QUA `family`/`weight` và
      // tự đọc tên family từ chính tệp (register_font.cc → get_family_name). Vì vậy ta
      // truyền đúng tên thật trong tệp: vừa hợp lệ, vừa đúng nếu canvas đổi hành vi sau này.
      registerFont(reg, { family: f.family });
      const bold = f.bold ? findFontFile(f.bold) : null;
      if (bold) registerFont(bold, { family: f.family, weight: 'bold' });
      registeredFamilies[key] = true;
    } catch (e) {
      console.error('[welcome] không nạp được phông', key, e && e.message);
    }
  }
}

// Chuỗi font-family cho canvas: phông hệ thống giữ nguyên; phông tệp chỉ ghép tên
// THẬT khi đã nạp được (nếu không, để rơi về sans-serif thay vì tên không tồn tại).
function fontStack(key) {
  const f = WELCOME_FONTS[key];
  if (!f) return 'sans-serif';
  if (!f.regular) return f.family;
  return registeredFamilies[key] ? `'${f.family}', sans-serif` : 'sans-serif';
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

// Đường bao avatar — nhận w/h RIÊNG (avatar nay là hình chữ nhật, không còn vuông).
function avatarPath(ctx, x, y, w, h, shape) {
  if (shape === 'square') { ctx.rect(x, y, w, h); return; }
  if (shape === 'rounded') { ctx.roundRect(x, y, w, h, Math.min(w, h) * 0.18); return; }
  ctx.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
}

// Định dạng ngày kiểu tiếng Việt: "20 tháng 10 2026".
const VN_MONTHS = ['tháng 1', 'tháng 2', 'tháng 3', 'tháng 4', 'tháng 5', 'tháng 6', 'tháng 7', 'tháng 8', 'tháng 9', 'tháng 10', 'tháng 11', 'tháng 12'];
function vnDate(d) {
  const t = d instanceof Date ? d : new Date(d);
  if (!t || Number.isNaN(t.getTime())) return '';
  return `${t.getDate()} ${VN_MONTHS[t.getMonth()]} ${t.getFullYear()}`;
}
// Hậu tố thứ tự: 1 → 1st, 2 → 2nd, 3 → 3rd, 4 → 4th...
function ordinalSuffix(n) {
  const num = Math.abs(Math.round(Number(n) || 0));
  const s = ['th', 'st', 'nd', 'rd'], v = num % 100;
  return num + (s[(v - 20) % 10] || s[v] || s[0]);
}

function interpolateWelcome(tpl, member) {
  const guild = member.guild || {};
  const user = member.user || {};
  // Ngày: ưu tiên trường thật của Discord; nếu thiếu thì để rỗng (không vẽ chữ thừa).
  const joinedAt = member.joinedAt || member.joinedTimestamp || null;
  const createdRaw = user.createdAt || user.createdTimestamp || null;
  return String(tpl)
    .replace(/\{mention\}/gi, `<@${user.id}>`)
    .replace(/\{user\}/gi, member.displayName || user.username || '')
    .replace(/\{server\}/gi, guild.name || '')
    .replace(/\{count\}/gi, String(guild.memberCount == null ? '' : guild.memberCount))
    .replace(/\{id\}/gi, user.id || '')
    .replace(/\{tag\}/gi, user.tag || user.username || '')
    .replace(/\{username\}/gi, user.username || '')
    .replace(/\{joined\}/gi, joinedAt ? vnDate(joinedAt) : '')
    .replace(/\{created\}/gi, createdRaw ? vnDate(createdRaw) : '')
    .replace(/\{ordinal\}/gi, ordinalSuffix(guild.memberCount));
}

// ─── Phần tử trên ảnh welcome ───
// 5 loại: text (chữ tự do) · name (tên hiển thị) · user (@tài khoản) · box (ô nhãn + giá trị) · guildicon (icon server).
// Mọi phần tử đều kéo/giãn/xoá riêng được. Thứ tự vẽ: theo đúng thứ tự trong mảng.
const EL_KINDS = ['text', 'name', 'user', 'box', 'guildicon'];

function clampNum(v, mn, mx, d) {
  const n = Number(v);
  return Math.max(mn, Math.min(mx, Number.isFinite(n) ? n : d));
}

// Bố cục mặc định — giống y hệt khối thông tin cũ, nhưng tách thành 4 phần tử rời.
function defaultWelcomeEls(avatarX, avatarSize) {
  const dx = Math.round(avatarX + avatarSize + 60);
  const dy = Math.round(450 / 2 - 10 - 58);
  const dw = Math.max(120, Math.round(900 - dx - 100));
  return [
    { kind: 'name', x: dx, y: dy + 18, w: dw, size: 36, color: '#ffffff', bold: true, align: 'left', font: 'sans', upper: true },
    { kind: 'user', x: dx, y: dy + 64, size: 15, color: 'rgba(255,255,255,0.45)', align: 'left', font: 'sans' },
    { kind: 'box', x: dx, y: dy + 99, w: 175, h: 52, label: 'MEMBER', text: '#{count}', size: 15, color: 'rgba(255,255,255,0.6)', labelColor: 'rgba(255,255,255,0.2)', labelSize: 10, font: 'mono', box: true },
    { kind: 'box', x: dx + 190, y: dy + 99, w: 175, h: 52, label: 'ID', text: '{id}', size: 15, color: 'rgba(255,255,255,0.6)', labelColor: 'rgba(255,255,255,0.2)', labelSize: 10, font: 'mono', box: true }
  ];
}

// Chuyển khối 'info' (mô hình cũ) sang 4 phần tử — để config cũ giữ nguyên diện mạo.
function elsFromInfo(info) {
  const cl = (v, mn, mx, d) => Math.max(mn, Math.min(mx, Math.round(Number(v) || d)));
  const x = cl(info.x, -100, 1200, 255);
  const y = cl(info.y, -100, 700, 157);
  const iw = cl(info.w, 120, 900, 545);
  const ih = cl(info.h, 50, 400, 153);
  const nameSize = Math.max(12, Math.min(60, Math.min(36, Math.round(ih * 0.28))));
  const nameCY = y + nameSize / 2;
  const boxTop = nameCY + 83;
  const boxH = Math.max(24, Math.min(200, y + ih - boxTop));
  const boxW = Math.min(175, Math.max(90, (iw - 15) / 2));
  return [
    { kind: 'name', x, y: Math.round(nameCY), w: iw, size: nameSize, color: '#ffffff', bold: true, align: 'left', font: 'sans', upper: true },
    { kind: 'user', x, y: Math.round(nameCY + 46), size: 15, color: 'rgba(255,255,255,0.45)', align: 'left', font: 'sans' },
    { kind: 'box', x, y: Math.round(boxTop - 2), w: boxW, h: boxH, label: 'MEMBER', text: '#{count}', size: 15, color: 'rgba(255,255,255,0.6)', labelColor: 'rgba(255,255,255,0.2)', labelSize: 10, font: 'mono', box: true },
    { kind: 'box', x: Math.round(x + boxW + 15), y: Math.round(boxTop - 2), w: boxW, h: boxH, label: 'ID', text: '{id}', size: 15, color: 'rgba(255,255,255,0.6)', labelColor: 'rgba(255,255,255,0.2)', labelSize: 10, font: 'mono', box: true }
  ];
}

// Nội dung chữ của một phần tử (name/user lấy từ thành viên, còn lại dùng mẫu).
function elText(t, member) {
  if (t.kind === 'name') {
    const n = member.displayName || member.user.username || '';
    return t.upper === false ? n : n.toUpperCase();
  }
  if (t.kind === 'user') return '@' + String(member.user.username || '').toLowerCase();
  return interpolateWelcome(typeof t.text === 'string' ? t.text : '', member);
}

function elFont(t, size) {
  const key = WELCOME_FONTS[t.font] ? t.font : 'sans';
  // Tự kẹp cỡ 8..96 (khớp drawWelcomeEl + wElFont của panel) để không phụ thuộc nơi gọi.
  // KHÔNG làm tròn: hình học trong drawWelcomeEl cũng dùng đúng số chưa tròn này.
  const n = Number(size);
  const px = Math.max(8, Math.min(96, Number.isFinite(n) ? n : 28));
  return `${t.italic ? 'italic ' : ''}${t.bold ? 'bold ' : ''}${px}px ${fontStack(key)}`;
}

// Vẽ một phần tử. Trả về khung bao để panel đối chiếu.
// images: { guild } — ảnh icon server đã nạp (chỉ cần cho kind 'guildicon').
function drawWelcomeEl(ctx, t, member, accentGrad, images) {
  const kind = EL_KINDS.includes(t.kind) ? t.kind : 'text';
  const size = clampNum(t.size, 8, 96, kind === 'text' ? 28 : 20);
  const align = t.align === 'left' ? 'left' : (t.align === 'right' ? 'right' : 'center');
  const x = clampNum(t.x, -100, 1200, 450);
  const y = clampNum(t.y, -100, 700, 225);
  const hasW = Number.isFinite(Number(t.w)) && Number(t.w) > 0;
  const hasH = Number.isFinite(Number(t.h)) && Number(t.h) > 0;
  const fw = hasW ? Math.max(10, Math.min(900, Number(t.w))) : 0;
  const fh = hasH ? Math.max(8, Math.min(400, Number(t.h))) : 0;
  const color = typeof t.color === 'string' && t.color.trim() ? t.color.trim().slice(0, 40) : '#ffffff';
  const shadow = !!t.shadow;

  ctx.save();
  ctx.font = elFont(t, size);
  ctx.textAlign = align;

  if (kind === 'guildicon') {
    // Icon server (avatar nhóm) — ảnh tròn/vuông, kéo/di chuyển/đổi kích thước như avatar.
    const iw = hasW ? fw : 64;
    const ih = hasH ? fh : iw;
    const ix = align === 'left' ? x : (align === 'right' ? x - iw : x - iw / 2);
    const shape = ['square', 'rounded'].includes(t.shape) ? t.shape : 'circle';
    ctx.save();
    if (shadow) {
      ctx.shadowColor = 'rgba(0,0,0,0.35)';
      ctx.shadowBlur = 10;
      ctx.shadowOffsetY = 2;
    }
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    ctx.beginPath();
    avatarPath(ctx, ix, y, iw, ih, shape);
    ctx.fill();
    ctx.restore();
    const img = images && images.guild;
    if (img) {
      ctx.save();
      ctx.beginPath();
      avatarPath(ctx, ix, y, iw, ih, shape);
      ctx.closePath();
      ctx.clip();
      ctx.drawImage(img, ix, y, iw, ih);
      ctx.restore();
    }
    ctx.restore();
    return { left: ix, top: y, w: iw, h: ih };
  }

  if (kind === 'box') {
    const bw = hasW ? fw : 175;
    const bh = hasH ? fh : 52;
    const bx = align === 'left' ? x : (align === 'right' ? x - bw : x - bw / 2);
    // Nền khối chỉ vẽ khi bật 'box' — mặc định TRONG SUỐT (không còn nền đen/xám).
    if (t.box === true) {
      ctx.save();
      ctx.shadowColor = 'rgba(0,0,0,0.2)';
      ctx.shadowBlur = 8;
      ctx.shadowOffsetY = 2;
      ctx.fillStyle = 'rgba(255,255,255,0.04)';
      ctx.beginPath();
      ctx.roundRect(bx, y, bw, bh, 10);
      ctx.fill();
      ctx.restore();
    }

    const lSize = clampNum(t.labelSize, 6, 40, 10);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'bottom';
    ctx.font = elFont({ font: t.font, italic: t.italic, bold: true }, lSize);
    ctx.fillStyle = typeof t.labelColor === 'string' && t.labelColor.trim() ? t.labelColor.trim().slice(0, 40) : 'rgba(255,255,255,0.2)';
    ctx.fillText(String(t.label || '').toUpperCase(), bx + 14, y + 22);

    ctx.textBaseline = 'top';
    ctx.font = elFont(t, size);
    ctx.fillStyle = color;
    const label = elText(t, member);
    ctx.fillText(label, bx + 14, y + 26);
    ctx.restore();
    return { left: bx, top: y, w: bw, h: bh };
  }

  const text = elText(t, member);
  // name / user: y là TÂM chữ; text: y là MÉP TRÊN chữ.
  const baseline = kind === 'text' ? 'top' : 'middle';
  ctx.textBaseline = baseline;

  const tw = ctx.measureText(text).width;
  const boxW = kind === 'name' ? (hasW ? fw : tw) : tw;
  const left = align === 'left' ? x : (align === 'right' ? x - boxW : x - boxW / 2);

  // Khung nền (chỉ ô chữ tự do).
  if (kind === 'text' && t.box) {
    const pad = Math.max(6, size * 0.3);
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    ctx.beginPath();
    ctx.roundRect(left - pad, y - pad * 0.5, (hasW ? fw : tw) + pad * 2, (hasH ? fh : size * 1.25) + pad, Math.min(10, size * 0.35));
    ctx.fill();
  }

  if (kind === 'name') {
    // Cắt bớt nếu vượt quá bề rộng cho phép (w) — giống hệt panel.
    let shown = text;
    if (hasW) {
      while (shown.length > 1 && ctx.measureText(shown).width > fw) shown = shown.slice(0, -1);
    }
    if (shadow) {
      ctx.shadowColor = 'rgba(0,0,0,0.55)';
      ctx.shadowBlur = Math.max(4, size * 0.25);
      ctx.shadowOffsetY = 2;
    }
    ctx.fillStyle = color;
    ctx.fillText(shown, x, y);

    ctx.restore();
    return { left, top: y - size * 0.62, w: hasW ? fw : tw, h: size * 1.25 };
  }

  if (shadow) {
    ctx.shadowColor = 'rgba(0,0,0,0.55)';
    ctx.shadowBlur = Math.max(4, size * 0.25);
    ctx.shadowOffsetY = 2;
  }
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
  ctx.restore();
  return { left, top: baseline === 'middle' ? y - size * 0.62 : y, w: hasW ? fw : tw, h: hasH ? fh : size * 1.25 };
}

function drawWelcomeEls(ctx, opts, member, accentGrad, avatarX, avatarSize, images) {
  let list;
  if (opts && opts.elsCustom === true && Array.isArray(opts.texts)) {
    list = opts.texts.slice(0, 24);
  } else {
    const inf = (opts && opts.info && typeof opts.info === 'object' && Number.isFinite(Number(opts.info.x))) ? opts.info : null;
    list = inf ? elsFromInfo(inf).concat(Array.isArray(opts.texts) ? opts.texts.slice(0, 20) : [])
               : defaultWelcomeEls(avatarX, avatarSize).concat(Array.isArray(opts.texts) ? opts.texts.slice(0, 20) : []);
  }
  for (const t of list) {
    if (!t || typeof t !== 'object') continue;
    drawWelcomeEl(ctx, t, member, accentGrad, images);
  }
}

async function createWelcomeCanvas(member, opts = {}, bg) {
  const backgroundUrl = typeof opts.backgroundUrl === 'string' ? opts.backgroundUrl.trim() : '';
  const shape = ['circle', 'square', 'rounded'].includes(opts.avatarShape) ? opts.avatarShape : 'circle';

  registerFonts();

  const W = 1800;
  const H = 900;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');
  ctx.scale(2, 2);

  const w = 900, h = 450;

  /* Nền mặc định: TRONG SUỐT (PNG alpha) — không tô đen, không lớp phủ.
     Ảnh nền (nếu có) được vẽ trùm lên trên GIỮ NGUYÊN màu — không đè lớp tối. */
  let bgImage = null;
  if (bg && bg.length) {
    try { bgImage = await loadImage(bg); } catch (e) { console.error('[welcome] ảnh nền lỗi (' + e.message + ') — để nền trong suốt.'); }
  } else if (backgroundUrl) {
    try { bgImage = await loadImage(backgroundUrl); } catch (e) { console.error('[welcome] không tải được ảnh nền (' + e.message + '):', backgroundUrl); }
  }
  if (bgImage) {
    const z = Math.max(0.5, Math.min(3, (Number(opts.bgZoom) || 100) / 100));
    const scale = Math.max(w / bgImage.width, h / bgImage.height) * z;
    const dw = bgImage.width * scale;
    const dh = bgImage.height * scale;
    const dx = (w - dw) / 2 + (Number(opts.bgX) || 0);
    const dy = (h - dh) / 2 + (Number(opts.bgY) || 0);
    ctx.drawImage(bgImage, dx, dy, dw, dh);
  }

  const accentGrad = ctx.createLinearGradient(0, 0, w, 0);
  accentGrad.addColorStop(0, '#5865F2');
  accentGrad.addColorStop(0.3, '#7c4dff');
  accentGrad.addColorStop(0.6, '#e040a0');
  accentGrad.addColorStop(1, '#ff6f6f');

  ctx.restore();

  const avatarX = Math.max(10, Math.min(860, Number(opts.avatarX) || 65));
  const centerY = h / 2 - 10;
  const avatarW = Math.max(40, Math.min(860, Number(opts.avatarW) || Number(opts.avatarSize) || 130));
  const avatarH = Math.max(40, Math.min(440, Number(opts.avatarH) || Number(opts.avatarSize) || 130));
  const avatarY = Math.max(10, Math.min(450 - avatarH, Number(opts.avatarY) || (centerY - avatarH / 2)));

  try {
    const avatarUrl = member.user.displayAvatarURL({ size: 512, extension: 'png' });
    const avatar = await loadImage(avatarUrl);

    /* Ảnh avatar — KHÔNG khung, KHÔNG viền (đã bỏ hết vòng màu + vòng trắng). */
    ctx.save();
    ctx.beginPath();
    avatarPath(ctx, avatarX, avatarY, avatarW, avatarH, shape);
    ctx.closePath();
    ctx.clip();
    ctx.drawImage(avatar, avatarX, avatarY, avatarW, avatarH);
    ctx.restore();
  } catch {
    ctx.save();
    ctx.fillStyle = '#1a1538';
    ctx.beginPath();
    avatarPath(ctx, avatarX, avatarY, avatarW, avatarH, shape);
    ctx.fill();
    ctx.fillStyle = '#5865F2';
    ctx.font = `${Math.round(Math.min(avatarW, avatarH) * 0.43)}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(member.displayName.charAt(0).toUpperCase(), avatarX + avatarW / 2, avatarY + avatarH / 2);
    ctx.restore();
  }

  // Nạp icon server TRƯỚC khi vẽ phần tử (để phần tử 'guildicon' có ảnh dùng ngay).
  const images = { guild: null };
  try {
    const guildIcon = member.guild.iconURL({ size: 256, extension: 'png' });
    if (guildIcon) images.guild = await loadImage(guildIcon);
  } catch {}

  drawWelcomeEls(ctx, opts, member, accentGrad, avatarX, avatarW, images);

  // Nền phẳng: KHÔNG còn dòng "tên server · ngày" hay hoa văn ở đáy (đã bỏ theo yêu cầu).
  const buffer = canvas.toBuffer('image/png');
  return new AttachmentBuilder(buffer, { name: 'welcome.png' });
}

module.exports = { createWelcomeEmbed, createWelcomeCanvas, interpolateWelcome, defaultWelcomeEls, elsFromInfo, WELCOME_FONTS };
