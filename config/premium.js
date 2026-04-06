/**
 * config/premium.js
 * Feature flags and multipliers unlocked for premium guilds / users.
 */

'use strict';

module.exports = {
  // ── Leveling ──────────────────────────────────────────────────────────────
  leveling: {
    xpMultiplier:   1.5,  // 1.5× XP per message
    maxRoleRewards: 25,   // vs 5 on free tier
    customLevelMsg: true,
  },

  // ── Giveaways ─────────────────────────────────────────────────────────────
  giveaway: {
    maxConcurrent:  10,   // vs 3 on free tier
    maxWinners:     20,   // vs 5 on free tier
    bonusEntries:   true, // Role-based bonus entries
  },

  // ── Logging ───────────────────────────────────────────────────────────────
  logging: {
    voiceUpdate:      true,
    channelCreate:    true,
    channelDelete:    true,
    customEmbedColor: true, // Use guild branding color
    bulkExport:       true, // Export logs as file
  },

  // ── Polls ─────────────────────────────────────────────────────────────────
  poll: {
    maxOptions:   20,   // vs 10 on free tier
    scheduledPolls: true,
    resultsGraph:   true, // Visual bar chart
  },

  // ── General ───────────────────────────────────────────────────────────────
  general: {
    priorityProcessing: true,
    advancedAnalytics:  true,
    customEmbedBranding: true,
    removeBotBranding:   false, // White-label (enterprise only)
    cooldownReduction:   0.5,  // 50% shorter cooldowns
  },

  // ── Tier definitions ──────────────────────────────────────────────────────
  tiers: {
    basic: {
      price: 4.99,
      features: ['xpMultiplier', 'maxConcurrent', 'customLevelMsg'],
    },
    pro: {
      price: 9.99,
      features: ['basic', 'voiceUpdate', 'bonusEntries', 'resultsGraph'],
    },
    enterprise: {
      price: 29.99,
      features: ['pro', 'removeBotBranding', 'bulkExport', 'advancedAnalytics'],
    },
  },
};
