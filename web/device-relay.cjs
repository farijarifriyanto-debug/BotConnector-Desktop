const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const PAIR_TTL_MS = 5 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 20_000;
const LOCAL_AI_REQUEST_TIMEOUT_MS = 15 * 60 * 1000;
const LONG_LOCAL_AI_METHODS = new Set(['chat.completions', 'model.load', 'model.unload']);
// Agent streams stay open for as long as the session runs; they are aborted explicitly, never timed out.
const AGENT_STREAM_METHOD = 'agent.stream';
const AGENT_METHOD_PREFIX = 'agent.';

function hashToken(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex');
}

function websocketUrl(origin) {
  const url = new URL(origin);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.pathname = '/api/devices/socket';
  url.search = '';
  return url.toString();
}

class DeviceRelay {
  constructor({ appOrigin = 'https://app.botconnector.id', pairTtlMs = PAIR_TTL_MS, requestTimeoutMs = REQUEST_TIMEOUT_MS, stateFile = null } = {}) {
    this.appOrigin = appOrigin;
    this.pairTtlMs = pairTtlMs;
    this.requestTimeoutMs = requestTimeoutMs;
    this.pairs = new Map();
    this.devices = new Map();
    this.pending = new Map();
    this.wss = null;
    this.stateFile = stateFile ? String(stateFile) : null;
    this.loadState();
  }

  loadState() {
    if (!this.stateFile) return;
    try {
      const payload = JSON.parse(fs.readFileSync(this.stateFile, 'utf8'));
      const records = Array.isArray(payload?.devices) ? payload.devices : [];
      for (const record of records) {
        if (!record || typeof record !== 'object') continue;
        const id = String(record.id || '');
        const userId = String(record.userId || '');
        const tokenHash = String(record.tokenHash || '');
        if (!id || !userId || !/^[0-9a-f]{64}$/i.test(tokenHash)) continue;
        this.devices.set(id, {
          id,
          userId,
          tokenHash,
          name: String(record.name || 'BotConnector device').slice(0, 120),
          platform: String(record.platform || '').slice(0, 40),
          arch: String(record.arch || '').slice(0, 40),
          capabilities: Array.isArray(record.capabilities)
            ? record.capabilities.map(String).slice(0, 50)
            : [],
          hardware:
            record.hardware && typeof record.hardware === 'object' ? record.hardware : null,
          socket: null,
          lastSeen: record.lastSeen ? String(record.lastSeen) : null,
        });
      }
    } catch (error) {
      if (error?.code !== 'ENOENT') {
        console.error('BotConnector Device Relay: failed to load state:', error.message);
      }
    }
  }

  persistState() {
    if (!this.stateFile) return true;
    try {
      const directory = path.dirname(this.stateFile);
      fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
      const devices = [...this.devices.values()].map((device) => ({
        id: device.id,
        userId: device.userId,
        tokenHash: device.tokenHash,
        name: device.name,
        platform: device.platform,
        arch: device.arch,
        capabilities: device.capabilities,
        hardware: device.hardware,
        lastSeen: device.lastSeen,
      }));
      const temporary = `${this.stateFile}.${process.pid}.tmp`;
      fs.writeFileSync(
        temporary,
        JSON.stringify({ version: 1, devices }, null, 2) + '\n',
        { mode: 0o600 },
      );
      fs.chmodSync(temporary, 0o600);
      fs.renameSync(temporary, this.stateFile);
      fs.chmodSync(this.stateFile, 0o600);
      return true;
    } catch (error) {
      console.error('BotConnector Device Relay: failed to persist state:', error.message);
      return false;
    }
  }

  createPairCode(userId) {
    const code = crypto.randomBytes(6).toString('base64url').toUpperCase();
    const expiresAt = Date.now() + this.pairTtlMs;
    this.pairs.set(code, { userId, expiresAt });
    return { code, expires_at: new Date(expiresAt).toISOString() };
  }

  exchange({ code, device_name: deviceName, platform, arch } = {}) {
    const normalized = String(code || '').trim().toUpperCase();
    const pairing = this.pairs.get(normalized);
    this.pairs.delete(normalized);
    if (!pairing || pairing.expiresAt < Date.now()) {
      const error = new Error('Kode pairing sudah tidak berlaku.');
      error.status = 401;
      throw error;
    }
    const deviceId = crypto.randomUUID();
    const token = crypto.randomBytes(32).toString('base64url');
    this.devices.set(deviceId, {
      id: deviceId,
      userId: pairing.userId,
      tokenHash: hashToken(token),
      name: String(deviceName || 'BotConnector device').slice(0, 120),
      platform: String(platform || '').slice(0, 40),
      arch: String(arch || '').slice(0, 40),
      capabilities: [],
      hardware: null,
      socket: null,
      lastSeen: null,
    });
    this.persistState();
    return {
      device_id: deviceId,
      device_name: String(deviceName || 'BotConnector device').slice(0, 120),
      device_token: token,
      ws_url: websocketUrl(this.appOrigin),
    };
  }
  list(userId) {
    return [...this.devices.values()]
      .filter(device => device.userId === userId)
      .map(device => ({
        id: device.id,
        name: device.name,
        platform: device.platform,
        arch: device.arch,
        online: Boolean(device.socket && device.socket.readyState === 1),
        capabilities: device.capabilities,
        hardware: device.hardware,
        last_seen: device.lastSeen,
      }));
  }

  revoke(userId, deviceId) {
    const device = this.devices.get(String(deviceId || ''));
    if (!device || device.userId !== userId) return false;
    try { device.socket?.close(1008, 'Device revoked'); } catch {}
    this.devices.delete(device.id);
    this.persistState();
    return true;
  }

  verifyHello(message) {
    const device = this.devices.get(String(message?.deviceId || ''));
    if (!device || hashToken(message?.token) !== device.tokenHash) return null;
    return device;
  }

  attach(server, WebSocketServer) {
    if (!WebSocketServer) throw new Error('WebSocketServer unavailable.');
    this.wss = new WebSocketServer({ noServer: true, maxPayload: 1024 * 1024 });
    server.on('upgrade', (req, socket, head) => {
      let pathname = '';
      try { pathname = new URL(req.url, 'http://localhost').pathname; } catch {}
      if (pathname !== '/api/devices/socket') return;
      this.wss.handleUpgrade(req, socket, head, ws => this.acceptSocket(ws));
    });
  }

  acceptSocket(socket) {
    let authenticated = false;
    const helloTimer = setTimeout(() => {
      if (!authenticated) socket.close(1008, 'Authentication timeout');
    }, 8000);
    socket.on('message', data => {
      let message;
      try { message = JSON.parse(data.toString('utf8')); } catch { return; }
      if (!authenticated) {
        if (message?.type !== 'device.hello') return socket.close(1008, 'Device hello required');
        const device = this.verifyHello(message);
        if (!device) return socket.close(1008, 'Device authentication failed');
        authenticated = true;
        clearTimeout(helloTimer);
        if (device.socket && device.socket !== socket) {
          this.rejectPendingForDevice(device.id);
          try { device.socket.close(1008, 'Replaced by newer connection'); } catch {}
        }
        device.socket = socket;
        device.name = String(message.deviceName || device.name).slice(0, 120);
        device.capabilities = Array.isArray(message.capabilities) ? message.capabilities.map(String).slice(0, 50) : [];
        device.hardware = message.hardware && typeof message.hardware === 'object' ? message.hardware : null;
        device.lastSeen = new Date().toISOString();
        this.persistState();
        socket.deviceId = device.id;
        return;
      }
      if (message?.type === 'device.event') this.forwardEvent(socket.deviceId, message);
      if (message?.type === 'device.response') this.resolveResponse(socket.deviceId, message);
    });
    socket.on('close', () => {
      clearTimeout(helloTimer);
      const device = this.devices.get(socket.deviceId);
      if (device?.socket === socket) {
        device.socket = null;
        device.lastSeen = new Date().toISOString();
        this.persistState();
        // A device that drops its socket must not leave requests pending forever: agent streams have
        // no timeout, so an unsettled waiter would hold its capacity slot for good.
        this.rejectPendingForDevice(socket.deviceId);
      }
    });
  }

  rejectPendingForDevice(deviceId, error) {
    const failure = error || (() => {
      const err = new Error('Perangkat terputus koneksi.');
      err.status = 409;
      err.code = 'device_offline';
      return err;
    })();
    for (const [key, waiter] of [...this.pending.entries()]) {
      if (waiter.deviceId !== deviceId) continue;
      clearTimeout(waiter.timer);
      if (waiter.abortCleanup) waiter.abortCleanup();
      this.pending.delete(key);
      try {
        waiter.reject(failure);
      } catch {}
    }
  }

  forwardEvent(deviceId, message) {
    const key = String(message?.id || '');
    const waiter = this.pending.get(key);
    if (!waiter || waiter.deviceId !== deviceId || typeof waiter.onEvent !== 'function') return;
    try {
      waiter.onEvent(message?.event && typeof message.event === 'object' ? message.event : {});
    } catch {}
  }

  resolveResponse(deviceId, message) {
    const key = String(message?.id || '');
    const waiter = this.pending.get(key);
    if (!waiter || waiter.deviceId !== deviceId) return;
    clearTimeout(waiter.timer);
    if (waiter.abortCleanup) waiter.abortCleanup();
    this.pending.delete(key);
    if (message.ok === false) {
      const error = new Error(message.error?.message || 'Perangkat menolak permintaan.');
      if (typeof message.error?.code === 'string' && message.error.code) error.code = message.error.code;
      waiter.reject(error);
    } else {
      if (waiter.method === 'hardware.get' && message.result && typeof message.result === 'object') {
        const device = this.devices.get(deviceId);
        if (device) {
          device.hardware = message.result;
          device.lastSeen = new Date().toISOString();
          this.persistState();
        }
      }
      waiter.resolve(message.result);
    }
  }

  request(userId, deviceId, method, params = {}, options = {}) {
    const device = this.devices.get(String(deviceId || ''));
    if (!device || device.userId !== userId) {
      const error = new Error('Perangkat tidak ditemukan.');
      error.status = 404;
      throw error;
    }
    if (!device.socket || device.socket.readyState !== 1) {
      const error = new Error('Perangkat sedang offline.');
      error.status = 409;
      throw error;
    }
    if (!device.capabilities.includes(String(method))) {
      const error = new Error('Kemampuan tersebut tidak tersedia pada perangkat.');
      error.status = 403;
      error.code = 'device_method_not_allowed';
      throw error;
    }
    const id = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      const methodName = String(method);
      const isAgentStream = methodName === AGENT_STREAM_METHOD;
      const isAgentMethod = methodName.startsWith(AGENT_METHOD_PREFIX);
      const timeoutMs = isAgentStream
        ? 0 // agent streams are aborted explicitly, never timed out
        : isAgentMethod
          ? Math.max(this.requestTimeoutMs, LOCAL_AI_REQUEST_TIMEOUT_MS)
          : LONG_LOCAL_AI_METHODS.has(methodName)
            ? Math.max(this.requestTimeoutMs, LOCAL_AI_REQUEST_TIMEOUT_MS)
            : this.requestTimeoutMs;
      const timer = timeoutMs > 0
        ? setTimeout(() => {
          this.pending.delete(id);
          reject(Object.assign(new Error('Device request timed out.'), { status: 504 }));
        }, timeoutMs)
        : null;
      const waiter = {
        deviceId: device.id,
        method: methodName,
        resolve,
        reject,
        timer,
        onEvent: typeof options?.onEvent === 'function' ? options.onEvent : null,
        abortCleanup: null,
      };
      this.pending.set(id, waiter);

      // The caller went away (phone dropped the stream): stop the device work and free the slot.
      const signal = options?.signal;
      if (signal && typeof signal.addEventListener === 'function') {
        const onAbort = () => {
          const current = this.pending.get(id);
          if (!current) return;
          clearTimeout(current.timer);
          this.pending.delete(id);
          try {
            if (device.socket && device.socket.readyState === 1) {
              device.socket.send(JSON.stringify({ type: 'device.cancel', id }));
            }
          } catch {}
          const error = new Error('Permintaan perangkat dibatalkan.');
          error.code = 'aborted';
          current.reject(error);
        };
        if (signal.aborted) {
          onAbort();
          return;
        }
        waiter.abortCleanup = () => signal.removeEventListener('abort', onAbort);
        signal.addEventListener('abort', onAbort, { once: true });
      }

      try {
        device.socket.send(JSON.stringify({ type: 'device.request', id, method: methodName, params: params && typeof params === 'object' ? params : {} }));
      } catch (error) {
        clearTimeout(timer);
        if (waiter.abortCleanup) waiter.abortCleanup();
        this.pending.delete(id);
        reject(error);
      }
    });
  }

  close() {
    for (const waiter of this.pending.values()) {
      clearTimeout(waiter.timer);
      waiter.reject(new Error('Device relay stopped.'));
    }
    this.pending.clear();
    for (const device of this.devices.values()) {
      try { device.socket?.close(); } catch {}
      device.socket = null;
    }
    this.persistState();
    this.wss?.close();
  }
}

module.exports = {
  DeviceRelay,
  hashToken,
  websocketUrl,
  PAIR_TTL_MS,
  REQUEST_TIMEOUT_MS,
  LOCAL_AI_REQUEST_TIMEOUT_MS,
};
