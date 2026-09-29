#!/usr/bin/env node
const readline = require('node:readline/promises');
const process = require('node:process');
const { stdin, stdout } = process;
const { WebSocket } = require('ws');

const { DeviceBridge } = require('../desktop/local/device-bridge.cjs');
const { detectHardware } = require('../desktop/local/hardware.cjs');
const { LocalLauncher } = require('../desktop/local/launcher.cjs');
const { LocalAiRuntime } = require('./local-runtime.cjs');
const { ToolRegistry } = require('../desktop/local/tools.cjs');
const { startOfflineServer, DEFAULT_PORT } = require('./offline-server.cjs');
const { DeviceSettings } = require('./device-settings.cjs');

const PUBLIC_PACKAGE_URL = 'https://app.botconnector.id/device-cli-launcher-v1.0.2.tgz';

class SessionSettings {
  constructor(seed = {}) {
    this.values = { ...seed };
  }

  get(key) {
    return this.values[key];
  }

  async set(key, value) {
    this.values[key] = value;
    return this.values;
  }
}

function parseArgs(argv) {
  const args = [...argv];
  const command = args[0] && !args[0].startsWith('-') ? args.shift() : 'connect';
  const options = {
    command,
    code: '',
    origin: process.env.BOTCONNECTOR_APP_ORIGIN || 'https://app.botconnector.id',
    allowDesktopCommander: false,
    allowLocalAi: false,
    noPrompt: false,
    noBrowser: false,
    port: DEFAULT_PORT,
  };

  while (args.length) {
    const arg = args.shift();
    if (arg === '--code') options.code = String(args.shift() || '').trim();
    else if (arg === '--origin') options.origin = String(args.shift() || '').trim();
    else if (arg === '--allow-desktop-commander') options.allowDesktopCommander = true;
    else if (arg === '--allow-local-ai') options.allowLocalAi = true;
    else if (arg === '--no-prompt') options.noPrompt = true;
    else if (arg === '--no-browser') options.noBrowser = true;
    else if (arg === '--port') {
      const value = Number(args.shift());
      if (!Number.isInteger(value) || value < 1 || value > 65535) {
        throw new Error('Invalid --port value. Use 1-65535.');
      }
      options.port = value;
      options.portExplicit = true;
    }
    else if (arg === '--help' || arg === '-h') options.command = 'help';
    else if (arg === '--version' || arg === '-v') options.command = 'version';
    else throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
}

function printHelp() {
  console.log(`
BotConnector Device

Use BotConnector Local AI from Chrome/Firefox with or without cloud connectivity.

Usage:
  npx ${PUBLIC_PACKAGE_URL} connect --code ABC123
  npx ${PUBLIC_PACKAGE_URL} connect --code ABC123 --allow-local-ai
  npx ${PUBLIC_PACKAGE_URL} offline --allow-local-ai
  npx --offline ${PUBLIC_PACKAGE_URL} offline --allow-local-ai

Modes:
  connect   Connect to app.botconnector.id. The first connection uses a pairing
            code; later launches reuse the saved device credential automatically.
  offline   Opens the local browser UI. If this device was paired before, it
            also reconnects to the Web App automatically when internet is available.

Options:
  --code <code>                  Pairing code from app.botconnector.id
  --allow-desktop-commander     Allow this session to run Desktop Commander Remote
  --allow-local-ai              Allow model management and local inference for this session
  --port <1-65535>              Local UI port (default: ${DEFAULT_PORT})
  --no-browser                  Do not open the local browser UI automatically
  --origin <url>                 Override the BotConnector origin
  --no-prompt                    Disable interactive prompts
  -h, --help                     Show help
  -v, --version                  Show version

Offline cold start:
  Run the current package once while online so npm can cache it. Afterwards,
  the "npx --offline ... offline" command can reuse the cached package.

Security:
  - Local UI binds only to 127.0.0.1.
  - Local API requires a random in-memory session token and same-origin checks.
  - Pairing credentials are stored only in this OS user profile so the same device can reconnect after restart.
  - Local AI model management and inference require explicit session approval.
  - Arbitrary remote shell access is not available.
`.trim());
}

async function promptForCode(options) {
  if (options.code) return options.code;
  if (options.noPrompt || !stdin.isTTY || !stdout.isTTY) {
    throw new Error('A pairing code is required. Use --code <code>.');
  }

  console.log('\nOpen https://app.botconnector.id and choose Devices > Connect a device.');
  console.log('Enter the pairing code shown there.\n');
  const rl = readline.createInterface({ input: stdin, output: stdout });
  try {
    return String(await rl.question('Pairing code: ')).trim();
  } finally {
    rl.close();
  }
}

async function promptDesktopCommander(options) {
  if (options.allowDesktopCommander) return true;
  if (options.noPrompt || !stdin.isTTY || !stdout.isTTY) return false;

  const rl = readline.createInterface({ input: stdin, output: stdout });
  try {
    const answer = String(await rl.question(
      'Allow BotConnector to run Desktop Commander Remote for this session? [y/N] '
    )).trim().toLowerCase();
    return answer === 'y' || answer === 'yes' || answer === 'ya';
  } finally {
    rl.close();
  }
}

async function promptLocalAi(options) {
  if (options.allowLocalAi) return true;
  if (options.noPrompt || !stdin.isTTY || !stdout.isTTY) return false;

  const rl = readline.createInterface({ input: stdin, output: stdout });
  try {
    const answer = String(await rl.question(
      'Allow BotConnector to manage local AI models and run local inference for this session? [y/N] '
    )).trim().toLowerCase();
    return answer === 'y' || answer === 'yes';
  } finally {
    rl.close();
  }
}

function createLocalAi(enabled) {
  return new LocalAiRuntime({
    enabled,
    emit(event, payload) {
      if (event === 'local-ai:download') {
        const percent = Number.isFinite(payload?.percent) ? ` ${payload.percent}%` : '';
        console.log(
          `[BotConnector] Model download ${payload?.model || ''}: ${payload?.status || 'unknown'}${percent}`,
        );
      } else if (event === 'local-ai:runtime-install') {
        const percent = Number.isFinite(payload?.percent) ? ` ${payload.percent}%` : '';
        console.log(
          `[BotConnector] Runtime install: ${payload?.status || 'unknown'}${percent}`,
        );
      }
    },
  });
}

async function createToolRegistry() {
  const registry = new ToolRegistry({
    emit(event, payload) {
      if (event === 'mcp:changed') {
        const ready = Array.isArray(payload)
          ? payload.filter(server => server?.status === 'READY').length
          : 0;
        if (ready) console.log(`[BotConnector] MCP servers ready: ${ready}`);
      }
    },
  });
  try {
    await registry.loadMcpConfig();
  } catch (error) {
    console.error(`[BotConnector] MCP config was not loaded: ${error?.message || error}`);
  }
  return registry;
}

function createBridgeSession({ settings, launcher, localAi, tools, options, allowLocalAi, allowDesktopCommander = false }) {
  let lastState = '';
  return new DeviceBridge({
    settings,
    detectHardware,
    tools,
    launcher,
    localAi,
    cloudBase: options.origin,
    WebSocketImpl: WebSocket,
    emit(event, payload) {
      if (event === 'device:error') {
        console.error(`[BotConnector] ${payload?.message || 'Device error'}`);
        return;
      }
      if (event !== 'device:changed') return;
      const state = payload?.connection || 'DISCONNECTED';
      if (state === lastState) return;
      lastState = state;
      if (state === 'CONNECTED') {
        console.log(`[BotConnector] Online as ${payload.deviceName} (${payload.deviceId}).`);
        if (allowLocalAi) console.log('[BotConnector] Local AI is available to BotConnector Web App for this session.');
        if (allowDesktopCommander) console.log('[BotConnector] Desktop Commander Remote is allowed for this session.');
      } else if (state === 'DISCONNECTED' && payload?.paired) {
        console.log('[BotConnector] Web App connection lost. Local browser mode remains available.');
      }
    },
  });
}

function webAppController(bridge, origin) {
  return {
    origin,
    status: () => bridge.status(),
    pair: (code) => bridge.pair(code),
    disconnect: () => bridge.unpair(),
  };
}

async function startLocalUi(localAi, options, tools = null, webApp = null) {
  const localServer = await startOfflineServer({
    localAi,
    detectHardware,
    tools,
    webApp,
    port: options.port,
    // An explicit --port is respected exactly; the default port may move to the next free one.
    portFallback: options.portExplicit ? 0 : 10,
    open: !options.noBrowser,
  });
  console.log(`[BotConnector] Local browser UI: ${localServer.url}`);
  console.log(
    '[BotConnector] This localhost UI keeps working if the internet connection drops.',
  );
  return localServer;
}

async function runOffline(options) {
  const allowLocalAi = await promptLocalAi(options);
  if (!allowLocalAi) {
    throw new Error('Offline mode requires Local AI permission for this session.');
  }

  const settings = new DeviceSettings({
    launcherProfiles: {
      'desktop-commander-remote': false,
      'ollama-serve': true,
    },
  });
  const launcher = new LocalLauncher({ settings });
  const localAi = createLocalAi(true);
  const tools = await createToolRegistry();
  const bridge = createBridgeSession({
    settings,
    launcher,
    localAi,
    tools,
    options,
    allowLocalAi: true,
  });
  const localServer = await startLocalUi(
    localAi,
    options,
    tools,
    webAppController(bridge, options.origin),
  );

  if (settings.get('devicePairing')) {
    bridge.connect().catch((error) => {
      console.error('[BotConnector] Saved Web App connection is unavailable: ' + (error?.message || error));
    });
  }

  const shutdown = () => {
    bridge.close();
    void localServer.close();
    void tools.close();
    localAi.close();
    launcher.stopAll();
    console.log('\n[BotConnector] Local offline session stopped.');
    process.exit(0);
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);

  console.log(
    settings.get('devicePairing')
      ? '[BotConnector] Local mode is ready. Saved Web App pairing will reconnect automatically when online.'
      : '[BotConnector] Local mode is ready. Pair with Web App once to enable automatic reconnect on future launches.',
  );
  const hold = setInterval(() => {}, 60_000);
  hold.unref();
}

async function connect(options) {
  const allowLocalAi = await promptLocalAi(options);
  const allowDesktopCommander = await promptDesktopCommander(options);

  const settings = new DeviceSettings({
    launcherProfiles: {
      'desktop-commander-remote': allowDesktopCommander,
      'ollama-serve': allowLocalAi,
    },
  });
  const savedPairing = settings.get('devicePairing');
  const code = options.code || (!savedPairing ? await promptForCode(options) : '');

  const launcher = new LocalLauncher({ settings });
  const localAi = createLocalAi(allowLocalAi);
  const tools = await createToolRegistry();
  const bridge = createBridgeSession({
    settings,
    launcher,
    localAi,
    tools,
    options,
    allowLocalAi,
    allowDesktopCommander,
  });

  let localServer = null;
  if (allowLocalAi) {
    try {
      localServer = await startLocalUi(
        localAi,
        options,
        tools,
        webAppController(bridge, options.origin),
      );
    } catch (error) {
      console.error(
        `[BotConnector] Local browser UI could not start: ${error?.message || error}`,
      );
      console.error('[BotConnector] Online Device mode will continue.');
    }
  }

  const shutdown = () => {
    bridge.close();
    if (localServer) void localServer.close();
    localAi.close();
    void tools.close();
    launcher.stopAll();
    console.log('\n[BotConnector] Device offline.');
    process.exit(0);
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);

  let status;
  if (code) {
    console.log(`[BotConnector] Pairing with ${options.origin}...`);
    status = await bridge.pair(code);
    console.log(`[BotConnector] Pairing accepted. Device ID: ${status.deviceId}`);
  } else {
    console.log(`[BotConnector] Reconnecting saved device to ${options.origin}...`);
    status = await bridge.connect();
    console.log(`[BotConnector] Saved pairing loaded. Device ID: ${status.deviceId}`);
  }

  // Keep this foreground process alive. The WebSocket itself also holds the
  // event loop, while this timer makes the intended session lifetime explicit.
  const hold = setInterval(() => {}, 60_000);
  hold.unref();
}

async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);

  if (options.command === 'help') {
    printHelp();
    return;
  }

  if (options.command === 'version') {
    const pkg = require('../package.json');
    console.log(pkg.version);
    return;
  }

  if (options.command === 'offline') {
    await runOffline(options);
    return;
  }

  if (options.command !== 'connect') {
    throw new Error(`Unknown command: ${options.command}`);
  }

  await connect(options);
}

if (require.main === module) {
  main().catch(error => {
    console.error(`[BotConnector] ${error?.message || error}`);
    process.exitCode = 1;
  });
}

module.exports = {
  PUBLIC_PACKAGE_URL,
  SessionSettings,
  parseArgs,
  promptForCode,
  promptDesktopCommander,
  promptLocalAi,
  createLocalAi,
  createToolRegistry,
  startLocalUi,
  runOffline,
  connect,
  main,
};
