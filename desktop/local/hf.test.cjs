const test = require('node:test');
const assert = require('node:assert/strict');
const { publisherType, contextLengthFromConfig, preferredGgufGroup } = require('./hf.cjs');

test('Hugging Face metadata helpers classify publisher and context safely', () => {
  assert.equal(publisherType('Qwen'), 'official');
  assert.equal(publisherType('DavidAU'), 'community');
  assert.equal(contextLengthFromConfig({ max_position_embeddings: 32768 }), 32768);
  assert.equal(contextLengthFromConfig({ context_length: 131072, n_positions: 8192 }), 131072);
  assert.equal(contextLengthFromConfig({}), null);
});

test('preferred GGUF group chooses Q4_K_M, then Q5_K_M, then smallest', () => {
  const q4 = { quant: 'Q4_K_M', size: 6 };
  const q5 = { quant: 'Q5_K_M', size: 7 };
  const q8 = { quant: 'Q8_0', size: 12 };
  assert.equal(preferredGgufGroup({ files: [q8, q5, q4] }), q4);
  assert.equal(preferredGgufGroup({ files: [q8, q5] }), q5);
  assert.equal(preferredGgufGroup({ files: [{ quant: 'F16', size: 20 }, { quant: 'Q3', size: 5 }] }).size, 5);
  assert.equal(preferredGgufGroup({ files: [] }), null);
});
