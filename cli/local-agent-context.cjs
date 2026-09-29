const {
  normalizeMode,
  normalizePermission,
  workspaceList,
  workspaceRead,
  workspaceSearch,
  workspaceWrite,
} = require('./local-workspaces.cjs');

const VIRTUAL_TOOLS = {
  workspace_list: {
    id: 'workspace_list',
    name: 'workspace_list',
    description: 'List files and folders inside the selected workspace.',
    source: 'workspace',
    permissionClass: 'READ',
    status: 'READY',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Workspace-relative directory path. Defaults to .' },
        limit: { type: 'integer', description: 'Maximum entries, 1-200.' },
      },
      additionalProperties: false,
    },
  },
  workspace_read: {
    id: 'workspace_read',
    name: 'workspace_read',
    description: 'Read a UTF-8 text file from the selected workspace.',
    source: 'workspace',
    permissionClass: 'READ',
    status: 'READY',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Workspace-relative file path.' },
        max_chars: { type: 'integer', description: 'Maximum returned characters.' },
      },
      required: ['path'],
      additionalProperties: false,
    },
  },
  workspace_search: {
    id: 'workspace_search',
    name: 'workspace_search',
    description: 'Search text across files in the selected workspace.',
    source: 'workspace',
    permissionClass: 'READ',
    status: 'READY',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        path: { type: 'string', description: 'Workspace-relative file or directory. Defaults to .' },
        max_results: { type: 'integer' },
      },
      required: ['query'],
      additionalProperties: false,
    },
  },
  workspace_write: {
    id: 'workspace_write',
    name: 'workspace_write',
    description: 'Write or replace a UTF-8 text file inside the selected workspace.',
    source: 'workspace',
    permissionClass: 'WRITE',
    status: 'READY',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Workspace-relative file path.' },
        content: { type: 'string' },
      },
      required: ['path', 'content'],
      additionalProperties: false,
    },
  },
};

function clone(value) { return JSON.parse(JSON.stringify(value)); }

function replaceTemplates(value, results) {
  if (Array.isArray(value)) return value.map((item) => replaceTemplates(item, results));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, replaceTemplates(item, results)]));
  }
  if (typeof value !== 'string') return value;
  return value.replace(/\$step\.(\d+)/g, (_, index) => {
    const item = results[Number(index)];
    if (item === undefined) return '';
    if (typeof item === 'string') return item;
    try { return JSON.stringify(item); } catch { return String(item); }
  });
}

function baseToolMap(base) {
  return new Map((base?.list?.() || []).map((tool) => [String(tool.id || tool.name), tool]));
}

function modeToolIds(base, { workspace, mode, permission, selected = [] }) {
  const normalizedMode = normalizeMode(mode);
  const normalizedPermission = normalizePermission(permission);
  const baseRows = base?.list?.() || [];
  const selectedSet = new Set(selected.map(String));
  const ready = baseRows.filter((tool) => tool.status === 'READY');
  const ids = new Set();

  if (workspace?.root) {
    ids.add('workspace_list');
    ids.add('workspace_read');
    ids.add('workspace_search');
    if (normalizedPermission !== 'read-only' && normalizedMode !== 'minimal') ids.add('workspace_write');
  }

  if (normalizedMode === 'minimal') {
    return [...ids];
  }

  if (normalizedMode === 'ptc') {
    return ['run_tool_program'];
  }

  for (const tool of ready) {
    const id = String(tool.id || tool.name);
    const isSelected = selectedSet.has(id) || selectedSet.has(String(tool.name));
    const diagnostic = ['get_current_time', 'echo_text'].includes(id);
    if (normalizedMode === 'creator') {
      if (isSelected || diagnostic || tool.source === 'builtin') ids.add(id);
      continue;
    }
    if (isSelected) ids.add(id);
  }
  return [...ids];
}

function createScopedTools(base, { workspace = null, mode = 'standard', permission = 'workspace-write', selected = [], approved = [] } = {}) {
  const normalizedMode = normalizeMode(mode);
  const normalizedPermission = normalizePermission(permission);
  const approvedSet = new Set((approved || []).map(String));
  const baseRows = base?.list?.() || [];
  const byId = baseToolMap(base);
  for (const tool of baseRows) byId.set(String(tool.name), tool);

  const underlyingIds = (() => {
    const ids = new Set();
    if (workspace?.root) {
      ids.add('workspace_list');
      ids.add('workspace_read');
      ids.add('workspace_search');
      if (normalizedPermission !== 'read-only') ids.add('workspace_write');
    }
    for (const tool of baseRows) {
      const id = String(tool.id || tool.name);
      const chosen = selected.includes(id) || selected.includes(String(tool.name));
      if (chosen || (normalizedMode === 'creator' && tool.source === 'builtin')) ids.add(id);
    }
    return [...ids];
  })();

  const ptcTool = {
    id: 'run_tool_program',
    name: 'run_tool_program',
    description:
      'Execute a multi-step tool program in one call. Available step tools: ' +
      underlyingIds.join(', ') +
      '. Steps run in order. String arguments may reference a previous result using $step.0, $step.1, etc.',
    source: 'ptc',
    permissionClass: 'READ',
    status: 'READY',
    inputSchema: {
      type: 'object',
      properties: {
        steps: {
          type: 'array',
          description: 'Ordered tool steps.',
          items: {
            type: 'object',
            properties: {
              tool: { type: 'string' },
              args: { type: 'object' },
            },
            required: ['tool'],
            additionalProperties: false,
          },
        },
      },
      required: ['steps'],
      additionalProperties: false,
    },
  };

  const ids = modeToolIds(base, { workspace, mode: normalizedMode, permission: normalizedPermission, selected });

  function descriptor(name) {
    if (VIRTUAL_TOOLS[name]) return VIRTUAL_TOOLS[name];
    if (name === 'run_tool_program') return ptcTool;
    return byId.get(String(name)) || null;
  }

  function canAutoApprove(tool) {
    if (!tool || tool.permissionClass === 'READ') return true;
    if (normalizedPermission === 'full-access') return true;
    if (tool.id === 'workspace_write' && normalizedPermission === 'workspace-write') return true;
    return approvedSet.has(String(tool.id)) || approvedSet.has(String(tool.name));
  }

  async function invokeOne(name, args = {}) {
    const tool = descriptor(name);
    if (!tool) throw new Error(`Tool '${name}' is not available in this mode.`);
    if (tool.id === 'workspace_list') return workspaceList(workspace?.root, args);
    if (tool.id === 'workspace_read') return workspaceRead(workspace?.root, args);
    if (tool.id === 'workspace_search') return workspaceSearch(workspace?.root, args);
    if (tool.id === 'workspace_write') {
      if (!canAutoApprove(tool)) throw new Error('Workspace write requires Workspace Write or Full Access permission.');
      return workspaceWrite(workspace?.root, args);
    }
    if (!canAutoApprove(tool)) throw new Error(`Tool '${tool.name}' requires explicit approval.`);
    return base.invoke(tool.name, args, { selected: true, approved: true });
  }

  async function runProgram(args = {}) {
    const steps = Array.isArray(args.steps) ? args.steps.slice(0, 8) : [];
    if (!steps.length) throw new Error('PTC program requires at least one step.');
    const results = [];
    for (let index = 0; index < steps.length; index++) {
      const step = steps[index] || {};
      const name = String(step.tool || '');
      if (!underlyingIds.includes(name)) {
        const tool = descriptor(name);
        if (!tool || !underlyingIds.includes(String(tool.id))) {
          throw new Error(`PTC step tool '${name}' is not allowed in this session.`);
        }
      }
      const parsedArgs = replaceTemplates(step.args || {}, results);
      const result = await invokeOne(name, parsedArgs);
      results.push(result);
    }
    return { mode: 'ptc', steps: results.length, results };
  }

  return {
    selectedToolIds() { return [...ids]; },
    list() { return ids.map(descriptor).filter(Boolean).map(clone); },
    findTool(name) {
      const tool = descriptor(name);
      if (!tool) return null;
      if (!ids.includes(String(tool.id)) && !ids.includes(String(tool.name))) return null;
      return clone(tool);
    },
    schemas() {
      return ids.map(descriptor).filter(Boolean).map((tool) => ({
        type: 'function',
        function: {
          name: tool.name,
          description: tool.description,
          parameters: tool.inputSchema,
        },
      }));
    },
    async invoke(name, args = {}) {
      if (name === 'run_tool_program') return runProgram(args);
      return invokeOne(name, args);
    },
  };
}

module.exports = { VIRTUAL_TOOLS, createScopedTools, modeToolIds, replaceTemplates };
