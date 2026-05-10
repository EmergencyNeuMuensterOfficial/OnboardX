'use strict';

const db = require('../database/firebase');

function col() {
  return db.getCollection(db.COLLECTIONS.moderationCases);
}

class ModCase {
  static async create(guildId, { action, targetId, targetTag, moderatorId, moderatorTag, reason, duration = null, status = 'open', evidence = null }) {
    const now = new Date();
    const caseId = await nextCaseId(guildId);
    const doc = {
      _id: `${guildId}:${caseId}`,
      guildId,
      caseId,
      action,
      targetId,
      targetTag,
      moderatorId,
      moderatorTag,
      reason: reason || 'No reason provided',
      duration,
      status,
      evidence,
      createdAt: now,
      updatedAt: now,
    };
    await col().insertOne(doc);
    return normalize(doc);
  }

  static async list(guildId, targetId = null, limit = 10) {
    const query = { guildId };
    if (targetId) query.targetId = targetId;
    const docs = await col().find(query).sort({ caseId: -1 }).limit(limit).toArray();
    return docs.map(normalize);
  }

  static async get(guildId, caseId) {
    const doc = await col().findOne({ guildId, caseId: Number(caseId) });
    return doc ? normalize(doc) : null;
  }

  static async update(guildId, caseId, updates) {
    const allowed = {};
    for (const key of ['reason', 'status', 'evidence']) {
      if (updates[key] !== undefined) allowed[key] = updates[key];
    }
    allowed.updatedAt = new Date();
    const result = await col().findOneAndUpdate(
      { guildId, caseId: Number(caseId) },
      { $set: allowed },
      { returnDocument: 'after' }
    );
    const doc = result?.value ?? result;
    return doc ? normalize(doc) : null;
  }
}

async function nextCaseId(guildId) {
  const counters = db.getCollection('counters');
  const result = await counters.findOneAndUpdate(
    { _id: `modcase:${guildId}` },
    { $inc: { seq: 1 }, $setOnInsert: { guildId, createdAt: new Date() }, $set: { updatedAt: new Date() } },
    { upsert: true, returnDocument: 'after' }
  );
  return Number(result?.seq ?? result?.value?.seq ?? 1);
}

function normalize(doc) {
  return {
    id: doc._id,
    guildId: doc.guildId,
    caseId: Number(doc.caseId),
    action: doc.action,
    targetId: doc.targetId,
    targetTag: doc.targetTag,
    moderatorId: doc.moderatorId,
    moderatorTag: doc.moderatorTag,
    reason: doc.reason,
    duration: doc.duration,
    status: doc.status,
    evidence: doc.evidence,
    createdAt: db.toTimestamp(doc.createdAt),
    updatedAt: db.toTimestamp(doc.updatedAt),
  };
}

module.exports = ModCase;
