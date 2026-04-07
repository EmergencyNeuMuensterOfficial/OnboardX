/**
 * shard.js - OnboardX V2 Cluster + Shard Manager
 */

'use strict';

require('dotenv').config();

const path   = require('path');
const fs     = require('fs');
const os     = require('os');
const { ClusterManager } = require('discord-hybrid-sharding');
const { chunkArray, fetchRecommendedShards } = require('discord-hybrid-sharding/dist/Util/Util');
const logger   = require('./utils/logger');
const firebase = require('./database/firebase');

const TOTAL_SHARDS       = process.env.TOTAL_SHARDS ? parseInt(process.env.TOTAL_SHARDS, 10) : 'auto';
const SHARDS_PER_CLUSTER = parseInt(process.env.SHARDS_PER_CLUSTER ?? '4', 10);
const CLUSTER_COUNT      = process.env.CLUSTER_COUNT ? parseInt(process.env.CLUSTER_COUNT, 10) : 'auto';
// Cluster spawn parallelism. Shard identify speed is still bounded by Discord session-start limits.
const CLUSTER_SPAWN_CONCURRENCY = parseInt(process.env.CLUSTER_SPAWN_CONCURRENCY ?? '3', 10);
const CLUSTER_SPAWN_BATCH_DELAY_MS = parseInt(process.env.CLUSTER_SPAWN_BATCH_DELAY_MS ?? '250', 10);
// If you wait for READY on spawn, timeouts must scale with shard count per cluster.
const CLUSTER_READY_TIMEOUT_BASE_MS = parseInt(process.env.CLUSTER_READY_TIMEOUT_MS ?? '120000', 10);
const CLUSTER_READY_TIMEOUT_PER_SHARD_MS = parseInt(process.env.CLUSTER_READY_TIMEOUT_PER_SHARD_MS ?? '7000', 10);
const CLUSTER_WAIT_READY_ON_SPAWN = process.env.CLUSTER_WAIT_READY_ON_SPAWN === 'true';
const CLUSTER_RESPAWN_DELAY_MS = parseInt(process.env.CLUSTER_RESPAWN_DELAY_MS ?? '5000', 10);
const CLUSTER_RESPAWN_TIMEOUT_MS = parseInt(process.env.CLUSTER_RESPAWN_TIMEOUT_MS ?? '-1', 10);
const HEALTH_PORT        = parseInt(process.env.HEALTH_PORT ?? '9090', 10);
const STATUS_SYNC_MS     = parseInt(process.env.CLUSTER_STATUS_SYNC_MS ?? '30000', 10);
const STATUSJSON_PATH    = path.join(__dirname, 'monitoring', 'statusjson.json');
// If the manager crashes hard, no shutdown hook runs. This TTL lets UIs mark status as offline when stale.
const STATUS_TTL_MS      = parseInt(process.env.CLUSTER_STATUS_TTL_MS ?? String(STATUS_SYNC_MS * 3), 10);

const manager = new ClusterManager(path.join(__dirname, 'index.js'), {
  totalShards: TOTAL_SHARDS,
  shardsPerClusters: SHARDS_PER_CLUSTER,
  totalClusters: CLUSTER_COUNT,
  mode: 'process',
  token: process.env.DISCORD_TOKEN,
  respawn: true,
  execArgv: process.execArgv,
});

let lastSnapshot = null;
const respawningClusters = new Set();

manager.on('clusterCreate', cluster => {
  logger.info(`[Manager] Cluster #${cluster.id} Spawning`);
  void writeClusterLifecycleStatus(cluster.id, {
    state: 'spawning',
    ready: false,
    processState: 'starting',
    pid: cluster.process?.pid ?? null,
    lastEventAt: new Date().toISOString(),
  });

  cluster.on('ready', () => {
    logger.info(`[Manager] Cluster #${cluster.id} Ready`);
    void writeClusterLifecycleStatus(cluster.id, {
      state: 'ready',
      ready: true,
      processState: 'online',
      pid: cluster.process?.pid ?? null,
      lastEventAt: new Date().toISOString(),
    });
  });

  cluster.on('reconnecting', () => {
    logger.warn(`[Manager] Cluster #${cluster.id} Reconnecting`);
    void writeClusterLifecycleStatus(cluster.id, {
      state: 'reconnecting',
      ready: false,
      processState: 'reconnecting',
      pid: cluster.process?.pid ?? null,
      lastEventAt: new Date().toISOString(),
    });
  });

  cluster.on('disconnect', () => {
    logger.warn(`[Manager] Cluster #${cluster.id} Disconnected`);
    void writeClusterLifecycleStatus(cluster.id, {
      state: 'disconnected',
      ready: false,
      processState: 'disconnected',
      pid: cluster.process?.pid ?? null,
      lastEventAt: new Date().toISOString(),
    });
  });

  cluster.on('error', err => {
    logger.error(`[Manager] Cluster #${cluster.id} Error: ${err.message}`);
    void writeClusterLifecycleStatus(cluster.id, {
      state: 'error',
      ready: false,
      processState: 'error',
      pid: cluster.process?.pid ?? null,
      error: err.message,
      lastEventAt: new Date().toISOString(),
    });
    void ensureClusterRespawn(cluster, `error: ${err.message}`);
  });

  cluster.on('death', proc => {
    logger.error(`[Manager] Cluster #${cluster.id} Process died (code ${proc?.exitCode ?? '?'})`);
    void writeClusterLifecycleStatus(cluster.id, {
      state: 'dead',
      ready: false,
      processState: 'dead',
      pid: proc?.pid ?? cluster.process?.pid ?? null,
      exitCode: proc?.exitCode ?? null,
      lastEventAt: new Date().toISOString(),
    });
    void ensureClusterRespawn(cluster, `death: ${proc?.exitCode ?? 'unknown'}`);
  });
});

(async () => {
  try {
    logger.info('[Manager] OnboardX V2 starting up...');
    logger.info(`[Manager] Config: totalShards=${TOTAL_SHARDS} | shardsPerCluster=${SHARDS_PER_CLUSTER} | clusters=${CLUSTER_COUNT}`);

    await firebase.init();
    await firebase.setDoc(firebase.systemRef('clusterStatus'), {
      state: 'starting',
      bootedAt: new Date().toISOString(),
      healthPort: HEALTH_PORT,
      statusSyncMs: STATUS_SYNC_MS,
      host: os.hostname(),
      platform: process.platform,
      node: process.version,
      maintenance: getMaintenanceState(),
    });
    writeStatusJsonFile({
      online: true,
      stale: false,
      state: 'starting',
      ts: new Date().toISOString(),
      source: 'local',
    });

    const totalShards = await resolveTotalShards();
    const spawnSummary = await spawnClustersParallel(totalShards);

    logger.info(
      `[Manager] Spawned ${spawnSummary.spawned} cluster(s)` +
      (spawnSummary.failed ? `, ${spawnSummary.failed} failed to spawn` : '')
    );
    // Don't block startup on the first broadcastEval + Firestore writes.
    setTimeout(() => void syncClusterStatusToFirebase(manager).catch(() => {}), 1_000).unref?.();

    setInterval(async () => {
      try {
        const stats = await collectStats(manager);
        logger.info(
          `[Manager] ${stats.totalGuilds} guilds | ${stats.totalUsers} users | ` +
          `avg ping ${stats.avgPingMs}ms | ${stats.clusterCount} cluster(s)`
        );
        await syncClusterStatusToFirebase(manager, stats);
      } catch (err) {
        logger.warn(`[Manager] Cluster status sync skipped: ${err.message}`);
      }
    }, STATUS_SYNC_MS).unref();
  } catch (err) {
    logger.error('[Manager] Fatal spawn error:', err);
    await markSystemStopped({ reason: 'fatal', error: err.message });
    process.exit(1);
  }
})();

const shutdown = async (sig) => {
  logger.info(`[Manager] ${sig} received - shutting down clusters`);
  await markSystemStopped({ reason: 'signal', signal: sig });
  try {
    await manager.broadcastEval(c => c.destroy()).catch(() => {});
  } catch { /* ignore */ }
  process.exit(0);
};

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('unhandledRejection', r => logger.error('[Manager] Unhandled rejection:', r));
process.on('uncaughtException', async err => {
  logger.error('[Manager] Uncaught exception:', err);
  await markSystemStopped({ reason: 'uncaught_exception', error: err.message });
  process.exit(1);
});

async function collectClusterBreakdown(mgr) {
  return mgr.broadcastEval(c => {
    const mapStatus = (statusCode) => {
      const states = {
        0: 'ready',
        1: 'connecting',
        2: 'reconnecting',
        3: 'idle',
        4: 'nearly',
        5: 'disconnected',
        6: 'waiting_for_guilds',
      };
      return states[statusCode] ?? 'unknown';
    };

    const shardStates = [...c.ws.shards.values()].map(shard => ({
      shardId: shard.id,
      state: mapStatus(shard.status),
      statusCode: shard.status,
      ping: typeof shard.ping === 'number' ? shard.ping : c.ws.ping,
      ready: shard.status === 0,
      sequence: shard.sequence ?? null,
    }));

    return {
      clusterId: c.cluster?.id ?? 0,
      shards: c.cluster?.info?.SHARD_LIST ?? [],
      shardCount: shardStates.length,
      shardStates,
      guilds: c.guilds.cache.size,
      users: c.users.cache.size,
      channels: c.channels.cache.size,
      ping: c.ws.ping,
      uptime: c.uptime,
      ready: c.isReady(),
      wsStatus: c.ws.status,
      wsStatusLabel: mapStatus(c.ws.status),
      memoryMB: Math.round(process.memoryUsage().rss / 1024 / 1024),
      timestamp: new Date().toISOString(),
    };
  });
}

async function collectStats(mgr) {
  const results = await collectClusterBreakdown(mgr);

  const totalGuilds = results.reduce((a, r) => a + (r.guilds ?? 0), 0);
  const totalUsers  = results.reduce((a, r) => a + (r.users ?? 0), 0);
  const avgPingMs   = results.length
    ? Math.round(results.reduce((a, r) => a + (r.ping ?? 0), 0) / results.length)
    : -1;
  const totalShards = results.reduce((a, r) => a + (r.shardCount ?? 0), 0);
  const readyClusters = results.filter(r => r.ready).length;
  const readyShards = results.reduce((a, r) => a + r.shardStates.filter(shard => shard.ready).length, 0);

  return {
    clusterCount: mgr.clusters.size,
    readyClusters,
    totalShards,
    readyShards,
    totalGuilds,
    totalUsers,
    avgPingMs,
    memoryMB: +(process.memoryUsage().heapUsed / 1024 / 1024).toFixed(1),
    perCluster: results,
  };
}

async function syncClusterStatusToFirebase(mgr, stats = null) {
  const snapshot = stats ?? await collectStats(mgr);
  const nowIso = new Date().toISOString();
  const expiresAtIso = new Date(Date.now() + Math.max(5_000, STATUS_TTL_MS)).toISOString();
  const maintenance = getMaintenanceState();

  lastSnapshot = snapshot;

  await Promise.all(snapshot.perCluster.map(async cluster => {
    await firebase.setDoc(firebase.clusterRef(cluster.clusterId), {
      clusterId: cluster.clusterId,
      state: cluster.ready ? 'ready' : 'degraded',
      ready: cluster.ready,
      processState: cluster.ready ? 'online' : 'degraded',
      shards: cluster.shards,
      shardCount: cluster.shardCount,
      shardStates: cluster.shardStates,
      guilds: cluster.guilds,
      users: cluster.users,
      channels: cluster.channels,
      ping: cluster.ping,
      uptime: cluster.uptime,
      wsStatus: cluster.wsStatus,
      wsStatusLabel: cluster.wsStatusLabel,
      memoryMB: cluster.memoryMB,
      lastHeartbeatAt: nowIso,
      expiresAt: expiresAtIso,
    });

    await Promise.all(cluster.shardStates.map(shard =>
      firebase.setDoc(firebase.shardRef(shard.shardId), {
        shardId: shard.shardId,
        clusterId: cluster.clusterId,
        state: shard.state,
        statusCode: shard.statusCode,
        ready: shard.ready,
        ping: shard.ping,
        sequence: shard.sequence,
        guilds: cluster.guilds,
        users: cluster.users,
        channels: cluster.channels,
        lastHeartbeatAt: nowIso,
        expiresAt: expiresAtIso,
      })
    ));
  }));

  await firebase.setDoc(firebase.systemRef('clusterStatus'), {
    state: maintenance.enabled ? 'maintenance' : 'running',
    managerPid: process.pid,
    host: os.hostname(),
    clusterCount: snapshot.clusterCount,
    readyClusters: snapshot.readyClusters,
    totalShards: snapshot.totalShards,
    readyShards: snapshot.readyShards,
    totalGuilds: snapshot.totalGuilds,
    totalUsers: snapshot.totalUsers,
    avgPingMs: snapshot.avgPingMs,
    memoryMB: snapshot.memoryMB,
    maintenance,
    lastSnapshotAt: nowIso,
    expiresAt: expiresAtIso,
  });

  // Also write a local JSON file for external tooling (no remote hosting).
  writeStatusJsonFile({
    online: true,
    stale: false,
    state: maintenance.enabled ? 'maintenance' : 'running',
    ts: nowIso,
    expiresAt: expiresAtIso,
    lastSnapshotAt: nowIso,
    maintenance,
    clusters: { total: snapshot.clusterCount, ready: snapshot.readyClusters },
    shards: { total: snapshot.totalShards, ready: snapshot.readyShards },
    source: 'local',
  });
}

async function writeClusterLifecycleStatus(clusterId, updates) {
  try {
    await firebase.setDoc(firebase.clusterRef(clusterId), {
      clusterId,
      ...updates,
      maintenance: getMaintenanceState(),
    });
  } catch (err) {
    logger.warn(`[Manager] Failed to write lifecycle status for cluster #${clusterId}: ${err.message}`);
  }
}

async function markSystemStopped(extra = {}) {
  const nowIso = new Date().toISOString();
  const expiresAtIso = nowIso;
  const maintenance = getMaintenanceState();

  // Don't let shutdown hang forever if Firestore/network is unhappy.
  const withTimeout = (p, ms) => Promise.race([
    p,
    new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms).unref?.()),
  ]);

  try {
    const writes = [];

    // Mark clusters + shards as stopped using last known snapshot.
    const perCluster = lastSnapshot?.perCluster ?? [];
    for (const cluster of perCluster) {
      writes.push(firebase.setDoc(firebase.clusterRef(cluster.clusterId), {
        clusterId: cluster.clusterId,
        state: 'stopped',
        ready: false,
        processState: 'stopped',
        shards: cluster.shards ?? [],
        shardCount: cluster.shardCount ?? 0,
        shardStates: (cluster.shardStates ?? []).map(s => ({
          ...s,
          state: 'stopped',
          ready: false,
        })),
        guilds: cluster.guilds ?? 0,
        users: cluster.users ?? 0,
        channels: cluster.channels ?? 0,
        ping: cluster.ping ?? -1,
        uptime: cluster.uptime ?? 0,
        wsStatus: cluster.wsStatus ?? null,
        wsStatusLabel: 'stopped',
        memoryMB: cluster.memoryMB ?? null,
        lastEventAt: nowIso,
        lastHeartbeatAt: nowIso,
        expiresAt: expiresAtIso,
      }));

      for (const shard of (cluster.shardStates ?? [])) {
        writes.push(firebase.setDoc(firebase.shardRef(shard.shardId), {
          shardId: shard.shardId,
          clusterId: cluster.clusterId,
          state: 'stopped',
          statusCode: shard.statusCode ?? null,
          ready: false,
          ping: shard.ping ?? -1,
          sequence: shard.sequence ?? null,
          lastHeartbeatAt: nowIso,
          expiresAt: expiresAtIso,
        }));
      }
    }

    // Always update the main system status doc.
    writes.push(firebase.setDoc(firebase.systemRef('clusterStatus'), {
      state: maintenance.enabled ? 'maintenance' : 'stopped',
      managerPid: process.pid,
      host: os.hostname(),
      maintenance,
      stoppedAt: nowIso,
      lastSnapshotAt: nowIso,
      expiresAt: expiresAtIso,
      ...extra,
    }));

    await withTimeout(Promise.allSettled(writes), 4000).catch(() => {});
  } catch (err) {
    logger.warn(`[Manager] Failed to mark system stopped: ${err.message}`);
  }

  writeStatusJsonFile({
    online: false,
    stale: true,
    state: maintenance.enabled ? 'maintenance' : 'stopped',
    ts: nowIso,
    expiresAt: expiresAtIso,
    lastSnapshotAt: nowIso,
    maintenance,
    ...extra,
    source: 'local',
  });
}

function writeStatusJsonFile(payload) {
  try {
    fs.mkdirSync(path.dirname(STATUSJSON_PATH), { recursive: true });
    fs.writeFileSync(STATUSJSON_PATH, JSON.stringify(payload, null, 2), 'utf8');
  } catch (err) {
    logger.warn(`[Manager] Failed to write statusjson file: ${err.message}`);
  }
}

function getMaintenanceState() {
  return {
    enabled: process.env.MAINTENANCE_MODE === 'true',
    message: process.env.MAINTENANCE_MESSAGE ?? 'Scheduled maintenance is active.',
    startedAt: process.env.MAINTENANCE_STARTED_AT ?? null,
    estimatedEndAt: process.env.MAINTENANCE_ENDS_AT ?? null,
  };
}

async function resolveTotalShards() {
  if (TOTAL_SHARDS !== 'auto' && typeof TOTAL_SHARDS === 'number' && !Number.isNaN(TOTAL_SHARDS)) {
    return TOTAL_SHARDS;
  }
  // Use discord-hybrid-sharding util so behavior matches its built-in spawn().
  return Math.max(1, Math.floor(await fetchRecommendedShards(process.env.DISCORD_TOKEN, 1000)));
}

async function spawnClustersParallel(totalShards) {
  const shardList = Array.from(Array(totalShards).keys());
  const shardClusterList = chunkArray(shardList, SHARDS_PER_CLUSTER);

  // Keep manager internals consistent for /clusters + broadcastEval mapping.
  manager.totalShards = totalShards;
  manager.shardList = shardList;
  manager.shardClusterList = shardClusterList;
  manager.totalClusters = shardClusterList.length;

  const concurrency = Math.max(1, CLUSTER_SPAWN_CONCURRENCY || 1);
  let spawned = 0;
  let failed = 0;

  for (let i = 0; i < shardClusterList.length; i += concurrency) {
    const batch = shardClusterList.slice(i, i + concurrency);
    await Promise.all(batch.map(async (shardsToSpawn, offset) => {
      const clusterId = i + offset;
      const cluster = manager.createCluster(clusterId, shardsToSpawn, totalShards);

      try {
        // Default: don't block manager startup waiting for READY.
        // Some hosts start slowly enough that READY timeouts kill the manager
        // even though the child process is healthy and will connect moments later.
        // We only wait if explicitly requested and clamp the timeout safely.
        const spawnTimeout = CLUSTER_WAIT_READY_ON_SPAWN
          ? Math.max(
            30_000,
            CLUSTER_READY_TIMEOUT_BASE_MS + (CLUSTER_READY_TIMEOUT_PER_SHARD_MS * (shardsToSpawn?.length ?? 1))
          )
          : -1;

        await cluster.spawn(spawnTimeout);
        spawned += 1;
      } catch (err) {
        failed += 1;
        logger.error(`[Manager] Cluster #${clusterId} spawn failed: ${err.message}`);
        await writeClusterLifecycleStatus(clusterId, {
          state: 'error',
          ready: false,
          processState: 'error',
          error: err.message,
          lastEventAt: new Date().toISOString(),
        }).catch(() => {});
      }
    }));
    if (CLUSTER_SPAWN_BATCH_DELAY_MS > 0) {
      await new Promise(res => setTimeout(res, CLUSTER_SPAWN_BATCH_DELAY_MS));
    }
  }

  return { spawned, failed };
}

async function ensureClusterRespawn(cluster, reason = 'unknown') {
  if (!cluster || respawningClusters.has(cluster.id)) return;

  respawningClusters.add(cluster.id);
  const nowIso = new Date().toISOString();

  try {
    logger.warn(`[Manager] Respawning cluster #${cluster.id} after ${reason}`);
    await writeClusterLifecycleStatus(cluster.id, {
      state: 'respawning',
      ready: false,
      processState: 'respawning',
      pid: cluster.process?.pid ?? cluster.thread?.process?.pid ?? null,
      lastEventAt: nowIso,
      respawnReason: reason,
    });

    await cluster.respawn({
      delay: Math.max(0, CLUSTER_RESPAWN_DELAY_MS),
      timeout: CLUSTER_RESPAWN_TIMEOUT_MS,
    });

    await writeClusterLifecycleStatus(cluster.id, {
      state: 'spawning',
      ready: false,
      processState: 'starting',
      pid: cluster.process?.pid ?? cluster.thread?.process?.pid ?? null,
      lastEventAt: new Date().toISOString(),
      respawnReason: null,
    });
  } catch (err) {
    logger.error(`[Manager] Failed to respawn cluster #${cluster.id}: ${err.message}`);
    await writeClusterLifecycleStatus(cluster.id, {
      state: 'error',
      ready: false,
      processState: 'respawn_failed',
      error: err.message,
      lastEventAt: new Date().toISOString(),
      respawnReason: reason,
    }).catch(() => {});
  } finally {
    respawningClusters.delete(cluster.id);
  }
}

function fmtMemory() {
  const m = process.memoryUsage();
  return {
    heapUsedMB: +(m.heapUsed / 1024 / 1024).toFixed(1),
    heapTotalMB: +(m.heapTotal / 1024 / 1024).toFixed(1),
    rssMB: +(m.rss / 1024 / 1024).toFixed(1),
  };
}
