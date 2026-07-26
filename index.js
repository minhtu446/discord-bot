const { Client, GatewayIntentBits, Collection, Events, ActivityType, Partials } = require('discord.js');
const config = require('./config');

const jsonCache = require('./jsonCache');
const configHelper = require('./configHelper');
const roleEmoji = require('./roleEmoji');

const memberHandler = require('./handlers/memberHandler');
const messageHandler = require('./handlers/messageHandler');
const interactionHandler = require('./handlers/interactionHandler');
const roleHandler = require('./handlers/roleHandler');
const userHandler = require('./handlers/userHandler');
const channelHandler = require('./handlers/channelHandler');
const gameplay = require('./gameplay');
const commands = require('./commands');

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
  partials: [Partials.Channel],
});

client.config = config;
client.cooldowns = new Collection();

client.on('debug', (msg) => {
  if (msg.includes('REQUEST_GUILD_MEMBERS') || msg.includes('opcode 8')) return;
});

client.once(Events.ClientReady, async () => {
  console.log(`Bot đã online: ${client.user.username}`);
  const savedStatus = jsonCache.readJSON(jsonCache.getPath('botStatus.json'));
  if (savedStatus === '__AUTO__') {
    commands.startAutoStatus(client);
  } else {
    client.user.setActivity(savedStatus || '/help | Super Bot', { type: ActivityType.Watching });
  }

  const settingsHelper = require('./settingsHelper');
  const s = settingsHelper.getSettings(config.guildId);
  if (s.logging !== false) {
    const channel = client.channels.cache.get(configHelper.getConfig(config.guildId, 'logChannelId'));
    if (channel) channel.send('✅ Bot đã khởi động!');
  }

  try { await roleEmoji.init(client); } catch (e) { console.error('[Startup] roleEmoji.init:', e.message); }
  try { await channelHandler.cleanStaleChannels(client); } catch (e) { console.error('[Startup] cleanStaleChannels:', e.message); }
  try { await gameplay.cleanupPvPGrants(client); } catch (e) { console.error('[Startup] cleanupPvPGrants:', e.message); }
  try {
    const ttt = require('./games/ttt');
    if (typeof ttt.restoreGames === 'function') await ttt.restoreGames(client);
    if (typeof ttt.cleanStaleGames === 'function') ttt.cleanStaleGames();
  } catch (e) { console.error('[Startup] ttt:', e.message); }

  setTimeout(() => autoScanBadwords(client), 10000);
});

client.on(Events.GuildMemberAdd, memberHandler.handleGuildMemberAdd);
client.on(Events.GuildMemberUpdate, memberHandler.handleGuildMemberUpdate);
client.on(Events.GuildRoleUpdate, roleHandler.handleGuildRoleUpdate);
client.on(Events.UserUpdate, userHandler.handleUserUpdate);
client.on(Events.MessageCreate, messageHandler.handleMessageCreate);
client.on(Events.MessageUpdate, messageHandler.handleMessageUpdate);
client.on(Events.ChannelDelete, channelHandler.handleChannelDelete);
client.on(Events.InteractionCreate, interactionHandler.handleInteractionCreate);

process.setMaxListeners(0);

async function autoScanBadwords(client) {
  try {
    const wordFilter = require('./automod/wordFilter');
    const guild = client.guilds.cache.get(config.guildId);
    if (!guild) return;
    const channels = guild.channels.cache.filter(c => c.isTextBased() && c.viewable);
    if (channels.size === 0) return;

    console.log(`[AutoScan] Quét ${channels.size} kênh...`);
    let totalChecked = 0;
    let totalBad = 0;
    const offenders = [];

    for (const [, channel] of channels) {
      let lastId = null;
      let channelBad = 0;
      while (true) {
        const opts = { limit: 100 };
        if (lastId) opts.before = lastId;
        let messages;
        try { messages = await channel.messages.fetch(opts); } catch { break; }
        if (messages.size === 0) break;
        for (const [, msg] of messages) {
          if (msg.author.bot) continue;
          totalChecked++;
          if (wordFilter.checkContent(msg.content)) {
            channelBad++;
            totalBad++;
            try { await msg.delete().catch(() => {}); } catch {}
          }
        }
        lastId = messages.last()?.id;
        if (messages.size < 100) break;
      }
      if (channelBad > 0) {
        offenders.push(`#${channel.name}: ${channelBad}`);
        console.log(`[AutoScan] #${channel.name}: ${channelBad} badword`);
      }
    }
    console.log(`[AutoScan] Xong! ${totalChecked} tin nhắn, ${totalBad} badword xóa`);
    if (offenders.length > 0) {
      const logChannelId = configHelper.getConfig(config.guildId, 'logChannelId');
      const logChannel = client.channels.cache.get(logChannelId);
      if (logChannel) {
        await logChannel.send(`🔍 **AutoScan kết quả**: Đã quét ${totalChecked} tin nhắn, xóa ${totalBad} badword\n${offenders.join('\n')}`).catch(() => {});
      }
    }
  } catch (e) {
    console.error('[AutoScan] Lỗi:', e.message);
  }
}

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
