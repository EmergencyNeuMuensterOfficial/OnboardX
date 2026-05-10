/**
 * events/ready.js
 * Fires once per shard when it connects and is ready.
 */

'use strict';

const { ActivityType } = require('discord.js');
const logger = require('../utils/logger');
const InviteTrackingService = require('../services/InviteTrackingService');

module.exports = {
  name: 'clientReady',
  once: true,

  execute(client) {
    const shardId  = client.shard?.ids?.[0] ?? null;
    const tag      = shardId !== null ? `[Shard #${shardId}]` : '[Bot]';
    const guilds   = client.guilds.cache.size;
    const users    = client.users.cache.size;

    logger.info(`${tag} ✅ Logged in as ${client.user.tag}`);
    logger.info(`${tag} 📊 ${guilds} guild(s) | ${users} cached user(s) | ping ${client.ws.ping}ms`);

    client.guilds.cache.forEach(guild => {
      InviteTrackingService.cacheGuild(guild).catch(() => {});
    });

    // Rotating presence — each shard shows the same set
    const statuses = [
      { name: '🎉 /giveaway start',             type: ActivityType.Watching },
      { name: `${guilds} servers`,               type: ActivityType.Watching },
      { name: '✅ /verify',                     type: ActivityType.Watching },
      { name: '📊 /poll create',                type: ActivityType.Playing  },
      { name: '🎭 /joinroles add',              type: ActivityType.Watching },
      { name: '📜 /rank leaderboard',           type: ActivityType.Watching },
    ];

    let i = 0;
    const rotate = () => {
      const s = statuses[i % statuses.length];
      client.user.setActivity(s.name, { type: s.type });
      i++;
    };

    rotate();
    setInterval(rotate, 30_000);
  },
};
