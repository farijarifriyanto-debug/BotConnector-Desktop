const test = require('node:test');
const assert = require('node:assert/strict');
const { createDocumentStore, extractText } = require('./local-documents.cjs');

test('extracts local text documents', async () => {
  const text = await extractText('notes.md', Buffer.from('# Hello\nLocal file'));
  assert.match(text, /Hello/);
  assert.match(text, /Local file/);
});

test('stores documents and builds bounded attachment context', async () => {
  const store = createDocumentStore();
  const meta = await store.add({
    name: 'brief.txt',
    mime: 'text/plain',
    base64: Buffer.from('PROJECT_MARKER_68421\nImportant local content.').toString('base64'),
  });
  assert.equal(meta.name, 'brief.txt');
  assert.ok(meta.id);

  const context = store.buildContext([meta.id], 5000);
  assert.match(context, /Attached file: brief\.txt/);
  assert.match(context, /PROJECT_MARKER_68421/);
  assert.equal(store.list().length, 1);

  assert.equal(store.remove(meta.id), true);
  assert.equal(store.list().length, 0);
});

test('rejects unsupported binary formats instead of silently pretending they were parsed', async () => {
  await assert.rejects(
    () => extractText('scan.pdf', Buffer.from('%PDF-fake')),
    /Unsupported document type/i,
  );
});
