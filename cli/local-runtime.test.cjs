const test = require('node:test');
const assert = require('node:assert/strict');
const { LocalAiRuntime, normalizeMessages, validModelName } = require('./local-runtime.cjs');

function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

test('local AI is deny-by-default', async () => {
  const runtime = new LocalAiRuntime();
  await assert.rejects(() => runtime.status(), /not allowed/i);
});

test('validates model names and chat payloads', () => {
  assert.equal(validModelName('qwen3:4b'), 'qwen3:4b');
  assert.throws(() => validModelName('../../bad model'), /invalid/i);
  assert.equal(normalizeMessages([{ role: 'user', content: 'hi' }])[0].content, 'hi');
  assert.throws(() => normalizeMessages([{ role: 'developer', content: 'x' }]), /role/i);
});

test('detects Ollama, lists models, and chats locally', async () => {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url, init });
    if (url.endsWith('/api/tags')) {
      return jsonResponse(200, { models: [{ name: 'qwen3:4b', size: 123 }] });
    }
    if (url.endsWith('/api/chat')) {
      return jsonResponse(200, {
        message: { content: 'local answer' },
        prompt_eval_count: 10,
        eval_count: 4,
      });
    }
    throw new Error('Unexpected URL ' + url);
  };

  const runtime = new LocalAiRuntime({ enabled: true, fetchImpl });
  const status = await runtime.status();
  assert.equal(status.runtime, 'ollama');
  const models = await runtime.listModels();
  assert.equal(models[0].path, 'device:ollama:qwen3:4b');
  const result = await runtime.chat({
    model: 'qwen3:4b',
    messages: [{ role: 'user', content: 'hello' }],
  });
  assert.equal(result.content, 'local answer');
  assert.equal(result.runtime, 'ollama');
  assert.ok(calls.every((call) => String(call.url).startsWith('http://127.0.0.1:11434')));
});

test('falls back to Lemonade when Ollama is unavailable', async () => {
  const fetchImpl = async (url) => {
    if (url.endsWith('/api/tags')) throw new TypeError('Failed to fetch');
    if (url.endsWith('/v1/health')) return jsonResponse(200, { status: 'ok' });
    if (url.endsWith('/v1/models')) {
      return jsonResponse(200, { data: [{ id: 'Qwen-Test-GGUF', downloaded: true }] });
    }
    throw new Error('Unexpected URL ' + url);
  };

  const runtime = new LocalAiRuntime({ enabled: true, fetchImpl });
  const status = await runtime.status();
  assert.equal(status.runtime, 'lemonade');
  const models = await runtime.listModels();
  assert.equal(models[0].path, 'device:lemonade:Qwen-Test-GGUF');
});
