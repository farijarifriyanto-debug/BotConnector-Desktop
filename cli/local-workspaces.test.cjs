const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {
  WorkspaceStore,
  resolveWorkspacePath,
  workspaceList,
  workspaceRead,
  workspaceSearch,
  workspaceWrite,
  workspaceSystemContext,
} = require('./local-workspaces.cjs');

test('WorkspaceStore persists canonical local workspaces without duplicating a root', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bc-workspaces-'));
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bc-project-'));
  try {
    const store = new WorkspaceStore(dataDir);
    const one = await store.add({ root, name: 'Project A' });
    const two = await store.add({ root, name: 'Duplicate' });
    assert.equal(one.id, two.id);
    assert.equal(store.list().length, 1);
    assert.equal(store.get(one.id).name, 'Project A');

    const reloaded = new WorkspaceStore(dataDir);
    assert.equal(reloaded.list().length, 1);
    assert.equal(await reloaded.remove(one.id), true);
    assert.equal(reloaded.list().length, 0);
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('workspace tools are confined to the selected root and load workspace instructions', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bc-workspace-tools-'));
  try {
    await fsp.mkdir(path.join(root, 'src'));
    await fsp.writeFile(path.join(root, 'src', 'hello.txt'), 'alpha\nbeta marker\ngamma\n');
    await fsp.writeFile(path.join(root, 'AGENTS.md'), 'Always keep changes focused.\n');

    assert.throws(() => resolveWorkspacePath(root, '../escape.txt'), /escapes/);
    const listed = await workspaceList(root, { path: 'src' });
    assert.equal(listed.entries[0].name, 'hello.txt');

    const read = await workspaceRead(root, { path: 'src/hello.txt' });
    assert.match(read.content, /beta marker/);

    const searched = await workspaceSearch(root, { query: 'marker' });
    assert.equal(searched.results[0].path, path.join('src', 'hello.txt'));

    await workspaceWrite(root, { path: 'src/generated.txt', content: 'created locally' });
    assert.equal(fs.readFileSync(path.join(root, 'src', 'generated.txt'), 'utf8'), 'created locally');

    const context = await workspaceSystemContext(
      { name: 'Test', root },
      'standard',
      'workspace-write',
    );
    assert.match(context, /Workspace root:/);
    assert.match(context, /Always keep changes focused/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
