// netlify/functions/config.js
// GET  ?guildId=xxx  → returns config (creates default if missing)
// POST ?guildId=xxx  → saves/merges config

const {
  verifyToken,
  getDb,
  defaultConfig,
  ok,
  err,
  options,
  getManagedGuildAccess,
  dashboardConfigFromBotConfig,
  botConfigFromDashboardConfig,
} = require('./_utils');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return options();

  try {
    const user = verifyToken(event.headers.authorization);
    const guildId = event.queryStringParameters?.guildId;
    if (!guildId) return err('Missing guildId');

    // Verify the user actually has permission for this guild
    const access = await getManagedGuildAccess(user.discordToken, guildId);
    if (!access.allowed) return err('Forbidden', 403, { reason: access.reason });

    const db = await getDb();
    const col = db.collection('guild_configs');

    // ── GET ──────────────────────────────────────────────────────────────────
    if (event.httpMethod === 'GET') {
      let botConfig = await col.findOne({ guildId }, { projection: { _id: 0 } });
      if (!botConfig) {
        const dashboardConfig = defaultConfig(guildId);
        botConfig = botConfigFromDashboardConfig(dashboardConfig, null, guildId);
        await col.insertOne({ ...botConfig, guildId, createdAt: new Date(), updatedAt: new Date() });
      }

      return ok(dashboardConfigFromBotConfig(botConfig, guildId));
    }

    // ── POST (save) ──────────────────────────────────────────────────────────
    if (event.httpMethod === 'POST') {
      const body = JSON.parse(event.body || '{}');
      const currentBotConfig = await col.findOne({ guildId }, { projection: { _id: 0 } });
      const nextBotConfig = botConfigFromDashboardConfig(body, currentBotConfig, guildId);

      await col.updateOne(
        { guildId },
        {
          $set: { ...nextBotConfig, guildId, updatedAt: new Date() },
          $setOnInsert: { createdAt: new Date() },
        },
        { upsert: true }
      );

      return ok({
        success: true,
        updatedAt: new Date().toISOString(),
        config: dashboardConfigFromBotConfig(nextBotConfig, guildId),
      });
    }

    return err('Method not allowed', 405);
  } catch (e) {
    if (e.name === 'JsonWebTokenError' || e.message === 'No token') return err('Unauthorized', 401);
    console.error('config error:', e);
    return err('Internal error', 500);
  }
};
