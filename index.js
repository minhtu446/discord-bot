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
  } else if (savedStatus && savedStatus.type === 'countdown') {
    commands.startCountdownStatus(client, savedStatus.target, savedStatus.note);
  } else {
    client.user.setActivity(savedStatus || '/help | Super Bot', { type: ActivityType.Watching });
  }

  const settingsHelper = require('./settingsHelper');
  for (const [, guild] of client.guilds.cache) {
    const s = settingsHelper.getSettings(guild.id);
    if (s.logging !== false) {
      const channel = client.channels.cache.get(configHelper.getConfig(guild.id, 'logChannelId'));
      if (channel) channel.send('✅ Bot đã khởi động!').catch(() => {});
    }
  }

  try { await roleEmoji.init(client); } catch (e) { console.error('[Startup] roleEmoji.init:', e.message); }
  try { const migration = require('./migration'); await migration.migrate(client); } catch (e) { console.error('[Startup] migration:', e.message); }
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
    let grandTotalChecked = 0;
    let grandTotalBad = 0;
    const allOffenders = [];
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    const MAX_CHANNELS_PER_GUILD = 20;
    const MAX_MESSAGES_PER_CHANNEL = 100;
    const FETCH_DELAY_MS = 400;

    for (const [, guild] of client.guilds.cache) {
      const channels = guild.channels.cache.filter(c => c.isTextBased() && c.viewable);
      if (channels.size === 0) continue;

      console.log(`[AutoScan] [${guild.name}] Quét tối đa ${Math.min(channels.size, MAX_CHANNELS_PER_GUILD)} kênh...`);
      let totalChecked = 0;
      let totalBad = 0;
      const offenders = [];
      let scanned = 0;

      for (const [, channel] of channels) {
        if (scanned >= MAX_CHANNELS_PER_GUILD) break;
        scanned++;
        let channelBad = 0;
        let messages;
        try {
          messages = await channel.messages.fetch({ limit: MAX_MESSAGES_PER_CHANNEL });
        } catch (e) {
          if (e?.status === 429 || (e?.code === 'RATE_LIMITED') || e?.rawError?.message === 'You are being rate limited.') {
            console.log('[AutoScan] Gặp rate limit, dừng quét sớm.');
            return;
          }
          await sleep(FETCH_DELAY_MS);
          continue;
        }
        if (messages.size === 0) {
          await sleep(FETCH_DELAY_MS);
          continue;
        }
        for (const [, msg] of messages) {
          if (msg.author.bot) continue;
          totalChecked++;
          if (wordFilter.checkContent(msg.content, false, guild.id)) {
            channelBad++;
            totalBad++;
            try { await msg.delete().catch(() => {}); } catch {}
          }
        }
        if (channelBad > 0) {
          offenders.push(`#${channel.name}: ${channelBad}`);
          console.log(`[AutoScan] [${guild.name}] #${channel.name}: ${channelBad} badword`);
        }
        await sleep(FETCH_DELAY_MS);
      }

      grandTotalChecked += totalChecked;
      grandTotalBad += totalBad;
      allOffenders.push(...offenders.map(o => `[${guild.name}] ${o}`));

      if (offenders.length > 0) {
        const logChannelId = configHelper.getConfig(guild.id, 'logChannelId');
        const logChannel = client.channels.cache.get(logChannelId);
        if (logChannel) {
          await logChannel.send(`🔍 **AutoScan kết quả**: Đã quét ${totalChecked} tin nhắn, xóa ${totalBad} badword\n${offenders.join('\n')}`).catch(() => {});
        }
      }
    }

    console.log(`[AutoScan] Xong! ${grandTotalChecked} tin nhắn, ${grandTotalBad} badword xóa`);
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
