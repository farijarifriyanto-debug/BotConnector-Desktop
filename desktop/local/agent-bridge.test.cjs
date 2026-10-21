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

// --- Task 4: agent.* RPC handlers ---

function createReadyBridge({ onFetch, workspaces = null, version = '0.4.9' } = {}) {
  const fetches = [];
  const spawnImpl = (cmd, args) => {
    if (args[0] === '--version') {
      return makeFakeChild({
        onSpawn(child) {
          child.stdout.emit('data', Buffer.from(`${version}\n`));
          child.exitCode = 0;
          child.emit('exit', 0, null);
        },
      });
    }
    return makeFakeChild({
      onSpawn(child) {
        child.stderr.emit('data', Buffer.from('bccli serve http://127.0.0.1:55000\n'));
      },
    });
  };

  const fetchImpl = async (url, init = {}) => {
    const parsedBody = init.body ? JSON.parse(init.body) : undefined;
    fetches.push({
      url: String(url),
      method: init.method || 'GET',
      headers: init.headers || {},
      body: parsedBody,
    });
    if (String(url).endsWith('/health')) {
      return {
        ok: true,
        status: 200,
        async json() {
          return { ok: true, version };
        },
      };
    }
    if (String(url).endsWith('/v1/models')) {
      return {
        ok: true,
        status: 200,
        async json() {
          return [{ id: 'glm-5.3-flash' }];
        },
      };
    }
    if (typeof onFetch === 'function') {
      return onFetch(String(url), init, parsedBody);
    }
    throw new Error('Unhandled fetch URL: ' + url);
  };

  const bridge = new AgentBridge({
    env: { BOTCONNECTOR_BCCLI_PATH: '/usr/local/bin/bccli' },
    spawnImpl,
    fetchImpl,
    workspaces,
  });

  return { bridge, fetches };
}

test('agent.start posts permissionMode ask and rejects any caller-supplied permissionMode before fetching', async () => {
  const { bridge, fetches } = createReadyBridge({
    onFetch(url, init, body) {
      if (url.endsWith('/v1/sessions') && init.method === 'POST') {
        assert.deepEqual(body, { cwd: '/repo/demo', permissionMode: 'ask', model: 'glm-5.3-flash' });
        return {
          ok: true,
          status: 201,
          async json() {
            return { id: 'sess-123' };
          },
        };
      }
      throw new Error('Unexpected fetch: ' + url);
    },
  });

  try {
    await assert.rejects(
      () =>
        bridge.handle('agent.start', {
          cwd: '/repo/demo',
          permissionMode: 'bypassPermissions',
        }),
      /permissionMode is fixed to ask/i,
    );
    assert.equal(fetches.length, 0, 'must not call fetch when permissionMode is supplied');

    const started = await bridge.handle('agent.start', {
      cwd: '/repo/demo',
      model: 'glm-5.3-flash',
    });
    assert.deepEqual(started, { sessionId: 'sess-123' });
  } finally {
    await bridge.close();
  }
});

test('agent.prompt returns turnId on 202 and throws AgentError(agent_busy) on 409', async () => {
  let busy = false;
  const { bridge } = createReadyBridge({
    onFetch(url, init, body) {
      if (url.endsWith('/v1/sessions/sess-1/messages') && init.method === 'POST') {
        assert.deepEqual(body, { prompt: 'fix tests' });
        if (busy) {
          return {
            ok: false,
            status: 409,
            async json() {
              return { error: 'Session is busy' };
            },
          };
        }
        return {
          ok: true,
          status: 202,
          async json() {
            return { turnId: 'turn-42' };
          },
        };
      }
      throw new Error('Unexpected fetch: ' + url);
    },
  });

  try {
    const first = await bridge.handle('agent.prompt', {
      sessionId: 'sess-1',
      prompt: 'fix tests',
    });
    assert.deepEqual(first, { turnId: 'turn-42' });

    busy = true;
    await assert.rejects(
      () =>
        bridge.handle('agent.prompt', {
          sessionId: 'sess-1',
          prompt: 'fix tests',
        }),
      (err) => {
        assert.equal(err instanceof AgentError, true);
        assert.equal(err.code, 'agent_busy');
        return true;
      },
    );
  } finally {
    await bridge.close();
  }
});

test('agent.approve rejects answer "all" and posts yes|no|session to /approvals', async () => {
  const { bridge, fetches } = createReadyBridge({
    onFetch(url, init, body) {
      if (url.endsWith('/v1/sessions/sess-1/approvals') && init.method === 'POST') {
        assert.deepEqual(body, { requestId: 'req-9', answer: 'session' });
        return {
          ok: true,
          status: 200,
          async json() {
            return { ok: true };
          },
        };
      }
      throw new Error('Unexpected fetch: ' + url);
    },
  });

  try {
    await assert.rejects(
      () =>
        bridge.handle('agent.approve', {
          sessionId: 'sess-1',
          requestId: 'req-9',
          answer: 'all',
        }),
      /answer must be yes\|no\|session/i,
    );
    assert.equal(fetches.length, 0, 'must not call fetch when answer is invalid');

    const res = await bridge.handle('agent.approve', {
      sessionId: 'sess-1',
      requestId: 'req-9',
      answer: 'session',
    });
    assert.deepEqual(res, { ok: true });
  } finally {
    await bridge.close();
  }
});

test('agent.session truncates oldest whole messages when messages JSON exceeds 200 KB while keeping newest', async () => {
  const allMessages = Array.from({ length: 30 }, (_, idx) => ({
    id: `msg-${idx}`,
    role: idx % 2 === 0 ? 'user' : 'assistant',
    content: `message-${idx}-` + 'x'.repeat(10_240),
  }));

  const { bridge } = createReadyBridge({
    onFetch(url, init) {
      if (url.includes('/v1/sessions/sess-big') && init.method === 'GET') {
        return {
          ok: true,
          status: 200,
          async json() {
            return {
              id: 'sess-big',
              cwd: '/repo/demo',
              permissionMode: 'ask',
              messages: allMessages,
            };
          },
        };
      }
      throw new Error('Unexpected fetch: ' + url);
    },
  });

  try {
    const result = await bridge.handle('agent.session', { id: 'sess-big' });
    const bytes = Buffer.byteLength(JSON.stringify(result.messages), 'utf8');
    assert.ok(bytes <= 200_000, `expected messages <= 200000 bytes, got ${bytes}`);
    assert.equal(result.truncated, true);
    assert.equal(result.omittedCount + result.messages.length, allMessages.length);
    assert.ok(result.omittedCount >= 10);
    assert.equal(result.messages[result.messages.length - 1].id, 'msg-29');
    assert.equal(result.messages[0].id, `msg-${result.omittedCount}`);
  } finally {
    await bridge.close();
  }
});

test('agent.workspaces caps at 20 sorted most recent first and agent.capabilities never spawns serve', async () => {
  const items = Array.from({ length: 25 }, (_, idx) => ({
    id: `ws-${idx}`,
    name: `Project ${idx}`,
    path: `/work/p-${idx}`,
    updatedAt: new Date(Date.UTC(2026, 9, 1, 0, idx, 0)).toISOString(),
  }));

  let serveSpawned = false;
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
    serveSpawned = true;
    throw new Error('serve must not be spawned by capabilities or workspaces');
  };

  const bridge = new AgentBridge({
    env: { BOTCONNECTOR_BCCLI_PATH: '/usr/local/bin/bccli' },
    spawnImpl,
    fetchImpl: async () => {
      throw new Error('fetch must not be called');
    },
    workspaces: {
      list: () => items,
    },
  });

  try {
    const caps = await bridge.handle('agent.capabilities', {});
    assert.equal(caps.supported, true);
    assert.equal(caps.bccliVersion, '0.4.9');
    assert.equal(typeof caps.deviceCliVersion, 'string');
    assert.equal(serveSpawned, false);

    const list = await bridge.handle('agent.workspaces', {});
    assert.equal(list.length, 20);
    assert.equal(list[0].path, '/work/p-24');
    assert.equal(list[0].name, 'Project 24');
    assert.equal(list[19].path, '/work/p-5');
  } finally {
    await bridge.close();
  }
});

