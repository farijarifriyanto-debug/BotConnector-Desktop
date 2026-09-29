const path = require('node:path');

const UA = 'BotConnectorAI/0.4';
const HF = 'https://huggingface.co';

function norm(values) { return (Array.isArray(values) ? values : []).map(v => String(v || '').toLowerCase()); }
function inferCapabilities(item) {
  const id = String(item.id || item.modelId || '').toLowerCase();
  const tags = norm(item.tags);
  const hay = [id, ...tags].join(' ');
  const pipeline = String(item.pipeline_tag || item.pipelineTag || '').toLowerCase();
  const has = (...words) => words.some(w => hay.includes(w));
  const embeddings = ['feature-extraction','sentence-similarity'].includes(pipeline) || has('sentence-transformers','embedding','embeddings');
  const audio = ['automatic-speech-recognition','audio-text-to-text','text-to-speech','text-to-audio'].includes(pipeline) || has('whisper','voxtral','speech-recognition','audio-text');
  const vision = ['image-text-to-text','visual-question-answering'].includes(pipeline) || has('vision-language','vlm','image-text-to-text','multimodal');
  const coding = has('coder','coding','codegen','programming','fill-in-the-middle','fim');
  const tools = has('tool-use','tool_use','tool-calling','tool_calling','function-calling','function_calling','function calling');
  // 'spark' family: runtime-verified reasoning exposure (reasoning_content observed live, b10930 + Spark-X2.5-4B).
  const reasoning = has('reasoning','reasoner','thinking','qwq','gpt-oss','deepseek-r1','r1-distill','/spark-','spark-x','spark-reasoning');
  const chat = !embeddings && !audio && (['text-generation','conversational','image-text-to-text'].includes(pipeline) || has('instruct','chat','assistant') || coding || reasoning || vision || tools);
  return {chat,tools,vision,coding,reasoning,embeddings,audio};
}

const OFFICIAL_PUBLISHERS = new Set([
  'qwen','google','google-deepmind','meta-llama','mistralai','microsoft','deepseek-ai','zai-org',
  'nvidia','ibm-granite','tiiuae','allenai','cohereforai','01-ai','internlm','openbmb','minimaxai',
  'moonshotai','baichuan-inc','stabilityai','huggingface'
]);

function publisherType(author='') {
  return OFFICIAL_PUBLISHERS.has(String(author || '').trim().toLowerCase()) ? 'official' : 'community';
}

function contextLengthFromConfig(config={}) {
  const candidates = [
    config?.max_position_embeddings,
    config?.max_sequence_length,
    config?.seq_length,
    config?.context_length,
    config?.n_positions,
    config?.model_max_length,
  ].map(Number).filter((n)=>Number.isFinite(n) && n > 0 && n < 10_000_000);
  return candidates.length ? Math.max(...candidates) : null;
}

function estimateCompatibility(item, hardware) {
  // Some GGUF uploads (e.g. NVFP4 packs) report a tiny tensor total; the size in the repo name is the safer floor.
  const named = String(item.id || item.modelId || '').match(/(?:^|[-_/.])(\d+(?:\.\d+)?)[bB](?=$|[-_.])/);
  const params = Math.max(Number(item.gguf?.total || item.safetensors?.total || 0), named ? Number(named[1]) * 1e9 : 0);
  const paramsB = params > 0 ? params / 1e9 : null;
  const ramGb = Number(hardware?.ramGb || 0);
  const maxVram = Math.max(0, ...(hardware?.nvidia || []).map(g => Number(g.memoryGb || 0)));
  const estimatedQ4Gb = paramsB ? +(paramsB * 0.62).toFixed(1) : null;
  if (!estimatedQ4Gb) return {level:'unknown',paramsB:null,estimatedQ4Gb:null,reason:'size-unknown'};
  const osReserve = Math.max(4, Math.min(8, ramGb * 0.25));
  const ramBudget = Math.max(0, ramGb - osReserve);
  const vramBudget = maxVram * 0.9;
  let level='no';
  if (!vramBudget) {
    // CPU only: fitting in RAM is not enough, large models crawl at a few tokens per second.
    if (estimatedQ4Gb <= ramBudget) level = paramsB <= 4 ? 'great' : paramsB <= 9 ? 'ok' : 'warn';
    return {level,paramsB:+paramsB.toFixed(1),estimatedQ4Gb,reason:'estimated-q4-cpu'};
  }
  if (estimatedQ4Gb <= vramBudget && ramGb >= 8) level='great';
  else if (estimatedQ4Gb <= ramBudget * .75) level='great';
  else if (estimatedQ4Gb <= ramBudget) level='ok';
  else if (estimatedQ4Gb <= ramBudget + vramBudget * .65) level='warn';
  return {level,paramsB:+paramsB.toFixed(1),estimatedQ4Gb,reason:'estimated-q4'};
}

async function requestJson(url, token, timeout=20000) {
  const ctrl = new AbortController();
  const timer = setTimeout(()=>ctrl.abort(), timeout);
  try {
    const headers={'User-Agent':UA,'Accept':'application/json'};
    if (token) headers.Authorization=`Bearer ${token}`;
    const res=await fetch(url,{headers,signal:ctrl.signal});
    if (!res.ok) {
      const txt=await res.text().catch(()=> '');
      throw new Error(`Hugging Face ${res.status}${txt?`: ${txt.slice(0,180)}`:''}`);
    }
    return await res.json();
  } finally { clearTimeout(timer); }
}

async function searchModels({query='',limit=80,hardware,token,sort='',pipeline=''}={}) {
  const url=new URL(`${HF}/api/models`);
  if (query) url.searchParams.set('search',query);
  url.searchParams.set('filter','gguf');
  url.searchParams.set('sort',sort||(query?'downloads':'trendingScore'));
  if (pipeline) url.searchParams.set('pipeline_tag',pipeline);
  url.searchParams.set('direction','-1');
  url.searchParams.set('limit',String(Math.min(150,Math.max(1,limit))));
  for (const field of ['author','downloads','likes','tags','pipeline_tag','gated','lastModified','trendingScore','gguf','safetensors','cardData','config','library_name']) url.searchParams.append('expand',field);
  const items=await requestJson(url,token);
  return items.map(x=>{
    const author=x.author||String(x.id||'').split('/')[0]||'';
    const compatibility=hardware?estimateCompatibility(x,hardware):null;
    return {
      id:x.id,author,downloads:x.downloads||0,likes:x.likes||0,
      lastModified:x.lastModified||x.last_modified||null,tags:Array.isArray(x.tags)?x.tags:[],pipeline_tag:x.pipeline_tag||x.pipelineTag||null,
      gated:x.gated||false,private:Boolean(x.private),trendingScore:x.trendingScore||x.trending_score||0,gguf:x.gguf||null,safetensors:x.safetensors||null,
      cardData:x.cardData||null,config:x.config||null,libraryName:x.library_name||null,
      license:x.cardData?.license||null,baseModel:x.cardData?.base_model||null,
      contextLength:contextLengthFromConfig(x.config||{}),
      publisherType:publisherType(author),source:'Hugging Face',
      capabilities:inferCapabilities(x),compatibility,
      estimatedDownloadGb:compatibility?.estimatedQ4Gb||null,
      url:`${HF}/${x.id}`
    };
  });
}

function fileSize(f){ return Number(f?.size || f?.lfs?.size || 0); }
function quantFromName(name='') {
  const up=String(name).toUpperCase();
  const m=up.match(/(?:^|[-_.])(IQ\d(?:_[A-Z0-9]+)?|Q\d(?:_[A-Z0-9]+){0,3}|F16|BF16|F32)(?:[-_.]|$)/);
  return m?m[1]:null;
}
function normalizeGroupKey(name='') {
  return String(name).replace(/-\d{5}-of-\d{5}(?=\.gguf$)/i,'').replace(/\.gguf$/i,'');
}
function qualityRank(q='') {
  const ranks=['IQ1','IQ2','Q2','Q3','Q4_0','Q4_1','Q4_K_S','Q4_K_M','Q5_0','Q5_1','Q5_K_S','Q5_K_M','Q6_K','Q8_0','F16','BF16','F32'];
  const i=ranks.findIndex(x=>String(q).includes(x)); return i<0?99:i;
}
function groupGgufFiles(files) {
  const modelFiles=files.filter(f=>f.type==='file' && /\.gguf$/i.test(f.path||'') && !/(mmproj|projector)/i.test(f.path||''));
  const projectorFiles=files.filter(f=>f.type==='file' && /\.gguf$/i.test(f.path||'') && /(mmproj|projector)/i.test(f.path||''));
  const map=new Map();
  for (const f of modelFiles) {
    const key=normalizeGroupKey(f.path);
    if(!map.has(key)) map.set(key,[]);
    map.get(key).push(f);
  }
  const groups=[...map.entries()].map(([key,parts])=>{
    parts.sort((a,b)=>String(a.path).localeCompare(String(b.path)));
    const quant=quantFromName(key)||quantFromName(parts[0]?.path)||'GGUF';
    const size=parts.reduce((n,f)=>n+fileSize(f),0);
    return {key,quant,size,parts:parts.map(f=>({path:f.path,size:fileSize(f),oid:f.oid||f.lfs?.oid||null}))};
  }).sort((a,b)=>qualityRank(a.quant)-qualityRank(b.quant)||a.size-b.size);
  return {groups,projectors:projectorFiles.map(f=>({path:f.path,size:fileSize(f),quant:quantFromName(f.path)||'projector'})).sort((a,b)=>a.size-b.size)};
}

function preferredGgufGroup(details) {
  const groups=Array.isArray(details?.files)?details.files:[];
  if(!groups.length) return null;
  return groups.find((group)=>/Q4_K_M/i.test(String(group?.quant||group?.key||''))) ||
    groups.find((group)=>/Q5_K_M/i.test(String(group?.quant||group?.key||''))) ||
    groups.slice().sort((a,b)=>Number(a?.size||0)-Number(b?.size||0))[0] || null;
}

async function modelDetails({id,hardware,token}) {
  if (!id || !id.includes('/')) throw new Error('Invalid Hugging Face model id');
  const enc=id.split('/').map(encodeURIComponent).join('/');
  const infoUrl=new URL(`${HF}/api/models/${enc}`);
  for (const field of ['author','downloads','likes','tags','pipeline_tag','gated','lastModified','gguf','safetensors','cardData','config','library_name']) infoUrl.searchParams.append('expand',field);
  const info=await requestJson(infoUrl,token);
  let tree=[]; let cursor=null; let pages=0;
  do {
    const url=new URL(`${HF}/api/models/${enc}/tree/main`);
    url.searchParams.set('recursive','true');
    url.searchParams.set('expand','false');
    if(cursor) url.searchParams.set('cursor',cursor);
    const res=await fetch(url,{headers:{'User-Agent':UA,'Accept':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},cache:'no-store'});
    if(!res.ok) throw new Error(`Hugging Face tree ${res.status}`);
    const page=await res.json();
    tree.push(...page);
    const link=res.headers.get('link')||'';
    const m=link.match(/[?&]cursor=([^&>]+)>;\s*rel="next"/);
    cursor=m?decodeURIComponent(m[1]):null;
    pages++;
  } while(cursor && pages<10);
  const grouped=groupGgufFiles(tree);
  const author=info.author||id.split('/')[0];
  const base={
    id:info.id||id,author,tags:info.tags||[],pipeline_tag:info.pipeline_tag||null,gated:info.gated||false,
    downloads:info.downloads||0,likes:info.likes||0,lastModified:info.lastModified||info.last_modified||null,
    gguf:info.gguf||null,safetensors:info.safetensors||null,cardData:info.cardData||null,config:info.config||null,
    libraryName:info.library_name||null,license:info.cardData?.license||null,baseModel:info.cardData?.base_model||null,
    contextLength:contextLengthFromConfig(info.config||{}),publisherType:publisherType(author),source:'Hugging Face'
  };
  const details={...base,capabilities:inferCapabilities(base),compatibility:estimateCompatibility(base,hardware),files:grouped.groups,projectors:grouped.projectors,homepage:`${HF}/${id}`};
  const preferred=preferredGgufGroup(details);
  return {...details,preferredDownload:preferred?{quant:preferred.quant,size:preferred.size,key:preferred.key}:null};
}

function resolveUrl(repoId,filePath,revision='main') {
  const repo=repoId.split('/').map(encodeURIComponent).join('/');
  const p=filePath.split('/').map(encodeURIComponent).join('/');
  return `${HF}/${repo}/resolve/${encodeURIComponent(revision)}/${p}?download=true`;
}

module.exports={searchModels,modelDetails,resolveUrl,inferCapabilities,estimateCompatibility,quantFromName,preferredGgufGroup,publisherType,contextLengthFromConfig};
