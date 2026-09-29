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
    cancelPull: (id) => ({ id, status: 'cancelled' }),
    loadModel: async (model, runtime) => ({ loaded: true, model, runtime }),
    unloadModel: async (model, runtime) => ({ loaded: false, model, runtime }),
    deleteModel: async (model, runtime) => ({ deleted: true, model, runtime }),
    chat: async ({ model, messages, request_id }) => ({
      content: 'local:' + String(
        (Array.isArray(messages)
          ? messages.find((message) => message?.role === 'user')
          : null)?.content || ''
      ),
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
  assert.match(html, /Connect Web App/);
  assert.match(html, /How can I help on this device\?/);
  assert.match(html, /id="openTools"/);
  assert.match(html, /On-device AI workspace/);
  assert.match(html, /\[hidden\]\{display:none!important\}/);
  assert.match(html, /friendlyModelName/);
  assert.match(html, /button\.disabled = !streaming/);
  assert.match(html, /id="loadSelected"/);
  assert.match(html, /id="unloadSelected"/);
  assert.match(html, /id="modelLoadState"/);
  assert.match(html, /loaded \? 'Loaded' : 'Unloaded'/);
  assert.match(html, /Chat can auto-load the selected model/);
  assert.match(html, /id="openWebApp"/);
  assert.match(html, /Connect to Web App/);
  assert.match(html, /Web App paired/);
  assert.match(html, /reconnects automatically/);
  assert.match(html, /Forget pairing/);
  assert.match(html, /id="openDeviceFit"/);
  assert.match(html, /id="deviceFitPanel"/);
  assert.match(html, /id="fitTabRecommendedCount"/);
  assert.match(html, /id="activeModelPill"/);
  assert.match(html, /id="unloadActive"/);
  assert.match(html, /Model unload could not be verified/);
  assert.match(html, /Active model unload could not be verified/);
  assert.match(html, /id="fitTabRecommended"/);
  assert.match(html, /id="fitTabInstalled"/);
  assert.match(html, /id="fitTabAll"/);
  assert.match(html, /data-fit-preference="fast"/);
  assert.match(html, /data-fit-preference="balanced"/);
  assert.match(html, /data-fit-preference="quality"/);
  assert.match(html, /id="fitPreferenceDescription"/);
  assert.match(html, /Best balance of speed, memory use, and answer quality/);
  assert.match(html, /id="fitSearch"/);
  assert.match(html, /id="fitSort"/);
  assert.match(html, /data-fit-usecase="vision"/);
  assert.match(html, /All compatible/);
  assert.match(html, /modelCapabilityBadges/);
  assert.match(html, /Why this model\?/);
  assert.match(html, /Great fit/);
  assert.match(html, /May be slow/);
  assert.match(html, /fitHardwareShell/);
  assert.match(html, /width:min\(680px/);
  assert.match(html, /id="fitRamAvailable"/);
  assert.match(html, /fitCatalogSticky/);
  assert.match(html, /id="fitFiltersBtn"/);
  assert.match(html, /id="fitFilterSize"/);
  assert.match(html, /id="fitFilterContext"/);
  assert.match(html, /id="fitFilterQuant"/);
  assert.match(html, /id="fitFilterPublisher"/);
  assert.match(html, /id="fitFilterInstalled"/);
  assert.match(html, /id="fitFilterBenchmarked"/);
  assert.match(html, /id="fitCompareTray"/);
  assert.match(html, /id="fitComparePanel"/);
  assert.match(html, /Recommended for this device/);
  assert.match(html, /fitDownloadProgress/);
  assert.match(html, /catalogDisplayName/);
  assert.match(html, /Official publisher/);
  assert.match(html, /Community/);
  assert.match(html, /Measured/);
  assert.match(html, /Estimated/);
  assert.match(html, /Use model/);
  assert.match(html, /Downloading/);
  assert.match(html, /\/api\/models\/pull\/cancel/);
  assert.match(html, /Benchmark all/);
  assert.match(html, /fitBenchmarkStop/);
  assert.match(html, /benchmarkScore/);
  assert.match(html, /Prompt <strong>/);
  assert.match(html, /Generate /);
  assert.match(html, /Benchmarking/);
  assert.match(html, /\/api\/models\/benchmark/);
  assert.match(html, /\['chat', 'Text', 'text'\]/);
  assert.match(html, /\['vision', 'Vision', 'vision'\]/);
  assert.match(html, /\['tools', 'Tools', 'tools'\]/);
  assert.match(html, /\['reasoning', 'Reasoning', 'reasoning'\]/);
  assert.match(html, /id="workspaceButton"/);
  assert.match(html, /id="workspaceMenu"/);
  assert.match(html, /id="modeButton"/);
  assert.match(html, /data-workspace-mode="standard"/);
  assert.match(html, /data-workspace-mode="ptc"/);
  assert.match(html, /data-workspace-mode="minimal"/);
  assert.match(html, /data-workspace-mode="custom"/);
  assert.match(html, /Creator mode/);
  assert.match(html, /id="permissionSelect"/);
  assert.match(html, /Workspace write/);
  assert.match(html, /id="workspacePanel"/);
  assert.match(html, /id="workspaceSide"/);
  assert.match(html, /PTC exposes one run_code tool/);
  assert.match(html, /\/api\/workspaces/);

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


test('Local workspace API persists project mode, permission, model and selected tools', async (t) => {
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bc-workspace-api-'));
  const project = path.join(dataDir, 'project-a');
  fs.mkdirSync(project);
  const server = await startOfflineServer({
    localAi: runtimeFixture(),
    detectHardware: async () => ({ cpu: 'Test CPU', ramGb: 16 }),
    dataDir,
    port: 0,
    open: false,
  });
  t.after(async () => {
    await server.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  const headers = {
    origin: server.url,
    'content-type': 'application/json',
    'x-botconnector-local-token': server.token,
  };

  const initial = await (await fetch(server.url + '/api/workspaces', { headers })).json();
  assert.equal(initial.active.mode, 'standard');
  assert.equal(initial.active.permission, 'workspace-write');

  const addResponse = await fetch(server.url + '/api/workspaces/add', {
    method: 'POST',
    headers,
    body: JSON.stringify({ path: project, name: 'Project A' }),
  });
  assert.equal(addResponse.status, 201);
  const added = await addResponse.json();
  assert.equal(added.active.name, 'Project A');
  const canonicalProject = fs.realpathSync.native
    ? fs.realpathSync.native(project)
    : fs.realpathSync(project);
  assert.equal(added.active.path, canonicalProject);

  const updateResponse = await fetch(server.url + '/api/workspaces/update', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      id: added.active.id,
      patch: {
        mode: 'ptc',
        permission: 'read-only',
        modelPath: 'device:test:model-1',
        tools: ['web_search'],
        customPrompt: 'Use this project only.',
      },
    }),
  });
  assert.equal(updateResponse.status, 200);
  const updated = await updateResponse.json();
  assert.equal(updated.active.mode, 'ptc');
  assert.equal(updated.active.permission, 'read-only');
  assert.equal(updated.active.modelPath, 'device:test:model-1');
  assert.deepEqual(updated.active.tools, ['web_search']);

  const second = await startOfflineServer({
    localAi: runtimeFixture(),
    detectHardware: async () => ({ cpu: 'Test CPU', ramGb: 16 }),
    dataDir,
    port: 0,
    open: false,
  });
  t.after(() => second.close());
  const secondHeaders = {
    'content-type': 'application/json',
    'x-botconnector-local-token': second.token,
  };
  const reloaded = await (await fetch(second.url + '/api/workspaces', { headers: secondHeaders })).json();
  assert.equal(reloaded.active.id, added.active.id);
  assert.equal(reloaded.active.mode, 'ptc');
  assert.equal(reloaded.active.permission, 'read-only');
  assert.deepEqual(reloaded.active.tools, ['web_search']);
});


test('offline API can cancel an active model download', async (t) => {
  const server = await startOfflineServer({
    localAi: runtimeFixture(),
    detectHardware: async () => ({ cpu: 'Test CPU', ramGb: 16 }),
    port: 0,
    open: false,
  });
  t.after(() => server.close());

  const response = await fetch(server.url + '/api/models/pull/cancel', {
    method: 'POST',
    headers: {
      origin: server.url,
      'content-type': 'application/json',
      'x-botconnector-local-token': server.token,
    },
    body: JSON.stringify({ id: 'pull-job' }),
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { id: 'pull-job', status: 'cancelled' });
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
          { id: 'Example/Image-GGUF', downloads: 9000 },
          { id: 'Example/Huge-GGUF', downloads: 9500 },
          { id: 'Example/Chat-Uncensored-GGUF', downloads: 9900 },
        ],
      };
    },
    modelDetails: async (id, hardware) => {
      calls.push({ kind: 'details', id, hardware });
      return {
        id,
        capabilities: { chat: !id.includes('Image') },
        compatibility: {
          level: id.includes('Fast') ? 'great' : id.includes('Huge') ? 'no' : 'warn',
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
  assert.equal(searchPayload.models.length, 5);
  const searchCall = calls.find((call) => call.kind === 'search');
  assert.equal(searchCall.args.hardware.ramGb, 16);

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
  assert.deepEqual(recPayload.models.map((m) => m.id), ['Example/Fast-GGUF', 'Example/Heavy-GGUF']);
  assert.ok(calls.some((call) => call.kind === 'details' && call.hardware.ramGb === 16));
});


test('OpenAI-compatible local API lists runnable models and chats without cloud fallback', async (t) => {
  const localAi = runtimeFixture();
  localAi.listModels = async () => [
    {
      id: 'local-runnable',
      name: 'Runnable Local',
      path: 'device:test:local-runnable',
      runtime: 'test',
      runnable: true,
      source: 'fixture',
    },
    {
      id: 'local-unavailable',
      name: 'Unavailable Local',
      path: 'device:test:local-unavailable',
      runtime: 'test',
      runnable: false,
      source: 'fixture',
    },
  ];
  localAi.chat = async ({ model, runtime, messages }) => ({
    content: 'offline:' + String(messages?.[0]?.content || ''),
    model,
    runtime,
  });

  const server = await startOfflineServer({
    localAi,
    detectHardware: async () => ({ cpu: 'Test CPU', ramGb: 16 }),
    port: 0,
    open: false,
  });
  t.after(() => server.close());

  const auth = { Authorization: 'Bearer ' + server.token };

  const modelsResponse = await fetch(server.url + '/v1/models', { headers: auth });
  assert.equal(modelsResponse.status, 200);
  const modelsPayload = await modelsResponse.json();
  assert.equal(modelsPayload.object, 'list');
  assert.equal(modelsPayload.data.length, 1);
  assert.equal(modelsPayload.data[0].name, 'Runnable Local');

  const chatResponse = await fetch(server.url + '/v1/chat/completions', {
    method: 'POST',
    headers: { ...auth, 'content-type': 'application/json' },
    body: JSON.stringify({
      model: modelsPayload.data[0].id,
      messages: [{ role: 'user', content: 'hello' }],
    }),
  });
  assert.equal(chatResponse.status, 200);
  const chatPayload = await chatResponse.json();
  assert.equal(chatPayload.object, 'chat.completion');
  assert.equal(chatPayload.choices[0].message.content, 'offline:hello');
});

test('/api/chat streams deltas as server-sent events when stream is true', async (t) => {
  const localAi = {
    ...runtimeFixture(),
    chat: async ({ onDelta }) => {
      onDelta({ reasoning: 'hmm' });
      onDelta({ content: 'Ha' });
      onDelta({ content: 'lo' });
      return { content: 'Halo', reasoning: 'hmm', usage: { completion_tokens: 2 } };
    },
  };
  const server = await startOfflineServer({ localAi, detectHardware: async () => ({}), port: 0, open: false });
  t.after(() => server.close());
  const res = await fetch(server.url + '/api/chat', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-botconnector-local-token': server.token },
    body: JSON.stringify({ model: 'm1', runtime: 'test', stream: true, messages: [{ role: 'user', content: 'hai' }] }),
  });
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/event-stream/);
  const events = (await res.text()).split('\n\n').filter(Boolean).map((e) => JSON.parse(e.replace(/^data: /, '')));
  assert.deepEqual(events.slice(0, 3), [{ reasoning: 'hmm' }, { content: 'Ha' }, { content: 'lo' }]);
  assert.equal(events[3].done, true);
  assert.equal(events[3].content, 'Halo');

  const failing = await startOfflineServer({
    localAi: { ...runtimeFixture(), chat: async () => { throw new Error('model crashed'); } },
    detectHardware: async () => ({}), port: 0, open: false,
  });
  t.after(() => failing.close());
  const bad = await fetch(failing.url + '/api/chat', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-botconnector-local-token': failing.token },
    body: JSON.stringify({ model: 'm1', runtime: 'test', stream: true, messages: [{ role: 'user', content: 'hai' }] }),
  });
  assert.deepEqual(JSON.parse((await bad.text()).trim().replace(/^data: /, '')), { error: { message: 'model crashed' } });
});

test('a busy default port moves to the next free one; a busy explicit --port explains what to do', async (t) => {
  const net = require('node:net');
  const blocker = net.createServer();
  await new Promise((r) => blocker.listen(0, '127.0.0.1', r));
  t.after(() => blocker.close());
  const busy = blocker.address().port;
  const server = await startOfflineServer({ localAi: runtimeFixture(), detectHardware: async () => ({}), port: busy, portFallback: 5, open: false });
  t.after(() => server.close());
  assert.notEqual(server.port, busy);
  assert.ok(server.port > busy && server.port <= busy + 5);
  await assert.rejects(
    startOfflineServer({ localAi: runtimeFixture(), detectHardware: async () => ({}), port: busy, portFallback: 0, open: false }),
    new RegExp('Port ' + busy + ' is already in use.*http://127\\.0\\.0\\.1:' + busy + '.*--port'),
  );
});

test('chat history is stored on disk, so a UI on another port sees the same chats', async (t) => {
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bc-chats-'));
  const start = () => startOfflineServer({ localAi: runtimeFixture(), detectHardware: async () => ({}), port: 0, open: false, dataDir });
  const a = await start();
  t.after(() => a.close());
  const h = (s) => ({ 'content-type': 'application/json', 'x-botconnector-local-token': s.token });
  assert.deepEqual(await (await fetch(a.url + '/api/chats', { headers: h(a) })).json(), { state: null, settings: null });
  const saved = { state: { active: 'c1', chats: [{ id: 'c1', title: 'siapa anda', messages: [{ role: 'user', content: 'siapa anda' }] }] }, settings: { theme: 'light' } };
  assert.equal((await fetch(a.url + '/api/chats', { method: 'POST', headers: h(a), body: JSON.stringify(saved) })).status, 200);
  const b = await start();
  t.after(() => b.close());
  assert.notEqual(a.port, b.port);
  assert.deepEqual(await (await fetch(b.url + '/api/chats', { headers: h(b) })).json(), saved);
  if (process.platform !== 'win32') assert.equal(fs.statSync(path.join(dataDir, 'local-chats.json')).mode & 0o777, 0o600);
  assert.equal((await fetch(b.url + '/api/chats', { method: 'POST', headers: h(b), body: JSON.stringify({ state: 'nope' }) })).status, 400);
});

test('chats made before the disk copy loaded are merged into it, not lost or overwritten', () => {
  const { mergeChatStates, localUiHtml } = require('./local-ui.cjs');
  const opened = 1000;
  const old = { id: 'old', createdAt: 1, messages: [{ role: 'user', content: 'siapa anda' }] };
  const disk = { active: 'old', chats: [old] };

  // New port, empty browser storage: a message sent before the disk copy arrived is kept, next to the history.
  const typed = { id: 'new', createdAt: 1500, messages: [{ role: 'user', content: 'halo' }] };
  const a = mergeChatStates(disk, { active: 'new', chats: [typed] }, opened, null);
  assert.deepEqual(a.state.chats.map((c) => c.id), ['new', 'old']);
  assert.equal(a.state.active, 'new');
  assert.equal(a.changed, true);

  // An untouched empty chat and stale chats from this browser's storage do not come back.
  const deletedElsewhere = { id: 'gone', createdAt: 5, messages: [{ role: 'user', content: 'x' }] };
  const b = mergeChatStates(disk, { active: 'e', chats: [{ id: 'e', createdAt: 1200, messages: [] }, deletedElsewhere] }, opened, null);
  assert.deepEqual(b.state, disk);
  assert.equal(b.changed, false);

  // The chat still streaming keeps this page's copy, so the reply keeps landing in the object on screen.
  const streaming = { id: 'old', createdAt: 1, messages: [...old.messages, { role: 'assistant', content: '' }] };
  const c = mergeChatStates(disk, { active: 'old', chats: [streaming] }, opened, 'old');
  assert.equal(c.state.chats[0], streaming);
  assert.equal(c.changed, true);

  // The helper is shipped with the page.
  const html = localUiHtml({ token: 't', host: '127.0.0.1', port: 1 });
  assert.match(html, /function mergeChatStates\(/);
  assert.match(html, /renderMarkdown, mergeChatStates\);/);
});


test('offline browser exposes selected tools and streams tool activity', async (t) => {
  const tool = {
    id: 'web_search',
    name: 'web_search',
    description: 'Search the web.',
    source: 'builtin',
    permissionClass: 'READ',
    status: 'READY',
  };
  let invoked = 0;
  const localAi = runtimeFixture();
  localAi.chat = async ({ messages = [], tools = [] }) => {
    const hasToolResult = messages.some((message) => message.role === 'tool');
    if (tools.length && !hasToolResult) {
      return {
        content: '',
        tool_calls: [
          {
            id: 'call-search-1',
            type: 'function',
            function: {
              name: 'web_search',
              arguments: JSON.stringify({ query: 'BotConnector Local' }),
            },
          },
        ],
      };
    }
    return {
      content: hasToolResult ? 'Local answer after tool result.' : 'Local answer without tools.',
      tool_calls: [],
      usage: { completion_tokens: 6 },
    };
  };
  const registry = {
    list: () => [tool],
    mcpStatus: () => [
      { id: 'fixture', name: 'Fixture MCP', transport: 'stdio', status: 'READY', error: null, tools: [] },
    ],
    schemas: (selected) => selected.includes('web_search')
      ? [{
          type: 'function',
          function: {
            name: 'web_search',
            description: 'Search the web.',
            parameters: {
              type: 'object',
              properties: { query: { type: 'string' } },
              required: ['query'],
            },
          },
        }]
      : [],
    findTool: (name) => name === 'web_search' ? tool : null,
    invoke: async (name, args) => {
      invoked += 1;
      assert.equal(name, 'web_search');
      assert.equal(args.query, 'BotConnector Local');
      return { query: args.query, results: [{ title: 'Result', url: 'https://example.test' }] };
    },
  };

  const server = await startOfflineServer({
    localAi,
    tools: registry,
    detectHardware: async () => ({ cpu: 'Test CPU', ramGb: 16 }),
    port: 0,
    open: false,
  });
  t.after(() => server.close());

  const headers = {
    origin: server.url,
    'content-type': 'application/json',
    'x-botconnector-local-token': server.token,
  };
  const toolsResponse = await fetch(server.url + '/api/tools', { headers });
  assert.equal(toolsResponse.status, 200);
  const toolsPayload = await toolsResponse.json();
  assert.equal(toolsPayload.tools[0].id, 'web_search');
  assert.equal(toolsPayload.tools[0].permissionClass, 'READ');

  const mcpResponse = await fetch(server.url + '/api/mcp', { headers });
  assert.equal(mcpResponse.status, 200);
  const mcpPayload = await mcpResponse.json();
  assert.equal(mcpPayload.servers[0].status, 'READY');

  const workspacePayload = await (await fetch(server.url + '/api/workspaces', { headers })).json();
  const workspaceUpdate = await fetch(server.url + '/api/workspaces/update', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      id: workspacePayload.active.id,
      patch: { mode: 'standard', permission: 'workspace-write', tools: ['web_search'] },
    }),
  });
  assert.equal(workspaceUpdate.status, 200);

  const response = await fetch(server.url + '/api/chat', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: 'model-1',
      runtime: 'test',
      stream: true,
      tool_mode: 'auto',
      tools: ['web_search'],
      messages: [{ role: 'user', content: 'search this' }],
    }),
  });
  assert.equal(response.status, 200);
  const stream = await response.text();
  assert.match(stream, /"type":"tool\.started"/);
  assert.match(stream, /"type":"tool\.completed"/);
  assert.match(stream, /"arguments":\{"query":"BotConnector Local"\}/);
  assert.match(stream, /Local answer after tool result/);
  assert.equal(invoked, 1);
});


test('Local UI Web App pairing routes stay behind localhost session auth', async (t) => {
  let pairedCode = '';
  let disconnected = 0;
  const webApp = {
    origin: 'https://app.botconnector.id',
    status: () => ({ paired: false, connection: 'DISCONNECTED', deviceName: 'Test device' }),
    pair: async (code) => {
      pairedCode = code;
      return { paired: true, connection: 'CONNECTING', deviceId: 'device-1', deviceName: 'Test device' };
    },
    disconnect: async () => {
      disconnected += 1;
      return { paired: false, connection: 'DISCONNECTED', deviceName: 'Test device' };
    },
  };
  const server = await startOfflineServer({
    localAi: runtimeFixture(),
    detectHardware: async () => ({ cpu: 'Test CPU', ramGb: 16 }),
    webApp,
    port: 0,
    open: false,
  });
  t.after(() => server.close());

  const unauthorized = await fetch(server.url + '/api/webapp/status');
  assert.equal(unauthorized.status, 401);

  const headers = {
    origin: server.url,
    'content-type': 'application/json',
    'x-botconnector-local-token': server.token,
  };
  const status = await fetch(server.url + '/api/webapp/status', { headers });
  assert.equal(status.status, 200);
  const statusPayload = await status.json();
  assert.equal(statusPayload.origin, 'https://app.botconnector.id');
  assert.equal(statusPayload.available, true);

  const pair = await fetch(server.url + '/api/webapp/pair', {
    method: 'POST',
    headers,
    body: JSON.stringify({ code: 'ABC-123' }),
  });
  assert.equal(pair.status, 200);
  assert.equal(pairedCode, 'ABC-123');

  const disconnect = await fetch(server.url + '/api/webapp/disconnect', {
    method: 'POST',
    headers,
    body: '{}',
  });
  assert.equal(disconnect.status, 200);
  assert.equal(disconnected, 1);
});


test('Local UI load and unload endpoints return verified model lifecycle responses', async (t) => {
  let loaded = false;
  const localAi = {
    ...runtimeFixture(),
    status: async () => ({
      available: true,
      runtime: 'test',
      activeModel: loaded ? 'model-1' : null,
      loadedModels: loaded ? ['model-1'] : [],
    }),
    loadModel: async (model, runtime) => {
      loaded = true;
      return { loaded: true, model, runtime };
    },
    unloadModel: async (model, runtime) => {
      loaded = false;
      return { loaded: false, model, runtime };
    },
  };
  const server = await startOfflineServer({
    localAi,
    detectHardware: async () => ({ cpu: 'Test CPU', ramGb: 16 }),
    port: 0,
    open: false,
  });
  t.after(() => server.close());

  const headers = {
    origin: server.url,
    'content-type': 'application/json',
    'x-botconnector-local-token': server.token,
  };

  const load = await fetch(server.url + '/api/models/load', {
    method: 'POST',
    headers,
    body: JSON.stringify({ model: 'model-1', runtime: 'test' }),
  });
  assert.equal(load.status, 200);
  assert.equal((await load.json()).loaded, true);
  assert.deepEqual((await (await fetch(server.url + '/api/status', { headers })).json()).runtime.loadedModels, ['model-1']);

  const unload = await fetch(server.url + '/api/models/unload', {
    method: 'POST',
    headers,
    body: JSON.stringify({ model: 'model-1', runtime: 'test' }),
  });
  assert.equal(unload.status, 200);
  assert.equal((await unload.json()).loaded, false);
  assert.deepEqual((await (await fetch(server.url + '/api/status', { headers })).json()).runtime.loadedModels, []);
});


test('Local UI benchmark endpoint returns and lists persisted measurements', async (t) => {
  const row = {
    model: 'model-1',
    runtime: 'test',
    measuredAt: '2026-09-29T00:00:00.000Z',
    wallMs: 2000,
    completionTokens: 40,
    tokensPerSecond: 20,
  };
  const localAi = {
    ...runtimeFixture(),
    benchmarkModel: async (model, runtime) => ({ ...row, model, runtime }),
    benchmarkResults: () => ({ benchmarks: [row] }),
  };
  const server = await startOfflineServer({
    localAi,
    detectHardware: async () => ({ cpu: 'Test CPU', ramGb: 16 }),
    port: 0,
    open: false,
  });
  t.after(() => server.close());

  const headers = {
    origin: server.url,
    'content-type': 'application/json',
    'x-botconnector-local-token': server.token,
  };
  const run = await fetch(server.url + '/api/models/benchmark', {
    method: 'POST',
    headers,
    body: JSON.stringify({ model: 'model-1', runtime: 'test' }),
  });
  assert.equal(run.status, 200);
  assert.equal((await run.json()).tokensPerSecond, 20);

  const list = await fetch(server.url + '/api/models/benchmarks', { headers });
  assert.equal(list.status, 200);
  assert.equal((await list.json()).benchmarks[0].model, 'model-1');
});
