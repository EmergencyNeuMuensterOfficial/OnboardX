/**
 * models/Poll.js
 * Poll creation, voting, and retrieval from Firestore.
 */

'use strict';

const db = require('../database/firebase');

const COL = 'polls';

class Poll {
  /**
   * Create a poll document.
   */
  static async create(data) {
    const ref  = db.db.collection(COL).doc();
    const poll = {
      id:         ref.id,
      guildId:    data.guildId,
      channelId:  data.channelId,
      messageId:  data.messageId  ?? null,
      question:   data.question,
      options:    data.options.map(label => ({ label, votes: 0 })),
      anonymous:  data.anonymous  ?? false,
      multiVote:  data.multiVote  ?? false,
      voters:     {},   // { userId: [optionIndex, ...] }
      ended:      false,
      endsAt:     db.timestamp(data.endsAt),
      createdBy:  data.createdBy,
      createdAt:  db.now(),
    };
    await ref.set(poll);
    return poll;
  }

  static async get(id) {
    return db.getDoc(db.db.collection(COL).doc(id));
  }

  static async getByMessage(messageId) {
    const snap = await db.db.collection(COL)
      .where('messageId', '==', messageId)
      .limit(1)
      .get();
    if (snap.empty) return null;
    return { id: snap.docs[0].id, ...snap.docs[0].data() };
  }

  /**
   * Record a vote. Returns { success, alreadyVoted, invalidOption }
   */
  static async vote(id, userId, optionIndex) {
    const ref  = db.db.collection(COL).doc(id);
    const snap = await ref.get();
    if (!snap.exists) return { success: false };

    const poll = snap.data();
    if (poll.ended) return { success: false, ended: true };
    if (optionIndex < 0 || optionIndex >= poll.options.length) return { success: false, invalidOption: true };

    const existing = poll.voters[userId] ?? [];
    if (!poll.multiVote && existing.length > 0) return { success: false, alreadyVoted: true };
    if (existing.includes(optionIndex)) return { success: false, alreadyVoted: true };

    const updatedOptions = [...poll.options];
    updatedOptions[optionIndex] = { ...updatedOptions[optionIndex], votes: updatedOptions[optionIndex].votes + 1 };

    await ref.update({
      options: updatedOptions,
      [`voters.${userId}`]: db.admin.firestore.FieldValue.arrayUnion(optionIndex),
    });

    return { success: true };
  }

  static async end(id) {
    await db.setDoc(db.db.collection(COL).doc(id), { ended: true });
  }

  static async update(id, updates) {
    await db.setDoc(db.db.collection(COL).doc(id), updates);
  }

  /**
   * Total votes across all options.
   */
  static totalVotes(poll) {
    return poll.options.reduce((acc, o) => acc + o.votes, 0);
  }
}

module.exports = Poll;
