const os = require('node:os');

function defaultDeviceName() {
  return os.hostname() || 'BotConnector device';
}

function wsState(socket) {
  if (!socket) return 'DISCONNECTED';
  return ['CONNECTING', 'CONNECTED', 'CLOSING', 'DISCONNECTED'][socket.readyState] || 'DISCONNECTED';
}

class DeviceBridge {
  constructor({ settings, detectHardware, tools, launcher, localAi = null, emit = () => {}, seal = value => value, open = value => value, cloudBase = 'https://app.botconnector.id', WebSocketImpl = globalThis.WebSocket } = {}) {
    this.settings = settings;
    this.detectHardware = detectHardware;
    this.tools = tools;
    this.launcher = launcher;
    this.localAi = localAi;
    this.emit = emit;
    this.seal = seal;
    this.open = open;
    this.cloudBase = String(cloudBase).replace(/\/$/, '');
    this.WebSocketImpl = WebSocketImpl;
    this.socket = null;
    this.reconnectTimer = null;
    this.manualClose = false;
  }

  pairing() {
    const value = this.settings?.get('devicePairing');
    return value && typeof value === 'object' ? value : null;
  }
  status() {
    const pairing = this.pairing();
    return {
      paired: Boolean(pairing?.deviceId && pairing?.token),
      deviceId: pairing?.deviceId || null,
      deviceName: pairing?.deviceName || defaultDeviceName(),
      connection: wsState(this.socket),
      launcherProfiles: this.launcher?.list() || [],
    };
  }

  async pair(code) {
    const pairingCode = String(code || '').trim().toUpperCase();
    if (!/^[A-Z0-9-]{6,32}$/.test(pairingCode)) throw new Error('Invalid pairing code.');
    const response = await fetch(`${this.cloudBase}/api/devices/pair/exchange`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ code: pairingCode, device_name: defaultDeviceName(), platform: process.platform, arch: process.arch }),
      signal: AbortSignal.timeout(10000),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.device_token || !payload.device_id || !payload.ws_url) {
      throw new Error(payload.error?.message || 'Device pairing failed.');
    }
    await this.settings.set('devicePairing', {
      deviceId: String(payload.device_id),
      deviceName: String(payload.device_name || defaultDeviceName()),
      token: this.seal(String(payload.device_token)),
      wsUrl: String(payload.ws_url),
    });
    await this.connect();
    this.emit('device:changed', this.status());
    return this.status();
  }

  async unpair() {
    this.manualClose = true;
    clearTimeout(this.reconnectTimer);
    this.socket?.close();
    this.socket = null;
    await this.settings.set('devicePairing', null);
    this.emit('device:changed', this.status());
    return this.status();
  }

  async connect() {
    const pairing = this.pairing();
    if (!pairing?.deviceId || !pairing?.token || !pairing?.wsUrl || !this.WebSocketImpl) return this.status();
    if (this.socket && this.socket.readyState <= 1) return this.status();
    this.manualClose = false;
    const token = this.open(pairing.token);
    const socket = new this.WebSocketImpl(pairing.wsUrl);
    this.socket = socket;
    socket.addEventListener('open', async () => {
      const hardware = await this.detectHardware();
      socket.send(JSON.stringify({
        type: 'device.hello',
        token,
        deviceId: pairing.deviceId,
        deviceName: pairing.deviceName || defaultDeviceName(),
        capabilities: [
          'hardware.get',
          'launcher.list',
          'launcher.start',
          'launcher.stop',
          'tools.list',
          ...(this.localAi?.enabled
            ? [
                'runtime.status',
                'runtime.start',
                'runtime.stop',
                'runtime.install.start',
                'runtime.install.status',
                'runtime.install.list',
                'models.list',
                'models.pull.start',
                'models.pull.status',
                'models.pull.list',
                'models.pull.cancel',
                'models.delete',
                'model.load',
                'model.unload',
                'chat.completions',
                'chat.cancel',
              ]
            : []),
        ],
        hardware,
      }));
      this.emit('device:changed', this.status());
    });
    socket.addEventListener('message', event => {
      this.handleMessage(event.data).catch(error => this.emit('device:error', { message: error.message }));
    });
    socket.addEventListener('close', () => {
      if (this.socket === socket) this.socket = null;
      this.emit('device:changed', this.status());
      if (!this.manualClose && this.pairing()) {
        clearTimeout(this.reconnectTimer);
        this.reconnectTimer = setTimeout(() => this.connect().catch(() => {}), 3000);
      }
    });
    socket.addEventListener('error', () => this.emit('device:changed', this.status()));
    return this.status();
  }

  async handleMessage(raw) {
    let message;
    try { message = JSON.parse(typeof raw === 'string' ? raw : Buffer.from(raw).toString('utf8')); }
    catch { return; }
    if (message?.type !== 'device.request' || typeof message.id !== 'string') return;
    let result;
    try {
      result = await this.execute(message.method, message.params || {});
      this.reply(message.id, { ok: true, result });
    } catch (error) {
      this.reply(message.id, { ok: false, error: { message: error.message || String(error) } });
    }
  }
  async execute(method, params) {
    if (method === 'hardware.get') return this.detectHardware();
    if (method === 'launcher.list') return this.launcher.list();
    if (method === 'launcher.start') return this.launcher.start(params.id);
    if (method === 'launcher.stop') return this.launcher.stop(params.id);
    if (method === 'tools.list') return this.tools.list().map(tool => ({
      id: tool.id, name: tool.name, source: tool.source,
      permissionClass: tool.permissionClass, enabled: Boolean(tool.enabled), status: tool.status,
    }));
    if (method === 'runtime.status') return this.localAi.status();
    if (method === 'runtime.start') {
      const runtime = String(params.runtime || 'ollama').toLowerCase();
      if (runtime !== 'ollama') throw new Error('Only Ollama can be started by Device CLI.');
      return this.launcher.start('ollama-serve');
    }
    if (method === 'runtime.stop') {
      const runtime = String(params.runtime || 'ollama').toLowerCase();
      if (runtime !== 'ollama') throw new Error('Only Ollama can be stopped by Device CLI.');
      return this.launcher.stop('ollama-serve');
    }
    if (method === 'runtime.install.start') return this.localAi.startRuntimeInstall(params.backend);
    if (method === 'runtime.install.status') return this.localAi.runtimeJobStatus(params.id);
    if (method === 'runtime.install.list') return this.localAi.listRuntimeJobs();
    if (method === 'models.list') return this.localAi.listModels();
    if (method === 'models.pull.start') return this.localAi.startPull(params.model);
    if (method === 'models.pull.status') return this.localAi.jobStatus(params.id);
    if (method === 'models.pull.list') return this.localAi.listJobs();
    if (method === 'models.pull.cancel') return this.localAi.cancelPull(params.id);
    if (method === 'models.delete') return this.localAi.deleteModel(params.model, params.runtime);
    if (method === 'model.load') return this.localAi.loadModel(params.model, params.runtime);
    if (method === 'model.unload') return this.localAi.unloadModel(params.model, params.runtime);
    if (method === 'chat.completions') return this.localAi.chat(params);
    if (method === 'chat.cancel') return this.localAi.cancelChat(params.id);
    throw new Error('Remote capability is not allowed.');
  }

  reply(id, payload) {
    if (!this.socket || this.socket.readyState !== 1) return;
    this.socket.send(JSON.stringify({ type: 'device.response', id, ...payload }));
  }

  close() {
    this.manualClose = true;
    clearTimeout(this.reconnectTimer);
    this.socket?.close();
    this.socket = null;
  }
}

module.exports = { DeviceBridge, defaultDeviceName, wsState };
