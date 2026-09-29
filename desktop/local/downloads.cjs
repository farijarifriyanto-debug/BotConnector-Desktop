const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { resolveUrl: resolveUrlDefault } = require('./hf.cjs');

const TRANSIENT_HTTP = new Set([429, 500, 502, 503, 504]);

async function sha256File(filePath) {
  return await new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

function rateLimitWaitMs(headers, attempt = 0, status = 429) {
  const retryAfter = String(headers?.get?.('retry-after') || '').trim();
  if (/^\d+(?:\.\d+)?$/.test(retryAfter)) {
    return Math.max(250, Math.ceil(Number(retryAfter) * 1000));
  }
  if (retryAfter) {
    const at = Date.parse(retryAfter);
    if (Number.isFinite(at)) return Math.max(250, at - Date.now());
  }

  const rateLimit = String(headers?.get?.('ratelimit') || '').trim();
  const reset = rateLimit.match(/(?:^|[;,\s])t\s*=\s*"?([0-9]+(?:\.[0-9]+)?)"?/i);
  if (reset) return Math.max(250, Math.ceil(Number(reset[1]) * 1000));

  if (status === 429) return Math.min(60_000, 5_000 * (2 ** Math.min(attempt, 4)));
  return Math.min(10_000, 1_000 * (2 ** Math.min(attempt, 3)));
}

function sleepWithAbort(ms, signal) {
  if (!ms) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(done, ms);
    function done() {
      cleanup();
      resolve();
    }
    function aborted() {
      cleanup();
      reject(new DOMException('Aborted', 'AbortError'));
    }
    function cleanup() {
      clearTimeout(timer);
      signal?.removeEventListener?.('abort', aborted);
    }
    if (signal?.aborted) return aborted();
    signal?.addEventListener?.('abort', aborted, { once: true });
  });
}

function transientNetworkError(error) {
  if (!error || error.name === 'AbortError') return false;
  if (['TypeError', 'TimeoutError'].includes(error.name)) return true;
  return /ECONNRESET|ETIMEDOUT|EPIPE|UND_ERR|fetch failed|socket|network/i.test(String(error.code || '') + ' ' + String(error.message || ''));
}

class DownloadManager {
  constructor({ getModelsDir, getToken, emit, resolveUrl, fetchImpl, sleep, maxRetries = 5 }) {
    this.jobs = new Map();
    this.getModelsDir = getModelsDir;
    this.getToken = getToken;
    this.emit = emit || (() => {});
    this.resolveUrl = resolveUrl || resolveUrlDefault;
    this.fetch = fetchImpl || globalThis.fetch;
    this.sleep = sleep || sleepWithAbort;
    this.maxRetries = Math.max(0, Number(maxRetries) || 0);
  }

  list() {
    return [...this.jobs.values()].map((job) => this.publicJob(job));
  }

  publicJob(job) {
    const { controller, filesData, ...safe } = job;
    return safe;
  }

  async ensureDir(dir) {
    await fsp.mkdir(dir, { recursive: true });
  }

  async waitToRetry(job, response, attempt, status) {
    const waitMs = rateLimitWaitMs(response?.headers, attempt, status);
    job.status = status === 429 ? 'rate-limited' : 'retrying';
    job.retryAfterMs = waitMs;
    job.retryAt = new Date(Date.now() + waitMs).toISOString();
    job.retryCount = attempt + 1;
    job.detail = status === 429
      ? 'Hugging Face rate limit reached; retrying automatically.'
      : `Temporary download error HTTP ${status}; retrying automatically.`;
    this.emit('download:progress', this.publicJob(job));
    await this.sleep(waitMs, job.controller.signal);
    job.status = 'downloading';
    job.retryAfterMs = 0;
    job.retryAt = null;
    job.detail = null;
  }

  async fetchFile(repoId, file, offset, job) {
    const token = this.getToken?.() || '';
    const headers = { 'User-Agent': 'BotConnectorAI/0.4', Accept: 'application/octet-stream' };
    if (token) headers.Authorization = `Bearer ${token}`;
    if (offset > 0) headers.Range = `bytes=${offset}-`;
    return await this.fetch(this.resolveUrl(repoId, file.path), {
      headers,
      signal: job.controller.signal,
      redirect: 'follow',
      cache: 'no-store',
    });
  }

  async downloadOne({ repoId, file, destDir, job }) {
    const finalPath = path.join(destDir, path.basename(file.path));
    const partPath = finalPath + '.part';

    try {
      const stat = await fsp.stat(finalPath);
      if (!file.size || stat.size === Number(file.size)) {
        return { path: finalPath, size: stat.size, skipped: true };
      }
    } catch {}

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      let offset = 0;
      try { offset = (await fsp.stat(partPath)).size; } catch {}

      let response;
      try {
        response = await this.fetchFile(repoId, file, offset, job);
        if (offset > 0 && response.status === 200) {
          await response.body?.cancel?.().catch?.(() => {});
          await fsp.rm(partPath, { force: true });
          offset = 0;
          response = await this.fetchFile(repoId, file, 0, job);
        } else if (offset > 0 && response.status === 416) {
          await response.body?.cancel?.().catch?.(() => {});
          await fsp.rm(partPath, { force: true });
          offset = 0;
          response = await this.fetchFile(repoId, file, 0, job);
        }
      } catch (error) {
        if (error?.name === 'AbortError') throw error;
        if (attempt < this.maxRetries && transientNetworkError(error)) {
          const waitMs = Math.min(10_000, 1_000 * (2 ** Math.min(attempt, 3)));
          job.status = 'retrying';
          job.retryAfterMs = waitMs;
          job.retryAt = new Date(Date.now() + waitMs).toISOString();
          job.retryCount = attempt + 1;
          job.detail = 'Connection interrupted; resuming download automatically.';
          this.emit('download:progress', this.publicJob(job));
          await this.sleep(waitMs, job.controller.signal);
          job.status = 'downloading';
          job.retryAfterMs = 0;
          job.retryAt = null;
          job.detail = null;
          continue;
        }
        throw error;
      }

      if (TRANSIENT_HTTP.has(response.status)) {
        await response.body?.cancel?.().catch?.(() => {});
        if (attempt >= this.maxRetries) throw new Error(`Download ${response.status} for ${file.path}`);
        await this.waitToRetry(job, response, attempt, response.status);
        continue;
      }

      if (!response.ok) throw new Error(`Download ${response.status} for ${file.path}`);
      if (!response.body) throw new Error(`Download returned no body for ${file.path}`);

      const totalHeader = Number(response.headers.get('content-length') || 0) + (response.status === 206 ? offset : 0);
      const total = Number(file.size || 0) || totalHeader;
      const stream = fs.createWriteStream(partPath, { flags: offset ? 'a' : 'w' });
      const reader = response.body.getReader();
      let downloaded = offset;
      let last = Date.now();
      let lastBytes = downloaded;

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (!stream.write(Buffer.from(value))) await new Promise((resolve) => stream.once('drain', resolve));
          downloaded += value.byteLength;
          job.downloadedBytes = job.baseDownloaded + downloaded;
          if (total && !job.totalBytes) job.totalBytes = total;
          const now = Date.now();
          if (now - last >= 350) {
            job.bytesPerSecond = Math.round((downloaded - lastBytes) / ((now - last) / 1000));
            last = now;
            lastBytes = downloaded;
            this.emit('download:progress', this.publicJob(job));
          }
        }
        await new Promise((resolve, reject) => stream.end((error) => error ? reject(error) : resolve()));
      } catch (error) {
        stream.destroy();
        try { await reader.cancel(); } catch {}
        if (error?.name === 'AbortError') throw error;
        if (attempt < this.maxRetries && transientNetworkError(error)) {
          const waitMs = Math.min(10_000, 1_000 * (2 ** Math.min(attempt, 3)));
          job.status = 'retrying';
          job.retryAfterMs = waitMs;
          job.retryAt = new Date(Date.now() + waitMs).toISOString();
          job.retryCount = attempt + 1;
          job.detail = 'Connection interrupted; resuming download automatically.';
          this.emit('download:progress', this.publicJob(job));
          await this.sleep(waitMs, job.controller.signal);
          job.status = 'downloading';
          job.retryAfterMs = 0;
          job.retryAt = null;
          job.detail = null;
          continue;
        }
        throw error;
      }

      const expected = String(file.oid || '').toLowerCase();
      if (/^[0-9a-f]{64}$/.test(expected)) {
        job.status = 'verifying';
        job.detail = 'Verifying downloaded model…';
        this.emit('download:progress', this.publicJob(job));
        const actual = await sha256File(partPath);
        if (actual !== expected) {
          await fsp.rm(partPath, { force: true });
          throw new Error(`SHA256 mismatch for ${file.path}`);
        }
      }

      await fsp.rename(partPath, finalPath);
      job.status = 'downloading';
      job.detail = null;
      job.retryAfterMs = 0;
      job.retryAt = null;
      return { path: finalPath, size: downloaded };
    }

    throw new Error(`Download failed for ${file.path}`);
  }

  async _run(job) {
    try {
      const installed = [];
      job.downloadedBytes = 0;
      for (const file of job.filesData) {
        job.baseDownloaded = job.downloadedBytes;
        installed.push(await this.downloadOne({ repoId: job.repoId, file, destDir: job.destDir, job }));
        job.downloadedBytes = job.baseDownloaded + Number(file.size || installed.at(-1).size || 0);
      }

      const manifest = {
        schema: 1,
        repoId: job.repoId,
        quant: job.quant,
        downloadedAt: new Date().toISOString(),
        files: installed.map((item) => ({ path: path.basename(item.path), size: item.size })),
        capabilities: job.metadata.capabilities || {},
        pipeline_tag: job.metadata.pipeline_tag || null,
        author: job.metadata.author || null,
        license: job.metadata.license || null,
        publisherType: job.metadata.publisherType || null,
        contextLength: job.metadata.contextLength || null,
        source: `https://huggingface.co/${job.repoId}`,
      };
      await fsp.writeFile(path.join(job.destDir, 'manifest.json'), JSON.stringify(manifest, null, 2));

      job.status = 'completed';
      job.completedAt = new Date().toISOString();
      job.bytesPerSecond = 0;
      job.detail = null;
      this.emit('download:progress', this.publicJob(job));
    } catch (error) {
      if (error.name === 'AbortError' && job.paused) job.status = 'paused';
      else if (error.name === 'AbortError') job.status = 'cancelled';
      else {
        job.status = 'failed';
        job.error = String(error.message || error);
      }
      job.bytesPerSecond = 0;
      job.retryAfterMs = 0;
      job.retryAt = null;
      this.emit('download:progress', this.publicJob(job));
    }
  }

  async start({ repoId, group, projector = null, metadata = {} }) {
    if (!repoId || !group?.parts?.length) throw new Error('Model group is required');
    const id = crypto.randomUUID();
    const safeRepo = repoId.replace(/[^a-zA-Z0-9._-]+/g, '__');
    const destDir = path.join(this.getModelsDir(), safeRepo, group.quant || 'GGUF');
    await this.ensureDir(destDir);
    const files = [...group.parts];
    if (projector) files.push(projector);
    const job = {
      id,
      repoId,
      quant: group.quant || 'GGUF',
      status: 'downloading',
      totalBytes: files.reduce((sum, file) => sum + Number(file.size || 0), 0),
      downloadedBytes: 0,
      bytesPerSecond: 0,
      retryCount: 0,
      retryAfterMs: 0,
      retryAt: null,
      detail: null,
      destDir,
      files: files.map((file) => file.path),
      filesData: files,
      metadata,
      startedAt: new Date().toISOString(),
      controller: new AbortController(),
      paused: false,
      baseDownloaded: 0,
      error: null,
    };
    this.jobs.set(id, job);
    this.emit('download:progress', this.publicJob(job));
    this._run(job);
    return this.publicJob(job);
  }

  pause(id) {
    const job = this.jobs.get(id);
    if (!job || !['downloading', 'verifying', 'retrying', 'rate-limited'].includes(job.status)) return false;
    job.paused = true;
    job.controller.abort();
    return true;
  }

  resume(id) {
    const job = this.jobs.get(id);
    if (!job || !['paused', 'failed', 'cancelled'].includes(job.status)) return false;
    job.paused = false;
    job.error = null;
    job.status = 'downloading';
    job.controller = new AbortController();
    this.emit('download:progress', this.publicJob(job));
    this._run(job);
    return true;
  }

  cancel(id) {
    const job = this.jobs.get(id);
    if (!job) return false;
    job.paused = false;
    job.status = 'cancelled';
    job.controller.abort();
    this.emit('download:progress', this.publicJob(job));
    return true;
  }
}

module.exports = { DownloadManager, rateLimitWaitMs, transientNetworkError, sleepWithAbort };
