/**
 * models/Ticket.js
 * Support ticket storage and retrieval backed by MongoDB.
 */

'use strict';

const db = require('../database/firebase');

function ticketsCol() {
  return db.getCollection(db.COLLECTIONS.tickets);
}

function countersCol() {
  return db.getCollection(db.COLLECTIONS.ticketCounters);
}

class Ticket {
  static async create({ guildId, userId, channelId, threadId, subject, category = 'General', priority = 'normal' }) {
    const now = new Date();
    const id = db.createId();
    const cleanSubject = subject || 'No subject';

    const counter = await countersCol().findOneAndUpdate(
      { _id: guildId },
      { $inc: { count: 1 }, $set: { updatedAt: now }, $setOnInsert: { createdAt: now } },
      { upsert: true, returnDocument: 'after' }
    );

    const ticket = {
      _id: id,
      guildId,
      userId,
      channelId,
      threadId,
      subject: cleanSubject,
      category,
      priority,
      claimedBy: null,
      status: 'open',
      ticketNumber: counter?.count ?? counter?.value?.count ?? 1,
      createdAt: now,
      updatedAt: now,
      closedAt: null,
      closedBy: null,
    };

    await ticketsCol().insertOne(ticket);
    return normalize(ticket);
  }

  static async get(id) {
    const doc = await ticketsCol().findOne({ _id: id });
    return doc ? normalize(doc) : null;
  }

  static async getByThread(threadId) {
    const doc = await ticketsCol().findOne({ threadId });
    return doc ? normalize(doc) : null;
  }

  static async getOpenByUser(guildId, userId) {
    const doc = await ticketsCol().findOne(
      { guildId, userId, status: 'open' },
      { sort: { createdAt: -1 } }
    );
    return doc ? normalize(doc) : null;
  }

  static async listOpen(guildId, limit = 25) {
    const docs = await ticketsCol()
      .find({ guildId, status: 'open' })
      .sort({ createdAt: -1 })
      .limit(Number(limit))
      .toArray();
    return docs.map(normalize);
  }

  static async close(id, closedBy) {
    await ticketsCol().updateOne(
      { _id: id },
      { $set: { status: 'closed', closedBy, closedAt: new Date(), updatedAt: new Date() } }
    );
  }

  static async claim(id, claimedBy) {
    await ticketsCol().updateOne(
      { _id: id, status: 'open' },
      { $set: { claimedBy, updatedAt: new Date() } }
    );
    return Ticket.get(id);
  }

  static async setPriority(id, priority) {
    await ticketsCol().updateOne(
      { _id: id, status: 'open' },
      { $set: { priority, updatedAt: new Date() } }
    );
    return Ticket.get(id);
  }
}

function normalize(doc) {
  return {
    id: doc._id,
    guildId: doc.guildId,
    userId: doc.userId,
    channelId: doc.channelId,
    threadId: doc.threadId,
    subject: doc.subject,
    category: doc.category ?? 'General',
    priority: doc.priority ?? 'normal',
    claimedBy: doc.claimedBy ?? null,
    status: doc.status,
    ticketNumber: doc.ticketNumber,
    createdAt: db.toTimestamp(doc.createdAt),
    closedAt: db.toTimestamp(doc.closedAt),
    closedBy: doc.closedBy ?? null,
    updatedAt: db.toTimestamp(doc.updatedAt),
  };
}

module.exports = Ticket;
