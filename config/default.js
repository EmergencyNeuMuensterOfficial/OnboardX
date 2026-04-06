/**
 * config/default.js
 * Global bot-side configuration. Defines defaults applied to every guild
 * unless overridden by a guild-specific config in Firestore.
 */

'use strict';

module.exports = {
  // ── Bot Meta ──────────────────────────────────────────────────────────────
  botName:    'OnboardX V2',
  botVersion: '0.5.0',
  botColor:   0x5865F2, // Discord Blurple
  errorColor: 0xED4245, // Red
  warnColor:  0xFEE75C, // Yellow
  successColor: 0x57F287, // Green
  premiumColor: 0xF1C40F, // Gold

  // ── Cooldowns (milliseconds) ───────────────────────────────────────────────
  cooldowns: {
    default:      3_000,   // 3 s  — General commands
    leveling:    60_000,   // 60 s — XP gain cooldown per message
    verification: 5 * 60_000, // 5 min — Verification attempt
    giveaway:    10_000,
    poll:         5_000,
  },

  // ── Leveling Defaults ─────────────────────────────────────────────────────
  leveling: {
    xpPerMessage:   { min: 15, max: 25 }, // Random XP range
    xpMultiplier:   1.0,                  // Overridden by premium
    levelFormula:   (level) => 5 * level ** 2 + 50 * level + 100,
    maxLevel:       500,
    enabledByDefault: true,
  },

  // ── Verification Defaults ─────────────────────────────────────────────────
  verification: {
    timeoutSeconds: 120, // Time to solve captcha
    maxAttempts:    3,   // Kick after N failures
    enabledByDefault: false,
  },

  // ── Giveaway Defaults ─────────────────────────────────────────────────────
  giveaway: {
    minDuration: 60_000,           // 1 minute
    maxDuration: 30 * 24 * 3_600_000, // 30 days
    defaultWinners: 1,
  },

  // ── Poll Defaults ─────────────────────────────────────────────────────────
  poll: {
    maxOptions:     10,
    defaultDuration: 24 * 3_600_000, // 24 hours
    anonymousByDefault: false,
  },

  // ── Logging Defaults ──────────────────────────────────────────────────────
  logging: {
    events: {
      messageDelete:  true,
      messageEdit:    true,
      memberJoin:     true,
      memberLeave:    true,
      roleChange:     true,
      modAction:      true,
      channelCreate:  false,
      channelDelete:  false,
      voiceUpdate:    false,
    },
  },

  // ── Cache TTL (ms) ────────────────────────────────────────────────────────
  cache: {
    guildConfigTTL: 5 * 60_000, // 5 min
    userXPTTL:      2 * 60_000, // 2 min
  },

  // ── Embed Footer ──────────────────────────────────────────────────────────
  embedFooter: 'OnboardX V2 • Powered by Discord.js v14',

  // ── Owners (bypass all cooldowns & checks) ────────────────────────────────
  owners: (process.env.BOT_OWNERS || '').split(',').filter(Boolean),
};
