/**
 * OnboardX V2 — Bot Entry Point
 *
 * This file is spawned once per Cluster by discord-hybrid-sharding's
 * ClusterManager. Each cluster manages a slice of Discord shards.
 *
 * Can also be run standalone with `node index.js` for development.
 *
 * HOW SHARD IDENTITY WORKS
 * ─────────────────────────────────────────────────────────────────────────────
 * discord-hybrid-sharding sets the following env vars before spawning this file:
 *
 *   SHARD_LIST      Comma-separated shard IDs this cluster owns, e.g. "0,1,2,3"
 *   TOTAL_SHARDS    Total shards across all clusters, e.g. "16"
 *   CLUSTER         This cluster's integer ID, e.g. "0"
 *   CLUSTER_COUNT   Total number of clusters
 *
 * getInfo() reads those vars and returns typed values. When run standalone,
 * SHARD_LIST is empty so we skip the explicit shards option entirely —
 * Discord.js then defaults to connecting as a single-shard bot (shard 0 of 1).
 */

'use strict';

const { Client, GatewayIntentBits, Partials, Collection } = require('discord.js');
const { ClusterClient, getInfo }  = require('discord-hybrid-sharding');
const { loadCommands } = require('./handlers/commandHandler');
const { loadEvents }   = require('./handlers/eventHandler');
const logger           = require('./utils/logger');
const firebase         = require('./database/firebase');
require('dotenv').config();

// ─── Resolve shard info from discord-hybrid-sharding ─────────────────────────
// getInfo() safely returns { SHARD_LIST: number[], TOTAL_SHARDS: number, ... }
// When not spawned by ClusterManager, SHARD_LIST is [] and TOTAL_SHARDS is 1.
const hybridInfo    = getInfo();
const isUnderCluster = hybridInfo.SHARD_LIST.length > 0;
const clusterId      = hybridInfo.CLUSTER ?? 0;
const shardTag       = isUnderCluster ? `[Cluster #${clusterId}]` : '[Bot]';

// ─── Client ───────────────────────────────────────────────────────────────────
const client = new Client({
  // Only pass explicit shards when running under ClusterManager.
  // Standalone mode (node index.js) omits this → Discord.js uses its defaults.
  ...(isUnderCluster && {
    shards:     hybridInfo.SHARD_LIST,   // e.g. [0, 1, 2, 3]
    shardCount: hybridInfo.TOTAL_SHARDS, // e.g. 16
  }),
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.GuildModeration,
    GatewayIntentBits.GuildPresences,
    GatewayIntentBits.DirectMessages,
  ],
  partials: [
    Partials.Message,
    Partials.Channel,
    Partials.Reaction,
    Partials.GuildMember,
    Partials.User,
  ],
});

// Attach the ClusterClient for IPC, broadcastEval, and cluster-aware utilities.
// Safe to call even in standalone mode — it's a no-op if CLUSTER env is absent.
client.cluster = new ClusterClient(client);

// ─── Global collections ───────────────────────────────────────────────────────
client.commands    = new Collection(); // commandName → command module
client.cooldowns   = new Collection(); // `commandName:userId` → expiry timestamp
client.giveaways   = new Collection(); // giveawayId → setTimeout handle
client.configCache = new Collection(); // guildId → { data, expiresAt }
client.shardTag    = shardTag;         // human-readable label for log lines

// ─── Bootstrap ────────────────────────────────────────────────────────────────
async function main() {
  try {
    logger.info(`${shardTag} Starting OnboardX V2…`);
    if (isUnderCluster) {
      logger.info(`${shardTag} Shards: [${hybridInfo.SHARD_LIST.join(', ')}] of ${hybridInfo.TOTAL_SHARDS} total`);
    }

    // 1. Firebase
    await firebase.init();
    logger.info(`${shardTag} Firebase connected`);

    // 2. Commands + events
    await loadCommands(client);
    await loadEvents(client);

    // 3. Restore giveaway timers that were running before this cluster restarted
    const GiveawayService = require('./services/GiveawayService');
    await GiveawayService.restoreGiveaways(client);

    // 4. Connect to Discord
    await client.login(process.env.DISCORD_TOKEN);
  } catch (err) {
    logger.error(`${shardTag} Fatal startup error:`, err);
    process.exit(1);
  }
}

// ─── Process-level safety ─────────────────────────────────────────────────────
process.on('unhandledRejection', reason =>
  logger.error(`${shardTag} Unhandled rejection:`, reason)
);
process.on('uncaughtException', err => {
  logger.error(`${shardTag} Uncaught exception:`, err);
  process.exit(1);
});
process.on('SIGINT', () => {
  logger.info(`${shardTag} SIGINT — destroying client`);
  client.destroy();
  process.exit(0);
});
process.on('SIGTERM', () => {
  logger.info(`${shardTag} SIGTERM — destroying client`);
  client.destroy();
  process.exit(0);
});

main();

module.exports = client;
