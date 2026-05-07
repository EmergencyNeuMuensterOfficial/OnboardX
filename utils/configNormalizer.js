'use strict';

function normalizeGuildConfig(config = {}) {
  const next = clone(config);

  next.modules = {
    ...(next.modules ?? {}),
    logging: moduleEnabled(next.modules?.logging, undefined, hasLogging(next.logging)),
    verification: moduleEnabled(next.modules?.verification, next.verification?.enabled),
    leveling: moduleEnabled(next.modules?.leveling, next.leveling?.enabled),
    giveaways: next.modules?.giveaways !== false,
    polls: next.modules?.polls !== false,
    welcome: moduleEnabled(next.modules?.welcome, next.welcome?.enabled),
    automod: moduleEnabled(next.modules?.automod, next.automod?.enabled),
    antispam: moduleEnabled(next.modules?.antispam, next.automod?.enabled),
    tickets: moduleEnabled(next.modules?.tickets, next.tickets?.enabled),
  };

  if (next.logging) {
    next.logging.channelId = first(
      next.logging.channelId,
      next.logging.modLogChannel,
      next.logging.serverLogChannel,
      next.logging.messageLogChannel,
      next.logging.joinLeaveChannel,
      next.moderation?.modLogChannel
    );
    next.logging.events = {
      ...(next.logging.events ?? {}),
      messageDelete: bool(next.logging.events?.messageDelete, next.logging.messageDelete),
      messageEdit: bool(next.logging.events?.messageEdit, next.logging.messageEdit),
      memberJoin: bool(next.logging.events?.memberJoin, next.logging.memberJoinLeave),
      memberLeave: bool(next.logging.events?.memberLeave, next.logging.memberJoinLeave),
      roleChange: bool(next.logging.events?.roleChange, next.logging.roleChanges),
      modAction: bool(next.logging.events?.modAction, next.logging.modActions),
      voiceUpdate: bool(next.logging.events?.voiceUpdate, next.logging.voiceLogs),
    };
  }

  if (next.moderation) {
    next.moderation.warnThresholds = next.moderation.warnThresholds ?? {
      [Number(next.moderation.warnThresholdTimeout ?? 3)]: 'mute',
      [Number(next.moderation.warnThresholdKick ?? 5)]: 'kick',
      [Number(next.moderation.warnThresholdBan ?? 7)]: 'ban',
    };
  }

  if (next.welcome) {
    next.welcome.channelId = first(next.welcome.channelId, next.welcome.channel);
    next.welcome.farewellChannelId = first(next.welcome.farewellChannelId, next.welcome.farewellChannel);
    next.welcome.autoRoleId = first(
      next.welcome.autoRoleId,
      Array.isArray(next.welcome.autoRolesUser) ? next.welcome.autoRolesUser[0] : null
    );
  }

  if (next.verification) {
    next.verification.channelId = first(next.verification.channelId, next.verification.channel);
    next.verification.roleId = first(
      next.verification.roleId,
      Array.isArray(next.verification.roleAfter) ? next.verification.roleAfter[0] : null
    );
    next.verification.timeout = Number(first(
      next.verification.timeout,
      Number(next.verification.expireMinutes) > 0 ? Number(next.verification.expireMinutes) * 60 : null
    ) ?? 120);
  }

  if (next.tickets) {
    next.tickets.channelId = first(next.tickets.channelId, next.tickets.panelChannel);
    next.tickets.logChannelId = first(next.tickets.logChannelId, next.tickets.logChannel);
    next.tickets.supportRoleId = first(
      next.tickets.supportRoleId,
      Array.isArray(next.tickets.supportRoles) ? next.tickets.supportRoles[0] : null
    );
    next.tickets.maxOpenPerUser = Number(first(next.tickets.maxOpenPerUser, next.tickets.maxPerUser) ?? 1);
  }

  if (next.leveling) {
    next.leveling.multiplier = Number(first(next.leveling.multiplier, 1) ?? 1);
    next.leveling.cooldown = Number(first(next.leveling.cooldown, 60) ?? 60);
    next.leveling.xpMin = Number(first(next.leveling.xpMin, 15) ?? 15);
    next.leveling.xpMax = Number(first(next.leveling.xpMax, 25) ?? 25);
    next.leveling.channelId = next.leveling.levelUpNotification === 'fixed'
      ? first(next.leveling.channelId, next.leveling.levelUpChannel)
      : next.leveling.channelId;
  }

  if (next.giveaways) {
    next.giveaway = {
      ...(next.giveaway ?? {}),
      managerRoleId: first(next.giveaway?.managerRoleId, next.giveaways.managerRole),
      channelId: first(next.giveaway?.channelId, next.giveaways.channel),
    };
  }

  if (next.polls) {
    next.poll = {
      ...(next.poll ?? {}),
      managerRoleId: first(next.poll?.managerRoleId, next.polls.managerRole),
    };
  }

  return next;
}

function first(...values) {
  return values.find(value => value !== undefined && value !== null && value !== '') ?? null;
}

function bool(existing, fallback) {
  if (typeof existing === 'boolean') return existing;
  if (typeof fallback === 'boolean') return fallback;
  return Boolean(fallback);
}

function moduleEnabled(existing, dashboardValue, inferred = false) {
  if (dashboardValue === false) return false;
  return existing === true || dashboardValue === true || inferred === true;
}

function hasLogging(logging = {}) {
  return Boolean(
    logging.channelId ||
    logging.modLogChannel ||
    logging.messageLogChannel ||
    logging.joinLeaveChannel ||
    logging.serverLogChannel ||
    logging.messageDelete ||
    logging.messageEdit ||
    logging.memberJoinLeave ||
    logging.modActions ||
    logging.roleChanges ||
    logging.voiceLogs
  );
}

function clone(value) {
  if (Array.isArray(value)) return value.map(clone);
  if (value instanceof Date) return value;
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, inner]) => [key, clone(inner)]));
  }
  return value;
}

module.exports = {
  normalizeGuildConfig,
};
