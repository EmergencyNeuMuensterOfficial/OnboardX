// netlify/functions/guilds.js
const { verifyToken, discordFetch, botFetch, ok, err, preflight } = require('./_utils');

const ADMINISTRATOR = BigInt(0x8);
const MANAGE_GUILD = BigInt(0x20);
const MANAGE_CHANNELS = BigInt(0x10);
const MANAGE_ROLES = BigInt(0x10000000);
const KICK_MEMBERS = BigInt(0x2);
const BAN_MEMBERS = BigInt(0x4);

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return preflight();
  if (event.httpMethod !== 'GET') return err('Method not allowed', 405);

  let user;
  try {
    user = verifyToken(event.headers.authorization || event.headers.Authorization);
  } catch (e) {
    return err('Unauthorized', 401);
  }

  try {
    const jwtGuilds = Array.isArray(user.manageableGuilds) ? user.manageableGuilds : null;
    let userGuilds = jwtGuilds;

    if (!userGuilds) {
      userGuilds = await discordFetch('/users/@me/guilds', user.discordToken);
    }

    // Fetch guilds the bot is in (up to 200 — enough for most bots)
    let botGuilds = [];
    try {
      botGuilds = await botFetch('/users/@me/guilds?limit=200');
    } catch (e) {
      console.error('Could not fetch bot guilds:', e.message);
      // Don't fail entirely — return all user guilds and let them pick
    }

    const botGuildIds = new Set(botGuilds.map((g) => g.id));

    const filtered = userGuilds
      .filter((g) => {
        // Must have the bot (skip filter if bot guild fetch failed)
        if (botGuildIds.size > 0 && !botGuildIds.has(g.id)) return false;
        if (jwtGuilds) return true;
        // Must have enough authority to manage dashboard settings
        if (g.owner) return true;
        const perms = BigInt(g.permissions ?? '0');
        return [
          ADMINISTRATOR,
          MANAGE_GUILD,
          MANAGE_CHANNELS,
          MANAGE_ROLES,
          KICK_MEMBERS,
          BAN_MEMBERS,
        ].some((bit) => (perms & bit) !== 0n);
      })
      .map((g) => ({
        id:    g.id,
        name:  g.name,
        icon:  jwtGuilds
          ? (g.icon ?? null)
          : (g.icon ? `https://cdn.discordapp.com/icons/${g.id}/${g.icon}.png` : null),
        owner: g.owner,
      }));

    return ok(filtered);
  } catch (e) {
    console.error('guilds error:', e.message);
    return err('Failed to fetch guilds: ' + e.message, 502);
  }
};
