/**
 * events/guildMemberAdd.js
 * Fires when a member joins — runs welcome messages, anti-raid tracking, and logging.
 */
'use strict';

const LoggingService   = require('../services/LoggingService');
const WelcomeService   = require('../services/WelcomeService');
const AntiSpamService  = require('../services/AntiSpamService');
const JoinRolesService = require('../services/JoinRolesService');

module.exports = {
  name: 'guildMemberAdd',
  async execute(member) {
    // Run in parallel — these are fully independent
    await Promise.allSettled([
      LoggingService.onMemberJoin(member),
      WelcomeService.onJoin(member),
      AntiSpamService.trackJoin(member),
      JoinRolesService.onJoin(member),   // Auto-assign configured join roles
    ]);
  },
};
