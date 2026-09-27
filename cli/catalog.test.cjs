const test = require('node:test');
const assert = require('node:assert/strict');
const catalog = require('../desktop/local/catalog.cjs');
const hf = require('../desktop/local/hf.cjs');

function stubFetch(t, handler) {
  const original = globalThis.fetch;
  const urls = [];
  globalThis.fetch = async (url) => {
    urls.push(new URL(String(url)));
    return handler(new URL(String(url)));
  };
  t.after(() => { globalThis.fetch = original; });
  return urls;
}
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

test('catalog search asks Hugging Face for runnable GGUF chat models only', async (t) => {
  const urls = stubFetch(t, () => json([
    { id: 'Qwen/Qwen3-0.6B-GGUF', pipeline_tag: 'text-generation', tags: ['gguf'], gguf: { total: 6e8 } },
    { id: 'unsloth/Qwen3.8-27B-GGUF', pipeline_tag: 'image-text-to-text', tags: ['gguf'], gguf: { total: 27e9 } },
    { id: 'someone/Qwen-Image-GGUF', pipeline_tag: 'text-to-image', tags: ['gguf'] },
  ]));
  const out = await catalog.searchCatalog({ query: 'qwen', limit: 20 });
  assert.equal(urls[0].host, 'huggingface.co');
  assert.equal(urls[0].searchParams.get('filter'), 'gguf');
  // One pipeline_tag would drop multimodal chat models, so pipelines are filtered here instead.
  assert.equal(urls[0].searchParams.get('pipeline_tag'), null);
  assert.deepEqual(out.models.map((m) => m.id), ['Qwen/Qwen3-0.6B-GGUF', 'unsloth/Qwen3.8-27B-GGUF']);
});

test('when Hugging Face is unreachable, the BotConnector proxy is used but non-GGUF and non-chat entries are dropped', async (t) => {
  stubFetch(t, (url) => {
    if (url.host === 'huggingface.co') throw new TypeError('fetch failed');
    return json({ models: [
      { id: 'Qwen/Qwen-Image-2.1', pipeline: 'text-to-image', library: 'diffusers' },
      { id: 'abenzerps/Qwen-Image-2.1-Uncensored-GGUF', pipeline: 'text-to-image', library: 'gguf' },
      { id: 'Qwen/Qwen3-0.6B', pipeline: 'text-generation', library: 'transformers' },
      { id: 'Qwen/Qwen3-0.6B-GGUF', pipeline: 'text-generation', library: 'gguf' },
    ] });
  });
  const out = await catalog.searchCatalog({ query: '', limit: 20 });
  assert.deepEqual(out.models.map((m) => m.id), ['Qwen/Qwen3-0.6B-GGUF']);
});

test('without a GPU only small models are rated great; mid-size is ok, large is warn', () => {
  const cpu = { ramGb: 16, nvidia: [] };
  assert.equal(hf.estimateCompatibility({ gguf: { total: 3e9 } }, cpu).level, 'great');
  assert.equal(hf.estimateCompatibility({ gguf: { total: 8e9 } }, cpu).level, 'ok');
  assert.equal(hf.estimateCompatibility({ gguf: { total: 14e9 } }, cpu).level, 'warn');
  assert.equal(hf.estimateCompatibility({ gguf: { total: 27e9 } }, cpu).level, 'no');
  assert.equal(hf.estimateCompatibility({ gguf: { total: 14e9 } }, { ramGb: 32, nvidia: [{ memoryGb: 24 }] }).level, 'great');
});

test('model size never trusts a tiny GGUF total over the size in the name', () => {
  const cpu = { ramGb: 16, nvidia: [] };
  const c = hf.estimateCompatibility({ id: 'cdiamond/Qwen3.8-27B-iMatrix-NVFP4-MTP-GGUF', gguf: { total: 5e8 } }, cpu);
  assert.equal(c.paramsB, 27);
  assert.equal(c.level, 'no');
  assert.equal(hf.estimateCompatibility({ id: 'x/Qwen3-Coder-30B-A3B-GGUF', gguf: { total: 30.5e9 } }, cpu).paramsB, 30.5);
  assert.equal(hf.estimateCompatibility({ id: 'x/Tiny-GGUF', gguf: { total: 6e8 } }, cpu).paramsB, 0.6);
});

test('GGUF repos without a pipeline tag count as chat unless the name says image or audio', async (t) => {
  stubFetch(t, () => json([
    { id: 'unsloth/Qwen3.8-27B-GGUF', tags: ['gguf'] },
    { id: 'city96/FLUX.1-dev-gguf', tags: ['gguf'] },
    { id: 'ggerganov/whisper-large-v3-GGUF', tags: ['gguf'] },
  ]));
  const out = await catalog.searchCatalog({ query: 'x', limit: 20 });
  assert.deepEqual(out.models.map((m) => m.id), ['unsloth/Qwen3.8-27B-GGUF']);
});

test('search passes hardware through so fit is known before details are fetched', async (t) => {
  stubFetch(t, () => json([{ id: 'x/Small-3B-GGUF', pipeline_tag: 'text-generation', tags: ['gguf'], gguf: { total: 3e9 } }]));
  const out = await catalog.searchCatalog({ query: '', limit: 20, hardware: { ramGb: 16, nvidia: [] } });
  assert.equal(out.models[0].compatibility.level, 'great');
});

test('the device bridge answers catalog.recommendations for app.botconnector.id', async () => {
  const { DeviceBridge } = require('../desktop/local/device-bridge.cjs');
  const cat = {
    searchCatalog: async ({ hardware }) => ({
      source: 'https://huggingface.co',
      models: [{ id: 'x/Small-3B-GGUF', downloads: 10, compatibility: hf.estimateCompatibility({ gguf: { total: 3e9 } }, hardware) }],
    }),
    modelDetails: async () => ({ capabilities: { chat: true }, compatibility: { level: 'great' } }),
  };
  const bridge = new DeviceBridge({ detectHardware: async () => ({ ramGb: 16, nvidia: [] }), catalog: cat });
  const out = await bridge.execute('catalog.recommendations', { limit: 5 });
  assert.deepEqual(out.models.map((m) => m.id), ['x/Small-3B-GGUF']);
  assert.equal(out.hardware.ramGb, 16);
});
