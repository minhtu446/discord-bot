const { REST, Routes, SlashCommandBuilder } = require('discord.js');
const config = require('./config');

const commands = [
  new SlashCommandBuilder()
    .setName('xoa')
    .setDescription('Xóa tin nhắn (tối đa 1000, kể cả tin cũ)')
    .addIntegerOption(o => o.setName('số_lượng').setDescription('Số lượng (tối đa 1000)').setRequired(true).setMinValue(1).setMaxValue(1000))
    .addUserOption(o => o.setName('người_dùng').setDescription('Lọc theo user').setRequired(false))
    .addStringOption(o => o.setName('id_acc').setDescription('ID tài khoản (xóa trong DM với user này)').setRequired(false)),

  new SlashCommandBuilder()
    .setName('camchat')
    .setDescription('Cấm chat user')
    .addUserOption(o => o.setName('người_dùng').setDescription('User').setRequired(true)),

  new SlashCommandBuilder()
    .setName('htcamchat')
    .setDescription('Gỡ cấm chat user')
    .addUserOption(o => o.setName('người_dùng').setDescription('User').setRequired(true)),

  new SlashCommandBuilder()
    .setName('lock')
    .setDescription('Khóa kênh'),

  new SlashCommandBuilder()
    .setName('unlock')
    .setDescription('Mở kênh'),

  new SlashCommandBuilder()
    .setName('msg')
    .setDescription('Gửi tin nhắn')
    .addStringOption(o => o.setName('loại').setDescription('bot/role/dm').setRequired(true).addChoices({ name: 'Bot', value: 'bot' }, { name: 'Role', value: 'role' }, { name: 'DM', value: 'dm' }))
    .addStringOption(o => o.setName('nội_dung').setDescription('Nội dung').setRequired(false))
    .addIntegerOption(o => o.setName('số_lần').setDescription('Số lần gửi (chỉ dùng cho Bot)').setRequired(false).setMinValue(1))
    .addStringOption(o => o.setName('role_id').setDescription('ID role (nếu chọn Role)').setRequired(false))
    .addUserOption(o => o.setName('người_dùng').setDescription('Người nhận (nếu chọn DM)').setRequired(false))
    .addAttachmentOption(o => o.setName('tệp').setDescription('File đính kèm').setRequired(false)),

  new SlashCommandBuilder()
    .setName('setup')
    .setDescription('Cấu hình và tạo UI')
    .addStringOption(o => o.setName('loại').setDescription('Loại').setRequired(true)
      .addChoices(
        { name: 'ticket', value: 'ticket' },
        { name: 'channelandgame', value: 'channelandgame' },
        { name: 'khuvuichoi', value: 'khuvuichoi' },

        { name: 'ui', value: 'ui' },
        { name: 'config', value: 'config' },
        { name: 'info', value: 'info' },
      ))
    .addStringOption(o => o.setName('tiêu_đề').setDescription('Tiêu đề (dùng cho ui)').setRequired(false))
    .addStringOption(o => o.setName('nội_dung').setDescription('Nội dung (dùng cho ui)').setRequired(false))
    .addStringOption(o => o.setName('trường').setDescription('Trường cần set (dùng cho config)').setRequired(false)
      .addChoices(
        { name: 'welcomeChannelId', value: 'welcomeChannelId' },
        { name: 'logChannelId', value: 'logChannelId' },
        { name: 'ticketCategoryId', value: 'ticketCategoryId' },

        { name: 'memberRoleId', value: 'memberRoleId' },
        { name: 'setupCategoryId', value: 'setupCategoryId' },
        { name: 'dmRelayChannelId', value: 'dmRelayChannelId' },
      ))
    .addStringOption(o => o.setName('giá_trị').setDescription('Giá trị ID (dùng cho config)').setRequired(false))
    .addStringOption(o => o.setName('id_nhóm').setDescription('ID nhóm (dùng cho config/info, mặc định là nhóm hiện tại)').setRequired(false)),

  new SlashCommandBuilder()
    .setName('setslowmode')
    .setDescription('Set slowmode')
    .addIntegerOption(o => o.setName('giây').setDescription('Số giây').setRequired(true)),

  new SlashCommandBuilder()
    .setName('update')
    .setDescription('Gửi embed cập nhật'),

  new SlashCommandBuilder()
    .setName('list')
    .setDescription('Xem danh sách')
    .addStringOption(o => o.setName('loại').setDescription('Loại danh sách').setRequired(true)
      .addChoices(
        { name: 'all', value: 'all' },
        { name: 'noemojirole', value: 'noemojirole' },
        { name: 'owner', value: 'owner' },
        { name: 'camdunggame', value: 'camdunggame' },
        { name: 'tudongxoa', value: 'tudongxoa' },
        { name: 'gamechannels', value: 'gamechannels' },
        { name: 'bad', value: 'bad' },
        { name: 'setup', value: 'setup' },
      )),

  new SlashCommandBuilder()
    .setName('add')
    .setDescription('Thêm vào danh sách')
    .addStringOption(o => o.setName('loại').setDescription('Loại').setRequired(true)
      .addChoices(
        { name: 'camdunggame', value: 'camdunggame' },
        { name: 'owner', value: 'owner' },
        { name: 'noemojirole', value: 'noemojirole' },
        { name: 'tudongxoa', value: 'tudongxoa' },
        { name: 'bad', value: 'bad' },
      ))
    .addStringOption(o => o.setName('id').setDescription('ID (dùng cho camdunggame/owner/noemojirole/tudongxoa)').setRequired(false))
    .addStringOption(o => o.setName('nội_dung').setDescription('Nội dung (dùng cho bad)').setRequired(false)),

  new SlashCommandBuilder()
    .setName('removefromlist')
    .setDescription('Xóa khỏi danh sách')
    .addStringOption(o => o.setName('loại').setDescription('Loại').setRequired(true)
      .addChoices(
        { name: 'camdunggame', value: 'camdunggame' },
        { name: 'tudongxoa', value: 'tudongxoa' },
        { name: 'owner', value: 'owner' },
        { name: 'noemojirole', value: 'noemojirole' },
        { name: 'bad', value: 'bad' },
      ))
    .addStringOption(o => o.setName('id').setDescription('ID (dùng cho camdunggame/tudongxoa/owner/noemojirole)').setRequired(false))
    .addStringOption(o => o.setName('nội_dung').setDescription('Nội dung (dùng cho bad)').setRequired(false)),

  new SlashCommandBuilder()
    .setName('dmhis')
    .setDescription('Xem lịch sử DM với người dùng')
    .addStringOption(o => o.setName('id').setDescription('ID người dùng').setRequired(true)),

  new SlashCommandBuilder()
    .setName('test')
    .setDescription('Kiểm tra bad words hoặc OCR')
    .addStringOption(o => o.setName('loại').setDescription('text/image').setRequired(true)
      .addChoices(
        { name: 'text', value: 'text' },
        { name: 'image', value: 'image' },
      ))
    .addStringOption(o => o.setName('nội_dung').setDescription('Nội dung cần test').setRequired(false))
    .addAttachmentOption(o => o.setName('tệp').setDescription('File ảnh (dùng cho image)').setRequired(false)),

  new SlashCommandBuilder()
    .setName('emojiup')
    .setDescription('Cập nhật emoji từ role cho tất cả member'),

  new SlashCommandBuilder()
    .setName('settile')
    .setDescription('Đổi trạng thái bot (Watching)')
    .addStringOption(o => o.setName('nội_dung').setDescription('Nội dung mới (bỏ trống để reset về mặc định)').setRequired(false)),

  new SlashCommandBuilder()
    .setName('setting')
    .setDescription('Cài đặt tính năng bot'),

  new SlashCommandBuilder()
    .setName('help')
    .setDescription('Hướng dẫn sử dụng lệnh, bot và các tính năng'),
];

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
