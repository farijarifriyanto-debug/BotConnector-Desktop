'use strict';

const os = require('node:os');
const { spawn } = require('node:child_process');

const PICKER_TIMEOUT_MS = 10 * 60 * 1000;

function folderPickerCandidates(platform = process.platform) {
  if (platform === 'win32') {
    const script = [
      'Add-Type -AssemblyName System.Windows.Forms',
      '$dialog = New-Object System.Windows.Forms.FolderBrowserDialog',
      "$dialog.Description = 'Select a BotConnector workspace'",
      '$dialog.ShowNewFolderButton = $true',
      'if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {',
      '  [Console]::OutputEncoding = [System.Text.Encoding]::UTF8',
      '  Write-Output $dialog.SelectedPath',
      '}',
    ].join('; ');
    return [{
      command: 'powershell.exe',
      args: ['-NoProfile', '-STA', '-Command', script],
      windowsHide: true,
    }];
  }

  if (platform === 'darwin') {
    return [{
      command: 'osascript',
      args: ['-e', 'POSIX path of (choose folder with prompt "Select a BotConnector workspace")'],
      windowsHide: false,
    }];
  }

  return [
    {
      command: 'zenity',
      args: ['--file-selection', '--directory', '--title=Select a BotConnector workspace'],
      windowsHide: false,
    },
    {
      command: 'kdialog',
      args: ['--getexistingdirectory', os.homedir(), 'Select a BotConnector workspace'],
      windowsHide: false,
    },
  ];
}

function runPickerCandidate(candidate, spawnImpl = spawn) {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawnImpl(candidate.command, candidate.args || [], {
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: Boolean(candidate.windowsHide),
      });
    } catch (error) {
      reject(error);
      return;
    }

    let stdout = '';
    let stderr = '';
    let settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(value);
    };
    const timer = setTimeout(() => {
      try { child.kill(); } catch {}
      const error = new Error('Folder picker timed out.');
      error.code = 'ETIMEDOUT';
      finish(error);
    }, PICKER_TIMEOUT_MS);

    child.stdout?.on('data', chunk => { stdout += chunk.toString('utf8'); });
    child.stderr?.on('data', chunk => { stderr += chunk.toString('utf8'); });
    child.once('error', finish);
    child.once('exit', code => {
      finish(null, {
        code: Number.isInteger(code) ? code : 0,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
      });
    });
  });
}

async function pickNativeDirectory({
  platform = process.platform,
  spawnImpl = spawn,
} = {}) {
  const candidates = folderPickerCandidates(platform);
  let unavailable = null;

  for (const candidate of candidates) {
    let result;
    try {
      result = await runPickerCandidate(candidate, spawnImpl);
    } catch (error) {
      if (error?.code === 'ENOENT') {
        unavailable = error;
        continue;
      }
      throw error;
    }

    if (result.stdout) return result.stdout.split(/\r?\n/).filter(Boolean).at(-1).trim();

    // GUI pickers conventionally return a non-zero status when the user cancels.
    // A successful blank response is also treated as cancel.
    if (result.code === 0 || result.code === 1) return null;

    unavailable = new Error(result.stderr || 'Folder picker is unavailable.');
  }

  const error = new Error(
    platform === 'linux'
      ? 'No native folder picker is available. Install zenity or kdialog.'
      : 'Native folder picker is unavailable on this device.'
  );
  error.cause = unavailable || undefined;
  throw error;
}

module.exports = {
  PICKER_TIMEOUT_MS,
  folderPickerCandidates,
  runPickerCandidate,
  pickNativeDirectory,
};
