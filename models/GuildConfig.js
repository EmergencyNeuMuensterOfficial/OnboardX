/**
 * models/GuildConfig.js
 * Encapsulates all guild configuration persistence in MongoDB.
 * Includes an in-memory LRU-style cache to minimise database reads.
 */

'use strict';

const { Collection } = require('discord.js');
const db     = require('../database/firebase');
const config = require('../config/default');
const logger = require('../utils/logger');

/** @type {Collection<string, {data: object, expiresAt: number}>} */
const cache = new Collection();

const DEFAULT_CONFIG = {
  prefix:   '!',
  language: 'en',
  modules: {
    logging:       false,
    verification:  false,
    leveling:      true,
    giveaways:     true,
    polls:         true,
    joinRoles:     false,
    welcome:       false,
    automod:       false,
    antispam:      false,
    reactionRoles: false,
    tickets:       false,
  },
  logging: {
    channelId: null,
    events: { ...config.logging.events },
  },
  verification: {
    channelId:   null,
    roleId:      null,
    type:        'math',   // 'math' | 'image'
    timeout:     120,
    maxAttempts: 3,
  },
  leveling: {
    channelId:     null,  // null = wherever the XP message was sent
    multiplier:    1.0,
    roleRewards:   [],    // [{ level, roleId }]
    customMessage: null,  // null = use default
    stackRoles:    false,
  },
  giveaway: {
    managerRoleId: null,
  },
  poll: {
    managerRoleId: null,
  },
  joinRoles: {
    humanRoles:         [], // Role IDs assigned to humans on join
    botRoles:           [], // Role IDs assigned to bots on join
    minAccountAgeDays:  0,  // 0 = no gate
    delaySeconds:       0,  // 0 = instant assignment
  },
  welcome: {
    channelId:       null,   // Welcome message channel
    farewellChannelId: null, // Farewell message channel
    dmEnabled:       false,
    dmMessage:       null,   // null = default; supports {user} {username} {server} {memberCount}
    autoRoleId:      null,
    message:         null,
    title:           null,
    farewellMessage: null,
    farewellTitle:   null,
    color:           null,
    farewellColor:   null,
    bannerUrl:       null,
  },
  automod: {
    wordFilter:  { enabled: false, words: [] },
    inviteFilter: { enabled: false },
    linkFilter:  { enabled: false, whitelist: [] },
    capsFilter:  { enabled: false, threshold: 70 },
    zalgoFilter: { enabled: false, threshold: 10 },
  },
  antispam: {
    enabled:        false,
    msgLimit:       6,
    msgWindow:      5000,
    dupeLimit:      4,
    dupeWindow:     10000,
    mentionLimit:   5,
    raidJoinCount:  10,
    raidJoinWindow: 10000,
    punishment:     'mute',
    muteDurationMs: 600000,
  },
  reactionRoles: {
    panels: [],  // [{ messageId, channelId, roles: [{roleId, label, emoji, color}] }]
  },
  tickets: {
    channelId:    null,  // Channel where ticket threads are created
    supportRoleId: null, // Role pinged + given access to ticket threads
    logChannelId: null,  // Where closed-ticket transcripts are posted
    maxOpenPerUser: 1,
  },
  moderation: {
    warnThresholds: {
      3: 'mute',   // After 3 warnings → 10-min timeout
      5: 'kick',   // After 5 warnings → kick
      7: 'ban',    // After 7 warnings → ban
    },
    muteRoleId: null,  // Legacy mute role (prefer Discord timeout)
  },
  premium: false,
  premiumTier: null,
};

class GuildConfig {
  /**
   * Fetch (with cache) a guild's configuration.
   * @param {string} guildId
   * @returns {Promise<object>}
   */
  static async get(guildId) {
    // Cache hit?
    const cached = cache.get(guildId);
    if (cached && cached.expiresAt > Date.now()) return cached.data;

    try {
      const doc = await db.getDoc(db.guildRef(guildId));
      const data = doc ? mergeDefaults(DEFAULT_CONFIG, doc) : { ...DEFAULT_CONFIG, guildId };
      cache.set(guildId, { data, expiresAt: Date.now() + config.cache.guildConfigTTL });
      return data;
    } catch (err) {
      logger.error(`GuildConfig.get(${guildId}):`, err);
      return { ...DEFAULT_CONFIG, guildId };
    }
  }

  /**
   * Update specific fields in a guild's config.
   *
   * @param {string} guildId
   * @param {object} updates  — dot-notation keys are fully supported
   */
  static async update(guildId, updates) {
    try {
      const current = await GuildConfig.get(guildId);
      const next = mergeDefaults(DEFAULT_CONFIG, current);
      applyDotUpdates(next, updates);
      next.guildId = guildId;

      await db.setDoc(db.guildRef(guildId), next, false);
      cache.delete(guildId);
    } catch (err) {
      logger.error(`GuildConfig.update(${guildId}):`, err);
      throw err;
    }
  }

  /**
   * Delete a guild's config (e.g. when the bot leaves).
   */
  static async delete(guildId) {
    await db.deleteDoc(db.guildRef(guildId));
    cache.delete(guildId);
  }

  /**
   * Invalidate the local cache for a guild.
   */
  static invalidate(guildId) {
    cache.delete(guildId);
  }

  /**
   * Check if a module is enabled for the guild.
   * @param {string} guildId
   * @param {string} module
   */
  static async isModuleEnabled(guildId, module) {
    const cfg = await GuildConfig.get(guildId);
    return cfg.modules?.[module] ?? false;
  }

  /**
   * Get the premium status for a guild.
   */
  static async isPremium(guildId) {
    const cfg = await GuildConfig.get(guildId);
    return cfg.premium === true;
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function mergeDefaults(defaults, data) {
  const result = { ...defaults };
  for (const [key, val] of Object.entries(data)) {
    if (val !== null && typeof val === 'object' && !Array.isArray(val) && typeof defaults[key] === 'object') {
      result[key] = mergeDefaults(defaults[key], val);
    } else {
      result[key] = val;
    }
  }
  return result;
}

function applyDotUpdates(target, updates) {
  for (const [path, value] of Object.entries(updates ?? {})) {
    const keys = path.split('.');
    let cursor = target;
    for (let i = 0; i < keys.length - 1; i += 1) {
      const key = keys[i];
      if (!cursor[key] || typeof cursor[key] !== 'object' || Array.isArray(cursor[key])) {
        cursor[key] = {};
      }
      cursor = cursor[key];
    }
    cursor[keys[keys.length - 1]] = value;
  }
}

module.exports = GuildConfig;
