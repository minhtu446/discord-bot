const { REST, Routes, SlashCommandBuilder } = require('discord.js');
const config = require('./config');

const commands = [
  new SlashCommandBuilder()
    .setName('xoa')
    .setDescription('Xóa tin nhắn (tối đa 1000, kể cả tin cũ)')
    .addIntegerOption(o => o.setName('số_lượng').setDescription('Số lượng (tối đa 1000)').setRequired(true).setMinValue(1).setMaxValue(1000))
    .addUserOption(o => o.setName('người_dùng').setDescription('Lọc theo user').setRequired(false)),

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
    .addStringOption(o => o.setName('loại').setDescription('dm/bot/role').setRequired(true).addChoices({ name: 'DM', value: 'dm' }, { name: 'Bot', value: 'bot' }, { name: 'Role', value: 'role' }))
    .addStringOption(o => o.setName('nội_dung').setDescription('Nội dung').setRequired(true))
    .addStringOption(o => o.setName('id').setDescription('ID người nhận (nếu chọn DM)').setRequired(false))
    .addStringOption(o => o.setName('role_id').setDescription('ID role (nếu chọn Role)').setRequired(false))
    .addAttachmentOption(o => o.setName('tệp').setDescription('File đính kèm').setRequired(false)),

  new SlashCommandBuilder()
    .setName('setup')
    .setDescription('Cấu hình và tạo UI')
    .addStringOption(o => o.setName('loại').setDescription('Loại').setRequired(true)
      .addChoices(
        { name: 'ticket', value: 'ticket' },
        { name: 'channelandgame', value: 'channelandgame' },
        { name: 'noitucc', value: 'noitucc' },
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
        { name: 'gameCategoryId', value: 'gameCategoryId' },
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
    .setName('botucam')
    .setDescription('Quét tin cũ chứa nội dung cấm')
    .addIntegerOption(o => o.setName('số_lượng').setDescription('Số lượng').setRequired(true))
    .addUserOption(o => o.setName('người_dùng').setDescription('User').setRequired(false)),

  new SlashCommandBuilder()
    .setName('list')
    .setDescription('Xem danh sách')
    .addStringOption(o => o.setName('loại').setDescription('Loại danh sách').setRequired(true)
      .addChoices(
        { name: 'anti', value: 'anti' },
        { name: 'noemojirole', value: 'noemojirole' },
        { name: 'owner', value: 'owner' },
      )),

  new SlashCommandBuilder()
    .setName('add')
    .setDescription('Thêm vào danh sách')
    .addStringOption(o => o.setName('loại').setDescription('Loại').setRequired(true)
      .addChoices(
        { name: 'anhbay', value: 'anhbay' },
        { name: 'camdunggame', value: 'camdunggame' },
        { name: 'owner', value: 'owner' },
        { name: 'noemojirole', value: 'noemojirole' },
        { name: 'tucam', value: 'tucam' },
        { name: 'tudongxoa', value: 'tudongxoa' },
      ))
    .addStringOption(o => o.setName('id').setDescription('ID (dùng cho camdunggame/owner/noemojirole/tudongxoa)').setRequired(false))
    .addAttachmentOption(o => o.setName('ảnh').setDescription('Ảnh (dùng cho anhbay)').setRequired(false))
    .addStringOption(o => o.setName('văn_bản').setDescription('Từ cấm (dùng cho tucam)').setRequired(false))
    .addAttachmentOption(o => o.setName('tệp').setDescription('File từ cấm (dùng cho tucam)').setRequired(false)),

  new SlashCommandBuilder()
    .setName('removefromlist')
    .setDescription('Xóa khỏi danh sách')
    .addStringOption(o => o.setName('loại').setDescription('Loại').setRequired(true)
      .addChoices(
        { name: 'camdunggame', value: 'camdunggame' },
        { name: 'tudongxoa', value: 'tudongxoa' },
        { name: 'owner', value: 'owner' },
        { name: 'noemojirole', value: 'noemojirole' },
        { name: 'tucam', value: 'tucam' },
      ))
    .addStringOption(o => o.setName('id').setDescription('ID (dùng cho camdunggame/tudongxoa/owner/noemojirole)').setRequired(false))
    .addStringOption(o => o.setName('văn_bản').setDescription('Từ cấm (dùng cho tucam)').setRequired(false))
    .addAttachmentOption(o => o.setName('ảnh').setDescription('Ảnh cấm (dùng cho tucam)').setRequired(false))
    .addAttachmentOption(o => o.setName('tệp').setDescription('File từ cấm (dùng cho tucam)').setRequired(false)),

  new SlashCommandBuilder()
    .setName('test')
    .setDescription('Test ảnh/từ/video')
    .addAttachmentOption(o => o.setName('ảnh').setDescription('Ảnh').setRequired(false))
    .addAttachmentOption(o => o.setName('video').setDescription('Video').setRequired(false))
    .addStringOption(o => o.setName('từ').setDescription('Từ').setRequired(false)),

  new SlashCommandBuilder()
    .setName('dm')
    .setDescription('Gửi DM cho người dùng')
    .addUserOption(o => o.setName('người_dùng').setDescription('Người nhận').setRequired(true))
    .addStringOption(o => o.setName('nội_dung').setDescription('Nội dung').setRequired(true)),

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
    console.log('Đang đăng ký lệnh...');
    await rest.put(Routes.applicationGuildCommands(config.clientId, config.guildId), { body: commands });
    console.log('Đã đăng ký lệnh thành công!');
  } catch (e) {
    console.error(e);
  }
})();
