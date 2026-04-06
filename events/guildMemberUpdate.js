/**
 * events/guildMemberUpdate.js
 */
'use strict';
const LoggingService = require('../services/LoggingService');

module.exports = {
  name: 'guildMemberUpdate',
  async execute(oldMember, newMember) {
    await LoggingService.onRoleChange(oldMember, newMember);
  },
};
