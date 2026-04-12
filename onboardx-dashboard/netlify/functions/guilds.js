// netlify/functions/guilds.js
// Returns the list of guilds where BOTH the bot is present
// AND the current user has Manage Guild (0x20) permission

const { verifyToken, discordFetch, botFetch, ok, err, options } = require('./_utils');

const MANAGE_GUILD = BigInt(0x20);
const ADMINISTRATOR = BigInt(0x8);

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return options();

  try {
    const user = verifyToken(event.headers.authorization);

    // Fetch both in parallel
    const [userGuilds, botGuilds] = await Promise.all([
      discordFetch('/users/@me/guilds', user.discordToken),
      botFetch('/users/@me/guilds'),
    ]);

    const botGuildIds = new Set(botGuilds.map((g) => g.id));

    const filtered = userGuilds
      .filter((g) => {
        if (!botGuildIds.has(g.id)) return false;
        const perms = BigInt(g.permissions ?? 0);
        return g.owner || (perms & ADMINISTRATOR) !== 0n || (perms & MANAGE_GUILD) !== 0n;
      })
      .map((g) => ({
        id:   g.id,
        name: g.name,
        icon: g.icon
          ? `https://cdn.discordapp.com/icons/${g.id}/${g.icon}.png`
          : null,
        owner: g.owner,
      }));

    return ok(filtered);
  } catch (e) {
    if (e.name === 'JsonWebTokenError' || e.message === 'No token') return err('Unauthorized', 401);
    console.error('guilds error:', e);
    return err('Internal error', 500);
  }
};
