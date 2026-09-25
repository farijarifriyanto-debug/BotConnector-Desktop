const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  parseManifest,
  readState,
  writeState,
  npxCommand,
  buildNpxArgs,
} = require('./cli.cjs');

test('accepts an immutable package URL matching the manifest version', () => {
  const manifest = parseManifest({
    version: '0.4.6',
    url: 'https://app.botconnector.id/device-cli-v0.4.6.tgz',
    sha256: 'a'.repeat(64),
  });
  assert.equal(manifest.version, '0.4.6');
  assert.equal(manifest.url, 'https://app.botconnector.id/device-cli-v0.4.6.tgz');
});

test('rejects cross-origin and mismatched release URLs', () => {
  assert.throws(
    () => parseManifest({ version: '0.4.6', url: 'https://example.com/device-cli-v0.4.6.tgz' }),
    /manifest origin/i,
  );
  assert.throws(
    () => parseManifest({ version: '0.4.6', url: 'https://app.botconnector.id/device-cli-v0.4.5.tgz' }),
    /manifest version/i,
  );
});

test('builds online and offline npx invocations without version hardcoding', () => {
  const url = 'https://app.botconnector.id/device-cli-v0.4.6.tgz';
  assert.deepEqual(buildNpxArgs(url, ['offline', '--allow-local-ai']), [
    '--yes',
    '--package=' + url,
    'botconnector-device',
    'offline',
    '--allow-local-ai',
  ]);
  assert.deepEqual(buildNpxArgs(url, ['offline'], { offline: true }), [
    '--yes',
    '--offline',
    '--package=' + url,
    'botconnector-device',
    'offline',
  ]);
  assert.equal(npxCommand('win32'), 'npx.cmd');
  assert.equal(npxCommand('linux'), 'npx');
});

test('persists the last resolved immutable release for cold offline starts', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bc-launcher-'));
  try {
    const stateFile = path.join(root, 'launcher.json');
    const manifest = parseManifest({
      version: '0.4.6',
      url: 'https://app.botconnector.id/device-cli-v0.4.6.tgz',
      sha256: 'b'.repeat(64),
    });
    writeState(manifest, stateFile);
    assert.deepEqual(readState(stateFile), manifest);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
