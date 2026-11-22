const { REST, Routes, SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');
const config = require('./config');

const commands = [
  new SlashCommandBuilder()
    .setName('clean')
    .setDescription('Xóa tin nhắn (tối đa 1000, kể cả tin cũ)')
    .addIntegerOption(o => o.setName('amount').setDescription('Số lượng (tối đa 1000)').setRequired(true).setMinValue(1).setMaxValue(1000))
    .addUserOption(o => o.setName('member').setDescription('Lọc theo member').setRequired(false))
    .addStringOption(o => o.setName('reason').setDescription('Lý do (ghi vào log)').setRequired(false).setMaxLength(300))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),

  new SlashCommandBuilder()
    .setName('mute')
    .setDescription('Cấm chat member trong server (timeout/role mute)')
    .addUserOption(o => o.setName('member').setDescription('Member cần cấm chat').setRequired(true))
    .addStringOption(o => o.setName('duration').setDescription('Thời hạn: 30s/10m/2h/7d (trống = vĩnh viễn, tối đa 28 ngày)').setRequired(false).setMaxLength(10))
    .addStringOption(o => o.setName('reason').setDescription('Lý do (ghi vào log)').setRequired(false).setMaxLength(300))
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),

  new SlashCommandBuilder()
    .setName('unmute')
    .setDescription('Gỡ cấm chat member')
    .addUserOption(o => o.setName('member').setDescription('Member cần gỡ cấm').setRequired(true))
    .addStringOption(o => o.setName('reason').setDescription('Lý do (ghi vào log)').setRequired(false).setMaxLength(300))
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),

  new SlashCommandBuilder()
    .setName('kick')
    .setDescription('Đuổi thành viên khỏi server')
    .addUserOption(o => o.setName('member').setDescription('Member cần đuổi').setRequired(true))
    .addStringOption(o => o.setName('reason').setDescription('Lý do').setRequired(false).setMaxLength(300))
    .setDefaultMemberPermissions(PermissionFlagsBits.KickMembers),

  new SlashCommandBuilder()
    .setName('ban')
    .setDescription('Cấm thành viên khỏi server')
    .addUserOption(o => o.setName('member').setDescription('Member cần cấm').setRequired(true))
    .addIntegerOption(o => o.setName('delete_messages').setDescription('Xóa tin nhắn gần đây (giây, 0-604800)').setRequired(false).setMinValue(0).setMaxValue(604800))
    .addStringOption(o => o.setName('reason').setDescription('Lý do').setRequired(false).setMaxLength(300))
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers),

  new SlashCommandBuilder()
    .setName('unban')
    .setDescription('Gỡ cấm thành viên bằng ID')
    .addStringOption(o => o.setName('user_id').setDescription('ID người dùng Discord').setRequired(true))
    .addStringOption(o => o.setName('reason').setDescription('Lý do').setRequired(false).setMaxLength(300))
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers),

  new SlashCommandBuilder()
    .setName('warn')
    .setDescription('Quản lý cảnh cáo thành viên')
    .addSubcommand(sc => sc.setName('add').setDescription('Cảnh cáo thành viên')
      .addUserOption(o => o.setName('member').setDescription('Member').setRequired(true))
      .addStringOption(o => o.setName('reason').setDescription('Lý do').setRequired(false).setMaxLength(300)))
    .addSubcommand(sc => sc.setName('list').setDescription('Xem lịch sử cảnh cáo')
      .addUserOption(o => o.setName('member').setDescription('Member').setRequired(true)))
    .addSubcommand(sc => sc.setName('remove').setDescription('Xóa 1 cảnh cáo theo ID')
      .addUserOption(o => o.setName('member').setDescription('Member').setRequired(true))
      .addStringOption(o => o.setName('id').setDescription('ID cảnh cáo').setRequired(true)))
    .addSubcommand(sc => sc.setName('clear').setDescription('Xóa toàn bộ cảnh cáo của member')
      .addUserOption(o => o.setName('member').setDescription('Member').setRequired(true)))
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),

  new SlashCommandBuilder()
    .setName('lock')
    .setDescription('Khóa kênh')
    .addChannelOption(o => o.setName('channel').setDescription('Kênh cần khóa (mặc định: kênh hiện tại)').setRequired(false).addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement, ChannelType.PublicThread, ChannelType.PrivateThread))
    .addStringOption(o => o.setName('reason').setDescription('Lý do (ghi vào log)').setRequired(false).setMaxLength(300))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),

  new SlashCommandBuilder()
    .setName('unlock')
    .setDescription('Mở khóa kênh')
    .addChannelOption(o => o.setName('channel').setDescription('Kênh cần mở khóa (mặc định: kênh hiện tại)').setRequired(false).addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement, ChannelType.PublicThread, ChannelType.PrivateThread))
    .addStringOption(o => o.setName('reason').setDescription('Lý do (ghi vào log)').setRequired(false).setMaxLength(300))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),

  new SlashCommandBuilder()
    .setName('slowmode')
    .setDescription('Đặt slowmode cho kênh')
    .addIntegerOption(o => o.setName('seconds').setDescription('Số giây (0 để tắt)').setRequired(true).setMinValue(0).setMaxValue(21600))
    .addChannelOption(o => o.setName('channel').setDescription('Kênh (mặc định: kênh hiện tại)').setRequired(false).addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement, ChannelType.PublicThread, ChannelType.PrivateThread))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),

  new SlashCommandBuilder()
    .setName('say')
    .setDescription('Bot gửi tin nhắn')
    .addStringOption(o => o.setName('message').setDescription('Nội dung tin nhắn').setRequired(false).setMaxLength(2000))
    .addChannelOption(o => o.setName('channel').setDescription('Kênh gửi (mặc định: kênh hiện tại)').setRequired(false).addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement))
    .addAttachmentOption(o => o.setName('attachment').setDescription('File đính kèm').setRequired(false))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),

  new SlashCommandBuilder()
    .setName('dm')
    .setDescription('Gửi DM cho 1 member hoặc cả role')
    .addUserOption(o => o.setName('user').setDescription('Người nhận (chọn user HOẶC role)').setRequired(false))
    .addRoleOption(o => o.setName('role').setDescription('Gửi hàng loạt cho member có role').setRequired(false))
    .addStringOption(o => o.setName('message').setDescription('Nội dung DM').setRequired(false).setMaxLength(2000))
    .addAttachmentOption(o => o.setName('attachment').setDescription('File đính kèm').setRequired(false))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),

  new SlashCommandBuilder()
    .setName('dmlogs')
    .setDescription('Xem lịch sử DM với user')
    .addUserOption(o => o.setName('user').setDescription('Người dùng cần xem lịch sử DM').setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),

  new SlashCommandBuilder()
    .setName('config')
    .setDescription('Xem cấu hình của bot')
    .addSubcommand(sc => sc.setName('view').setDescription('Xem tổng quan cấu hình bot'))
    .addSubcommand(sc => sc.setName('channels').setDescription('Xem kênh voice hub bot đã tạo'))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  new SlashCommandBuilder()
    .setName('autodelete')
    .setDescription('Quản lý tự động xóa tin nhắn của user')
    .addSubcommand(sc => sc.setName('add').setDescription('Thêm user vào danh sách auto-xóa')
      .addUserOption(o => o.setName('user').setDescription('User').setRequired(true)))
    .addSubcommand(sc => sc.setName('remove').setDescription('Bỏ auto-xóa cho user')
      .addUserOption(o => o.setName('user').setDescription('User').setRequired(true)))
    .addSubcommand(sc => sc.setName('list').setDescription('Xem danh sách auto-xóa'))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  new SlashCommandBuilder()
    .setName('automod')
    .setDescription('Kiểm tra ảnh bằng bộ lọc image')
    .addSubcommand(sc => sc.setName('test').setDescription('Test bộ lọc ảnh')
      .addAttachmentOption(o => o.setName('attachment').setDescription('File ảnh cần test').setRequired(true)))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  new SlashCommandBuilder()
    .setName('reactionroles')
    .setDescription('Pick Role / Reaction Roles')
    .addSubcommand(sc => sc.setName('panel').setDescription('Gửi panel chọn role bằng emoji'))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles),

  new SlashCommandBuilder()
    .setName('ticket')
    .setDescription('Hệ thống ticket hỗ trợ')
    .addSubcommand(sc => sc.setName('panel').setDescription('Gửi panel mở ticket'))
    .addSubcommand(sc => sc.setName('close').setDescription('Đóng ticket hiện tại')
      .addStringOption(o => o.setName('reason').setDescription('Lý do đóng').setRequired(false).setMaxLength(300)))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),

  new SlashCommandBuilder()
    .setName('welcome')
    .setDescription('Chào mừng thành viên')
    .addSubcommand(sc => sc.setName('test').setDescription('Test tin nhắn/ảnh chào mừng')
      .addUserOption(o => o.setName('member').setDescription('Member giả lập (mặc định: bạn)').setRequired(false)))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  new SlashCommandBuilder()
    .setName('ping')
    .setDescription('Kiểm tra độ trễ bot'),

  new SlashCommandBuilder()
    .setName('userinfo')
    .setDescription('Xem thông tin thành viên')
    .addUserOption(o => o.setName('user').setDescription('Thành viên (mặc định: bạn)').setRequired(false)),

  new SlashCommandBuilder()
    .setName('serverinfo')
    .setDescription('Xem thông tin server'),

  new SlashCommandBuilder()
    .setName('avatar')
    .setDescription('Lấy avatar HD của thành viên')
    .addUserOption(o => o.setName('user').setDescription('Thành viên (mặc định: bạn)').setRequired(false)),

  new SlashCommandBuilder()
    .setName('rank')
    .setDescription('Xem cấp độ và XP của bạn hoặc thành viên khác')
    .addUserOption(o => o.setName('user').setDescription('Thành viên (mặc định: bạn)').setRequired(false)),

  new SlashCommandBuilder()
    .setName('leaderboard')
    .setDescription('Xem bảng xếp hạng XP của server'),

  new SlashCommandBuilder()
    .setName('help')
    .setDescription('Hướng dẫn sử dụng lệnh và tính năng bot')
    .addStringOption(o => o.setName('page').setDescription('Trang cần xem').setRequired(false)
      .addChoices(
        { name: 'Bắt đầu', value: 'start' },
        { name: 'Kiểm duyệt', value: 'moderation' },
        { name: 'Ticket/Pick Role/Welcome', value: 'features' },
        { name: 'Tiện ích & Hệ thống', value: 'misc' },
      )),
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
