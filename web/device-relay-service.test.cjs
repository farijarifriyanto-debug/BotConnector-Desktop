const assert = require('node:assert/strict');
const test = require('node:test');
const { createDeviceRelayServer, ALLOWED_METHODS } = require('./device-relay-service.cjs');

const TOKEN = 'test-device-relay-secret';
const USER_A = '11111111-1111-4111-8111-111111111111';
const USER_B = '22222222-2222-4222-8222-222222222222';

async function startRelay() {
  const { server } = createDeviceRelayServer({
    host: '127.0.0.1',
    port: 0,
    appOrigin: 'https://app.botconnector.id',
    internalToken: TOKEN,
    requestTimeoutMs: 100,
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return { server, base: 'http://127.0.0.1:' + server.address().port };
}

async function closeServer(server) {
  if (server.closeAllConnections) server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
}

async function internal(base, path, init = {}) {
  return fetch(base + path, {
    ...init,
    headers: {
      'content-type': 'application/json',
      'x-botconnector-device-internal': TOKEN,
      ...(init.headers || {}),
    },
  });
}

test('relay allowlist exposes local AI without arbitrary shell', () => {
  for (const method of [
    'runtime.status',
    'runtime.install.start',
    'runtime.install.status',
    'models.list',
    'models.pull.start',
    'models.pull.status',
    'models.delete',
    'model.load',
    'model.unload',
    'chat.completions',
  ]) {
    assert.equal(ALLOWED_METHODS.has(method), true, method);
  }
  assert.equal(ALLOWED_METHODS.has('shell.exec'), false);
});

test('relay refuses to start without internal authentication', () => {
  assert.throws(
    () => createDeviceRelayServer({ internalToken: '' }),
    /TOKEN.*required/i,
  );
});

test('internal streaming API relays incremental local chat events', async () => {
  const relay = {
    attach() {},
    close() {},
    async request(userId, deviceId, method, params, options) {
      assert.equal(userId, USER_A);
      assert.equal(deviceId, 'device-stream');
      assert.equal(method, 'chat.completions');
      assert.equal(params.stream, true);
      options.onEvent({ thinking: true });
      options.onEvent({ content: 'Halo' });
      return { content: 'Halo', usage: { completion_tokens: 1 } };
    },
  };
  const { server } = createDeviceRelayServer({
    host: '127.0.0.1',
    port: 0,
    appOrigin: 'https://app.botconnector.id',
    internalToken: TOKEN,
    relay,
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const base = 'http://127.0.0.1:' + server.address().port;

  try {
    const response = await internal(base, '/internal/devices/device-stream/stream', {
      method: 'POST',
      body: JSON.stringify({
        user_id: USER_A,
        method: 'chat.completions',
        params: { model: 'qwen-local', messages: [] },
      }),
    });
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type') || '', /text\/event-stream/);
    const text = await response.text();
    assert.match(text, /"thinking":true/);
    assert.match(text, /"content":"Halo"/);
    assert.match(text, /"done":true/);
  } finally {
    await closeServer(server);
  }
});

test('internal API creates owner-bound pair and public exchange is one-time', async () => {
  const { server, base } = await startRelay();
  try {
    const unauth = await fetch(base + '/internal/pair', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ user_id: USER_A }),
    });
    assert.equal(unauth.status, 401);

    const pair = await internal(base, '/internal/pair', {
      method: 'POST',
      body: JSON.stringify({ user_id: USER_A }),
    });
    assert.equal(pair.status, 200);
    const pairBody = await pair.json();
    assert.ok(pairBody.code);

    const exchange = await fetch(base + '/api/devices/pair/exchange', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        code: pairBody.code,
        device_name: 'Laptop A',
        platform: 'win32',
        arch: 'x64',
      }),
    });
    assert.equal(exchange.status, 200);
    const device = await exchange.json();
    assert.match(device.device_id, /^[0-9a-f-]{36}$/i);
    assert.equal(device.ws_url, 'wss://app.botconnector.id/api/devices/socket');

    const reused = await fetch(base + '/api/devices/pair/exchange', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code: pairBody.code }),
    });
    assert.equal(reused.status, 401);

    const ownerList = await internal(
      base,
      '/internal/devices?user_id=' + encodeURIComponent(USER_A),
    );
    const ownerBody = await ownerList.json();
    assert.equal(ownerBody.devices.length, 1);
    assert.equal(ownerBody.devices[0].id, device.device_id);

    const otherList = await internal(
      base,
      '/internal/devices?user_id=' + encodeURIComponent(USER_B),
    );
    assert.equal((await otherList.json()).devices.length, 0);

    const disallowed = await internal(
      base,
      '/internal/devices/' + device.device_id + '/request',
      {
        method: 'POST',
        body: JSON.stringify({ user_id: USER_A, method: 'shell.exec', params: {} }),
      },
    );
    assert.equal(disallowed.status, 403);

    const offline = await internal(
      base,
      '/internal/devices/' + device.device_id + '/request',
      {
        method: 'POST',
        body: JSON.stringify({ user_id: USER_A, method: 'hardware.get', params: {} }),
      },
    );
    assert.equal(offline.status, 409);

    const wrongRevoke = await internal(
      base,
      '/internal/devices/' + device.device_id + '/revoke',
      { method: 'POST', body: JSON.stringify({ user_id: USER_B }) },
    );
    assert.equal(wrongRevoke.status, 404);

    const revoke = await internal(
      base,
      '/internal/devices/' + device.device_id + '/revoke',
      { method: 'POST', body: JSON.stringify({ user_id: USER_A }) },
    );
    assert.equal(revoke.status, 200);
  } finally {
    await closeServer(server);
  }
});

// --- Unix-socket listener (parity with the deployed production artifact) ---
// account-api (container) reaches the relay ONLY through DEVICE_RELAY_SOCKET, so the
// repo must ship the same unix-socket listener as the artifact running in production.
// Windows cannot bind a unix socket (EACCES), so the cross-platform part of the contract is
// "the same handler serves a second listener"; the unix path itself is exercised on Linux.

test('relay exposes the same internal API over a unix socket when a socket path is configured', async (t) => {
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const http = require('node:http');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bc-relay-sock-'));
  const socketPath = path.join(dir, 'relay.sock');
  const { server, handler } = createDeviceRelayServer({
    host: '127.0.0.1',
    port: 0,
    appOrigin: 'https://app.botconnector.id',
    internalToken: TOKEN,
    requestTimeoutMs: 100,
  });
  assert.equal(typeof handler, 'function', 'createDeviceRelayServer must expose the request handler');

  const socketServer = http.createServer(handler);
  try {
    fs.unlinkSync(socketPath);
  } catch {}
  const unixSupported = process.platform !== 'win32';
  if (!unixSupported) {
    // Second listener over TCP: same handler, same internal API, same token gate.
    await new Promise((resolve, reject) => {
      socketServer.once('error', reject);
      socketServer.listen(0, '127.0.0.1', resolve);
    });
    t.diagnostic('unix sockets unsupported on this platform; verifying the shared handler over a second TCP listener');
  } else {
    await new Promise((resolve, reject) => {
      socketServer.once('error', reject);
      socketServer.listen(socketPath, resolve);
    });
  }

  try {
    const requestOptions = unixSupported
      ? { socketPath, path: '/internal/pair', method: 'POST' }
      : { host: '127.0.0.1', port: socketServer.address().port, path: '/internal/pair', method: 'POST' };

    const response = await new Promise((resolve, reject) => {
      const req = http.request(
        {
          ...requestOptions,
          headers: {
            'content-type': 'application/json',
            'x-botconnector-device-internal': TOKEN,
          },
        },
        (res) => {
          const chunks = [];
          res.on('data', (chunk) => chunks.push(chunk));
          res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
        },
      );
      req.on('error', reject);
      req.write(JSON.stringify({ user_id: USER_A }));
      req.end();
    });

    assert.equal(response.status, 200);
    const payload = JSON.parse(response.body);
    assert.equal(typeof payload.code, 'string');
    assert.ok(payload.code.length > 0);
  } finally {
    await new Promise((resolve) => socketServer.close(resolve));
    await closeServer(server);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// --- Agent bridge: agent.* allowlist, agent.stream SSE, capacity caps, abort on disconnect ---

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

test('relay allowlist exposes every agent method', () => {
  for (const method of AGENT_METHODS) {
    assert.equal(ALLOWED_METHODS.has(method), true, method);
  }
  assert.equal(ALLOWED_METHODS.has('shell.exec'), false);
});

function fakeAgentRelay(overrides = {}) {
  return {
    attach() {},
    close() {},
    async request(userId, deviceId, method, params, options) {
      if (overrides.request) return overrides.request(userId, deviceId, method, params, options);
      options.onEvent({ heartbeat: true });
      options.onEvent({ item: { type: 'text', delta: 'halo' } });
      return { ok: true };
    },
    ...overrides.relay,
  };
}

async function startService(relay, options = {}) {
  const { server, state } = createDeviceRelayServer({
    host: '127.0.0.1',
    port: 0,
    appOrigin: 'https://app.botconnector.id',
    internalToken: TOKEN,
    relay,
    ...options,
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return { server, state, base: 'http://127.0.0.1:' + server.address().port };
}

test('agent.stream is served as SSE and passes device events through', async () => {
  let seenParams = null;
  const { server, base } = await startService(fakeAgentRelay({
    request: async (userId, deviceId, method, params, options) => {
      seenParams = params;
      options.onEvent({ heartbeat: true });
      options.onEvent({ item: { type: 'text', delta: 'halo' } });
      return { ok: true };
    },
  }));
  try {
    const response = await internal(base, '/internal/devices/device-stream/stream', {
      method: 'POST',
      body: JSON.stringify({ user_id: USER_A, method: 'agent.stream', params: { sessionId: 's1' } }),
    });
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type') || '', /text\/event-stream/);
    const text = await response.text();
    assert.match(text, /"heartbeat":true/);
    assert.match(text, /"type":"text"/);
    assert.match(text, /"done":true/);
    // agent.stream must not get the chat-only `stream: true` parameter injected.
    assert.equal(seenParams.stream, undefined);
    assert.equal(seenParams.sessionId, 's1');
  } finally {
    await closeServer(server);
  }
});

test('streaming stays limited to chat.completions and agent.stream', async () => {
  const { server, base } = await startService(fakeAgentRelay());
  try {
    const denied = await internal(base, '/internal/devices/device-stream/stream', {
      method: 'POST',
      body: JSON.stringify({ user_id: USER_A, method: 'models.list', params: {} }),
    });
    assert.equal(denied.status, 403);
    const payload = await denied.json();
    assert.equal(payload.error.code, 'DEVICE_METHOD_NOT_ALLOWED');
  } finally {
    await closeServer(server);
  }
});

test('agent.stream cannot be called on the one-shot request route', async () => {
  const { server, base } = await startService(fakeAgentRelay());
  try {
    const denied = await internal(base, '/internal/devices/device-stream/request', {
      method: 'POST',
      body: JSON.stringify({ user_id: USER_A, method: 'agent.stream', params: {} }),
    });
    assert.equal(denied.status, 400);
    const payload = await denied.json();
    assert.equal(payload.error.code, 'DEVICE_METHOD_NOT_ALLOWED');
  } finally {
    await closeServer(server);
  }
});

test('agent stream capacity is limited per account and globally', async () => {
  const relay = fakeAgentRelay({
    request: async (userId, deviceId, method, params, options) => {
      return new Promise((resolve) => {
        options.signal.addEventListener('abort', () => resolve({ aborted: true }), { once: true });
        setTimeout(() => resolve({ ok: true }), 60000).unref?.();
      });
    },
  });
  const { server, base, state } = await startService(relay, { agentStreamPerAccount: 2, agentStreamGlobal: 3 });
  // Each stream gets its own abort controller so the test can release a slot explicitly.
  const stream = (userId) => {
    const controller = new AbortController();
    const promise = internal(base, '/internal/devices/device-stream/stream', {
      method: 'POST',
      body: JSON.stringify({ user_id: userId, method: 'agent.stream', params: {} }),
      signal: controller.signal,
    });
    promise.catch(() => {});
    return { controller, promise };
  };
  const waitFor = async (predicate, timeoutMs = 2000) => {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      if (predicate()) return true;
      if (Date.now() > deadline) return false;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  };

  try {
    const first = stream(USER_A);
    const second = stream(USER_A);
    assert.equal(await waitFor(() => state.agentStreamsTotal() === 2), true, 'two agent streams must be counted');

    const third = await internal(base, '/internal/devices/device-stream/stream', {
      method: 'POST',
      body: JSON.stringify({ user_id: USER_A, method: 'agent.stream', params: {} }),
    });
    assert.equal(third.status, 429);
    const payload = await third.json();
    assert.equal(payload.error.code, 'AGENT_CAPACITY');

    // A different account still has room (per-account cap is not global).
    const other = stream(USER_B);
    assert.equal(await waitFor(() => state.agentStreamsTotal() === 3), true);
    const otherResponse = await other.promise;
    assert.equal(otherResponse.status, 200, 'the second account must still be able to stream');

    // Global cap: a third account hits the global limit (2 for A + 1 for B = 3).
    const third2 = await internal(base, '/internal/devices/device-stream/stream', {
      method: 'POST',
      body: JSON.stringify({ user_id: USER_B, method: 'agent.stream', params: {} }),
    });
    assert.equal(third2.status, 429);
    const globalPayload = await third2.json();
    assert.equal(globalPayload.error.code, 'AGENT_CAPACITY');

    // Releasing ONE of USER_A's two streams must decrement USER_A from 2 -> 1 (not 2 -> 0).
    first.controller.abort();
    assert.equal(
      await waitFor(() => state.agentStreamsTotal() === 2),
      true,
      'closing one of two streams must leave 2 total active streams (1 for A, 1 for B)',
    );
    assert.equal(
      state.agentStreams.get(USER_A),
      1,
      'closing one of two streams must leave per-account count at 1, not 0',
    );

    // Releasing the remaining streams frees all slots.
    second.controller.abort();
    other.controller.abort();
    assert.equal(await waitFor(() => state.agentStreamsTotal() === 0), true, 'all agent stream slots must be released');
    assert.equal(state.agentStreams.size, 0, 'per-account counters must be released too');

    const afterRelease = await internal(base, '/internal/devices/device-stream/stream', {
      method: 'POST',
      body: JSON.stringify({ user_id: USER_A, method: 'agent.stream', params: {} }),
    });
    assert.equal(afterRelease.status, 200, 'a finished stream must free its capacity slot');
  } finally {
    await closeServer(server);
  }
});

test('a stream that ends with a device error still frees its capacity slot', async () => {
  const relay = fakeAgentRelay({
    request: async () => {
      const error = new Error('bccli tidak ditemukan.');
      error.code = 'agent_runtime_missing';
      throw error;
    },
  });
  const { server, base, state } = await startService(relay, { agentStreamPerAccount: 1, agentStreamGlobal: 1 });
  try {
    const failed = await internal(base, '/internal/devices/device-stream/stream', {
      method: 'POST',
      body: JSON.stringify({ user_id: USER_A, method: 'agent.stream', params: {} }),
    });
    const text = await failed.text();
    assert.match(text, /"code":"agent_runtime_missing"/);

    const deadline = Date.now() + 2000;
    while (state.agentStreamsTotal() !== 0 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.equal(state.agentStreamsTotal(), 0, 'the error path must release the slot');

    const next = await internal(base, '/internal/devices/device-stream/stream', {
      method: 'POST',
      body: JSON.stringify({ user_id: USER_A, method: 'agent.stream', params: {} }),
    });
    assert.equal(next.status, 200, 'a failed stream must not consume capacity');
  } finally {
    await closeServer(server);
  }
});

test('closing the stream response aborts the device request', async () => {
  let captured = null;
  const relay = fakeAgentRelay({
    request: async (userId, deviceId, method, params, options) => {
      captured = options.signal;
      return new Promise((resolve) => {
        options.signal.addEventListener('abort', () => resolve({ aborted: true }), { once: true });
      });
    },
  });
  const { server, base } = await startService(relay);
  try {
    const controller = new AbortController();
    const response = await internal(base, '/internal/devices/device-stream/stream', {
      method: 'POST',
      body: JSON.stringify({ user_id: USER_A, method: 'agent.stream', params: {} }),
      signal: controller.signal,
    });
    assert.equal(response.status, 200);
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.ok(captured, 'the relay request must receive an abort signal');
    assert.equal(captured.aborted, false);
    controller.abort();
    await new Promise((resolve) => setTimeout(resolve, 60));
    assert.equal(captured.aborted, true, 'closing the client connection must abort the device request');
  } finally {
    await closeServer(server);
  }
});

test('agent error codes survive to the caller, unknown device codes do not', async () => {
  const relay = fakeAgentRelay({
    request: async () => {
      const error = new Error('Sesi sedang sibuk.');
      error.code = 'agent_busy';
      throw error;
    },
  });
  const { server, base } = await startService(relay);
  try {
    const requestRoute = await internal(base, '/internal/devices/device-stream/request', {
      method: 'POST',
      body: JSON.stringify({ user_id: USER_A, method: 'agent.prompt', params: {} }),
    });
    assert.equal(requestRoute.status, 502);
    const requestPayload = await requestRoute.json();
    assert.equal(requestPayload.error.code, 'agent_busy');
    assert.equal(requestPayload.error.message, 'Sesi sedang sibuk.');

    const streamRoute = await internal(base, '/internal/devices/device-stream/stream', {
      method: 'POST',
      body: JSON.stringify({ user_id: USER_A, method: 'agent.stream', params: {} }),
    });
    const text = await streamRoute.text();
    assert.match(text, /"code":"agent_busy"/);
  } finally {
    await closeServer(server);
  }
});

test('a device cannot invent its own agent error code', async () => {
  const relay = fakeAgentRelay({
    request: async () => {
      const error = new Error('payload weird');
      error.code = 'agent_totally_made_up';
      throw error;
    },
  });
  const { server, base } = await startService(relay);
  try {
    const requestRoute = await internal(base, '/internal/devices/device-stream/request', {
      method: 'POST',
      body: JSON.stringify({ user_id: USER_A, method: 'agent.prompt', params: {} }),
    });
    const payload = await requestRoute.json();
    assert.notEqual(payload.error.code, 'agent_totally_made_up', 'only known agent codes may be surfaced');
  } finally {
    await closeServer(server);
  }
});

test('the relay refuses to let a client bypass the ask-mode and approval limits', async () => {
  const { server, base } = await startService(fakeAgentRelay());
  try {
    const bypass = await internal(base, '/internal/devices/device-stream/request', {
      method: 'POST',
      body: JSON.stringify({ user_id: USER_A, method: 'agent.start', params: { cwd: '/tmp', permissionMode: 'bypassPermissions' } }),
    });
    assert.equal(bypass.status, 400);
    const bypassPayload = await bypass.json();
    assert.equal(bypassPayload.error.code, 'AGENT_INVALID_PARAMS');

    const grantAll = await internal(base, '/internal/devices/device-stream/request', {
      method: 'POST',
      body: JSON.stringify({ user_id: USER_A, method: 'agent.approve', params: { requestId: 'r1', answer: 'all' } }),
    });
    assert.equal(grantAll.status, 400);
    const grantPayload = await grantAll.json();
    assert.equal(grantPayload.error.code, 'AGENT_INVALID_PARAMS');
  } finally {
    await closeServer(server);
  }
});

test('an older device that does not advertise agent.* capabilities gets 403 DEVICE_METHOD_NOT_ALLOWED', async () => {
  const { server, base } = await startRelay();
  try {
    const pairRes = await internal(base, '/internal/pair', {
      method: 'POST',
      body: JSON.stringify({ user_id: USER_A }),
    });
    const pair = await pairRes.json();

    const exchangeRes = await fetch(base + '/api/devices/pair/exchange', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code: pair.code, device_name: 'Old Laptop' }),
    });
    const device = await exchangeRes.json();

    const WebSocket = require('ws');
    const ws = new WebSocket(base.replace('http://', 'ws://') + '/api/devices/socket');
    await new Promise((resolve, reject) => {
      ws.once('open', resolve);
      ws.once('error', reject);
    });
    ws.send(
      JSON.stringify({
        type: 'device.hello',
        token: device.device_token,
        deviceId: device.device_id,
        deviceName: 'Old Laptop',
        capabilities: ['hardware.get'], // no agent.* advertised
      }),
    );
    await new Promise((resolve) => setTimeout(resolve, 60));

    try {
      const res = await internal(base, `/internal/devices/${device.device_id}/request`, {
        method: 'POST',
        body: JSON.stringify({
          user_id: USER_A,
          method: 'agent.capabilities',
          params: {},
        }),
      });
      assert.equal(res.status, 403);
      const body = await res.json();
      assert.equal(body.error.code, 'DEVICE_METHOD_NOT_ALLOWED');
    } finally {
      ws.close();
    }
  } finally {
    await closeServer(server);
  }
});
