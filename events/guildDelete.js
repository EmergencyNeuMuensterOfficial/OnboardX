/**
 * events/guildDelete.js
 * Clean up guild data when the bot leaves a server.
 */
'use strict';
const GuildConfig = require('../models/GuildConfig');
const logger      = require('../utils/logger');

module.exports = {
  name: 'guildDelete',
  async execute(guild) {
    logger.info(`Left guild: ${guild.name} (${guild.id})`);
    await GuildConfig.delete(guild.id).catch(() => {});
  },
};
