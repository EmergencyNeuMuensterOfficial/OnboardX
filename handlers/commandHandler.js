/**
 * handlers/commandHandler.js
 * Recursively loads all command files from /commands, registers them on the
 * client collection, and (optionally) deploys them to Discord's API.
 */

'use strict';

const { REST, Routes } = require('discord.js');
const path   = require('path');
const fs     = require('fs');
const logger = require('../utils/logger');

/**
 * Walk a directory recursively and return all .js file paths.
 */
function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : full.endsWith('.js') ? [full] : [];
  });
}

/**
 * Load all commands into client.commands and optionally deploy to Discord.
 * @param {Client} client
 */
async function loadCommands(client) {
  const commandsDir = path.join(__dirname, '..', 'commands');
  const files       = walk(commandsDir);
  const jsonBody    = [];
  const clusterId = client.cluster?.id ?? null;
  const isPrimaryCluster = clusterId === null || clusterId === 0;

  for (const file of files) {
    try {
      const command = require(file);
      if (!command?.data?.name || typeof command.execute !== 'function') {
        logger.warn(`Skipping invalid command file: ${file}`);
        continue;
      }
      client.commands.set(command.data.name, command);
      jsonBody.push(command.data.toJSON());
      logger.debug(`Loaded command: ${command.data.name}`);
    } catch (err) {
      logger.error(`Failed to load command ${file}:`, err);
    }
  }

  logger.info(`Loaded ${client.commands.size} commands.`);

  // Deploy commands to Discord (run separately in production via `npm run deploy`)
  if (process.env.AUTO_DEPLOY === 'true' && isPrimaryCluster) {
    await deployCommands(jsonBody);
  } else if (process.env.AUTO_DEPLOY === 'true' && !isPrimaryCluster) {
    logger.info(`Skipping auto deploy on cluster #${clusterId}; primary cluster handles command registration.`);
  }
}

/**
 * Deploy slash commands to Discord.
 * Uses guild-scoped deployment in dev (instant) and global in production (up to 1 hr).
 */
async function deployCommands(jsonBody) {
  const rest    = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
  const isDev   = process.env.NODE_ENV !== 'production';
  const guildIds = (process.env.DEV_GUILD_IDS || '').split(',').filter(Boolean);

  try {
    if (isDev && guildIds.length) {
      for (const guildId of guildIds) {
        await rest.put(Routes.applicationGuildCommands(process.env.CLIENT_ID, guildId), { body: jsonBody });
        logger.info(`Deployed ${jsonBody.length} commands to guild ${guildId}.`);
      }
    } else {
      await rest.put(Routes.applicationCommands(process.env.CLIENT_ID), { body: jsonBody });
      logger.info(`Deployed ${jsonBody.length} commands globally.`);
    }
  } catch (err) {
    logger.error('Command deployment failed:', err);
  }
}

module.exports = { loadCommands, deployCommands };
