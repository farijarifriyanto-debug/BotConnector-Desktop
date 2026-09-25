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
  isPathInside,
  scanExternalGguf,
  scanOllamaStore,
  lemonadeRowsFromMetadata,
} = require('./local-runtime.cjs');

function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

function writeOllamaManifest(root, model, tag = 'latest', { local = true } = {}) {
  const dir = path.join(root, 'manifests', 'registry.ollama.ai', 'library', model);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, tag),
    JSON.stringify({
      config: { size: 10 },
      layers: local
        ? [{ mediaType: 'application/vnd.ollama.image.model', size: 100 }]
        : [],
    }),
  );
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

test('detects Ollama, exposes only verified local models, and chats locally', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bc-ollama-api-'));
  const previous = process.env.OLLAMA_MODELS;
  process.env.OLLAMA_MODELS = root;
  try {
    writeOllamaManifest(root, 'qwen3', '4b', { local: true });
    writeOllamaManifest(root, 'remote-only', 'cloud', { local: false });

    const calls = [];
    const fetchImpl = async (url, init = {}) => {
      calls.push({ url, init });
      if (url.endsWith('/api/tags')) {
        return jsonResponse(200, {
          models: [
            { name: 'qwen3:4b', size: 123 },
            { name: 'remote-only:cloud', size: 10 },
          ],
        });
      }
      if (url.endsWith('/api/chat')) {
        return jsonResponse(200, {
          message: { content: 'local answer' },
          prompt_eval_count: 10,
          eval_count: 4,
        });
      }
      if (url.endsWith('/api/ps')) return jsonResponse(200, { models: [] });
      throw new Error('Unexpected URL ' + url);
    };

    const runtime = new LocalAiRuntime({ enabled: true, fetchImpl });
    const status = await runtime.status();
    assert.equal(status.runtime, 'ollama');
    const models = await runtime.listModels();
    assert.deepEqual(
      models.filter((model) => model.runtime === 'ollama').map((model) => model.id),
      ['qwen3:4b'],
    );
    const result = await runtime.chat({
      model: 'qwen3:4b',
      messages: [{ role: 'user', content: 'hello' }],
    });
    assert.equal(result.content, 'local answer');
    assert.equal(result.runtime, 'ollama');
    assert.ok(
      calls.some(
        (call) =>
          String(call.url).startsWith('http://127.0.0.1:11434') &&
          String(call.url).endsWith('/api/chat'),
      ),
    );
  } finally {
    if (previous == null) delete process.env.OLLAMA_MODELS;
    else process.env.OLLAMA_MODELS = previous;
    fs.rmSync(root, { recursive: true, force: true });
  }
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


test('aggregates verified local Ollama and Lemonade models instead of hiding secondary runtimes', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bc-aggregate-'));
  const ollamaRoot = path.join(root, 'ollama-models');
  const previous = process.env.OLLAMA_MODELS;
  process.env.OLLAMA_MODELS = ollamaRoot;
  try {
    writeOllamaManifest(ollamaRoot, 'ollama-model', 'latest', { local: true });

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
    if (previous == null) delete process.env.OLLAMA_MODELS;
    else process.env.OLLAMA_MODELS = previous;
    fs.rmSync(root, { recursive: true, force: true });
  }
});


test('discovers existing GGUF files outside the BotConnector managed model directory', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bc-existing-gguf-'));
  try {
    const managed = path.join(root, 'managed');
    const external = path.join(root, 'hf-cache');
    const modelDir = path.join(external, 'models--Example--Local', 'snapshots', 'abc');
    fs.mkdirSync(managed, { recursive: true });
    fs.mkdirSync(modelDir, { recursive: true });
    const gguf = path.join(modelDir, 'existing-model-Q4_K_M.gguf');
    fs.writeFileSync(gguf, 'existing-model');
    fs.writeFileSync(path.join(modelDir, 'mmproj-model.gguf'), 'projector');

    const rows = await scanExternalGguf([managed, external], managed);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].path, path.resolve(gguf));
    assert.equal(rows[0].quant, 'Q4_K_M');

    assert.equal(await isPathInside(gguf, [external]), true);
    assert.equal(await isPathInside(path.join(root, 'outside.gguf'), [external]), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('listModels includes existing local GGUF even when external runtimes are stopped', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bc-existing-list-'));
  try {
    const external = path.join(root, 'existing-models');
    fs.mkdirSync(external, { recursive: true });
    const gguf = path.join(external, 'legacy-Q5_K_M.gguf');
    fs.writeFileSync(gguf, 'legacy-model');

    const fetchImpl = async () => {
      throw new TypeError('runtime offline');
    };
    const runtime = new LocalAiRuntime({ enabled: true, fetchImpl, dataDir: path.join(root, 'bc') });
    runtime.runtimeManager.installed = async () => ({ installed: false });
    runtime.externalRoots = [external];
    runtime.externalScanCache = { at: 0, models: [] };

    const models = await runtime.listModels();
    assert.equal(models.length, 1);
    assert.equal(models[0].runtime, 'external-gguf');
    assert.equal(models[0].name, 'legacy-Q5_K_M.gguf');
    assert.match(models[0].path, /^device:external-gguf:/);

    await assert.rejects(
      () => runtime.deleteModel(models[0].id, 'external-gguf'),
      /read-only/i,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});


test('discovers Ollama manifests even when Ollama daemon is stopped', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bc-ollama-store-'));
  try {
    const manifestDir = path.join(
      root,
      'manifests',
      'registry.ollama.ai',
      'library',
      'qwen3',
    );
    fs.mkdirSync(manifestDir, { recursive: true });
    fs.writeFileSync(
      path.join(manifestDir, '4b'),
      JSON.stringify({
        config: { size: 10 },
        layers: [
          { mediaType: 'application/vnd.ollama.image.model', size: 100 },
          { mediaType: 'application/vnd.ollama.image.template', size: 200 },
        ],
      }),
    );
    fs.writeFileSync(
      path.join(manifestDir, 'cloud'),
      JSON.stringify({
        config: { size: 326 },
        layers: [],
      }),
    );

    const rows = await scanOllamaStore(root);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].id, 'qwen3:4b');
    assert.equal(rows[0].runtime, 'ollama');
    assert.equal(rows[0].source, 'Ollama local store');
    assert.equal(rows[0].deletable, false);
    assert.equal(rows[0].runnable, false);
    assert.equal(rows[0].size, 110);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('extracts Lemonade model metadata without requiring the Lemonade server', () => {
  const rows = lemonadeRowsFromMetadata({
    data: [
      {
        id: 'Qwen3-0.6B-NPU',
        recipe: 'ryzenai-llm',
        checkpoint: 'Example/Qwen3-0.6B',
        downloaded: true,
      },
    ],
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, 'Qwen3-0.6B-NPU');
  assert.equal(rows[0].runtime, 'lemonade');
  assert.equal(rows[0].source, 'Lemonade local metadata');
  assert.equal(rows[0].deletable, false);
});
