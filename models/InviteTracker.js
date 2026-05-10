'use strict';

const db = require('../database/firebase');

function statsCol() {
  return db.getCollection(db.COLLECTIONS.inviteStats);
}

function joinsCol() {
  return db.getCollection(db.COLLECTIONS.inviteJoins);
}

class InviteTracker {
  static async recordJoin(guildId, userId, inviterId, inviteCode, fake = false) {
    const now = new Date();
    await joinsCol().updateOne(
      { guildId, userId },
      {
        $set: { guildId, userId, inviterId, inviteCode, fake, left: false, joinedAt: now, updatedAt: now },
        $setOnInsert: { createdAt: now },
      },
      { upsert: true }
    );

    if (inviterId) {
      await statsCol().updateOne(
        { guildId, inviterId },
        {
          $set: { guildId, inviterId, updatedAt: now },
          $setOnInsert: { createdAt: now },
          $inc: { joins: 1, fake: fake ? 1 : 0 },
        },
        { upsert: true }
      );
    }
  }

  static async recordLeave(guildId, userId) {
    const now = new Date();
    const join = await joinsCol().findOne({ guildId, userId });
    await joinsCol().updateOne({ guildId, userId }, { $set: { left: true, leftAt: now, updatedAt: now } });
    if (join?.inviterId) {
      await statsCol().updateOne(
        { guildId, inviterId: join.inviterId },
        { $inc: { leaves: 1 }, $set: { updatedAt: now } }
      );
    }
    return join;
  }

  static async leaderboard(guildId, limit = 10) {
    return statsCol()
      .find({ guildId })
      .sort({ joins: -1 })
      .limit(limit)
      .toArray();
  }

  static async stats(guildId, inviterId) {
    return statsCol().findOne({ guildId, inviterId });
  }
}

module.exports = InviteTracker;
