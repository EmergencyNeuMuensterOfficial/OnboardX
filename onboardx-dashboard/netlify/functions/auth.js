// netlify/functions/auth.js
const { signToken, ok, err, preflight } = require('./_utils');

const ADMINISTRATOR = BigInt(0x8);
const MANAGE_GUILD = BigInt(0x20);
const MANAGE_CHANNELS = BigInt(0x10);
const MANAGE_ROLES = BigInt(0x10000000);
const KICK_MEMBERS = BigInt(0x2);
const BAN_MEMBERS = BigInt(0x4);

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return preflight();
  if (event.httpMethod !== 'GET') return err('Method not allowed', 405);

  const code = event.queryStringParameters?.code;
  if (!code) return err('Missing code', 400);

  // Validate env vars up front so the error is clear
  const { DISCORD_CLIENT_ID, DISCORD_CLIENT_SECRET } = process.env;
  const REDIRECT_URI = process.env.REDIRECT_URI || inferRedirectUri(event);
  const missing = [];
  if (!DISCORD_CLIENT_ID) missing.push('DISCORD_CLIENT_ID');
  if (!DISCORD_CLIENT_SECRET) missing.push('DISCORD_CLIENT_SECRET');
  if (!REDIRECT_URI) missing.push('REDIRECT_URI');
  if (missing.length) {
    console.error(`Missing Discord env vars: ${missing.join(', ')}`);
    return err(`Server misconfigured: missing ${missing.join(', ')}`, 500);
  }

  try {
    // 1. Exchange code → Discord access token
    const tokenRes = await fetch('https://discord.com/api/v10/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id:     DISCORD_CLIENT_ID,
        client_secret: DISCORD_CLIENT_SECRET,
        code,
        grant_type:    'authorization_code',
        redirect_uri:  REDIRECT_URI,
      }).toString(),
    });

    const tokenData = await tokenRes.json();

    if (!tokenRes.ok || tokenData.error) {
      console.error('Discord token error:', tokenData);
      return err(tokenData.error_description || tokenData.error || 'Discord auth failed', 401);
    }

    // 2. Fetch Discord user
    const userRes = await fetch('https://discord.com/api/v10/users/@me', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });

    if (!userRes.ok) {
      return err('Could not fetch Discord user', 502);
    }

    const user = await userRes.json();

    // 3. Fetch guilds once during login so later dashboard requests do not
    // hit Discord's /users/@me/guilds rate limit on every page load.
    let manageableGuilds = [];
    try {
      const guildRes = await fetch('https://discord.com/api/v10/users/@me/guilds', {
        headers: { Authorization: `Bearer ${tokenData.access_token}` },
      });

      if (guildRes.ok) {
        const guilds = await guildRes.json();
        manageableGuilds = guilds
          .filter((guild) => {
            if (guild.owner) return true;
            const perms = BigInt(guild.permissions ?? 0);
            return [
              ADMINISTRATOR,
              MANAGE_GUILD,
              MANAGE_CHANNELS,
              MANAGE_ROLES,
              KICK_MEMBERS,
              BAN_MEMBERS,
            ].some((bit) => (perms & bit) !== 0n);
          })
          .map((guild) => ({
            id: guild.id,
            name: guild.name,
            icon: guild.icon
              ? `https://cdn.discordapp.com/icons/${guild.id}/${guild.icon}.png`
              : null,
            owner: guild.owner,
          }));
      }
    } catch (guildError) {
      console.error('auth manageable guild fetch failed:', guildError.message);
    }

    // 4. Issue JWT
    const token = signToken({
      userId:       user.id,
      username:     user.username,
      avatar:       user.avatar,
      discordToken: tokenData.access_token,
      manageableGuilds,
      manageableGuildIds: manageableGuilds.map((guild) => guild.id),
    });

    return ok({
      token,
      user: {
        id:       user.id,
        username: user.username,
        avatar:   user.avatar
          ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png`
          : `https://cdn.discordapp.com/embed/avatars/${Number(user.id) % 5}.png`,
      },
    });
  } catch (e) {
    console.error('auth handler error:', e);
    return err('Authentication failed: ' + e.message, 500);
  }
};

function inferRedirectUri(event) {
  const host = event.headers?.['x-forwarded-host'] || event.headers?.host;
  if (!host) return null;

  const proto = event.headers?.['x-forwarded-proto'] || 'https';
  return `${proto}://${host}/callback`;
}
