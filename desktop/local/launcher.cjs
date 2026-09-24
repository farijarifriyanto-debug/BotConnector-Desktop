const { spawn } = require('node:child_process');

const PROFILES = Object.freeze([
  {
    id: 'desktop-commander-remote',
    name: 'Desktop Commander Remote',
    description: 'Remote Desktop Commander bridge started through npx.',
    command: process.platform === 'win32' ? 'npx.cmd' : 'npx',
    args: ['-y', '@wonderwhy-er/desktop-commander@latest', 'remote'],
  },
  {
    id: 'ollama-serve',
    name: 'Ollama',
    description: 'Start the local Ollama API server.',
    command: process.platform === 'win32' ? 'ollama.exe' : 'ollama',
    args: ['serve'],
  },
]);

function clone(value) { return JSON.parse(JSON.stringify(value)); }

class LocalLauncher {
  constructor({ settings, emit = () => {} } = {}) {
    this.settings = settings;
    this.emit = emit;
    this.processes = new Map();
  }

  enabledMap() {
    const value = this.settings?.get('launcherProfiles');
    return value && typeof value === 'object' ? value : {};
  }

  list() {
    const enabled = this.enabledMap();
    return PROFILES.map(profile => ({
      ...clone(profile),
      enabled: enabled[profile.id] === true,
      running: this.processes.has(profile.id),
      pid: this.processes.get(profile.id)?.pid || null,
    }));
  }

  profile(id) {
    return PROFILES.find(item => item.id === String(id || '')) || null;
  }

  async setEnabled(id, value) {
    const profile = this.profile(id);
    if (!profile) throw new Error('Profil aplikasi tidak dikenal.');
    const enabled = { ...this.enabledMap(), [profile.id]: Boolean(value) };
    await this.settings.set('launcherProfiles', enabled);
    this.emit('launcher:changed', this.list());
    return this.list();
  }

  start(id) {
    const profile = this.profile(id);
    if (!profile) throw new Error('Profil aplikasi tidak dikenal.');
    if (this.enabledMap()[profile.id] !== true) {
      throw new Error('Profil aplikasi belum diizinkan pada perangkat ini.');
    }
    const existing = this.processes.get(profile.id);
    if (existing && existing.exitCode === null) {
      return { id: profile.id, running: true, pid: existing.pid, reused: true };
    }
    const child = spawn(profile.command, profile.args, {
      cwd: process.cwd(),
      env: process.env,
      windowsHide: true,
      stdio: 'ignore',
      detached: false,
    });
    child.once('error', error => {
      this.processes.delete(profile.id);
      this.emit('launcher:activity', { id: profile.id, status: 'FAILED', error: error.message });
    });
    child.once('exit', code => {
      this.processes.delete(profile.id);
      this.emit('launcher:activity', { id: profile.id, status: 'STOPPED', exitCode: code });
    });
    this.processes.set(profile.id, child);
    this.emit('launcher:activity', { id: profile.id, status: 'RUNNING', pid: child.pid });
    return { id: profile.id, running: true, pid: child.pid, reused: false };
  }

  stop(id) {
    const profile = this.profile(id);
    if (!profile) throw new Error('Profil aplikasi tidak dikenal.');
    const child = this.processes.get(profile.id);
    if (!child || child.exitCode !== null) return { id: profile.id, running: false };
    child.kill();
    this.processes.delete(profile.id);
    this.emit('launcher:activity', { id: profile.id, status: 'STOPPED' });
    return { id: profile.id, running: false };
  }

  stopAll() {
    for (const child of this.processes.values()) {
      try { if (child.exitCode === null) child.kill(); } catch {}
    }
    this.processes.clear();
  }
}

module.exports = { LocalLauncher, PROFILES };
