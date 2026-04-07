/**
 * models/UserXP.js
 * Manages XP and leveling data per user per guild in MongoDB.
 */

'use strict';

const db = require('../database/firebase');
const config = require('../config/default');

function col() {
  return db.getCollection(db.COLLECTIONS.guildUserXp);
}

class UserXP {
  static async get(guildId, userId) {
    const doc = await db.getDoc(db.userRef(guildId, userId));
    return doc ?? { userId, guildId, xp: 0, level: 0, totalXp: 0, messages: 0 };
  }

  static async addXP(guildId, userId, xpGain) {
    const ref = db.userRef(guildId, userId);
    const current = await UserXP.get(guildId, userId);

    let { xp, level, totalXp, messages } = current;
    xp += xpGain;
    totalXp += xpGain;
    messages += 1;

    const oldLevel = level;
    while (xp >= xpForLevel(level + 1)) {
      xp -= xpForLevel(level + 1);
      level += 1;
    }

    await db.setDoc(ref, { userId, guildId, xp, level, totalXp, messages }, false);
    return { levelled: level > oldLevel, newLevel: level, oldLevel };
  }

  static async setXP(guildId, userId, newXP) {
    const ref = db.userRef(guildId, userId);
    const data = await UserXP.get(guildId, userId);

    let level = 0;
    let xp = newXP;
    while (xp >= xpForLevel(level + 1)) {
      xp -= xpForLevel(level + 1);
      level += 1;
    }

    await db.setDoc(ref, { ...data, xp, level, totalXp: newXP }, false);
  }

  static async leaderboard(guildId, limit = 10) {
    const docs = await col()
      .find({ guildId })
      .sort({ totalXp: -1, userId: 1 })
      .limit(Number(limit))
      .toArray();

    return docs.map(doc => ({
      id: doc.userId,
      guildId: doc.guildId,
      userId: doc.userId,
      xp: doc.xp ?? 0,
      level: doc.level ?? 0,
      totalXp: doc.totalXp ?? 0,
      messages: doc.messages ?? 0,
      createdAt: db.toTimestamp(doc.createdAt),
      updatedAt: db.toTimestamp(doc.updatedAt),
    }));
  }

  static async getRank(guildId, userId) {
    const docs = await col()
      .find({ guildId }, { projection: { userId: 1, _id: 0 } })
      .sort({ totalXp: -1, userId: 1 })
      .toArray();

    const rank = docs.findIndex(doc => doc.userId === userId);
    return rank === -1 ? null : rank + 1;
  }
}

function xpForLevel(level) {
  return config.leveling.levelFormula(level);
}

module.exports = UserXP;
module.exports.xpForLevel = xpForLevel;
