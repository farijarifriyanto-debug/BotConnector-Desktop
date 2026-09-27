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
