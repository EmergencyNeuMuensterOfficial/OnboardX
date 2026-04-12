// netlify/functions/_utils.js
// Shared helpers: DB connection, JWT verification, access checks, config mapping

const { MongoClient } = require('mongodb');
const jwt = require('jsonwebtoken');

let cachedClient = null;

async function getDb() {
  if (!cachedClient) {
    cachedClient = new MongoClient(process.env.MONGODB_URI);
    await cachedClient.connect();
  }

  return cachedClient.db(process.env.MONGODB_DATABASE || 'onboardx');
}

function signToken(payload) {
  return jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '7d' });
}

function verifyToken(authHeader) {
  if (!authHeader?.startsWith('Bearer ')) throw new Error('No token');
  return jwt.verify(authHeader.slice(7), process.env.JWT_SECRET);
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

async function discordFetch(path, accessToken) {
  const res = await fetch(`https://discord.com/api/v10${path}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`Discord API ${res.status}: ${path}`);
  return res.json();
}

async function botFetch(path) {
  const res = await fetch(`https://discord.com/api/v10${path}`, {
    headers: { Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}` },
  });
  if (!res.ok) throw new Error(`Bot API ${res.status}: ${path}`);
  return res.json();
}

async function getManagedGuildAccess(discordToken, guildId) {
  const [userGuilds, botGuilds] = await Promise.all([
    discordFetch('/users/@me/guilds', discordToken),
    botFetch('/users/@me/guilds'),
  ]);

  const guild = userGuilds.find(entry => entry.id === guildId);
  if (!guild) return { allowed: false, reason: 'guild_not_found' };

  const botGuildIds = new Set(botGuilds.map(entry => entry.id));
  if (!botGuildIds.has(guildId)) {
    return { allowed: false, reason: 'bot_not_in_guild' };
  }

  if (guild.owner) return { allowed: true, guild };

  const perms = BigInt(guild.permissions ?? 0);
  const hasAccess = (perms & BigInt(0x8)) !== 0n || (perms & BigInt(0x20)) !== 0n;
  return { allowed: hasAccess, reason: hasAccess ? null : 'missing_permissions', guild };
}

function defaultConfig(guildId) {
  return dashboardConfigFromBotConfig(botDefaultConfig(guildId), guildId);
}

function botDefaultConfig(guildId) {
  return {
    guildId,
    prefix: '!',
    language: 'en',
    modules: {
      logging: false,
      verification: false,
      leveling: true,
      giveaways: true,
      polls: true,
      joinRoles: false,
      welcome: false,
      automod: false,
      antispam: false,
      reactionRoles: false,
      tickets: false,
    },
    logging: {
      channelId: null,
      events: {
        messageDelete: true,
        messageEdit: true,
        memberJoin: true,
        memberLeave: true,
        roleChange: true,
        modAction: true,
        channelCreate: false,
        channelDelete: false,
        voiceUpdate: false,
      },
    },
    verification: {
      channelId: null,
      roleId: null,
      type: 'math',
      timeout: 120,
      maxAttempts: 3,
      dmFallback: true,
      onFail: 'timeout_24h',
      difficulty: 'medium',
      expireMinutes: 10,
    },
    leveling: {
      channelId: null,
      multiplier: 1,
      roleRewards: [],
      customMessage: null,
      stackRoles: false,
    },
    giveaway: {
      managerRoleId: null,
    },
    poll: {
      managerRoleId: null,
    },
    welcome: {
      channelId: null,
      farewellChannelId: null,
      dmEnabled: false,
      dmMessage: null,
      autoRoleId: null,
      message: null,
      title: null,
      farewellMessage: null,
      farewellTitle: null,
      color: null,
      farewellColor: null,
      bannerUrl: null,
    },
    automod: {
      wordFilter: { enabled: false, words: [] },
      inviteFilter: { enabled: false },
      linkFilter: { enabled: false, whitelist: [] },
      capsFilter: { enabled: false, threshold: 70 },
      zalgoFilter: { enabled: false, threshold: 10 },
      action: 'delete_warn',
    },
    antispam: {
      enabled: false,
      msgLimit: 6,
      msgWindow: 5000,
      dupeLimit: 4,
      dupeWindow: 10000,
      mentionLimit: 5,
      mentionSpamEnabled: true,
      raidJoinCount: 10,
      raidJoinWindow: 10000,
      raidJoinEnabled: true,
      punishment: 'mute',
      muteDurationMs: 600000,
    },
    tickets: {
      channelId: null,
      supportRoleId: null,
      logChannelId: null,
      maxOpenPerUser: 1,
      transcripts: true,
    },
    moderation: {
      warnThresholds: {
        3: 'mute',
        5: 'kick',
        7: 'ban',
      },
      muteRoleId: null,
    },
    premium: false,
    premiumTier: null,
    dashboard: {
      ui: null,
    },
  };
}

function dashboardConfigFromBotConfig(botConfig, guildId) {
  const source = mergeDeep(botDefaultConfig(guildId), botConfig ?? {});
  const storedUi = source.dashboard?.ui ?? {};
  const base = mergeDeep(dashboardDefaults(guildId), storedUi);

  base.guildId = guildId;
  base.system = mergeDeep(base.system, source.system ?? {});
  base.moderation.warnThresholdTimeout = findWarnThreshold(source.moderation?.warnThresholds, 'mute', base.moderation.warnThresholdTimeout);
  base.moderation.warnThresholdKick = findWarnThreshold(source.moderation?.warnThresholds, 'kick', base.moderation.warnThresholdKick);
  base.moderation.warnThresholdBan = findWarnThreshold(source.moderation?.warnThresholds, 'ban', base.moderation.warnThresholdBan);
  base.moderation.modLogChannel = source.logging?.channelId ?? base.moderation.modLogChannel ?? '';

  base.automod.enabled = Boolean(source.modules?.automod || source.modules?.antispam);
  base.automod.antiInvite = Boolean(source.automod?.inviteFilter?.enabled);
  base.automod.antiLinks = Boolean(source.automod?.linkFilter?.enabled);
  base.automod.antiCaps = Boolean(source.automod?.capsFilter?.enabled);
  base.automod.antiZalgo = Boolean(source.automod?.zalgoFilter?.enabled);
  base.automod.antiMentionSpam = source.antispam?.mentionSpamEnabled !== false;
  base.automod.antiRaid = source.antispam?.raidJoinEnabled !== false;
  base.automod.maxMessagesPerFive = source.antispam?.msgLimit ?? base.automod.maxMessagesPerFive;
  base.automod.maxMentionsPerMessage = source.antispam?.mentionLimit ?? base.automod.maxMentionsPerMessage;
  base.automod.capsThreshold = source.automod?.capsFilter?.threshold ?? base.automod.capsThreshold;
  base.automod.action = source.automod?.action ?? actionFromPunishment(source.antispam?.punishment, source.antispam?.muteDurationMs) ?? base.automod.action;
  base.automod.allowedDomains = Array.isArray(source.automod?.linkFilter?.whitelist)
    ? source.automod.linkFilter.whitelist
    : base.automod.allowedDomains;

  base.logging.messageDelete = Boolean(source.logging?.events?.messageDelete);
  base.logging.messageEdit = Boolean(source.logging?.events?.messageEdit);
  base.logging.memberJoinLeave = Boolean(source.logging?.events?.memberJoin || source.logging?.events?.memberLeave);
  base.logging.modActions = Boolean(source.logging?.events?.modAction);
  base.logging.roleChanges = Boolean(source.logging?.events?.roleChange);
  base.logging.voiceLogs = Boolean(source.logging?.events?.voiceUpdate);
  base.logging.modLogChannel = source.logging?.channelId ?? base.logging.modLogChannel ?? '';

  base.welcome.enabled = Boolean(source.modules?.welcome);
  base.welcome.channel = source.welcome?.channelId ?? '';
  base.welcome.message = source.welcome?.message ?? base.welcome.message;
  base.welcome.dmEnabled = Boolean(source.welcome?.dmEnabled);
  base.welcome.dmMessage = source.welcome?.dmMessage ?? base.welcome.dmMessage;
  base.welcome.farewellEnabled = Boolean(source.welcome?.farewellChannelId);
  base.welcome.farewellChannel = source.welcome?.farewellChannelId ?? '';
  base.welcome.farewellMessage = source.welcome?.farewellMessage ?? base.welcome.farewellMessage;

  base.verification.enabled = Boolean(source.modules?.verification);
  base.verification.type = source.verification?.type ?? base.verification.type;
  base.verification.channel = source.verification?.channelId ?? '';
  base.verification.dmFallback = source.verification?.dmFallback ?? base.verification.dmFallback;
  base.verification.maxAttempts = source.verification?.maxAttempts ?? base.verification.maxAttempts;
  base.verification.onFail = source.verification?.onFail ?? base.verification.onFail;
  base.verification.difficulty = source.verification?.difficulty ?? base.verification.difficulty;
  base.verification.expireMinutes = source.verification?.expireMinutes
    ?? secondsToMinutes(source.verification?.timeout)
    ?? base.verification.expireMinutes;

  base.tickets.enabled = Boolean(source.modules?.tickets);
  base.tickets.panelChannel = source.tickets?.channelId ?? '';
  base.tickets.logChannel = source.tickets?.logChannelId ?? '';
  base.tickets.maxPerUser = source.tickets?.maxOpenPerUser ?? base.tickets.maxPerUser;
  base.tickets.transcripts = source.tickets?.transcripts ?? base.tickets.transcripts;

  base.leveling.enabled = Boolean(source.modules?.leveling);
  base.leveling.levelUpChannel = source.leveling?.channelId ?? '';
  base.leveling.roleRewards = Array.isArray(source.leveling?.roleRewards) ? source.leveling.roleRewards : base.leveling.roleRewards;

  base.giveaways.managerRole = source.giveaway?.managerRoleId ?? '';
  base.polls.managerRole = source.poll?.managerRoleId ?? '';

  return base;
}

function botConfigFromDashboardConfig(dashboardConfig, currentBotConfig, guildId) {
  const baseBot = mergeDeep(botDefaultConfig(guildId), currentBotConfig ?? {});
  const dashboard = mergeDeep(dashboardDefaults(guildId), dashboardConfig ?? {});

  const unifiedLogChannel = emptyToNull(
    dashboard.logging.modLogChannel ||
    dashboard.moderation.modLogChannel ||
    baseBot.logging?.channelId
  );

  const modulesAutomod = Boolean(dashboard.automod.enabled);

  const next = mergeDeep(baseBot, {
    guildId,
    system: dashboard.system,
    dashboard: {
      ui: dashboard,
    },
    modules: {
      ...baseBot.modules,
      logging: hasEnabledLogging(dashboard.logging),
      verification: Boolean(dashboard.verification.enabled),
      leveling: Boolean(dashboard.leveling.enabled),
      giveaways: true,
      polls: true,
      welcome: Boolean(dashboard.welcome.enabled || dashboard.welcome.farewellEnabled),
      automod: modulesAutomod,
      antispam: modulesAutomod,
      tickets: Boolean(dashboard.tickets.enabled),
    },
    logging: {
      ...baseBot.logging,
      channelId: unifiedLogChannel,
      events: {
        ...baseBot.logging.events,
        messageDelete: Boolean(dashboard.logging.messageDelete),
        messageEdit: Boolean(dashboard.logging.messageEdit),
        memberJoin: Boolean(dashboard.logging.memberJoinLeave),
        memberLeave: Boolean(dashboard.logging.memberJoinLeave),
        roleChange: Boolean(dashboard.logging.roleChanges),
        modAction: Boolean(dashboard.logging.modActions),
        voiceUpdate: Boolean(dashboard.logging.voiceLogs),
      },
    },
    verification: {
      ...baseBot.verification,
      channelId: emptyToNull(dashboard.verification.channel),
      type: dashboard.verification.type === 'button' ? 'math' : dashboard.verification.type,
      timeout: minutesToSeconds(dashboard.verification.expireMinutes, baseBot.verification.timeout),
      maxAttempts: Number(dashboard.verification.maxAttempts ?? baseBot.verification.maxAttempts ?? 3),
      dmFallback: Boolean(dashboard.verification.dmFallback),
      onFail: dashboard.verification.onFail,
      difficulty: dashboard.verification.difficulty,
      expireMinutes: Number(dashboard.verification.expireMinutes ?? 10),
    },
    welcome: {
      ...baseBot.welcome,
      channelId: emptyToNull(dashboard.welcome.channel),
      message: emptyToNull(dashboard.welcome.message),
      dmEnabled: Boolean(dashboard.welcome.dmEnabled),
      dmMessage: emptyToNull(dashboard.welcome.dmMessage),
      farewellChannelId: emptyToNull(dashboard.welcome.farewellChannel),
      farewellMessage: emptyToNull(dashboard.welcome.farewellMessage),
    },
    automod: {
      ...baseBot.automod,
      action: dashboard.automod.action,
      inviteFilter: {
        ...baseBot.automod.inviteFilter,
        enabled: Boolean(dashboard.automod.antiInvite),
      },
      linkFilter: {
        ...baseBot.automod.linkFilter,
        enabled: Boolean(dashboard.automod.antiLinks),
        whitelist: toArray(dashboard.automod.allowedDomains),
      },
      capsFilter: {
        ...baseBot.automod.capsFilter,
        enabled: Boolean(dashboard.automod.antiCaps),
        threshold: Number(dashboard.automod.capsThreshold ?? 70),
      },
      zalgoFilter: {
        ...baseBot.automod.zalgoFilter,
        enabled: Boolean(dashboard.automod.antiZalgo),
      },
    },
    antispam: {
      ...baseBot.antispam,
      enabled: modulesAutomod,
      msgLimit: Number(dashboard.automod.maxMessagesPerFive ?? baseBot.antispam.msgLimit ?? 6),
      mentionLimit: Number(dashboard.automod.maxMentionsPerMessage ?? baseBot.antispam.mentionLimit ?? 5),
      mentionSpamEnabled: Boolean(dashboard.automod.antiMentionSpam),
      raidJoinEnabled: Boolean(dashboard.automod.antiRaid),
      punishment: punishmentFromAction(dashboard.automod.action),
      muteDurationMs: muteDurationFromAction(dashboard.automod.action),
    },
    tickets: {
      ...baseBot.tickets,
      channelId: emptyToNull(dashboard.tickets.panelChannel),
      logChannelId: emptyToNull(dashboard.tickets.logChannel),
      maxOpenPerUser: Number(dashboard.tickets.maxPerUser ?? baseBot.tickets.maxOpenPerUser ?? 1),
      transcripts: Boolean(dashboard.tickets.transcripts),
    },
    giveaway: {
      ...baseBot.giveaway,
      managerRoleId: emptyToNull(dashboard.giveaways.managerRole),
      channelId: emptyToNull(dashboard.giveaways.channel),
    },
    poll: {
      ...baseBot.poll,
      managerRoleId: emptyToNull(dashboard.polls.managerRole),
    },
    moderation: {
      ...baseBot.moderation,
      warnThresholds: {
        [Number(dashboard.moderation.warnThresholdTimeout ?? 3)]: 'mute',
        [Number(dashboard.moderation.warnThresholdKick ?? 5)]: 'kick',
        [Number(dashboard.moderation.warnThresholdBan ?? 7)]: 'ban',
      },
    },
  });

  return next;
}

function dashboardDefaults(guildId) {
  return {
    guildId,
    system: {
      maintenanceMode: false,
      statusApi: true,
      autoRespawn: true,
    },
    moderation: {
      warnThresholdTimeout: 3,
      warnThresholdKick: 5,
      warnThresholdBan: 7,
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
      enabled: false,
      antiInvite: false,
      antiLinks: false,
      antiCaps: false,
      antiZalgo: false,
      antiMentionSpam: true,
      antiRaid: true,
      maxMessagesPerFive: 6,
      maxMentionsPerMessage: 5,
      capsThreshold: 70,
      action: 'delete_warn',
      allowedDomains: [],
    },
    logging: {
      messageDelete: true,
      messageEdit: true,
      memberJoinLeave: true,
      modActions: true,
      roleChanges: true,
      voiceLogs: false,
      modLogChannel: '',
      messageLogChannel: '',
      joinLeaveChannel: '',
      serverLogChannel: '',
    },
    welcome: {
      enabled: false,
      channel: '',
      message: '',
      dmEnabled: false,
      dmMessage: '',
      farewellEnabled: false,
      farewellChannel: '',
      farewellMessage: '',
      autoRolesUser: [],
      autoRolesBot: [],
    },
    verification: {
      enabled: false,
      type: 'math',
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
      enabled: false,
      panelChannel: '',
      logChannel: '',
      supportRoles: [],
      maxPerUser: 1,
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

function mergeDeep(target, source) {
  const output = Array.isArray(target) ? [...target] : { ...(target ?? {}) };

  for (const [key, value] of Object.entries(source ?? {})) {
    if (
      value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      output[key] &&
      typeof output[key] === 'object' &&
      !Array.isArray(output[key])
    ) {
      output[key] = mergeDeep(output[key], value);
    } else {
      output[key] = value;
    }
  }

  return output;
}

function emptyToNull(value) {
  return value === '' || value == null ? null : value;
}

function toArray(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function hasEnabledLogging(logging) {
  return Boolean(
    logging.messageDelete ||
    logging.messageEdit ||
    logging.memberJoinLeave ||
    logging.modActions ||
    logging.roleChanges ||
    logging.voiceLogs
  );
}

function punishmentFromAction(action) {
  switch (action) {
    case 'delete_timeout5':
    case 'delete_timeout30':
      return 'mute';
    case 'delete_warn':
    case 'delete':
    default:
      return 'warn';
  }
}

function muteDurationFromAction(action) {
  switch (action) {
    case 'delete_timeout5':
      return 5 * 60_000;
    case 'delete_timeout30':
      return 30 * 60_000;
    default:
      return 10 * 60_000;
  }
}

function actionFromPunishment(punishment, muteDurationMs) {
  if (punishment === 'mute' || punishment === 'timeout') {
    return muteDurationMs >= 30 * 60_000 ? 'delete_timeout30' : 'delete_timeout5';
  }
  if (punishment === 'warn') return 'delete_warn';
  return 'delete';
}

function findWarnThreshold(thresholds, action, fallback) {
  const match = Object.entries(thresholds ?? {}).find(([, value]) => value === action);
  return match ? Number(match[0]) : fallback;
}

function minutesToSeconds(minutes, fallbackSeconds) {
  const parsed = Number(minutes);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallbackSeconds ?? 600;
  return parsed * 60;
}

function secondsToMinutes(seconds) {
  const parsed = Number(seconds);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.max(1, Math.round(parsed / 60));
}

module.exports = {
  getDb,
  signToken,
  verifyToken,
  ok,
  err,
  options,
  discordFetch,
  botFetch,
  getManagedGuildAccess,
  defaultConfig,
  dashboardConfigFromBotConfig,
  botConfigFromDashboardConfig,
};
