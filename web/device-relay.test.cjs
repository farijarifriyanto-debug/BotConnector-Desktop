const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
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

test('remote request forwards incremental device events before final response', async () => {
  const relay = new DeviceRelay({ appOrigin: 'http://127.0.0.1:8080', requestTimeoutMs: 1000 });
  const pair = relay.createPairCode('user-a');
  const paired = relay.exchange({ code: pair.code, device_name: 'Laptop A' });
  const stored = relay.devices.get(paired.device_id);
  stored.capabilities = ['chat.completions'];
  stored.socket = {
    readyState: 1,
    send(raw) {
      const request = JSON.parse(raw);
      setImmediate(() => {
        relay.forwardEvent(paired.device_id, {
          type: 'device.event',
          id: request.id,
          event: { thinking: true },
        });
        relay.forwardEvent(paired.device_id, {
          type: 'device.event',
          id: request.id,
          event: { content: 'Halo' },
        });
        relay.resolveResponse(paired.device_id, {
          type: 'device.response',
          id: request.id,
          ok: true,
          result: { content: 'Halo' },
        });
      });
    },
    close() {},
  };

  const events = [];
  const result = await relay.request(
    'user-a',
    paired.device_id,
    'chat.completions',
    { messages: [] },
    { onEvent: (event) => events.push(event) },
  );

  assert.deepEqual(events, [{ thinking: true }, { content: 'Halo' }]);
  assert.deepEqual(result, { content: 'Halo' });
  relay.close();
});

test('websocket URL preserves secure transport', () => {
  assert.equal(websocketUrl('https://app.botconnector.id'), 'wss://app.botconnector.id/api/devices/socket');
  assert.equal(websocketUrl('http://127.0.0.1:8080'), 'ws://127.0.0.1:8080/api/devices/socket');
});


test('paired devices survive relay restart without persisting plaintext device token', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'botconnector-device-relay-'));
  const stateFile = path.join(directory, 'devices.json');
  try {
    const first = new DeviceRelay({
      appOrigin: 'https://app.botconnector.id',
      stateFile,
    });
    const pair = first.createPairCode('user-a');
    const paired = first.exchange({
      code: pair.code,
      device_name: 'Persistent Laptop',
      platform: 'win32',
      arch: 'x64',
    });
    first.close();

    const rawState = fs.readFileSync(stateFile, 'utf8');
    assert.equal(rawState.includes(paired.device_token), false);
    assert.match(rawState, /"tokenHash"/);

    const second = new DeviceRelay({
      appOrigin: 'https://app.botconnector.id',
      stateFile,
    });
    const restored = second.list('user-a');
    assert.equal(restored.length, 1);
    assert.equal(restored[0].id, paired.device_id);
    assert.equal(restored[0].online, false);
    assert.ok(
      second.verifyHello({ deviceId: paired.device_id, token: paired.device_token }),
      'restored token hash authenticates the original device token',
    );

    assert.equal(second.revoke('user-a', paired.device_id), true);
    second.close();

    const third = new DeviceRelay({
      appOrigin: 'https://app.botconnector.id',
      stateFile,
    });
    assert.equal(third.list('user-a').length, 0);
    third.close();
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

// --- Agent stream support: abortable requests, device.cancel, agent.* timeout policy, error codes ---

function pairDevice(relay, capabilities) {
  const pair = relay.createPairCode('user-a');
  const paired = relay.exchange({ code: pair.code, device_name: 'Laptop A' });
  const stored = relay.devices.get(paired.device_id);
  stored.capabilities = capabilities;
  const sent = [];
  stored.socket = {
    readyState: 1,
    send(raw) {
      sent.push(JSON.parse(raw));
    },
    close() {},
  };
  return { paired, sent };
}

test('aborting a request sends device.cancel for the same id and rejects with code aborted', async () => {
  const relay = new DeviceRelay({ appOrigin: 'http://127.0.0.1:8080', requestTimeoutMs: 5000 });
  const { paired, sent } = pairDevice(relay, ['agent.stream']);
  const controller = new AbortController();

  const pending = relay.request('user-a', paired.device_id, 'agent.stream', {}, { signal: controller.signal });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(sent.length, 1);
  assert.equal(sent[0].type, 'device.request');
  assert.equal(sent[0].method, 'agent.stream');

  controller.abort();
  await assert.rejects(pending, (err) => {
    assert.equal(err.code, 'aborted');
    return true;
  });

  const cancel = sent.find((frame) => frame.type === 'device.cancel');
  assert.ok(cancel, 'relay must tell the device to cancel the aborted request');
  assert.equal(cancel.id, sent[0].id);
  assert.equal(relay.pending.size, 0, 'aborted request must not stay pending');

  // A late device response for the aborted id must not throw.
  relay.resolveResponse(paired.device_id, { type: 'device.response', id: sent[0].id, ok: true, result: { late: true } });
  relay.close();
});

test('agent.stream has no request timeout; other agent methods use the long timeout', async () => {
  const relay = new DeviceRelay({ appOrigin: 'http://127.0.0.1:8080', requestTimeoutMs: 30 });
  const { paired } = pairDevice(relay, ['agent.stream', 'agent.prompt']);

  const controller = new AbortController();
  const streaming = relay.request('user-a', paired.device_id, 'agent.stream', {}, { signal: controller.signal });
  await new Promise((resolve) => setTimeout(resolve, 120));
  assert.equal(relay.pending.size, 1, 'agent.stream must not time out while it is still streaming');

  controller.abort();
  await assert.rejects(streaming, (err) => err.code === 'aborted');

  const prompt = relay.request('user-a', paired.device_id, 'agent.prompt', {}, {});
  prompt.catch(() => {});
  await new Promise((resolve) => setTimeout(resolve, 120));
  assert.equal(relay.pending.size, 1, 'agent.prompt must survive the short default timeout');
  relay.close();
});

test('regular requests still time out with status 504', async () => {
  const relay = new DeviceRelay({ appOrigin: 'http://127.0.0.1:8080', requestTimeoutMs: 30 });
  const { paired } = pairDevice(relay, ['hardware.get']);
  await assert.rejects(relay.request('user-a', paired.device_id, 'hardware.get', {}, {}), (err) => {
    assert.equal(err.status, 504);
    return true;
  });
  relay.close();
});

test('device errors keep their machine-readable code', async () => {
  const relay = new DeviceRelay({ appOrigin: 'http://127.0.0.1:8080', requestTimeoutMs: 1000 });
  const { paired } = pairDevice(relay, ['agent.prompt']);
  const stored = relay.devices.get(paired.device_id);
  stored.socket = {
    readyState: 1,
    send(raw) {
      const request = JSON.parse(raw);
      setImmediate(() => relay.resolveResponse(paired.device_id, {
        type: 'device.response',
        id: request.id,
        ok: false,
        error: { message: 'Sesi sedang sibuk.', code: 'agent_busy' },
      }));
    },
    close() {},
  };

  await assert.rejects(relay.request('user-a', paired.device_id, 'agent.prompt', {}, {}), (err) => {
    assert.equal(err.message, 'Sesi sedang sibuk.');
    assert.equal(err.code, 'agent_busy');
    return true;
  });

  // Devices that do not send a code keep the old behaviour (no code property).
  stored.socket = {
    readyState: 1,
    send(raw) {
      const request = JSON.parse(raw);
      setImmediate(() => relay.resolveResponse(paired.device_id, {
        type: 'device.response',
        id: request.id,
        ok: false,
        error: { message: 'Perangkat menolak permintaan.' },
      }));
    },
    close() {},
  };
  await assert.rejects(relay.request('user-a', paired.device_id, 'agent.prompt', {}, {}), (err) => {
    assert.equal(err.message, 'Perangkat menolak permintaan.');
    assert.equal(err.code, undefined);
    return true;
  });
  relay.close();
});

test('a device that drops its socket settles its pending requests instead of leaking them', async () => {
  const WebSocket = require('ws');
  const http = require('node:http');
  const relay = new DeviceRelay({ appOrigin: 'http://127.0.0.1:8080', requestTimeoutMs: 0 });
  const pair = relay.createPairCode('user-a');
  const paired = relay.exchange({ code: pair.code, device_name: 'Laptop A' });

  // Real WebSocket relay + real device client: the relay's own 'close' handler must run.
  const server = http.createServer();
  relay.attach(server, WebSocket.WebSocketServer);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;

  const device = new WebSocket('ws://127.0.0.1:' + port + '/api/devices/socket');
  await new Promise((resolve, reject) => {
    device.once('open', resolve);
    device.once('error', reject);
  });
  device.send(JSON.stringify({
    type: 'device.hello',
    token: paired.device_token,
    deviceId: paired.device_id,
    deviceName: 'Laptop A',
    capabilities: ['agent.stream'],
  }));
  await new Promise((resolve) => setTimeout(resolve, 150));
  assert.ok(relay.devices.get(paired.device_id)?.socket, 'the device socket must be registered');

  try {
    // agent.stream has no timeout, so an unsettled request would stay pending forever.
    const pending = relay.request('user-a', paired.device_id, 'agent.stream', {}, {});
    // Attach the rejection handler immediately: the device may drop before the next await.
    const settled = pending.then(
      (value) => ({ ok: true, value }),
      (error) => ({ ok: false, error }),
    );
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(relay.pending.size, 1);

    // The device goes offline (laptop sleeps, wifi drops).
    device.close();
    await new Promise((resolve) => setTimeout(resolve, 250));

    const outcome = await settled;
    assert.equal(outcome.ok, false, 'a dropped device must settle the request');
    assert.equal(outcome.error.status, 409);
    assert.equal(outcome.error.code, 'device_offline');
    assert.equal(relay.pending.size, 0, 'a dropped device must not leave requests pending');
  } finally {
    device.close();
    await new Promise((resolve) => server.close(resolve));
    relay.close();
  }
});

test('replacing a device connection settles old requests without killing requests on the new socket', async () => {
  const { EventEmitter } = require('node:events');
  const relay = new DeviceRelay({ appOrigin: 'http://127.0.0.1:8080', requestTimeoutMs: 5000 });
  const pair = relay.createPairCode('user-a');
  const paired = relay.exchange({ code: pair.code, device_name: 'Laptop A' });

  function makeRelaySocket({ delayCloseMs = 0, onRequest } = {}) {
    const emitter = new EventEmitter();
    emitter.readyState = 1;
    emitter.send = (raw) => {
      const msg = JSON.parse(raw);
      if (msg.type === 'device.request' && typeof onRequest === 'function') {
        onRequest(msg);
      }
    };
    emitter.close = () => {
      emitter.readyState = 3;
      if (delayCloseMs > 0) {
        setTimeout(() => emitter.emit('close'), delayCloseMs);
      } else {
        setImmediate(() => emitter.emit('close'));
      }
    };
    return emitter;
  }

  // First socket closes asynchronously (e.g. TCP FIN takes 30ms) when replaced
  const sock1 = makeRelaySocket({ delayCloseMs: 30 });
  relay.acceptSocket(sock1);
  sock1.emit(
    'message',
    Buffer.from(
      JSON.stringify({
        type: 'device.hello',
        token: paired.device_token,
        deviceId: paired.device_id,
        deviceName: 'Laptop A',
        capabilities: ['agent.capabilities'],
      }),
    ),
  );

  // Start a request on sock1 that never answers
  const oldReq = relay.request('user-a', paired.device_id, 'agent.capabilities', {}, {});
  const oldOutcome = oldReq.then(
    (v) => ({ ok: true, v }),
    (e) => ({ ok: false, e }),
  );

  // Second socket connects and replaces sock1; sock1's 'close' event has NOT fired yet
  const sock2 = makeRelaySocket({
    onRequest(msg) {
      // Answer after sock1's delayed close event has fired (at 50ms > 30ms)
      setTimeout(() => {
        relay.resolveResponse(paired.device_id, {
          type: 'device.response',
          id: msg.id,
          ok: true,
          result: { supported: true, from: 'sock2' },
        });
      }, 50);
    },
  });
  relay.acceptSocket(sock2);
  sock2.emit(
    'message',
    Buffer.from(
      JSON.stringify({
        type: 'device.hello',
        token: paired.device_token,
        deviceId: paired.device_id,
        deviceName: 'Laptop A',
        capabilities: ['agent.capabilities'],
      }),
    ),
  );

  // Fire a request on sock2 BEFORE sock1's delayed 'close' event fires at 30ms
  const newResult = await relay.request('user-a', paired.device_id, 'agent.capabilities', {}, {});
  assert.deepEqual(newResult, { supported: true, from: 'sock2' });

  const settledOld = await oldOutcome;
  assert.equal(settledOld.ok, false, 'old socket request must be rejected on replacement');
  assert.equal(settledOld.e.code, 'device_offline');
  relay.close();
});
