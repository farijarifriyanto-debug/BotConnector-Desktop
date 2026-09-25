const test = require('node:test');
const assert = require('node:assert/strict');

const { startOfflineServer, browserLaunchSpec } = require('./offline-server.cjs');

function runtimeFixture() {
  return {
    status: async () => ({ available: true, runtime: 'test-local', models: 1 }),
    listModels: async () => [
      {
        id: 'model-1',
        name: 'Local Test Model',
        path: 'device:test:model-1',
        runtime: 'test',
      },
    ],
    startRuntimeInstall: async () => ({ id: 'runtime-job', status: 'queued' }),
    runtimeJobStatus: () => ({ id: 'runtime-job', status: 'completed', percent: 100 }),
    startPull: async () => ({ id: 'pull-job', status: 'queued' }),
    jobStatus: () => ({ id: 'pull-job', status: 'completed', percent: 100 }),
    loadModel: async (model, runtime) => ({ loaded: true, model, runtime }),
    unloadModel: async (model, runtime) => ({ loaded: false, model, runtime }),
    deleteModel: async (model, runtime) => ({ deleted: true, model, runtime }),
    chat: async ({ model, messages, request_id }) => ({
      content: 'local:' + String(messages?.[0]?.content || ''),
      model,
      runtime: 'test',
      request_id,
    }),
    cancelChat: (id) => ({ cancelled: true, id }),
  };
}

test('offline UI serves localhost HTML and protects local API with a session token', async (t) => {
  const server = await startOfflineServer({
    localAi: runtimeFixture(),
    detectHardware: async () => ({ cpu: 'Test CPU', ramGb: 16 }),
    port: 0,
    open: false,
  });
  t.after(() => server.close());

  assert.match(server.url, /^http:\/\/127\.0\.0\.1:\d+$/);

  const page = await fetch(server.url + '/');
  assert.equal(page.status, 200);
  const html = await page.text();
  assert.match(html, /BotConnector Local/);
  assert.match(html, /OFFLINE · Localhost only/);

  const anonymous = await fetch(server.url + '/api/status');
  assert.equal(anonymous.status, 401);

  const authorized = await fetch(server.url + '/api/status', {
    headers: { 'x-botconnector-local-token': server.token },
  });
  assert.equal(authorized.status, 200);
  const payload = await authorized.json();
  assert.equal(payload.mode, 'offline-local');
  assert.equal(payload.runtime.runtime, 'test-local');
  assert.equal(payload.hardware.cpu, 'Test CPU');
});

test('offline API rejects foreign origin and accepts same-origin local chat', async (t) => {
  const server = await startOfflineServer({
    localAi: runtimeFixture(),
    detectHardware: async () => ({ cpu: 'Test CPU', ramGb: 16 }),
    port: 0,
    open: false,
  });
  t.after(() => server.close());

  const foreign = await fetch(server.url + '/api/models', {
    headers: {
      origin: 'https://evil.example',
      'x-botconnector-local-token': server.token,
    },
  });
  assert.equal(foreign.status, 403);

  const response = await fetch(server.url + '/api/chat', {
    method: 'POST',
    headers: {
      origin: server.url,
      'content-type': 'application/json',
      'x-botconnector-local-token': server.token,
    },
    body: JSON.stringify({
      model: 'model-1',
      runtime: 'test',
      request_id: 'req-1',
      messages: [{ role: 'user', content: 'hello offline' }],
    }),
  });
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.content, 'local:hello offline');
  assert.equal(result.request_id, 'req-1');
});


test('uses the native Windows shell launcher for localhost UI', () => {
  const spec = browserLaunchSpec('http://127.0.0.1:18765', 'win32');
  assert.deepEqual(spec, {
    command: 'explorer.exe',
    args: ['http://127.0.0.1:18765'],
  });
});


test('Local UI catalog search and recommendations use detected hardware', async (t) => {
  const calls = [];
  const catalog = {
    searchCatalog: async (args) => {
      calls.push({ kind: 'search', args });
      return {
        source: 'https://botconnector.id',
        models: [
          { id: 'Example/Fast-GGUF', downloads: 1000 },
          { id: 'Example/Heavy-GGUF', downloads: 5000 },
        ],
      };
    },
    modelDetails: async (id, hardware) => {
      calls.push({ kind: 'details', id, hardware });
      return {
        id,
        capabilities: { chat: true },
        compatibility: {
          level: id.includes('Fast') ? 'great' : 'warn',
          estimatedQ4Gb: id.includes('Fast') ? 2.5 : 18,
        },
      };
    },
  };

  const server = await startOfflineServer({
    localAi: runtimeFixture(),
    detectHardware: async () => ({ cpu: 'Test CPU', ramGb: 16, nvidia: [] }),
    catalog,
    port: 0,
    open: false,
  });
  t.after(() => server.close());

  const headers = {
    'content-type': 'application/json',
    'x-botconnector-local-token': server.token,
  };

  const search = await fetch(server.url + '/api/catalog/search?q=qwen&limit=20', { headers });
  assert.equal(search.status, 200);
  const searchPayload = await search.json();
  assert.equal(searchPayload.models.length, 2);

  const recs = await fetch(server.url + '/api/catalog/recommendations', {
    method: 'POST',
    headers,
    body: JSON.stringify({ query: 'chat', limit: 8 }),
  });
  assert.equal(recs.status, 200);
  const recPayload = await recs.json();
  assert.equal(recPayload.hardware.ramGb, 16);
  assert.equal(recPayload.models[0].id, 'Example/Fast-GGUF');
  assert.equal(recPayload.models[0].compatibility.level, 'great');
  assert.ok(calls.some((call) => call.kind === 'details' && call.hardware.ramGb === 16));
});
