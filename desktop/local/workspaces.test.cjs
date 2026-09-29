const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { WorkspaceStore } = require('./workspaces.cjs');

test('workspace records persist active mode, permission, model and tools', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bc-workspaces-'));
  const project = path.join(root, 'project-a');
  fs.mkdirSync(project);
  try {
    const store = new WorkspaceStore({ dataDir: path.join(root, 'data'), defaultPath: root });
    const added = store.add({ path: project, name: 'Project A' });
    const updated = store.update(added.id, {
      mode: 'ptc',
      permission: 'full-access',
      modelPath: 'device:ollama:qwen3:4b',
      tools: ['web_search', 'run_code', 'web_search'],
      customPrompt: 'Use project conventions.',
    });
    assert.equal(updated.mode, 'ptc');
    assert.equal(updated.permission, 'full-access');
    assert.deepEqual(updated.tools, ['web_search', 'run_code']);

    const reloaded = new WorkspaceStore({ dataDir: path.join(root, 'data'), defaultPath: root });
    const active = reloaded.active();
    assert.equal(active.id, added.id);
    assert.equal(active.path, fs.realpathSync(project));
    assert.equal(active.modelPath, 'device:ollama:qwen3:4b');
    assert.equal(active.customPrompt, 'Use project conventions.');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('adding the same canonical directory selects the existing workspace', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bc-workspaces-'));
  const project = path.join(root, 'project');
  fs.mkdirSync(project);
  try {
    const store = new WorkspaceStore({ dataDir: path.join(root, 'data'), defaultPath: root });
    const first = store.add({ path: project, name: 'One' });
    const second = store.add({ path: path.join(project, '.'), name: 'Two' });
    assert.equal(second.id, first.id);
    assert.equal(store.list().filter((row) => row.path === fs.realpathSync(project)).length, 1);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('removing a workspace unregisters it without deleting its directory', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bc-workspaces-'));
  const project = path.join(root, 'project');
  fs.mkdirSync(project);
  try {
    const store = new WorkspaceStore({ dataDir: path.join(root, 'data'), defaultPath: root });
    const added = store.add({ path: project });
    const result = store.remove(added.id);
    assert.equal(result.removed, true);
    assert.equal(fs.existsSync(project), true);
    assert.ok(store.list().length >= 1);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
