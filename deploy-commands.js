const { REST, Routes, SlashCommandBuilder } = require('discord.js');
const config = require('./config');

// Chuẩn quốc tế (kiểu Dyno/Carl-bot/ProBot): lệnh cha + subcommand, picker User/Role,
// moderation có reason. Mô tả giữ tiếng Việt (Discord bắt buộc lệnh/option phải có mô tả).
const commands = [
  new SlashCommandBuilder()
    .setName('purge')
    .setDescription('Xóa tin nhắn (tối đa 1000, kể cả tin cũ)')
    .addIntegerOption(o => o.setName('amount').setDescription('Số lượng (tối đa 1000)').setRequired(true).setMinValue(1).setMaxValue(1000))
    .addUserOption(o => o.setName('member').setDescription('Lọc theo member').setRequired(false))
    .addStringOption(o => o.setName('reason').setDescription('Lý do (ghi vào log)').setRequired(false).setMaxLength(300)),

  new SlashCommandBuilder()
    .setName('mute')
    .setDescription('Cấm chat member trong server')
    .addUserOption(o => o.setName('member').setDescription('Member cần cấm chat').setRequired(true))
    .addStringOption(o => o.setName('duration').setDescription('Thời hạn: 30s/10m/2h/7d (trống = vĩnh viễn, tối đa 28 ngày)').setRequired(false).setMaxLength(10))
    .addStringOption(o => o.setName('reason').setDescription('Lý do (ghi vào log)').setRequired(false).setMaxLength(300)),

  new SlashCommandBuilder()
    .setName('unmute')
    .setDescription('Gỡ cấm chat member')
    .addUserOption(o => o.setName('member').setDescription('Member cần gỡ cấm').setRequired(true))
    .addStringOption(o => o.setName('reason').setDescription('Lý do (ghi vào log)').setRequired(false).setMaxLength(300)),

  new SlashCommandBuilder()
    .setName('lock')
    .setDescription('Khóa kênh')
    .addStringOption(o => o.setName('reason').setDescription('Lý do (ghi vào log)').setRequired(false).setMaxLength(300)),

  new SlashCommandBuilder()
    .setName('unlock')
    .setDescription('Mở kênh')
    .addStringOption(o => o.setName('reason').setDescription('Lý do (ghi vào log)').setRequired(false).setMaxLength(300)),

  new SlashCommandBuilder()
    .setName('say')
    .setDescription('Bot gửi tin nhắn vào kênh hiện tại')
    .addStringOption(o => o.setName('message').setDescription('Nội dung tin nhắn').setRequired(false).setMaxLength(2000))
    .addAttachmentOption(o => o.setName('attachment').setDescription('File đính kèm').setRequired(false)),

  new SlashCommandBuilder()
    .setName('dm')
    .setDescription('Gửi DM cho 1 member hoặc cả role')
    .addUserOption(o => o.setName('user').setDescription('Người nhận (chọn user HOẶC role)').setRequired(false))
    .addRoleOption(o => o.setName('role').setDescription('Gửi hàng loạt cho member có role').setRequired(false))
    .addStringOption(o => o.setName('message').setDescription('Nội dung DM').setRequired(false).setMaxLength(2000))
    .addAttachmentOption(o => o.setName('attachment').setDescription('File đính kèm').setRequired(false)),

  new SlashCommandBuilder()
    .setName('slowmode')
    .setDescription('Set slowmode')
    .addIntegerOption(o => o.setName('seconds').setDescription('Số giây').setRequired(true).setMinValue(0).setMaxValue(21600)),

  new SlashCommandBuilder()
    .setName('changelog')
    .setDescription('Gửi embed cập nhật'),

  new SlashCommandBuilder()
    .setName('config')
    .setDescription('Xem cấu hình của bot')
    .addSubcommand(sc => sc.setName('view').setDescription('Xem toàn bộ dữ liệu bot'))
    .addSubcommand(sc => sc.setName('emojiroles').setDescription('Xem role có emoji (cấu hình trên web)'))
    .addSubcommand(sc => sc.setName('channels').setDescription('Xem kênh voice hub bot đã tạo')),

  new SlashCommandBuilder()
    .setName('badwords')
    .setDescription('Quản lý từ cấm (auto-moderation)')
    .addSubcommand(sc => sc.setName('add').setDescription('Thêm từ cấm')
      .addStringOption(o => o.setName('word').setDescription('Từ/cụm từ cần cấm').setRequired(true).setMaxLength(100)))
    .addSubcommand(sc => sc.setName('remove').setDescription('Xóa từ cấm')
      .addStringOption(o => o.setName('word').setDescription('Từ/cụm từ cần gỡ').setRequired(true).setMaxLength(100)))
    .addSubcommand(sc => sc.setName('list').setDescription('Xem danh sách từ cấm')),

  new SlashCommandBuilder()
    .setName('autodelete')
    .setDescription('Quản lý tự động xóa tin nhắn của user')
    .addSubcommand(sc => sc.setName('add').setDescription('Thêm user vào danh sách auto-xóa')
      .addUserOption(o => o.setName('user').setDescription('User').setRequired(true)))
    .addSubcommand(sc => sc.setName('remove').setDescription('Bỏ auto-xóa cho user')
      .addUserOption(o => o.setName('user').setDescription('User').setRequired(true)))
    .addSubcommand(sc => sc.setName('list').setDescription('Xem danh sách auto-xóa')),

  new SlashCommandBuilder()
    .setName('owner')
    .setDescription('Quản lý chủ sở hữu của bot')
    .addSubcommand(sc => sc.setName('add').setDescription('Thêm chủ sở hữu')
      .addUserOption(o => o.setName('user').setDescription('User').setRequired(true)))
    .addSubcommand(sc => sc.setName('remove').setDescription('Bỏ chủ sở hữu')
      .addUserOption(o => o.setName('user').setDescription('User').setRequired(true)))
    .addSubcommand(sc => sc.setName('list').setDescription('Xem danh sách chủ sở hữu')),

  new SlashCommandBuilder()
    .setName('dmlogs')
    .setDescription('Xem lịch sử DM với user')
    .addUserOption(o => o.setName('user').setDescription('Người dùng cần xem lịch sử DM').setRequired(true)),

  new SlashCommandBuilder()
    .setName('automod')
    .setDescription('Auto-moderation')
    .addSubcommand(sc => sc.setName('scan').setDescription('Quét badword trong toàn bộ server')
      .addBooleanOption(o => o.setName('delete_messages').setDescription('Xóa tin chứa badword (mặc định: chỉ xem)').setRequired(false)))
    .addSubcommand(sc => sc.setName('test').setDescription('Test badword trong tin nhắn hoặc ảnh')
      .addStringOption(o => o.setName('type').setDescription('text/image').setRequired(true)
        .addChoices({ name: 'Text', value: 'text' }, { name: 'Image', value: 'image' }))
      .addStringOption(o => o.setName('content').setDescription('Nội dung cần test (dùng cho text)').setRequired(false).setMaxLength(1000))
      .addAttachmentOption(o => o.setName('attachment').setDescription('File ảnh (dùng cho image)').setRequired(false))),

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
    .setName('ticket')
    .setDescription('Gửi panel mở ticket'),
].map(c => c.toJSON());

module.exports = { commands };

if (require.main === module) {
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
}
