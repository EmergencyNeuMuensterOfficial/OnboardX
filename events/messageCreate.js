/**
 * events/messageCreate.js
 * Pipeline order:
 *   1. AutoMod   — content filter (word/invite/link/caps)
 *   2. AntiSpam  — rate / duplicate / mention flood
 *   3. Leveling  — XP grant (only if message wasn't flagged)
 */

'use strict';

const AutoModService  = require('../services/AutoModService');
const AntiSpamService = require('../services/AntiSpamService');
const LevelingService = require('../services/LevelingService');
const VerificationService = require('../services/VerificationService');

module.exports = {
  name: 'messageCreate',

  async execute(message) {
    if (message.author.bot || message.webhookId) return;

    if (!message.guild) {
      await VerificationService.handleDmAnswer(message);
      return;
    }

    // AutoMod runs first — removes illegal content
    const autoModFlagged = await AutoModService.check(message);
    if (autoModFlagged) return;

    // Anti-spam runs second — removes spam / punishes
    const spamFlagged = await AntiSpamService.check(message);
    if (spamFlagged) return;

    // Leveling only runs if the message was clean
    await LevelingService.handleMessage(message);
  },
};
