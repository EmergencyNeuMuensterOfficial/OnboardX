/**
 * utils/time.js
 * Human-readable duration parsing and formatting.
 */

'use strict';

const ms = require('ms');

/**
 * Parse a human duration string like "1h30m", "2d", "30s" into milliseconds.
 * Returns null if unparseable.
 * @param {string} str
 * @returns {number|null}
 */
function parseDuration(str) {
  if (!str || typeof str !== 'string') return null;
  // Support compound durations: "1h30m" → "1h" + "30m"
  const parts  = str.match(/\d+[smhd]/g);
  if (!parts) return null;
  return parts.reduce((acc, part) => acc + (ms(part) || 0), 0) || null;
}

/**
 * Format milliseconds into a human-readable string.
 * @param {number} millis
 * @returns {string}
 */
function formatDuration(millis) {
  if (millis < 1_000) return `${millis}ms`;
  const seconds = Math.floor(millis / 1_000);
  const minutes = Math.floor(seconds / 60);
  const hours   = Math.floor(minutes / 60);
  const days    = Math.floor(hours   / 24);

  const parts = [];
  if (days)              parts.push(`${days}d`);
  if (hours   % 24)     parts.push(`${hours % 24}h`);
  if (minutes % 60)     parts.push(`${minutes % 60}m`);
  if (seconds % 60 && !days) parts.push(`${seconds % 60}s`);

  return parts.join(' ') || '0s';
}

/**
 * Discord timestamp string (relative).
 */
function relative(date) {
  const ts = Math.floor((date instanceof Date ? date.getTime() : date) / 1_000);
  return `<t:${ts}:R>`;
}

/**
 * Discord timestamp string (absolute short).
 */
function absolute(date) {
  const ts = Math.floor((date instanceof Date ? date.getTime() : date) / 1_000);
  return `<t:${ts}:f>`;
}

module.exports = { parseDuration, formatDuration, relative, absolute };
