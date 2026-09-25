const crypto = require('node:crypto');

const OLLAMA_BASE = 'http://127.0.0.1:11434';
const LEMONADE_BASE = 'http://127.0.0.1:13305';
const MAX_MESSAGES = 128;
const MAX_CHAT_CHARS = 256 * 1024;
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
  const normalized = messages.map((message) => {
    const role = String(message?.role || '');
    if (!['system', 'user', 'assistant', 'tool'].includes(role)) {
      throw new Error('Unsupported local chat role.');
    }
    const content = message?.content == null ? '' : String(message.content);
    total += content.length;
    if (total > MAX_CHAT_CHARS) throw new Error('Local chat payload is too large.');
    return { role, content };
  });
  return normalized;
}

async function responseJson(response) {
  return response.json().catch(() => ({}));
}

class LocalAiRuntime {
  constructor({ enabled = false, fetchImpl = globalThis.fetch, emit = () => {} } = {}) {
    this.enabled = Boolean(enabled);
    this.fetch = fetchImpl;
    this.emit = emit;
    this.jobs = new Map();
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
      throw new Error(body?.error?.message || body?.error || body?.message || `Local runtime HTTP ${response.status}`);
    }
    return body;
  }

  async detect() {
    this.assertEnabled();

    try {
      const payload = await this.fetchJson(`${OLLAMA_BASE}/api/tags`, { method: 'GET' }, 1800);
      if (Array.isArray(payload?.models)) {
        return { kind: 'ollama', baseUrl: OLLAMA_BASE };
      }
    } catch {}

    try {
      const payload = await this.fetchJson(`${LEMONADE_BASE}/v1/health`, { method: 'GET' }, 1800);
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
        message: 'No supported local AI runtime is running. Start Ollama or Lemonade on this device.',
      };
    }

    const models = await this.listModels(runtime);
    let loadedModels = [];

    if (runtime.kind === 'ollama') {
      try {
        const running = await this.fetchJson(`${OLLAMA_BASE}/api/ps`, { method: 'GET' }, 3000);
        loadedModels = (Array.isArray(running?.models) ? running.models : [])
          .map((model) => String(model?.name || model?.model || ''))
          .filter(Boolean);
      } catch {}
    } else {
      try {
        const health = await this.fetchJson(`${LEMONADE_BASE}/v1/health`, { method: 'GET' }, 3000);
        const primary = String(health?.model_loaded || '');
        loadedModels = [
          ...(primary ? [primary] : []),
          ...(Array.isArray(health?.all_models_loaded)
            ? health.all_models_loaded.map((row) => String(row?.model_name || '')).filter(Boolean)
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
    };
  }

  async listModels(runtimeOverride = null) {
    this.assertEnabled();
    const runtime = runtimeOverride || (await this.detect());
    if (!runtime) return [];

    if (runtime.kind === 'ollama') {
      const payload = await this.fetchJson(`${OLLAMA_BASE}/api/tags`);
      return (Array.isArray(payload?.models) ? payload.models : []).map((model) => ({
        id: String(model?.name || model?.model || ''),
        name: String(model?.name || model?.model || ''),
        size: Number(model?.size || 0) || undefined,
        modifiedAt: model?.modified_at || undefined,
        digest: model?.digest || undefined,
        runtime: 'ollama',
        path: `device:ollama:${String(model?.name || model?.model || '')}`,
      })).filter((model) => model.id);
    }

    const payload = await this.fetchJson(`${LEMONADE_BASE}/v1/models`);
    return (Array.isArray(payload?.data) ? payload.data : []).filter((model) => model?.id).map((model) => ({
      id: String(model.id),
      name: String(model.id),
      size: typeof model?.size === 'number' ? Math.round(model.size * 1024 ** 3) : undefined,
      runtime: 'lemonade',
      path: `device:lemonade:${String(model.id)}`,
      recipe: model?.recipe || undefined,
      downloaded: model?.downloaded !== false,
    })).filter((model) => model.downloaded !== false);
  }

  publicJob(job) {
    const { controller, ...safe } = job;
    return { ...safe };
  }

  listJobs() {
    this.assertEnabled();
    return [...this.jobs.values()].map((job) => this.publicJob(job));
  }

  jobStatus(id) {
    this.assertEnabled();
    const job = this.jobs.get(String(id || ''));
    if (!job) throw new Error('Download job not found.');
    return this.publicJob(job);
  }

  async startPull(model) {
    this.assertEnabled();
    const modelName = validModelName(model);
    const runtime = await this.detect();
    if (!runtime) throw new Error('No supported local AI runtime is running.');

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
            try { row = JSON.parse(line); } catch { continue; }
            if (row.error) throw new Error(String(row.error));
            if (Number.isFinite(row.completed)) job.completed = Number(row.completed);
            if (Number.isFinite(row.total)) job.total = Number(row.total);
            if (job.total > 0) job.percent = Math.max(0, Math.min(100, Math.round(job.completed / job.total * 100)));
            if (row.status) job.detail = String(row.status);
            this.emit('local-ai:download', this.publicJob(job));
          }
        }
      } else {
        await this.fetchJson(`${LEMONADE_BASE}/v1/pull`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ model_name: job.model, stream: false }),
          signal: job.controller.signal,
        }, 60 * 60 * 1000);
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
    const job = this.jobs.get(String(id || ''));
    if (!job) throw new Error('Download job not found.');
    if (['completed', 'failed', 'cancelled'].includes(job.status)) return this.publicJob(job);
    job.status = 'cancelled';
    job.controller.abort();
    return this.publicJob(job);
  }

  async deleteModel(model, runtimeHint = '') {
    this.assertEnabled();
    const modelName = validModelName(model);
    const runtime = runtimeHint || (await this.detect())?.kind;
    if (!runtime) throw new Error('No supported local AI runtime is running.');

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

  async loadModel(model, runtimeHint = '') {
    this.assertEnabled();
    const modelName = validModelName(model);
    const runtime = runtimeHint || (await this.detect())?.kind;
    if (!runtime) throw new Error('No supported local AI runtime is running.');

    if (runtime === 'ollama') {
      await this.fetchJson(`${OLLAMA_BASE}/api/generate`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model: modelName, prompt: '', stream: false, keep_alive: '10m' }),
      }, 10 * 60 * 1000);
    } else {
      await this.fetchJson(`${LEMONADE_BASE}/v1/load`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model_name: modelName }),
      }, 10 * 60 * 1000);
    }
    return { loaded: true, model: modelName, runtime };
  }

  async unloadModel(model, runtimeHint = '') {
    this.assertEnabled();
    const modelName = validModelName(model);
    const runtime = runtimeHint || (await this.detect())?.kind;
    if (!runtime) throw new Error('No supported local AI runtime is running.');

    if (runtime === 'ollama') {
      await this.fetchJson(`${OLLAMA_BASE}/api/generate`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model: modelName, prompt: '', stream: false, keep_alive: 0 }),
      }, 120_000);
    } else {
      await this.fetchJson(`${LEMONADE_BASE}/v1/unload`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model_name: modelName }),
      }, 120_000);
    }
    return { loaded: false, model: modelName, runtime };
  }

  async chat({ model, messages, runtime: runtimeHint = '', options = {} } = {}) {
    this.assertEnabled();
    const modelName = validModelName(model);
    const normalized = normalizeMessages(messages);
    const runtime = runtimeHint || (await this.detect())?.kind;
    if (!runtime) throw new Error('No supported local AI runtime is running.');

    if (runtime === 'ollama') {
      const payload = await this.fetchJson(`${OLLAMA_BASE}/api/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          model: modelName,
          messages: normalized,
          stream: false,
          keep_alive: options?.keep_alive || '10m',
          options: options?.num_ctx ? { num_ctx: Math.max(512, Math.min(262144, Number(options.num_ctx) || 4096)) } : undefined,
        }),
      }, 15 * 60 * 1000);
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
    const payload = await this.fetchJson(`${LEMONADE_BASE}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: modelName, messages: normalized, stream: false }),
    }, 15 * 60 * 1000);
    return {
      content: String(payload?.choices?.[0]?.message?.content || ''),
      model: modelName,
      runtime: 'lemonade',
      usage: payload?.usage,
    };
  }
}

module.exports = {
  LocalAiRuntime,
  OLLAMA_BASE,
  LEMONADE_BASE,
  validModelName,
  normalizeMessages,
};
