/**
 * models/Giveaway.js
 * Giveaway CRUD operations backed by Firestore.
 */

'use strict';

const db     = require('../database/firebase');
const logger = require('../utils/logger');

const COL = 'giveaways';

class Giveaway {
  /**
   * Create a new giveaway document.
   */
  static async create(data) {
    const ref = db.db.collection(COL).doc();
    const giveaway = {
      id:         ref.id,
      guildId:    data.guildId,
      channelId:  data.channelId,
      messageId:  data.messageId  ?? null,
      prize:      data.prize,
      winners:    data.winners    ?? 1,
      hostedBy:   data.hostedBy,
      entries:    [],
      ended:      false,
      endsAt:     db.timestamp(data.endsAt),
      createdAt:  db.now(),
    };
    await ref.set(giveaway);
    return giveaway;
  }

  /**
   * Fetch a giveaway by its Firestore document ID.
   */
  static async get(id) {
    return db.getDoc(db.db.collection(COL).doc(id));
  }

  /**
   * Fetch a giveaway by its Discord message ID.
   */
  static async getByMessage(messageId) {
    const snap = await db.db.collection(COL)
      .where('messageId', '==', messageId)
      .limit(1)
      .get();
    if (snap.empty) return null;
    return { id: snap.docs[0].id, ...snap.docs[0].data() };
  }

  /**
   * Fetch all active (not ended) giveaways — used for persistence on restart.
   */
  static async getActive() {
    const snap = await db.db.collection(COL)
      .where('ended', '==', false)
      .get();
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  }

  /**
   * Update a giveaway (partial update, merged).
   */
  static async update(id, updates) {
    await db.setDoc(db.db.collection(COL).doc(id), updates);
  }

  /**
   * Atomically add an entry to the giveaway (prevents duplicates).
   * @param {string} id Giveaway document ID
   * @param {string} userId
   * @returns {Promise<boolean>} true if added, false if already entered
   */
  static async addEntry(id, userId) {
    const ref  = db.db.collection(COL).doc(id);
    const snap = await ref.get();
    if (!snap.exists) return false;

    const { entries } = snap.data();
    if (entries.includes(userId)) return false;

    await ref.update({ entries: db.admin.firestore.FieldValue.arrayUnion(userId) });
    return true;
  }

  /**
   * Pick N random winners from entries, excluding a list of previous winners.
   * @param {string[]} entries
   * @param {number} count
   * @param {string[]} [exclude]
   */
  static pickWinners(entries, count, exclude = []) {
    const pool    = entries.filter(e => !exclude.includes(e));
    const winners = [];
    const pool2   = [...pool];

    while (winners.length < count && pool2.length) {
      const idx = Math.floor(Math.random() * pool2.length);
      winners.push(pool2.splice(idx, 1)[0]);
    }

    return winners;
  }

  /**
   * Mark a giveaway as ended and store winners.
   */
  static async end(id, winnerIds) {
    await db.setDoc(db.db.collection(COL).doc(id), { ended: true, winnerIds });
  }

  /**
   * Delete a giveaway (admin only).
   */
  static async delete(id) {
    await db.db.collection(COL).doc(id).delete();
  }
}

module.exports = Giveaway;
