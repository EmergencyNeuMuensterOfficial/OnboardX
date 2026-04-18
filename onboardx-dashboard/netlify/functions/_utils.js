// netlify/functions/_utils.js

const { MongoClient } = require('mongodb');
const crypto = require('crypto');

let cachedClient = null;
let cachedDb = null;

async function getDb() {
  if (!cachedClient) {
    const uri = process.env.MONGODB_URI;
    if (!uri) throw new Error('Missing MONGODB_URI');

    cachedClient = new MongoClient(uri, {
      ignoreUndefined: true,
      serverSelectionTimeoutMS: Number(process.env.MONGODB_SERVER_SELECTION_TIMEOUT_MS || 15000),
      connectTimeoutMS: Number(process.env.MONGODB_CONNECT_TIMEOUT_MS || 15000),
      socketTimeoutMS: Number(process.env.MONGODB_SOCKET_TIMEOUT_MS || 45000),
      maxPoolSize: Number(process.env.MONGODB_MAX_POOL_SIZE || 10),
      minPoolSize: Number(process.env.MONGODB_MIN_POOL_SIZE || 0),
      family: Number(process.env.MONGODB_IP_FAMILY || 4),
      directConnection: process.env.MONGODB_DIRECT_CONNECTION === 'true',
      tls: process.env.MONGODB_TLS
        ? process.env.MONGODB_TLS === 'true'
        : uri.startsWith('mongodb+srv://'),
      tlsAllowInvalidCertificates: process.env.MONGODB_TLS_ALLOW_INVALID_CERTIFICATES === 'true',
      tlsAllowInvalidHostnames: process.env.MONGODB_TLS_ALLOW_INVALID_HOSTNAMES === 'true',
      retryWrites: process.env.MONGODB_RETRY_WRITES !== 'false',
    });

    await cachedClient.connect();
    cachedDb = cachedClient.db(
      process.env.MONGODB_DATABASE ||
      process.env.DB_NAME ||
      'OnboardX'
    );
  }

  return cachedDb;
}

function signToken(payload) {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('Missing JWT_SECRET');

  const header = { alg: 'HS256', typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const body = {
    ...payload,
    iat: now,
    exp: now + (7 * 24 * 60 * 60),
  };

  return signJwt(header, body, secret);
}

function verifyToken(authHeader) {
  if (!authHeader?.startsWith('Bearer ')) throw new Error('No token');
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('Missing JWT_SECRET');
  return verifyJwt(authHeader.slice(7), secret);
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
};

function ok(data, code = 200) {
  return {
    statusCode: code,
    headers: { ...CORS, 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  };
}

function err(msg, code = 400, extra = {}) {
  return {
    statusCode: code,
    headers: { ...CORS, 'Content-Type': 'application/json' },
    body: JSON.stringify({ error: msg, ...extra }),
  };
}

function options() {
  return { statusCode: 204, headers: CORS, body: '' };
}

function preflight() {
  return options();
}

async function discordFetch(path, accessToken) {
  const res = await fetch(`https://discord.com/api/v10${path}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`Discord API ${res.status}: ${path}`);
  return res.json();
}

async function botFetch(path) {
  const token = process.env.DISCORD_BOT_TOKEN;
  if (!token) throw new Error('Missing DISCORD_BOT_TOKEN');

  const res = await fetch(`https://discord.com/api/v10${path}`, {
    headers: { Authorization: `Bot ${token}` },
  });
  if (!res.ok) throw new Error(`Bot API ${res.status}: ${path}`);
  return res.json();
}

async function getManagedGuildAccess(userOrToken, guildId) {
  let guild = null;
  let allowedFromToken = null;
  const discordToken = typeof userOrToken === 'string' ? userOrToken : userOrToken?.discordToken;
  const manageableGuilds = Array.isArray(userOrToken?.manageableGuilds) ? userOrToken.manageableGuilds : null;
  const manageableGuildIds = Array.isArray(userOrToken?.manageableGuildIds) ? userOrToken.manageableGuildIds : null;

  if (manageableGuilds) {
    guild = manageableGuilds.find(entry => entry.id === guildId) ?? null;
    allowedFromToken = Boolean(guild);
  }

  if (!guild && manageableGuildIds) {
    allowedFromToken = manageableGuildIds.includes(guildId);
  }

  if (allowedFromToken === null) {
    if (!discordToken) return { allowed: false, reason: 'missing_discord_token' };
    const userGuilds = await discordFetch('/users/@me/guilds', discordToken);
    guild = userGuilds.find(entry => entry.id === guildId);
    if (!guild) return { allowed: false, reason: 'guild_not_found' };

    if (guild.owner) {
      allowedFromToken = true;
    } else {
      const perms = BigInt(guild.permissions ?? 0);
      const ADMINISTRATOR = BigInt(0x8);
      const MANAGE_GUILD = BigInt(0x20);
      const MANAGE_CHANNELS = BigInt(0x10);
      const MANAGE_ROLES = BigInt(0x10000000);
      const KICK_MEMBERS = BigInt(0x2);
      const BAN_MEMBERS = BigInt(0x4);

      allowedFromToken = [
        ADMINISTRATOR,
        MANAGE_GUILD,
        MANAGE_CHANNELS,
        MANAGE_ROLES,
        KICK_MEMBERS,
        BAN_MEMBERS,
      ].some(bit => (perms & bit) !== 0n);
    }
  }

  if (!allowedFromToken) return { allowed: false, reason: 'missing_permissions', guild };

  try {
    await botFetch(`/guilds/${guildId}`);
  } catch {
    return { allowed: false, reason: 'bot_not_in_guild' };
  }

  return { allowed: true, reason: null, guild };
}

function defaultConfig(guildId) {
  return {
    guildId,
    updatedAt: new Date(),
    system: {
      maintenanceMode: false,
      statusApi: true,
      autoRespawn: true,
    },
    moderation: {
      enabled: true,
      warnThresholdTimeout: 3,
      warnThresholdKick: 5,
      warnThresholdBan: 8,
      timeoutDuration: 30,
      warnExpiry: 30,
      modLogChannel: '',
      dmOnWarn: true,
      dmOnTimeout: true,
      dmOnKick: true,
      dmOnBan: true,
      maxPurge: 100,
    },
    automod: {
      enabled: true,
      antiInvite: true,
      antiLinks: true,
      antiCaps: true,
      antiZalgo: true,
      antiMentionSpam: true,
      antiRaid: true,
      maxMessagesPerFive: 5,
      maxMentionsPerMessage: 5,
      capsThreshold: 70,
      action: 'delete_warn',
      whitelistRoles: [],
      allowedDomains: ['youtube.com', 'twitch.tv', 'twitter.com', 'github.com'],
    },
    logging: {
      messageDelete: true,
      messageEdit: true,
      memberJoinLeave: true,
      modActions: true,
      roleChanges: false,
      voiceLogs: false,
      modLogChannel: '',
      messageLogChannel: '',
      joinLeaveChannel: '',
      serverLogChannel: '',
    },
    welcome: {
      enabled: true,
      channel: '',
      message: 'Willkommen auf {server}, {user}!',
      dmEnabled: true,
      dmMessage: 'Hey {user}! Schön, dass du {server} beigetreten bist.',
      farewellEnabled: true,
      farewellChannel: '',
      farewellMessage: '{user} hat uns verlassen.',
      autoRolesUser: [],
      autoRolesBot: [],
    },
    verification: {
      enabled: true,
      type: 'image',
      channel: '',
      roleAfter: [],
      roleRemove: [],
      dmFallback: true,
      maxAttempts: 3,
      onFail: 'timeout_24h',
      difficulty: 'medium',
      expireMinutes: 10,
    },
    tickets: {
      enabled: true,
      panelChannel: '',
      logChannel: '',
      supportRoles: [],
      maxPerUser: 2,
      transcripts: true,
    },
    leveling: {
      enabled: true,
      xpMin: 15,
      xpMax: 25,
      cooldown: 60,
      multiplierRoles: [],
      levelUpNotification: 'channel',
      levelUpChannel: '',
      blacklistChannels: [],
      roleRewards: [],
    },
    events: {
      timezone: 'Europe/Berlin',
      autoReminder: true,
      rsvpButton: true,
      rsvpSlash: true,
      eventsChannel: '',
    },
    giveaways: {
      channel: '',
      managerRole: '',
    },
    polls: {
      managerRole: '',
    },
  };
}

function signJwt(header, payload, secret) {
  const encodedHeader = base64url(JSON.stringify(header));
  const encodedPayload = base64url(JSON.stringify(payload));
  const unsigned = `${encodedHeader}.${encodedPayload}`;
  const signature = base64url(crypto.createHmac('sha256', secret).update(unsigned).digest());
  return `${unsigned}.${signature}`;
}

function verifyJwt(token, secret) {
  const parts = String(token).split('.');
  if (parts.length !== 3) {
    const error = new Error('Invalid token');
    error.name = 'JsonWebTokenError';
    throw error;
  }

  const [encodedHeader, encodedPayload, signature] = parts;
  const unsigned = `${encodedHeader}.${encodedPayload}`;
  const expected = base64url(crypto.createHmac('sha256', secret).update(unsigned).digest());

  const actualBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (
    actualBuffer.length !== expectedBuffer.length ||
    !crypto.timingSafeEqual(actualBuffer, expectedBuffer)
  ) {
    const error = new Error('Invalid signature');
    error.name = 'JsonWebTokenError';
    throw error;
  }

  let payload;
  try {
    payload = JSON.parse(fromBase64url(encodedPayload));
  } catch {
    const error = new Error('Invalid payload');
    error.name = 'JsonWebTokenError';
    throw error;
  }

  if (payload.exp && Math.floor(Date.now() / 1000) >= payload.exp) {
    const error = new Error('Token expired');
    error.name = 'TokenExpiredError';
    throw error;
  }

  return payload;
}

function base64url(value) {
  const buffer = Buffer.isBuffer(value) ? value : Buffer.from(String(value), 'utf8');
  return buffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function fromBase64url(value) {
  const normalized = String(value).replace(/-/g, '+').replace(/_/g, '/');
  const padding = normalized.length % 4 === 0 ? '' : '='.repeat(4 - (normalized.length % 4));
  return Buffer.from(normalized + padding, 'base64').toString('utf8');
}

module.exports = {
  getDb,
  signToken,
  verifyToken,
  ok,
  err,
  options,
  preflight,
  discordFetch,
  botFetch,
  getManagedGuildAccess,
  defaultConfig,
};
