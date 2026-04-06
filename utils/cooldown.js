/**
 * utils/cooldown.js
 * Per-user, per-command cooldown manager backed by in-memory Collections.
 * Premium servers get a configurable cooldown reduction.
 */

'use strict';

const { Collection } = require('discord.js');
const config         = require('../config/default');
const premiumConfig  = require('../config/premium');

/** @type {Collection<string, Collection<string, number>>} commandName → userId → expiryMs */
const store = new Collection();

/**
 * Check if a user is on cooldown for a command.
 * Returns the remaining cooldown in ms, or 0 if not on cooldown.
 *
 * @param {string} commandName
 * @param {string} userId
 * @param {number} [durationMs] — Defaults to config.cooldowns.default
 * @param {boolean} [isPremium]
 * @returns {number} Remaining ms (0 = not on cooldown)
 */
function check(commandName, userId, durationMs, isPremium = false) {
  const duration = resolveDuration(commandName, durationMs, isPremium);
  if (!store.has(commandName)) return 0;

  const expiry = store.get(commandName).get(userId);
  if (!expiry) return 0;

  const remaining = expiry - Date.now();
  return remaining > 0 ? remaining : 0;
}

/**
 * Set a cooldown for a user on a command.
 *
 * @param {string} commandName
 * @param {string} userId
 * @param {number} [durationMs]
 * @param {boolean} [isPremium]
 */
function set(commandName, userId, durationMs, isPremium = false) {
  const duration = resolveDuration(commandName, durationMs, isPremium);
  if (!store.has(commandName)) store.set(commandName, new Collection());

  const expiry = Date.now() + duration;
  store.get(commandName).set(userId, expiry);

  // Auto-clean after expiry to avoid memory leak
  setTimeout(() => {
    const map = store.get(commandName);
    if (map) map.delete(userId);
  }, duration + 1_000);
}

/**
 * Clear a user's cooldown (e.g. on error).
 */
function clear(commandName, userId) {
  store.get(commandName)?.delete(userId);
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function resolveDuration(commandName, durationMs, isPremium) {
  let dur = durationMs ?? config.cooldowns[commandName] ?? config.cooldowns.default;
  if (isPremium) dur = Math.floor(dur * premiumConfig.general.cooldownReduction);
  return dur;
}

module.exports = { check, set, clear };
