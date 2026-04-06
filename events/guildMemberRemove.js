/**
 * events/guildMemberRemove.js
 */
'use strict';

const LoggingService = require('../services/LoggingService');
const WelcomeService = require('../services/WelcomeService');

module.exports = {
  name: 'guildMemberRemove',
  async execute(member) {
    await Promise.allSettled([
      LoggingService.onMemberLeave(member),
      WelcomeService.onLeave(member),
    ]);
  },
};
