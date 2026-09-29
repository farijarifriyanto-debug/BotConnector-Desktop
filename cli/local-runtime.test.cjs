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
  ollamaBaseCandidates,
  lemonadeRowsFromMetadata,
  localModelRoots,
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


test('discovers Ollama from explicit host and local IPv4 interfaces', () => {
  const candidates = ollamaBaseCandidates(
    { OLLAMA_HOST: '100.95.146.3:11434' },
    {
      Loopback: [{ family: 'IPv4', address: '127.0.0.1', internal: true }],
      Tailscale: [{ family: 'IPv4', address: '100.95.146.3', internal: false }],
      WiFi: [{ family: 'IPv4', address: '192.168.1.24', internal: false }],
    },
  );

  assert.equal(candidates[0], 'http://100.95.146.3:11434');
  assert.ok(candidates.includes('http://127.0.0.1:11434'));
  assert.ok(candidates.includes('http://192.168.1.24:11434'));
  assert.equal(new Set(candidates).size, candidates.length);
});

test('uses discovered Ollama base for chat instead of assuming loopback', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bc-ollama-dynamic-'));
  const previousModels = process.env.OLLAMA_MODELS;
  const previousHost = process.env.OLLAMA_HOST;
  process.env.OLLAMA_MODELS = root;
  process.env.OLLAMA_HOST = '100.95.146.3:11434';
  try {
    writeOllamaManifest(root, 'qwen3', '4b', { local: true });
    const calls = [];
    const fetchImpl = async (url) => {
      calls.push(String(url));
      if (String(url) === 'http://100.95.146.3:11434/api/tags') {
        return jsonResponse(200, { models: [{ name: 'qwen3:4b', size: 123 }] });
      }
      if (String(url) === 'http://100.95.146.3:11434/api/chat') {
        return jsonResponse(200, {
          message: { content: 'dynamic host answer' },
          prompt_eval_count: 3,
          eval_count: 2,
        });
      }
      throw new TypeError('unavailable');
    };

    const runtime = new LocalAiRuntime({ enabled: true, fetchImpl, dataDir: root });
    runtime.runtimeManager.installed = async () => ({ installed: false });

    const result = await runtime.chat({
      model: 'qwen3:4b',
      runtime: 'ollama',
      messages: [{ role: 'user', content: 'hello' }],
    });

    assert.equal(result.content, 'dynamic host answer');
    assert.ok(calls.includes('http://100.95.146.3:11434/api/chat'));
    assert.ok(!calls.includes('http://127.0.0.1:11434/api/chat'));
  } finally {
    if (previousModels == null) delete process.env.OLLAMA_MODELS;
    else process.env.OLLAMA_MODELS = previousModels;
    if (previousHost == null) delete process.env.OLLAMA_HOST;
    else process.env.OLLAMA_HOST = previousHost;
    fs.rmSync(root, { recursive: true, force: true });
  }
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
    await assert.rejects(
      () =>
        runtime.chat({
          model: 'remote-only:cloud',
          messages: [{ role: 'user', content: 'should stay offline' }],
        }),
      /not installed locally|cloud-only/i,
    );
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

test('passes function tools to Ollama and preserves returned tool calls', async () => {
  let sent;
  const fetchImpl = async (url, init = {}) => {
    if (String(url).endsWith('/api/chat')) {
      sent = JSON.parse(init.body);
      return jsonResponse(200, {
        message: {
          content: '',
          tool_calls: [
            {
              id: 'call-search',
              type: 'function',
              function: { name: 'web_search', arguments: { query: 'BotConnector' } },
            },
          ],
        },
        prompt_eval_count: 8,
        eval_count: 3,
      });
    }
    throw new Error('Unexpected URL ' + url);
  };
  const runtime = new LocalAiRuntime({ enabled: true, fetchImpl });
  runtime.assertOllamaModelLocal = async (model) => model;
  runtime.findOllamaBase = async () => 'http://127.0.0.1:11434';

  const result = await runtime.chat({
    model: 'qwen:test',
    runtime: 'ollama',
    messages: [{ role: 'user', content: 'search the web' }],
    tools: [
      {
        type: 'function',
        function: {
          name: 'web_search',
          description: 'Search the public web',
          parameters: {
            type: 'object',
            properties: { query: { type: 'string' } },
            required: ['query'],
          },
        },
      },
    ],
  });

  assert.equal(sent.tools[0].function.name, 'web_search');
  assert.equal(result.tool_calls[0].function.name, 'web_search');
  assert.equal(result.content, '');
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


test('includes common third-party local GGUF model stores in discovery roots', () => {
  const roots = localModelRoots(path.join(os.tmpdir(), 'bc-root-test'));
  const expected = [
    path.join(os.homedir(), '.lmstudio', 'models'),
    path.join(os.homedir(), '.cache', 'lm-studio', 'models'),
    path.join(os.homedir(), 'jan', 'models'),
    path.join(os.homedir(), '.jan', 'models'),
    path.join(os.homedir(), '.cache', 'gpt4all'),
  ].map((value) => path.resolve(value));

  for (const root of expected) {
    assert.ok(roots.includes(root), 'missing discovery root: ' + root);
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

test('without a GPU, auto installs the CPU build and a Vulkan-only install is not used', async () => {
  const { RuntimeManager } = require('../desktop/local/runtime-manager.cjs');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bc-rt-'));
  const bin = process.platform === 'win32' ? 'llama-server.exe' : 'llama-server';
  const put = (backend) => {
    const d = path.join(dir, 'b1', backend, 'llama-b1');
    fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(path.join(d, bin), '');
    return path.join(d, bin);
  };
  const manager = new RuntimeManager({ baseDir: dir, emit: () => {} });
  const vulkan = put('vulkan');
  assert.deepEqual(await manager.installed({ gpu: false }), { installed: false, binary: null });
  assert.equal((await manager.installed({ gpu: true })).binary, vulkan);
  const cpu = put('cpu');
  assert.equal((await manager.installed({ gpu: false })).binary, cpu);
  assert.equal((await manager.installed({ gpu: true })).binary, vulkan);

  const runtime = new LocalAiRuntime({ enabled: true, detectHardware: async () => ({ nvidia: [], amd: [], intel: [] }) });
  let chosen;
  runtime.runtimeManager.install = async ({ backend }) => { chosen = backend; return { backend, release: 'b1', version: 'x' }; };
  const job = await runtime.startRuntimeInstall('auto');
  for (let i = 0; i < 50 && runtime.runtimeJobStatus(job.id).status !== 'completed'; i++) await new Promise((r) => setTimeout(r, 10));
  assert.equal(chosen, 'cpu');

  const gpuRuntime = new LocalAiRuntime({ enabled: true, detectHardware: async () => ({ nvidia: [{ name: 'RTX' }], amd: [], intel: [] }) });
  gpuRuntime.runtimeManager.install = async ({ backend }) => { chosen = backend; return { backend, release: 'b1', version: 'x' }; };
  await gpuRuntime.startRuntimeInstall('auto');
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(chosen, 'auto');
});

test('a missing Linux system library names the package to install', { skip: process.platform === 'win32' }, async () => {
  const { verifyBinary } = require('../desktop/local/runtime-manager.cjs');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bc-lib-'));
  const bin = path.join(dir, 'llama-server');
  fs.writeFileSync(bin, '#!/bin/sh\necho "llama-server: error while loading shared libraries: libgomp.so.1: cannot open shared object file" >&2\nexit 127\n', { mode: 0o755 });
  await assert.rejects(verifyBinary(bin), /sudo apt install libgomp1/);
});

function streamResponse(chunks) {
  const enc = new TextEncoder();
  return new Response(new ReadableStream({
    start(c) { for (const ch of chunks) c.enqueue(enc.encode(ch)); c.close(); },
  }), { status: 200 });
}

test('chat streams OpenAI-style deltas (Lemonade/llama.cpp) including reasoning and temperature', async () => {
  let sent;
  const fetchImpl = async (url, init) => {
    if (url.endsWith('/v1/load')) return jsonResponse(200, {});
    if (url.endsWith('/v1/chat/completions')) {
      sent = JSON.parse(init.body);
      return streamResponse([
        'data: {"choices":[{"delta":{"reasoning_content":"hm"}}]}\n\ndata: {"choices":[{"del',
        'ta":{"content":"Hal"}}]}\n\n',
        'data: {"choices":[{"delta":{"content":"o"}}],"usage":{"completion_tokens":2}}\n\ndata: [DONE]\n\n',
      ]);
    }
    throw new Error('Unexpected URL ' + url);
  };
  const runtime = new LocalAiRuntime({ enabled: true, fetchImpl });
  const deltas = [];
  const out = await runtime.chat({
    model: 'Qwen-Test-GGUF', runtime: 'lemonade', options: { temperature: 0.2 },
    messages: [{ role: 'system', content: 'Be brief.' }, { role: 'user', content: 'hai' }],
    onDelta: (d) => deltas.push(d),
  });
  assert.equal(sent.stream, true);
  assert.equal(sent.temperature, 0.2);
  assert.deepEqual(deltas, [{ reasoning: 'hm' }, { content: 'Hal' }, { content: 'o' }]);
  assert.equal(out.content, 'Halo');
  assert.equal(out.reasoning, 'hm');
  assert.equal(out.usage.completion_tokens, 2);
});

test('chat streams Ollama NDJSON deltas', async () => {
  const fetchImpl = async (url, init) => {
    if (url.endsWith('/api/tags')) return jsonResponse(200, { models: [] });
    if (url.endsWith('/api/chat')) {
      assert.equal(JSON.parse(init.body).stream, true);
      return streamResponse([
        '{"message":{"content":"Ja"},"done":false}\n{"message":{"content":"karta"},"done":false}\n',
        '{"message":{"content":""},"done":true,"prompt_eval_count":5,"eval_count":2}\n',
      ]);
    }
    throw new Error('Unexpected URL ' + url);
  };
  const runtime = new LocalAiRuntime({ enabled: true, fetchImpl });
  runtime.assertOllamaModelLocal = async (m) => m;
  const deltas = [];
  const out = await runtime.chat({ model: 'qwen:0.5b', runtime: 'ollama', messages: [{ role: 'user', content: 'x' }], onDelta: (d) => deltas.push(d) });
  assert.deepEqual(deltas, [{ content: 'Ja' }, { content: 'karta' }]);
  assert.equal(out.content, 'Jakarta');
  assert.deepEqual(out.usage, { prompt_tokens: 5, completion_tokens: 2 });
});


test('status reports loaded models from secondary runtimes even when managed llama.cpp is primary', async () => {
  const fetchImpl = async (url) => {
    if (String(url).endsWith('/api/tags')) throw new TypeError('ollama unavailable');
    if (String(url).endsWith('/v1/health')) {
      return jsonResponse(200, {
        status: 'ok',
        model_loaded: 'Qwen3-0.6B-GGUF',
        all_models_loaded: [{ model_name: 'Qwen3-0.6B-GGUF' }],
      });
    }
    throw new Error('Unexpected URL ' + url);
  };

  const runtime = new LocalAiRuntime({ enabled: true, fetchImpl });
  runtime.runtimeManager.installed = async () => ({ installed: true, binary: '/tmp/llama-server' });
  runtime.findOllamaBase = async () => null;
  runtime.listModels = async () => [
    { id: 'managed-model', runtime: 'llamacpp' },
    { id: 'Qwen3-0.6B-GGUF', runtime: 'lemonade' },
  ];

  const status = await runtime.status();
  assert.equal(status.runtime, 'llamacpp');
  assert.equal(status.activeModel, 'Qwen3-0.6B-GGUF');
  assert.deepEqual(status.loadedModels, ['Qwen3-0.6B-GGUF']);
  assert.deepEqual(
    status.runtimes.map((item) => item.runtime),
    ['llamacpp', 'lemonade'],
  );
  assert.deepEqual(status.runtimes[1].loadedModels, ['Qwen3-0.6B-GGUF']);
});


test('benchmark stores measured local throughput and reuses runtime token timing when available', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bc-benchmark-'));
  try {
    const runtime = new LocalAiRuntime({
      enabled: true,
      dataDir: root,
      detectHardware: async () => ({ cpu: 'Test CPU', ramGb: 16, nvidia: [{ name: 'Test GPU' }], amd: [], intel: [] }),
    });
    let unloaded = null;
    runtime.chat = async () => ({
      content: 'benchmark result',
      usage: { prompt_tokens: 12, completion_tokens: 48 },
      performance: {
        tokens_per_second: 24.5,
        prompt_tokens_per_second: 180.2,
        load_ms: 750,
        prompt_ms: 120,
        generation_ms: 1959,
      },
    });
    runtime.unloadModel = async (model, runtimeName) => {
      unloaded = { model, runtime: runtimeName };
      return { loaded: false, model, runtime: runtimeName };
    };
    const result = await runtime.benchmarkModel('model-1', 'ollama');
    assert.equal(result.tokensPerSecond, 24.5);
    assert.equal(result.source, 'runtime');
    assert.equal(result.benchmarkVersion, 2);
    assert.equal(result.contextTokens, 4096);
    assert.equal(result.completionTokens, 48);
    assert.equal(result.promptTokensPerSecond, 180.2);
    assert.equal(result.loadMs, 750);
    assert.equal(result.promptMs, 120);
    assert.equal(result.generationMs, 1959);
    assert.equal(result.hardware.gpu, 'Test GPU');
    assert.deepEqual(unloaded, { model: 'model-1', runtime: 'ollama' });

    const saved = runtime.benchmarkResults().benchmarks;
    assert.equal(saved.length, 1);
    assert.equal(saved[0].model, 'model-1');
    assert.equal(saved[0].runtime, 'ollama');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});


test('benchmark unloads the model even when inference fails', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bc-benchmark-fail-'));
  try {
    const runtime = new LocalAiRuntime({ enabled: true, dataDir: root });
    let unloaded = false;
    runtime.chat = async () => { throw new Error('benchmark inference failed'); };
    runtime.unloadModel = async () => { unloaded = true; return { loaded: false }; };
    await assert.rejects(runtime.benchmarkModel('model-fail', 'ollama'), /benchmark inference failed/);
    assert.equal(unloaded, true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
