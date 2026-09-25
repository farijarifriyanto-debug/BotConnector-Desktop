const crypto = require('node:crypto');
const os = require('node:os');
const path = require('node:path');
const fsp = require('node:fs/promises');
const { spawn } = require('node:child_process');
const { RuntimeManager } = require('../desktop/local/runtime-manager.cjs');
const { DownloadManager } = require('../desktop/local/downloads.cjs');
const { scanInstalled } = require('../desktop/local/installed.cjs');
const hf = require('../desktop/local/hf.cjs');

const OLLAMA_BASE = 'http://127.0.0.1:11434';
const LEMONADE_BASE = 'http://127.0.0.1:13305';
const MANAGED_LLAMA_BASE = 'http://127.0.0.1:11436';
const MAX_MESSAGES = 128;
const MAX_CHAT_CHARS = 200 * 1024;
const MAX_MODEL_NAME = 256;

function validModelName(value) {
  const name = String(value || '').trim();
  if (!name || name.length > MAX_MODEL_NAME) throw new Error('Invalid local model name.');
  if (!/^[A-Za-z0-9._:/@+\-]+$/.test(name)) throw new Error('Invalid local model name.');
  return name;
}

function normalizeMessages(messages) {
  if (!Array.isArray(messages) || messages.length === 0 || messages.length > MAX_MESSAGES) {
    throw new Error('Local chat requires between 1 and 128 messages.');
  }
  let total = 0;
  return messages.map((message) => {
    const role = String(message?.role || '');
    if (!['system', 'user', 'assistant', 'tool'].includes(role)) {
      throw new Error('Unsupported local chat role.');
    }
    const content = message?.content == null ? '' : String(message.content);
    total += content.length;
    if (total > MAX_CHAT_CHARS) throw new Error('Local chat payload is too large.');
    return { role, content };
  });
}

async function responseJson(response) {
  return response.json().catch(() => ({}));
}

function encodeManagedModel(filePath) {
  return Buffer.from(String(filePath), 'utf8').toString('base64url');
}

function decodeManagedModel(id, modelsDir) {
  const token = validModelName(id);
  let decoded;
  try {
    decoded = Buffer.from(token, 'base64url').toString('utf8');
  } catch {
    throw new Error('Invalid managed model id.');
  }
  const root = path.resolve(modelsDir);
  const target = path.resolve(decoded);
  const relative = path.relative(root, target);
  if (!relative || relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) {
    throw new Error('Managed model path is outside the BotConnector model directory.');
  }
  return target;
}

function chooseGgufGroup(details) {
  const groups = Array.isArray(details?.files) ? details.files : [];
  if (!groups.length) throw new Error('No GGUF files were found for this model repository.');
  const preferred =
    groups.find((group) => /Q4_K_M/i.test(String(group?.quant || group?.key || ''))) ||
    groups.find((group) => /Q5_K_M/i.test(String(group?.quant || group?.key || ''))) ||
    groups.slice().sort((a, b) => Number(a?.size || 0) - Number(b?.size || 0))[0];
  if (!preferred?.parts?.length) throw new Error('No downloadable GGUF group was found.');
  return preferred;
}

class LocalAiRuntime {
  constructor({
    enabled = false,
    fetchImpl = globalThis.fetch,
    emit = () => {},
    dataDir = process.env.BOTCONNECTOR_DEVICE_DATA_DIR || path.join(os.homedir(), '.botconnector-device'),
  } = {}) {
    this.enabled = Boolean(enabled);
    this.fetch = fetchImpl;
    this.emit = emit;
    this.jobs = new Map();
    this.runtimeJobs = new Map();
    this.dataDir = path.resolve(dataDir);
    this.runtimeDir = path.join(this.dataDir, 'runtime');
    this.modelsDir = path.join(this.dataDir, 'models');
    this.managedProcess = null;
    this.managedModel = null;

    this.runtimeManager = new RuntimeManager({
      baseDir: this.runtimeDir,
      emit: (event, payload) => this.emit(event, payload),
    });
    this.downloadManager = new DownloadManager({
      getModelsDir: () => this.modelsDir,
      getToken: () => process.env.HF_TOKEN || '',
      emit: (event, payload) => this.emit(event, payload),
    });
  }

  assertEnabled() {
    if (!this.enabled) throw new Error('Local AI access is not allowed for this session.');
  }

  async fetchJson(url, init = {}, timeoutMs = 15_000) {
    const response = await this.fetch(url, {
      ...init,
      cache: 'no-store',
      signal: init.signal || AbortSignal.timeout(timeoutMs),
    });
    const body = await responseJson(response);
    if (!response.ok) {
      throw new Error(
        body?.error?.message ||
          body?.error ||
          body?.message ||
          `Local runtime HTTP ${response.status}`,
      );
    }
    return body;
  }

  managedRunning() {
    return Boolean(this.managedProcess && this.managedProcess.exitCode === null);
  }

  async detect() {
    this.assertEnabled();

    const managed = await this.runtimeManager.installed().catch(() => ({ installed: false }));
    if (managed?.installed) {
      return { kind: 'llamacpp', baseUrl: MANAGED_LLAMA_BASE, binary: managed.binary };
    }

    try {
      const payload = await this.fetchJson(`${OLLAMA_BASE}/api/tags`, { method: 'GET' }, 1800);
      if (Array.isArray(payload?.models)) return { kind: 'ollama', baseUrl: OLLAMA_BASE };
    } catch {}

    try {
      const payload = await this.fetchJson(
        `${LEMONADE_BASE}/v1/health`,
        { method: 'GET' },
        1800,
      );
      if (!payload?.status || payload.status === 'ok') {
        return { kind: 'lemonade', baseUrl: LEMONADE_BASE };
      }
    } catch {}

    return null;
  }

  async status() {
    this.assertEnabled();
    const runtime = await this.detect();
    if (!runtime) {
      return {
        available: false,
        runtime: null,
        installable: true,
        message:
          'No local AI runtime is available. BotConnector can install its managed llama.cpp runtime without a desktop installer.',
      };
    }

    const models = await this.listModels(runtime);
    let loadedModels = [];

    if (runtime.kind === 'llamacpp') {
      if (this.managedRunning() && this.managedModel) loadedModels = [this.managedModel];
    } else if (runtime.kind === 'ollama') {
      try {
        const running = await this.fetchJson(`${OLLAMA_BASE}/api/ps`, { method: 'GET' }, 3000);
        loadedModels = (Array.isArray(running?.models) ? running.models : [])
          .map((model) => String(model?.name || model?.model || ''))
          .filter(Boolean);
      } catch {}
    } else {
      try {
        const health = await this.fetchJson(
          `${LEMONADE_BASE}/v1/health`,
          { method: 'GET' },
          3000,
        );
        const primary = String(health?.model_loaded || '');
        loadedModels = [
          ...(primary ? [primary] : []),
          ...(Array.isArray(health?.all_models_loaded)
            ? health.all_models_loaded
                .map((row) => String(row?.model_name || ''))
                .filter(Boolean)
            : []),
        ];
        loadedModels = [...new Set(loadedModels)];
      } catch {}
    }

    return {
      available: true,
      runtime: runtime.kind,
      baseUrl: runtime.baseUrl,
      models: models.length,
      activeModel: loadedModels[0] || null,
      loadedModels,
      managed: runtime.kind === 'llamacpp',
    };
  }

  async listModels(runtimeOverride = null) {
    this.assertEnabled();
    const runtime = runtimeOverride || (await this.detect());
    if (!runtime) return [];

    if (runtime.kind === 'llamacpp') {
      await fsp.mkdir(this.modelsDir, { recursive: true });
      const installed = await scanInstalled(this.modelsDir);
      return installed.map((model) => ({
        id: encodeManagedModel(model.path),
        name: model.repoId || model.name,
        size: model.size,
        runtime: 'llamacpp',
        path: `device:llamacpp:${encodeManagedModel(model.path)}`,
        recipe: 'llama.cpp',
        quant: model.quant || undefined,
        repoId: model.repoId || undefined,
      }));
    }

    if (runtime.kind === 'ollama') {
      const payload = await this.fetchJson(`${OLLAMA_BASE}/api/tags`);
      return (Array.isArray(payload?.models) ? payload.models : [])
        .map((model) => ({
          id: String(model?.name || model?.model || ''),
          name: String(model?.name || model?.model || ''),
          size: Number(model?.size || 0) || undefined,
          modifiedAt: model?.modified_at || undefined,
          digest: model?.digest || undefined,
          runtime: 'ollama',
          path: `device:ollama:${String(model?.name || model?.model || '')}`,
        }))
        .filter((model) => model.id);
    }

    const payload = await this.fetchJson(`${LEMONADE_BASE}/v1/models`);
    return (Array.isArray(payload?.data) ? payload.data : [])
      .filter((model) => model?.id)
      .map((model) => ({
        id: String(model.id),
        name: String(model.id),
        size:
          typeof model?.size === 'number'
            ? Math.round(model.size * 1024 ** 3)
            : undefined,
        runtime: 'lemonade',
        path: `device:lemonade:${String(model.id)}`,
        recipe: model?.recipe || undefined,
        downloaded: model?.downloaded !== false,
      }))
      .filter((model) => model.downloaded !== false);
  }

  publicJob(job) {
    const { controller, ...safe } = job;
    return { ...safe };
  }

  listJobs() {
    this.assertEnabled();
    const managed = this.downloadManager.list().map((job) => ({
      ...job,
      runtime: 'llamacpp',
      model: job.repoId,
      percent:
        Number(job.totalBytes || 0) > 0
          ? Math.max(
              0,
              Math.min(
                100,
                Math.round((Number(job.downloadedBytes || 0) / Number(job.totalBytes)) * 100),
              ),
            )
          : 0,
    }));
    return [
      ...[...this.jobs.values()].map((job) => this.publicJob(job)),
      ...managed,
    ];
  }

  jobStatus(id) {
    this.assertEnabled();
    const key = String(id || '');
    const job = this.jobs.get(key);
    if (job) return this.publicJob(job);
    const managed = this.listJobs().find((item) => item.id === key);
    if (!managed) throw new Error('Download job not found.');
    return managed;
  }

  async startRuntimeInstall(backend = 'auto') {
    this.assertEnabled();
    const job = {
      id: crypto.randomUUID(),
      kind: 'runtime-install',
      runtime: 'llamacpp',
      backend: String(backend || 'auto'),
      status: 'queued',
      percent: 0,
      error: null,
      startedAt: new Date().toISOString(),
      completedAt: null,
      controller: new AbortController(),
    };
    this.runtimeJobs.set(job.id, job);
    this.runRuntimeInstall(job).catch(() => {});
    return this.publicJob(job);
  }

  async runRuntimeInstall(job) {
    job.status = 'installing';
    this.emit('local-ai:runtime-install', this.publicJob(job));
    try {
      const result = await this.runtimeManager.install({ backend: job.backend });
      job.status = 'completed';
      job.percent = 100;
      job.result = {
        backend: result.backend,
        release: result.release,
        version: result.version,
      };
      job.completedAt = new Date().toISOString();
      this.emit('local-ai:runtime-install', this.publicJob(job));
    } catch (error) {
      job.status = 'failed';
      job.error = String(error?.message || error);
      job.completedAt = new Date().toISOString();
      this.emit('local-ai:runtime-install', this.publicJob(job));
    }
  }

  runtimeJobStatus(id) {
    this.assertEnabled();
    const job = this.runtimeJobs.get(String(id || ''));
    if (!job) throw new Error('Runtime install job not found.');
    return this.publicJob(job);
  }

  listRuntimeJobs() {
    this.assertEnabled();
    return [...this.runtimeJobs.values()].map((job) => this.publicJob(job));
  }

  async startPull(model) {
    this.assertEnabled();
    const modelName = validModelName(model);
    const runtime = await this.detect();
    if (!runtime) throw new Error('Install or start a local AI runtime first.');

    if (runtime.kind === 'llamacpp') {
      const job = {
        id: crypto.randomUUID(),
        model: modelName,
        runtime: 'llamacpp',
        status: 'queued',
        percent: 0,
        error: null,
        startedAt: new Date().toISOString(),
        completedAt: null,
        controller: new AbortController(),
      };
      this.jobs.set(job.id, job);
      this.runManagedPull(job).catch(() => {});
      return this.publicJob(job);
    }

    const job = {
      id: crypto.randomUUID(),
      model: modelName,
      runtime: runtime.kind,
      status: 'queued',
      completed: 0,
      total: 0,
      percent: 0,
      error: null,
      startedAt: new Date().toISOString(),
      completedAt: null,
      controller: new AbortController(),
    };
    this.jobs.set(job.id, job);
    this.runPull(job).catch(() => {});
    return this.publicJob(job);
  }

  async runManagedPull(job) {
    job.status = 'resolving';
    this.emit('local-ai:download', this.publicJob(job));
    try {
      const details = await hf.modelDetails({
        id: job.model,
        hardware: null,
        token: process.env.HF_TOKEN || '',
      });
      const group = chooseGgufGroup(details);
      job.status = 'downloading';
      job.quant = group.quant;
      this.emit('local-ai:download', this.publicJob(job));

      const child = await this.downloadManager.start({
        repoId: job.model,
        group,
        metadata: {
          capabilities: details.capabilities || {},
          pipeline_tag: details.pipeline_tag || null,
        },
      });
      job.childJobId = child.id;

      while (true) {
        if (job.controller.signal.aborted) {
          this.downloadManager.cancel(child.id);
          throw new DOMException('Aborted', 'AbortError');
        }
        const state = this.downloadManager.list().find((item) => item.id === child.id);
        if (!state) throw new Error('Managed model download job disappeared.');
        job.completed = Number(state.downloadedBytes || 0);
        job.total = Number(state.totalBytes || 0);
        job.percent =
          job.total > 0
            ? Math.max(0, Math.min(100, Math.round((job.completed / job.total) * 100)))
            : 0;
        job.detail = state.status;
        this.emit('local-ai:download', this.publicJob(job));

        if (state.status === 'completed') break;
        if (['failed', 'cancelled'].includes(state.status)) {
          throw new Error(state.error || `Model download ${state.status}.`);
        }
        await new Promise((resolve) => setTimeout(resolve, 750));
      }

      job.status = 'completed';
      job.percent = 100;
      job.completedAt = new Date().toISOString();
      this.emit('local-ai:download', this.publicJob(job));
    } catch (error) {
      job.status = error?.name === 'AbortError' ? 'cancelled' : 'failed';
      job.error = String(error?.message || error);
      job.completedAt = new Date().toISOString();
      this.emit('local-ai:download', this.publicJob(job));
    }
  }

  async runPull(job) {
    job.status = 'downloading';
    this.emit('local-ai:download', this.publicJob(job));

    try {
      if (job.runtime === 'ollama') {
        const response = await this.fetch(`${OLLAMA_BASE}/api/pull`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ model: job.model, stream: true }),
          signal: job.controller.signal,
        });
        if (!response.ok) {
          const body = await responseJson(response);
          throw new Error(body?.error || `Ollama pull HTTP ${response.status}`);
        }
        if (!response.body) throw new Error('Ollama pull returned no response body.');

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let newline;
          while ((newline = buffer.indexOf('\n')) >= 0) {
            const line = buffer.slice(0, newline).trim();
            buffer = buffer.slice(newline + 1);
            if (!line) continue;
            let row;
            try {
              row = JSON.parse(line);
            } catch {
              continue;
            }
            if (row.error) throw new Error(String(row.error));
            if (Number.isFinite(row.completed)) job.completed = Number(row.completed);
            if (Number.isFinite(row.total)) job.total = Number(row.total);
            if (job.total > 0) {
              job.percent = Math.max(
                0,
                Math.min(100, Math.round((job.completed / job.total) * 100)),
              );
            }
            if (row.status) job.detail = String(row.status);
            this.emit('local-ai:download', this.publicJob(job));
          }
        }
      } else {
        await this.fetchJson(
          `${LEMONADE_BASE}/v1/pull`,
          {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ model_name: job.model, stream: false }),
            signal: job.controller.signal,
          },
          60 * 60 * 1000,
        );
      }

      job.status = 'completed';
      job.percent = 100;
      job.completedAt = new Date().toISOString();
      this.emit('local-ai:download', this.publicJob(job));
    } catch (error) {
      job.status = error?.name === 'AbortError' ? 'cancelled' : 'failed';
      job.error = String(error?.message || error);
      job.completedAt = new Date().toISOString();
      this.emit('local-ai:download', this.publicJob(job));
    }
  }

  cancelPull(id) {
    this.assertEnabled();
    const key = String(id || '');
    const job = this.jobs.get(key);
    if (job) {
      if (['completed', 'failed', 'cancelled'].includes(job.status)) return this.publicJob(job);
      job.status = 'cancelled';
      job.controller.abort();
      if (job.childJobId) this.downloadManager.cancel(job.childJobId);
      return this.publicJob(job);
    }
    const managed = this.downloadManager.list().find((item) => item.id === key);
    if (!managed) throw new Error('Download job not found.');
    this.downloadManager.cancel(key);
    return this.jobStatus(key);
  }

  async deleteModel(model, runtimeHint = '') {
    this.assertEnabled();
    const modelName = validModelName(model);
    const runtime = runtimeHint || (await this.detect())?.kind;
    if (!runtime) throw new Error('No supported local AI runtime is available.');

    if (runtime === 'llamacpp') {
      const modelPath = decodeManagedModel(modelName, this.modelsDir);
      if (this.managedModel === modelName) await this.unloadModel(modelName, 'llamacpp');
      await fsp.rm(path.dirname(modelPath), { recursive: true, force: true });
      return { deleted: true, model: modelName, runtime };
    }

    if (runtime === 'ollama') {
      await this.fetchJson(`${OLLAMA_BASE}/api/delete`, {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model: modelName }),
      });
    } else {
      await this.fetchJson(`${LEMONADE_BASE}/v1/delete`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model_name: modelName }),
      });
    }
    return { deleted: true, model: modelName, runtime };
  }

  async waitManagedReady(timeoutMs = 120_000) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      if (!this.managedRunning()) throw new Error('Managed llama.cpp exited before becoming ready.');
      try {
        const response = await this.fetch(`${MANAGED_LLAMA_BASE}/health`, {
          signal: AbortSignal.timeout(1000),
        });
        if (response.ok) return true;
      } catch {}
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    throw new Error('Managed llama.cpp did not become ready in time.');
  }

  async loadModel(model, runtimeHint = '') {
    this.assertEnabled();
    const modelName = validModelName(model);
    const runtime = runtimeHint || (await this.detect())?.kind;
    if (!runtime) throw new Error('No supported local AI runtime is available.');

    if (runtime === 'llamacpp') {
      const modelPath = decodeManagedModel(modelName, this.modelsDir);
      const installed = await this.runtimeManager.installed();
      if (!installed?.binary) throw new Error('Managed llama.cpp runtime is not installed.');
      await fsp.access(modelPath);

      await this.unloadModel(this.managedModel || modelName, 'llamacpp').catch(() => {});
      const child = spawn(
        installed.binary,
        [
          '--host',
          '127.0.0.1',
          '--port',
          '11436',
          '-m',
          modelPath,
          '-ngl',
          '999',
          '-c',
          '8192',
          '--jinja',
        ],
        {
          cwd: path.dirname(installed.binary),
          env: process.env,
          windowsHide: true,
          stdio: 'ignore',
          detached: false,
        },
      );
      this.managedProcess = child;
      this.managedModel = modelName;
      child.once('exit', () => {
        if (this.managedProcess === child) {
          this.managedProcess = null;
          this.managedModel = null;
        }
      });
      child.once('error', () => {
        if (this.managedProcess === child) {
          this.managedProcess = null;
          this.managedModel = null;
        }
      });
      await this.waitManagedReady();
      return { loaded: true, model: modelName, runtime };
    }

    if (runtime === 'ollama') {
      await this.fetchJson(
        `${OLLAMA_BASE}/api/generate`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            model: modelName,
            prompt: '',
            stream: false,
            keep_alive: '10m',
          }),
        },
        10 * 60 * 1000,
      );
    } else {
      await this.fetchJson(
        `${LEMONADE_BASE}/v1/load`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ model_name: modelName }),
        },
        10 * 60 * 1000,
      );
    }
    return { loaded: true, model: modelName, runtime };
  }

  async unloadModel(model, runtimeHint = '') {
    this.assertEnabled();
    const runtime = runtimeHint || (await this.detect())?.kind;
    if (!runtime) return { loaded: false, model: String(model || ''), runtime: null };

    if (runtime === 'llamacpp') {
      const child = this.managedProcess;
      this.managedProcess = null;
      this.managedModel = null;
      if (child && child.exitCode === null) {
        try {
          child.kill();
        } catch {}
      }
      return { loaded: false, model: String(model || ''), runtime };
    }

    const modelName = validModelName(model);
    if (runtime === 'ollama') {
      await this.fetchJson(
        `${OLLAMA_BASE}/api/generate`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ model: modelName, prompt: '', stream: false, keep_alive: 0 }),
        },
        120_000,
      );
    } else {
      await this.fetchJson(
        `${LEMONADE_BASE}/v1/unload`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ model_name: modelName }),
        },
        120_000,
      );
    }
    return { loaded: false, model: modelName, runtime };
  }

  async chat({ model, messages, runtime: runtimeHint = '', options = {} } = {}) {
    this.assertEnabled();
    const modelName = validModelName(model);
    const normalized = normalizeMessages(messages);
    const runtime = runtimeHint || (await this.detect())?.kind;
    if (!runtime) throw new Error('No supported local AI runtime is available.');

    if (runtime === 'llamacpp') {
      if (!this.managedRunning() || this.managedModel !== modelName) {
        await this.loadModel(modelName, 'llamacpp');
      }
      const payload = await this.fetchJson(
        `${MANAGED_LLAMA_BASE}/v1/chat/completions`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            model: 'botconnector-local',
            messages: normalized,
            stream: false,
            temperature: 0.7,
          }),
        },
        15 * 60 * 1000,
      );
      return {
        content: String(payload?.choices?.[0]?.message?.content || ''),
        model: modelName,
        runtime: 'llamacpp',
        usage: payload?.usage,
      };
    }

    if (runtime === 'ollama') {
      const payload = await this.fetchJson(
        `${OLLAMA_BASE}/api/chat`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            model: modelName,
            messages: normalized,
            stream: false,
            keep_alive: options?.keep_alive || '10m',
            options: options?.num_ctx
              ? {
                  num_ctx: Math.max(
                    512,
                    Math.min(262144, Number(options.num_ctx) || 4096),
                  ),
                }
              : undefined,
          }),
        },
        15 * 60 * 1000,
      );
      return {
        content: String(payload?.message?.content || ''),
        model: modelName,
        runtime: 'ollama',
        usage: {
          prompt_tokens: Number(payload?.prompt_eval_count || 0),
          completion_tokens: Number(payload?.eval_count || 0),
        },
      };
    }

    await this.loadModel(modelName, 'lemonade');
    const payload = await this.fetchJson(
      `${LEMONADE_BASE}/v1/chat/completions`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model: modelName, messages: normalized, stream: false }),
      },
      15 * 60 * 1000,
    );
    return {
      content: String(payload?.choices?.[0]?.message?.content || ''),
      model: modelName,
      runtime: 'lemonade',
      usage: payload?.usage,
    };
  }

  close() {
    for (const job of this.jobs.values()) {
      try {
        job.controller?.abort();
      } catch {}
    }
    for (const job of this.runtimeJobs.values()) {
      try {
        job.controller?.abort();
      } catch {}
    }
    const child = this.managedProcess;
    this.managedProcess = null;
    this.managedModel = null;
    if (child && child.exitCode === null) {
      try {
        child.kill();
      } catch {}
    }
  }
}

module.exports = {
  LocalAiRuntime,
  OLLAMA_BASE,
  LEMONADE_BASE,
  MANAGED_LLAMA_BASE,
  validModelName,
  normalizeMessages,
  encodeManagedModel,
  decodeManagedModel,
  chooseGgufGroup,
};
