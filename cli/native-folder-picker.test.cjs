'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const {
  folderPickerCandidates,
  pickNativeDirectory,
} = require('./native-folder-picker.cjs');

function fakeSpawn({ stdout = '', stderr = '', code = 0, error = null } = {}) {
  return () => {
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = () => {};
    process.nextTick(() => {
      if (error) {
        child.emit('error', error);
        return;
      }
      if (stdout) child.stdout.emit('data', Buffer.from(stdout));
      if (stderr) child.stderr.emit('data', Buffer.from(stderr));
      child.emit('exit', code);
    });
    return child;
  };
}

test('Windows workspace picker uses a real native folder dialog', () => {
  const [candidate] = folderPickerCandidates('win32');
  assert.equal(candidate.command, 'powershell.exe');
  assert.ok(candidate.args.includes('-STA'));
  assert.match(candidate.args.at(-1), /FolderBrowserDialog/);
  assert.match(candidate.args.at(-1), /SelectedPath/);
});

test('macOS and Linux workspace pickers use native desktop chooser commands', () => {
  assert.equal(folderPickerCandidates('darwin')[0].command, 'osascript');
  assert.deepEqual(
    folderPickerCandidates('linux').map(item => item.command),
    ['zenity', 'kdialog'],
  );
});

test('pickNativeDirectory returns the selected absolute folder and treats cancel as null', async () => {
  assert.equal(
    await pickNativeDirectory({
      platform: 'win32',
      spawnImpl: fakeSpawn({ stdout: 'C:\\Projects\\BotConnector\r\n' }),
    }),
    'C:\\Projects\\BotConnector',
  );
  assert.equal(
    await pickNativeDirectory({
      platform: 'win32',
      spawnImpl: fakeSpawn({ code: 0, stdout: '' }),
    }),
    null,
  );
});
