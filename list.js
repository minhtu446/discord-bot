const welcome = require('./features/welcome');

async function showList(interaction) {
  const jsonCache = require('./jsonCache');
  const bannedUsers = jsonCache.readJSONArray(jsonCache.getPath('bannedGameUsers.json'));
  const autoDelete = jsonCache.readJSONArray(jsonCache.getPath('autoDeleteUsers.json'));

  let response = '📋 **DANH SÁCH BOT**\n\n';
  response += `**User cấm game:** ${bannedUsers.length} user\n`;
  response += `**Auto xóa:** ${autoDelete.length} user\n\n`;

  if (bannedUsers.length > 0) {
    response += '**User cấm game:**\n';
    bannedUsers.forEach(id => { response += `- <@${id}> (\`${id}\`)\n`; });
  }

  return response;
}

module.exports = { createWelcomeEmbed: welcome.createWelcomeEmbed, createWelcomeCanvas: welcome.createWelcomeCanvas, showList };