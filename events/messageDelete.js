/**
 * events/messageDelete.js
 */
'use strict';
const LoggingService = require('../services/LoggingService');

module.exports = {
  name: 'messageDelete',
  async execute(message) {
    if (message.partial) return; // Can't log without content
    await LoggingService.onMessageDelete(message);
  },
};
