const assert = require('node:assert/strict');
const test = require('node:test');
const { LocalLauncher } = require('./launcher.cjs');

function fakeSettings() {
  const data = {};
  return {
    get(key) { return data[key]; },
    async set(key, value) { data[key] = value; },
  };
}

test('launcher profiles are deny-by-default and require local enablement', async () => {
  const settings = fakeSettings();
  const launcher = new LocalLauncher({ settings });
  const profile = launcher.list().find(item => item.id === 'desktop-commander-remote');

  assert.ok(profile);
  assert.equal(profile.enabled, false);
  assert.throws(() => launcher.start(profile.id), /belum diizinkan/i);

  await launcher.setEnabled(profile.id, true);
  assert.equal(launcher.list().find(item => item.id === profile.id).enabled, true);

  await launcher.setEnabled(profile.id, false);
  assert.equal(launcher.list().find(item => item.id === profile.id).enabled, false);
});
