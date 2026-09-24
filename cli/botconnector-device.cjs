#!/usr/bin/env node
const readline = require('node:readline/promises');
const process = require('node:process');
const { stdin, stdout } = process;
const { WebSocket } = require('ws');

const { DeviceBridge } = require('../desktop/local/device-bridge.cjs');
const { detectHardware } = require('../desktop/local/hardware.cjs');
const { LocalLauncher } = require('../desktop/local/launcher.cjs');

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
    noPrompt: false,
  };

  while (args.length) {
    const arg = args.shift();
    if (arg === '--code') options.code = String(args.shift() || '').trim();
    else if (arg === '--origin') options.origin = String(args.shift() || '').trim();
    else if (arg === '--allow-desktop-commander') options.allowDesktopCommander = true;
    else if (arg === '--no-prompt') options.noPrompt = true;
    else if (arg === '--help' || arg === '-h') options.command = 'help';
    else if (arg === '--version' || arg === '-v') options.command = 'version';
    else throw new Error(`Argumen tidak dikenal: ${arg}`);
  }

  return options;
}

function printHelp() {
  console.log(`
BotConnector Device

Hubungkan laptop/PC ke app.botconnector.id tanpa installer.

Pemakaian:
  npx github:farijarifriyanto-debug/BotConnector-Desktop connect
  npx github:farijarifriyanto-debug/BotConnector-Desktop connect --code ABC123
  npx github:farijarifriyanto-debug/BotConnector-Desktop connect --code ABC123 --allow-desktop-commander

Opsi:
  --code <kode>                  Kode pairing dari app.botconnector.id
  --allow-desktop-commander     Izinkan sesi ini menjalankan Desktop Commander Remote
  --origin <url>                 Override origin BotConnector
  --no-prompt                    Jangan tampilkan prompt interaktif
  -h, --help                     Tampilkan bantuan
  -v, --version                  Tampilkan versi

Keamanan:
  - Tidak membuka inbound port di laptop.
  - Credential pairing hanya disimpan di memori proses untuk sesi ini.
  - Tutup terminal / Ctrl+C untuk memutus akses.
  - Remote shell arbitrer tidak tersedia.
`.trim());
}

async function promptForCode(options) {
  if (options.code) return options.code;
  if (options.noPrompt || !stdin.isTTY || !stdout.isTTY) {
    throw new Error('Kode pairing diperlukan. Gunakan --code <kode>.');
  }

  console.log('\nBuka https://app.botconnector.id lalu pilih Devices > Hubungkan perangkat.');
  console.log('Masukkan kode pairing yang ditampilkan di sana.\n');
  const rl = readline.createInterface({ input: stdin, output: stdout });
  try {
    return String(await rl.question('Kode pairing: ')).trim();
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
      'Izinkan BotConnector menjalankan Desktop Commander Remote selama sesi ini? [y/N] '
    )).trim().toLowerCase();
    return answer === 'y' || answer === 'yes' || answer === 'ya';
  } finally {
    rl.close();
  }
}

async function connect(options) {
  const code = await promptForCode(options);
  const allowDesktopCommander = await promptDesktopCommander(options);

  const settings = new SessionSettings({
    launcherProfiles: {
      'desktop-commander-remote': allowDesktopCommander,
      'ollama-serve': false,
    },
  });

  const launcher = new LocalLauncher({ settings });
  const tools = { list: () => [] };

  let lastState = '';
  const bridge = new DeviceBridge({
    settings,
    detectHardware,
    tools,
    launcher,
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
        console.log(`[BotConnector] Online sebagai ${payload.deviceName} (${payload.deviceId}).`);
        console.log('[BotConnector] Tutup terminal / Ctrl+C untuk disconnect.');
        if (allowDesktopCommander) {
          console.log('[BotConnector] Desktop Commander Remote diizinkan untuk sesi ini.');
        }
      } else if (state === 'DISCONNECTED') {
        console.log('[BotConnector] Terputus. Mencoba reconnect selama proses tetap berjalan...');
      }
    },
  });

  const shutdown = () => {
    bridge.close();
    launcher.stopAll();
    console.log('\n[BotConnector] Device offline.');
    process.exit(0);
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);

  console.log(`[BotConnector] Pairing ke ${options.origin}...`);
  const status = await bridge.pair(code);
  console.log(`[BotConnector] Pairing diterima. Device ID: ${status.deviceId}`);

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
    throw new Error(`Perintah tidak dikenal: ${options.command}`);
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
  connect,
  main,
};
