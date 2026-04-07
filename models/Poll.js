/**
 * models/Poll.js
 * Poll creation, voting, and retrieval backed by MongoDB.
 */

'use strict';

const db = require('../database/firebase');

function col() {
  return db.getCollection(db.COLLECTIONS.polls);
}

class Poll {
  static async create(data) {
    const now = new Date();
    const poll = {
      _id: db.createId(),
      guildId: data.guildId,
      channelId: data.channelId,
      messageId: data.messageId ?? null,
      question: data.question,
      options: data.options.map(label => ({ label, votes: 0 })),
      anonymous: data.anonymous ?? false,
      multiVote: data.multiVote ?? false,
      voters: {},
      ended: false,
      endsAt: db.toDate(data.endsAt),
      createdBy: data.createdBy,
      createdAt: now,
      updatedAt: now,
    };

    await col().insertOne(poll);
    return normalize(poll);
  }

  static async get(id) {
    const doc = await col().findOne({ _id: id });
    return doc ? normalize(doc) : null;
  }

  static async getByMessage(messageId) {
    const doc = await col().findOne({ messageId });
    return doc ? normalize(doc) : null;
  }

  static async vote(id, userId, optionIndex) {
    const poll = await Poll.get(id);
    if (!poll) return { success: false };
    if (poll.ended) return { success: false, ended: true };
    if (optionIndex < 0 || optionIndex >= poll.options.length) return { success: false, invalidOption: true };

    const existing = poll.voters[userId] ?? [];
    if (!poll.multiVote && existing.length > 0) return { success: false, alreadyVoted: true };
    if (existing.includes(optionIndex)) return { success: false, alreadyVoted: true };

    const updatedOptions = [...poll.options];
    updatedOptions[optionIndex] = {
      ...updatedOptions[optionIndex],
      votes: updatedOptions[optionIndex].votes + 1,
    };

    const nextVoters = { ...poll.voters, [userId]: [...existing, optionIndex] };

    await col().updateOne(
      { _id: id },
      { $set: { options: updatedOptions, voters: nextVoters, updatedAt: new Date() } }
    );

    return { success: true };
  }

  static async end(id) {
    await col().updateOne({ _id: id }, { $set: { ended: true, updatedAt: new Date() } });
  }

  static async update(id, updates) {
    const current = await Poll.get(id);
    if (!current) return null;

    const next = {
      guildId: updates.guildId ?? current.guildId,
      channelId: updates.channelId ?? current.channelId,
      messageId: updates.messageId ?? current.messageId ?? null,
      question: updates.question ?? current.question,
      options: updates.options ?? current.options,
      anonymous: updates.anonymous ?? current.anonymous,
      multiVote: updates.multiVote ?? current.multiVote,
      voters: updates.voters ?? current.voters ?? {},
      ended: updates.ended ?? current.ended,
      endsAt: db.toDate(updates.endsAt ?? current.endsAt),
      createdBy: updates.createdBy ?? current.createdBy,
      updatedAt: new Date(),
    };

    await col().updateOne({ _id: id }, { $set: next });
    return Poll.get(id);
  }

  static totalVotes(poll) {
    return poll.options.reduce((acc, option) => acc + option.votes, 0);
  }
}

function normalize(doc) {
  return {
    id: doc._id,
    guildId: doc.guildId,
    channelId: doc.channelId,
    messageId: doc.messageId ?? null,
    question: doc.question,
    options: Array.isArray(doc.options) ? doc.options : [],
    anonymous: Boolean(doc.anonymous),
    multiVote: Boolean(doc.multiVote),
    voters: doc.voters ?? {},
    ended: Boolean(doc.ended),
    endsAt: db.toTimestamp(doc.endsAt),
    createdBy: doc.createdBy,
    createdAt: db.toTimestamp(doc.createdAt),
    updatedAt: db.toTimestamp(doc.updatedAt),
  };
}

module.exports = Poll;
