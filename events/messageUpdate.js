/**
 * events/messageUpdate.js
 */
'use strict';
const LoggingService = require('../services/LoggingService');

module.exports = {
  name: 'messageUpdate',
  async execute(oldMessage, newMessage) {
    if (oldMessage.partial || newMessage.partial) return;
    if (!oldMessage.guild) return;
    await LoggingService.onMessageEdit(oldMessage, newMessage);
  },
};
