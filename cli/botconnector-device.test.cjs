const test = require('node:test');
const assert = require('node:assert/strict');

const { SessionSettings, parseArgs } = require('./botconnector-device.cjs');

test('defaults to connect and production BotConnector origin', () => {
  const parsed = parseArgs([]);
  assert.equal(parsed.command, 'connect');
  assert.equal(parsed.origin, process.env.BOTCONNECTOR_APP_ORIGIN || 'https://app.botconnector.id');
  assert.equal(parsed.allowDesktopCommander, false);
  assert.equal(parsed.allowLocalAi, false);
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
