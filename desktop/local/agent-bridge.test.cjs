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

// --- Task 5: agent.stream mux mirroring, 32KB output cap, 900KB byte budget, 25s heartbeat, abort ---

async function startStubMuxServer({ token = 'a'.repeat(64), onOpenStream, onUpgrade } = {}) {
  const http = require('node:http');
  const { WebSocketServer } = require('ws');

  const server = http.createServer((req, res) => {
    if (req.url === '/health') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, version: '0.4.9' }));
      return;
    }
    res.writeHead(404);
    res.end();
  });

  const wss = new WebSocketServer({ noServer: true });
  const connections = [];

  server.on('upgrade', (req, socket, head) => {
    if (typeof onUpgrade === 'function' && onUpgrade(req, socket) === false) {
      return;
    }
    if (req.url !== '/v1/mux' || req.headers.authorization !== `Bearer ${token}`) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      connections.push(ws);
      ws.on('message', (raw) => {
        const msg = JSON.parse(String(raw));
        if (msg.type === 'open' && typeof onOpenStream === 'function') {
          onOpenStream(ws, msg);
        }
      });
    });
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;

  return {
    port,
    token,
    connections,
    async close() {
      for (const ws of connections) {
        try {
          ws.close();
        } catch {}
      }
      wss.close();
      if (server.closeAllConnections) server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

function createBridgeBoundToServer(port, token, extra = {}) {
  const bridge = new AgentBridge({
    env: { BOTCONNECTOR_BCCLI_PATH: '/usr/local/bin/bccli' },
    fetchImpl: globalThis.fetch,
    ...extra,
  });
  bridge.serveState = {
    port,
    token,
    child: { killed: false, exitCode: null, kill() { this.killed = true; } },
    version: '0.4.9',
  };
  return bridge;
}

test('agent.stream mirrors mux items in order (ready -> text -> tool_use -> tool_result -> result -> end) and resolves', async () => {
  const frames = [
    { type: 'ready', sessionId: 'sess-1' },
    { type: 'text', delta: 'Hello world' },
    { type: 'tool_use', id: 'tu-1', name: 'edit', input: { path: 'a.js' } },
    { type: 'tool_result', id: 'tu-1', output: 'ok', display: '@@ -1 +1 @@\n-old\n+new' },
    { type: 'result', turnId: 'turn-1', stopReason: 'end_turn' },
  ];

  const mux = await startStubMuxServer({
    onOpenStream(ws, openFrame) {
      assert.equal(openFrame.target, 'session:sess-1');
      assert.match(openFrame.streamId, /^agent-/);
      for (const value of frames) {
        ws.send(JSON.stringify({ type: 'item', streamId: openFrame.streamId, value }));
      }
      ws.send(JSON.stringify({ type: 'end', streamId: openFrame.streamId }));
    },
  });

  const bridge = createBridgeBoundToServer(mux.port, mux.token);
  const events = [];

  try {
    const out = await bridge.handle(
      'agent.stream',
      { sessionId: 'sess-1' },
      (ev) => events.push(ev),
    );
    assert.deepEqual(out, { ok: true });
    assert.deepEqual(
      events,
      frames.map((item) => ({ item })),
    );
  } finally {
    await bridge.close();
    await mux.close();
  }
});

test('agent.stream caps tool_result.output at 32768 chars + marker while leaving display untouched when under byte budget', async () => {
  const longOutput = 'A'.repeat(40 * 1024);
  const display = 'diff --git a/file.js b/file.js\n+line';
  const mux = await startStubMuxServer({
    onOpenStream(ws, openFrame) {
      ws.send(
        JSON.stringify({
          type: 'item',
          streamId: openFrame.streamId,
          value: { type: 'ready', sessionId: 'sess-cap' },
        }),
      );
      ws.send(
        JSON.stringify({
          type: 'item',
          streamId: openFrame.streamId,
          value: {
            type: 'tool_result',
            id: 'tu-cap',
            output: longOutput,
            display,
          },
        }),
      );
      ws.send(JSON.stringify({ type: 'end', streamId: openFrame.streamId }));
    },
  });

  const bridge = createBridgeBoundToServer(mux.port, mux.token);
  const events = [];

  try {
    await bridge.handle('agent.stream', { sessionId: 'sess-cap' }, (ev) => events.push(ev));
    const toolResult = events.find((e) => e.item?.type === 'tool_result').item;
    assert.equal(toolResult.output.length, 32_768 + '\n[truncated]'.length);
    assert.equal(toolResult.output.endsWith('\n[truncated]'), true);
    assert.equal(toolResult.display, display);
  } finally {
    await bridge.close();
    await mux.close();
  }
});

test('agent.stream enforces the 900 KB byte budget with UTF-8 safe display shrinking', async () => {
  const cjk100k = '字'.repeat(100_000); // 300 KB UTF-8
  const cjk290k = '字'.repeat(290_000); // 870 KB UTF-8 (+ 32 KB output > 900 KB)
  const output32k = 'B'.repeat(32_768);

  const mux = await startStubMuxServer({
    onOpenStream(ws, openFrame) {
      ws.send(
        JSON.stringify({
          type: 'item',
          streamId: openFrame.streamId,
          value: { type: 'ready', sessionId: 'sess-utf8' },
        }),
      );
      ws.send(
        JSON.stringify({
          type: 'item',
          streamId: openFrame.streamId,
          value: {
            type: 'tool_result',
            id: 'under-budget',
            output: output32k,
            display: cjk100k,
          },
        }),
      );
      ws.send(
        JSON.stringify({
          type: 'item',
          streamId: openFrame.streamId,
          value: {
            type: 'tool_result',
            id: 'over-budget',
            output: output32k,
            display: cjk290k,
          },
        }),
      );
      ws.send(JSON.stringify({ type: 'end', streamId: openFrame.streamId }));
    },
  });

  const bridge = createBridgeBoundToServer(mux.port, mux.token);
  const events = [];

  try {
    await bridge.handle('agent.stream', { sessionId: 'sess-utf8' }, (ev) => events.push(ev));
    const underEvent = events.find((e) => e.item?.id === 'under-budget');
    const overEvent = events.find((e) => e.item?.id === 'over-budget');

    // Case 1: 100k CJK chars (~300 KB) + 32 KB output < 900 KB -> NO shrink
    assert.equal(underEvent.item.display, cjk100k);
    assert.ok(Buffer.byteLength(JSON.stringify(underEvent), 'utf8') < 900_000);

    // Case 2: 290k CJK chars (~870 KB) + 32 KB output > 900 KB -> shrunk to <= 900_000 bytes, valid UTF-8, ends with marker
    const overBytes = Buffer.byteLength(JSON.stringify(overEvent), 'utf8');
    assert.ok(overBytes <= 900_000, `expected <= 900000 bytes, got ${overBytes}`);
    const d = overEvent.item.display;
    assert.equal(d.endsWith('\n[truncated]'), true);
    assert.equal(Buffer.from(d, 'utf8').toString('utf8'), d);
    assert.equal(d.includes('\uFFFD'), false, 'must not split a multi-byte UTF-8 character');
  } finally {
    await bridge.close();
    await mux.close();
  }
});

test('agent.stream emits periodic heartbeats and abort closes mux WS and clears timer', async () => {
  let serverSideClosed = false;
  const mux = await startStubMuxServer({
    onOpenStream(ws, openFrame) {
      ws.on('close', () => {
        serverSideClosed = true;
      });
      ws.send(
        JSON.stringify({
          type: 'item',
          streamId: openFrame.streamId,
          value: { type: 'ready', sessionId: 'sess-hb' },
        }),
      );
    },
  });

  const bridge = createBridgeBoundToServer(mux.port, mux.token, { heartbeatMs: 20 });
  const events = [];
  const controller = new AbortController();

  try {
    const streamPromise = bridge.handle(
      'agent.stream',
      { sessionId: 'sess-hb' },
      (ev) => events.push(ev),
      controller.signal,
    );

    // Jendela 65 ms kaku bikin tes flaky di runner lambat (Windows: 1 heartbeat, bukan 2).
    // Tunggu sampai kondisi benar-benar terpenuhi, dengan batas yang longgar.
    const heartbeatDeadline = Date.now() + 2000;
    while (events.filter((e) => e.heartbeat === true).length < 2 && Date.now() < heartbeatDeadline) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    const heartbeats = events.filter((e) => e.heartbeat === true);
    assert.ok(heartbeats.length >= 2, `expected >= 2 heartbeats within 2s, got ${heartbeats.length}`);

    controller.abort();
    await assert.rejects(
      streamPromise,
      (err) => {
        assert.equal(err.code, 'aborted');
        return true;
      },
    );

    await new Promise((resolve) => setTimeout(resolve, 40));
    assert.equal(serverSideClosed, true, 'abort must close the mux WebSocket');
    const countAfterAbort = events.filter((e) => e.heartbeat === true).length;
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(
      events.filter((e) => e.heartbeat === true).length,
      countAfterAbort,
      'heartbeat interval must be cleared on abort',
    );
  } finally {
    await bridge.close();
    await mux.close();
  }
});

test('agent.stream throws agent_runtime_missing when mux closes before ready', async () => {
  const mux = await startStubMuxServer({
    onOpenStream(ws) {
      ws.close(1011, 'internal failure before ready');
    },
  });

  const bridge = createBridgeBoundToServer(mux.port, mux.token);
  try {
    await assert.rejects(
      () => bridge.handle('agent.stream', { sessionId: 'sess-fail' }, () => {}),
      (err) => {
        assert.equal(err instanceof AgentError, true);
        assert.equal(err.code, 'agent_runtime_missing');
        return true;
      },
    );
  } finally {
    await bridge.close();
    await mux.close();
  }
});

test('win32 .cmd spawn EINVAL falls back to shell:true so npm global .cmd shims work on Node 22/24', async () => {
  const calls = [];
  const spawnImpl = (cmd, args, options) => {
    calls.push({ cmd, args, options });
    if (!options.shell) {
      const err = new Error('spawn EINVAL');
      err.code = 'EINVAL';
      throw err;
    }
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
        child.stderr.emit('data', Buffer.from('bccli serve http://127.0.0.1:56123\n'));
      },
    });
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
    platform: 'win32',
    env: { BOTCONNECTOR_BCCLI_PATH: 'C:\\Users\\demo\\AppData\\Roaming\\npm\\bccli.cmd' },
    spawnImpl,
    fetchImpl,
  });

  try {
    const caps = await bridge.handle('agent.capabilities', {});
    assert.equal(caps.bccliVersion, '0.4.9');
    const serve = await bridge.ensureServe();
    assert.equal(serve.port, 56123);
    assert.equal(calls.some((c) => c.options.shell === true), true);
  } finally {
    await bridge.close();
  }
});

test('win32 npm .cmd shim resolves adjacent node_modules/@botconnector/bccli/dist/cli.js directly via process.execPath without shell:true', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bc-win32-shim-'));
  const cliJs = path.join(tmpDir, 'node_modules', '@botconnector', 'bccli', 'dist', 'cli.js');
  const cmdShim = path.join(tmpDir, 'bccli.cmd');
  fs.mkdirSync(path.dirname(cliJs), { recursive: true });
  fs.writeFileSync(cliJs, '// fake cli.js\n', 'utf8');
  fs.writeFileSync(cmdShim, '@ECHO off\n"%_prog%" "%dp0%\\node_modules\\@botconnector\\bccli\\dist\\cli.js" %*\n', 'utf8');

  const calls = [];
  const spawnImpl = (cmd, args, options) => {
    calls.push({ cmd, args, options });
    if (cmd.endsWith('.cmd')) {
      const err = new Error('spawn EINVAL');
      err.code = 'EINVAL';
      throw err;
    }
    if (args.includes('--version')) {
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
        child.stderr.emit('data', Buffer.from('bccli serve http://127.0.0.1:56234\n'));
      },
    });
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
    platform: 'win32',
    env: { PATH: tmpDir },
    homeDir: tmpDir,
    spawnImpl,
    fetchImpl,
  });

  try {
    const caps = await bridge.handle('agent.capabilities', {});
    assert.equal(caps.bccliVersion, '0.4.9');
    const serve = await bridge.ensureServe();
    assert.equal(serve.port, 56234);
    const serveCall = calls.filter((c) => c.args.includes('serve')).pop();
    assert.ok(serveCall);
    assert.equal(serveCall.cmd, process.execPath);
    assert.equal(serveCall.args[0], cliJs);
    assert.equal(Boolean(serveCall.options.shell), false, 'must not use shell:true when cli.js is resolved');
  } finally {
    await bridge.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});




