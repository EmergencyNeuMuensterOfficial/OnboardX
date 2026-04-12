/**
 * api.js
 * Lightweight monitoring API for MongoDB-backed system status data.
 */

'use strict';

require('dotenv').config();

const http = require('http');
const url = require('url');
const logger = require('./utils/logger');
const db = require('./database/firebase');

const API_HOST = process.env.API_HOST ?? '0.0.0.0';
const API_PORT = parseInt(process.env.API_PORT ?? '8080', 10);
const API_ALLOWED_ORIGIN = process.env.API_ALLOWED_ORIGIN ?? '*';
const DASHBOARD_TOKEN = process.env.DASHBOARD_TOKEN ?? '';

function sendJson(res, statusCode, payload, extraHeaders = {}) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': API_ALLOWED_ORIGIN,
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    ...extraHeaders,
  });
  res.end(JSON.stringify(payload, null, 2));
}

function sendText(res, statusCode, body) {
  res.writeHead(statusCode, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Access-Control-Allow-Origin': API_ALLOWED_ORIGIN,
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
  });
  res.end(body);
}

function requireToken(req, res) {
  if (!DASHBOARD_TOKEN) return true;

  const auth = req.headers.authorization ?? '';
  const expected = `Bearer ${DASHBOARD_TOKEN}`;
  if (auth === expected) return true;

  sendJson(res, 401, {
    ok: false,
    error: 'unauthorized',
    message: 'Missing or invalid bearer token.',
  });
  return false;
}

function parseDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function isExpired(expiresAt) {
  const date = parseDate(expiresAt);
  return Boolean(date && date.getTime() <= Date.now());
}

function normalizeSystemStatus(doc) {
  const stale = isExpired(doc?.expiresAt);
  const maintenanceEnabled = doc?.maintenance?.enabled === true;
  const online = !stale && doc?.state !== 'stopped' && doc?.state !== 'offline';

  return {
    ...doc,
    stale,
    online,
    state: stale ? 'offline' : (online ? doc?.state ?? 'running' : 'offline'),
    discordGateway: doc?.discordGateway ?? {
      clusters: {},
      shards: {},
      avgPingMs: -1,
      reconnectingClusters: 0,
      disconnectedClusters: 0,
      reconnectingShards: 0,
      disconnectedShards: 0,
      readyShards: 0,
      totalShards: doc?.totalShards ?? 0,
    },
    maintenance: doc?.maintenance ?? {
      enabled: maintenanceEnabled,
      message: maintenanceEnabled ? 'Scheduled maintenance is active.' : null,
      startedAt: null,
      estimatedEndAt: null,
    },
  };
}

function normalizeClusterStatus(doc) {
  const stale = isExpired(doc?.expiresAt);
  return {
    ...doc,
    stale,
    online: !stale && doc?.state !== 'stopped' && doc?.state !== 'offline',
    state: stale ? 'offline' : (doc?.state ?? 'unknown'),
    ready: stale ? false : doc?.ready === true,
    processState: stale ? 'offline' : (doc?.processState ?? 'unknown'),
    wsStatusLabel: stale ? 'offline' : (doc?.wsStatusLabel ?? 'unknown'),
  };
}

function normalizeShardStatus(doc) {
  const stale = isExpired(doc?.expiresAt);
  return {
    ...doc,
    stale,
    online: !stale && doc?.state !== 'stopped' && doc?.state !== 'offline',
    state: stale ? 'offline' : (doc?.state ?? 'unknown'),
    ready: stale ? false : doc?.ready === true,
    statusCode: stale ? null : (doc?.statusCode ?? null),
  };
}

async function handleSystemStatus(res) {
  const doc = await db.getDoc(db.systemRef('clusterStatus'));
  const normalized = normalizeSystemStatus(doc ?? {
    id: 'clusterStatus',
    state: 'offline',
    online: false,
    stale: true,
  });

  sendJson(res, 200, normalized);
}

async function handleSystemClusters(res) {
  const rows = await db.getCollection(db.COLLECTIONS.clusterStatuses)
    .find({})
    .sort({ clusterId: 1 })
    .toArray();

  sendJson(res, 200, rows.map(normalizeClusterStatus));
}

async function handleSystemShards(res) {
  const rows = await db.getCollection(db.COLLECTIONS.shardStatuses)
    .find({})
    .sort({ shardId: 1 })
    .toArray();

  sendJson(res, 200, rows.map(normalizeShardStatus));
}

async function handleIncidents(res) {
  sendJson(res, 200, []);
}

async function start() {
  await db.init();

  const server = http.createServer(async (req, res) => {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': API_ALLOWED_ORIGIN,
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
      });
      res.end();
      return;
    }

    if (!requireToken(req, res)) return;

    const parsed = url.parse(req.url, true);
    const pathname = parsed.pathname ?? '/';

    try {
      if (pathname === '/' || pathname === '/health') {
        sendJson(res, 200, {
          ok: true,
          service: 'onboardx-status-api',
          now: new Date().toISOString(),
        });
        return;
      }

      if (pathname === '/system/status') {
        await handleSystemStatus(res);
        return;
      }

      if (pathname === '/system/clusters') {
        await handleSystemClusters(res);
        return;
      }

      if (pathname === '/system/shards') {
        await handleSystemShards(res);
        return;
      }

      if (pathname === '/system/incidents') {
        await handleIncidents(res);
        return;
      }

      sendText(res, 404, 'Not found');
    } catch (error) {
      logger.error(`[API] ${pathname} failed: ${error.stack || error.message}`);
      sendJson(res, 500, {
        ok: false,
        error: 'internal_error',
        message: error.message,
      });
    }
  });

  server.listen(API_PORT, API_HOST, () => {
    logger.info(`[API] Listening on http://${API_HOST}:${API_PORT}`);
  });
}

start().catch(error => {
  logger.error('[API] Failed to start:', error);
  process.exit(1);
});
