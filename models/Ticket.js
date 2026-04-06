/**
 * models/Ticket.js
 * Support ticket storage and retrieval.
 * Tickets are backed by Discord threads (forum or text threads).
 */

'use strict';

const db = require('../database/firebase');

const COL = 'tickets';

/**
 * @typedef {object} TicketDoc
 * @property {string} id          Firestore doc ID
 * @property {string} guildId
 * @property {string} userId      Ticket creator
 * @property {string} channelId   Parent channel
 * @property {string} threadId    Thread ID (the actual ticket thread)
 * @property {string} subject
 * @property {'open'|'closed'} status
 * @property {number} ticketNumber  Auto-incremented per guild
 * @property {object} createdAt
 * @property {object} [closedAt]
 * @property {string} [closedBy]
 */

class Ticket {
  static async create({ guildId, userId, channelId, threadId, subject }) {
    // Auto-increment ticket number per guild
    const counterRef = db.db.collection('ticket_counters').doc(guildId);
    const counterSnap = await counterRef.get();
    const ticketNumber = (counterSnap.data()?.count ?? 0) + 1;
    await counterRef.set({ count: ticketNumber }, { merge: true });

    const ref = db.db.collection(COL).doc();
    const ticket = {
      id: ref.id,
      guildId,
      userId,
      channelId,
      threadId,
      subject: subject || 'No subject',
      status: 'open',
      ticketNumber,
      createdAt: db.now(),
    };
    await ref.set(ticket);
    return ticket;
  }

  static async get(id) {
    return db.getDoc(db.db.collection(COL).doc(id));
  }

  static async getByThread(threadId) {
    const snap = await db.db.collection(COL)
      .where('threadId', '==', threadId)
      .limit(1)
      .get();
    if (snap.empty) return null;
    return { id: snap.docs[0].id, ...snap.docs[0].data() };
  }

  static async getOpenByUser(guildId, userId) {
    const snap = await db.db.collection(COL)
      .where('guildId', '==', guildId)
      .where('userId', '==', userId)
      .where('status', '==', 'open')
      .limit(1)
      .get();
    if (snap.empty) return null;
    return { id: snap.docs[0].id, ...snap.docs[0].data() };
  }

  static async listOpen(guildId, limit = 25) {
    const snap = await db.db.collection(COL)
      .where('guildId', '==', guildId)
      .where('status', '==', 'open')
      .orderBy('createdAt', 'desc')
      .limit(limit)
      .get();
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  }

  static async close(id, closedBy) {
    await db.setDoc(db.db.collection(COL).doc(id), {
      status: 'closed',
      closedAt: db.now(),
      closedBy,
    });
  }
}

module.exports = Ticket;
