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
// Owner decision: at most 2 concurrent agent streams per account, ~20 in total on the VPS.
const AGENT_STREAM_PER_ACCOUNT = 2;
const AGENT_STREAM_GLOBAL = 20;
// Ceiling for queued SSE bytes before the stream is cut instead of growing the relay's memory.
const AGENT_STREAM_BACKLOG_LIMIT = 32 * 1024 * 1024;
// Closed set of agent error codes the relay is allowed to surface (the device may not invent codes).
const AGENT_ERROR_CODES = new Set([
  'agent_runtime_missing',
  'agent_not_configured',
  'agent_unsupported',
  'agent_busy',
  'agent_capacity',
]);
const AGENT_METHODS = [
  'agent.capabilities',
  'agent.workspaces',
  'agent.sessions',
  'agent.session',
  'agent.start',
  'agent.prompt',
  'agent.approve',
  'agent.cancel',
  'agent.stream',
];
const ALLOWED_METHODS = new Set([
  'hardware.get',
  'launcher.list',
  'launcher.start',
  'launcher.stop',
  'tools.list',
  'runtime.status',
  'runtime.start',
  'runtime.stop',
  'runtime.install.start',
  'runtime.install.status',
  'runtime.install.list',
  'models.list',
  'models.pull.start',
  'models.pull.status',
  'models.pull.list',
  'models.pull.cancel',
  'models.delete',
  'model.load',
  'model.unload',
  'chat.completions',
  'chat.cancel',
  ...AGENT_METHODS,
]);

// Methods that may be streamed as SSE. Keep this list method-agnostic: the relay does not
// know what an agent session is, it only knows which calls produce an event stream.
const STREAMABLE_METHODS = new Set(['chat.completions', 'agent.stream']);
// agent.stream only makes sense on the streaming route; on the one-shot route it would
// never produce a body and would leave a pending entry behind.
const STREAM_ONLY_METHODS = new Set(['agent.stream']);

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

  // Capacity counters for agent streams (owner decision: 2 per account, ~20 in total).
  const agentStreamPerAccount = Number.isInteger(options.agentStreamPerAccount)
    ? options.agentStreamPerAccount
    : AGENT_STREAM_PER_ACCOUNT;
  const agentStreamGlobal = Number.isInteger(options.agentStreamGlobal)
    ? options.agentStreamGlobal
    : AGENT_STREAM_GLOBAL;
  const agentStreams = new Map();
  // The per-account map is the single source of truth; the global total is derived from it so
  // it can never drift out of sync with the per-account counters.
  const agentStreamTotal = () => {
    let total = 0;
    for (const count of agentStreams.values()) total += count;
    return total;
  };

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

  const handler = async (req, res) => {
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

        const streamMatch = url.pathname.match(/^\/internal\/devices\/([^/]+)\/stream$/);
        if (streamMatch && req.method === 'POST') {
          const body = await readJson(req);
          if (!validUuid(body.user_id)) {
            return errorJson(res, 400, 'INVALID_USER_ID', 'BotConnector user id tidak valid.');
          }
          const method = String(body.method || '');
          if (!STREAMABLE_METHODS.has(method) || !ALLOWED_METHODS.has(method)) {
            return errorJson(res, 403, 'DEVICE_METHOD_NOT_ALLOWED', 'Streaming is only available for local chat completions and agent sessions.');
          }

          const userId = body.user_id;
          const isAgentStream = method === 'agent.stream';
          if (isAgentStream) {
            const perAccount = agentStreams.get(userId) || 0;
            if (perAccount >= agentStreamPerAccount || agentStreamTotal() >= agentStreamGlobal) {
              return errorJson(res, 429, 'AGENT_CAPACITY', 'Batas sesi agen aktif tercapai. Tutup sesi lain lalu coba lagi.');
            }
            agentStreams.set(userId, perAccount + 1);
          }
          // Releasing a slot is idempotent: the map value is the only source of truth, so a
          // double release cannot drift the counter and the global cap stays honest.
          const releaseSlot = () => {
            if (!isAgentStream) return;
            const current = agentStreams.get(userId) || 0;
            if (current <= 0) return;
            if (current <= 1) agentStreams.delete(userId);
            else agentStreams.set(userId, current - 1);
          };

          res.writeHead(200, {
            'content-type': 'text/event-stream; charset=utf-8',
            'cache-control': 'no-store',
            'x-content-type-options': 'nosniff',
            connection: 'keep-alive',
          });
          // An agent session can stay silent for minutes: send one comment line immediately so
          // clients and proxies start reading instead of waiting for the first event.
          if (isAgentStream && !res.destroyed && !res.writableEnded) res.write(':\n\n');
          const emit = (payload) => {
            if (res.destroyed || res.writableEnded) return;
            const chunk = 'data: ' + JSON.stringify(payload) + '\n\n';
            // Backpressure: a phone on a slow link must not make the relay buffer an entire
            // session in memory. Count what is still queued; if it grows past the ceiling the
            // stream is cut instead of growing without bound.
            pendingBytes += Buffer.byteLength(chunk);
            if (pendingBytes > AGENT_STREAM_BACKLOG_LIMIT) {
              try { controller.abort(); } catch {}
              return;
            }
            res.write(chunk);
          };
          res.on('drain', () => {
            pendingBytes = 0;
          });
          // The phone dropped the stream: stop the device work and free the capacity slot.
          const controller = new AbortController();
          let pendingBytes = 0;
          res.on('close', () => {
            releaseSlot();
            try { controller.abort(); } catch {}
          });

          try {
            const params = method === 'chat.completions' ? { ...(body.params || {}), stream: true } : { ...(body.params || {}) };
            const result = await relay.request(
              body.user_id,
              decodeURIComponent(streamMatch[1]),
              method,
              params,
              { onEvent: (event) => emit({ event }), signal: controller.signal },
            );
            emit({ done: true, result });
          } catch (error) {
            const code = typeof error?.code === 'string' && AGENT_ERROR_CODES.has(error.code) ? error.code : null;
            if (code) {
              emit({ error: { message: error?.message || 'Agent stream gagal.', code } });
            } else {
              emit({ error: { message: error?.message || 'Device relay stream failed.' } });
            }
          }
          releaseSlot();
          res.end();
          return;
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
          if (STREAM_ONLY_METHODS.has(method)) {
            return errorJson(res, 400, 'DEVICE_METHOD_NOT_ALLOWED', 'Metode ini hanya bisa dipanggil lewat endpoint streaming.');
          }
          const params = body.params && typeof body.params === 'object' ? body.params : {};
          // Defence in depth for the owner-mandated agent invariants: a session always runs in
          // 'ask' mode and an approval never grants more than one session.
          if (method === 'agent.start' && params.permissionMode !== undefined) {
            return errorJson(res, 400, 'AGENT_INVALID_PARAMS', 'permissionMode dikunci ke ask untuk sesi agen.');
          }
          if (method === 'agent.approve') {
            const answer = String(params.answer || '');
            if (!['yes', 'no', 'session'].includes(answer)) {
              return errorJson(res, 400, 'AGENT_INVALID_PARAMS', 'Jawaban persetujuan harus yes, no, atau session.');
            }
          }
          try {
            const result = await relay.request(
              body.user_id,
              decodeURIComponent(requestMatch[1]),
              method,
              params,
            );
            return json(res, 200, { result });
          } catch (error) {
            const code = typeof error?.code === 'string' && AGENT_ERROR_CODES.has(error.code) ? error.code : null;
            if (code) {
              return errorJson(res, 502, code, error?.message || 'Permintaan agen gagal.');
            }
            throw error;
          }
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
              : status === 403
                ? 'DEVICE_METHOD_NOT_ALLOWED'
                : 'DEVICE_RELAY_FAILED';
      return errorJson(res, status, code, error?.message || 'Device relay request failed.');
    }
  };
  const server = http.createServer(handler);

  relay.attach(server, WebSocketServer);
  server.on('close', () => relay.close());
  server.keepAliveTimeout = 5000;
  server.headersTimeout = 10_000;

  return { server, relay, config, handler, state: { agentStreams, agentStreamsTotal: agentStreamTotal } };
}

// Optional unix-socket listener for host-local clients that cannot reach 127.0.0.1 (containers):
// same handler, still protected by the internal token header. Place the socket in a directory
// whose permissions limit who can connect. Exported so the behaviour can be tested directly.
function createSocketListener(handler, socketPath) {
  const socketServer = http.createServer(handler);
  socketServer.on('error', (error) => {
    // A bind failure must not take the whole relay down: the TCP listener may still work.
    console.error('BotConnector Device Relay (internal): socket error', error?.message || error);
  });
  try { fs.unlinkSync(socketPath); } catch {}
  socketServer.listen(socketPath, () => {
    try { fs.chmodSync(socketPath, 0o666); } catch {}
    console.log('BotConnector Device Relay (internal): unix:' + socketPath);
  });
  return socketServer;
}

if (require.main === module) {
  const { server, config, handler } = createDeviceRelayServer();
  server.listen(config.port, config.host, () => {
    console.log('BotConnector Device Relay: http://' + config.host + ':' + config.port);
  });
  const socketPath = String(process.env.BOTCONNECTOR_DEVICE_RELAY_SOCKET || '').trim();
  if (socketPath) createSocketListener(handler, socketPath);
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
