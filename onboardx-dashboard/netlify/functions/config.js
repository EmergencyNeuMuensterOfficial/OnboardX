// netlify/functions/config.js

const {
  verifyToken,
  getDb,
  defaultConfig,
  ok,
  err,
  options,
  botFetch,
  getManagedGuildAccess,
} = require('./_utils');
const { toBotConfig, toDashboardConfig } = require('./_configAdapter');

const DASHBOARD_MODULE_PATHS = {
  overview: ['system'],
  moderation: ['moderation'],
  automod: ['automod', 'antispam'],
  logging: ['logging'],
  welcome: ['welcome'],
  joinroles: ['joinRoles'],
  verification: ['verification'],
  tickets: ['tickets'],
  leveling: ['leveling'],
  reactionroles: ['reactionRoles'],
  events: ['events'],
  giveaways: ['giveaways', 'giveaway'],
  polls: ['polls', 'poll'],
  permissions: ['dashboard'],
};

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
      let config = await col.findOne({ $or: [{ _id: guildId }, { guildId }] }, { projection: { _id: 0 } });
      if (!config) {
        config = defaultConfig(guildId);
        await col.insertOne({ _id: guildId, ...config, guildId, createdAt: new Date(), updatedAt: new Date() });
      }
      return ok(toDashboardConfig(config));
    }

    if (event.httpMethod === 'POST') {
      let body;
      try {
        body = JSON.parse(event.body || '{}');
      } catch {
        return err('Invalid JSON body', 400);
      }

      const existingConfig = await col.findOne({ $or: [{ _id: guildId }, { guildId }] }) || defaultConfig(guildId);
      const sanitizedBody = toBotConfig(sanitizeConfigPayload(body));
      sanitizedBody.premium = existingConfig.premium === true;
      sanitizedBody.premiumTier = existingConfig.premiumTier ?? null;
      sanitizedBody.premiumExpiresAt = existingConfig.premiumExpiresAt ?? null;
      sanitizedBody.premiumNotifications = existingConfig.premiumNotifications ?? {
        sevenDays: false,
        oneDay: false,
        expired: false,
      };
      const locked = await getLockedChangedModules({
        user,
        access,
        guildId,
        currentConfig: toBotConfig(existingConfig),
        nextConfig: sanitizedBody,
      });
      if (locked.length) {
        return err('Forbidden by dashboard module lock', 403, { lockedModules: locked });
      }

      await col.updateOne(
        { _id: existingConfig?._id ?? guildId },
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

async function getLockedChangedModules({ user, access, guildId, currentConfig, nextConfig }) {
  if (access.guild?.owner) return [];

  const locks = currentConfig.dashboard?.moduleLocks ?? {};
  const changed = Object.entries(DASHBOARD_MODULE_PATHS)
    .filter(([, paths]) => paths.some((path) => !deepEqual(currentConfig?.[path], nextConfig?.[path])))
    .map(([moduleId]) => moduleId);

  const locked = changed.filter((moduleId) => {
    const lock = locks[moduleId];
    return lock?.enabled === true && Array.isArray(lock.roleIds) && lock.roleIds.length > 0;
  });

  if (!locked.length) return [];

  let memberRoleIds = [];
  try {
    const member = await botFetch(`/guilds/${guildId}/members/${user.userId}`);
    memberRoleIds = Array.isArray(member.roles) ? member.roles : [];
  } catch (error) {
    return locked;
  }

  return locked.filter((moduleId) => {
    const roleIds = locks[moduleId]?.roleIds ?? [];
    return !roleIds.some((roleId) => memberRoleIds.includes(roleId));
  });
}

function deepEqual(left, right) {
  return JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
}

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
