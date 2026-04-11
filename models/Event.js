/**
 * models/Event.js
 * Scheduled event persistence backed by MongoDB.
 */

'use strict';

const db = require('../database/firebase');

function col() {
  return db.getCollection(db.COLLECTIONS.events);
}

class Event {
  static async create(data) {
    const now = new Date();
    const doc = {
      _id: db.createId(),
      guildId: data.guildId,
      channelId: data.channelId,
      messageId: data.messageId ?? null,
      name: data.name,
      description: data.description ?? null,
      startsAt: db.toDate(data.startsAt),
      timezone: data.timezone ?? 'UTC',
      repeat: data.repeat ?? 'none',
      reminderMinutes: Number(data.reminderMinutes ?? 30),
      attendees: Array.isArray(data.attendees) ? [...new Set(data.attendees)] : [],
      createdBy: data.createdBy,
      cancelled: false,
      completed: false,
      reminderSentAt: null,
      createdAt: now,
      updatedAt: now,
    };

    await col().insertOne(doc);
    return normalize(doc);
  }

  static async get(id) {
    const doc = await col().findOne({ _id: id });
    return doc ? normalize(doc) : null;
  }

  static async getByMessage(messageId) {
    const doc = await col().findOne({ messageId });
    return doc ? normalize(doc) : null;
  }

  static async listUpcoming(guildId, limit = 20) {
    const docs = await col()
      .find({ guildId, cancelled: false, completed: false })
      .sort({ startsAt: 1 })
      .limit(Number(limit))
      .toArray();
    return docs.map(normalize);
  }

  static async listSchedulable(limit = 200) {
    const docs = await col()
      .find({ cancelled: false, completed: false })
      .sort({ startsAt: 1 })
      .limit(Number(limit))
      .toArray();
    return docs.map(normalize);
  }

  static async update(id, updates) {
    const next = { ...sanitize(updates), updatedAt: new Date() };
    await col().updateOne({ _id: id }, { $set: next });
    return Event.get(id);
  }

  static async cancel(id) {
    await col().updateOne(
      { _id: id },
      { $set: { cancelled: true, completed: true, updatedAt: new Date() } }
    );
  }

  static async toggleAttendee(id, userId) {
    const event = await Event.get(id);
    if (!event) return null;

    const attendees = new Set(event.attendees ?? []);
    let joined = false;
    if (attendees.has(userId)) attendees.delete(userId);
    else {
      attendees.add(userId);
      joined = true;
    }

    await col().updateOne(
      { _id: id },
      { $set: { attendees: [...attendees], updatedAt: new Date() } }
    );

    const updated = await Event.get(id);
    return { event: updated, joined };
  }
}

function sanitize(value) {
  const out = { ...value };
  if (out.startsAt) out.startsAt = db.toDate(out.startsAt);
  if (out.reminderSentAt) out.reminderSentAt = db.toDate(out.reminderSentAt);
  return out;
}

function normalize(doc) {
  return {
    id: doc._id,
    guildId: doc.guildId,
    channelId: doc.channelId,
    messageId: doc.messageId ?? null,
    name: doc.name,
    description: doc.description ?? null,
    startsAt: db.toTimestamp(doc.startsAt),
    timezone: doc.timezone ?? 'UTC',
    repeat: doc.repeat ?? 'none',
    reminderMinutes: Number(doc.reminderMinutes ?? 30),
    attendees: Array.isArray(doc.attendees) ? doc.attendees : [],
    createdBy: doc.createdBy,
    cancelled: Boolean(doc.cancelled),
    completed: Boolean(doc.completed),
    reminderSentAt: db.toTimestamp(doc.reminderSentAt),
    createdAt: db.toTimestamp(doc.createdAt),
    updatedAt: db.toTimestamp(doc.updatedAt),
  };
}

module.exports = Event;
