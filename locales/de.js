/**
 * locales/de.js
 * German (Deutsch) locale strings.
 */

'use strict';

module.exports = {
  error:           'Ein Fehler ist aufgetreten.',
  permission_denied: 'Du hast keine Berechtigung dafür.',
  cooldown:        (sec) => `Bitte warte **${sec}s**, bevor du diesen Befehl erneut verwendest.`,
  premium_required: (feature) => `**${feature}** erfordert ein Premium-Abonnement.`,

  level_up:        (user, level) => `🎉 ${user} hat **Level ${level}** erreicht!`,
  level_up_role:   (user, level, role) => `🎉 ${user} hat **Level ${level}** erreicht und ${role} erhalten!`,

  verify_success:  (guild) => `✅ Du wurdest in **${guild}** verifiziert! Willkommen!`,
  verify_fail:     'Du hast die Verifizierung nicht bestanden. Bitte kontaktiere einen Moderator.',
  verify_timeout:  'Deine Verifizierungssitzung ist abgelaufen.',
  verify_already:  'Du bist bereits verifiziert!',

  giveaway_enter:  '🎉 Du nimmst am Giveaway teil!',
  giveaway_already_entered: 'Du nimmst bereits an diesem Giveaway teil.',
  giveaway_ended:  (prize, winners) => `🎊 Das Giveaway für **${prize}** ist beendet! Gewinner: ${winners}`,
  giveaway_no_entries: 'Es wurden keine gültigen Teilnahmen gefunden.',

  poll_vote_recorded: (option) => `Du hast für **${option}** gestimmt.`,
  poll_already_voted: 'Du hast diese Option bereits gewählt.',
  poll_closed:     'Diese Abstimmung wurde geschlossen.',

  ban_dm:          (guild, reason) => `Du wurdest von **${guild}** gebannt.\n**Grund:** ${reason}`,
  kick_dm:         (guild, reason) => `Du wurdest von **${guild}** gekickt.\n**Grund:** ${reason}`,
  warn_dm:         (guild, reason) => `⚠️ Du hast eine Verwarnung in **${guild}** erhalten.\n**Grund:** ${reason}`,
  timeout_dm:      (guild, dur, reason) => `Du wurdest in **${guild}** für **${dur}** stummgeschaltet.\n**Grund:** ${reason}`,
};
