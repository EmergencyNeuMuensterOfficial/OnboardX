/**
 * handlers/deployCommands.js
 * Run with: npm run deploy
 * Deploys all slash commands to Discord without starting the full bot.
 */

'use strict';

require('dotenv').config();
const { REST, Routes } = require('discord.js');
const path   = require('path');
const fs     = require('fs');
const logger = require('../utils/logger');

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    const full = path.join(dir, e.name);
    return e.isDirectory() ? walk(full) : full.endsWith('.js') ? [full] : [];
  });
}

(async () => {
  const jsonBody = [];
  const files    = walk(path.join(__dirname, '..', 'commands'));

  for (const file of files) {
    try {
      const cmd = require(file);
      if (cmd?.data?.name) jsonBody.push(cmd.data.toJSON());
    } catch (err) {
      logger.warn(`Skipping ${file}: ${err.message}`);
    }
  }

  const rest  = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
  const isDev = process.env.NODE_ENV !== 'production';
  const guilds = (process.env.DEV_GUILD_IDS || '').split(',').filter(Boolean);

  if (isDev && guilds.length) {
    for (const g of guilds) {
      await rest.put(Routes.applicationGuildCommands(process.env.CLIENT_ID, g), { body: jsonBody });
      console.log(`✅ Deployed ${jsonBody.length} commands → guild ${g}`);
    }
  } else {
    await rest.put(Routes.applicationCommands(process.env.CLIENT_ID), { body: jsonBody });
    console.log(`✅ Deployed ${jsonBody.length} commands globally`);
  }
})();
