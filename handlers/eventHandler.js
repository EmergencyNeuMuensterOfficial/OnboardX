/**
 * handlers/eventHandler.js
 * Auto-discovers and registers all event modules from /events.
 */

'use strict';

const path   = require('path');
const fs     = require('fs');
const logger = require('../utils/logger');

/**
 * @param {Client} client
 */
async function loadEvents(client) {
  const eventsDir = path.join(__dirname, '..', 'events');
  const files     = fs.readdirSync(eventsDir).filter(f => f.endsWith('.js'));

  let count = 0;
  for (const file of files) {
    try {
      const event = require(path.join(eventsDir, file));
      if (!event?.name || typeof event.execute !== 'function') {
        logger.warn(`Skipping invalid event file: ${file}`);
        continue;
      }

      const method = event.once ? 'once' : 'on';
      client[method](event.name, (...args) => {
        try {
          event.execute(...args, client);
        } catch (err) {
          logger.error(`Error in event ${event.name}:`, err);
        }
      });

      count++;
      logger.debug(`Registered event: ${event.name}${event.once ? ' (once)' : ''}`);
    } catch (err) {
      logger.error(`Failed to load event ${file}:`, err);
    }
  }

  logger.info(`Registered ${count} event listeners.`);
}

module.exports = { loadEvents };
