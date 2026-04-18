// netlify/functions/config.js

const {
  verifyToken,
  getDb,
  defaultConfig,
  ok,
  err,
  options,
  getManagedGuildAccess,
} = require('./_utils');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return options();

  try {
    const user = verifyToken(event.headers.authorization || event.headers.Authorization);
    const guildId = event.queryStringParameters?.guildId;
    if (!guildId || !/^\d+$/.test(guildId)) {
      return err('Missing or invalid guildId', 400);
    }

    const access = await getManagedGuildAccess(user, guildId);
    if (!access.allowed) return err('Forbidden', 403, { reason: access.reason });

    const db = await getDb();
    const col = db.collection('guild_configs');

    if (event.httpMethod === 'GET') {
      let config = await col.findOne({ guildId }, { projection: { _id: 0 } });
      if (!config) {
        config = defaultConfig(guildId);
        await col.insertOne({ ...config, guildId, createdAt: new Date(), updatedAt: new Date() });
      }
      return ok(config);
    }

    if (event.httpMethod === 'POST') {
      let body;
      try {
        body = JSON.parse(event.body || '{}');
      } catch {
        return err('Invalid JSON body', 400);
      }

      const sanitizedBody = sanitizeConfigPayload(body);

      await col.updateOne(
        { guildId },
        {
          $set: { ...sanitizedBody, guildId, updatedAt: new Date() },
        },
        { upsert: true }
      );

      return ok({ success: true, updatedAt: new Date().toISOString() });
    }

    return err('Method not allowed', 405);
  } catch (e) {
    if (e.name === 'JsonWebTokenError' || e.name === 'TokenExpiredError' || e.message === 'No token') {
      return err('Unauthorized', 401);
    }
    console.error('config error:', e);
    return err('Internal error', 500, { details: e.message, code: e.code ?? null });
  }
};

function sanitizeConfigPayload(value) {
  if (Array.isArray(value)) {
    return value.map(sanitizeConfigPayload);
  }

  if (!value || typeof value !== 'object') {
    return value;
  }

  const output = {};
  for (const [key, inner] of Object.entries(value)) {
    if (
      key === '_id' ||
      key === 'guildId' ||
      key === 'createdAt' ||
      key === 'updatedAt' ||
      key.startsWith('$') ||
      key.includes('.')
    ) {
      continue;
    }

    output[key] = sanitizeConfigPayload(inner);
  }

  return output;
}
