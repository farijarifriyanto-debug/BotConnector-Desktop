const childProcess = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const MIN_BCCLI = '0.4.9';
const DEFAULT_HEARTBEAT_MS = 25_000;
const DEFAULT_IDLE_KILL_MS = 30 * 60 * 1000;
const DEFAULT_BANNER_TIMEOUT_MS = 15_000;
const DEFAULT_HEALTH_TIMEOUT_MS = 10_000;
const DEFAULT_HEALTH_POLL_MS = 500;
const BANNER_REGEX = /bccli serve http:\/\/127\.0\.0\.1:(\d+)/;

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

class AgentBridge {
  constructor({
    fetchImpl = globalThis.fetch,
    spawnImpl = childProcess.spawn,
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
  } = {}) {
    this.fetch = fetchImpl;
    this.spawn = spawnImpl;
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

    this.serveState = null;
    this.ensureServePromise = null;
    this.idleTimer = null;
    this.lastActivityAt = 0;
    this.openStreams = 0;
    this.lastDiscoveredVersion = null;
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
    this.killServe();
  }
}

module.exports = {
  AgentBridge,
  AgentError,
  AGENT_ERROR_CODES,
  MIN_BCCLI,
  compareSemver,
};
