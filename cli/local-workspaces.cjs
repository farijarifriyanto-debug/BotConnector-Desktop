const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

const MAX_INSTRUCTION_BYTES = 32 * 1024;
const MAX_WORKSPACE_FILE_BYTES = 512 * 1024;
const MAX_SEARCH_FILES = 300;
const IGNORE_DIRS = new Set(['.git', 'node_modules', '.next', 'dist', 'build', '.cache', '.venv', 'venv']);

function normalizeMode(value) {
  return ['standard', 'ptc', 'minimal', 'creator'].includes(String(value || '').toLowerCase())
    ? String(value).toLowerCase()
    : 'standard';
}

function normalizePermission(value) {
  return ['read-only', 'workspace-write', 'full-access'].includes(String(value || '').toLowerCase())
    ? String(value).toLowerCase()
    : 'workspace-write';
}

function displayNameForRoot(root) {
  const base = path.basename(root);
  return base || root;
}

function canonicalDirectory(input) {
  const raw = String(input || '').trim();
  if (!raw) throw new Error('Workspace folder is required.');
  if (!path.isAbsolute(raw)) throw new Error('Workspace path must be absolute.');
  let real;
  try { real = fs.realpathSync.native ? fs.realpathSync.native(raw) : fs.realpathSync(raw); }
  catch { throw new Error('Workspace folder does not exist or cannot be accessed.'); }
  const stat = fs.statSync(real);
  if (!stat.isDirectory()) throw new Error('Workspace path must point to a folder.');
  return path.resolve(real);
}

function withinRoot(root, candidate) {
  const a = process.platform === 'win32' ? path.resolve(root).toLowerCase() : path.resolve(root);
  const b = process.platform === 'win32' ? path.resolve(candidate).toLowerCase() : path.resolve(candidate);
  return b === a || b.startsWith(a + path.sep);
}

function nearestExistingParent(target) {
  let current = target;
  while (!fs.existsSync(current)) {
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return current;
}

function resolveWorkspacePath(root, relativePath = '.', { write = false } = {}) {
  if (!root) throw new Error('No workspace selected.');
  const rel = String(relativePath || '.').trim() || '.';
  if (path.isAbsolute(rel)) throw new Error('Use a path relative to the selected workspace.');
  const target = path.resolve(root, rel);
  if (!withinRoot(root, target)) throw new Error('Path escapes the selected workspace.');

  const existing = write ? nearestExistingParent(target) : target;
  if (fs.existsSync(existing)) {
    let real;
    try { real = fs.realpathSync.native ? fs.realpathSync.native(existing) : fs.realpathSync(existing); }
    catch { throw new Error('Workspace path cannot be resolved.'); }
    if (!withinRoot(root, real)) throw new Error('Resolved path escapes the selected workspace.');
  }
  return target;
}

async function readInstructions(root) {
  const parts = [];
  let remaining = MAX_INSTRUCTION_BYTES;
  for (const name of ['AGENTS.md', 'CLAUDE.md']) {
    if (remaining <= 0) break;
    const file = path.join(root, name);
    try {
      const stat = await fsp.stat(file);
      if (!stat.isFile()) continue;
      const bytes = await fsp.readFile(file);
      const slice = bytes.subarray(0, Math.min(bytes.length, remaining));
      parts.push({ name, content: slice.toString('utf8') });
      remaining -= slice.length;
    } catch {}
  }
  return parts;
}

async function workspaceList(root, args = {}) {
  const target = resolveWorkspacePath(root, args.path || '.');
  const stat = await fsp.stat(target);
  if (!stat.isDirectory()) throw new Error('workspace_list path must be a directory.');
  const rows = await fsp.readdir(target, { withFileTypes: true });
  const limit = Math.max(1, Math.min(200, Number(args.limit || 100)));
  return {
    path: path.relative(root, target) || '.',
    entries: rows
      .filter((item) => !IGNORE_DIRS.has(item.name))
      .slice(0, limit)
      .map((item) => ({
        name: item.name,
        type: item.isDirectory() ? 'directory' : item.isFile() ? 'file' : 'other',
      })),
    truncated: rows.length > limit,
  };
}

async function workspaceRead(root, args = {}) {
  const target = resolveWorkspacePath(root, args.path || '');
  const stat = await fsp.stat(target);
  if (!stat.isFile()) throw new Error('workspace_read path must be a file.');
  if (stat.size > MAX_WORKSPACE_FILE_BYTES) {
    throw new Error('File is too large for workspace_read (max 512 KB).');
  }
  const content = await fsp.readFile(target, 'utf8');
  const maxChars = Math.max(1000, Math.min(120000, Number(args.max_chars || 60000)));
  return {
    path: path.relative(root, target),
    size: stat.size,
    content: content.length > maxChars ? content.slice(0, maxChars) + '\n…[truncated]' : content,
    truncated: content.length > maxChars,
  };
}

async function collectSearchFiles(root, dir, out) {
  if (out.length >= MAX_SEARCH_FILES) return;
  let entries;
  try { entries = await fsp.readdir(dir, { withFileTypes: true }); } catch { return; }
  for (const entry of entries) {
    if (out.length >= MAX_SEARCH_FILES) return;
    if (IGNORE_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await collectSearchFiles(root, full, out);
      continue;
    }
    if (!entry.isFile()) continue;
    let stat;
    try { stat = await fsp.stat(full); } catch { continue; }
    if (stat.size > MAX_WORKSPACE_FILE_BYTES) continue;
    out.push(full);
  }
}

async function workspaceSearch(root, args = {}) {
  const query = String(args.query || '').trim();
  if (!query) throw new Error('Search query is required.');
  const start = resolveWorkspacePath(root, args.path || '.');
  const stat = await fsp.stat(start);
  const files = [];
  if (stat.isFile()) files.push(start);
  else if (stat.isDirectory()) await collectSearchFiles(root, start, files);
  else throw new Error('workspace_search path must be a file or directory.');

  const lowered = query.toLowerCase();
  const maxResults = Math.max(1, Math.min(50, Number(args.max_results || 20)));
  const results = [];
  for (const file of files) {
    if (results.length >= maxResults) break;
    let content;
    try { content = await fsp.readFile(file, 'utf8'); } catch { continue; }
    if (content.includes('\u0000')) continue;
    const lines = content.split(/\r?\n/);
    for (let i = 0; i < lines.length && results.length < maxResults; i++) {
      if (!lines[i].toLowerCase().includes(lowered)) continue;
      results.push({
        path: path.relative(root, file),
        line: i + 1,
        text: lines[i].slice(0, 500),
      });
    }
  }
  return { query, searchedFiles: files.length, results, truncated: files.length >= MAX_SEARCH_FILES };
}

async function workspaceWrite(root, args = {}) {
  const rel = String(args.path || '').trim();
  if (!rel) throw new Error('File path is required.');
  const content = String(args.content ?? '');
  if (Buffer.byteLength(content, 'utf8') > 1024 * 1024) {
    throw new Error('workspace_write content is too large (max 1 MB).');
  }
  const target = resolveWorkspacePath(root, rel, { write: true });
  await fsp.mkdir(path.dirname(target), { recursive: true });
  await fsp.writeFile(target, content, 'utf8');
  return { path: path.relative(root, target), bytes: Buffer.byteLength(content, 'utf8'), written: true };
}

class WorkspaceStore {
  constructor(dataDir) {
    this.file = path.join(dataDir, 'workspaces.json');
    this.data = null;
  }

  load() {
    if (this.data) return this.data;
    try {
      const parsed = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      this.data = {
        schema: 1,
        workspaces: Array.isArray(parsed?.workspaces) ? parsed.workspaces : [],
      };
    } catch {
      this.data = { schema: 1, workspaces: [] };
    }
    return this.data;
  }

  list() {
    return this.load().workspaces
      .filter((item) => item && item.id && item.root)
      .map((item) => ({ ...item }));
  }

  get(id) {
    const key = String(id || '');
    if (!key) return null;
    const item = this.load().workspaces.find((row) => row.id === key);
    return item ? { ...item } : null;
  }

  async save() {
    await fsp.mkdir(path.dirname(this.file), { recursive: true });
    const tmp = this.file + '.' + process.pid + '.tmp';
    await fsp.writeFile(tmp, JSON.stringify(this.data, null, 2), { mode: 0o600 });
    await fsp.rename(tmp, this.file);
  }

  async add({ root, name } = {}) {
    const canonical = canonicalDirectory(root);
    const existing = this.load().workspaces.find((item) =>
      (process.platform === 'win32' ? item.root.toLowerCase() : item.root) ===
      (process.platform === 'win32' ? canonical.toLowerCase() : canonical)
    );
    if (existing) return { ...existing };
    const now = new Date().toISOString();
    const item = {
      id: crypto.randomUUID(),
      name: String(name || '').trim().slice(0, 80) || displayNameForRoot(canonical),
      root: canonical,
      createdAt: now,
      updatedAt: now,
    };
    this.data.workspaces.push(item);
    await this.save();
    return { ...item };
  }

  async remove(id) {
    const before = this.load().workspaces.length;
    this.data.workspaces = this.data.workspaces.filter((item) => item.id !== String(id || ''));
    if (this.data.workspaces.length === before) return false;
    await this.save();
    return true;
  }
}

function modeDescription(mode) {
  return {
    standard: 'Native tools for normal work: workspace files plus selected web/code/MCP tools.',
    ptc: 'One multi-step tool-program surface that orchestrates workspace and selected tools in a single call.',
    minimal: 'Small tool surface for local models: workspace list/read/search only.',
    creator: 'Expanded native tool surface for building and debugging agent workflows.',
  }[normalizeMode(mode)];
}

function permissionDescription(permission) {
  return {
    'read-only': 'Read-only workspace access. Write and execute tools are hidden or blocked.',
    'workspace-write': 'Read and write inside the selected workspace. Execute/MCP mutations still require explicit approval.',
    'full-access': 'Allows selected write/execute tools without per-tool approval. Use only in trusted workspaces.',
  }[normalizePermission(permission)];
}

async function workspaceSystemContext(workspace, mode, permission) {
  if (!workspace?.root) return '';
  const instructions = await readInstructions(workspace.root);
  const instructionText = instructions.map((item) => `\n[${item.name}]\n${item.content}`).join('');
  return [
    'BotConnector Local workspace context:',
    `Workspace name: ${workspace.name}`,
    `Workspace root: ${workspace.root}`,
    `Agent mode: ${normalizeMode(mode)} — ${modeDescription(mode)}`,
    `Permission preset: ${normalizePermission(permission)} — ${permissionDescription(permission)}`,
    'All workspace file paths in tools are relative to the workspace root. Never claim to have accessed files unless a workspace tool returned them.',
    instructionText ? 'Workspace instructions follow:' + instructionText : '',
  ].filter(Boolean).join('\n');
}

module.exports = {
  WorkspaceStore,
  normalizeMode,
  normalizePermission,
  modeDescription,
  permissionDescription,
  resolveWorkspacePath,
  readInstructions,
  workspaceList,
  workspaceRead,
  workspaceSearch,
  workspaceWrite,
  workspaceSystemContext,
};
