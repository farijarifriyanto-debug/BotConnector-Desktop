const assert = require('node:assert/strict');
const test = require('node:test');
const { createDeviceRelayServer } = require('./device-relay-service.cjs');

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

test('relay refuses to start without internal authentication', () => {
  assert.throws(
    () => createDeviceRelayServer({ internalToken: '' }),
    /TOKEN.*required/i,
  );
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
