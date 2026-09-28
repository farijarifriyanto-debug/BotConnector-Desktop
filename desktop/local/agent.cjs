const crypto = require('node:crypto');
const { MAX_TOOL_CALLS_PER_TURN } = require('./tools.cjs');

function parseToolArguments(value) {
  if (value == null || value === '') return {};
  if (typeof value === 'object' && !Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(String(value));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    throw new Error('Model returned invalid JSON tool arguments.');
  }
}

function normalizeToolCalls(toolCalls) {
  return (Array.isArray(toolCalls) ? toolCalls : []).map((call) => ({
    id: String(call?.id || crypto.randomUUID()),
    type: 'function',
    function: {
      name: String(call?.function?.name || call?.name || ''),
      arguments:
        typeof call?.function?.arguments === 'string'
          ? call.function.arguments
          : JSON.stringify(call?.function?.arguments || call?.arguments || {}),
    },
  })).filter((call) => call.function.name);
}

function safeToolResult(value) {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return text.length > 48_000 ? text.slice(0, 48_000) + '\n[tool result truncated]' : text;
}

class LocalAgent {
  constructor({ localAi, tools, emit = () => {} } = {}) {
    if (!localAi) throw new Error('Local AI runtime is required.');
    if (!tools) throw new Error('Tool registry is required.');
    this.localAi = localAi;
    this.tools = tools;
    this.emit = emit;
  }

  async run({
    model,
    runtime,
    messages,
    request_id: requestId = '',
    approved_tools: approvedTools = [],
  } = {}) {
    const history = Array.isArray(messages) ? messages.map((item) => ({ ...item })) : [];
    const approved = new Set((Array.isArray(approvedTools) ? approvedTools : []).map(String));
    const activities = [];
    let callsUsed = 0;

    while (true) {
      const result = await this.localAi.chat({
        model,
        runtime,
        messages: history,
        request_id: requestId,
        tools: this.tools.schemas(),
      });
      const calls = normalizeToolCalls(result?.tool_calls);
      if (!calls.length) {
        return { ...result, activities, tool_calls: [] };
      }
      if (callsUsed + calls.length > MAX_TOOL_CALLS_PER_TURN) {
        throw new Error(`Tool call limit exceeded (max ${MAX_TOOL_CALLS_PER_TURN} per turn).`);
      }

      history.push({
        role: 'assistant',
        content: String(result?.content || ''),
        tool_calls: calls,
      });

      for (const call of calls) {
        callsUsed += 1;
        const name = call.function.name;
        const args = parseToolArguments(call.function.arguments);
        const tool = this.tools.findTool(name);
        const approvalGranted = approved.has(name) || approved.has(String(tool?.id || ''));
        const started = { id: call.id, name, source: tool?.source || 'unknown', status: 'running' };
        activities.push(started);
        this.emit('agent:tool', started);
        try {
          const value = await this.tools.invoke(name, args, { approved: approvalGranted });
          const completed = { ...started, status: 'completed' };
          Object.assign(started, completed);
          this.emit('agent:tool', completed);
          history.push({
            role: 'tool',
            name,
            tool_call_id: call.id,
            content: safeToolResult(value),
          });
        } catch (error) {
          const failed = { ...started, status: 'failed', error: String(error?.message || error) };
          Object.assign(started, failed);
          this.emit('agent:tool', failed);
          history.push({
            role: 'tool',
            name,
            tool_call_id: call.id,
            content: JSON.stringify({ error: failed.error }),
          });
        }
      }
    }
  }
}

module.exports = { LocalAgent, parseToolArguments, normalizeToolCalls, safeToolResult };
