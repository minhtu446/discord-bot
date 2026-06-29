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

client.once(Events.ClientReady, async () => {
  console.log(`Bot đã online: ${client.user.username}`);
  const savedStatus = jsonCache.readJSON(jsonCache.getPath('botStatus.json'));
  client.user.setActivity(savedStatus || '/help | Super Bot', { type: ActivityType.Watching });

  const settingsHelper = require('./settingsHelper');
  const s = settingsHelper.getSettings(config.guildId);
  if (s.logging !== false) {
    const channel = client.channels.cache.get(configHelper.getConfig(config.guildId, 'logChannelId'));
    if (channel) channel.send('✅ Bot đã khởi động!');
  }

  roleEmoji.init(client);
  channelHandler.cleanStaleChannels(client);
});

client.on(Events.GuildMemberAdd, memberHandler.handleGuildMemberAdd);
client.on(Events.GuildMemberUpdate, memberHandler.handleGuildMemberUpdate);
client.on(Events.GuildRoleUpdate, roleHandler.handleGuildRoleUpdate);
client.on(Events.UserUpdate, userHandler.handleUserUpdate);
client.on(Events.MessageCreate, messageHandler.handleMessageCreate);
client.on(Events.MessageUpdate, messageHandler.handleMessageUpdate);
client.on(Events.ChannelCreate, async (channel) => {
  if (!channel.isTextBased() || channel.isDMBased() || !channel.guild) return;
  const name = channel.name.toLowerCase();
  if (name.includes('noitucc')) {
    try {
      const noituChannel = require('./noituChannel');
      await noituChannel.initChannel(channel);
      console.log(`[Noitu] Auto-init channel: ${channel.name}`);
    } catch (e) {
      console.error('[Noitu] Init error:', e.message);
    }
  }
});

client.on(Events.ChannelUpdate, async (oldChannel, newChannel) => {
  if (!newChannel.isTextBased() || newChannel.isDMBased() || !newChannel.guild) return;
  if (oldChannel.name === newChannel.name) return;
  const oldName = oldChannel.name.toLowerCase();
  const newName = newChannel.name.toLowerCase();
  const hadNoitu = oldName.includes('noitucc');
  const hasNoitu = newName.includes('noitucc');
  if (hadNoitu === hasNoitu) return;
  try {
    const noituChannel = require('./noituChannel');
    if (hasNoitu) {
      await noituChannel.initChannel(newChannel);
      console.log(`[Noitu] Channel renamed to include noitucc: ${newChannel.name}`);
    } else {
      noituChannel.cleanupChannel(newChannel.id);
      console.log(`[Noitu] Channel renamed, noitucc removed: ${oldChannel.name}`);
    }
  } catch (e) {
    console.error('[Noitu] Update error:', e.message);
  }
});

client.on(Events.ChannelDelete, channelHandler.handleChannelDelete);
client.on(Events.InteractionCreate, interactionHandler.handleInteractionCreate);

process.setMaxListeners(0);

process.on('unhandledRejection', (reason) => {
  if (reason?.code === 'InteractionCollectorError') return;
  console.error('[UNHANDLED]', reason);
});

process.on('uncaughtException', (err) => {
  console.error('[UNCAUGHT]', err);
});

client.login(config.token).catch(e => {
  console.error('Lỗi đăng nhập:', e);
  process.exit(1);
});
