const { REST, Routes, SlashCommandBuilder } = require('discord.js');
const config = require('./config');

// Đặt tên theo chuẩn bot quốc tế (tiếng Anh, lệnh ngắn — ví dụ /purge, /mute, /slowmode...).
// Mô tả giữ tiếng Việt (Discord bắt buộc lệnh/option phải có mô tả, không để trống được).
const commands = [
  new SlashCommandBuilder()
    .setName('purge')
    .setDescription('Xóa tin nhắn (tối đa 1000, kể cả tin cũ)')
    .addIntegerOption(o => o.setName('amount').setDescription('Số lượng (tối đa 1000)').setRequired(true).setMinValue(1).setMaxValue(1000))
    .addUserOption(o => o.setName('user').setDescription('Lọc theo user').setRequired(false)),

  new SlashCommandBuilder()
    .setName('mute')
    .setDescription('Cấm chat user')
    .addUserOption(o => o.setName('user').setDescription('User').setRequired(true)),

  new SlashCommandBuilder()
    .setName('unmute')
    .setDescription('Gỡ cấm chat user')
    .addUserOption(o => o.setName('user').setDescription('User').setRequired(true)),

  new SlashCommandBuilder()
    .setName('lock')
    .setDescription('Khóa kênh'),

  new SlashCommandBuilder()
    .setName('unlock')
    .setDescription('Mở kênh'),

  new SlashCommandBuilder()
    .setName('say')
    .setDescription('Gửi tin nhắn')
    .addStringOption(o => o.setName('type').setDescription('bot/role/dm').setRequired(true).addChoices({ name: 'Bot', value: 'bot' }, { name: 'Role', value: 'role' }, { name: 'DM', value: 'dm' }))
    .addStringOption(o => o.setName('content').setDescription('Nội dung').setRequired(false))
    .addIntegerOption(o => o.setName('times').setDescription('Số lần gửi (chỉ dùng cho Bot, tối đa 5)').setRequired(false).setMinValue(1).setMaxValue(5))
    .addRoleOption(o => o.setName('role').setDescription('Role nhận DM (nếu chọn Role)').setRequired(false))
    .addUserOption(o => o.setName('user').setDescription('Người nhận (nếu chọn DM)').setRequired(false))
    .addAttachmentOption(o => o.setName('file').setDescription('File đính kèm').setRequired(false)),

  new SlashCommandBuilder()
    .setName('setup')
    .setDescription('Cấu hình và tạo UI')
    .addStringOption(o => o.setName('type').setDescription('Loại').setRequired(true)
      .addChoices(
        { name: 'Ticket', value: 'ticket' },
      )),

  new SlashCommandBuilder()
    .setName('slowmode')
    .setDescription('Set slowmode')
    .addIntegerOption(o => o.setName('seconds').setDescription('Số giây').setRequired(true).setMinValue(0).setMaxValue(21600)),

  new SlashCommandBuilder()
    .setName('changelog')
    .setDescription('Gửi embed cập nhật'),

  new SlashCommandBuilder()
    .setName('list')
    .setDescription('Xem danh sách')
    .addStringOption(o => o.setName('type').setDescription('Loại danh sách').setRequired(true)
      .addChoices(
        { name: 'All', value: 'all' },
        { name: 'Owners', value: 'owners' },
        { name: 'Auto-delete', value: 'autodelete' },
        { name: 'Badwords', value: 'badwords' },
        { name: 'Emoji roles', value: 'emojiroles' },
        { name: 'Setup', value: 'setup' },
      )),

  new SlashCommandBuilder()
    .setName('add')
    .setDescription('Thêm vào danh sách')
    .addStringOption(o => o.setName('type').setDescription('Loại').setRequired(true)
      .addChoices(
        { name: 'Owners', value: 'owners' },
        { name: 'Auto-delete', value: 'autodelete' },
        { name: 'Badwords', value: 'badwords' },
      ))
    .addStringOption(o => o.setName('id').setDescription('ID (dùng cho auto-delete/owners)').setRequired(false))
    .addStringOption(o => o.setName('content').setDescription('Nội dung (dùng cho badwords)').setRequired(false)),

  new SlashCommandBuilder()
    .setName('remove')
    .setDescription('Xóa khỏi danh sách')
    .addStringOption(o => o.setName('type').setDescription('Loại').setRequired(true)
      .addChoices(
        { name: 'Owners', value: 'owners' },
        { name: 'Auto-delete', value: 'autodelete' },
        { name: 'Badwords', value: 'badwords' },
      ))
    .addStringOption(o => o.setName('id').setDescription('ID (dùng cho auto-delete/owners)').setRequired(false))
    .addStringOption(o => o.setName('content').setDescription('Nội dung (dùng cho badwords)').setRequired(false)),

  new SlashCommandBuilder()
    .setName('dmhistory')
    .setDescription('Xem lịch sử DM với người dùng')
    .addUserOption(o => o.setName('user').setDescription('Người dùng cần xem lịch sử DM').setRequired(true)),

  new SlashCommandBuilder()
    .setName('test')
    .setDescription('Kiểm tra bad words hoặc OCR')
    .addStringOption(o => o.setName('type').setDescription('text/image').setRequired(true)
      .addChoices(
        { name: 'Text', value: 'text' },
        { name: 'Image', value: 'image' },
      ))
    .addStringOption(o => o.setName('content').setDescription('Nội dung cần test').setRequired(false))
    .addAttachmentOption(o => o.setName('file').setDescription('File ảnh (dùng cho image)').setRequired(false)),

  new SlashCommandBuilder()
    .setName('emojisync')
    .setDescription('Cập nhật emoji từ role cho tất cả member'),

  new SlashCommandBuilder()
    .setName('reactionroles')
    .setDescription('Gửi panel chọn role bằng emoji'),

  new SlashCommandBuilder()
    .setName('help')
    .setDescription('Hướng dẫn sử dụng lệnh, bot và các tính năng')
    .addStringOption(o => o.setName('page').setDescription('Trang cần xem').setRequired(false)
      .addChoices(
        { name: 'Getting started', value: 'start' },
        { name: 'Moderation', value: 'moderation' },
        { name: 'Auto-moderation', value: 'automod' },
        { name: 'Lists', value: 'lists' },
        { name: 'Misc', value: 'misc' },
      )),

  new SlashCommandBuilder()
    .setName('scan')
    .setDescription('Quét tin nhắn tìm badword trong toàn bộ server')
    .addBooleanOption(o => o.setName('delete').setDescription('Xóa các tin nhắn chứa badword (mặc định: chỉ xem)').setRequired(false)),
].map(c => c.toJSON());

const rest = new REST({ version: '10' }).setToken(config.token);

(async () => {
  try {
    console.log('Đang đăng ký lệnh global...');
    const existing = await rest.get(Routes.applicationCommands(config.clientId));
    const entryPoint = existing.find(c => c.type === 4);
    const toDeploy = entryPoint
      ? [...commands, (({ id, application_id, version, ...rest }) => rest)(entryPoint)]
      : commands;
    await rest.put(Routes.applicationCommands(config.clientId), { body: toDeploy });
    console.log('Đã đăng ký lệnh global thành công!');
  } catch (e) {
    console.error('Lỗi global:', e.message);
  }

  try {
    console.log('Đang xóa lệnh guild cũ...');
    await rest.put(Routes.applicationGuildCommands(config.clientId, config.guildId), { body: [] });
    console.log('Đã xóa lệnh guild thành công!');
  } catch (e) {
    console.error('Lỗi guild:', e.message);
  }
})();
