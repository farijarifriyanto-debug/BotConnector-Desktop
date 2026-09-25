const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  LocalAiRuntime,
  normalizeMessages,
  validModelName,
  encodeManagedModel,
  decodeManagedModel,
  chooseGgufGroup,
} = require('./local-runtime.cjs');

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


test('managed model ids stay confined to the BotConnector model directory', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bc-device-model-'));
  try {
    const modelDir = path.join(root, 'models');
    const file = path.join(modelDir, 'repo', 'Q4_K_M', 'model.gguf');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, 'test');

    const id = encodeManagedModel(file);
    assert.equal(decodeManagedModel(id, modelDir), path.resolve(file));

    const outside = encodeManagedModel(path.join(root, 'outside.gguf'));
    assert.throws(() => decodeManagedModel(outside, modelDir), /outside/i);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('managed GGUF download prefers Q4_K_M', () => {
  const group = chooseGgufGroup({
    files: [
      { quant: 'Q8_0', size: 8, parts: [{ path: 'q8.gguf' }] },
      { quant: 'Q4_K_M', size: 4, parts: [{ path: 'q4.gguf' }] },
      { quant: 'Q3_K_M', size: 3, parts: [{ path: 'q3.gguf' }] },
    ],
  });
  assert.equal(group.quant, 'Q4_K_M');
});


test('aggregates managed, Ollama, and Lemonade models instead of hiding secondary runtimes', async () => {
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bc-aggregate-'));
  try {
    const fetchImpl = async (url) => {
      if (url.endsWith('/api/tags')) {
        return jsonResponse(200, { models: [{ name: 'ollama-model:latest', size: 111 }] });
      }
      if (url.endsWith('/v1/models')) {
        return jsonResponse(200, {
          data: [{ id: 'lemonade-model', downloaded: true, recipe: 'llamacpp' }],
        });
      }
      if (url.endsWith('/v1/health')) {
        return jsonResponse(200, { status: 'ok' });
      }
      throw new Error('Unexpected URL ' + url);
    };

    const runtime = new LocalAiRuntime({ enabled: true, fetchImpl, dataDir: root });
    runtime.runtimeManager.installed = async () => ({ installed: false });

    const models = await runtime.listModels();
    assert.deepEqual(
      models.map((model) => model.runtime).sort(),
      ['lemonade', 'ollama'],
    );
    assert.ok(models.some((model) => model.id === 'ollama-model:latest'));
    assert.ok(models.some((model) => model.id === 'lemonade-model'));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
