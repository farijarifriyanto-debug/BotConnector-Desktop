#!/usr/bin/env node
const readline = require('node:readline/promises');
const process = require('node:process');
const { stdin, stdout } = process;
const { WebSocket } = require('ws');

const { DeviceBridge } = require('../desktop/local/device-bridge.cjs');
const { detectHardware } = require('../desktop/local/hardware.cjs');
const { LocalLauncher } = require('../desktop/local/launcher.cjs');
const { LocalAiRuntime } = require('./local-runtime.cjs');

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
  };

  while (args.length) {
    const arg = args.shift();
    if (arg === '--code') options.code = String(args.shift() || '').trim();
    else if (arg === '--origin') options.origin = String(args.shift() || '').trim();
    else if (arg === '--allow-desktop-commander') options.allowDesktopCommander = true;
    else if (arg === '--allow-local-ai') options.allowLocalAi = true;
    else if (arg === '--no-prompt') options.noPrompt = true;
    else if (arg === '--help' || arg === '-h') options.command = 'help';
    else if (arg === '--version' || arg === '-v') options.command = 'version';
    else throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
}

function printHelp() {
  console.log(`
BotConnector Device

Connect a laptop or PC to app.botconnector.id without an installer.

Usage:
  npx https://app.botconnector.id/device-cli-v0.3.0.tgz connect
  npx https://app.botconnector.id/device-cli-v0.3.0.tgz connect --code ABC123
  npx https://app.botconnector.id/device-cli-v0.3.0.tgz connect --code ABC123 --allow-local-ai
  npx https://app.botconnector.id/device-cli-v0.3.0.tgz connect --code ABC123 --allow-local-ai --allow-desktop-commander

Options:
  --code <code>                  Pairing code from app.botconnector.id
  --allow-desktop-commander     Allow this session to run Desktop Commander Remote
  --allow-local-ai              Allow model management and local inference for this session
  --origin <url>                 Override the BotConnector origin
  --no-prompt                    Disable interactive prompts
  -h, --help                     Show help
  -v, --version                  Show version

Security:
  - Does not open an inbound port on this device.
  - Pairing credentials are kept in process memory for this session only.
  - Close the terminal or press Ctrl+C to disconnect.
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

async function connect(options) {
  const code = await promptForCode(options);
  const allowLocalAi = await promptLocalAi(options);
  const allowDesktopCommander = await promptDesktopCommander(options);

  const settings = new SessionSettings({
    launcherProfiles: {
      'desktop-commander-remote': allowDesktopCommander,
      'ollama-serve': allowLocalAi,
    },
  });

  const launcher = new LocalLauncher({ settings });
  const localAi = new LocalAiRuntime({
    enabled: allowLocalAi,
    emit(event, payload) {
      if (event === 'local-ai:download') {
        const percent = Number.isFinite(payload?.percent) ? ` ${payload.percent}%` : '';
        console.log(`[BotConnector] Model download ${payload?.model || ''}: ${payload?.status || 'unknown'}${percent}`);
      }
    },
  });
  const tools = { list: () => [] };

  let lastState = '';
  const bridge = new DeviceBridge({
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
        console.log('[BotConnector] Close the terminal or press Ctrl+C to disconnect.');
        if (allowLocalAi) {
          console.log('[BotConnector] Local AI model management and inference are allowed for this session.');
        }
        if (allowDesktopCommander) {
          console.log('[BotConnector] Desktop Commander Remote is allowed for this session.');
        }
      } else if (state === 'DISCONNECTED') {
        console.log('[BotConnector] Disconnected. Reconnecting while this process remains running...');
      }
    },
  });

  const shutdown = () => {
    bridge.close();
    localAi.close();
    launcher.stopAll();
    console.log('\n[BotConnector] Device offline.');
    process.exit(0);
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);

  console.log(`[BotConnector] Pairing with ${options.origin}...`);
  const status = await bridge.pair(code);
  console.log(`[BotConnector] Pairing accepted. Device ID: ${status.deviceId}`);

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
  SessionSettings,
  parseArgs,
  promptForCode,
  promptDesktopCommander,
  promptLocalAi,
  connect,
  main,
};
