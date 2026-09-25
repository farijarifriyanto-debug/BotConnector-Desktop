const http = require('node:http');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { URL } = require('node:url');
const { WebSocketServer } = require('ws');
const { DeviceRelay } = require('./device-relay.cjs');

const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_PORT = 18443;
const DEFAULT_APP_ORIGIN = 'https://app.botconnector.id';
const MAX_BODY_BYTES = 256 * 1024;
const INTERNAL_HEADER = 'x-botconnector-device-internal';
const ALLOWED_METHODS = new Set([
  'hardware.get',
  'launcher.list',
  'launcher.start',
  'launcher.stop',
  'tools.list',
  'runtime.status',
  'models.list',
  'models.pull.start',
  'models.pull.status',
  'models.pull.list',
  'models.pull.cancel',
  'models.delete',
  'model.load',
  'model.unload',
  'chat.completions',
]);

function json(res, status, value) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  res.end(JSON.stringify(value));
}

function errorJson(res, status, code, message) {
  return json(res, status, { error: { code, message } });
}

function validUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    String(value || ''),
  );
}

function constantTimeEqual(left, right) {
  const a = Buffer.from(String(left || ''));
  const b = Buffer.from(String(right || ''));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

async function readJson(req, limit = MAX_BODY_BYTES) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) {
      const error = new Error('Payload terlalu besar.');
      error.status = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  if (!size) return {};
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
    return value;
  } catch {
    const error = new Error('Payload JSON tidak valid.');
    error.status = 400;
    throw error;
  }
}

function readTokenFile(filePath) {
  if (!filePath) return '';
  try {
    return fs.readFileSync(filePath, 'utf8').trim();
  } catch {
    return '';
  }
}

function configFrom(options = {}) {
  const internalToken =
    options.internalToken !== undefined
      ? String(options.internalToken || '').trim()
      : String(process.env.BOTCONNECTOR_DEVICE_RELAY_TOKEN || '').trim() ||
        readTokenFile(process.env.BOTCONNECTOR_DEVICE_RELAY_TOKEN_FILE);

  return {
    host: options.host || process.env.BOTCONNECTOR_DEVICE_RELAY_HOST || DEFAULT_HOST,
    port: Number(options.port || process.env.BOTCONNECTOR_DEVICE_RELAY_PORT || DEFAULT_PORT),
    appOrigin: options.appOrigin || process.env.BOTCONNECTOR_DEVICE_APP_ORIGIN || DEFAULT_APP_ORIGIN,
    stateFile:
      options.stateFile !== undefined
        ? String(options.stateFile || '').trim()
        : String(process.env.BOTCONNECTOR_DEVICE_RELAY_STATE_FILE || '').trim(),
    internalToken,
  };
}

function createDeviceRelayServer(options = {}) {
  const config = configFrom(options);
  if (!config.internalToken) {
    throw new Error(
      'BOTCONNECTOR_DEVICE_RELAY_TOKEN or BOTCONNECTOR_DEVICE_RELAY_TOKEN_FILE is required.',
    );
  }

  const relay =
    options.relay ||
    new DeviceRelay({
      appOrigin: config.appOrigin,
      pairTtlMs: options.pairTtlMs,
      requestTimeoutMs: options.requestTimeoutMs,
      stateFile: config.stateFile || null,
    });

  const internalAuthorized = (req) =>
    constantTimeEqual(req.headers[INTERNAL_HEADER], config.internalToken);

  const server = http.createServer(async (req, res) => {
    let url;
    try {
      url = new URL(req.url, 'http://' + (req.headers.host || config.host + ':' + config.port));
    } catch {
      return errorJson(res, 400, 'INVALID_URL', 'URL tidak valid.');
    }

    try {
      if (url.pathname === '/health' && req.method === 'GET') {
        return json(res, 200, { ok: true, service: 'botconnector-device-relay' });
      }

      if (url.pathname === '/api/devices/pair/exchange' && req.method === 'POST') {
        const body = await readJson(req);
        return json(res, 200, relay.exchange(body));
      }

      if (url.pathname.startsWith('/internal/')) {
        if (!internalAuthorized(req)) {
          return errorJson(res, 401, 'INTERNAL_AUTH_REQUIRED', 'Internal relay authentication failed.');
        }

        if (url.pathname === '/internal/pair' && req.method === 'POST') {
          const body = await readJson(req);
          if (!validUuid(body.user_id)) {
            return errorJson(res, 400, 'INVALID_USER_ID', 'BotConnector user id tidak valid.');
          }
          return json(res, 200, relay.createPairCode(body.user_id));
        }

        if (url.pathname === '/internal/devices' && req.method === 'GET') {
          const userId = url.searchParams.get('user_id');
          if (!validUuid(userId)) {
            return errorJson(res, 400, 'INVALID_USER_ID', 'BotConnector user id tidak valid.');
          }
          return json(res, 200, { devices: relay.list(userId) });
        }

        const requestMatch = url.pathname.match(/^\/internal\/devices\/([^/]+)\/request$/);
        if (requestMatch && req.method === 'POST') {
          const body = await readJson(req);
          if (!validUuid(body.user_id)) {
            return errorJson(res, 400, 'INVALID_USER_ID', 'BotConnector user id tidak valid.');
          }
          const method = String(body.method || '');
          if (!ALLOWED_METHODS.has(method)) {
            return errorJson(res, 403, 'DEVICE_METHOD_NOT_ALLOWED', 'Device method is not allowed.');
          }
          const result = await relay.request(
            body.user_id,
            decodeURIComponent(requestMatch[1]),
            method,
            body.params || {},
          );
          return json(res, 200, { result });
        }

        const revokeMatch = url.pathname.match(/^\/internal\/devices\/([^/]+)\/revoke$/);
        if (revokeMatch && req.method === 'POST') {
          const body = await readJson(req);
          if (!validUuid(body.user_id)) {
            return errorJson(res, 400, 'INVALID_USER_ID', 'BotConnector user id tidak valid.');
          }
          const removed = relay.revoke(body.user_id, decodeURIComponent(revokeMatch[1]));
          if (!removed) {
            return errorJson(res, 404, 'DEVICE_NOT_FOUND', 'Perangkat tidak ditemukan.');
          }
          return json(res, 200, { ok: true });
        }

        return errorJson(res, 404, 'NOT_FOUND', 'Internal relay route tidak ditemukan.');
      }

      return errorJson(res, 404, 'NOT_FOUND', 'Route tidak ditemukan.');
    } catch (error) {
      const status = Number.isInteger(error?.status) ? error.status : 400;
      const code =
        status === 401
          ? 'PAIRING_FAILED'
          : status === 409
            ? 'DEVICE_OFFLINE'
            : status === 504
              ? 'DEVICE_TIMEOUT'
              : 'DEVICE_RELAY_FAILED';
      return errorJson(res, status, code, error?.message || 'Device relay request failed.');
    }
  });

  relay.attach(server, WebSocketServer);
  server.on('close', () => relay.close());
  server.keepAliveTimeout = 5000;
  server.headersTimeout = 10_000;

  return { server, relay, config };
}

if (require.main === module) {
  const { server, config } = createDeviceRelayServer();
  server.listen(config.port, config.host, () => {
    console.log('BotConnector Device Relay: http://' + config.host + ':' + config.port);
  });
}

module.exports = {
  createDeviceRelayServer,
  configFrom,
  constantTimeEqual,
  validUuid,
  ALLOWED_METHODS,
  DEFAULT_HOST,
  DEFAULT_PORT,
};
