const assert = require('node:assert/strict');
const test = require('node:test');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { AgentBridge, AgentError, MIN_BCCLI } = require('./agent-bridge.cjs');

function makeFakeChild({ onSpawn } = {}) {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.killed = false;
  child.exitCode = null;
  child.kill = () => {
    if (child.killed) return true;
    child.killed = true;
    child.exitCode = 0;
    setImmediate(() => child.emit('exit', 0, 'SIGTERM'));
    return true;
  };
  if (typeof onSpawn === 'function') {
    setImmediate(() => onSpawn(child));
  }
  return child;
}

test('discover via BOTCONNECTOR_BCCLI_PATH and ensureServe parses stderr banner port and passes token', async () => {
  const spawns = [];
  const spawnImpl = (cmd, args, options) => {
    spawns.push({ cmd, args, options });
    if (args[0] === '--version') {
      return makeFakeChild({
        onSpawn(child) {
          child.stdout.emit('data', Buffer.from('0.4.9\n'));
          child.exitCode = 0;
          child.emit('exit', 0, null);
        },
      });
    }
    if (args[0] === 'serve') {
      return makeFakeChild({
        onSpawn(child) {
          child.stderr.emit('data', Buffer.from('bccli serve http://127.0.0.1:51234\n'));
        },
      });
    }
    throw new Error('Unexpected spawn args: ' + JSON.stringify(args));
  };

  const fetches = [];
  const fetchImpl = async (url, init = {}) => {
    fetches.push({ url: String(url), headers: init.headers || {} });
    if (String(url).endsWith('/health')) {
      return {
        ok: true,
        status: 200,
        async json() {
          return { ok: true, version: '0.4.9' };
        },
      };
    }
    throw new Error('Unexpected URL: ' + url);
  };

  const bridge = new AgentBridge({
    env: { BOTCONNECTOR_BCCLI_PATH: 'C:\\custom\\bccli.cmd' },
    spawnImpl,
    fetchImpl,
    idleKillMs: 60_000,
  });

  try {
    const discovered = await bridge.discoverBccli();
    assert.equal(discovered, 'C:\\custom\\bccli.cmd');

    const serve = await bridge.ensureServe();
    assert.equal(serve.port, 51234);
    assert.match(serve.token, /^[0-9a-f]{64}$/);

    const serveSpawn = spawns.find((entry) => entry.args[0] === 'serve');
    assert.ok(serveSpawn, 'must spawn bccli serve');
    assert.equal(serveSpawn.cmd, 'C:\\custom\\bccli.cmd');
    assert.deepEqual(serveSpawn.args, ['serve', '--port', '0', '--token', serve.token]);
    assert.equal(serveSpawn.options.env.BCCLI_SERVE_TOKEN, serve.token);
    assert.equal(serveSpawn.options.windowsHide, true);
    assert.equal(
      fetches.some(
        (call) =>
          call.url === 'http://127.0.0.1:51234/health' &&
          call.headers.authorization === `Bearer ${serve.token}`,
      ),
      true,
    );
  } finally {
    await bridge.close();
  }
});

test('discoverBccli throws agent_runtime_missing when bccli is missing everywhere', async () => {
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'bc-agent-missing-'));
  const spawnImpl = () =>
    makeFakeChild({
      onSpawn(child) {
        const err = new Error('spawn bccli ENOENT');
        err.code = 'ENOENT';
        child.emit('error', err);
      },
    });

  const bridge = new AgentBridge({
    env: {},
    homeDir: tmpHome,
    spawnImpl,
    fetchImpl: async () => {
      throw new Error('fetch should not be called');
    },
  });

  try {
    await assert.rejects(
      () => bridge.discoverBccli(),
      (err) => {
        assert.equal(err instanceof AgentError, true);
        assert.equal(err.code, 'agent_runtime_missing');
        return true;
      },
    );
  } finally {
    await bridge.close();
    fs.rmSync(tmpHome, { recursive: true, force: true });
  }
});

test('ensureServe restarts once when health returns 500 and throws agent_runtime_missing if still failing', async () => {
  let serveSpawns = 0;
  const children = [];
  const spawnImpl = (cmd, args) => {
    if (args[0] === '--version') {
      return makeFakeChild({
        onSpawn(child) {
          child.stdout.emit('data', Buffer.from('0.4.9\n'));
          child.exitCode = 0;
          child.emit('exit', 0, null);
        },
      });
    }
    serveSpawns += 1;
    const port = 52000 + serveSpawns;
    const child = makeFakeChild({
      onSpawn(c) {
        c.stderr.emit('data', Buffer.from(`bccli serve http://127.0.0.1:${port}\n`));
      },
    });
    children.push(child);
    return child;
  };

  let healthCalls = 0;
  const fetchImpl = async (url) => {
    if (String(url).endsWith('/health')) {
      healthCalls += 1;
      return {
        ok: false,
        status: 500,
        async json() {
          return { ok: false };
        },
      };
    }
    throw new Error('Unexpected fetch: ' + url);
  };

  const bridge = new AgentBridge({
    env: { BOTCONNECTOR_BCCLI_PATH: '/usr/local/bin/bccli' },
    spawnImpl,
    fetchImpl,
  });

  try {
    await assert.rejects(
      () => bridge.ensureServe(),
      (err) => {
        assert.equal(err.code, 'agent_runtime_missing');
        return true;
      },
    );
    assert.equal(serveSpawns, 2, 'must spawn once and restart once on health 500');
    assert.equal(healthCalls, 2);
    assert.equal(children[0].killed, true, 'first unhealthy child must be killed');
    assert.equal(children[1].killed, true, 'second unhealthy child must be killed');
  } finally {
    await bridge.close();
  }
});

test('preflight throws agent_not_configured when /v1/models is empty or returns 401', async () => {
  const spawnImpl = (cmd, args) => {
    if (args[0] === '--version') {
      return makeFakeChild({
        onSpawn(child) {
          child.stdout.emit('data', Buffer.from('0.4.9\n'));
          child.exitCode = 0;
          child.emit('exit', 0, null);
        },
      });
    }
    return makeFakeChild({
      onSpawn(child) {
        child.stderr.emit('data', Buffer.from('bccli serve http://127.0.0.1:53111\n'));
      },
    });
  };

  let modelsResponse = { status: 200, body: [] };
  const fetchImpl = async (url) => {
    if (String(url).endsWith('/health')) {
      return {
        ok: true,
        status: 200,
        async json() {
          return { ok: true, version: '0.4.9' };
        },
      };
    }
    if (String(url).endsWith('/v1/models')) {
      return {
        ok: modelsResponse.status >= 200 && modelsResponse.status < 300,
        status: modelsResponse.status,
        async json() {
          return modelsResponse.body;
        },
      };
    }
    throw new Error('Unexpected URL: ' + url);
  };

  const bridge = new AgentBridge({
    env: { BOTCONNECTOR_BCCLI_PATH: '/usr/local/bin/bccli' },
    spawnImpl,
    fetchImpl,
  });

  try {
    await assert.rejects(
      () => bridge.preflight(),
      (err) => {
        assert.equal(err.code, 'agent_not_configured');
        return true;
      },
    );

    modelsResponse = { status: 401, body: { error: 'Unauthorized' } };
    await assert.rejects(
      () => bridge.preflight(),
      (err) => {
        assert.equal(err.code, 'agent_not_configured');
        return true;
      },
    );
  } finally {
    await bridge.close();
  }
});

test('preflight throws agent_unsupported when bccli version is older than 0.4.9', async () => {
  const spawnImpl = (cmd, args) => {
    if (args[0] === '--version') {
      return makeFakeChild({
        onSpawn(child) {
          child.stdout.emit('data', Buffer.from('0.4.8\n'));
          child.exitCode = 0;
          child.emit('exit', 0, null);
        },
      });
    }
    return makeFakeChild({
      onSpawn(child) {
        child.stderr.emit('data', Buffer.from('bccli serve http://127.0.0.1:53222\n'));
      },
    });
  };

  const fetchImpl = async (url) => {
    if (String(url).endsWith('/health')) {
      return {
        ok: true,
        status: 200,
        async json() {
          return { ok: true, version: '0.4.8' };
        },
      };
    }
    throw new Error('Should not fetch models when version is unsupported');
  };

  const bridge = new AgentBridge({
    env: { BOTCONNECTOR_BCCLI_PATH: '/usr/local/bin/bccli' },
    spawnImpl,
    fetchImpl,
  });

  try {
    assert.equal(MIN_BCCLI, '0.4.9');
    await assert.rejects(
      () => bridge.preflight(),
      (err) => {
        assert.equal(err.code, 'agent_unsupported');
        assert.match(err.message, /0\.4\.9/);
        return true;
      },
    );
  } finally {
    await bridge.close();
  }
});

test('idle-kill stops bccli serve when idle with no open streams, and touch() extends lifetime', async () => {
  const children = [];
  const spawnImpl = (cmd, args) => {
    if (args[0] === '--version') {
      return makeFakeChild({
        onSpawn(child) {
          child.stdout.emit('data', Buffer.from('0.4.9\n'));
          child.exitCode = 0;
          child.emit('exit', 0, null);
        },
      });
    }
    const child = makeFakeChild({
      onSpawn(c) {
        c.stderr.emit('data', Buffer.from('bccli serve http://127.0.0.1:53333\n'));
      },
    });
    children.push(child);
    return child;
  };

  let clock = 1_000;
  const fetchImpl = async (url) => {
    if (String(url).endsWith('/health')) {
      return {
        ok: true,
        status: 200,
        async json() {
          return { ok: true, version: '0.4.9' };
        },
      };
    }
    throw new Error('Unexpected fetch: ' + url);
  };

  const bridge = new AgentBridge({
    env: { BOTCONNECTOR_BCCLI_PATH: '/usr/local/bin/bccli' },
    spawnImpl,
    fetchImpl,
    now: () => clock,
    idleKillMs: 40,
  });

  try {
    await bridge.ensureServe();
    assert.equal(children.length, 1);
    assert.equal(children[0].killed, false);

    // Advance only 20ms and touch -> should not be killed at 50ms
    await new Promise((resolve) => setTimeout(resolve, 20));
    clock += 20;
    bridge.touch();
    await new Promise((resolve) => setTimeout(resolve, 25));
    assert.equal(children[0].killed, false, 'touch() must prevent premature idle-kill');

    // Now advance past idleKillMs and let timer fire
    clock += 50;
    await new Promise((resolve) => setTimeout(resolve, 55));
    assert.equal(children[0].killed, true, 'idle serve child must be killed');
    assert.equal(bridge.serveState, null);
  } finally {
    await bridge.close();
  }
});

test('child exit clears state so the next ensureServe respawns', async () => {
  let serveCount = 0;
  const children = [];
  const spawnImpl = (cmd, args) => {
    if (args[0] === '--version') {
      return makeFakeChild({
        onSpawn(child) {
          child.stdout.emit('data', Buffer.from('0.4.9\n'));
          child.exitCode = 0;
          child.emit('exit', 0, null);
        },
      });
    }
    serveCount += 1;
    const port = 54000 + serveCount;
    const child = makeFakeChild({
      onSpawn(c) {
        c.stderr.emit('data', Buffer.from(`bccli serve http://127.0.0.1:${port}\n`));
      },
    });
    children.push(child);
    return child;
  };

  const fetchImpl = async (url) => {
    if (String(url).endsWith('/health')) {
      return {
        ok: true,
        status: 200,
        async json() {
          return { ok: true, version: '0.4.9' };
        },
      };
    }
    throw new Error('Unexpected fetch: ' + url);
  };

  const bridge = new AgentBridge({
    env: { BOTCONNECTOR_BCCLI_PATH: '/usr/local/bin/bccli' },
    spawnImpl,
    fetchImpl,
  });

  try {
    const first = await bridge.ensureServe();
    assert.equal(first.port, 54001);

    // Simulate unexpected child exit
    children[0].exitCode = 1;
    children[0].emit('exit', 1, null);
    assert.equal(bridge.serveState, null);

    const second = await bridge.ensureServe();
    assert.equal(second.port, 54002);
    assert.equal(serveCount, 2);
  } finally {
    await bridge.close();
  }
});
