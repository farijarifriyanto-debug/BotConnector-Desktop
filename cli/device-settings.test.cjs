const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { DeviceSettings } = require('./device-settings.cjs');

test('device pairing persists across process restarts and disconnect removes it', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bc-device-settings-'));
  const file = path.join(root, '.botconnector-device', 'device.json');
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const pairing = {
    deviceId: 'device-1',
    deviceName: 'home',
    token: 'secret-device-token',
    wsUrl: 'wss://app.botconnector.id/api/devices/socket',
  };

  const first = new DeviceSettings(
    { launcherProfiles: { 'ollama-serve': true } },
    { file },
  );
  await first.set('devicePairing', pairing);

  assert.equal(first.get('launcherProfiles')['ollama-serve'], true);
  assert.deepEqual(new DeviceSettings({}, { file }).get('devicePairing'), pairing);
  assert.equal(fs.existsSync(file), true);
  if (process.platform !== 'win32') {
    assert.equal(fs.statSync(file).mode & 0o777, 0o600);
    assert.equal(fs.statSync(path.dirname(file)).mode & 0o777, 0o700);
  }

  const second = new DeviceSettings({}, { file });
  await second.set('devicePairing', null);
  assert.equal(fs.existsSync(file), false);
  assert.equal(new DeviceSettings({}, { file }).get('devicePairing'), undefined);
});

test('corrupt persisted pairing fails closed', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bc-device-settings-bad-'));
  const file = path.join(root, 'device.json');
  try {
    fs.writeFileSync(file, '{not-json', 'utf8');
    const settings = new DeviceSettings({}, { file });
    assert.equal(settings.get('devicePairing'), undefined);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
