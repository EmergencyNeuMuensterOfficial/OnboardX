/**
 * models/Giveaway.js
 * Giveaway CRUD operations backed by MongoDB.
 */

'use strict';

const db = require('../database/firebase');

function col() {
  return db.getCollection(db.COLLECTIONS.giveaways);
}

class Giveaway {
  static async create(data) {
    const now = new Date();
    const giveaway = {
      _id: db.createId(),
      guildId: data.guildId,
      channelId: data.channelId,
      messageId: data.messageId ?? null,
      prize: data.prize,
      winners: data.winners ?? 1,
      hostedBy: data.hostedBy,
      entries: [],
      winnerIds: [],
      ended: false,
      endsAt: db.toDate(data.endsAt),
      createdAt: now,
      updatedAt: now,
    };

    await col().insertOne(giveaway);
    return normalize(giveaway);
  }

  static async get(id) {
    const doc = await col().findOne({ _id: id });
    return doc ? normalize(doc) : null;
  }

  static async getByMessage(messageId) {
    const doc = await col().findOne({ messageId });
    return doc ? normalize(doc) : null;
  }

  static async getActive() {
    const docs = await col().find({ ended: false }).toArray();
    return docs.map(normalize);
  }

  static async update(id, updates) {
    const current = await Giveaway.get(id);
    if (!current) return null;

    const next = {
      guildId: updates.guildId ?? current.guildId,
      channelId: updates.channelId ?? current.channelId,
      messageId: updates.messageId ?? current.messageId ?? null,
      prize: updates.prize ?? current.prize,
      winners: updates.winners ?? current.winners,
      hostedBy: updates.hostedBy ?? current.hostedBy,
      entries: updates.entries ?? current.entries ?? [],
      winnerIds: updates.winnerIds ?? current.winnerIds ?? [],
      ended: updates.ended ?? current.ended,
      endsAt: db.toDate(updates.endsAt ?? current.endsAt),
      updatedAt: new Date(),
    };

    await col().updateOne({ _id: id }, { $set: next });
    return Giveaway.get(id);
  }

  static async addEntry(id, userId) {
    const result = await col().updateOne(
      { _id: id, entries: { $ne: userId } },
      { $push: { entries: userId }, $set: { updatedAt: new Date() } }
    );
    return result.modifiedCount > 0;
  }

  static pickWinners(entries, count, exclude = []) {
    const pool = entries.filter(entry => !exclude.includes(entry));
    const winners = [];
    const copy = [...pool];

    while (winners.length < count && copy.length) {
      const idx = Math.floor(Math.random() * copy.length);
      winners.push(copy.splice(idx, 1)[0]);
    }

    return winners;
  }

  static async end(id, winnerIds) {
    await col().updateOne(
      { _id: id },
      { $set: { ended: true, winnerIds: winnerIds ?? [], updatedAt: new Date() } }
    );
  }

  static async delete(id) {
    await col().deleteOne({ _id: id });
  }
}

function normalize(doc) {
  return {
    id: doc._id,
    guildId: doc.guildId,
    channelId: doc.channelId,
    messageId: doc.messageId ?? null,
    prize: doc.prize,
    winners: doc.winners ?? 1,
    hostedBy: doc.hostedBy,
    entries: Array.isArray(doc.entries) ? doc.entries : [],
    winnerIds: Array.isArray(doc.winnerIds) ? doc.winnerIds : [],
    ended: Boolean(doc.ended),
    endsAt: db.toTimestamp(doc.endsAt),
    createdAt: db.toTimestamp(doc.createdAt),
    updatedAt: db.toTimestamp(doc.updatedAt),
  };
}

module.exports = Giveaway;
