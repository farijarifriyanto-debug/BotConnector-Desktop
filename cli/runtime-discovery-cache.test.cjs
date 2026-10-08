const test = require('node:test');
const assert = require('node:assert/strict');
const { LocalAiRuntime } = require('./local-runtime.cjs');

test.beforeEach((t) => {
  const prior = process.env.BOTCONNECTOR_OLLAMA_BASE_URL;
  process.env.BOTCONNECTOR_OLLAMA_BASE_URL = 'http://127.0.0.1:11434';
  t.after(() => {
    if (prior === undefined) delete process.env.BOTCONNECTOR_OLLAMA_BASE_URL;
    else process.env.BOTCONNECTOR_OLLAMA_BASE_URL = prior;
  });
});

function fixture() {
  let available = false;
  let requests = 0;
  const runtime = new LocalAiRuntime({
    enabled: true,
    fetchImpl: async () => {
      requests++;
      await Promise.resolve();
      if (!available) throw new Error('Runtime stopped');
      return { ok: true, status: 200, json: async () => ({ models: [] }) };
    },
  });
  return { runtime, start: () => { available = true; }, stop: () => { available = false; }, requests: () => requests };
}

test('missing Ollama is reused briefly and a newly started runtime is found after expiry', async (t) => {
  let now = 1000;
  t.mock.method(Date, 'now', () => now);
  const f = fixture();
  assert.equal(await f.runtime.findOllamaBase(), null);
  const scanned = f.requests();
  f.start();
  assert.equal(await f.runtime.findOllamaBase(), null);
  assert.equal(f.requests(), scanned, 'a recent absence must avoid another network scan');
  now += 5001;
  assert.equal(await f.runtime.findOllamaBase(), 'http://127.0.0.1:11434');
});

test('available Ollama is reused then a stopped runtime is detected after expiry', async (t) => {
  let now = 1000;
  t.mock.method(Date, 'now', () => now);
  const f = fixture();
  f.start();
  const base = await f.runtime.findOllamaBase();
  f.stop();
  assert.equal(await f.runtime.findOllamaBase(), base);
  assert.equal(f.requests(), 1, 'repeated lookups must not probe a recent successful discovery');
  now += 10001;
  assert.equal(await f.runtime.findOllamaBase(), null);
});

test('concurrent discoveries share one scan including an explicit refresh', async () => {
  const f = fixture();
  const results = await Promise.all([
    f.runtime.findOllamaBase(),
    f.runtime.findOllamaBase(),
    f.runtime.findOllamaBase({ refresh: true }),
  ]);
  assert.deepEqual(results, [null, null, null]);
  const concurrentRequests = f.requests();
  await f.runtime.findOllamaBase({ refresh: true });
  assert.equal(f.requests(), concurrentRequests * 2, 'three simultaneous lookups must perform only one scan');
});

test('refresh finds a runtime started during a cached absence', async () => {
  const f = fixture();
  assert.equal(await f.runtime.findOllamaBase(), null);
  f.start();
  assert.equal(await f.runtime.findOllamaBase({ refresh: true }), 'http://127.0.0.1:11434');
});

test('changed host configuration bypasses cached discovery', async (t) => {
  const prior = process.env.BOTCONNECTOR_OLLAMA_BASE_URL;
  t.after(() => {
    if (prior === undefined) delete process.env.BOTCONNECTOR_OLLAMA_BASE_URL;
    else process.env.BOTCONNECTOR_OLLAMA_BASE_URL = prior;
  });
  const f = fixture();
  f.start();
  await f.runtime.findOllamaBase();
  process.env.BOTCONNECTOR_OLLAMA_BASE_URL = 'http://127.0.0.1:19434';
  assert.equal(await f.runtime.findOllamaBase(), 'http://127.0.0.1:19434');
});
