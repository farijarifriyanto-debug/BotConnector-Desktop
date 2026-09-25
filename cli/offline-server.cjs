
const crypto = require('node:crypto');
const http = require('node:http');
const { spawn } = require('node:child_process');

const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_PORT = 18765;
const MAX_BODY_BYTES = 512 * 1024;

function sendJson(res, status, payload) {
  const body = Buffer.from(JSON.stringify(payload));
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': body.length,
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
  });
  res.end(body);
}

function sendHtml(res, html) {
  const body = Buffer.from(html);
  res.writeHead(200, {
    'content-type': 'text/html; charset=utf-8',
    'content-length': body.length,
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
    'content-security-policy':
      "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  });
  res.end(body);
}

async function readJson(req) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) {
      const error = new Error('Request body is too large.');
      error.status = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    const error = new Error('Invalid JSON body.');
    error.status = 400;
    throw error;
  }
}

function requireLocalApi(req, token, host, port) {
  const expectedHosts = new Set([host + ':' + port, 'localhost:' + port]);
  if (!expectedHosts.has(String(req.headers.host || ''))) {
    const error = new Error('Invalid local host.');
    error.status = 403;
    throw error;
  }

  const origin = String(req.headers.origin || '');
  if (
    origin &&
    origin !== 'http://' + host + ':' + port &&
    origin !== 'http://localhost:' + port
  ) {
    const error = new Error('Invalid local origin.');
    error.status = 403;
    throw error;
  }

  const supplied = String(req.headers['x-botconnector-local-token'] || '');
  if (!supplied || supplied.length !== token.length) {
    const error = new Error('Local session token is required.');
    error.status = 401;
    throw error;
  }

  const a = Buffer.from(supplied);
  const b = Buffer.from(token);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    const error = new Error('Local session token is invalid.');
    error.status = 401;
    throw error;
  }
}

function offlineHtml({ token, host, port }) {
  const localUrl = 'http://' + host + ':' + port;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>BotConnector Local</title>
<style>
:root{color-scheme:dark;--bg:#111214;--panel:#1b1d20;--panel2:#23262a;--line:#34383d;--text:#f4f5f6;--muted:#a8adb4}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:14px/1.45 Inter,system-ui,-apple-system,Segoe UI,sans-serif}
.shell{min-height:100vh;display:grid;grid-template-columns:310px 1fr}.side{border-right:1px solid var(--line);padding:20px;background:#151719}.main{display:flex;flex-direction:column;min-width:0}
.brand{font-size:18px;font-weight:700}.badge{display:inline-flex;border:1px solid var(--line);border-radius:999px;padding:4px 8px;font-size:12px;color:var(--muted);margin-top:10px}
.card{border:1px solid var(--line);border-radius:14px;padding:14px;background:var(--panel);margin-top:14px}.label{font-size:12px;color:var(--muted);margin-bottom:6px}.value{font-weight:600;overflow-wrap:anywhere}
button,input,select,textarea{font:inherit;color:var(--text);background:var(--panel2);border:1px solid var(--line);border-radius:10px}button{cursor:pointer;padding:9px 12px;font-weight:600}button:hover{background:#2d3136}button:disabled{opacity:.45;cursor:not-allowed}
input,select{width:100%;padding:10px}.row{display:flex;gap:8px;align-items:center}.grow{flex:1}.small,.status{font-size:12px;color:var(--muted)}.status{margin-top:8px}.danger{color:#ff8d8d}.oktext{color:#83d9a5}
.top{display:flex;align-items:center;justify-content:space-between;padding:18px 22px;border-bottom:1px solid var(--line)}.top h1{font-size:16px;margin:0}.chat{flex:1;overflow:auto;padding:24px;display:flex;flex-direction:column;gap:12px}
.msg{max-width:820px;border:1px solid var(--line);border-radius:16px;padding:12px 14px;white-space:pre-wrap;overflow-wrap:anywhere}.msg.user{align-self:flex-end;background:#292d32}.msg.assistant{align-self:flex-start;background:var(--panel)}.empty{margin:auto;color:var(--muted);text-align:center}
.composer{border-top:1px solid var(--line);padding:16px 22px;background:#151719}.composer textarea{width:100%;min-height:70px;resize:vertical;padding:12px}.actions{display:flex;justify-content:flex-end;gap:8px;margin-top:8px}
@media(max-width:850px){.shell{grid-template-columns:1fr}.side{border-right:0;border-bottom:1px solid var(--line)}}
</style>
</head>
<body>
<div class="shell">
<aside class="side">
  <div class="brand">BotConnector Local</div>
  <div class="badge">OFFLINE · Localhost only</div>

  <div class="card">
    <div class="label">Runtime</div><div id="runtimeValue" class="value">Checking…</div>
    <div id="runtimeStatus" class="status"></div>
    <div class="row" style="margin-top:10px"><button id="prepareRuntime" class="grow">Prepare Runtime</button><button id="refresh">Refresh</button></div>
  </div>

  <div class="card">
    <div class="label">Hardware</div><div id="hardwareValue" class="value">Checking…</div>
    <div id="hardwareExtra" class="small"></div>
  </div>

  <div class="card">
    <div class="label">Installed models</div>
    <select id="modelSelect"><option value="">No model installed</option></select>
    <div id="modelSource" class="small" style="margin-top:6px"></div>
    <div id="modelStatus" class="status"></div>
    <div class="row" style="margin-top:10px">
      <button id="refreshModels" class="grow">Refresh models</button>
      <button id="deleteModel">Delete model</button>
    </div>
    <div class="row" style="margin-top:8px">
      <button id="loadModel" class="grow">Load</button>
      <button id="unloadModel">Unload</button>
    </div>
  </div>

  <div class="card">
    <div class="label">Download model</div>
    <select id="recommended">
      <option value="">Choose a recommended model…</option>
      <option value="Qwen/Qwen2.5-1.5B-Instruct-GGUF">Qwen2.5 1.5B Instruct</option>
      <option value="Qwen/Qwen2.5-3B-Instruct-GGUF">Qwen2.5 3B Instruct</option>
      <option value="Qwen/Qwen2.5-Coder-3B-Instruct-GGUF">Qwen2.5 Coder 3B</option>
      <option value="Qwen/Qwen2.5-7B-Instruct-GGUF">Qwen2.5 7B Instruct</option>
    </select>
    <input id="downloadModelId" placeholder="Or enter a model/repository ID" style="margin-top:8px">
    <button id="downloadModel" style="width:100%;margin-top:8px">Download</button>
    <div id="downloadStatus" class="status">Internet is needed only for new downloads or runtime installation.</div>
  </div>

  <div class="small" style="margin-top:14px">Local UI: __LOCAL_URL__<br>Model files and inference stay on this device.</div>
</aside>

<main class="main">
  <div class="top"><h1>Local Chat · OFFLINE</h1><div class="small">Localhost only · no cloud AI provider is used for inference.</div></div>
  <div id="chat" class="chat"><div class="empty">Choose an installed model, then start chatting locally.</div></div>
  <div class="composer">
    <textarea id="prompt" placeholder="Message your local model…"></textarea>
    <div class="actions"><button id="stop" disabled>Stop</button><button id="send">Send</button></div>
    <div id="chatStatus" class="status"></div>
  </div>
</main>
</div>

<script>
const TOKEN=__TOKEN__;
const headers={'content-type':'application/json','x-botconnector-local-token':TOKEN};
let models=[];let messages=[];let activeRequestId='';let busy=false;
const q=id=>document.getElementById(id);
function status(id,text,kind=''){const el=q(id);el.textContent=text||'';el.className='status '+kind}
async function api(path,init={}){const response=await fetch(path,{...init,headers:{...headers,...(init.headers||{})},cache:'no-store'});const payload=await response.json().catch(()=>({}));if(!response.ok)throw new Error(payload?.error?.message||payload?.message||('HTTP '+response.status));return payload}
function selected(){return models.find(m=>m.path===q('modelSelect').value)||null}
function updateSelectedModel(){
  const current=selected();
  const unavailable=!current||current.runnable===false;
  q('modelSource').textContent=current?('Source: '+(current.source||current.runtime||current.recipe||'local')):'';
  q('deleteModel').disabled=!current||current.deletable===false;
  q('deleteModel').title=current?.deletable===false?'This model is read-only until its source runtime is available.':'';
  q('loadModel').disabled=unavailable;
  q('unloadModel').disabled=unavailable;
  q('send').disabled=unavailable;
  q('prompt').disabled=unavailable;
  q('loadModel').title=current?.runnable===false?'Start the source runtime before loading this model.':'';
  q('send').title=current?.runnable===false?'Start the source runtime before chatting with this model.':'';
}
function render(){const chat=q('chat');chat.innerHTML='';if(!messages.length){const e=document.createElement('div');e.className='empty';e.textContent='Choose an installed model, then start chatting locally.';chat.appendChild(e);return}for(const m of messages){const e=document.createElement('div');e.className='msg '+m.role;e.textContent=m.content||'';chat.appendChild(e)}chat.scrollTop=chat.scrollHeight}
async function refresh(){
  try{
    const [s,mp]=await Promise.all([api('/api/status'),api('/api/models')]);const r=s.runtime||{};const h=s.hardware||{};
    q('runtimeValue').textContent=r.available?(r.runtime||'Local runtime'):'Not ready';status('runtimeStatus',r.available?'Ready':(r.message||'Runtime is not prepared.'),r.available?'oktext':'');
    q('hardwareValue').textContent=h.cpu||'Unknown CPU';const gpu=[...(h.nvidia||[]),...(h.amd||[]),...(h.intel||[])][0];q('hardwareExtra').textContent=[h.ramGb?h.ramGb+' GB RAM':'',gpu?.name||'',h.npu?.name?'NPU: '+h.npu.name:''].filter(Boolean).join(' · ');
    models=Array.isArray(mp.models)?mp.models:[];const sel=q('modelSelect');const prev=sel.value;sel.innerHTML='';
    if(!models.length){const o=document.createElement('option');o.value='';o.textContent='No model installed';sel.appendChild(o)}else for(const m of models){const o=document.createElement('option');o.value=m.path;const src=m.source||m.runtime||m.recipe||'local';o.textContent=(m.name||m.id||m.path)+' · '+src;sel.appendChild(o)}
    if(models.some(m=>m.path===prev))sel.value=prev;
    updateSelectedModel();
    status('modelStatus',models.length?models.length+' local model(s) detected':'No local model detected yet.');
  }catch(e){status('runtimeStatus',String(e.message||e),'danger')}
}
async function prepareRuntime(){
  q('prepareRuntime').disabled=true;status('runtimeStatus','Preparing managed llama.cpp runtime…');
  try{const start=await api('/api/runtime/install',{method:'POST',body:JSON.stringify({backend:'auto'})});for(;;){const job=await api('/api/runtime/install/status',{method:'POST',body:JSON.stringify({id:start.id})});status('runtimeStatus','Runtime install: '+(job.status||'working')+(job.percent!=null?' '+job.percent+'%':''));
    if(job.status==='completed')break;if(job.status==='failed'||job.status==='cancelled')throw new Error(job.error||('Runtime install '+job.status));await new Promise(r=>setTimeout(r,1000))}await refresh()
  }catch(e){status('runtimeStatus',String(e.message||e),'danger')}finally{q('prepareRuntime').disabled=false}
}
async function downloadModel(){
  const id=(q('downloadModelId').value.trim()||q('recommended').value.trim());if(!id)return;q('downloadModel').disabled=true;status('downloadStatus','Preparing download…');
  try{const st=(await api('/api/status')).runtime||{};if(!st.available)await prepareRuntime();const start=await api('/api/models/pull',{method:'POST',body:JSON.stringify({model:id})});
    for(;;){const job=await api('/api/models/pull/status',{method:'POST',body:JSON.stringify({id:start.id})});status('downloadStatus','Download: '+(job.status||'working')+(job.percent!=null?' '+job.percent+'%':''));
      if(job.status==='completed')break;if(job.status==='failed'||job.status==='cancelled')throw new Error(job.error||('Download '+job.status));await new Promise(r=>setTimeout(r,1000))}
    q('downloadModelId').value='';q('recommended').value='';await refresh();status('downloadStatus','Download completed.','oktext')
  }catch(e){status('downloadStatus',String(e.message||e),'danger')}finally{q('downloadModel').disabled=false}
}
async function modelAction(action){const m=selected();if(!m)return;if(m.runnable===false){status('modelStatus','Start the source runtime before using this model.','danger');return}status('modelStatus',(action==='load'?'Loading':'Unloading')+' model…');try{await api('/api/models/'+action,{method:'POST',body:JSON.stringify({model:m.id,runtime:m.runtime})});status('modelStatus',action==='load'?'Model loaded.':'Model unloaded.','oktext');await refresh()}catch(e){status('modelStatus',String(e.message||e),'danger')}}
async function deleteSelectedModel(){
  const m=selected();if(!m)return;
  if(m.deletable===false){status('modelStatus','This model is read-only until its source runtime is available.','danger');return}
  if(!confirm('Delete '+(m.name||m.id)+' from '+(m.runtime||'local runtime')+'?'))return;
  q('deleteModel').disabled=true;status('modelStatus','Deleting model…');
  try{await api('/api/models/delete',{method:'POST',body:JSON.stringify({model:m.id,runtime:m.runtime})});status('modelStatus','Model deleted.','oktext');await refresh()}
  catch(e){status('modelStatus',String(e.message||e),'danger')}
}
async function send(){if(busy)return;const m=selected();const text=q('prompt').value.trim();if(!m||!text)return;if(m.runnable===false){status('chatStatus','Start the source runtime before chatting with this model.','danger');return}busy=true;q('send').disabled=true;q('stop').disabled=false;q('prompt').value='';messages.push({role:'user',content:text});render();activeRequestId=crypto.randomUUID();status('chatStatus','Generating locally…');
  try{const result=await api('/api/chat',{method:'POST',body:JSON.stringify({model:m.id,runtime:m.runtime,messages,request_id:activeRequestId})});messages.push({role:'assistant',content:String(result.content||'')});render();status('chatStatus','Local response complete.','oktext')}catch(e){status('chatStatus',String(e.message||e),'danger')}finally{busy=false;activeRequestId='';q('stop').disabled=true;updateSelectedModel()}}
async function stop(){if(!activeRequestId)return;try{await api('/api/chat/cancel',{method:'POST',body:JSON.stringify({id:activeRequestId})})}catch{}status('chatStatus','Generation cancelled.')}
q('refresh').onclick=refresh;q('refreshModels').onclick=refresh;q('prepareRuntime').onclick=prepareRuntime;q('downloadModel').onclick=downloadModel;q('recommended').onchange=()=>{if(q('recommended').value)q('downloadModelId').value=q('recommended').value};q('modelSelect').onchange=updateSelectedModel;q('loadModel').onclick=()=>modelAction('load');q('unloadModel').onclick=()=>modelAction('unload');q('deleteModel').onclick=deleteSelectedModel;q('send').onclick=send;q('stop').onclick=stop;q('prompt').addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();send()}});refresh();
</script>
</body>
</html>`
    .replace('__TOKEN__', JSON.stringify(token))
    .replace('__LOCAL_URL__', localUrl);
}

function openBrowser(url) {
  try {
    let command;
    let args;
    if (process.platform === 'win32') {
      command = 'cmd.exe';
      args = ['/d', '/s', '/c', 'start', '""', url];
    } else if (process.platform === 'darwin') {
      command = 'open';
      args = [url];
    } else {
      command = 'xdg-open';
      args = [url];
    }
    const child = spawn(command, args, { detached: true, stdio: 'ignore', windowsHide: true });
    child.unref();
    return true;
  } catch {
    return false;
  }
}

async function startOfflineServer({
  localAi,
  detectHardware,
  host = DEFAULT_HOST,
  port = DEFAULT_PORT,
  open = true,
} = {}) {
  if (!localAi) throw new Error('Local AI runtime is required.');
  if (!detectHardware) throw new Error('Hardware detector is required.');

  const token = crypto.randomBytes(32).toString('base64url');
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url || '/', 'http://' + host + ':' + port);
      if (req.method === 'GET' && url.pathname === '/') {
        const address = server.address();
        const actualPort = typeof address === 'object' && address ? address.port : port;
        sendHtml(res, offlineHtml({ token, host, port: actualPort }));
        return;
      }
      if (!url.pathname.startsWith('/api/')) {
        sendJson(res, 404, { error: { message: 'Not found.' } });
        return;
      }

      const address = server.address();
      const actualPort = typeof address === 'object' && address ? address.port : port;
      requireLocalApi(req, token, host, actualPort);

      if (req.method === 'GET' && url.pathname === '/api/status') {
        const [runtime, hardware] = await Promise.all([localAi.status(), detectHardware()]);
        sendJson(res, 200, { runtime, hardware, mode: 'offline-local' });
        return;
      }
      if (req.method === 'GET' && url.pathname === '/api/models') {
        sendJson(res, 200, { models: await localAi.listModels() });
        return;
      }

      const body = req.method === 'POST' ? await readJson(req) : {};
      if (req.method === 'POST' && url.pathname === '/api/runtime/install') {
        sendJson(res, 200, await localAi.startRuntimeInstall(body.backend || 'auto'));
        return;
      }
      if (req.method === 'POST' && url.pathname === '/api/runtime/install/status') {
        sendJson(res, 200, localAi.runtimeJobStatus(body.id));
        return;
      }
      if (req.method === 'POST' && url.pathname === '/api/models/pull') {
        sendJson(res, 200, await localAi.startPull(body.model));
        return;
      }
      if (req.method === 'POST' && url.pathname === '/api/models/pull/status') {
        sendJson(res, 200, localAi.jobStatus(body.id));
        return;
      }
      if (req.method === 'POST' && url.pathname === '/api/models/load') {
        sendJson(res, 200, await localAi.loadModel(body.model, body.runtime));
        return;
      }
      if (req.method === 'POST' && url.pathname === '/api/models/unload') {
        sendJson(res, 200, await localAi.unloadModel(body.model, body.runtime));
        return;
      }
      if (req.method === 'POST' && url.pathname === '/api/models/delete') {
        sendJson(res, 200, await localAi.deleteModel(body.model, body.runtime));
        return;
      }
      if (req.method === 'POST' && url.pathname === '/api/chat') {
        sendJson(res, 200, await localAi.chat(body));
        return;
      }
      if (req.method === 'POST' && url.pathname === '/api/chat/cancel') {
        sendJson(res, 200, localAi.cancelChat(body.id));
        return;
      }

      sendJson(res, 404, { error: { message: 'Not found.' } });
    } catch (error) {
      sendJson(res, Number(error?.status || 500), {
        error: { message: String(error?.message || error) },
      });
    }
  });

  await new Promise((resolve, reject) => {
    const onError = (error) => reject(error);
    server.once('error', onError);
    server.listen(port, host, () => {
      server.off('error', onError);
      resolve();
    });
  });

  const address = server.address();
  const actualPort = typeof address === 'object' && address ? address.port : port;
  const url = 'http://' + host + ':' + actualPort;
  if (open) openBrowser(url);

  return {
    host,
    port: actualPort,
    url,
    token,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

module.exports = {
  DEFAULT_HOST,
  DEFAULT_PORT,
  MAX_BODY_BYTES,
  startOfflineServer,
  openBrowser,
  offlineHtml,
  requireLocalApi,
};
