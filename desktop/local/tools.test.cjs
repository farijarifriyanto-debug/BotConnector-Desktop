const test = require('node:test');
const assert = require('node:assert/strict');
const { ToolRegistry, MAX_TOOL_CALLS_PER_TURN, validateArgs } = require('./tools.cjs');

test('schema validation rejects missing, wrong, and unknown arguments', () => {
  const schema = { type: 'object', properties: { text: { type: 'string' } }, required: ['text'], additionalProperties: false };
  assert.match(validateArgs(schema, {}), /wajib/);
  assert.match(validateArgs(schema, { text: 2 }), /bertipe/);
  assert.match(validateArgs(schema, { text: 'ok', extra: true }), /tidak dikenal/);
  assert.equal(validateArgs(schema, { text: 'ok' }), null);
});

test('disabled and unknown tools are rejected', async () => {
  const registry = new ToolRegistry();
  await assert.rejects(() => registry.invoke('echo_text', { text: 'x' }), /belum diaktifkan/);
  await assert.rejects(() => registry.invoke('missing', {}), /tidak dikenal/);
});

test('READ tool executes after explicit enablement', async () => {
  const registry = new ToolRegistry();
  await registry.setEnabled('echo_text', true);
  assert.deepEqual(await registry.invoke('echo_text', { text: 'hello' }), { text: 'hello' });
});

test('WRITE and EXECUTE tools require an approval gate', async () => {
  const registry = new ToolRegistry();
  registry.tools.set('write_fixture', { id: 'write_fixture', name: 'write_fixture', description: '', inputSchema: { type: 'object' }, permissionClass: 'WRITE', source: 'test', enabled: true, status: 'READY', executor: () => ({ ok: true }) });
  await assert.rejects(() => registry.invoke('write_fixture', {}), /persetujuan eksplisit/);
  assert.deepEqual(await registry.invoke('write_fixture', {}, { approved: true }), { ok: true });
});

test('bounded timeout and tool loop constant are enforced', async () => {
  const registry = new ToolRegistry();
  registry.tools.set('slow_fixture', { id: 'slow_fixture', name: 'slow_fixture', description: '', inputSchema: { type: 'object' }, permissionClass: 'READ', source: 'test', enabled: true, status: 'READY', executor: () => new Promise(resolve => setTimeout(() => resolve({ ok: true }), 11_000)) });
  await assert.rejects(() => registry.invoke('slow_fixture', {}), /timed out/);
  assert.ok(MAX_TOOL_CALLS_PER_TURN <= 4);
});

test('MCP fixture discovery, allowlist, invocation, and shutdown are isolated', async () => {
  const registry = new ToolRegistry();
  const servers = await registry.registerMcp({ id: 'fixture-test' });
  assert.equal(servers[0].status, 'READY');
  const discovered = registry.list().find(tool => tool.source === 'mcp:fixture-test');
  assert.ok(discovered);
  await assert.rejects(() => registry.invoke(discovered.name, { text: 'x' }), /belum diaktifkan/);
  await registry.setEnabled(discovered.id, true);
  await assert.rejects(
    () => registry.invoke(discovered.name, { text: 'x' }),
    /persetujuan eksplisit/,
  );
  const result = await registry.invoke(discovered.name, { text: 'x' }, { approved: true });
  assert.deepEqual(result.content[0], { type: 'text', text: 'x' });
  await registry.close();
  assert.equal(registry.mcpStatus().length, 0);
});

test('bad MCP start reports FAILED without affecting registry', async () => {
  const registry = new ToolRegistry();
  const servers = await registry.registerMcp({ id: 'bad-test', command: 'definitely-missing-botconnector-mcp' });
  assert.equal(servers[0].status, 'FAILED');
  assert.equal(registry.list().some(tool => tool.serverId === 'bad-test'), false);
  await registry.close();
});


test('selected READ tool can run for one turn without persistent enablement', async () => {
  const registry = new ToolRegistry();
  const result = await registry.invoke('echo_text', { text: 'turn-scoped' }, { selected: true });
  assert.deepEqual(result, { text: 'turn-scoped' });
});

test('Run Code is approval-gated and executes JavaScript in a temporary directory', async () => {
  const registry = new ToolRegistry();
  await assert.rejects(
    () => registry.invoke('run_code', { language: 'javascript', code: 'console.log(2 + 3)' }, { selected: true }),
    /persetujuan eksplisit/,
  );
  const result = await registry.invoke(
    'run_code',
    { language: 'javascript', code: 'console.log(2 + 3)' },
    { selected: true, approved: true },
  );
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout.trim(), '5');
});

test('configured Web Search backend is normalized without leaking its response shape', async () => {
  const previousUrl = process.env.BOTCONNECTOR_WEB_SEARCH_URL;
  const previousFetch = global.fetch;
  process.env.BOTCONNECTOR_WEB_SEARCH_URL = 'https://search.invalid/query';
  global.fetch = async (_url, init) => {
    assert.equal(init.method, 'POST');
    return new Response(
      JSON.stringify({
        results: [{ name: 'Result', href: 'https://example.com', description: 'Snippet' }],
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  };
  try {
    const registry = new ToolRegistry();
    const result = await registry.invoke(
      'web_search',
      { query: 'test', max_results: 3 },
      { selected: true },
    );
    assert.equal(result.results[0].title, 'Result');
    assert.equal(result.results[0].url, 'https://example.com');
    assert.equal(result.untrustedExternalContent, true);
  } finally {
    global.fetch = previousFetch;
    if (previousUrl == null) delete process.env.BOTCONNECTOR_WEB_SEARCH_URL;
    else process.env.BOTCONNECTOR_WEB_SEARCH_URL = previousUrl;
  }
});


test('DuckDuckGo Lite fallback accepts href before class on result links', async () => {
  const previousUrl = process.env.BOTCONNECTOR_WEB_SEARCH_URL;
  const previousFetch = global.fetch;
  delete process.env.BOTCONNECTOR_WEB_SEARCH_URL;
  global.fetch = async () =>
    new Response(
      [
        '<table>',
        '<tr><td><a rel="nofollow" href="https://example.com/result" class="result-link">Example Result</a></td></tr>',
        '<tr><td class="result-snippet">Example snippet</td></tr>',
        '</table>',
      ].join(''),
      { status: 200, headers: { 'content-type': 'text/html' } },
    );
  try {
    const registry = new ToolRegistry();
    const result = await registry.invoke(
      'web_search',
      { query: 'example', max_results: 2 },
      { selected: true },
    );
    assert.equal(result.provider, 'duckduckgo-lite');
    assert.deepEqual(result.results[0], {
      title: 'Example Result',
      url: 'https://example.com/result',
      snippet: 'Example snippet',
    });
  } finally {
    global.fetch = previousFetch;
    if (previousUrl == null) delete process.env.BOTCONNECTOR_WEB_SEARCH_URL;
    else process.env.BOTCONNECTOR_WEB_SEARCH_URL = previousUrl;
  }
});
