/**
 * utils/i18n.js
 * Lightweight localisation helper.
 * Usage: const t = i18n(guildLanguage); t.level_up(user, level)
 */

'use strict';

const en = require('../locales/en');
const de = require('../locales/de');

const LOCALES = { en, de };

/**
 * Return a locale object for a given language code.
 * Falls back to English for unknown locales.
 *
 * @param {string} [lang='en']
 * @returns {object}
 */
function i18n(lang = 'en') {
  return LOCALES[lang] ?? LOCALES.en;
}

module.exports = i18n;
