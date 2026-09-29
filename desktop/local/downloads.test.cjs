const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DownloadManager, rateLimitWaitMs } = require('./downloads.cjs');

test('rateLimitWaitMs understands Hugging Face RateLimit and Retry-After headers', () => {
  assert.equal(rateLimitWaitMs(new Headers({ RateLimit: '"resolvers";r=0;t=12' }), 0, 429), 12000);
  assert.equal(rateLimitWaitMs(new Headers({ 'Retry-After': '2' }), 0, 429), 2000);
});

test('DownloadManager retries a Hugging Face 429 and resumes automatically', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bc-download-retry-'));
  try {
    let calls = 0;
    const waits = [];
    const manager = new DownloadManager({
      getModelsDir: () => root,
      getToken: () => '',
      maxRetries: 2,
      sleep: async (ms) => { waits.push(ms); },
      fetchImpl: async () => {
        calls += 1;
        if (calls === 1) {
          return new Response('', { status: 429, headers: { 'retry-after': '1' } });
        }
        return new Response(Buffer.from('abc'), {
          status: 200,
          headers: { 'content-length': '3' },
        });
      },
    });

    const job = {
      controller: new AbortController(),
      baseDownloaded: 0,
      downloadedBytes: 0,
      totalBytes: 3,
      status: 'downloading',
      retryCount: 0,
      retryAfterMs: 0,
      retryAt: null,
    };

    const result = await manager.downloadOne({
      repoId: 'Example/Test-GGUF',
      file: { path: 'model-Q4_K_M.gguf', size: 3 },
      destDir: root,
      job,
    });

    assert.equal(calls, 2);
    assert.deepEqual(waits, [1000]);
    assert.equal(result.size, 3);
    assert.equal(fs.readFileSync(result.path, 'utf8'), 'abc');
    assert.equal(job.status, 'downloading');
    assert.equal(job.retryCount, 1);
    assert.equal(job.retryAfterMs, 0);
    assert.equal(job.retryAt, null);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
