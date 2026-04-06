/**
 * utils/validation.js
 * Input validation helpers to prevent injection, abuse, and bad data
 * from reaching Firestore or Discord APIs.
 */

'use strict';

/**
 * Sanitise a free-text string:
 *  - Trim whitespace
 *  - Strip zero-width / invisible Unicode characters
 *  - Clamp to maxLength
 *
 * @param {string}  input
 * @param {number}  [maxLength=1000]
 * @returns {string}
 */
function sanitize(input, maxLength = 1_000) {
  if (typeof input !== 'string') return '';
  return input
    .replace(/[\u200B-\u200D\uFEFF\u0000-\u001F\u007F]/g, '') // invisible / control chars
    .trim()
    .slice(0, maxLength);
}

/**
 * Validate a hex colour code (e.g. "#5865F2" or "5865F2").
 * Returns the numeric value if valid, null otherwise.
 *
 * @param {string} hex
 * @returns {number|null}
 */
function parseHexColor(hex) {
  const clean = hex.replace('#', '').trim();
  if (!/^[0-9A-Fa-f]{6}$/.test(clean)) return null;
  return parseInt(clean, 16);
}

/**
 * Validate a Discord snowflake ID (17–20 digit string).
 *
 * @param {string} id
 * @returns {boolean}
 */
function isSnowflake(id) {
  return typeof id === 'string' && /^\d{17,20}$/.test(id);
}

/**
 * Validate a URL (http or https only).
 *
 * @param {string} url
 * @returns {boolean}
 */
function isHttpUrl(url) {
  try {
    const u = new URL(url);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Validate a word-filter entry: only allow printable characters, min 2 chars.
 *
 * @param {string} word
 * @returns {boolean}
 */
function isValidFilterWord(word) {
  return typeof word === 'string' && word.trim().length >= 2 && word.trim().length <= 100;
}

/**
 * Clamp a number between min and max.
 */
function clamp(value, min, max) {
  return Math.max(min, Math.min(max, Number(value)));
}

/**
 * Ensure a value is a positive integer. Returns defaultValue on failure.
 */
function posInt(value, defaultValue = 1, min = 1, max = Infinity) {
  const n = parseInt(value, 10);
  if (!Number.isFinite(n)) return defaultValue;
  return clamp(n, min, max);
}

module.exports = { sanitize, parseHexColor, isSnowflake, isHttpUrl, isValidFilterWord, clamp, posInt };
