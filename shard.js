/**
 * shard.js - OnboardX V2 Cluster + Shard Manager
 */

'use strict';

require('dotenv').config();

const path   = require('path');
const fs     = require('fs');
const http   = require('http');
const os     = require('os');
const { ClusterManager } = require('discord-hybrid-sharding');
const logger   = require('./utils/logger');
const firebase = require('./database/firebase');

const TOTAL_SHARDS       = process.env.TOTAL_SHARDS ? parseInt(process.env.TOTAL_SHARDS, 10) : 'auto';
const SHARDS_PER_CLUSTER = parseInt(process.env.SHARDS_PER_CLUSTER ?? '4', 10);
const CLUSTER_COUNT      = process.env.CLUSTER_COUNT ? parseInt(process.env.CLUSTER_COUNT, 10) : 'auto';
const SHARD_DELAY_MS     = parseInt(process.env.SHARD_DELAY_MS ?? '5500', 10);
const HEALTH_PORT        = parseInt(process.env.HEALTH_PORT ?? '9090', 10);
const STATUS_SYNC_MS     = parseInt(process.env.CLUSTER_STATUS_SYNC_MS ?? '30000', 10);
const STATUS_HTML_PATH   = path.join(__dirname, 'monitoring', 'status.html');
const HTTP_HOST          = process.env.STATUS_BIND_HOST ?? '0.0.0.0';

const manager = new ClusterManager(path.join(__dirname, 'index.js'), {
  totalShards: TOTAL_SHARDS,
  shardsPerClusters: SHARDS_PER_CLUSTER,
  totalClusters: CLUSTER_COUNT,
  mode: 'process',
  token: process.env.DISCORD_TOKEN,
  respawn: true,
  execArgv: process.execArgv,
});

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

    await manager.spawn({ timeout: 30_000, delay: SHARD_DELAY_MS });

    logger.info(`[Manager] All ${manager.clusters.size} cluster(s) spawned successfully`);
    await syncClusterStatusToFirebase(manager);

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
    await safeWriteManagerStatus('fatal', { error: err.message });
    process.exit(1);
  }
})();

const server = http.createServer(async (req, res) => {
  const url = req.url?.split('?')[0] ?? '/';

  if (url === '/' || url === '/status') {
    return serveStatusPage(res);
  }

  if (url === '/health') {
    const healthy = manager.clusters.size > 0 &&
      [...manager.clusters.values()].some(c => c.ready);
    const maintenance = getMaintenanceState();
    const status = maintenance.enabled ? 'maintenance' : (healthy ? 'ok' : 'degraded');

    res.writeHead(healthy ? 200 : 503, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({
      status,
      maintenance,
      pid: process.pid,
      uptimeSecs: Math.floor(process.uptime()),
      clusters: manager.clusters.size,
      ts: new Date().toISOString(),
    }));
  }

  if (url === '/metrics') {
    let stats = {};
    try {
      stats = await collectStats(manager);
    } catch { /* ignore */ }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({
      pid: process.pid,
      uptimeSecs: Math.floor(process.uptime()),
      memory: fmtMemory(),
      node: process.version,
      platform: process.platform,
      cpuCores: os.cpus().length,
      maintenance: getMaintenanceState(),
      ...stats,
      ts: new Date().toISOString(),
    }, null, 2));
  }

  if (url === '/clusters') {
    let perCluster = [];
    try {
      perCluster = await collectClusterBreakdown(manager);
    } catch { /* ignore */ }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify(perCluster, null, 2));
  }

  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Available: /status  /health  /metrics  /clusters');
});

server.listen(HEALTH_PORT, HTTP_HOST, () => {
  logger.info(`[Manager] Health: http://${HTTP_HOST}:${HEALTH_PORT}/health | Status: http://${HTTP_HOST}:${HEALTH_PORT}/status`);
});

server.on('error', err => {
  if (err.code === 'EADDRINUSE') {
    logger.warn(`[Manager] Port ${HEALTH_PORT} in use - health server skipped`);
  } else {
    logger.error('[Manager] Health server error:', err);
  }
});

const shutdown = async (sig) => {
  logger.info(`[Manager] ${sig} received - shutting down clusters`);
  await safeWriteManagerStatus('shutting_down', { signal: sig });
  try {
    await manager.broadcastEval(c => c.destroy()).catch(() => {});
  } catch { /* ignore */ }
  server.close();
  process.exit(0);
};

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('unhandledRejection', r => logger.error('[Manager] Unhandled rejection:', r));
process.on('uncaughtException', async err => {
  logger.error('[Manager] Uncaught exception:', err);
  await safeWriteManagerStatus('uncaught_exception', { error: err.message });
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
  const maintenance = getMaintenanceState();

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

async function safeWriteManagerStatus(state, extra = {}) {
  try {
    await firebase.setDoc(firebase.systemRef('clusterStatus'), {
      state,
      managerPid: process.pid,
      host: os.hostname(),
      maintenance: getMaintenanceState(),
      lastSnapshotAt: new Date().toISOString(),
      ...extra,
    });
  } catch (err) {
    logger.warn(`[Manager] Failed to write manager status: ${err.message}`);
  }
}

function serveStatusPage(res) {
  try {
    const html = fs.readFileSync(STATUS_HTML_PATH, 'utf8');
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
  } catch (err) {
    logger.error('[Manager] Could not serve status page:', err);
    res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Status page not found.');
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

function fmtMemory() {
  const m = process.memoryUsage();
  return {
    heapUsedMB: +(m.heapUsed / 1024 / 1024).toFixed(1),
    heapTotalMB: +(m.heapTotal / 1024 / 1024).toFixed(1),
    rssMB: +(m.rss / 1024 / 1024).toFixed(1),
  };
}
