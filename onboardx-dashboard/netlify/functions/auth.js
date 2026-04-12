// netlify/functions/auth.js
// Exchanges Discord OAuth2 code for a JWT session token

const { signToken, ok, err, options } = require('./_utils');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return options();

  const { code } = event.queryStringParameters || {};
  if (!code) return err('Missing code', 400);

  try {
    // 1. Exchange code → Discord access token
    const tokenRes = await fetch('https://discord.com/api/v10/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id:     process.env.DISCORD_CLIENT_ID,
        client_secret: process.env.DISCORD_CLIENT_SECRET,
        code,
        grant_type:    'authorization_code',
        redirect_uri:  process.env.REDIRECT_URI,
      }),
    });

    const tokenData = await tokenRes.json();
    if (tokenData.error) return err(tokenData.error_description || tokenData.error, 401);

    // 2. Fetch Discord user
    const userRes = await fetch('https://discord.com/api/v10/users/@me', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    const user = await userRes.json();

    // 3. Sign JWT (7 days)
    const jwt = signToken({
      userId:       user.id,
      username:     user.username,
      discriminator: user.discriminator,
      avatar:       user.avatar,
      discordToken: tokenData.access_token,
    });

    return ok({
      token: jwt,
      user: {
        id:            user.id,
        username:      user.username,
        discriminator: user.discriminator,
        avatar:        user.avatar
          ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png`
          : `https://cdn.discordapp.com/embed/avatars/${parseInt(user.discriminator || 0) % 5}.png`,
      },
    });
  } catch (e) {
    console.error('auth error:', e);
    return err('Authentication failed', 500);
  }
};
