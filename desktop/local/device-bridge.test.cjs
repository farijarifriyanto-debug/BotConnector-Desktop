const test = require('node:test');
const assert = require('node:assert/strict');
const { DeviceBridge } = require('./device-bridge.cjs');

function bridgeWith({ responses, tool }) {
  const calls = [];
  const localAi = {
    enabled: true,
    async chat(params) {
      calls.push(params);
      return responses.shift();
    },
  };
  const tools = {
    list: () => [tool],
    schemas: (selected) =>
      selected.includes(tool.id) || selected.includes(tool.name)
        ? [{
            type: 'function',
            function: {
              name: tool.name,
              description: tool.description || '',
              parameters: tool.inputSchema || { type: 'object' },
            },
          }]
        : [],
    findTool: (name) => (name === tool.name ? tool : null),
    async invoke(name, args, options) {
      assert.equal(name, tool.name);
      assert.deepEqual(args, { query: 'botconnector' });
      assert.equal(options.selected, true);
      return { results: [{ title: 'BotConnector' }] };
    },
  };
  return {
    bridge: new DeviceBridge({
      settings: { get: () => null, set: async () => {} },
      detectHardware: async () => ({}),
      tools,
      launcher: { list: () => [] },
      localAi,
      WebSocketImpl: null,
    }),
    calls,
  };
}

test('agent chat executes selected READ tool and returns final model answer', async () => {
  const tool = {
    id: 'web_search',
    name: 'web_search',
    description: 'Search web',
    inputSchema: { type: 'object' },
    source: 'builtin',
    permissionClass: 'READ',
    enabled: false,
    status: 'READY',
  };
  const { bridge, calls } = bridgeWith({
    tool,
    responses: [
      {
        content: '',
        tool_calls: [
          {
            id: 'call-1',
            type: 'function',
            function: { name: 'web_search', arguments: '{"query":"botconnector"}' },
          },
        ],
      },
      { content: 'Final grounded answer', tool_calls: [] },
    ],
  });

  const result = await bridge.agentChat({
    model: 'qwen:test',
    runtime: 'ollama',
    messages: [{ role: 'user', content: 'search botconnector' }],
    tools: ['web_search'],
  });

  assert.equal(result.content, 'Final grounded answer');
  assert.equal(calls.length, 2);
  assert.ok(calls[1].messages.some((message) => message.role === 'tool'));
  assert.deepEqual(
    result.tool_events.map((event) => event.type),
    ['tool.started', 'tool.completed'],
  );
});

test('agent chat requires approval for EXECUTE tools', async () => {
  const tool = {
    id: 'run_code',
    name: 'run_code',
    description: 'Run code',
    inputSchema: { type: 'object' },
    source: 'builtin',
    permissionClass: 'EXECUTE',
    enabled: false,
    status: 'READY',
  };
  const calls = [];
  const localAi = {
    enabled: true,
    async chat(params) {
      calls.push(params);
      if (calls.length === 1) {
        return {
          content: '',
          tool_calls: [{
            id: 'code-1',
            type: 'function',
            function: {
              name: 'run_code',
              arguments: '{"query":"botconnector"}',
            },
          }],
        };
      }
      return { content: 'Handled tool refusal', tool_calls: [] };
    },
  };
  const tools = {
    list: () => [tool],
    schemas: () => [{
      type: 'function',
      function: { name: tool.name, description: tool.description, parameters: tool.inputSchema },
    }],
    findTool: () => tool,
    async invoke(_name, _args, options) {
      if (!options.approved) throw new Error('explicit approval required');
      return { ok: true };
    },
  };
  const bridge = new DeviceBridge({
    settings: { get: () => null, set: async () => {} },
    detectHardware: async () => ({}),
    tools,
    launcher: { list: () => [] },
    localAi,
    WebSocketImpl: null,
  });

  const result = await bridge.agentChat({
    model: 'qwen:test',
    runtime: 'ollama',
    messages: [{ role: 'user', content: 'calculate' }],
    tools: ['run_code'],
    approved_tools: [],
  });

  assert.equal(result.content, 'Handled tool refusal');
  assert.equal(result.tool_events[1].type, 'tool.error');
  assert.match(result.tool_events[1].error, /approval/i);
});


test('pair accepts Base64URL pairing codes with underscore', async (t) => {
  const originalFetch = globalThis.fetch;
  let exchangedCode = '';
  globalThis.fetch = async (_url, init = {}) => {
    const body = JSON.parse(String(init.body || '{}'));
    exchangedCode = body.code;
    return {
      ok: true,
      json: async () => ({
        device_token: 'token-1',
        device_id: 'device-1',
        device_name: 'Test device',
        ws_url: 'wss://app.botconnector.id/api/devices/socket',
      }),
    };
  };
  t.after(() => { globalThis.fetch = originalFetch; });

  const values = {};
  const bridge = new DeviceBridge({
    settings: {
      get: (key) => values[key] || null,
      set: async (key, value) => { values[key] = value; },
    },
    detectHardware: async () => ({}),
    tools: { list: () => [] },
    launcher: { list: () => [] },
    localAi: { enabled: true },
    WebSocketImpl: null,
  });

  const status = await bridge.pair('F_NACCJH');
  assert.equal(exchangedCode, 'F_NACCJH');
  assert.equal(status.paired, true);
  assert.equal(status.deviceId, 'device-1');
});

test('pair still rejects non-Base64URL characters', async () => {
  const bridge = new DeviceBridge({
    settings: { get: () => null, set: async () => {} },
    detectHardware: async () => ({}),
    tools: { list: () => [] },
    launcher: { list: () => [] },
    localAi: { enabled: true },
    WebSocketImpl: null,
  });
  await assert.rejects(() => bridge.pair('ABC$123'), /Invalid pairing code/);
});


test('Web App local chat injects current hardware for device-spec questions without tool mode', async () => {
  const calls = [];
  let hardwareReads = 0;
  const localAi = {
    enabled: true,
    benchmarkResults: () => ({
      benchmarks: [{
        model: 'qwen-local',
        runtime: 'ollama',
        tokensPerSecond: 42.5,
        promptTokensPerSecond: 190.2,
        measuredAt: '2026-09-29T00:00:00.000Z',
      }],
    }),
    async chat(params) {
      calls.push(params);
      return { content: 'grounded hardware answer' };
    },
  };
  const bridge = new DeviceBridge({
    settings: { get: () => null, set: async () => {} },
    detectHardware: async () => {
      hardwareReads += 1;
      return {
        cpu: 'Intel Core i7-11800H',
        ramGb: 32,
        nvidia: [{ name: 'NVIDIA RTX Test', vramGb: 6 }],
        amd: [],
        intel: [],
        npu: { available: false },
        platform: 'win32',
        arch: 'x64',
        release: '10.0-test',
        secretInternalField: 'must-not-leak',
      };
    },
    tools: { list: () => [] },
    launcher: { list: () => [] },
    localAi,
    WebSocketImpl: null,
  });

  const result = await bridge.execute('chat.completions', {
    model: 'qwen-local',
    runtime: 'ollama',
    messages: [{ role: 'user', content: 'Cek spesifikasi laptop saya' }],
  });

  assert.equal(result.content, 'grounded hardware answer');
  assert.equal(hardwareReads, 1);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].messages[0].role, 'system');
  assert.match(calls[0].messages[0].content, /Intel Core i7-11800H/);
  assert.match(calls[0].messages[0].content, /NVIDIA RTX Test/);
  assert.match(calls[0].messages[0].content, /42\.5/);
  assert.doesNotMatch(calls[0].messages[0].content, /secretInternalField|must-not-leak/);
  assert.equal(calls[0].messages[1].content, 'Cek spesifikasi laptop saya');
});

test('Web App local chat does not read hardware for unrelated prompts', async () => {
  const calls = [];
  let hardwareReads = 0;
  const localAi = {
    enabled: true,
    async chat(params) {
      calls.push(params);
      return { content: 'normal answer' };
    },
  };
  const bridge = new DeviceBridge({
    settings: { get: () => null, set: async () => {} },
    detectHardware: async () => { hardwareReads += 1; return { cpu: 'Should not be read' }; },
    tools: { list: () => [] },
    launcher: { list: () => [] },
    localAi,
    WebSocketImpl: null,
  });

  await bridge.execute('chat.completions', {
    model: 'qwen-local',
    runtime: 'ollama',
    messages: [{ role: 'user', content: 'Jelaskan fotosintesis secara singkat' }],
  });

  assert.equal(hardwareReads, 0);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].messages, [{ role: 'user', content: 'Jelaskan fotosintesis secara singkat' }]);
});

test('Web App local agent mode also receives automatic current-device context', async () => {
  const calls = [];
  const localAi = {
    enabled: true,
    async chat(params) {
      calls.push(params);
      return { content: 'model fit answer', tool_calls: [] };
    },
  };
  const bridge = new DeviceBridge({
    settings: { get: () => null, set: async () => {} },
    detectHardware: async () => ({
      cpu: 'Ryzen Test',
      ramGb: 64,
      nvidia: [{ name: 'RTX 3090', vramGb: 24 }],
      amd: [],
      intel: [],
    }),
    tools: { list: () => [], schemas: () => [] },
    launcher: { list: () => [] },
    localAi,
    WebSocketImpl: null,
  });

  const result = await bridge.execute('chat.completions', {
    model: 'qwen-local',
    runtime: 'ollama',
    tool_mode: 'auto',
    messages: [{ role: 'user', content: 'Model coding apa yang cocok untuk saya jalankan?' }],
    tools: [],
  });

  assert.equal(result.content, 'model fit answer');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].messages[0].role, 'system');
  assert.match(calls[0].messages[0].content, /RTX 3090/);
  assert.match(calls[0].messages[0].content, /64/);
});


test('PTC mode exposes only run_code and executes the generated tools SDK', async () => {
  const calls = [];
  const localAi = {
    enabled: true,
    async chat(params) {
      calls.push(params);
      if (calls.length === 1) {
        return {
          content: '',
          tool_calls: [{
            id: 'ptc-1',
            type: 'function',
            function: {
              name: 'run_code',
              arguments: JSON.stringify({
                code: 'return await tools.echo_text({ text: "hello" });',
              }),
            },
          }],
        };
      }
      return { content: 'PTC finished', tool_calls: [] };
    },
  };
  const tool = {
    id: 'echo_text',
    name: 'echo_text',
    description: 'Echo',
    inputSchema: { type: 'object' },
    source: 'builtin',
    permissionClass: 'READ',
    status: 'READY',
  };
  const tools = {
    list: () => [tool],
    ptcSchema: () => [{
      type: 'function',
      function: {
        name: 'run_code',
        description: 'PTC runner',
        parameters: { type: 'object', properties: { code: { type: 'string' } } },
      },
    }],
    ptcPrompt: () => 'PTC generated SDK: tools.echo_text({ text: string })',
    runPtc: async (code, options) => {
      assert.match(code, /tools\.echo_text/);
      assert.deepEqual(options.selected, ['echo_text']);
      assert.equal(options.workspacePath, '/tmp/project');
      return { text: 'hello' };
    },
  };
  const bridge = new DeviceBridge({
    settings: { get: () => null, set: async () => {} },
    detectHardware: async () => ({}),
    tools,
    launcher: { list: () => [] },
    localAi,
    WebSocketImpl: null,
  });

  const result = await bridge.agentChat({
    model: 'qwen:test',
    runtime: 'ollama',
    mode: 'ptc',
    permission: 'workspace-write',
    workspace: { id: 'ws-1', name: 'Project', path: '/tmp/project' },
    messages: [{ role: 'user', content: 'orchestrate this' }],
    tools: ['echo_text'],
  });

  assert.equal(result.content, 'PTC finished');
  assert.equal(calls[0].tools.length, 1);
  assert.equal(calls[0].tools[0].function.name, 'run_code');
  assert.match(calls[0].messages[0].content + calls[0].messages[1].content, /PTC|Workspace root|workspace/i);
  assert.ok(result.tool_events.some((event) => event.source === 'ptc' && event.type === 'tool.completed'));
});

test('Minimal mode limits the model-facing tool set to run_code', async () => {
  const calls = [];
  const selectedArgs = [];
  const localAi = {
    enabled: true,
    async chat(params) {
      calls.push(params);
      return { content: 'minimal answer', tool_calls: [] };
    },
  };
  const tools = {
    schemas: (selected) => {
      selectedArgs.push([...selected]);
      return [{
        type: 'function',
        function: {
          name: 'run_code',
          description: 'Run code',
          parameters: { type: 'object' },
        },
      }];
    },
    minimalPrompt: () => 'Minimal mode: keep context small.',
  };
  const bridge = new DeviceBridge({
    settings: { get: () => null, set: async () => {} },
    detectHardware: async () => ({}),
    tools,
    launcher: { list: () => [] },
    localAi,
    WebSocketImpl: null,
  });

  const result = await bridge.agentChat({
    mode: 'minimal',
    permission: 'workspace-write',
    workspace: { path: '/tmp/project' },
    tools: ['web_search', 'echo_text'],
    messages: [{ role: 'user', content: 'hello' }],
  });

  assert.equal(result.content, 'minimal answer');
  assert.deepEqual(selectedArgs[0], ['run_code']);
  assert.match(calls[0].messages[0].content + calls[0].messages[1].content, /Minimal|workspace/i);
});
