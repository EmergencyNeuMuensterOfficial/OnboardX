/**
 * models/UserXP.js
 * Manages XP and leveling data per user per guild in Firestore.
 */

'use strict';

const db     = require('../database/firebase');
const config = require('../config/default');
const logger = require('../utils/logger');

class UserXP {
  /**
   * Get a user's XP data in a guild.
   * @param {string} guildId
   * @param {string} userId
   * @returns {Promise<{userId, guildId, xp, level, totalXp, messages}>}
   */
  static async get(guildId, userId) {
    const doc = await db.getDoc(db.userRef(guildId, userId));
    return doc ?? { userId, guildId, xp: 0, level: 0, totalXp: 0, messages: 0 };
  }

  /**
   * Add XP to a user. Returns { levelled, newLevel, oldLevel }.
   * @param {string} guildId
   * @param {string} userId
   * @param {number} xpGain
   */
  static async addXP(guildId, userId, xpGain) {
    const ref     = db.userRef(guildId, userId);
    const current = await UserXP.get(guildId, userId);

    let { xp, level, totalXp, messages } = current;
    xp       += xpGain;
    totalXp  += xpGain;
    messages += 1;

    const oldLevel = level;
    while (xp >= xpForLevel(level + 1)) {
      xp    -= xpForLevel(level + 1);
      level += 1;
    }

    await db.setDoc(ref, { userId, guildId, xp, level, totalXp, messages }, false);

    return { levelled: level > oldLevel, newLevel: level, oldLevel };
  }

  /**
   * Set XP directly (admin command).
   */
  static async setXP(guildId, userId, newXP) {
    const ref  = db.userRef(guildId, userId);
    const data = await UserXP.get(guildId, userId);

    let level = 0;
    let xp    = newXP;
    while (xp >= xpForLevel(level + 1)) {
      xp    -= xpForLevel(level + 1);
      level += 1;
    }

    await db.setDoc(ref, { ...data, xp, level, totalXp: newXP }, false);
  }

  /**
   * Fetch top N users in a guild ordered by totalXp.
   * @param {string} guildId
   * @param {number} limit
   */
  static async leaderboard(guildId, limit = 10) {
    const snap = await db.xpRef(guildId)
      .orderBy('totalXp', 'desc')
      .limit(limit)
      .get();

    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  }

  /**
   * Get a user's rank in a guild.
   */
  static async getRank(guildId, userId) {
    const snap = await db.xpRef(guildId)
      .orderBy('totalXp', 'desc')
      .get();

    const rank = snap.docs.findIndex(d => d.id === userId);
    return rank === -1 ? null : rank + 1;
  }
}

/**
 * XP required to reach a given level (from the previous level).
 */
function xpForLevel(level) {
  return config.leveling.levelFormula(level);
}

module.exports = UserXP;
module.exports.xpForLevel = xpForLevel;
