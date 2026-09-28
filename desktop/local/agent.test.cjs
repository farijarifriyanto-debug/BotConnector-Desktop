const test = require('node:test');
const assert = require('node:assert/strict');
const { ToolRegistry } = require('./tools.cjs');
const { LocalAgent, normalizeToolCalls } = require('./agent.cjs');

test('normalizes OpenAI and Ollama-shaped tool calls', () => {
  assert.equal(normalizeToolCalls([
    { id: 'a', function: { name: 'echo_text', arguments: '{"text":"x"}' } },
    { function: { name: 'echo_text', arguments: { text: 'y' } } },
  ]).length, 2);
});

test('agent executes enabled READ tool and returns final answer', async () => {
  const registry = new ToolRegistry();
  registry.setEnabled('echo_text', true);
  const seen = [];
  const localAi = {
    async chat(payload) {
      seen.push(payload);
      if (seen.length === 1) {
        return {
          content: '',
          tool_calls: [
            {
              id: 'call-1',
              type: 'function',
              function: { name: 'echo_text', arguments: '{"text":"halo"}' },
            },
          ],
        };
      }
      assert.equal(payload.messages.at(-1).role, 'tool');
      assert.match(payload.messages.at(-1).content, /halo/);
      return { content: 'selesai', tool_calls: [] };
    },
  };
  const agent = new LocalAgent({ localAi, tools: registry });
  const result = await agent.run({
    model: 'test',
    runtime: 'ollama',
    messages: [{ role: 'user', content: 'echo halo' }],
  });
  assert.equal(result.content, 'selesai');
  assert.equal(result.activities.length, 1);
  assert.equal(result.activities[0].status, 'completed');
});

test('EXECUTE tool is not run without per-call approval', async () => {
  const registry = new ToolRegistry();
  registry.tools.set('exec_fixture', {
    id: 'exec_fixture',
    name: 'exec_fixture',
    description: 'test',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    permissionClass: 'EXECUTE',
    source: 'test',
    enabled: true,
    status: 'READY',
    executor: () => ({ should_not_run: true }),
  });
  let turn = 0;
  const localAi = {
    async chat(payload) {
      turn += 1;
      if (turn === 1) {
        return {
          content: '',
          tool_calls: [{ id: 'exec-1', function: { name: 'exec_fixture', arguments: '{}' } }],
        };
      }
      assert.match(payload.messages.at(-1).content, /persetujuan eksplisit/);
      return { content: 'approval required', tool_calls: [] };
    },
  };
  const agent = new LocalAgent({ localAi, tools: registry });
  const result = await agent.run({
    model: 'test',
    messages: [{ role: 'user', content: 'run' }],
  });
  assert.equal(result.content, 'approval required');
  assert.equal(result.activities[0].status, 'failed');
});
