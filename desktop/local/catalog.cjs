const hf = require('./hf.cjs');

const DEFAULT_CATALOG_URL = 'https://botconnector.id';
const USER_AGENT = 'BotConnector-AIChat/0.2';

function catalogRoot() {
  const value = process.env.BOTCONNECTOR_CATALOG_URL || DEFAULT_CATALOG_URL;
  const url = new URL(value);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(url.hostname))) {
    throw new Error('Katalog BotConnector harus menggunakan HTTPS.');
  }
  return url.origin;
}

// Only GGUF repos can be downloaded and run by the device runtimes; only chat pipelines make sense in the chat UI.
const CHAT_PIPELINES = new Set(['text-generation', 'image-text-to-text', 'conversational']);
const NON_CHAT_NAME = /image|diffusion|flux|sdxl|tts|whisper|speech|audio|embed|rerank|vae|clip|upscal/i;
function runnableChatEntry(m) {
  const lib = String(m?.library || '').toLowerCase();
  const tags = Array.isArray(m?.tags) ? m.tags : [];
  const gguf = lib === 'gguf' || lib === 'llama.cpp' || /gguf/i.test(String(m?.id || '')) || tags.includes('gguf');
  const pipeline = String(m?.pipeline || m?.pipeline_tag || '').toLowerCase();
  // Many GGUF repos carry no pipeline tag; keep them unless the name marks an image/audio/embedding model.
  if (!pipeline || pipeline === 'unknown') return gguf && !NON_CHAT_NAME.test(String(m?.id || ''));
  return gguf && CHAT_PIPELINES.has(pipeline);
}

async function searchCatalog({ query = '', cursor = '', limit = 100, sort = '', hardware } = {}) {
  const q = String(query).trim().slice(0, 180);
  if (!cursor) {
    try {
      const models = await hf.searchModels({
        query: q,
        limit: Math.min(100, Math.max(10, Number(limit) || 100)),
        sort: sort || (q ? 'downloads' : 'trendingScore'),
        hardware,
        token: process.env.HF_TOKEN || '',
      });
      return { models: models.filter(runnableChatEntry), nextCursor: '', source: 'https://huggingface.co' };
    } catch {
      // Hugging Face unreachable or rate limited from this network: use the BotConnector proxy below.
    }
  }
  const url = new URL('/api/hf/search', catalogRoot());
  if (q) url.searchParams.set('q', q);
  if (cursor) url.searchParams.set('cursor', String(cursor).slice(0, 2048));
  url.searchParams.set('limit', String(Math.min(100, Math.max(10, Number(limit) || 100))));
  url.searchParams.set('sort', q ? 'downloads' : 'trending_score');

  const response = await fetch(url, {
    headers: { 'Accept': 'application/json', 'User-Agent': USER_AGENT },
    signal: AbortSignal.timeout(25000),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok === false) {
    throw new Error(payload.error || `Katalog BotConnector mengembalikan HTTP ${response.status}.`);
  }
  return {
    models: Array.isArray(payload.models) ? payload.models.filter(runnableChatEntry) : [],
    nextCursor: typeof payload.nextCursor === 'string' ? payload.nextCursor : '',
    source: catalogRoot(),
  };
}

async function modelDetails(repoId, hardware) {
  if (typeof repoId !== 'string' || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repoId)) {
    throw new Error('ID model Hugging Face tidak valid.');
  }
  return hf.modelDetails({ id: repoId, hardware, token: process.env.HF_TOKEN || '' });
}


// Safety-stripped forks and OCR packs stay findable through search, but BotConnector does not recommend them.
const UNRECOMMENDED = /uncensor|abliterat|obliterat|heretic|nsfw|ocr/i;
const FIT_RANK = { great: 0, ok: 1, warn: 2, unknown: 3, no: 4 };

// Shared by the local UI and the device bridge (app.botconnector.id asks the device through the relay).
async function recommendModels(cat, hardware, { query = '', limit } = {}) {
  const max = Math.min(24, Math.max(4, Number(limit) || 12));
  // Most-downloaded, not trending: trending is dominated by brand-new and non-chat repos.
  const result = await cat.searchCatalog({ query: String(query || ''), limit: 100, sort: 'downloads', hardware });
  // Drop what cannot run here before fetching per-model details, so small models are not crowded out.
  const candidates = (Array.isArray(result.models) ? result.models : [])
    .filter((m) => m?.compatibility?.level !== 'no' && !UNRECOMMENDED.test(String(m?.id || '')))
    .slice(0, 16);
  const enriched = await Promise.all(candidates.map(async (model) => {
    const id = String(model?.id || model?.modelId || '');
    if (!id.includes('/')) return { ...model, compatibility: model?.compatibility || null };
    try {
      const details = await cat.modelDetails(id, hardware);
      return {
        ...model,
        capabilities: details?.capabilities || model?.capabilities || null,
        compatibility: details?.compatibility || model?.compatibility || null,
      };
    } catch {
      return { ...model, compatibility: model?.compatibility || null };
    }
  }));
  enriched.sort((a, b) => {
    const ar = FIT_RANK[a?.compatibility?.level] ?? 9;
    const br = FIT_RANK[b?.compatibility?.level] ?? 9;
    return ar !== br ? ar - br : Number(b?.downloads || 0) - Number(a?.downloads || 0);
  });
  return {
    hardware,
    models: enriched
      .filter((m) => m?.capabilities?.chat !== false && m?.compatibility?.level !== 'no')
      .slice(0, max),
    source: result.source,
  };
}

module.exports = { DEFAULT_CATALOG_URL, searchCatalog, modelDetails, catalogRoot, recommendModels };
