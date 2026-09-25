#!/usr/bin/env node
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const DEFAULT_MANIFEST_URL = 'https://app.botconnector.id/device-cli.json';
const DEFAULT_STATE_FILE = path.join(os.homedir(), '.botconnector-device', 'launcher.json');

function parseManifest(value, manifestUrl = DEFAULT_MANIFEST_URL) {
  const version = String(value?.version || '').trim();
  if (!/^\d+\.\d+\.\d+$/.test(version)) {
    throw new Error('Device CLI manifest has an invalid version.');
  }

  let manifest;
  let packageUrl;
  try {
    manifest = new URL(manifestUrl);
    packageUrl = new URL(String(value?.url || ''));
  } catch {
    throw new Error('Device CLI manifest has an invalid URL.');
  }

  if (!['https:', 'http:'].includes(manifest.protocol)) {
    throw new Error('Device CLI manifest URL must use HTTP(S).');
  }
  if (packageUrl.protocol !== 'https:' && !(packageUrl.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(packageUrl.hostname))) {
    throw new Error('Device CLI package URL must use HTTPS.');
  }
  if (packageUrl.origin !== manifest.origin) {
    throw new Error('Device CLI package must use the manifest origin.');
  }
  if (packageUrl.pathname !== '/device-cli-v' + version + '.tgz') {
    throw new Error('Device CLI package URL does not match the manifest version.');
  }

  const sha256 = String(value?.sha256 || '').trim().toLowerCase();
  if (sha256 && !/^[a-f0-9]{64}$/.test(sha256)) {
    throw new Error('Device CLI manifest has an invalid SHA-256.');
  }

  return {
    version,
    url: packageUrl.toString(),
    sha256,
    manifestUrl: manifest.toString(),
  };
}

async function fetchManifest(manifestUrl = DEFAULT_MANIFEST_URL, fetchImpl = globalThis.fetch) {
  const response = await fetchImpl(manifestUrl, {
    cache: 'no-store',
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) throw new Error('Device CLI manifest returned HTTP ' + response.status + '.');
  return parseManifest(await response.json(), manifestUrl);
}

function readState(stateFile = DEFAULT_STATE_FILE) {
  try {
    const raw = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    return parseManifest(raw, raw.manifestUrl || DEFAULT_MANIFEST_URL);
  } catch {
    return null;
  }
}

function writeState(manifest, stateFile = DEFAULT_STATE_FILE) {
  fs.mkdirSync(path.dirname(stateFile), { recursive: true });
  const temp = stateFile + '.tmp-' + process.pid;
  fs.writeFileSync(temp, JSON.stringify(manifest, null, 2) + '\n', { mode: 0o600 });
  fs.renameSync(temp, stateFile);
}

function npxCommand(platform = process.platform) {
  return platform === 'win32' ? 'npx.cmd' : 'npx';
}

function buildNpxArgs(packageUrl, argv, { offline = false } = {}) {
  return [
    '--yes',
    ...(offline ? ['--offline'] : []),
    '--package=' + packageUrl,
    'botconnector-device',
    ...argv,
  ];
}

async function run(argv = process.argv.slice(2), {
  manifestUrl = process.env.BOTCONNECTOR_DEVICE_MANIFEST_URL || DEFAULT_MANIFEST_URL,
  stateFile = process.env.BOTCONNECTOR_DEVICE_LAUNCHER_STATE || DEFAULT_STATE_FILE,
  fetchImpl = globalThis.fetch,
  spawn = spawnSync,
  platform = process.platform,
} = {}) {
  let manifest;
  let offline = false;

  try {
    manifest = await fetchManifest(manifestUrl, fetchImpl);
    writeState(manifest, stateFile);
  } catch (error) {
    manifest = readState(stateFile);
    offline = true;
    if (!manifest) {
      throw new Error(
        'BotConnector Device CLI needs one online start before offline use. ' +
        'Could not resolve the current release: ' + String(error?.message || error),
      );
    }
  }

  const result = spawn(
    npxCommand(platform),
    buildNpxArgs(manifest.url, argv, { offline }),
    {
      stdio: 'inherit',
      env: process.env,
      windowsHide: false,
    },
  );

  if (result?.error) throw result.error;
  if (result?.signal) {
    process.kill(process.pid, result.signal);
    return 1;
  }
  return Number.isInteger(result?.status) ? result.status : 1;
}

if (require.main === module) {
  run().then(
    (code) => { process.exitCode = code; },
    (error) => {
      console.error('[BotConnector] ' + String(error?.message || error));
      process.exitCode = 1;
    },
  );
}

module.exports = {
  DEFAULT_MANIFEST_URL,
  DEFAULT_STATE_FILE,
  parseManifest,
  fetchManifest,
  readState,
  writeState,
  npxCommand,
  buildNpxArgs,
  run,
};
