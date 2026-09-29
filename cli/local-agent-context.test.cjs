const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createScopedTools, modeToolIds, replaceTemplates } = require('./local-agent-context.cjs');

function baseRegistry() {
  const rows = [
    {
      id: 'web_search', name: 'web_search', source: 'builtin',
      permissionClass: 'READ', status: 'READY',
      description: 'search', inputSchema: { type: 'object', properties: {} },
    },
    {
      id: 'run_code', name: 'run_code', source: 'builtin',
      permissionClass: 'EXECUTE', status: 'READY',
      description: 'code', inputSchema: { type: 'object', properties: {} },
    },
    {
      id: 'mcp-demo:read', name: 'mcp_demo_read', source: 'mcp:demo',
      permissionClass: 'READ', status: 'READY',
      description: 'mcp read', inputSchema: { type: 'object', properties: {} },
    },
  ];
  return {
    list: () => rows.map((row) => ({ ...row })),
    async invoke(name, args) { return { name, args }; },
  };
}

test('agent modes expose different real tool surfaces', () => {
  const base = baseRegistry();
  const workspace = { root: process.cwd() };
  const standard = modeToolIds(base, { workspace, mode: 'standard', permission: 'workspace-write', selected: ['web_search'] });
  assert.ok(standard.includes('workspace_read'));
  assert.ok(standard.includes('workspace_write'));
  assert.ok(standard.includes('web_search'));

  const minimal = modeToolIds(base, { workspace, mode: 'minimal', permission: 'workspace-write', selected: ['web_search'] });
  assert.deepEqual(minimal.sort(), ['workspace_list', 'workspace_read', 'workspace_search'].sort());

  const ptc = modeToolIds(base, { workspace, mode: 'ptc', permission: 'workspace-write', selected: ['web_search'] });
  assert.deepEqual(ptc, ['run_tool_program']);
});

test('PTC tool program executes ordered steps and can reference prior results', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bc-ptc-'));
  try {
    fs.writeFileSync(path.join(root, 'one.txt'), 'hello from workspace');
    const scoped = createScopedTools(baseRegistry(), {
      workspace: { root },
      mode: 'ptc',
      permission: 'workspace-write',
      selected: ['web_search'],
    });
    assert.deepEqual(scoped.selectedToolIds(), ['run_tool_program']);
    assert.equal(scoped.schemas()[0].function.name, 'run_tool_program');

    const result = await scoped.invoke('run_tool_program', {
      steps: [
        { tool: 'workspace_read', args: { path: 'one.txt' } },
        { tool: 'workspace_write', args: { path: 'two.txt', content: '$step.0' } },
      ],
    });
    assert.equal(result.steps, 2);
    assert.match(fs.readFileSync(path.join(root, 'two.txt'), 'utf8'), /hello from workspace/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('read-only permission blocks workspace mutation even through PTC', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bc-ptc-readonly-'));
  try {
    const scoped = createScopedTools(baseRegistry(), {
      workspace: { root },
      mode: 'ptc',
      permission: 'read-only',
      selected: [],
    });
    await assert.rejects(
      scoped.invoke('run_tool_program', {
        steps: [{ tool: 'workspace_write', args: { path: 'blocked.txt', content: 'no' } }],
      }),
      /not allowed|requires/i,
    );
    assert.equal(fs.existsSync(path.join(root, 'blocked.txt')), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('PTC template replacement supports previous step references', () => {
  assert.deepEqual(
    replaceTemplates({ value: 'prefix $step.0' }, [{ ok: true }]),
    { value: 'prefix {"ok":true}' },
  );
});
