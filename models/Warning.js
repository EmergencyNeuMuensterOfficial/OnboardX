/**
 * models/Warning.js
 * Persistent per-user warning records scoped to a guild.
 * Supports auto-punishment thresholds (configurable per guild).
 */

'use strict';

const db = require('../database/firebase');

const COL = 'warnings';

class Warning {
  /**
   * Add a warning to a user in a guild.
   * @returns {Promise<{id, count}>} The new warning doc and the user's total warning count.
   */
  static async add(guildId, userId, { reason, moderatorId }) {
    const ref = db.db.collection(COL).doc();
    const warning = {
      id:          ref.id,
      guildId,
      userId,
      reason:      reason || 'No reason provided',
      moderatorId,
      createdAt:   db.now(),
      active:      true,   // false when pardoned
    };
    await ref.set(warning);

    const count = await Warning.count(guildId, userId);
    return { warning, count };
  }

  /**
   * Fetch all active warnings for a user in a guild.
   */
  static async getAll(guildId, userId) {
    const snap = await db.db.collection(COL)
      .where('guildId', '==', guildId)
      .where('userId',  '==', userId)
      .where('active',  '==', true)
      .orderBy('createdAt', 'desc')
      .get();
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  }

  /**
   * Count active warnings for a user in a guild.
   */
  static async count(guildId, userId) {
    const snap = await db.db.collection(COL)
      .where('guildId', '==', guildId)
      .where('userId',  '==', userId)
      .where('active',  '==', true)
      .get();
    return snap.size;
  }

  /**
   * Remove (pardon) a specific warning by ID.
   * Returns false if the warning doesn't belong to this guild.
   */
  static async remove(guildId, warningId) {
    const ref  = db.db.collection(COL).doc(warningId);
    const snap = await ref.get();
    if (!snap.exists || snap.data().guildId !== guildId) return false;
    await ref.update({ active: false, pardonedAt: db.now() });
    return true;
  }

  /**
   * Clear all warnings for a user in a guild.
   */
  static async clearAll(guildId, userId) {
    const snap = await db.db.collection(COL)
      .where('guildId', '==', guildId)
      .where('userId',  '==', userId)
      .where('active',  '==', true)
      .get();

    const batch = db.db.batch();
    snap.docs.forEach(d => batch.update(d.ref, { active: false, pardonedAt: db.now() }));
    await batch.commit();
    return snap.size;
  }
}

module.exports = Warning;
