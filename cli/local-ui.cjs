'use strict';

function localUiHtml({ token, host, port }) {
  const localUrl = 'http://' + host + ':' + port;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>BotConnector Local</title>
<style>
:root{color-scheme:dark;--bg:#0e0f11;--panel:#15171a;--panel2:#1d2024;--line:#2b2f34;--text:#f5f7fa;--muted:#9aa1aa;--danger:#ff8888;--ok:#8be6af}
*{box-sizing:border-box}html,body{height:100%}body{margin:0;background:var(--bg);color:var(--text);font:14px/1.5 Inter,ui-sans-serif,system-ui,-apple-system,Segoe UI,sans-serif}
button,input,select,textarea{font:inherit;color:inherit}button{cursor:pointer}button:disabled{opacity:.45;cursor:not-allowed}
.app{height:100%;display:grid;grid-template-columns:270px minmax(0,1fr)}.sidebar{background:#121417;border-right:1px solid var(--line);display:flex;flex-direction:column;min-height:0}.brand{padding:16px 16px 12px;font-size:17px;font-weight:750;display:flex;gap:9px;align-items:center}
.newchat{margin:0 12px 12px;border:1px solid var(--line);background:var(--panel2);border-radius:10px;padding:10px 12px;text-align:left}.sideTitle{padding:8px 14px;color:var(--muted);font-size:11px;text-transform:uppercase;letter-spacing:.08em}
.history{overflow:auto;padding:0 8px;flex:1}.history button{width:100%;border:0;background:transparent;border-radius:9px;padding:9px;text-align:left;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.history button:hover,.history button.active{background:var(--panel2)}
.sideBottom{border-top:1px solid var(--line);padding:10px}.sideBottom button{width:100%;border:0;background:transparent;text-align:left;padding:9px;border-radius:8px}.sideBottom button:hover{background:var(--panel2)}
.main{min-width:0;display:flex;flex-direction:column}.topbar{height:58px;border-bottom:1px solid var(--line);display:flex;align-items:center;gap:10px;padding:0 16px}.topbar select{max-width:440px;background:var(--panel2);border:1px solid var(--line);border-radius:9px;padding:8px 10px}.pill{margin-left:auto;border:1px solid var(--line);border-radius:999px;padding:5px 9px;color:var(--muted);font-size:12px}
.chat{flex:1;overflow:auto;padding:30px max(18px,calc((100% - 900px)/2));display:flex;flex-direction:column;gap:18px}.empty{margin:auto;max-width:650px;text-align:center;color:var(--muted)}.empty h1{color:var(--text);font-size:28px;margin:0 0 8px}
.msg{display:grid;grid-template-columns:34px minmax(0,1fr);gap:12px}.avatar{width:34px;height:34px;border:1px solid var(--line);border-radius:9px;display:grid;place-items:center;background:var(--panel)}.bubble{min-width:0;white-space:pre-wrap;overflow-wrap:anywhere}.bubble .meta{font-size:12px;color:var(--muted);margin-bottom:4px}.bubble pre{background:#0a0b0d;border:1px solid var(--line);padding:12px;border-radius:9px;overflow:auto}
.attachments{display:flex;flex-wrap:wrap;gap:7px;margin-top:4px}.chip{border:1px solid var(--line);background:var(--panel2);border-radius:999px;padding:5px 8px;font-size:12px;color:var(--muted)}.chip button{border:0;background:transparent;color:inherit;padding:0 0 0 6px}
.composerWrap{padding:12px max(14px,calc((100% - 900px)/2)) 18px;background:linear-gradient(180deg,transparent,var(--bg) 20%)}.composer{border:1px solid var(--line);background:var(--panel);border-radius:16px;padding:10px;box-shadow:0 10px 30px #0005}.composer.drag{outline:2px dashed #777}.composer textarea{width:100%;min-height:64px;max-height:220px;resize:none;background:transparent;border:0;outline:0;padding:8px}.composerBar{display:flex;gap:8px;align-items:center}.iconBtn,.send{border:1px solid var(--line);background:var(--panel2);border-radius:9px;padding:8px 10px}.send{margin-left:auto;background:#f1f3f5;color:#111;border-color:#f1f3f5}.hint{font-size:11px;color:var(--muted);text-align:center;margin-top:7px}
.drawer{position:fixed;right:0;top:0;bottom:0;width:min(420px,92vw);background:#121417;border-left:1px solid var(--line);padding:18px;transform:translateX(100%);transition:.2s;z-index:20;overflow:auto}.drawer.open{transform:none}.drawer h2{margin:0 0 16px}.card{border:1px solid var(--line);background:var(--panel);border-radius:12px;padding:12px;margin:10px 0}.row{display:flex;gap:8px;align-items:center}.row>*{min-width:0}.grow{flex:1}.card button,.card input{background:var(--panel2);border:1px solid var(--line);border-radius:8px;padding:8px}.status{font-size:12px;color:var(--muted);margin-top:6px}
@media(max-width:760px){.app{grid-template-columns:1fr}.sidebar{display:none}.chat{padding:22px 14px}.composerWrap{padding:10px 10px 14px}.pill{display:none}}
</style>
</head>
<body>
<div class="app">
  <aside class="sidebar">
    <div class="brand">◇ BotConnector Local</div>
    <button class="newchat" id="newChat">＋ New chat</button>
    <div class="sideTitle">Chats</div>
    <div class="history" id="history"></div>
    <div class="sideBottom"><button id="openSettings">⚙ Local settings</button></div>
  </aside>
  <main class="main">
    <div class="topbar">
      <select id="modelSelect"><option value="">Detecting local models…</option></select>
      <span class="pill">OFFLINE · Localhost only</span>
    </div>
    <div class="chat" id="chat"></div>
    <div class="composerWrap">
      <div class="composer" id="composer">
        <div class="attachments" id="attachments"></div>
        <textarea id="prompt" placeholder="Message your local model…"></textarea>
        <div class="composerBar">
          <input id="fileInput" type="file" hidden multiple accept=".txt,.md,.markdown,.csv,.json,.jsonl,.yaml,.yml,.xml,.html,.htm,.docx,.js,.ts,.tsx,.jsx,.py,.rs,.go,.java,.c,.cpp,.h,.hpp,.css,.sql,.sh,.ps1,.toml,.ini,.conf,.log">
          <button class="iconBtn" id="attachBtn">📎 Attach</button>
          <button class="iconBtn" id="stopBtn" disabled>Stop</button>
          <button class="send" id="sendBtn">Send</button>
        </div>
      </div>
      <div class="hint">Inference and attached document text stay on this device.</div>
    </div>
  </main>
</div>

<aside class="drawer" id="drawer">
  <div class="row"><h2 class="grow">Local settings</h2><button class="iconBtn" id="closeSettings">✕</button></div>
  <div class="card"><b>Runtime</b><div id="runtime" class="status">Checking…</div><div class="row" style="margin-top:9px"><button id="prepareRuntime">Prepare runtime</button><button id="refresh">Refresh</button></div></div>
  <div class="card"><b>Hardware</b><div id="hardware" class="status">Checking…</div></div>
  <div class="card"><b>Models</b><div id="modelStatus" class="status"></div><div class="row" style="margin-top:9px"><button id="loadModel">Load</button><button id="unloadModel">Unload</button><button id="deleteModel">Delete</button></div></div>
  <div class="card"><b>Download model</b><input id="downloadId" style="width:100%;margin-top:8px" placeholder="Hugging Face model/repository ID"><button id="downloadModel" style="width:100%;margin-top:8px">Download</button><div id="downloadStatus" class="status"></div></div>
  <div class="card"><b>Local endpoint</b><div class="status">__LOCAL_URL__</div></div>
</aside>

<script>
const TOKEN=__TOKEN__;
const API_HEADERS={'content-type':'application/json','x-botconnector-local-token':TOKEN};
const q=id=>document.getElementById(id);
let models=[],busy=false,activeRequestId='',attachments=[];
let state=loadState();

function loadState(){try{return JSON.parse(localStorage.getItem('botconnector-local-chats-v1'))||{active:null,chats:[]}}catch{return {active:null,chats:[]}}}
function saveState(){localStorage.setItem('botconnector-local-chats-v1',JSON.stringify(state))}
function activeChat(){return state.chats.find(c=>c.id===state.active)||null}
function ensureChat(){let c=activeChat();if(c)return c;c={id:crypto.randomUUID(),title:'New chat',createdAt:Date.now(),messages:[]};state.chats.unshift(c);state.active=c.id;saveState();return c}
function newChat(){state.active=null;attachments=[];ensureChat();renderAll()}
function escapeHtml(s){return String(s||'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]))}
function renderText(s){let x=escapeHtml(s);x=x.replace(/\`\`\`([\s\S]*?)\`\`\`/g,(_,c)=>'<pre>'+c+'</pre>');return x}
function renderHistory(){const box=q('history');box.innerHTML='';for(const c of state.chats){const b=document.createElement('button');b.textContent=c.title||'New chat';b.className=c.id===state.active?'active':'';b.onclick=()=>{state.active=c.id;attachments=[];saveState();renderAll()};box.appendChild(b)}}
function renderChat(){const c=ensureChat();const box=q('chat');box.innerHTML='';if(!c.messages.length){box.innerHTML='<div class="empty"><h1>BotConnector Local</h1><div>Private local chat with files, local models, and offline conversation history.</div></div>';return}for(const m of c.messages){const row=document.createElement('div');row.className='msg';row.innerHTML='<div class="avatar">'+(m.role==='user'?'U':'◇')+'</div><div class="bubble"><div class="meta">'+(m.role==='user'?'You':'BotConnector Local')+'</div>'+renderText(m.content)+'</div>';box.appendChild(row)}box.scrollTop=box.scrollHeight}
function renderAttachments(){const box=q('attachments');box.innerHTML='';attachments.forEach((a,i)=>{const e=document.createElement('span');e.className='chip';e.innerHTML=escapeHtml(a.name)+' <button title="Remove">×</button>';e.querySelector('button').onclick=()=>{attachments.splice(i,1);renderAttachments()};box.appendChild(e)})}
function renderAll(){renderHistory();renderChat();renderAttachments()}
async function api(path,init={}){const r=await fetch(path,{...init,headers:{...API_HEADERS,...(init.headers||{})},cache:'no-store'});const p=await r.json().catch(()=>({}));if(!r.ok)throw new Error(p?.error?.message||p?.message||('HTTP '+r.status));return p}
function selected(){return models.find(m=>m.path===q('modelSelect').value)||null}

async function refresh(){
  try{
    const [s,m]=await Promise.all([api('/api/status'),api('/api/models')]);models=Array.isArray(m.models)?m.models:[];
    q('runtime').textContent=s.runtime?.available?'Ready · '+(s.runtime.runtime||'local runtime'):(s.runtime?.message||'Runtime not ready');
    const h=s.hardware||{};const gpu=[...(h.nvidia||[]),...(h.amd||[]),...(h.intel||[])][0];q('hardware').textContent=[h.cpu,h.ramGb?h.ramGb+' GB RAM':'',gpu?.name].filter(Boolean).join(' · ')||'Unknown';
    const sel=q('modelSelect'),prev=sel.value;sel.innerHTML='';if(!models.length)sel.innerHTML='<option value="">No local model detected</option>';else for(const m of models){const o=document.createElement('option');o.value=m.path;o.textContent=(m.name||m.id)+' · '+(m.source||m.runtime||'local');sel.appendChild(o)}if(models.some(m=>m.path===prev))sel.value=prev;
    q('modelStatus').textContent=models.length?models.length+' local model(s) detected':'No local model detected';
  }catch(e){q('runtime').textContent=String(e.message||e)}
}
async function uploadFiles(files){for(const f of files){const data=await new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(String(r.result).split(',')[1]||'');r.onerror=reject;r.readAsDataURL(f)});const meta=await api('/api/documents',{method:'POST',body:JSON.stringify({name:f.name,mime:f.type,base64:data})});attachments.push(meta)}renderAttachments()}
async function send(){
  if(busy)return;const model=selected(),text=q('prompt').value.trim();if(!model||!text)return;
  busy=true;q('sendBtn').disabled=true;q('stopBtn').disabled=false;q('prompt').value='';
  const c=ensureChat();if(c.messages.length===0)c.title=text.slice(0,46);c.messages.push({role:'user',content:text});saveState();renderAll();
  activeRequestId=crypto.randomUUID();
  try{
    const result=await api('/api/chat',{method:'POST',body:JSON.stringify({model:model.id,runtime:model.runtime,messages:c.messages,request_id:activeRequestId,document_ids:attachments.map(a=>a.id)})});
    c.messages.push({role:'assistant',content:String(result.content||'')});attachments=[];saveState();renderAll();
  }catch(e){c.messages.push({role:'assistant',content:'Error: '+String(e.message||e)});saveState();renderAll()}
  finally{busy=false;activeRequestId='';q('sendBtn').disabled=false;q('stopBtn').disabled=true}
}
async function modelAction(action){const m=selected();if(!m)return;await api('/api/models/'+action,{method:'POST',body:JSON.stringify({model:m.id,runtime:m.runtime})});await refresh()}
async function prepareRuntime(){q('runtime').textContent='Preparing runtime…';try{const j=await api('/api/runtime/install',{method:'POST',body:JSON.stringify({backend:'auto'})});for(;;){const s=await api('/api/runtime/install/status',{method:'POST',body:JSON.stringify({id:j.id})});q('runtime').textContent='Runtime install: '+s.status+(s.percent!=null?' '+s.percent+'%':'');if(s.status==='completed')break;if(['failed','cancelled'].includes(s.status))throw new Error(s.error||s.status);await new Promise(r=>setTimeout(r,1000))}await refresh()}catch(e){q('runtime').textContent=String(e.message||e)}}
async function downloadModel(){const id=q('downloadId').value.trim();if(!id)return;q('downloadStatus').textContent='Preparing download…';try{const j=await api('/api/models/pull',{method:'POST',body:JSON.stringify({model:id})});for(;;){const s=await api('/api/models/pull/status',{method:'POST',body:JSON.stringify({id:j.id})});q('downloadStatus').textContent='Download: '+s.status+(s.percent!=null?' '+s.percent+'%':'');if(s.status==='completed')break;if(['failed','cancelled'].includes(s.status))throw new Error(s.error||s.status);await new Promise(r=>setTimeout(r,1000))}await refresh()}catch(e){q('downloadStatus').textContent=String(e.message||e)}}

q('newChat').onclick=newChat;q('openSettings').onclick=()=>q('drawer').classList.add('open');q('closeSettings').onclick=()=>q('drawer').classList.remove('open');
q('attachBtn').onclick=()=>q('fileInput').click();q('fileInput').onchange=e=>uploadFiles([...e.target.files]).catch(err=>alert(err.message));q('sendBtn').onclick=send;
q('prompt').addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();send()}});
q('stopBtn').onclick=async()=>{if(activeRequestId)await api('/api/chat/cancel',{method:'POST',body:JSON.stringify({id:activeRequestId})}).catch(()=>{})};
q('refresh').onclick=refresh;q('prepareRuntime').onclick=prepareRuntime;q('loadModel').onclick=()=>modelAction('load');q('unloadModel').onclick=()=>modelAction('unload');q('deleteModel').onclick=()=>modelAction('delete');q('downloadModel').onclick=downloadModel;
const composer=q('composer');for(const ev of ['dragenter','dragover'])composer.addEventListener(ev,e=>{e.preventDefault();composer.classList.add('drag')});for(const ev of ['dragleave','drop'])composer.addEventListener(ev,e=>{e.preventDefault();composer.classList.remove('drag')});composer.addEventListener('drop',e=>uploadFiles([...e.dataTransfer.files]).catch(err=>alert(err.message)));
ensureChat();renderAll();refresh();
</script>
</body>
</html>`.replace('__TOKEN__', JSON.stringify(token)).replace('__LOCAL_URL__', localUrl);
}

module.exports = { localUiHtml };
