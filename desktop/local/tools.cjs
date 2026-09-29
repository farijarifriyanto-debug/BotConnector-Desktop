const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');
const { Worker } = require('node:worker_threads');

const MAX_TOOL_CALLS_PER_TURN = 4;
const TOOL_TIMEOUT_MS = 10_000;
const WEB_SEARCH_TIMEOUT_MS = 15_000;
const RUN_CODE_TIMEOUT_MS = 8_000;
const MAX_TOOL_OUTPUT_CHARS = 32 * 1024;
const PTC_TIMEOUT_MS = 30_000;
const PTC_WORKER_SOURCE = "const { parentPort, workerData } = require('node:worker_threads');\nconst vm = require('node:vm');\n\nlet sequence = 0;\nconst pending = new Map();\n\nfunction bridge(name, argsJson = '{}') {\n  return new Promise((resolve, reject) => {\n    const id = String(++sequence);\n    pending.set(id, { resolve, reject });\n    parentPort.postMessage({ type: 'tool.call', id, name: String(name), argsJson: String(argsJson || '{}') });\n  });\n}\nObject.setPrototypeOf(bridge, null);\nObject.freeze(bridge);\n\nparentPort.on('message', (message) => {\n  if (message?.type !== 'tool.result') return;\n  const row = pending.get(String(message.id));\n  if (!row) return;\n  pending.delete(String(message.id));\n  if (message.ok) row.resolve(String(message.value || 'null'));\n  else row.reject(new Error(String(message.error || 'PTC tool failed.')));\n});\n\n(async () => {\n  try {\n    const sdkEntries = workerData.toolNames.map((name) =>\n      JSON.stringify(name) +\n      ': async (args = {}) => JSON.parse(await __bcCall(' +\n      JSON.stringify(name) +\n      ', JSON.stringify(args)))'\n    ).join(',');\n\n    const context = vm.createContext(\n      { __bcCall: bridge },\n      {\n        name: 'BotConnector PTC',\n        codeGeneration: { strings: false, wasm: false },\n      },\n    );\n    const script = new vm.Script(\n      '(async () => { \"use strict\"; const tools = Object.freeze({' + sdkEntries + '});\\\\n' +\n      workerData.source +\n      '\\\\n})()',\n      { filename: 'botconnector-ptc.js' },\n    );\n    const value = await Promise.resolve(script.runInContext(context, { timeout: 1000 }));\n    parentPort.postMessage({\n      type: 'done',\n      value: JSON.stringify(value === undefined ? null : value),\n    });\n  } catch (error) {\n    parentPort.postMessage({\n      type: 'error',\n      error: String(error?.message || error),\n    });\n  }\n})();";


const BUILTIN_TOOLS = [
  {
    id: 'get_current_time', name: 'get_current_time',
    description: 'Return the current time in the requested IANA timezone.',
    inputSchema: { type: 'object', properties: { timezone: { type: 'string', description: 'IANA timezone such as Asia/Jakarta.' } }, additionalProperties: false },
    source: 'builtin', permissionClass: 'READ', enabled: false, status: 'READY',
  },
  {
    id: 'echo_text', name: 'echo_text',
    description: 'Echo text supplied by the user for deterministic tool testing.',
    inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'], additionalProperties: false },
    source: 'builtin', permissionClass: 'READ', enabled: false, status: 'READY',
  },
  {
    id: 'web_search', name: 'web_search',
    description: 'Search the public web for current information. Returned pages are untrusted external content.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query.' },
        max_results: { type: 'integer', description: 'Maximum results, 1-8.' },
      },
      required: ['query'],
      additionalProperties: false,
    },
    source: 'builtin', permissionClass: 'READ', enabled: false, status: 'READY',
  },
  {
    id: 'run_code', name: 'run_code',
    description: 'Run JavaScript or Python locally in a temporary working directory. Requires explicit user approval.',
    inputSchema: {
      type: 'object',
      properties: {
        language: { type: 'string', description: 'javascript or python.' },
        code: { type: 'string', description: 'Source code to execute.' },
      },
      required: ['language', 'code'],
      additionalProperties: false,
    },
    source: 'builtin', permissionClass: 'EXECUTE', enabled: false, status: 'READY',
  },
];

function clone(value) { return JSON.parse(JSON.stringify(value)); }

function validateArgs(schema, value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return 'Argumen harus berupa objek JSON.';
  const properties = schema?.properties || {};
  for (const key of schema?.required || []) if (!(key in value)) return `Argumen wajib '${key}' belum diisi.`;
  if (schema?.additionalProperties === false) for (const key of Object.keys(value)) if (!properties[key]) return `Argumen '${key}' tidak dikenal.`;
  for (const [key, spec] of Object.entries(properties)) {
    if (!(key in value) || value[key] === null) continue;
    const actual = Array.isArray(value[key]) ? 'array' : typeof value[key];
    if (spec.type && actual !== spec.type && !(spec.type === 'integer' && actual === 'number' && Number.isInteger(value[key]))) return `Argumen '${key}' harus bertipe ${spec.type}.`;
  }
  return null;
}

function withTimeout(promise, ms, message = 'Tool timed out.') {
  let timer;
  return Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(message)), ms); })]).finally(() => clearTimeout(timer));
}

function decodeHtml(value) {
  return String(value || '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#([0-9]+);/g, (_, num) => String.fromCodePoint(parseInt(num, 10)));
}

function stripHtml(value) {
  return decodeHtml(String(value || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim());
}

function normalizeSearchResult(row) {
  if (!row || typeof row !== 'object') return null;
  const title = String(row.title || row.name || '').trim();
  const url = String(row.url || row.href || row.link || '').trim();
  const snippet = String(row.snippet || row.description || row.body || row.content || '').trim();
  if (!title && !url && !snippet) return null;
  return {
    title: title.slice(0, 500),
    url: url.slice(0, 2000),
    snippet: snippet.slice(0, 2000),
  };
}

async function webSearch(args = {}) {
  const query = String(args.query || '').trim().slice(0, 500);
  if (!query) throw new Error('Search query is required.');
  const requested = Number(args.max_results);
  const maxResults = Number.isInteger(requested) ? Math.max(1, Math.min(8, requested)) : 5;
  const configured = String(process.env.BOTCONNECTOR_WEB_SEARCH_URL || '').trim();

  if (configured) {
    const response = await fetch(configured, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ query, max_results: maxResults }),
      signal: AbortSignal.timeout(WEB_SEARCH_TIMEOUT_MS),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload?.error?.message || payload?.message || `Web Search HTTP ${response.status}`);
    }
    const rows = Array.isArray(payload) ? payload : Array.isArray(payload?.results) ? payload.results : [];
    return {
      query,
      provider: 'configured',
      results: rows.map(normalizeSearchResult).filter(Boolean).slice(0, maxResults),
      untrustedExternalContent: true,
    };
  }

  const target = 'https://lite.duckduckgo.com/lite/?q=' + encodeURIComponent(query);
  const response = await fetch(target, {
    headers: {
      accept: 'text/html,application/xhtml+xml',
      'user-agent': 'BotConnector-Device/0.4 (+https://botconnector.id)',
    },
    signal: AbortSignal.timeout(WEB_SEARCH_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`Web Search HTTP ${response.status}`);
  const html = await response.text();
  const anchorPattern = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
  const snippetPattern = /<td[^>]+class=["'][^"']*result-snippet[^"']*["'][^>]*>([\s\S]*?)<\/td>/gi;
  const links = [];
  const snippets = [];
  let match;
  while ((match = anchorPattern.exec(html)) && links.length < maxResults) {
    const attributes = match[1] || '';
    if (!/\bclass=["'][^"']*\bresult-link\b[^"']*["']/i.test(attributes)) continue;
    const href = attributes.match(/\bhref=["']([^"']+)["']/i)?.[1];
    if (!href) continue;
    let url = decodeHtml(href);
    try {
      const parsed = new URL(url, 'https://duckduckgo.com');
      const redirected = parsed.searchParams.get('uddg');
      if (redirected) url = redirected;
      else url = parsed.toString();
    } catch {}
    links.push({ title: stripHtml(match[2]), url });
  }
  while ((match = snippetPattern.exec(html)) && snippets.length < maxResults) {
    snippets.push(stripHtml(match[1]));
  }
  return {
    query,
    provider: 'duckduckgo-lite',
    results: links.map((row, index) => ({ ...row, snippet: snippets[index] || '' })),
    untrustedExternalContent: true,
  };
}

async function runCode(args = {}, { cwd = '' } = {}) {
  const language = String(args.language || '').trim().toLowerCase();
  const code = String(args.code || '');
  if (!code.trim()) throw new Error('Code is required.');
  if (code.length > 20_000) throw new Error('Code is too large.');
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'botconnector-code-'));
  let command;
  let commandArgs;
  if (language === 'javascript' || language === 'js' || language === 'node') {
    command = process.execPath;
    commandArgs = ['--input-type=module', '--eval', code];
  } else if (language === 'python' || language === 'py') {
    command = String(process.env.BOTCONNECTOR_PYTHON || (process.platform === 'win32' ? 'python' : 'python3'));
    commandArgs = ['-I', '-S', '-c', code];
  } else {
    await fs.rm(tempDir, { recursive: true, force: true });
    throw new Error('Run Code supports javascript or python.');
  }

  try {
    const result = await new Promise((resolve, reject) => {
      const child = spawn(command, commandArgs, {
        cwd: cwd ? path.resolve(cwd) : tempDir,
        env: {
          PATH: process.env.PATH || '',
          Path: process.env.Path || '',
          SystemRoot: process.env.SystemRoot || '',
          WINDIR: process.env.WINDIR || '',
          HOME: tempDir,
          USERPROFILE: tempDir,
          TMPDIR: tempDir,
          TEMP: tempDir,
          TMP: tempDir,
          NO_COLOR: '1',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
        shell: false,
      });
      let stdout = '';
      let stderr = '';
      let truncated = false;
      const append = (current, chunk) => {
        const next = current + chunk.toString('utf8');
        if (next.length <= MAX_TOOL_OUTPUT_CHARS) return next;
        truncated = true;
        return next.slice(0, MAX_TOOL_OUTPUT_CHARS);
      };
      child.stdout.on('data', chunk => { stdout = append(stdout, chunk); });
      child.stderr.on('data', chunk => { stderr = append(stderr, chunk); });
      const timer = setTimeout(() => {
        try { child.kill(); } catch {}
        reject(new Error('Run Code timed out.'));
      }, RUN_CODE_TIMEOUT_MS);
      child.once('error', error => {
        clearTimeout(timer);
        reject(error);
      });
      child.once('exit', (exitCode, signal) => {
        clearTimeout(timer);
        resolve({
          language: language === 'python' || language === 'py' ? 'python' : 'javascript',
          exitCode,
          signal: signal || null,
          stdout,
          stderr,
          truncated,
        });
      });
    });
    return result;
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}

function openRpcProcess(server) {
  const child = spawn(server.command, server.args || [], {
    cwd: server.cwd || process.cwd(),
    env: { ...process.env, ...(server.env || {}) },
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  });
  let buffer = '';
  let nextId = 1;
  const pending = new Map();
  child.stdout.on('data', chunk => {
    buffer += chunk.toString();
    let newline;
    while ((newline = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, newline).trim(); buffer = buffer.slice(newline + 1);
      if (!line) continue;
      try {
        const message = JSON.parse(line);
        const waiter = pending.get(message.id);
        if (waiter) { pending.delete(message.id); message.error ? waiter.reject(new Error(message.error.message || 'MCP error')) : waiter.resolve(message.result); }
      } catch { /* Ignore malformed fixture output; request timeout reports failure. */ }
    }
  });
  const fail = error => { for (const waiter of pending.values()) waiter.reject(error); pending.clear(); };
  child.once('exit', code => fail(new Error(`MCP server berhenti (exit ${code ?? 'unknown'}).`)));
  child.once('error', fail);
  const request = (method, params = {}) => new Promise((resolve, reject) => {
    const id = nextId++; pending.set(id, { resolve, reject });
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
  });
  return { child, request };
}


function ptcSdkSignature(tool) {
  const props = tool?.inputSchema?.properties || {};
  const required = new Set(tool?.inputSchema?.required || []);
  const fields = Object.entries(props).map(([name, spec]) => {
    const type = spec?.type === 'integer' || spec?.type === 'number'
      ? 'number'
      : spec?.type === 'boolean'
        ? 'boolean'
        : spec?.type === 'array'
          ? 'unknown[]'
          : spec?.type === 'object'
            ? 'Record<string, unknown>'
            : 'string';
    return `${name}${required.has(name) ? '' : '?'}: ${type}`;
  });
  return `tools.${tool.name}({ ${fields.join(', ')} })`;
}

function ptcSystemPrompt(toolRows, workspacePath = '') {
  const catalog = toolRows.map((tool) =>
    `- ${ptcSdkSignature(tool)} // ${tool.description || tool.name}`
  ).join('\n');
  return [
    'PTC mode is active.',
    'You receive one model-facing tool named run_code. Write a JavaScript async orchestration program in its code field.',
    'The program has a global object named tools. Call only the generated SDK methods below.',
    'Return the final useful value from the program. Use Promise.all when independent calls can run concurrently.',
    workspacePath ? `Workspace root: ${workspacePath}` : '',
    'Generated SDK:',
    catalog || '- No callable SDK tools are available in this permission profile.',
  ].filter(Boolean).join('\n');
}

function minimalSystemPrompt(workspacePath = '') {
  return [
    'Minimal mode is active.',
    'Keep tool use and context small. Use run_code only when execution is necessary; otherwise answer directly.',
    workspacePath ? `Workspace root: ${workspacePath}` : '',
  ].filter(Boolean).join('\n');
}

class ToolRegistry {
  constructor({ modelsDir, emit = () => {} } = {}) {
    this.modelsDir = path.resolve(modelsDir || process.cwd());
    this.emit = emit;
    this.tools = new Map(BUILTIN_TOOLS.map(tool => [tool.id, clone(tool)]));
    this.servers = new Map();
  }

  list() { return [...this.tools.values()].map(clone); }
  findTool(name) { return this.tools.get(String(name)) || [...this.tools.values()].find(tool => tool.name === String(name)); }
  selectedTools(selected = null, { permission = 'workspace-write' } = {}) {
    const wanted = Array.isArray(selected) && selected.length
      ? new Set(selected.map(String))
      : null;
    return this.list()
      .filter(tool =>
        tool.status === 'READY' &&
        (wanted ? (wanted.has(tool.id) || wanted.has(tool.name)) : tool.enabled) &&
        !(permission === 'read-only' && tool.permissionClass !== 'READ')
      );
  }

  schemas(selected = null, options = {}) {
    return this.selectedTools(selected, options)
      .map(tool => ({
        type: 'function',
        function: { name: tool.name, description: tool.description, parameters: tool.inputSchema },
      }));
  }

  ptcSchema(selected = null, options = {}) {
    const rows = this.selectedTools(selected, options);
    return [{
      type: 'function',
      function: {
        name: 'run_code',
        description:
          'Execute a JavaScript orchestration program using the generated BotConnector tools SDK. ' +
          'The code receives a global tools object and should return its final value.',
        parameters: {
          type: 'object',
          properties: {
            code: {
              type: 'string',
              description: 'JavaScript body for an async function. Example: return await tools.web_search({query:"OpenAI"});',
            },
          },
          required: ['code'],
          additionalProperties: false,
        },
      },
    }];
  }

  ptcPrompt(selected = null, options = {}) {
    return ptcSystemPrompt(
      this.selectedTools(selected, options),
      String(options.workspacePath || ''),
    );
  }

  minimalPrompt(options = {}) {
    return minimalSystemPrompt(String(options.workspacePath || ''));
  }
  setEnabled(id, enabled) {
    const tool = this.tools.get(String(id));
    if (!tool) throw new Error(`Tool tidak dikenal: ${id}`);
    tool.enabled = Boolean(enabled);
    this.emit('tools:changed', this.list());
    return clone(tool);
  }

  async execute(name, args = {}, { approved = false, selected = false, permission = 'workspace-write', workspacePath = '' } = {}) {
    const tool = this.findTool(name);
    if (!tool) throw new Error(`Tool tidak dikenal: ${name}`);
    if (!tool.enabled && !selected) throw new Error(`Tool '${name}' belum diaktifkan.`);
    if (permission === 'read-only' && tool.permissionClass !== 'READ') {
      throw new Error(`Tool '${name}' diblokir oleh permission Read only.`);
    }
    if (tool.permissionClass !== 'READ' && !approved && permission !== 'full-access') {
      throw new Error(`Tool '${name}' membutuhkan persetujuan eksplisit.`);
    }
    const validation = validateArgs(tool.inputSchema, args);
    if (validation) throw new Error(validation);
    const run = async () => {
      if (typeof tool.executor === 'function') return tool.executor(args);
      if (name === 'get_current_time') {
        const timezone = args.timezone || 'Asia/Jakarta';
        try { return { timezone, iso: new Date().toISOString(), local: new Intl.DateTimeFormat('id-ID', { dateStyle: 'full', timeStyle: 'long', timeZone: timezone }).format(new Date()) }; }
        catch { throw new Error(`Timezone tidak valid: ${timezone}`); }
      }
      if (name === 'echo_text') return { text: args.text };
      if (name === 'web_search') return webSearch(args);
      if (name === 'run_code') return runCode(args, { cwd: workspacePath });
      throw new Error(`Tool '${name}' belum memiliki executor.`);
    };
    const result = await withTimeout(run(), TOOL_TIMEOUT_MS);
    this.emit('tool:activity', { name, source: tool.source, permissionClass: tool.permissionClass, arguments: args, result });
    return result;
  }

  async registerMcp(definition = {}) {
    const id = String(definition.id || 'local-fixture');
    if (this.servers.has(id)) return this.mcpStatus();
    const server = {
      id, name: String(definition.name || 'Local MCP fixture'), transport: 'stdio',
      command: definition.command || process.env.BOTCONNECTOR_NODE || 'node',
      args: Array.isArray(definition.args)
        ? definition.args.map(String)
        : definition.command
          ? []
          : [path.join(__dirname, 'mcp-fixture.cjs')],
      cwd: definition.cwd || process.cwd(), enabled: definition.enabled !== false,
      status: 'STARTING', tools: [], error: null,
    };
    this.servers.set(id, server);
    try {
      server.rpc = openRpcProcess(server);
      await withTimeout(server.rpc.request('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'BotConnector', version: '0.2.0' } }), TOOL_TIMEOUT_MS, 'MCP server gagal diinisialisasi.');
      const discovered = await withTimeout(server.rpc.request('tools/list', {}), TOOL_TIMEOUT_MS, 'MCP discovery timed out.');
      server.tools = Array.isArray(discovered?.tools) ? discovered.tools.map(item => ({
        id: `${id}:${item.name}`, name: `mcp_${id}_${item.name}`, remoteName: item.name, description: item.description || 'MCP tool', inputSchema: item.inputSchema || { type: 'object' }, source: `mcp:${id}`, permissionClass: ['READ', 'WRITE', 'EXECUTE'].includes(String(definition.permissionClass || '').toUpperCase()) ? String(definition.permissionClass).toUpperCase() : 'EXECUTE', enabled: false, status: 'READY', serverId: id,
      })) : [];
      for (const tool of server.tools) this.tools.set(tool.id, tool);
      server.status = 'READY';
      this.emit('mcp:changed', this.mcpStatus());
      return this.mcpStatus();
    } catch (error) {
      server.status = 'FAILED'; server.error = error.message || String(error);
      server.rpc?.child.kill();
      this.emit('mcp:changed', this.mcpStatus());
      return this.mcpStatus();
    }
  }

  mcpStatus() { return [...this.servers.values()].map(server => ({ id: server.id, name: server.name, transport: server.transport, command: server.command, args: server.args, enabled: server.enabled, status: server.status, error: server.error, tools: server.tools.map(clone) })); }

  async loadMcpConfig(configPath = process.env.BOTCONNECTOR_MCP_CONFIG || path.join(os.homedir(), '.botconnector-device', 'mcp.json')) {
    let parsed;
    try {
      parsed = JSON.parse(await fs.readFile(configPath, 'utf8'));
    } catch (error) {
      if (error?.code === 'ENOENT') return this.mcpStatus();
      throw new Error(`MCP config tidak valid: ${error?.message || error}`);
    }
    const servers = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.servers) ? parsed.servers : [];
    for (const definition of servers) {
      if (!definition || typeof definition !== 'object' || definition.enabled === false) continue;
      if (!String(definition.command || '').trim()) continue;
      await this.registerMcp(definition);
    }
    return this.mcpStatus();
  }

  async executeMcp(tool, args) {
    const server = this.servers.get(tool.serverId);
    if (!server || server.status !== 'READY') throw new Error('MCP server belum READY.');
    const validation = validateArgs(tool.inputSchema, args);
    if (validation) throw new Error(validation);
    const result = await withTimeout(server.rpc.request('tools/call', { name: tool.remoteName || tool.name, arguments: args }), TOOL_TIMEOUT_MS, 'MCP tool timed out.');
    this.emit('tool:activity', { name: tool.name, source: tool.source, permissionClass: tool.permissionClass, arguments: args, result });
    return result;
  }

  async invoke(name, args = {}, options = {}) {
    const tool = this.findTool(name);
    if (!tool) throw new Error(`Tool tidak dikenal: ${name}`);
    if (!tool.enabled && !options.selected) throw new Error(`Tool '${name}' belum diaktifkan.`);
    if (options.permission === 'read-only' && tool.permissionClass !== 'READ') {
      throw new Error(`Tool '${name}' diblokir oleh permission Read only.`);
    }
    if (
      tool.permissionClass !== 'READ' &&
      !options.approved &&
      options.permission !== 'full-access'
    ) {
      throw new Error(`Tool '${name}' membutuhkan persetujuan eksplisit.`);
    }
    if (tool.serverId) return this.executeMcp(tool, args);
    return this.execute(name, args, options);
  }

  async runPtc(
    code,
    {
      selected = null,
      approved = [],
      permission = 'workspace-write',
      workspacePath = '',
    } = {},
  ) {
    const source = String(code || '');
    if (!source.trim()) throw new Error('PTC code is required.');
    if (source.length > 30_000) throw new Error('PTC code is too large.');

    const approvedSet = approved instanceof Set ? approved : new Set((approved || []).map(String));
    const rows = this.selectedTools(selected, { permission });
    const allowed = new Map(rows.map((tool) => [tool.name, tool]));

    return await new Promise((resolve, reject) => {
      const worker = new Worker(PTC_WORKER_SOURCE, {
        eval: true,
        workerData: {
          source,
          toolNames: rows.map((tool) => tool.name),
        },
      });
      let settled = false;
      let timer = null;
      const finish = async (error, value) => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        worker.removeAllListeners();
        try { await worker.terminate(); } catch {}
        if (error) reject(error);
        else resolve(value);
      };
      timer = setTimeout(
        () => finish(new Error('PTC program timed out.')),
        PTC_TIMEOUT_MS,
      );

      worker.on('message', async (message) => {
        if (message?.type === 'tool.call') {
          const tool = allowed.get(String(message.name));
          if (!tool) {
            worker.postMessage({
              type: 'tool.result',
              id: message.id,
              ok: false,
              error: 'PTC tool is not allowed: ' + String(message.name),
            });
            return;
          }
          let args;
          try {
            args = JSON.parse(String(message.argsJson || '{}'));
          } catch {
            worker.postMessage({
              type: 'tool.result',
              id: message.id,
              ok: false,
              error: 'PTC tool arguments must be JSON serializable.',
            });
            return;
          }
          try {
            const result = await this.invoke(tool.name, args, {
              selected: true,
              approved:
                permission === 'full-access' ||
                approvedSet.has(tool.id) ||
                approvedSet.has(tool.name),
              permission,
              workspacePath,
            });
            worker.postMessage({
              type: 'tool.result',
              id: message.id,
              ok: true,
              value: JSON.stringify(result === undefined ? null : result),
            });
          } catch (error) {
            worker.postMessage({
              type: 'tool.result',
              id: message.id,
              ok: false,
              error: String(error?.message || error),
            });
          }
          return;
        }
        if (message?.type === 'done') {
          let value = null;
          try { value = JSON.parse(String(message.value || 'null')); }
          catch { return finish(new Error('PTC result was not valid JSON.')); }
          return finish(null, value);
        }
        if (message?.type === 'error') {
          return finish(new Error(String(message.error || 'PTC program failed.')));
        }
      });
      worker.on('error', (error) => finish(error));
      worker.on('exit', (code) => {
        if (!settled && code !== 0) finish(new Error('PTC worker exited with code ' + code + '.'));
      });
    });
  }

  async close() {
    for (const server of this.servers.values()) { try { server.rpc?.child.stdin.destroy(); server.rpc?.child.kill(); server.rpc?.child.unref(); } catch {} server.status = 'STOPPED'; }
    this.servers.clear();
  }
}

module.exports = {
  ToolRegistry,
  BUILTIN_TOOLS,
  MAX_TOOL_CALLS_PER_TURN,
  validateArgs,
  webSearch,
  runCode,
  ptcSystemPrompt,
  minimalSystemPrompt,
};
