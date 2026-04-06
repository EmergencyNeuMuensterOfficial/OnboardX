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
const { chunkArray, fetchRecommendedShards } = require('discord-hybrid-sharding/dist/Util/Util');
const logger   = require('./utils/logger');
const firebase = require('./database/firebase');

const TOTAL_SHARDS       = process.env.TOTAL_SHARDS ? parseInt(process.env.TOTAL_SHARDS, 10) : 'auto';
const SHARDS_PER_CLUSTER = parseInt(process.env.SHARDS_PER_CLUSTER ?? '4', 10);
const CLUSTER_COUNT      = process.env.CLUSTER_COUNT ? parseInt(process.env.CLUSTER_COUNT, 10) : 'auto';
// Cluster spawn parallelism. Shard identify speed is still bounded by Discord session-start limits.
const CLUSTER_SPAWN_CONCURRENCY = parseInt(process.env.CLUSTER_SPAWN_CONCURRENCY ?? '3', 10);
const CLUSTER_SPAWN_BATCH_DELAY_MS = parseInt(process.env.CLUSTER_SPAWN_BATCH_DELAY_MS ?? '250', 10);
const CLUSTER_READY_TIMEOUT_MS = parseInt(process.env.CLUSTER_READY_TIMEOUT_MS ?? '120000', 10);
const HEALTH_PORT        = parseInt(process.env.HEALTH_PORT ?? '9090', 10);
const STATUS_SYNC_MS     = parseInt(process.env.CLUSTER_STATUS_SYNC_MS ?? '30000', 10);
const STATUS_HTML_PATH   = path.join(__dirname, 'monitoring', 'status.html');
const STATUS_FIREBASE_HTML_PATH = path.join(__dirname, 'monitoring', 'status-firebase.html');
const DASHBOARD_SYSTEM_HTML_PATH = path.join(__dirname, 'monitoring', 'dashboard-system.html');
const DASHBOARD_ADMIN_HTML_PATH  = path.join(__dirname, 'monitoring', 'dashboard-admin.html');
const HTTP_HOST          = process.env.STATUS_BIND_HOST ?? '0.0.0.0';
// If the manager crashes hard, no shutdown hook runs. This TTL lets UIs mark status as offline when stale.
const STATUS_TTL_MS      = parseInt(process.env.CLUSTER_STATUS_TTL_MS ?? String(STATUS_SYNC_MS * 3), 10);
const DASHBOARD_ADMIN_UIDS = (process.env.DASHBOARD_ADMIN_UIDS ?? '').split(',').map(s => s.trim()).filter(Boolean);
const DASHBOARD_ADMIN_EMAILS = (process.env.DASHBOARD_ADMIN_EMAILS ?? '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);

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

    const totalShards = await resolveTotalShards();
    await spawnClustersParallel(totalShards);

    logger.info(`[Manager] All ${manager.clusters.size} cluster(s) spawned successfully`);
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

const server = http.createServer(async (req, res) => {
  const url = req.url?.split('?')[0] ?? '/';

  if (url === '/' || url === '/status') {
    return serveStatusPage(res);
  }
  if (url === '/status/firebase') {
    return serveStatusFirebasePage(res);
  }
  if (url === '/dashboard' || url === '/dashboard/system') {
    return serveFile(res, DASHBOARD_SYSTEM_HTML_PATH, 'system dashboard');
  }
  if (url === '/dashboard/admin') {
    return serveFile(res, DASHBOARD_ADMIN_HTML_PATH, 'admin dashboard');
  }

  if (url === '/api/system/status') {
    return handleApiSystemStatus(req, res);
  }
  if (url === '/api/guilds') {
    return handleApiGuilds(req, res);
  }
  if (url.startsWith('/api/guilds/') && url.endsWith('/config')) {
    const parts = url.split('/').filter(Boolean); // api guilds :id config
    const guildId = parts[2];
    return handleApiGuildConfig(req, res, guildId);
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
  res.end('Available: /status  /status/firebase  /dashboard  /dashboard/admin  /health  /metrics  /clusters');
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
  await markSystemStopped({ reason: 'signal', signal: sig });
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
}

function serveStatusPage(res) {
  return serveFile(res, STATUS_HTML_PATH, 'status page');
}

function serveStatusFirebasePage(res) {
  return serveFile(res, STATUS_FIREBASE_HTML_PATH, 'firebase status page');
}

function serveFile(res, filePath, label) {
  try {
    const html = fs.readFileSync(filePath, 'utf8');
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
  } catch (err) {
    logger.error(`[Manager] Could not serve ${label}:`, err);
    res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(`${label} not found.`);
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

async function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      if (!body) return resolve({});
      try { resolve(JSON.parse(body)); } catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}

function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data, null, 2));
}

function getBearerToken(req) {
  const header = req.headers['authorization'] || req.headers['Authorization'];
  if (!header || typeof header !== 'string') return null;
  const m = header.match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : null;
}

async function requireFirebaseAuth(req, res) {
  const token = getBearerToken(req);
  if (!token) {
    sendJson(res, 401, { error: 'missing_token' });
    return null;
  }
  try {
    const decoded = await firebase.admin.auth().verifyIdToken(token);
    return decoded;
  } catch (err) {
    sendJson(res, 401, { error: 'invalid_token', message: err.message });
    return null;
  }
}

function isDashboardAdmin(decodedToken) {
  if (!decodedToken) return false;
  if (DASHBOARD_ADMIN_UIDS.includes(decodedToken.uid)) return true;
  const email = (decodedToken.email || '').toLowerCase();
  if (email && DASHBOARD_ADMIN_EMAILS.includes(email)) return true;
  return false;
}

async function handleApiSystemStatus(req, res) {
  const decoded = await requireFirebaseAuth(req, res);
  if (!decoded) return;

  try {
    const system = await firebase.getDoc(firebase.systemRef('clusterStatus'));
    const clustersSnap = await firebase.systemRef('clusterStatus').collection('clusters').get();
    const shardsSnap = await firebase.systemRef('clusterStatus').collection('shards').get();
    const clusters = clustersSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    const shards = shardsSnap.docs.map(d => ({ id: d.id, ...d.data() }));

    sendJson(res, 200, { system, clusters, shards, ts: new Date().toISOString() });
  } catch (err) {
    sendJson(res, 500, { error: 'system_status_failed', message: err.message });
  }
}

async function handleApiGuilds(req, res) {
  const decoded = await requireFirebaseAuth(req, res);
  if (!decoded) return;
  if (!isDashboardAdmin(decoded)) {
    sendJson(res, 403, { error: 'forbidden' });
    return;
  }

  try {
    const results = await manager.broadcastEval(c => {
      return [...c.guilds.cache.values()].map(g => ({
        id: g.id,
        name: g.name,
        memberCount: g.memberCount,
        iconURL: g.iconURL({ size: 64 }),
      }));
    });
    const all = results.flat();
    // De-dupe by guildId (each guild exists on exactly one shard, but be safe).
    const map = new Map();
    for (const g of all) {
      if (!map.has(g.id)) map.set(g.id, g);
    }
    sendJson(res, 200, { guilds: [...map.values()].sort((a, b) => a.name.localeCompare(b.name)) });
  } catch (err) {
    sendJson(res, 500, { error: 'guild_list_failed', message: err.message });
  }
}

async function handleApiGuildConfig(req, res, guildId) {
  const decoded = await requireFirebaseAuth(req, res);
  if (!decoded) return;
  if (!isDashboardAdmin(decoded)) {
    sendJson(res, 403, { error: 'forbidden' });
    return;
  }
  if (!guildId) {
    sendJson(res, 400, { error: 'missing_guild_id' });
    return;
  }

  try {
    if (req.method === 'GET') {
      const cfg = await firebase.getDoc(firebase.guildRef(guildId));
      return sendJson(res, 200, { guildId, config: cfg });
    }

    if (req.method === 'POST') {
      const body = await readJson(req).catch(() => null);
      if (!body || typeof body !== 'object') {
        return sendJson(res, 400, { error: 'invalid_json' });
      }
      const updates = body.updates;
      if (!updates || typeof updates !== 'object') {
        return sendJson(res, 400, { error: 'missing_updates' });
      }
      // Use the existing GuildConfig model semantics (dot-notation updates).
      const GuildConfig = require('./models/GuildConfig');
      await GuildConfig.update(guildId, updates);
      const cfg = await firebase.getDoc(firebase.guildRef(guildId));
      return sendJson(res, 200, { ok: true, guildId, config: cfg });
    }

    return sendJson(res, 405, { error: 'method_not_allowed' });
  } catch (err) {
    sendJson(res, 500, { error: 'guild_config_failed', message: err.message });
  }
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
  for (let i = 0; i < shardClusterList.length; i += concurrency) {
    const batch = shardClusterList.slice(i, i + concurrency);
    await Promise.all(batch.map((shardsToSpawn, offset) => {
      const clusterId = i + offset;
      const cluster = manager.createCluster(clusterId, shardsToSpawn, totalShards);
      return cluster.spawn(CLUSTER_READY_TIMEOUT_MS);
    }));
    if (CLUSTER_SPAWN_BATCH_DELAY_MS > 0) {
      await new Promise(res => setTimeout(res, CLUSTER_SPAWN_BATCH_DELAY_MS));
    }
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
