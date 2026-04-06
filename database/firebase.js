/**
 * database/firebase.js
 * Initialises Firebase Admin SDK and exports scoped Firestore helpers.
 * All database interactions go through this module.
 */

'use strict';

const admin  = require('firebase-admin');
const logger = require('../utils/logger');

let db;

/**
 * Initialise Firebase once. Idempotent — safe to call multiple times.
 */
async function init() {
  if (admin.apps.length) return; // Already initialised

  const serviceAccount = {
    type: 'service_account',
    project_id:                process.env.FIREBASE_PROJECT_ID,
    private_key_id:            process.env.FIREBASE_PRIVATE_KEY_ID,
    private_key:               (process.env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
    client_email:              process.env.FIREBASE_CLIENT_EMAIL,
    client_id:                 process.env.FIREBASE_CLIENT_ID,
    auth_uri:                  'https://accounts.google.com/o/oauth2/auth',
    token_uri:                 'https://oauth2.googleapis.com/token',
  };

  admin.initializeApp({
    credential:  admin.credential.cert(serviceAccount),
    databaseURL: process.env.FIREBASE_DATABASE_URL,
  });

  db = admin.firestore();

  // Use Firestore settings that improve performance at scale
  db.settings({ ignoreUndefinedProperties: true });

  logger.debug('Firebase Admin SDK initialised.');
}

/**
 * Get a guild's config document reference.
 * @param {string} guildId
 */
const guildRef  = (guildId)         => db.collection('guilds').doc(guildId);
const userRef   = (guildId, userId) => db.collection('guilds').doc(guildId)
                                          .collection('users').doc(userId);
const xpRef     = (guildId)         => db.collection('guilds').doc(guildId)
                                          .collection('users');
const giveRef   = (guildId)         => db.collection('giveaways').where('guildId', '==', guildId);
const pollRef   = (pollId)          => db.collection('polls').doc(pollId);
const premRef   = (guildId)         => db.collection('premium').doc(guildId);
const systemRef = (docId)           => db.collection('system').doc(docId);
const clusterRef = (clusterId)      => systemRef('clusterStatus').collection('clusters').doc(String(clusterId));
const shardRef  = (shardId)         => systemRef('clusterStatus').collection('shards').doc(String(shardId));

// ── Generic Helpers ───────────────────────────────────────────────────────────

/**
 * Fetch a document; returns data or null.
 */
async function getDoc(ref) {
  const snap = await ref.get();
  return snap.exists ? { id: snap.id, ...snap.data() } : null;
}

/**
 * Set/merge a document.
 */
async function setDoc(ref, data, merge = true) {
  await ref.set(
    { ...data, updatedAt: admin.firestore.FieldValue.serverTimestamp() },
    { merge }
  );
}

/**
 * Delete a document.
 */
async function deleteDoc(ref) {
  await ref.delete();
}

/**
 * Increment a numeric field atomically.
 */
function increment(n = 1) {
  return admin.firestore.FieldValue.increment(n);
}

/**
 * Server timestamp shortcut.
 */
function now() {
  return admin.firestore.FieldValue.serverTimestamp();
}

/**
 * Timestamp from a JS Date / ms value.
 */
function timestamp(date) {
  return admin.firestore.Timestamp.fromDate(
    date instanceof Date ? date : new Date(date)
  );
}

/**
 * Batch write helper — auto-commits.
 */
async function batchWrite(operations) {
  const batch = db.batch();
  for (const { ref, data, type } of operations) {
    if (type === 'delete') batch.delete(ref);
    else if (type === 'set')    batch.set(ref, data, { merge: true });
    else                        batch.update(ref, data);
  }
  await batch.commit();
}

module.exports = {
  init,
  get db() { return db; },
  admin,
  // Ref helpers
  guildRef,
  userRef,
  xpRef,
  giveRef,
  pollRef,
  premRef,
  systemRef,
  clusterRef,
  shardRef,
  // Data helpers
  getDoc,
  setDoc,
  deleteDoc,
  increment,
  now,
  timestamp,
  batchWrite,
};
