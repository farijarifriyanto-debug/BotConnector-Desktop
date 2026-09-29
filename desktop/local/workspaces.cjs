const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const MODES = new Set(['standard', 'ptc', 'minimal', 'custom']);
const PERMISSIONS = new Set(['read-only', 'workspace-write', 'full-access']);

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function canonicalDirectory(value) {
  const raw = String(value || '').trim();
  if (!raw) throw new Error('Workspace path is required.');
  const resolved = path.resolve(raw);
  let stat;
  try {
    stat = fs.statSync(resolved);
  } catch {
    throw new Error('Workspace directory does not exist.');
  }
  if (!stat.isDirectory()) throw new Error('Workspace path must be a directory.');
  try {
    return fs.realpathSync.native ? fs.realpathSync.native(resolved) : fs.realpathSync(resolved);
  } catch {
    return resolved;
  }
}

function cleanName(value, fallback) {
  const name = String(value || '').trim().replace(/\s+/g, ' ').slice(0, 100);
  return name || fallback;
}

function normalizeTools(value) {
  return Array.isArray(value)
    ? [...new Set(value.map(String).map((item) => item.trim()).filter(Boolean))].slice(0, 64)
    : [];
}

class WorkspaceStore {
  constructor({
    dataDir = path.join(os.homedir(), '.botconnector-device'),
    defaultPath = os.homedir(),
  } = {}) {
    this.dataDir = path.resolve(dataDir);
    this.file = path.join(this.dataDir, 'workspaces.json');
    this.defaultPath = canonicalDirectory(defaultPath);
    this.state = this.load();
  }

  defaultWorkspace() {
    const base = path.basename(this.defaultPath) || 'Home';
    return {
      id: 'default-' + crypto.createHash('sha256').update(this.defaultPath).digest('hex').slice(0, 16),
      name: cleanName(base, 'Home'),
      path: this.defaultPath,
      mode: 'standard',
      permission: 'workspace-write',
      modelPath: '',
      tools: [],
      customPrompt: '',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }

  load() {
    let parsed;
    try {
      parsed = JSON.parse(fs.readFileSync(this.file, 'utf8'));
    } catch {}
    const rows = Array.isArray(parsed?.workspaces)
      ? parsed.workspaces.map((item) => this.normalize(item)).filter(Boolean)
      : [];
    if (!rows.length) {
      const first = this.defaultWorkspace();
      return { schema: 1, activeId: first.id, workspaces: [first] };
    }
    const activeId = rows.some((item) => item.id === parsed?.activeId)
      ? parsed.activeId
      : rows[0].id;
    return { schema: 1, activeId, workspaces: rows };
  }

  normalize(item) {
    if (!item || typeof item !== 'object') return null;
    let workspacePath;
    try {
      workspacePath = canonicalDirectory(item.path);
    } catch {
      return null;
    }
    const fallback = path.basename(workspacePath) || 'Workspace';
    const now = new Date().toISOString();
    return {
      id: String(item.id || crypto.randomUUID()),
      name: cleanName(item.name, fallback),
      path: workspacePath,
      mode: MODES.has(String(item.mode)) ? String(item.mode) : 'standard',
      permission: PERMISSIONS.has(String(item.permission))
        ? String(item.permission)
        : 'workspace-write',
      modelPath: String(item.modelPath || ''),
      tools: normalizeTools(item.tools),
      customPrompt: String(item.customPrompt || '').slice(0, 12000),
      createdAt: String(item.createdAt || now),
      updatedAt: String(item.updatedAt || now),
    };
  }

  persist(next = this.state) {
    fs.mkdirSync(this.dataDir, { recursive: true });
    const tmp = this.file + '.' + process.pid + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(next, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, this.file);
  }

  snapshot() {
    return clone(this.state);
  }

  list() {
    return clone(this.state.workspaces);
  }

  active() {
    return clone(
      this.state.workspaces.find((item) => item.id === this.state.activeId) ||
      this.state.workspaces[0],
    );
  }

  add({ path: workspacePath, name } = {}) {
    const canonical = canonicalDirectory(workspacePath);
    const duplicate = this.state.workspaces.find(
      (item) => path.normalize(item.path) === path.normalize(canonical),
    );
    if (duplicate) {
      this.state.activeId = duplicate.id;
      this.persist();
      return this.active();
    }
    const now = new Date().toISOString();
    const item = {
      id: crypto.randomUUID(),
      name: cleanName(name, path.basename(canonical) || 'Workspace'),
      path: canonical,
      mode: 'standard',
      permission: 'workspace-write',
      modelPath: '',
      tools: [],
      customPrompt: '',
      createdAt: now,
      updatedAt: now,
    };
    this.state.workspaces.push(item);
    this.state.activeId = item.id;
    this.persist();
    return clone(item);
  }

  select(id) {
    const key = String(id || '');
    if (!this.state.workspaces.some((item) => item.id === key)) {
      throw new Error('Workspace not found.');
    }
    this.state.activeId = key;
    this.persist();
    return this.active();
  }

  update(id, patch = {}) {
    const key = String(id || '');
    const item = this.state.workspaces.find((row) => row.id === key);
    if (!item) throw new Error('Workspace not found.');

    if ('name' in patch) item.name = cleanName(patch.name, item.name);
    if ('mode' in patch) {
      const mode = String(patch.mode || '');
      if (!MODES.has(mode)) throw new Error('Unknown workspace mode.');
      item.mode = mode;
    }
    if ('permission' in patch) {
      const permission = String(patch.permission || '');
      if (!PERMISSIONS.has(permission)) throw new Error('Unknown workspace permission.');
      item.permission = permission;
    }
    if ('modelPath' in patch) item.modelPath = String(patch.modelPath || '');
    if ('tools' in patch) item.tools = normalizeTools(patch.tools);
    if ('customPrompt' in patch) item.customPrompt = String(patch.customPrompt || '').slice(0, 12000);
    item.updatedAt = new Date().toISOString();
    this.persist();
    return clone(item);
  }

  remove(id) {
    const key = String(id || '');
    const before = this.state.workspaces.length;
    this.state.workspaces = this.state.workspaces.filter((item) => item.id !== key);
    if (this.state.workspaces.length === before) return { removed: false, active: this.active() };
    if (!this.state.workspaces.length) {
      const fallback = this.defaultWorkspace();
      this.state.workspaces = [fallback];
      this.state.activeId = fallback.id;
    } else if (this.state.activeId === key) {
      this.state.activeId = this.state.workspaces[0].id;
    }
    this.persist();
    return { removed: true, active: this.active() };
  }
}

module.exports = {
  WorkspaceStore,
  MODES,
  PERMISSIONS,
  canonicalDirectory,
};
