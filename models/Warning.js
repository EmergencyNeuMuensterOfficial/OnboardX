/**
 * models/Warning.js
 * Persistent per-user warning records scoped to a guild in MongoDB.
 */

'use strict';

const db = require('../database/firebase');

function col() {
  return db.getCollection(db.COLLECTIONS.warnings);
}

class Warning {
  static async add(guildId, userId, { reason, moderatorId }) {
    const now = new Date();
    const warning = {
      _id: db.createId(),
      guildId,
      userId,
      reason: reason || 'No reason provided',
      moderatorId,
      active: true,
      createdAt: now,
      updatedAt: now,
      pardonedAt: null,
    };

    await col().insertOne(warning);
    const count = await Warning.count(guildId, userId);

    return {
      warning: normalize(warning),
      count,
    };
  }

  static async getAll(guildId, userId) {
    const docs = await col()
      .find({ guildId, userId, active: true })
      .sort({ createdAt: -1 })
      .toArray();
    return docs.map(normalize);
  }

  static async count(guildId, userId) {
    return col().countDocuments({ guildId, userId, active: true });
  }

  static async remove(guildId, warningId) {
    const result = await col().updateOne(
      { _id: warningId, guildId },
      { $set: { active: false, pardonedAt: new Date(), updatedAt: new Date() } }
    );
    return result.modifiedCount > 0;
  }

  static async clearAll(guildId, userId) {
    const count = await Warning.count(guildId, userId);
    if (count === 0) return 0;

    await col().updateMany(
      { guildId, userId, active: true },
      { $set: { active: false, pardonedAt: new Date(), updatedAt: new Date() } }
    );

    return count;
  }
}

function normalize(doc) {
  return {
    id: doc._id,
    guildId: doc.guildId,
    userId: doc.userId,
    reason: doc.reason,
    moderatorId: doc.moderatorId,
    active: Boolean(doc.active),
    createdAt: db.toTimestamp(doc.createdAt),
    pardonedAt: db.toTimestamp(doc.pardonedAt),
    updatedAt: db.toTimestamp(doc.updatedAt),
  };
}

module.exports = Warning;
