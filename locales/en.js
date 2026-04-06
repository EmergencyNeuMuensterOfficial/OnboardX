/**
 * locales/en.js
 * English locale strings used throughout the bot.
 * Extend by adding more locale files (e.g. de.js, fr.js) and loading them
 * via a locale resolver that reads the guild's config.language field.
 */

'use strict';

module.exports = {
  // ── General ───────────────────────────────────────────────────────────────
  error:           'An error occurred.',
  permission_denied: 'You do not have permission to do that.',
  cooldown:        (sec) => `Please wait **${sec}s** before using this command again.`,
  premium_required: (feature) => `**${feature}** requires a premium subscription.`,

  // ── Leveling ──────────────────────────────────────────────────────────────
  level_up:        (user, level) => `🎉 ${user} has reached **Level ${level}**!`,
  level_up_role:   (user, level, role) => `🎉 ${user} reached **Level ${level}** and earned ${role}!`,

  // ── Verification ──────────────────────────────────────────────────────────
  verify_success:  (guild) => `✅ You have been verified in **${guild}**! Welcome!`,
  verify_fail:     'You have failed verification. Please contact a moderator.',
  verify_timeout:  'Your verification session has expired.',
  verify_already:  'You are already verified!',

  // ── Giveaway ──────────────────────────────────────────────────────────────
  giveaway_enter:  '🎉 You have entered the giveaway!',
  giveaway_already_entered: 'You have already entered this giveaway.',
  giveaway_ended:  (prize, winners) => `🎊 The giveaway for **${prize}** has ended! Winners: ${winners}`,
  giveaway_no_entries: 'No valid entries were found.',

  // ── Poll ──────────────────────────────────────────────────────────────────
  poll_vote_recorded: (option) => `You voted for **${option}**.`,
  poll_already_voted: 'You have already voted on this option.',
  poll_closed:     'This poll has been closed.',

  // ── Moderation ────────────────────────────────────────────────────────────
  ban_dm:          (guild, reason) => `You have been banned from **${guild}**.\n**Reason:** ${reason}`,
  kick_dm:         (guild, reason) => `You have been kicked from **${guild}**.\n**Reason:** ${reason}`,
  warn_dm:         (guild, reason) => `⚠️ You have received a warning in **${guild}**.\n**Reason:** ${reason}`,
  timeout_dm:      (guild, dur, reason) => `You have been timed out in **${guild}** for **${dur}**.\n**Reason:** ${reason}`,
};
