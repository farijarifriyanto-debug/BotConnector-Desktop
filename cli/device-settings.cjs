const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const DEFAULT_DEVICE_FILE = path.join(os.homedir(), '.botconnector-device', 'device.json');

class DeviceSettings {
  constructor(seed = {}, { file = process.env.BOTCONNECTOR_DEVICE_SETTINGS_FILE || DEFAULT_DEVICE_FILE } = {}) {
    this.file = file;
    this.values = { ...seed };
    this.loaded = false;
  }

  load() {
    if (this.loaded) return this.values;
    this.loaded = true;
    try {
      const saved = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      if (saved?.version === 1 && saved.devicePairing && typeof saved.devicePairing === 'object') {
        this.values.devicePairing = saved.devicePairing;
      }
    } catch (error) {
      if (error?.code !== 'ENOENT') {
        // Invalid/corrupt settings fail closed: keep the session unpaired.
        delete this.values.devicePairing;
      }
    }
    return this.values;
  }

  get(key) {
    return this.load()[key];
  }

  async persistPairing() {
    const pairing = this.values.devicePairing;
    const directory = path.dirname(this.file);
    await fsp.mkdir(directory, { recursive: true, mode: 0o700 });
    if (!pairing) {
      await fsp.rm(this.file, { force: true });
      return;
    }

    const payload = JSON.stringify({ version: 1, devicePairing: pairing }, null, 2) + '\n';
    const temporary = this.file + '.' + process.pid + '.tmp';
    await fsp.writeFile(temporary, payload, { encoding: 'utf8', mode: 0o600 });
    try { await fsp.chmod(temporary, 0o600); } catch {}
    await fsp.rename(temporary, this.file);
    try { await fsp.chmod(this.file, 0o600); } catch {}
  }

  async set(key, value) {
    this.load()[key] = value;
    if (key === 'devicePairing') await this.persistPairing();
    return this.values;
  }
}

module.exports = { DeviceSettings, DEFAULT_DEVICE_FILE };
