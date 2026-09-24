const assert = require('node:assert/strict');
const test = require('node:test');
const { DeviceRelay, websocketUrl } = require('./device-relay.cjs');

test('pairing is one-time and devices are isolated by user', () => {
  const relay = new DeviceRelay({ appOrigin: 'https://app.botconnector.id' });
  const pair = relay.createPairCode('user-a');
  const device = relay.exchange({ code: pair.code, device_name: 'Laptop A', platform: 'win32', arch: 'x64' });

  assert.match(device.device_id, /^[0-9a-f-]{36}$/i);
  assert.equal(device.ws_url, 'wss://app.botconnector.id/api/devices/socket');
  assert.equal(relay.list('user-a').length, 1);
  assert.equal(relay.list('user-b').length, 0);
  assert.throws(() => relay.exchange({ code: pair.code }), /tidak berlaku/i);
  assert.equal(relay.revoke('user-b', device.device_id), false);
  assert.equal(relay.revoke('user-a', device.device_id), true);
});

test('remote request requires ownership, online socket, and advertised capability', async () => {
  const relay = new DeviceRelay({ appOrigin: 'http://127.0.0.1:8080', requestTimeoutMs: 1000 });
  const pair = relay.createPairCode('user-a');
  const paired = relay.exchange({ code: pair.code, device_name: 'Laptop A' });
  const stored = relay.devices.get(paired.device_id);
  stored.capabilities = ['hardware.get'];
  stored.socket = {
    readyState: 1,
    send(raw) {
      const request = JSON.parse(raw);
      setImmediate(() => relay.resolveResponse(paired.device_id, {
        type: 'device.response',
        id: request.id,
        ok: true,
        result: { cpu: 'Test CPU', ramGb: 32 },
      }));
    },
    close() {},
  };

  assert.throws(() => relay.request('user-b', paired.device_id, 'hardware.get'), /tidak ditemukan/i);
  assert.throws(() => relay.request('user-a', paired.device_id, 'launcher.start'), /tidak tersedia/i);
  const result = await relay.request('user-a', paired.device_id, 'hardware.get');
  assert.deepEqual(result, { cpu: 'Test CPU', ramGb: 32 });
  assert.deepEqual(relay.list('user-a')[0].hardware, result);
  relay.close();
});

test('websocket URL preserves secure transport', () => {
  assert.equal(websocketUrl('https://app.botconnector.id'), 'wss://app.botconnector.id/api/devices/socket');
  assert.equal(websocketUrl('http://127.0.0.1:8080'), 'ws://127.0.0.1:8080/api/devices/socket');
});
