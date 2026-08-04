const { ChannelType, PermissionsBitField } = require('discord.js');

const ZWSP = '\u200B';
const EMOTICON_RE = /(?<!\w)[:;](['"]?)[()DdPpOo3xX*\/\\]/g;
const CODE_RE = /(`+)([\s\S]*?)\1/g;
const WEBHOOK_NAME = 'Emoji Fixer';
const webhookCache = new Map();

function fixEmoticons(content) {
  if (!content || content.includes(ZWSP)) return null;
  const replacer = (m) => m[0] + ZWSP + m.slice(1);
  let fixed = '';
  let lastIndex = 0;
  let m;
  while ((m = CODE_RE.exec(content))) {
    fixed += content.slice(lastIndex, m.index).replace(EMOTICON_RE, replacer);
    fixed += m[0];
    lastIndex = CODE_RE.lastIndex;
  }
  fixed += content.slice(lastIndex).replace(EMOTICON_RE, replacer);
  if (fixed === content) return null;
  return fixed;
}

async function getWebhook(channel) {
  if (webhookCache.has(channel.id)) return webhookCache.get(channel.id);
  try {
    const existing = await channel.fetchWebhooks();
    const mine = existing.find(w => w.name === WEBHOOK_NAME);
    const hook = mine || await channel.createWebhook({ name: WEBHOOK_NAME });
    webhookCache.set(channel.id, hook);
    return hook;
  } catch {
    return null;
  }
}

async function handleEmoticonFix(message) {
  try {
    if (!message.guild || message.author.bot) return false;
    if (message.attachments.size > 0) return false;

    const fixed = fixEmoticons(message.content);
    if (!fixed) return false;

    const channel = message.channel;
    if (!channel || channel.type !== ChannelType.GuildText) return false;

    const perms = channel.permissionsFor(message.guild.members.me);
    if (!perms || !perms.has(PermissionsBitField.Flags.ManageWebhooks) || !perms.has(PermissionsBitField.Flags.ManageMessages)) return false;

    const hook = await getWebhook(channel);
    if (!hook) return false;

    await hook.send({
      content: fixed,
      username: message.member?.displayName || message.author.username,
      avatarURL: message.author.displayAvatarURL(),
    });
    await message.delete().catch(() => {});
    return true;
  } catch {
    return false;
  }
}

module.exports = { handleEmoticonFix };
