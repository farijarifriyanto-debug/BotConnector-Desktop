const crypto = require('node:crypto');

const PAIR_TTL_MS = 5 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 20_000;

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
  constructor({ appOrigin = 'https://app.botconnector.id', pairTtlMs = PAIR_TTL_MS, requestTimeoutMs = REQUEST_TIMEOUT_MS } = {}) {
    this.appOrigin = appOrigin;
    this.pairTtlMs = pairTtlMs;
    this.requestTimeoutMs = requestTimeoutMs;
    this.pairs = new Map();
    this.devices = new Map();
    this.pending = new Map();
    this.wss = null;
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
          try { device.socket.close(1008, 'Replaced by newer connection'); } catch {}
        }
        device.socket = socket;
        device.name = String(message.deviceName || device.name).slice(0, 120);
        device.capabilities = Array.isArray(message.capabilities) ? message.capabilities.map(String).slice(0, 50) : [];
        device.hardware = message.hardware && typeof message.hardware === 'object' ? message.hardware : null;
        device.lastSeen = new Date().toISOString();
        socket.deviceId = device.id;
        return;
      }
      if (message?.type === 'device.response') this.resolveResponse(socket.deviceId, message);
    });
    socket.on('close', () => {
      clearTimeout(helloTimer);
      const device = this.devices.get(socket.deviceId);
      if (device?.socket === socket) {
        device.socket = null;
        device.lastSeen = new Date().toISOString();
      }
    });
  }

  resolveResponse(deviceId, message) {
    const key = String(message?.id || '');
    const waiter = this.pending.get(key);
    if (!waiter || waiter.deviceId !== deviceId) return;
    clearTimeout(waiter.timer);
    this.pending.delete(key);
    if (message.ok === false) waiter.reject(new Error(message.error?.message || 'Perangkat menolak permintaan.'));
    else {
      if (waiter.method === 'hardware.get' && message.result && typeof message.result === 'object') {
        const device = this.devices.get(deviceId);
        if (device) { device.hardware = message.result; device.lastSeen = new Date().toISOString(); }
      }
      waiter.resolve(message.result);
    }
  }

  request(userId, deviceId, method, params = {}) {
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
      throw error;
    }
    const id = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(Object.assign(new Error('Permintaan ke perangkat melewati batas waktu.'), { status: 504 }));
      }, this.requestTimeoutMs);
      this.pending.set(id, { deviceId: device.id, method: String(method), resolve, reject, timer });
      try {
        device.socket.send(JSON.stringify({ type: 'device.request', id, method: String(method), params: params && typeof params === 'object' ? params : {} }));
      } catch (error) {
        clearTimeout(timer);
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
    this.wss?.close();
  }
}

module.exports = { DeviceRelay, hashToken, websocketUrl, PAIR_TTL_MS, REQUEST_TIMEOUT_MS };
