'use strict';

const TempVoiceService = require('../services/TempVoiceService');
const logger = require('../utils/logger');

module.exports = {
  name: 'voiceStateUpdate',
  async execute(oldState, newState) {
    try {
      await TempVoiceService.handleStateUpdate(oldState, newState);
    } catch (err) {
      logger.error('voiceStateUpdate error:', err);
    }
  },
};
