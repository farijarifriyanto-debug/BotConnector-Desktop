const test = require('node:test');
const assert = require('node:assert/strict');

const { PUBLIC_PACKAGE_URL, SessionSettings, parseArgs } = require('./botconnector-device.cjs');

test('defaults to connect and production BotConnector origin', () => {
  const parsed = parseArgs([]);
  assert.equal(parsed.command, 'connect');
  assert.equal(parsed.origin, process.env.BOTCONNECTOR_APP_ORIGIN || 'https://app.botconnector.id');
  assert.equal(parsed.allowDesktopCommander, false);
  assert.equal(parsed.allowLocalAi, false);
  assert.equal(parsed.port, 18765);
  assert.equal(parsed.noBrowser, false);
  assert.equal(PUBLIC_PACKAGE_URL, 'https://app.botconnector.id/device-cli-v0.4.0.tgz');
});

test('parses pairing and explicit session permission', () => {
  const parsed = parseArgs([
    'connect',
    '--code', 'ABC-123',
    '--allow-desktop-commander',
    '--allow-local-ai',
    '--no-prompt',
  ]);
  assert.equal(parsed.command, 'connect');
  assert.equal(parsed.code, 'ABC-123');
  assert.equal(parsed.allowDesktopCommander, true);
  assert.equal(parsed.allowLocalAi, true);
  assert.equal(parsed.noPrompt, true);
});

test('rejects unknown arguments', () => {
  assert.throws(() => parseArgs(['connect', '--shell']), /Unknown argument/);
});

test('session settings are memory-only', async () => {
  const settings = new SessionSettings({ enabled: false });
  assert.equal(settings.get('enabled'), false);
  await settings.set('enabled', true);
  assert.equal(settings.get('enabled'), true);
});


test('parses standalone offline browser mode', () => {
  const parsed = parseArgs([
    'offline',
    '--allow-local-ai',
    '--port', '19001',
    '--no-browser',
    '--no-prompt',
  ]);
  assert.equal(parsed.command, 'offline');
  assert.equal(parsed.allowLocalAi, true);
  assert.equal(parsed.port, 19001);
  assert.equal(parsed.noBrowser, true);
  assert.equal(parsed.noPrompt, true);
});

test('rejects invalid local UI port', () => {
  assert.throws(() => parseArgs(['offline', '--port', '70000']), /Invalid --port/);
});
