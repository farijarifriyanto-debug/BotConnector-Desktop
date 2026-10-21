const childProcess = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { WebSocket: DefaultWebSocket } = require('ws');
const { WorkspaceStore } = require('./workspaces.cjs');
const { version: PACKAGE_VERSION } = require('../../package.json');

const MIN_BCCLI = '0.4.9';
const DEFAULT_HEARTBEAT_MS = 25_000;
const DEFAULT_IDLE_KILL_MS = 30 * 60 * 1000;
const DEFAULT_BANNER_TIMEOUT_MS = 15_000;
const DEFAULT_HEALTH_TIMEOUT_MS = 10_000;
const DEFAULT_HEALTH_POLL_MS = 500;
const SESSION_MESSAGES_MAX_BYTES = 200_000;
const WORKSPACES_LIMIT = 20;
const TOOL_OUTPUT_MAX_CHARS = 32 * 1024;
const EVENT_MAX_BYTES = 900_000;
const TRUNCATED_MARKER = '\n[truncated]';
const BANNER_REGEX = /bccli serve http:\/\/127\.0\.0\.1:(\d+)/;

const AGENT_METHODS = [
  'agent.capabilities',
  'agent.workspaces',
  'agent.sessions',
  'agent.session',
  'agent.start',
  'agent.prompt',
  'agent.approve',
  'agent.cancel',
  'agent.stream',
];

const AGENT_ERROR_CODES = new Set([
  'agent_runtime_missing',
  'agent_not_configured',
  'agent_unsupported',
  'agent_busy',
  'agent_capacity',
]);

class AgentError extends Error {
  constructor(code, message) {
    super(message || code);
    this.name = 'AgentError';
    this.code = code;
  }
}

function parseSemver(version) {
  const raw = String(version || '').trim().replace(/^v/i, '');
  const match = raw.match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function compareSemver(a, b) {
  const pa = parseSemver(a);
  const pb = parseSemver(b);
  if (!pa || !pb) return -1;
  for (let i = 0; i < 3; i += 1) {
    if (pa[i] !== pb[i]) return pa[i] > pb[i] ? 1 : -1;
  }
  return 0;
}

function sliceUtf8Clean(str, maxBytes) {
  const buf = Buffer.from(str, 'utf8');
  if (buf.length <= maxBytes) return str;
  let end = Math.max(0, maxBytes);
  while (end > 0 && (buf[end] & 0xc0) === 0x80) {
    end -= 1;
  }
  return buf.subarray(0, end).toString('utf8');
}

function capItem(rawValue) {
  if (!rawValue || typeof rawValue !== 'object') return rawValue;
  const v = { ...rawValue };
  if (
    v.type === 'tool_result' &&
    typeof v.output === 'string' &&
    v.output.length > TOOL_OUTPUT_MAX_CHARS
  ) {
    v.output = v.output.slice(0, TOOL_OUTPUT_MAX_CHARS) + TRUNCATED_MARKER;
  }
  while (
    typeof v.display === 'string' &&
    v.display.length > 0 &&
    Buffer.byteLength(JSON.stringify({ item: v }), 'utf8') > EVENT_MAX_BYTES
  ) {
    const stripped = v.display.endsWith(TRUNCATED_MARKER)
      ? v.display.slice(0, -TRUNCATED_MARKER.length)
      : v.display;
    const currentBytes = Buffer.byteLength(stripped, 'utf8');
    const nextBytes = Math.floor(currentBytes * 0.9);
    if (nextBytes <= 0) {
      v.display = TRUNCATED_MARKER;
      break;
    }
    v.display = sliceUtf8Clean(stripped, nextBytes) + TRUNCATED_MARKER;
  }
  return v;
}

class AgentBridge {
  constructor({
    fetchImpl = globalThis.fetch,
    spawnImpl = childProcess.spawn,
    WebSocketImpl = DefaultWebSocket,
    now = () => Date.now(),
    heartbeatMs = DEFAULT_HEARTBEAT_MS,
    idleKillMs = DEFAULT_IDLE_KILL_MS,
    bannerTimeoutMs = DEFAULT_BANNER_TIMEOUT_MS,
    healthTimeoutMs = DEFAULT_HEALTH_TIMEOUT_MS,
    healthPollMs = DEFAULT_HEALTH_POLL_MS,
    dataDir = null,
    homeDir = null,
    env = process.env,
    platform = process.platform,
    workspaces = null,
    deviceCliVersion = PACKAGE_VERSION,
  } = {}) {
    this.fetch = fetchImpl;
    this.spawn = spawnImpl;
    this.WebSocketImpl = WebSocketImpl || DefaultWebSocket;
    this.now = now;
    this.heartbeatMs = heartbeatMs;
    this.idleKillMs = idleKillMs;
    this.bannerTimeoutMs = bannerTimeoutMs;
    this.healthTimeoutMs = healthTimeoutMs;
    this.healthPollMs = healthPollMs;
    this.env = env || process.env;
    this.platform = platform || process.platform;
    this.homeDir = homeDir || os.homedir();
    this.dataDir =
      dataDir ||
      this.env.BOTCONNECTOR_DEVICE_DATA_DIR ||
      path.join(this.homeDir, '.botconnector-device');
    this.workspaces = workspaces;
    this.deviceCliVersion = String(deviceCliVersion || PACKAGE_VERSION);

    this.serveState = null;
    this.ensureServePromise = null;
    this.idleTimer = null;
    this.lastActivityAt = 0;
    this.openStreams = 0;
    this.lastDiscoveredVersion = null;
    this.activeMuxSockets = new Set();
  }

  candidatePaths() {
    const candidates = [];
    const envPath = String(this.env?.BOTCONNECTOR_BCCLI_PATH || '').trim();
    if (envPath) candidates.push(envPath);

    if (this.platform === 'win32') {
      candidates.push('bccli.cmd', 'bccli');
      candidates.push(
        path.join(this.homeDir, '.bccli', 'bin', 'bccli.cmd'),
        path.join(this.homeDir, '.bccli', 'bin', 'bccli.exe'),
        path.join(this.homeDir, '.bccli', 'bin', 'bccli'),
      );
    } else {
      candidates.push('bccli');
      candidates.push(path.join(this.homeDir, '.bccli', 'bin', 'bccli'));
    }
    return [...new Set(candidates)];
  }

  probeBinary(candidate, timeoutMs = 5_000) {
    // If candidate is an explicit path inside ~/.bccli/bin and not set via env, check fs existence if absolute
    const envOverride = String(this.env?.BOTCONNECTOR_BCCLI_PATH || '').trim();
    if (candidate !== envOverride && path.isAbsolute(candidate)) {
      try {
        if (!fs.existsSync(candidate)) return Promise.resolve(null);
      } catch {
        return Promise.resolve(null);
      }
    }

    return new Promise((resolve) => {
      let settled = false;
      let stdout = '';
      let child;
      const done = (result) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(result);
      };
      const timer = setTimeout(() => {
        try {
          child?.kill?.();
        } catch {}
        done(null);
      }, timeoutMs);
      timer.unref?.();

      try {
        child = this.spawn(candidate, ['--version'], {
          env: this.env,
          windowsHide: true,
          stdio: ['ignore', 'pipe', 'pipe'],
          detached: false,
        });
      } catch {
        done(null);
        return;
      }

      child.stdout?.on?.('data', (chunk) => {
        stdout += Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk);
      });
      child.once('error', () => done(null));
      child.once('exit', (code) => {
        if (code === 0) {
          const match = stdout.trim().match(/(\d+\.\d+\.\d+[^\s]*)/);
          const version = match ? match[1] : stdout.trim() || null;
          done({ path: candidate, version });
        } else {
          done(null);
        }
      });
    });
  }

  async discoverBccli() {
    for (const candidate of this.candidatePaths()) {
      const probed = await this.probeBinary(candidate);
      if (probed) {
        if (probed.version) this.lastDiscoveredVersion = probed.version;
        return probed.path;
      }
    }
    throw new AgentError(
      'agent_runtime_missing',
      'bccli runtime was not found on this computer. Install it with: npm i -g @botconnector/bccli',
    );
  }

  isChildAlive(child) {
    return Boolean(child && !child.killed && child.exitCode === null);
  }

  async checkHealth(port, token) {
    const response = await this.fetch(`http://127.0.0.1:${port}/health`, {
      method: 'GET',
      headers: {
        authorization: `Bearer ${token}`,
        accept: 'application/json',
      },
      signal: AbortSignal.timeout(2_500),
    });
    if (!response.ok) {
      const error = new Error(`bccli health returned HTTP ${response.status}`);
      error.httpStatus = response.status;
      throw error;
    }
    const data = await response.json().catch(() => ({}));
    if (data && data.ok === false) {
      const error = new Error('bccli health reported ok:false');
      error.httpStatus = 500;
      throw error;
    }
    return {
      ok: true,
      version: typeof data?.version === 'string' ? data.version : this.lastDiscoveredVersion,
    };
  }

  async waitForHealthy(child, port, token) {
    const started = this.now();
    while (this.now() - started < this.healthTimeoutMs) {
      if (!this.isChildAlive(child)) {
        throw new AgentError('agent_runtime_missing', 'bccli serve exited before becoming healthy.');
      }
      try {
        return await this.checkHealth(port, token);
      } catch (error) {
        if (typeof error?.httpStatus === 'number') {
          throw new AgentError(
            'agent_runtime_missing',
            `bccli serve health check failed (HTTP ${error.httpStatus}).`,
          );
        }
      }
      await new Promise((resolve) => setTimeout(resolve, this.healthPollMs));
    }
    throw new AgentError('agent_runtime_missing', 'bccli serve did not become healthy in time.');
  }

  async spawnServeOnce(binary) {
    const token = crypto.randomBytes(32).toString('hex');
    const env = {
      ...this.env,
      BCCLI_SERVE_TOKEN: token,
    };

    let child;
    try {
      child = this.spawn(binary, ['serve', '--port', '0', '--token', token], {
        env,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: false,
      });
    } catch (error) {
      throw new AgentError(
        'agent_runtime_missing',
        `Failed to start bccli serve: ${error?.message || error}`,
      );
    }

    const port = await new Promise((resolve, reject) => {
      let stderrBuf = '';
      let settled = false;
      const done = (fn, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        fn(value);
      };
      const timer = setTimeout(() => {
        done(
          reject,
          new AgentError('agent_runtime_missing', 'Timed out waiting for bccli serve banner.'),
        );
      }, this.bannerTimeoutMs);
      timer.unref?.();

      const onData = (chunk) => {
        stderrBuf += Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk);
        const match = stderrBuf.match(BANNER_REGEX);
        if (match) {
          done(resolve, Number(match[1]));
        }
      };

      child.stderr?.on?.('data', onData);
      child.once('error', (err) => {
        done(
          reject,
          new AgentError(
            'agent_runtime_missing',
            `bccli serve failed to spawn: ${err?.message || err}`,
          ),
        );
      });
      child.once('exit', (code) => {
        done(
          reject,
          new AgentError(
            'agent_runtime_missing',
            `bccli serve exited prematurely with code ${code ?? 'unknown'}.`,
          ),
        );
      });
    }).catch((error) => {
      try {
        child.kill();
      } catch {}
      throw error;
    });

    try {
      const health = await this.waitForHealthy(child, port, token);
      const state = {
        port,
        token,
        child,
        version: health.version || this.lastDiscoveredVersion || null,
      };
      this.serveState = state;
      const clearIfCurrent = () => {
        if (this.serveState === state) {
          this.serveState = null;
          this.clearIdleTimer();
        }
      };
      child.once('exit', clearIfCurrent);
      child.once('error', clearIfCurrent);
      this.touch();
      return { port, token, version: state.version };
    } catch (error) {
      try {
        child.kill();
      } catch {}
      if (this.serveState?.child === child) {
        this.serveState = null;
      }
      throw error instanceof AgentError
        ? error
        : new AgentError('agent_runtime_missing', error?.message || 'bccli serve health check failed.');
    }
  }

  async ensureServe() {
    if (this.ensureServePromise) return this.ensureServePromise;
    this.ensureServePromise = this._ensureServeInner().finally(() => {
      this.ensureServePromise = null;
    });
    return this.ensureServePromise;
  }

  async _ensureServeInner() {
    if (this.serveState && this.isChildAlive(this.serveState.child)) {
      try {
        const health = await this.checkHealth(this.serveState.port, this.serveState.token);
        if (health.version) this.serveState.version = health.version;
        this.touch();
        return { port: this.serveState.port, token: this.serveState.token };
      } catch {
        this.killServe();
        const binary = await this.discoverBccli();
        const restarted = await this.spawnServeOnce(binary);
        return { port: restarted.port, token: restarted.token };
      }
    }

    const binary = await this.discoverBccli();
    try {
      const started = await this.spawnServeOnce(binary);
      return { port: started.port, token: started.token };
    } catch {
      this.killServe();
      const restarted = await this.spawnServeOnce(binary);
      return { port: restarted.port, token: restarted.token };
    }
  }

  async preflight() {
    const { port, token } = await this.ensureServe();
    const version = this.serveState?.version || this.lastDiscoveredVersion || '';
    if (compareSemver(version, MIN_BCCLI) < 0) {
      throw new AgentError(
        'agent_unsupported',
        `bccli ${version || 'unknown'} is too old (minimum ${MIN_BCCLI}). Update with: npm i -g @botconnector/bccli`,
      );
    }

    let response;
    try {
      response = await this.fetch(`http://127.0.0.1:${port}/v1/models`, {
        method: 'GET',
        headers: {
          authorization: `Bearer ${token}`,
          accept: 'application/json',
        },
        signal: AbortSignal.timeout(5_000),
      });
    } catch (error) {
      throw new AgentError(
        'agent_runtime_missing',
        `Failed to query bccli models: ${error?.message || error}`,
      );
    }

    if (response.status === 401 || response.status === 403) {
      throw new AgentError(
        'agent_not_configured',
        'bccli is not configured with a usable provider or account. Configure bccli or sign in at https://app.botconnector.id.',
      );
    }
    if (!response.ok) {
      throw new AgentError(
        'agent_runtime_missing',
        `bccli /v1/models returned HTTP ${response.status}.`,
      );
    }

    const payload = await response.json().catch(() => null);
    const models = Array.isArray(payload)
      ? payload
      : Array.isArray(payload?.models)
        ? payload.models
        : Array.isArray(payload?.data)
          ? payload.data
          : [];

    if (models.length === 0) {
      throw new AgentError(
        'agent_not_configured',
        'bccli has no configured models. Configure a provider or sign in at https://app.botconnector.id.',
      );
    }

    this.touch();
    return { bccliVersion: version };
  }

  getWorkspaces() {
    if (!this.workspaces) {
      this.workspaces = new WorkspaceStore({
        dataDir: this.dataDir,
        defaultPath: this.homeDir,
      });
    }
    return this.workspaces;
  }

  async requestServe(pathname, init = {}) {
    const doFetch = async ({ port, token }) => {
      const headers = {
        authorization: `Bearer ${token}`,
        accept: 'application/json',
        ...(init.body ? { 'content-type': 'application/json' } : {}),
        ...(init.headers || {}),
      };
      return this.fetch(`http://127.0.0.1:${port}${pathname}`, {
        ...init,
        headers,
      });
    };

    const firstServe = await this.ensureServe();
    let response;
    try {
      response = await doFetch(firstServe);
    } catch {
      this.killServe();
      try {
        const restartedServe = await this.ensureServe();
        response = await doFetch(restartedServe);
      } catch (retryError) {
        throw retryError instanceof AgentError
          ? retryError
          : new AgentError(
              'agent_runtime_missing',
              `bccli serve request failed: ${retryError?.message || retryError}`,
            );
      }
    }

    this.touch();
    return response;
  }

  async capabilities() {
    // Quick probe only; never spawns bccli serve and never throws when bccli is missing.
    let bccliVersion = this.serveState?.version || this.lastDiscoveredVersion || null;
    if (!bccliVersion) {
      try {
        await this.discoverBccli();
        bccliVersion = this.lastDiscoveredVersion || null;
      } catch {
        bccliVersion = null;
      }
    }
    return {
      supported: true,
      deviceCliVersion: this.deviceCliVersion,
      bccliVersion,
    };
  }

  async listWorkspaces() {
    const raw = this.getWorkspaces().list();
    const list = Array.isArray(raw) ? raw.slice() : [];
    list.sort((a, b) => {
      const ta = Date.parse(a?.lastUsed || a?.updatedAt || a?.createdAt || '') || 0;
      const tb = Date.parse(b?.lastUsed || b?.updatedAt || b?.createdAt || '') || 0;
      return tb - ta;
    });
    return list.slice(0, WORKSPACES_LIMIT).map((item) => {
      const entry = { path: String(item?.path || '') };
      if (item?.name) entry.name = String(item.name);
      const lastUsed = item?.lastUsed || item?.updatedAt || item?.createdAt;
      if (lastUsed) entry.lastUsed = String(lastUsed);
      return entry;
    });
  }

  async listSessions(params = {}) {
    const cwd = params?.cwd ? String(params.cwd).trim() : '';
    const query = cwd ? `?cwd=${encodeURIComponent(cwd)}` : '';
    const response = await this.requestServe(`/v1/sessions${query}`, { method: 'GET' });
    if (!response.ok) {
      throw new AgentError(
        'agent_runtime_missing',
        `bccli GET /v1/sessions returned HTTP ${response.status}.`,
      );
    }
    const data = await response.json().catch(() => []);
    return Array.isArray(data) ? data : [];
  }

  async getSession(params = {}) {
    const id = String(params?.id || params?.sessionId || '').trim();
    if (!id) throw new Error('session id is required.');
    const cwd = params?.cwd ? String(params.cwd).trim() : '';
    const query = cwd ? `?cwd=${encodeURIComponent(cwd)}` : '';
    const response = await this.requestServe(
      `/v1/sessions/${encodeURIComponent(id)}${query}`,
      { method: 'GET' },
    );
    if (!response.ok) {
      throw new AgentError(
        'agent_runtime_missing',
        `bccli GET /v1/sessions/${id} returned HTTP ${response.status}.`,
      );
    }
    const session = (await response.json().catch(() => ({}))) || {};
    const allMessages = Array.isArray(session.messages) ? session.messages : [];
    const kept = allMessages.slice();
    let omittedCount = 0;
    while (
      kept.length > 0 &&
      Buffer.byteLength(JSON.stringify(kept), 'utf8') > SESSION_MESSAGES_MAX_BYTES
    ) {
      kept.shift();
      omittedCount += 1;
    }
    const baseline = {
      ...session,
      messages: kept,
    };
    if (omittedCount > 0) {
      baseline.truncated = true;
      baseline.omittedCount = omittedCount;
    }
    return baseline;
  }

  async startSession(params = {}) {
    if (params && params.permissionMode !== undefined) {
      throw new Error('permissionMode is fixed to ask');
    }
    const cwd = String(params?.cwd || '').trim();
    if (!cwd) throw new Error('cwd is required.');
    await this.preflight();
    const payload = {
      cwd,
      permissionMode: 'ask',
      ...(params?.model ? { model: String(params.model) } : {}),
    };
    const response = await this.requestServe('/v1/sessions', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      throw new AgentError(
        'agent_runtime_missing',
        `bccli POST /v1/sessions returned HTTP ${response.status}.`,
      );
    }
    const data = (await response.json().catch(() => ({}))) || {};
    const sessionId = data.sessionId || data.id;
    if (!sessionId) {
      throw new AgentError('agent_runtime_missing', 'bccli did not return a sessionId.');
    }
    return { sessionId: String(sessionId) };
  }

  async sendPrompt(params = {}) {
    const sessionId = String(params?.sessionId || '').trim();
    const prompt = String(params?.prompt ?? '');
    if (!sessionId || !prompt.trim()) {
      throw new Error('sessionId and prompt are required.');
    }
    const response = await this.requestServe(
      `/v1/sessions/${encodeURIComponent(sessionId)}/messages`,
      {
        method: 'POST',
        body: JSON.stringify({ prompt }),
      },
    );
    if (response.status === 409) {
      throw new AgentError('agent_busy', 'Agent session is already running a turn.');
    }
    if (!response.ok) {
      throw new AgentError(
        'agent_runtime_missing',
        `bccli POST /v1/sessions/${sessionId}/messages returned HTTP ${response.status}.`,
      );
    }
    const data = (await response.json().catch(() => ({}))) || {};
    return { turnId: data.turnId ? String(data.turnId) : null };
  }

  async approve(params = {}) {
    const answer = String(params?.answer || '');
    if (!['yes', 'no', 'session'].includes(answer)) {
      throw new Error('answer must be yes|no|session');
    }
    const sessionId = String(params?.sessionId || '').trim();
    const requestId = String(params?.requestId || '').trim();
    if (!sessionId || !requestId) {
      throw new Error('sessionId and requestId are required.');
    }
    const response = await this.requestServe(
      `/v1/sessions/${encodeURIComponent(sessionId)}/approvals`,
      {
        method: 'POST',
        body: JSON.stringify({ requestId, answer }),
      },
    );
    if (!response.ok) {
      throw new AgentError(
        'agent_runtime_missing',
        `bccli POST /v1/sessions/${sessionId}/approvals returned HTTP ${response.status}.`,
      );
    }
    return { ok: true };
  }

  async cancel(params = {}) {
    const sessionId = String(params?.sessionId || '').trim();
    if (!sessionId) throw new Error('sessionId is required.');
    const response = await this.requestServe(
      `/v1/sessions/${encodeURIComponent(sessionId)}/cancel`,
      {
        method: 'POST',
        body: JSON.stringify({}),
      },
    );
    if (!response.ok) {
      throw new AgentError(
        'agent_runtime_missing',
        `bccli POST /v1/sessions/${sessionId}/cancel returned HTTP ${response.status}.`,
      );
    }
    return { ok: true };
  }

  async stream(sessionId, params = {}, onEvent = null, signal = null) {
    const sid = String(sessionId || params?.sessionId || '').trim();
    if (!sid) throw new Error('sessionId is required.');
    if (signal?.aborted) {
      const err = new Error('Agent stream aborted.');
      err.code = 'aborted';
      throw err;
    }

    const { port, token } = await this.ensureServe();
    if (signal?.aborted) {
      const err = new Error('Agent stream aborted.');
      err.code = 'aborted';
      throw err;
    }

    this.openStreams += 1;
    this.touch();

    return new Promise((resolve, reject) => {
      const streamId = `agent-${crypto.randomUUID()}`;
      let settled = false;
      let readySeen = false;
      let abortHandler = null;
      let ws;

      try {
        ws = new this.WebSocketImpl(`ws://127.0.0.1:${port}/v1/mux`, {
          headers: {
            authorization: `Bearer ${token}`,
          },
        });
      } catch (err) {
        this.openStreams = Math.max(0, this.openStreams - 1);
        this.touch();
        reject(
          new AgentError(
            'agent_runtime_missing',
            `Failed to open bccli mux WebSocket: ${err?.message || err}`,
          ),
        );
        return;
      }

      this.activeMuxSockets.add(ws);

      const heartbeatTimer =
        this.heartbeatMs > 0
          ? setInterval(() => {
              this.touch();
              if (typeof onEvent === 'function') {
                try {
                  onEvent({ heartbeat: true });
                } catch {}
              }
            }, this.heartbeatMs)
          : null;
      heartbeatTimer?.unref?.();

      const cleanup = () => {
        if (heartbeatTimer) clearInterval(heartbeatTimer);
        if (abortHandler && typeof signal?.removeEventListener === 'function') {
          signal.removeEventListener('abort', abortHandler);
        }
        this.activeMuxSockets.delete(ws);
        this.openStreams = Math.max(0, this.openStreams - 1);
        this.touch();
        try {
          if (ws && (ws.readyState === 0 || ws.readyState === 1)) {
            ws.close();
          }
        } catch {}
      };

      const finishResolve = (value) => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(value);
      };

      const finishReject = (error) => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(error);
      };

      if (signal && typeof signal.addEventListener === 'function') {
        abortHandler = () => {
          const err = new Error('Agent stream aborted.');
          err.code = 'aborted';
          finishReject(err);
        };
        if (signal.aborted) {
          abortHandler();
          return;
        }
        signal.addEventListener('abort', abortHandler, { once: true });
      }

      const attach = (event, fn) => {
        if (typeof ws.on === 'function') ws.on(event, fn);
        else if (typeof ws.addEventListener === 'function') {
          ws.addEventListener(event, (ev) => fn(ev?.data !== undefined ? ev.data : ev));
        }
      };

      attach('open', () => {
        try {
          ws.send(
            JSON.stringify({
              type: 'open',
              streamId,
              target: `session:${sid}`,
            }),
          );
        } catch (err) {
          finishReject(
            new AgentError(
              'agent_runtime_missing',
              `Failed to send mux open frame: ${err?.message || err}`,
            ),
          );
        }
      });

      attach('message', (raw) => {
        if (settled) return;
        let frame;
        try {
          frame = JSON.parse(Buffer.isBuffer(raw) ? raw.toString('utf8') : String(raw));
        } catch {
          return;
        }
        if (frame?.streamId && frame.streamId !== streamId) return;
        this.touch();

        if (frame?.type === 'item') {
          readySeen = true;
          const value = frame.value !== undefined ? frame.value : frame.item;
          if (typeof onEvent === 'function') {
            onEvent({ item: capItem(value) });
          }
          return;
        }
        if (frame?.type === 'ready') {
          readySeen = true;
          const value =
            frame.value && typeof frame.value === 'object'
              ? { type: 'ready', ...frame.value }
              : { ...frame };
          delete value.streamId;
          if (typeof onEvent === 'function') {
            onEvent({ item: capItem(value) });
          }
          return;
        }
        if (frame?.type === 'end') {
          finishResolve({ ok: true });
          return;
        }
        if (frame?.type === 'error') {
          finishReject(
            new AgentError(
              'agent_runtime_missing',
              frame?.message || frame?.error?.message || 'bccli mux stream error.',
            ),
          );
        }
      });

      attach('error', (err) => {
        finishReject(
          new AgentError(
            'agent_runtime_missing',
            `bccli mux WebSocket error: ${err?.message || err}`,
          ),
        );
      });

      attach('close', () => {
        if (settled) return;
        if (readySeen) {
          finishResolve({ ok: true });
        } else {
          finishReject(
            new AgentError('agent_runtime_missing', 'bccli mux closed before becoming ready.'),
          );
        }
      });
    });
  }

  async handle(method, params = {}, onEvent = null, signal = null) {
    if (method === 'agent.capabilities') return this.capabilities();
    if (method === 'agent.workspaces') return this.listWorkspaces();
    if (method === 'agent.sessions') return this.listSessions(params);
    if (method === 'agent.session') return this.getSession(params);
    if (method === 'agent.start') return this.startSession(params);
    if (method === 'agent.prompt') return this.sendPrompt(params);
    if (method === 'agent.approve') return this.approve(params);
    if (method === 'agent.cancel') return this.cancel(params);
    if (method === 'agent.stream' && typeof this.stream === 'function') {
      return this.stream(params?.sessionId, params, onEvent, signal);
    }
    throw new Error(`Unsupported agent method: ${method}`);
  }

  clearIdleTimer() {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
  }

  touch() {
    this.lastActivityAt = this.now();
    this.scheduleIdleKill();
  }

  scheduleIdleKill() {
    this.clearIdleTimer();
    if (!this.serveState || !(this.idleKillMs > 0)) return;
    const elapsed = Math.max(0, this.now() - this.lastActivityAt);
    const delay = Math.max(1, this.idleKillMs - elapsed);
    this.idleTimer = setTimeout(() => {
      this.idleTimer = null;
      if (!this.serveState) return;
      if (this.openStreams > 0) {
        this.scheduleIdleKill();
        return;
      }
      if (this.now() - this.lastActivityAt >= this.idleKillMs) {
        this.killServe();
      } else {
        this.scheduleIdleKill();
      }
    }, delay);
    this.idleTimer.unref?.();
  }

  killServe() {
    this.clearIdleTimer();
    const current = this.serveState;
    this.serveState = null;
    if (current?.child) {
      try {
        current.child.kill();
      } catch {}
    }
  }

  async close() {
    for (const ws of [...this.activeMuxSockets]) {
      try {
        ws.close();
      } catch {}
    }
    this.activeMuxSockets.clear();
    this.killServe();
  }
}

module.exports = {
  AgentBridge,
  AgentError,
  AGENT_ERROR_CODES,
  AGENT_METHODS,
  MIN_BCCLI,
  compareSemver,
  capItem,
  sliceUtf8Clean,
};
