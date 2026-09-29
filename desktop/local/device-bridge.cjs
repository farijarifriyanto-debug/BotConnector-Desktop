const os = require('node:os');
const crypto = require('node:crypto');
const defaultCatalog = require('./catalog.cjs');
const { MAX_TOOL_CALLS_PER_TURN } = require('./tools.cjs');

function defaultDeviceName() {
  return os.hostname() || 'BotConnector device';
}

function wsState(socket) {
  if (!socket) return 'DISCONNECTED';
  return ['CONNECTING', 'CONNECTED', 'CLOSING', 'DISCONNECTED'][socket.readyState] || 'DISCONNECTED';
}

function parseToolArguments(call) {
  const raw = call?.function?.arguments;
  if (raw == null || raw === '') return {};
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) return raw;
  try {
    const parsed = JSON.parse(String(raw));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error();
    return parsed;
  } catch {
    throw new Error(`Tool '${call?.function?.name || 'unknown'}' returned invalid JSON arguments.`);
  }
}

function toolResultContent(value) {
  try {
    const serialized = JSON.stringify(value);
    return serialized.length > 64 * 1024
      ? serialized.slice(0, 64 * 1024) + '…[truncated]'
      : serialized;
  } catch {
    return JSON.stringify({ error: 'Tool result could not be serialized.' });
  }
}

function messageText(message) {
  const content = message?.content;
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.map(part => {
    if (typeof part === 'string') return part;
    if (part?.type === 'text' || part?.type === 'input_text') return String(part?.text || '');
    return '';
  }).filter(Boolean).join(' ');
}

function needsDeviceContext(messages = []) {
  const users = (Array.isArray(messages) ? messages : [])
    .filter(message => message?.role === 'user')
    .slice(-3)
    .map(messageText)
    .filter(Boolean);
  if (!users.length) return false;
  const text = users.join(' ').toLowerCase();

  const ownedDevice =
    /\b(my\s+(?:laptop|computer|pc|device|machine)|(?:laptop|komputer|computer|pc|device|perangkat|mesin)\s+(?:saya|aku|ku|ini))\b/i;
  const hardwareFact =
    /\b(?:spesifikasi|specs?|specification|hardware|cpu|processor|prosesor|ram|memory|memori|gpu|graphics?|grafis|vram|npu|operating\s+system|sistem\s+operasi|windows|linux|macos?)\b/i;
  const selfReference =
    /\b(?:saya|aku|ku|my|mine|laptop|komputer|computer|pc|device|perangkat|this\s+device|this\s+laptop)\b/i;
  const localModelFit =
    /\b(?:model|llm|gguf|qwen|llama|gemma|deepseek|glm|mistral)\b/i.test(text) &&
    /\b(?:cocok|fit|jalan|jalankan|run|running|muat|cukup|recommended|recommendation|rekomendasi|cepat|lambat)\b/i.test(text);

  return ownedDevice.test(text) || (hardwareFact.test(text) && selfReference.test(text)) || localModelFit;
}

function publicHardwareSnapshot(hardware = {}) {
  const gpuRows = [
    ...(Array.isArray(hardware?.nvidia) ? hardware.nvidia : []),
    ...(Array.isArray(hardware?.amd) ? hardware.amd : []),
    ...(Array.isArray(hardware?.intel) ? hardware.intel : []),
  ].map(gpu => ({
    name: gpu?.name || null,
    vramGb: Number(gpu?.vramGb || gpu?.memoryGb || 0) || null,
    vendor: gpu?.vendor || null,
  }));
  return {
    cpu: hardware?.cpu || null,
    ramGb: Number(hardware?.ramGb || 0) || null,
    gpu: gpuRows,
    npu: hardware?.npu ? {
      available: Boolean(hardware.npu.available || hardware.npu.name),
      name: hardware.npu.name || null,
    } : null,
    platform: hardware?.platform || process.platform,
    arch: hardware?.arch || process.arch,
    release: hardware?.release || null,
  };
}

function deviceContextMessage(hardware, benchmarks = []) {
  const measured = (Array.isArray(benchmarks) ? benchmarks : [])
    .filter(item => item && item.model)
    .slice(0, 12)
    .map(item => ({
      model: item.model,
      runtime: item.runtime || null,
      tokensPerSecond: Number(item.tokensPerSecond || 0) || null,
      promptTokensPerSecond: Number(item.promptTokensPerSecond || 0) || null,
      measuredAt: item.measuredAt || null,
    }));
  return {
    role: 'system',
    content:
      'BotConnector current-device context (read-only; detected locally for this request). ' +
      'Use these facts when the user asks about their current laptop/device or local-model fit. ' +
      'Do not invent hardware that is not listed. Device JSON: ' +
      JSON.stringify(publicHardwareSnapshot(hardware)) +
      (measured.length ? ' Local benchmark JSON: ' + JSON.stringify(measured) : ''),
  };
}


function normalizeAgentMode(value) {
  const mode = String(value || 'standard').toLowerCase();
  return ['standard', 'ptc', 'minimal', 'custom'].includes(mode) ? mode : 'standard';
}

function normalizePermission(value) {
  const permission = String(value || 'workspace-write').toLowerCase();
  return ['read-only', 'workspace-write', 'full-access'].includes(permission)
    ? permission
    : 'workspace-write';
}

function agentWorkspaceMessage(workspace = {}, permission = 'workspace-write') {
  const root = String(workspace?.path || '').trim();
  if (!root) return null;
  return {
    role: 'system',
    content:
      'BotConnector workspace context. Root directory: ' + root +
      '. Permission preset: ' + permission +
      '. Treat this root as the active project for this turn.',
  };
}

async function runToolAgent({ localAi, tools, params = {}, onEvent = () => {} } = {}) {
  const mode = normalizeAgentMode(params.mode);
  const permission = normalizePermission(params.permission);
  const workspace = params.workspace && typeof params.workspace === 'object' ? params.workspace : {};
  const workspacePath = String(workspace.path || '');
  const requested = Array.isArray(params.tools)
    ? [...new Set(params.tools.map(String).filter(Boolean))].slice(0, 24)
    : [];

  let selected = requested;
  if (mode === 'ptc' && !selected.length && tools?.list) {
    selected = tools.list()
      .filter((tool) => tool.status === 'READY')
      .map((tool) => tool.id)
      .slice(0, 24);
  } else if (mode === 'minimal') {
    selected = permission === 'read-only' ? [] : ['run_code'];
  }

  const options = { permission, workspacePath };
  const toolSchemas = mode === 'ptc'
    ? (tools?.ptcSchema ? tools.ptcSchema(selected, options) : [])
    : (tools?.schemas ? tools.schemas(selected, options) : []);

  const approved = new Set(
    Array.isArray(params.approved_tools) ? params.approved_tools.map(String) : [],
  );
  const messages = Array.isArray(params.messages)
    ? params.messages.map(message => ({ ...message }))
    : [];

  const workspaceMessage = agentWorkspaceMessage(workspace, permission);
  if (workspaceMessage) messages.unshift(workspaceMessage);
  if (mode === 'ptc' && tools?.ptcPrompt) {
    messages.unshift({ role: 'system', content: tools.ptcPrompt(selected, options) });
  } else if (mode === 'minimal' && tools?.minimalPrompt) {
    messages.unshift({ role: 'system', content: tools.minimalPrompt(options) });
  } else if (mode === 'custom' && String(params.custom_prompt || '').trim()) {
    messages.unshift({
      role: 'system',
      content: 'Custom workspace mode instructions:\n' + String(params.custom_prompt).trim(),
    });
  }

  if (!toolSchemas.length) {
    return localAi.chat({ ...params, messages, tools: [] });
  }

  const events = [];
  const record = (event) => {
    events.push(event);
    try { onEvent(event); } catch {}
  };
  let lastResult = null;

  for (let round = 0; round < MAX_TOOL_CALLS_PER_TURN; round += 1) {
    lastResult = await localAi.chat({
      ...params,
      messages,
      tools: toolSchemas,
      tool_choice: 'auto',
    });
    const calls = Array.isArray(lastResult?.tool_calls) ? lastResult.tool_calls : [];
    if (!calls.length) return { ...lastResult, tool_events: events };

    messages.push({
      role: 'assistant',
      content: String(lastResult?.content || ''),
      tool_calls: calls,
    });

    for (const call of calls) {
      const name = String(call?.function?.name || '');
      const callId = String(call?.id || crypto.randomUUID());
      let args;
      try {
        args = parseToolArguments(call);
      } catch (error) {
        const message = error?.message || String(error);
        record({ type: 'tool.error', id: callId, name, error: message });
        messages.push({
          role: 'tool',
          tool_call_id: callId,
          content: JSON.stringify({ error: message }),
        });
        continue;
      }

      if (mode === 'ptc') {
        if (name !== 'run_code' || !tools?.runPtc) {
          const error = "PTC mode only exposes the generated run_code orchestration tool.";
          record({ type: 'tool.error', id: callId, name, error });
          messages.push({ role: 'tool', tool_call_id: callId, content: JSON.stringify({ error }) });
          continue;
        }
        record({
          type: 'tool.started',
          id: callId,
          name: 'run_code',
          source: 'ptc',
          permissionClass: 'ORCHESTRATE',
          arguments: args,
        });
        try {
          const result = await tools.runPtc(args.code, {
            selected,
            approved,
            permission,
            workspacePath,
          });
          record({
            type: 'tool.completed',
            id: callId,
            name: 'run_code',
            source: 'ptc',
            permissionClass: 'ORCHESTRATE',
            result,
          });
          messages.push({
            role: 'tool',
            tool_call_id: callId,
            content: toolResultContent(result),
          });
        } catch (error) {
          const message = error?.message || String(error);
          record({ type: 'tool.error', id: callId, name: 'run_code', source: 'ptc', error: message });
          messages.push({ role: 'tool', tool_call_id: callId, content: JSON.stringify({ error: message }) });
        }
        continue;
      }

      const tool = tools.findTool(name);
      if (!tool || (!selected.includes(tool.id) && !selected.includes(tool.name))) {
        const error = `Tool '${name || 'unknown'}' was not selected for this turn.`;
        record({ type: 'tool.error', name, error });
        messages.push({
          role: 'tool',
          tool_call_id: callId,
          content: JSON.stringify({ error }),
        });
        continue;
      }

      record({
        type: 'tool.started',
        id: callId,
        name,
        source: tool.source,
        permissionClass: tool.permissionClass,
        arguments: args,
      });
      try {
        const result = await tools.invoke(name, args, {
          selected: true,
          approved:
            permission === 'full-access' ||
            approved.has(tool.id) ||
            approved.has(tool.name),
          permission,
          workspacePath,
        });
        record({
          type: 'tool.completed',
          id: callId,
          name,
          source: tool.source,
          permissionClass: tool.permissionClass,
          result,
        });
        messages.push({
          role: 'tool',
          tool_call_id: callId,
          content: toolResultContent(result),
        });
      } catch (error) {
        const message = error?.message || String(error);
        record({
          type: 'tool.error',
          id: callId,
          name,
          source: tool.source,
          permissionClass: tool.permissionClass,
          error: message,
        });
        messages.push({
          role: 'tool',
          tool_call_id: callId,
          content: JSON.stringify({ error: message }),
        });
      }
    }
  }

  const final = await localAi.chat({
    ...params,
    messages,
    tools: [],
    tool_choice: 'none',
  });
  const limit = { type: 'tool.limit', max_calls: MAX_TOOL_CALLS_PER_TURN };
  record(limit);
  return { ...final, tool_events: events };
}

class DeviceBridge {
  constructor({ settings, detectHardware, tools, launcher, localAi = null, catalog = defaultCatalog, emit = () => {}, seal = value => value, open = value => value, cloudBase = 'https://app.botconnector.id', WebSocketImpl = globalThis.WebSocket } = {}) {
    this.settings = settings;
    this.detectHardware = detectHardware;
    this.tools = tools;
    this.launcher = launcher;
    this.localAi = localAi;
    this.catalog = catalog;
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
    if (!/^[A-Z0-9_-]{6,32}$/.test(pairingCode)) throw new Error('Invalid pairing code.');
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
      const streamEvent =
        message.method === 'chat.completions' && message.params?.stream === true
          ? (event) => this.event(message.id, event)
          : null;
      result = await this.execute(message.method, message.params || {}, streamEvent);
      this.reply(message.id, { ok: true, result });
    } catch (error) {
      this.reply(message.id, { ok: false, error: { message: error.message || String(error) } });
    }
  }
  async withDeviceContext(params = {}) {
    const messages = Array.isArray(params?.messages) ? params.messages : [];
    if (!needsDeviceContext(messages)) return params;
    const hardware = await this.detectHardware();
    const benchmarks = this.localAi?.benchmarkResults?.().benchmarks || [];
    return {
      ...params,
      messages: [
        deviceContextMessage(hardware, benchmarks),
        ...messages.map(message => ({ ...message })),
      ],
    };
  }

  async agentChat(params = {}) {
    return runToolAgent({
      localAi: this.localAi,
      tools: this.tools,
      params: await this.withDeviceContext(params),
    });
  }

  async execute(method, params, onStreamEvent = null) {
    if (method === 'hardware.get') return this.detectHardware();
    // Read-only public catalog lookup ranked for this device's hardware; no local AI permission needed.
    if (method === 'catalog.recommendations') return defaultCatalog.recommendModels(this.catalog, await this.detectHardware(), params);
    if (method === 'launcher.list') return this.launcher.list();
    if (method === 'launcher.start') return this.launcher.start(params.id);
    if (method === 'launcher.stop') return this.launcher.stop(params.id);
    if (method === 'tools.list') return this.tools.list().map(tool => ({
      id: tool.id, name: tool.name, description: tool.description, source: tool.source,
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
    if (method === 'chat.completions') {
      if (params?.tool_mode === 'auto') return this.agentChat(params);
      const chatParams = await this.withDeviceContext(params);
      const result = await this.localAi.chat({
        ...chatParams,
        ...(typeof onStreamEvent === 'function'
          ? {
              onDelta: (delta) => {
                if (delta?.reasoning) onStreamEvent({ thinking: true });
                if (delta?.content) onStreamEvent({ content: String(delta.content) });
              },
            }
          : {}),
      });
      if (!result || typeof result !== 'object') return result;
      const { reasoning: _hiddenReasoning, ...visibleResult } = result;
      return visibleResult;
    }
    if (method === 'chat.cancel') return this.localAi.cancelChat(params.id);
    throw new Error('Remote capability is not allowed.');
  }

  event(id, event) {
    if (!this.socket || this.socket.readyState !== 1) return;
    this.socket.send(JSON.stringify({ type: 'device.event', id, event }));
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

module.exports = {
  DeviceBridge,
  defaultDeviceName,
  wsState,
  runToolAgent,
  needsDeviceContext,
  publicHardwareSnapshot,
  deviceContextMessage,
  normalizeAgentMode,
  normalizePermission,
  agentWorkspaceMessage,
};
