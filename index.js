const { Client, GatewayIntentBits, Collection, Events, ActivityType, Partials } = require('discord.js');
const config = require('./config');

const jsonCache = require('./jsonCache');
const configHelper = require('./configHelper');
const webConfig = require('./webConfig');

const memberHandler = require('./handlers/memberHandler');
const messageHandler = require('./handlers/messageHandler');
const interactionHandler = require('./handlers/interactionHandler');
const channelHandler = require('./handlers/channelHandler');
const commands = require('./commands');
const muteScheduler = require('./muteScheduler');
const pickroleFeature = require('./features/pickrole');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.DirectMessages,
  ],
  partials: [Partials.Channel, Partials.Message, Partials.Reaction, Partials.User],
});

client.config = config;
client.cooldowns = new Collection();

client.on('debug', (msg) => {
  if (msg.includes('REQUEST_GUILD_MEMBERS') || msg.includes('opcode 8')) return;
});

client.once(Events.ClientReady, async () => {
  console.log(`Bot đã online: ${client.user.username}`);
  try {
    client.user.setActivity('/help | Super Bot', { type: ActivityType.Watching });
  } catch (e) { console.error('[Startup] status:', e.message); }

  try {
    const settingsHelper = require('./settingsHelper');
    for (const [, guild] of client.guilds.cache) {
      const s = settingsHelper.getSettings(guild.id);
      if (s.logging !== false) {
        const channel = client.channels.cache.get(configHelper.getConfig(guild.id, 'logChannelId'));
        if (channel) channel.send('✅ Bot đã khởi động!').catch(() => {});
      }
    }
  } catch (e) { console.error('[Startup] log channel:', e.message); }

  try { await webConfig.start(client); } catch (e) { console.error('[Startup] webConfig.start:', e.message); }
  try { await pickroleFeature.init(client); } catch (e) { console.error('[Startup] pickrole.init:', e.message); }
  try { muteScheduler.start(client); } catch (e) { console.error('[Startup] muteScheduler:', e.message); }
  try { const migration = require('./migration'); await migration.migrate(client); } catch (e) { console.error('[Startup] migration:', e.message); }
  try { await channelHandler.cleanStaleChannels(client); } catch (e) { console.error('[Startup] cleanStaleChannels:', e.message); }
});

client.on(Events.GuildMemberAdd, memberHandler.handleGuildMemberAdd);
client.on(Events.MessageCreate, messageHandler.handleMessageCreate);
client.on(Events.MessageUpdate, messageHandler.handleMessageUpdate);
client.on(Events.ChannelDelete, (channel) => {
  channelHandler.handleChannelDelete(channel);
  scheduleMetaPush(channel.guildId);
});
client.on(Events.ChannelCreate, (channel) => scheduleMetaPush(channel.guildId));
client.on(Events.ChannelUpdate, (oldCh, newCh) => scheduleMetaPush((newCh || oldCh).guildId));
client.on(Events.GuildRoleCreate, (role) => scheduleMetaPush(role.guild && role.guild.id));
client.on(Events.GuildRoleDelete, (role) => scheduleMetaPush(role.guild && role.guild.id));
client.on(Events.GuildRoleUpdate, (oldRole, newRole) => {
  scheduleMetaPush(((newRole || oldRole).guild || {}).id);
});
client.on(Events.VoiceStateUpdate, channelHandler.handleVoiceStateUpdate);
client.on(Events.InteractionCreate, interactionHandler.handleInteractionCreate);
client.on(Events.MessageReactionAdd, (r, u) => pickroleFeature.handleReactionAdd(r, u, client));
client.on(Events.MessageReactionRemove, (r, u) => pickroleFeature.handleReactionRemove(r, u, client));
// Emoji server tạo mới / xoá / đổi tên → đẩy meta ngay (debounce ~2.5s).
// Lưu ý: discord.js KHÔNG có Events.GuildEmojisUpdate (chỉ có 3 sự kiện dưới đây) —
// dùng sai tên thì listener im lặng không bao giờ chạy.
client.on(Events.GuildEmojiCreate, (emoji) => scheduleMetaPush(emoji && emoji.guild && emoji.guild.id));
client.on(Events.GuildEmojiDelete, (emoji) => scheduleMetaPush(emoji && emoji.guild && emoji.guild.id));
client.on(Events.GuildEmojiUpdate, (oldEmoji, newEmoji) => {
  const e = newEmoji || oldEmoji;
  scheduleMetaPush(e && e.guild && e.guild.id);
});

// Bot bị thêm vào hoặc bị đá khỏi server → cập nhật danh sách server ngay cho panel.
// available === false là sự cố của Discord, KHÔNG phải bị kick → bỏ qua.
client.on(Events.GuildCreate, (guild) => {
  if (!guild || guild.available === false) return;
  webConfig.pushGuilds(client).catch(() => {});
  scheduleMetaPush(guild.id);
});
client.on(Events.GuildDelete, (guild) => {
  if (!guild || guild.available === false) return;
  webConfig.pushGuilds(client).catch(() => {});
});

// Khi kênh/role đổi, đẩy lại meta cho ĐÚNG server đó (gộp nhiều sự kiện trong ~2.5s)
// để bảng điều khiển web cập nhật nhanh danh sách kênh/role.
const _metaPushTimers = new Map();
function scheduleMetaPush(guildId) {
  if (!guildId) return;
  const gid = String(guildId);
  clearTimeout(_metaPushTimers.get(gid));
  const t = setTimeout(() => {
    _metaPushTimers.delete(gid);
    webConfig.pushMeta(client, gid).catch(() => {});
  }, 2500);
  if (t.unref) t.unref();
  _metaPushTimers.set(gid, t);
}

process.setMaxListeners(0);

process.on('unhandledRejection', (reason) => {
  const msg = reason?.message || reason?.toString() || '';
  if (reason?.code === 'InteractionCollectorError' || reason?.code === 10062) return;
  if (msg.includes('opcode 8') || msg.includes('REQUEST_GUILD_MEMBERS')) return;
  console.error('[UNHANDLED]', reason);
});

process.on('uncaughtException', (err) => {
  console.error('[UNCAUGHT]', err);
});

async function shutdown() {
  console.log('\n[Shutdown] Dang tat bot...');
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

client.login(config.token).catch(e => {
  console.error('Lỗi đăng nhập:', e);
  process.exit(1);
});
