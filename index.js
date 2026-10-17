const { Client, GatewayIntentBits, Collection, Events, ActivityType, Partials } = require('discord.js');
const config = require('./config');

const jsonCache = require('./jsonCache');
const configHelper = require('./configHelper');
const roleEmoji = require('./roleEmoji');
const webConfig = require('./webConfig');

const memberHandler = require('./handlers/memberHandler');
const messageHandler = require('./handlers/messageHandler');
const interactionHandler = require('./handlers/interactionHandler');
const roleHandler = require('./handlers/roleHandler');
const userHandler = require('./handlers/userHandler');
const channelHandler = require('./handlers/channelHandler');
const commands = require('./commands');
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
  try { await roleEmoji.init(client); } catch (e) { console.error('[Startup] roleEmoji.init:', e.message); }
  try { await pickroleFeature.init(client); } catch (e) { console.error('[Startup] pickrole.init:', e.message); }
  try { const migration = require('./migration'); await migration.migrate(client); } catch (e) { console.error('[Startup] migration:', e.message); }
  try { await channelHandler.cleanStaleChannels(client); } catch (e) { console.error('[Startup] cleanStaleChannels:', e.message); }

  setTimeout(() => autoScanBadwords(client), 10000);
});

client.on(Events.GuildMemberAdd, memberHandler.handleGuildMemberAdd);
client.on(Events.GuildMemberUpdate, memberHandler.handleGuildMemberUpdate);
client.on(Events.UserUpdate, userHandler.handleUserUpdate);
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
  roleHandler.handleGuildRoleUpdate(oldRole, newRole);
  scheduleMetaPush(((newRole || oldRole).guild || {}).id);
});
client.on(Events.VoiceStateUpdate, channelHandler.handleVoiceStateUpdate);
client.on(Events.InteractionCreate, interactionHandler.handleInteractionCreate);
client.on(Events.MessageReactionAdd, (r, u) => pickroleFeature.handleReactionAdd(r, u, client));
client.on(Events.MessageReactionRemove, (r, u) => pickroleFeature.handleReactionRemove(r, u, client));

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

    let rateLimited = false;
    scanGuilds:
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
            rateLimited = true;
            break scanGuilds;
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

    if (rateLimited) {
      console.log(`[AutoScan] Dừng sớm do rate limit. Đã quét ${grandTotalChecked} tin nhắn, xóa ${grandTotalBad} badword`);
    } else {
      console.log(`[AutoScan] Xong! ${grandTotalChecked} tin nhắn, ${grandTotalBad} badword xóa`);
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
