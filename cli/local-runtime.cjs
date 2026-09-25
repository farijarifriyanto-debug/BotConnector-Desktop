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

function normalizeRuntimeBase(value, defaultPort) {
  let raw = String(value || '').trim();
  if (!raw) return '';
  if (!/^https?:\/\//i.test(raw)) raw = 'http://' + raw;
  try {
    const url = new URL(raw);
    if (!url.port && defaultPort) url.port = String(defaultPort);
    if (url.hostname === '0.0.0.0' || url.hostname === '[::]' || url.hostname === '::') {
      url.hostname = '127.0.0.1';
    }
    return url.origin;
  } catch {
    return '';
  }
}

function ollamaBaseCandidates(
  env = process.env,
  interfaces = os.networkInterfaces(),
) {
  const out = [];
  const add = (value) => {
    const base = normalizeRuntimeBase(value, 11434);
    if (base && !out.includes(base)) out.push(base);
  };

  add(env.BOTCONNECTOR_OLLAMA_BASE_URL);
  add(env.OLLAMA_HOST);
  add(OLLAMA_BASE);
  add('http://localhost:11434');

  for (const rows of Object.values(interfaces || {})) {
    for (const row of Array.isArray(rows) ? rows : []) {
      if (row?.family !== 'IPv4' || !row?.address) continue;
      add('http://' + row.address + ':11434');
    }
  }

  return out;
}
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


function localModelRoots(dataDir) {
  const roots = new Set();
  const add = (value) => {
    const text = String(value || '').trim();
    if (text) roots.add(path.resolve(text));
  };

  add(path.join(dataDir, 'models'));
  add(path.join(os.homedir(), '.cache', 'huggingface', 'hub'));
  add(path.join(os.homedir(), '.cache', 'lemonade'));
  add(path.join(os.homedir(), '.lemonade'));

  // Discover common third-party local model stores too. These roots are
  // scanned read-only for GGUF files; BotConnector never deletes models that
  // belong to another application.
  add(path.join(os.homedir(), '.lmstudio', 'models'));
  add(path.join(os.homedir(), '.cache', 'lm-studio', 'models'));
  add(path.join(os.homedir(), 'jan', 'models'));
  add(path.join(os.homedir(), '.jan', 'models'));
  add(path.join(os.homedir(), '.local', 'share', 'jan', 'models'));
  add(path.join(os.homedir(), '.cache', 'gpt4all'));
  add(path.join(os.homedir(), '.local', 'share', 'nomic.ai', 'GPT4All'));

  add(process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Lemonade'));
  add(process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'lemonade'));
  add(process.env.APPDATA && path.join(process.env.APPDATA, 'Lemonade'));
  add(process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'LM Studio', 'models'));
  add(process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Jan', 'data', 'models'));
  add(process.env.APPDATA && path.join(process.env.APPDATA, 'Jan', 'data', 'models'));
  add(process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'nomic.ai', 'GPT4All'));

  for (const entry of String(process.env.BOTCONNECTOR_LOCAL_MODEL_DIRS || '')
    .split(path.delimiter)
    .map((item) => item.trim())
    .filter(Boolean)) {
    add(entry);
  }

  return [...roots];
}

async function isPathInside(targetPath, roots) {
  const resolvedTarget = path.resolve(targetPath);
  for (const root of roots) {
    const resolvedRoot = path.resolve(root);
    const relative = path.relative(resolvedRoot, resolvedTarget);
    if (relative && relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative)) {
      return true;
    }
  }
  return false;
}

async function scanExternalGguf(roots, managedRoot, { maxFiles = 128, maxDepth = 8 } = {}) {
  const out = [];
  const managed = path.resolve(managedRoot);
  const seen = new Set();

  for (const root of roots) {
    const resolvedRoot = path.resolve(root);
    if (resolvedRoot === managed) continue;
    const stack = [{ dir: resolvedRoot, depth: 0 }];

    while (stack.length && out.length < maxFiles) {
      const current = stack.pop();
      let entries = [];
      try {
        entries = await fsp.readdir(current.dir, { withFileTypes: true });
      } catch {
        continue;
      }

      for (const entry of entries) {
        if (out.length >= maxFiles) break;
        const full = path.join(current.dir, entry.name);

        if (entry.isDirectory()) {
          if (current.depth < maxDepth && !/^(node_modules|\.git)$/i.test(entry.name)) {
            stack.push({ dir: full, depth: current.depth + 1 });
          }
          continue;
        }

        if (!/\.gguf$/i.test(entry.name) || /(mmproj|projector)/i.test(entry.name)) continue;

        let stat;
        try {
          stat = await fsp.stat(full);
        } catch {
          continue;
        }
        if (!stat.isFile()) continue;

        const key = path.resolve(full).toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);

        const quantMatch = entry.name.match(/Q\d(?:_[A-Za-z0-9]+)*/i);
        out.push({
          path: path.resolve(full),
          name: entry.name,
          size: stat.size,
          quant: quantMatch?.[0] || undefined,
          sourceRoot: resolvedRoot,
          modifiedAt: stat.mtime.toISOString(),
        });
      }
    }
  }

  return out;
}


function ollamaModelsRoot() {
  const configured = String(process.env.OLLAMA_MODELS || '').trim();
  return path.resolve(configured || path.join(os.homedir(), '.ollama', 'models'));
}

async function scanOllamaStore(root = ollamaModelsRoot(), { maxFiles = 256 } = {}) {
  const manifestsRoot = path.join(root, 'manifests');
  const out = [];
  const stack = [{ dir: manifestsRoot, depth: 0 }];

  while (stack.length && out.length < maxFiles) {
    const current = stack.pop();
    let entries = [];
    try {
      entries = await fsp.readdir(current.dir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (out.length >= maxFiles) break;
      const full = path.join(current.dir, entry.name);
      if (entry.isDirectory()) {
        if (current.depth < 5) stack.push({ dir: full, depth: current.depth + 1 });
        continue;
      }
      if (!entry.isFile()) continue;

      let manifest;
      try {
        const stat = await fsp.stat(full);
        if (stat.size <= 0 || stat.size > 2 * 1024 * 1024) continue;
        manifest = JSON.parse(await fsp.readFile(full, 'utf8'));
      } catch {
        continue;
      }

      const relative = path.relative(manifestsRoot, full);
      const parts = relative.split(path.sep).filter(Boolean);
      if (parts.length < 4) continue;
      const tag = parts.pop();
      const model = parts.pop();
      const namespace = parts.pop();
      const registry = parts.join('/');
      const id = namespace === 'library' ? `${model}:${tag}` : `${namespace}/${model}:${tag}`;
      const modelLayers = (Array.isArray(manifest?.layers) ? manifest.layers : []).filter((layer) =>
        String(layer?.mediaType || '').includes('application/vnd.ollama.image.model'),
      );
      // Ollama cloud models can leave lightweight manifests in the local store
      // with config metadata but no local model layer. Do not present those as
      // installed/offline models when the Ollama daemon is unavailable.
      if (modelLayers.length === 0) continue;
      const layers = [...modelLayers, ...(manifest?.config ? [manifest.config] : [])];
      const size = layers.reduce((sum, layer) => sum + Number(layer?.size || 0), 0);

      out.push({
        id,
        name: id,
        size: size || undefined,
        runtime: 'ollama',
        path: `device:ollama:${id}`,
        source: 'Ollama local store',
        registry,
        deletable: false,
        runnable: false,
        offlineDiscovered: true,
      });
    }
  }

  return out;
}

function lemonadeMetadataRoots() {
  const roots = new Set();
  const add = (value) => {
    const text = String(value || '').trim();
    if (text) roots.add(path.resolve(text));
  };
  add(path.join(os.homedir(), '.cache', 'lemonade'));
  add(path.join(os.homedir(), '.lemonade'));
  add(process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Lemonade'));
  add(process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'lemonade'));
  add(process.env.APPDATA && path.join(process.env.APPDATA, 'Lemonade'));
  return [...roots];
}

function lemonadeRowsFromMetadata(value) {
  const rows = [];
  const visit = (item, depth = 0) => {
    if (depth > 4 || item == null) return;
    if (Array.isArray(item)) {
      for (const child of item.slice(0, 512)) visit(child, depth + 1);
      return;
    }
    if (typeof item !== 'object') return;

    const id = String(
      item.id || item.model_id || item.modelId || item.model_name || item.modelName || '',
    ).trim();
    const recipe = String(item.recipe || item.backend || '').trim();
    const checkpoint = String(item.checkpoint || item.repo_id || item.repoId || '').trim();

    if (id && id.length <= 256 && (recipe || checkpoint || item.downloaded != null)) {
      rows.push({
        id,
        name: id,
        runtime: 'lemonade',
        path: `device:lemonade:${id}`,
        recipe: recipe || undefined,
        repoId: checkpoint || undefined,
        source: 'Lemonade local metadata',
        deletable: false,
        runnable: false,
        offlineDiscovered: true,
      });
    }

    for (const key of ['models', 'data', 'installed', 'items', 'entries']) {
      if (item[key] != null) visit(item[key], depth + 1);
    }
  };
  visit(value);
  return rows;
}

async function scanLemonadeStore(roots = lemonadeMetadataRoots(), { maxFiles = 96 } = {}) {
  const out = [];
  const seen = new Set();
  for (const root of roots) {
    const stack = [{ dir: root, depth: 0 }];
    while (stack.length && seen.size < maxFiles) {
      const current = stack.pop();
      let entries = [];
      try {
        entries = await fsp.readdir(current.dir, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const entry of entries) {
        if (seen.size >= maxFiles) break;
        const full = path.join(current.dir, entry.name);
        if (entry.isDirectory()) {
          if (current.depth < 6 && !/^(node_modules|\.git)$/i.test(entry.name)) {
            stack.push({ dir: full, depth: current.depth + 1 });
          }
          continue;
        }
        if (!entry.isFile() || !/^(models?|manifest|metadata|index).*\.json$/i.test(entry.name)) {
          continue;
        }
        let parsed;
        try {
          const stat = await fsp.stat(full);
          if (stat.size <= 0 || stat.size > 2 * 1024 * 1024) continue;
          parsed = JSON.parse(await fsp.readFile(full, 'utf8'));
        } catch {
          continue;
        }
        seen.add(full);
        out.push(...lemonadeRowsFromMetadata(parsed));
      }
    }
  }

  const unique = [];
  const ids = new Set();
  for (const row of out) {
    if (ids.has(row.id)) continue;
    ids.add(row.id);
    unique.push(row);
  }
  return unique;
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
    this.chatControllers = new Map();
    this.dataDir = path.resolve(dataDir);
    this.runtimeDir = path.join(this.dataDir, 'runtime');
    this.modelsDir = path.join(this.dataDir, 'models');
    this.managedProcess = null;
    this.managedModel = null;
    this.externalRoots = localModelRoots(this.dataDir);
    this.externalScanCache = { at: 0, models: [] };
    this.ollamaBaseUrl = null;
    this.idleMs = Math.max(
      60_000,
      Number(process.env.BOTCONNECTOR_LOCAL_AI_IDLE_MS || 5 * 60 * 1000),
    );
    this.idleTimer = null;

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

  clearIdleTimer() {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = null;
  }

  scheduleIdleUnload(runtime, model) {
    this.clearIdleTimer();
    if (!runtime || !model) return;
    this.idleTimer = setTimeout(() => {
      this.unloadModel(model, runtime).catch(() => {});
    }, this.idleMs);
    this.idleTimer.unref?.();
  }

  async fetchJson(url, init = {}, timeoutMs = 15_000) {
    let response;
    try {
      response = await this.fetch(url, {
        ...init,
        cache: 'no-store',
        signal: init.signal || AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      if (error?.name === 'AbortError' || error?.name === 'TimeoutError') {
        throw new Error('Local runtime request timed out. Start or restart the runtime and try again.');
      }
      throw new Error('Local runtime is unavailable. Start or restart its local runtime and try again.');
    }
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

  async assertOllamaModelLocal(model) {
    const modelName = validModelName(model);
    const rows = await scanOllamaStore();
    if (!rows.some((row) => row.id === modelName)) {
      throw new Error('This Ollama model is not installed locally. Cloud-only Ollama entries are blocked in offline mode.');
    }
    return modelName;
  }

  managedRunning() {
    return Boolean(this.managedProcess && this.managedProcess.exitCode === null);
  }

  async findOllamaBase({ refresh = false } = {}) {
    const candidates = [];
    const add = (value) => {
      const base = normalizeRuntimeBase(value, 11434);
      if (base && !candidates.includes(base)) candidates.push(base);
    };

    if (!refresh) add(this.ollamaBaseUrl);
    for (const base of ollamaBaseCandidates()) add(base);

    for (const base of candidates) {
      try {
        const payload = await this.fetchJson(base + '/api/tags', { method: 'GET' }, 1200);
        if (Array.isArray(payload?.models)) {
          this.ollamaBaseUrl = base;
          return base;
        }
      } catch {}
    }

    this.ollamaBaseUrl = null;
    return null;
  }

  async detect() {
    this.assertEnabled();

    const managed = await this.runtimeManager.installed().catch(() => ({ installed: false }));
    if (managed?.installed) {
      return { kind: 'llamacpp', baseUrl: MANAGED_LLAMA_BASE, binary: managed.binary };
    }

    const ollamaBase = await this.findOllamaBase();
    if (ollamaBase) return { kind: 'ollama', baseUrl: ollamaBase };

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
        const running = await this.fetchJson(`${runtime.baseUrl}/api/ps`, { method: 'GET' }, 3000);
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

    const results = [];

    const pushUnique = (rows) => {
      for (const row of Array.isArray(rows) ? rows : []) {
        if (!row?.id || !row?.runtime) continue;
        const key = `${row.runtime}:${row.id}`;
        if (!results.some((item) => `${item.runtime}:${item.id}` === key)) {
          results.push(row);
        }
      }
    };

    const listManaged = async () => {
      const managed = await this.runtimeManager.installed().catch(() => ({ installed: false }));
      if (!managed?.installed) return [];
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
        source: 'BotConnector managed llama.cpp',
        deletable: true,
        runnable: true,
      }));
    };

    const listOllama = async () => {
      try {
        const base = await this.findOllamaBase();
        if (!base) throw new Error('Ollama runtime unavailable.');
        const payload = await this.fetchJson(base + '/api/tags', { method: 'GET' }, 1800);
        const localRows = await scanOllamaStore();
        const localIds = new Set(localRows.map((row) => row.id));

        return (Array.isArray(payload?.models) ? payload.models : [])
          .map((model) => ({
            id: String(model?.name || model?.model || ''),
            name: String(model?.name || model?.model || ''),
            size: Number(model?.size || 0) || undefined,
            modifiedAt: model?.modified_at || undefined,
            digest: model?.digest || undefined,
            runtime: 'ollama',
            path: `device:ollama:${String(model?.name || model?.model || '')}`,
            source: 'Ollama',
            deletable: true,
            runnable: true,
          }))
          .filter((model) => model.id && localIds.has(model.id));
      } catch {
        return scanOllamaStore();
      }
    };

    const listLemonade = async () => {
      try {
        const payload = await this.fetchJson(`${LEMONADE_BASE}/v1/models`, { method: 'GET' }, 1800);
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
          .map((model) => ({
            ...model,
            source: 'Lemonade',
            deletable: true,
            runnable: true,
          }))
          .filter((model) => model.downloaded !== false);
      } catch {
        return scanLemonadeStore();
      }
    };

    if (runtimeOverride?.kind) {
      if (runtimeOverride.kind === 'llamacpp') pushUnique(await listManaged());
      if (runtimeOverride.kind === 'ollama') pushUnique(await listOllama());
      if (runtimeOverride.kind === 'lemonade') pushUnique(await listLemonade());
    }

    pushUnique(await listManaged());
    pushUnique(await listOllama());
    pushUnique(await listLemonade());
    pushUnique(await this.listExternalGguf());

    return results;
  }

  async listExternalGguf() {
    const now = Date.now();
    if (now - this.externalScanCache.at < 15_000) {
      return this.externalScanCache.models;
    }

    const rows = await scanExternalGguf(this.externalRoots, this.modelsDir);
    const mapped = rows.map((model) => {
      const id = encodeManagedModel(model.path);
      return {
        id,
        name: model.name,
        size: model.size,
        runtime: 'external-gguf',
        path: `device:external-gguf:${id}`,
        recipe: 'llama.cpp',
        quant: model.quant,
        source: 'existing local GGUF',
        sourceRoot: model.sourceRoot,
        modifiedAt: model.modifiedAt,
        deletable: false,
        runnable: true,
      };
    });
    this.externalScanCache = { at: now, models: mapped };
    return mapped;
  }

  async externalModelPath(id) {
    const token = validModelName(id);
    let decoded;
    try {
      decoded = Buffer.from(token, 'base64url').toString('utf8');
    } catch {
      throw new Error('Invalid external model id.');
    }
    if (!(await isPathInside(decoded, this.externalRoots))) {
      throw new Error('External model path is outside approved local model directories.');
    }
    await fsp.access(decoded);
    return path.resolve(decoded);
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
        const base = await this.findOllamaBase();
        if (!base) throw new Error('Ollama runtime unavailable.');
        const response = await this.fetch(base + '/api/pull', {
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

    if (runtime === 'external-gguf') {
      throw new Error('Existing external GGUF models are read-only in BotConnector.');
    }

    if (runtime === 'llamacpp') {
      const modelPath = decodeManagedModel(modelName, this.modelsDir);
      if (this.managedModel === modelName) await this.unloadModel(modelName, 'llamacpp');
      await fsp.rm(path.dirname(modelPath), { recursive: true, force: true });
      return { deleted: true, model: modelName, runtime };
    }

    if (runtime === 'ollama') {
      await this.assertOllamaModelLocal(modelName);
      const base = await this.findOllamaBase();
      if (!base) throw new Error('Ollama runtime unavailable.');
      await this.fetchJson(base + '/api/delete', {
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

    if (runtime === 'llamacpp' || runtime === 'external-gguf') {
      const modelPath =
        runtime === 'llamacpp'
          ? decodeManagedModel(modelName, this.modelsDir)
          : await this.externalModelPath(modelName);
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
      this.scheduleIdleUnload(runtime, modelName);
      return { loaded: true, model: modelName, runtime };
    }

    if (runtime === 'ollama') {
      await this.assertOllamaModelLocal(modelName);
      const base = await this.findOllamaBase();
      if (!base) throw new Error('Ollama runtime unavailable.');
      await this.fetchJson(
        base + '/api/generate',
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
    this.scheduleIdleUnload(runtime, modelName);
    return { loaded: true, model: modelName, runtime };
  }

  async unloadModel(model, runtimeHint = '') {
    this.assertEnabled();
    this.clearIdleTimer();
    const runtime = runtimeHint || (await this.detect())?.kind;
    if (!runtime) return { loaded: false, model: String(model || ''), runtime: null };

    if (runtime === 'llamacpp' || runtime === 'external-gguf') {
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
      await this.assertOllamaModelLocal(modelName);
      const base = await this.findOllamaBase();
      if (!base) throw new Error('Ollama runtime unavailable.');
      await this.fetchJson(
        base + '/api/generate',
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

  async chat({ model, messages, runtime: runtimeHint = '', options = {}, request_id: requestId = '' } = {}) {
    this.assertEnabled();
    const modelName = validModelName(model);
    const normalized = normalizeMessages(messages);
    const runtime = runtimeHint || (await this.detect())?.kind;
    if (!runtime) throw new Error('No supported local AI runtime is available.');
    this.clearIdleTimer();

    const id = String(requestId || crypto.randomUUID());
    const controller = new AbortController();
    this.chatControllers.set(id, controller);

    try {
    if (runtime === 'llamacpp' || runtime === 'external-gguf') {
      if (!this.managedRunning() || this.managedModel !== modelName) {
        await this.loadModel(modelName, runtime);
      }
      this.clearIdleTimer();
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
          signal: controller.signal,
        },
        15 * 60 * 1000,
      );
      const result = {
        content: String(payload?.choices?.[0]?.message?.content || ''),
        model: modelName,
        runtime,
        usage: payload?.usage,
      };
      this.scheduleIdleUnload(runtime, modelName);
      return result;
    }

    if (runtime === 'ollama') {
      await this.assertOllamaModelLocal(modelName);
      const base = await this.findOllamaBase();
      if (!base) throw new Error('Ollama runtime unavailable.');
      const payload = await this.fetchJson(
        base + '/api/chat',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            model: modelName,
            messages: normalized,
            stream: false,
            keep_alive: options?.keep_alive || '5m',
            options: options?.num_ctx
              ? {
                  num_ctx: Math.max(
                    512,
                    Math.min(262144, Number(options.num_ctx) || 4096),
                  ),
                }
              : undefined,
          }),
          signal: controller.signal,
        },
        15 * 60 * 1000,
      );
      const result = {
        content: String(payload?.message?.content || ''),
        model: modelName,
        runtime: 'ollama',
        usage: {
          prompt_tokens: Number(payload?.prompt_eval_count || 0),
          completion_tokens: Number(payload?.eval_count || 0),
        },
      };
      this.scheduleIdleUnload('ollama', modelName);
      return result;
    }

    await this.loadModel(modelName, 'lemonade');
    this.clearIdleTimer();
    const payload = await this.fetchJson(
      `${LEMONADE_BASE}/v1/chat/completions`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model: modelName, messages: normalized, stream: false }),
        signal: controller.signal,
      },
      15 * 60 * 1000,
    );
    const result = {
      content: String(payload?.choices?.[0]?.message?.content || ''),
      model: modelName,
      runtime: 'lemonade',
      usage: payload?.usage,
    };
    this.scheduleIdleUnload('lemonade', modelName);
    return result;
    } finally {
      this.chatControllers.delete(id);
    }
  }

  cancelChat(id) {
    this.assertEnabled();
    const key = String(id || '');
    const controller = this.chatControllers.get(key);
    if (!controller) return { cancelled: false, id: key };
    controller.abort();
    this.chatControllers.delete(key);
    return { cancelled: true, id: key };
  }

  close() {
    this.clearIdleTimer();
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
    for (const controller of this.chatControllers.values()) {
      try {
        controller.abort();
      } catch {}
    }
    this.chatControllers.clear();
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
  normalizeRuntimeBase,
  ollamaBaseCandidates,
  LEMONADE_BASE,
  MANAGED_LLAMA_BASE,
  validModelName,
  normalizeMessages,
  encodeManagedModel,
  decodeManagedModel,
  chooseGgufGroup,
  localModelRoots,
  isPathInside,
  scanExternalGguf,
  ollamaModelsRoot,
  scanOllamaStore,
  lemonadeMetadataRoots,
  lemonadeRowsFromMetadata,
  scanLemonadeStore,
};
