/**
 * database/firebase.js
 * MongoDB-backed compatibility layer. The file name stays the same so the rest
 * of the codebase can keep its existing imports while the storage backend uses
 * MongoDB instead of Firebase/MariaDB.
 */

'use strict';

const { MongoClient } = require('mongodb');
const { randomUUID } = require('crypto');
const logger = require('../utils/logger');

let client;
let db;
let indexesReady = false;

const COLLECTIONS = {
  guildConfigs: 'guild_configs',
  guildUserXp: 'guild_user_xp',
  giveaways: 'giveaways',
  events: 'events',
  polls: 'polls',
  ticketCounters: 'ticket_counters',
  tickets: 'tickets',
  warnings: 'warnings',
  systemDocs: 'system_docs',
  clusterStatuses: 'cluster_statuses',
  shardStatuses: 'shard_statuses',
  clusterControlCommands: 'cluster_control_commands',
};

function getEnv(name, fallback = null) {
  return process.env[name] ?? fallback;
}

function mongoConfig() {
  const uri = getEnv('MONGODB_URI', 'mongodb://127.0.0.1:27017');
  const isSrv = uri.startsWith('mongodb+srv://');
  const uriHasTlsOption = hasMongoTlsOption(uri);

  return {
    uri,
    database: getEnv('MONGODB_DATABASE', getEnv('DB_NAME', 'onboardx')),
    options: {
      ignoreUndefined: true,
      retryWrites: getEnv('MONGODB_RETRY_WRITES', 'true') === 'true',
      serverSelectionTimeoutMS: Number(getEnv('MONGODB_SERVER_SELECTION_TIMEOUT_MS', '15000')),
      connectTimeoutMS: Number(getEnv('MONGODB_CONNECT_TIMEOUT_MS', '15000')),
      socketTimeoutMS: Number(getEnv('MONGODB_SOCKET_TIMEOUT_MS', '45000')),
      maxPoolSize: Number(getEnv('MONGODB_MAX_POOL_SIZE', '20')),
      minPoolSize: Number(getEnv('MONGODB_MIN_POOL_SIZE', '0')),
      family: Number(getEnv('MONGODB_IP_FAMILY', '4')),
      directConnection: getEnv('MONGODB_DIRECT_CONNECTION', 'false') === 'true',
      ...(!uriHasTlsOption && {
        tls: getEnv('MONGODB_TLS', isSrv ? 'true' : 'false') === 'true',
      }),
      tlsAllowInvalidCertificates: getEnv('MONGODB_TLS_ALLOW_INVALID_CERTIFICATES', 'false') === 'true',
      tlsAllowInvalidHostnames: getEnv('MONGODB_TLS_ALLOW_INVALID_HOSTNAMES', 'false') === 'true',
      tlsCAFile: getEnv('MONGODB_TLS_CA_FILE', undefined),
      servername: getEnv('MONGODB_TLS_SERVER_NAME', undefined),
    },
  };
}

async function init() {
  if (db) return;

  const config = mongoConfig();
  client = new MongoClient(config.uri, config.options);

  try {
    await client.connect();
  } catch (err) {
    logger.error(
      `MongoDB connection failed: ${err.message}. ` +
      `uri=${maskMongoUri(config.uri)} tls=${String(config.options.tls)} directConnection=${String(config.options.directConnection)}`
    );
    throw err;
  }
  db = client.db(config.database);
  await ensureIndexes();
  logger.debug(`MongoDB initialised on database "${config.database}".`);
}

async function ensureIndexes() {
  if (indexesReady) return;

  await Promise.all([
    getCollection(COLLECTIONS.guildConfigs).createIndex({ guildId: 1 }, { sparse: true }),
    getCollection(COLLECTIONS.guildUserXp).createIndex({ guildId: 1, totalXp: -1, userId: 1 }),
    getCollection(COLLECTIONS.guildUserXp).createIndex({ guildId: 1, userId: 1 }, { unique: true }),
    getCollection(COLLECTIONS.giveaways).createIndex({ messageId: 1 }, { sparse: true }),
    getCollection(COLLECTIONS.giveaways).createIndex({ ended: 1, endsAt: 1 }),
    getCollection(COLLECTIONS.events).createIndex({ guildId: 1, cancelled: 1, completed: 1, startsAt: 1 }),
    getCollection(COLLECTIONS.events).createIndex({ messageId: 1 }, { sparse: true }),
    getCollection(COLLECTIONS.polls).createIndex({ messageId: 1 }, { sparse: true }),
    getCollection(COLLECTIONS.polls).createIndex({ ended: 1, endsAt: 1 }),
    getCollection(COLLECTIONS.tickets).createIndex({ threadId: 1 }, { unique: true }),
    getCollection(COLLECTIONS.tickets).createIndex({ guildId: 1, status: 1, createdAt: -1 }),
    getCollection(COLLECTIONS.warnings).createIndex({ guildId: 1, userId: 1, active: 1, createdAt: -1 }),
    getCollection(COLLECTIONS.clusterStatuses).createIndex({ clusterId: 1 }, { unique: true }),
    getCollection(COLLECTIONS.shardStatuses).createIndex({ shardId: 1 }, { unique: true }),
    getCollection(COLLECTIONS.clusterControlCommands).createIndex({ status: 1, requestedAt: 1 }),
  ]);

  indexesReady = true;
}

function getCollection(name) {
  if (!db) throw new Error('Database not initialised. Call init() first.');
  return db.collection(name);
}

function guildRef(guildId) {
  return { kind: 'guild', guildId: String(guildId) };
}

function userRef(guildId, userId) {
  return { kind: 'userXP', guildId: String(guildId), userId: String(userId) };
}

function xpRef(guildId) {
  return { kind: 'xpCollection', guildId: String(guildId) };
}

function giveRef(guildId) {
  return { kind: 'giveawaysByGuild', guildId: String(guildId) };
}

function pollRef(pollId) {
  return { kind: 'poll', pollId: String(pollId) };
}

function premRef(guildId) {
  return { kind: 'premium', guildId: String(guildId) };
}

function systemRef(docId) {
  return { kind: 'system', docId: String(docId) };
}

function clusterRef(clusterId) {
  return { kind: 'cluster', clusterId: String(clusterId) };
}

function shardRef(shardId) {
  return { kind: 'shard', shardId: String(shardId) };
}

async function getDoc(ref) {
  switch (ref.kind) {
    case 'guild': {
      const doc = await getCollection(COLLECTIONS.guildConfigs).findOne({
        $or: [{ _id: ref.guildId }, { guildId: ref.guildId }],
      });
      return doc ? withTimestamps(doc) : null;
    }
    case 'userXP': {
      const doc = await getCollection(COLLECTIONS.guildUserXp).findOne({ _id: xpKey(ref.guildId, ref.userId) });
      return doc ? withTimestamps(doc) : null;
    }
    case 'system': {
      const doc = await getCollection(COLLECTIONS.systemDocs).findOne({ _id: ref.docId });
      return doc ? withTimestamps({ id: ref.docId, ...doc }) : null;
    }
    case 'cluster': {
      const doc = await getCollection(COLLECTIONS.clusterStatuses).findOne({ _id: ref.clusterId });
      return doc ? withTimestamps(doc) : null;
    }
    case 'shard': {
      const doc = await getCollection(COLLECTIONS.shardStatuses).findOne({ _id: ref.shardId });
      return doc ? withTimestamps(doc) : null;
    }
    default:
      throw new Error(`Unsupported ref kind for getDoc(): ${ref.kind}`);
  }
}

async function setDoc(ref, data, merge = true) {
  const nowDate = new Date();

  switch (ref.kind) {
    case 'guild': {
      const collection = getCollection(COLLECTIONS.guildConfigs);
      const existing = await collection.findOne({ $or: [{ _id: ref.guildId }, { guildId: ref.guildId }] });
      const current = merge ? existing : null;
      const next = buildStoredDocument(current, data, merge);
      await collection.updateOne(
        { _id: existing?._id ?? ref.guildId },
        {
          $set: sanitizeDocument({ ...next, guildId: ref.guildId, updatedAt: nowDate }),
          $setOnInsert: { createdAt: nowDate },
        },
        { upsert: true }
      );
      return;
    }
    case 'userXP': {
      await getCollection(COLLECTIONS.guildUserXp).updateOne(
        { _id: xpKey(ref.guildId, ref.userId) },
        {
          $set: sanitizeDocument({
            guildId: ref.guildId,
            userId: ref.userId,
            xp: Number(data.xp ?? 0),
            level: Number(data.level ?? 0),
            totalXp: Number(data.totalXp ?? 0),
            messages: Number(data.messages ?? 0),
            updatedAt: nowDate,
          }),
          $setOnInsert: { createdAt: nowDate },
        },
        { upsert: true }
      );
      return;
    }
    case 'system': {
      const collection = getCollection(COLLECTIONS.systemDocs);
      const current = merge ? await collection.findOne({ _id: ref.docId }) : null;
      const next = buildStoredDocument(current, data, merge);
      await collection.updateOne(
        { _id: ref.docId },
        {
          $set: sanitizeDocument({ ...next, updatedAt: nowDate }),
          $setOnInsert: { createdAt: nowDate },
        },
        { upsert: true }
      );
      return;
    }
    case 'cluster': {
      const collection = getCollection(COLLECTIONS.clusterStatuses);
      const current = merge ? await collection.findOne({ _id: ref.clusterId }) : null;
      const next = buildStoredDocument(current, data, merge);
      await collection.updateOne(
        { _id: ref.clusterId },
        {
          $set: sanitizeDocument({ ...next, clusterId: Number(ref.clusterId), updatedAt: nowDate }),
          $setOnInsert: { createdAt: nowDate },
        },
        { upsert: true }
      );
      return;
    }
    case 'shard': {
      const collection = getCollection(COLLECTIONS.shardStatuses);
      const current = merge ? await collection.findOne({ _id: ref.shardId }) : null;
      const next = buildStoredDocument(current, data, merge);
      await collection.updateOne(
        { _id: ref.shardId },
        {
          $set: sanitizeDocument({ ...next, shardId: Number(ref.shardId), updatedAt: nowDate }),
          $setOnInsert: { createdAt: nowDate },
        },
        { upsert: true }
      );
      return;
    }
    default:
      throw new Error(`Unsupported ref kind for setDoc(): ${ref.kind}`);
  }
}

async function deleteDoc(ref) {
  switch (ref.kind) {
    case 'guild':
      await getCollection(COLLECTIONS.guildConfigs).deleteOne({ _id: ref.guildId });
      return;
    case 'userXP':
      await getCollection(COLLECTIONS.guildUserXp).deleteOne({ _id: xpKey(ref.guildId, ref.userId) });
      return;
    case 'system':
      await getCollection(COLLECTIONS.systemDocs).deleteOne({ _id: ref.docId });
      return;
    case 'cluster':
      await getCollection(COLLECTIONS.clusterStatuses).deleteOne({ _id: ref.clusterId });
      return;
    case 'shard':
      await getCollection(COLLECTIONS.shardStatuses).deleteOne({ _id: ref.shardId });
      return;
    default:
      throw new Error(`Unsupported ref kind for deleteDoc(): ${ref.kind}`);
  }
}

async function query() {
  throw new Error('db.query() is no longer supported after the MongoDB migration. Update the caller to use Mongo collection helpers.');
}

async function one() {
  throw new Error('db.one() is no longer supported after the MongoDB migration. Update the caller to use Mongo collection helpers.');
}

async function transaction(fn) {
  if (!client) throw new Error('Database not initialised. Call init() first.');

  const session = client.startSession();
  try {
    let result;
    await session.withTransaction(async () => {
      result = await fn({ session, db });
    });
    return result;
  } finally {
    await session.endSession();
  }
}

function xpKey(guildId, userId) {
  return `${guildId}:${userId}`;
}

function now() {
  return new Date();
}

function timestamp(date) {
  return toDate(date);
}

function createId() {
  return randomUUID().replace(/-/g, '');
}

function parseJson(value, fallback = null) {
  if (value == null || value === '') return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function stringifyJson(value) {
  return JSON.stringify(value ?? null);
}

function toDate(value) {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value?.toDate === 'function') return value.toDate();
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function toTimestamp(value) {
  const date = toDate(value);
  if (!date) return null;
  return {
    toDate: () => new Date(date.getTime()),
    toMillis: () => date.getTime(),
    valueOf: () => date.getTime(),
    toJSON: () => date.toISOString(),
    toString: () => date.toISOString(),
  };
}

function withTimestamps(doc) {
  if (!doc) return null;

  const normalized = { ...doc };
  if (normalized._id != null && normalized.id == null) normalized.id = normalized._id;
  delete normalized._id;

  if (normalized.createdAt) normalized.createdAt = toTimestamp(normalized.createdAt);
  if (normalized.updatedAt) normalized.updatedAt = toTimestamp(normalized.updatedAt);
  if (normalized.endsAt) normalized.endsAt = toTimestamp(normalized.endsAt);
  if (normalized.closedAt) normalized.closedAt = toTimestamp(normalized.closedAt);
  if (normalized.pardonedAt) normalized.pardonedAt = toTimestamp(normalized.pardonedAt);

  return normalized;
}

function stripMeta(doc) {
  if (!doc) return {};
  const copy = { ...doc };
  delete copy._id;
  delete copy.id;
  delete copy.createdAt;
  delete copy.updatedAt;
  return copy;
}

function buildStoredDocument(current, data, merge) {
  const incoming = stripMeta(data);
  if (!merge) return incoming;
  return stripMeta(deepMerge(stripMeta(current), incoming));
}

function sanitizeDocument(value) {
  if (Array.isArray(value)) {
    return value.map(sanitizeDocument);
  }

  if (value && typeof value === 'object') {
    if (value instanceof Date) return value;
    if (typeof value.toDate === 'function') return value.toDate();

    const output = {};
    for (const [key, inner] of Object.entries(value)) {
      if (inner === undefined) continue;
      output[key] = sanitizeDocument(inner);
    }
    return output;
  }

  return value;
}

function deepMerge(target, source) {
  const output = Array.isArray(target) ? [...target] : { ...(target ?? {}) };
  for (const [key, value] of Object.entries(source ?? {})) {
    if (
      value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      !(value instanceof Date) &&
      typeof value.toDate !== 'function' &&
      output[key] &&
      typeof output[key] === 'object' &&
      !Array.isArray(output[key]) &&
      !(output[key] instanceof Date)
    ) {
      output[key] = deepMerge(output[key], value);
    } else {
      output[key] = value;
    }
  }
  return output;
}

function maskMongoUri(uri) {
  return String(uri).replace(/\/\/([^:\/]+):([^@]+)@/, '//$1:***@');
}

function hasMongoTlsOption(uri) {
  const query = String(uri).split('?')[1] ?? '';
  return /(^|&)(tls|ssl)=/i.test(query);
}

module.exports = {
  init,
  query,
  one,
  transaction,
  parseJson,
  stringifyJson,
  createId,
  now,
  timestamp,
  toDate,
  toTimestamp,
  guildRef,
  userRef,
  xpRef,
  giveRef,
  pollRef,
  premRef,
  systemRef,
  clusterRef,
  shardRef,
  getCollection,
  getDoc,
  setDoc,
  deleteDoc,
  get db() {
    return db;
  },
  get client() {
    return client;
  },
  COLLECTIONS,
};
