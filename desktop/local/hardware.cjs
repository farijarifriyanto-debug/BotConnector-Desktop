const os = require('node:os');
const { execFile } = require('node:child_process');

function execJson(command, args, timeout = 5000) {
  return new Promise((resolve) => {
    execFile(command, args, { timeout, windowsHide: true }, (err, stdout) => {
      if (err || !String(stdout || '').trim()) return resolve(null);
      try {
        resolve(JSON.parse(String(stdout).trim()));
      } catch {
        resolve(null);
      }
    });
  });
}

function detectNvidia() {
  return new Promise((resolve) => {
    execFile(
      'nvidia-smi',
      ['--query-gpu=name,memory.total,driver_version', '--format=csv,noheader,nounits'],
      { timeout: 5000, windowsHide: true },
      (err, stdout) => {
        if (err) return resolve([]);
        const gpus = stdout
          .trim()
          .split(/\r?\n/)
          .filter(Boolean)
          .map((line) => {
            const [name, memoryMb, driver] = line.split(',').map((s) => s.trim());
            return { name, memoryGb: +(Number(memoryMb) / 1024).toFixed(1), driver };
          });
        resolve(gpus);
      },
    );
  });
}

async function detectWindowsAccelerators() {
  if (process.platform !== 'win32') {
    return { amd: [], intel: [], npu: null };
  }

  const gpuScript = [
    'Get-CimInstance Win32_VideoController',
    '| Select-Object Name,AdapterRAM,DriverVersion',
    '| ConvertTo-Json -Compress',
  ].join(' ');

  const npuScript = [
    'Get-PnpDevice -PresentOnly',
    "| Where-Object { $_.Class -eq 'ComputeAccelerator' -and $_.FriendlyName -match 'NPU|Neural|IPU' }",
    '| Select-Object -First 1 FriendlyName,Status',
    '| ConvertTo-Json -Compress',
  ].join(' ');

  const [gpuPayload, npuPayload] = await Promise.all([
    execJson('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', gpuScript]),
    execJson('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', npuScript]),
  ]);

  const rows = gpuPayload ? (Array.isArray(gpuPayload) ? gpuPayload : [gpuPayload]) : [];
  const mapGpu = (gpu) => ({
    name: String(gpu?.Name || '').trim() || undefined,
    driver: String(gpu?.DriverVersion || '').trim() || undefined,
    // Windows AdapterRAM is unreliable for shared-memory iGPUs, so do not
    // expose it as dedicated VRAM for AMD/Intel devices.
    integrated: true,
  });

  const amd = rows.filter((gpu) => /amd|radeon/i.test(String(gpu?.Name || ''))).map(mapGpu);
  const intel = rows.filter((gpu) => /intel/i.test(String(gpu?.Name || ''))).map(mapGpu);
  const npu =
    npuPayload && String(npuPayload?.FriendlyName || '').trim()
      ? {
          name: String(npuPayload.FriendlyName).trim(),
          available: String(npuPayload?.Status || '').toUpperCase() === 'OK',
        }
      : null;

  return { amd, intel, npu };
}

async function detectHardware() {
  const cpus = os.cpus();
  const [nvidia, windows] = await Promise.all([detectNvidia(), detectWindowsAccelerators()]);
  return {
    platform: process.platform,
    release: os.release(),
    arch: os.arch(),
    cpu: cpus[0]?.model || 'Unknown CPU',
    logicalCores: cpus.length,
    ramGb: +(os.totalmem() / 1024 ** 3).toFixed(1),
    freeRamGb: +(os.freemem() / 1024 ** 3).toFixed(1),
    nvidia,
    amd: windows.amd,
    intel: windows.intel,
    npu: windows.npu,
  };
}

module.exports = { detectHardware, detectNvidia, detectWindowsAccelerators };
