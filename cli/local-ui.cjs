'use strict';

const { renderMarkdown } = require('./local-markdown.cjs');

const STYLE = `
:root{color-scheme:dark;--bg:#0e0f11;--panel:#15171a;--panel2:#1d2024;--line:#2b2f34;--text:#f5f7fa;--muted:#9aa1aa;--accent:#f1f3f5;--accentText:#111;--danger:#ff8888;--ok:#8be6af;--warn:#f3c969;--code:#0a0b0d;--user:#23262b}
[data-theme=light]{color-scheme:light;--bg:#ffffff;--panel:#f6f7f8;--panel2:#eceef0;--line:#dcdfe3;--text:#15171a;--muted:#667079;--accent:#15171a;--accentText:#fff;--code:#f3f4f6;--user:#eef0f2}
*{box-sizing:border-box}html,body{height:100%}body{margin:0;background:var(--bg);color:var(--text);font:14px/1.55 Inter,ui-sans-serif,system-ui,-apple-system,Segoe UI,sans-serif}
button,input,select,textarea{font:inherit;color:inherit}button{cursor:pointer}button:disabled{opacity:.45;cursor:not-allowed}
.app{height:100%;display:grid;grid-template-columns:272px minmax(0,1fr)}
.sidebar{background:var(--panel);border-right:1px solid var(--line);display:flex;flex-direction:column;min-height:0}
.brand{padding:16px 16px 10px;font-size:17px;font-weight:750}
.newchat{margin:0 12px 10px;border:1px solid var(--line);background:var(--panel2);border-radius:10px;padding:9px 12px;text-align:left}
.search{margin:0 12px 8px;border:1px solid var(--line);background:var(--bg);border-radius:9px;padding:7px 10px;outline:0}
.history{overflow:auto;padding:0 8px;flex:1}
.item{display:flex;align-items:center;border-radius:9px}.item:hover,.item.active{background:var(--panel2)}
.item .title{flex:1;min-width:0;border:0;background:transparent;padding:8px 9px;text-align:left;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.item .mini{visibility:hidden;border:0;background:transparent;color:var(--muted);padding:4px 6px}.item:hover .mini,.item.active .mini{visibility:visible}
.sideBottom{border-top:1px solid var(--line);padding:8px;display:grid;gap:2px}.sideBottom button{border:0;background:transparent;text-align:left;padding:8px;border-radius:8px}.sideBottom button:hover{background:var(--panel2)}
.main{min-width:0;display:flex;flex-direction:column}
.topbar{height:56px;border-bottom:1px solid var(--line);display:flex;align-items:center;gap:10px;padding:0 16px}
.topbar select{max-width:460px;background:var(--panel2);border:1px solid var(--line);border-radius:9px;padding:7px 10px}
.pill{border:1px solid var(--line);border-radius:999px;padding:4px 9px;color:var(--muted);font-size:12px;white-space:nowrap}.pill.right{margin-left:auto}
.chat{flex:1;overflow:auto;padding:28px max(18px,calc((100% - 860px)/2))}
.empty{margin:14vh auto 0;max-width:620px;text-align:center;color:var(--muted)}.empty h1{color:var(--text);font-size:28px;margin:0 0 8px}
.msg{margin:0 0 22px}.msg.user{display:flex;flex-direction:column;align-items:flex-end}
.msg.user .body{background:var(--user);border-radius:16px;padding:9px 14px;max-width:80%;white-space:pre-wrap;overflow-wrap:anywhere}
.msg.assistant .who{font-weight:650;margin-bottom:4px}
.md{overflow-wrap:anywhere}.md p{margin:0 0 10px}.md h1,.md h2,.md h3,.md h4{margin:14px 0 8px;line-height:1.3}.md ul,.md ol{margin:0 0 10px;padding-left:24px}
.md code{background:var(--panel2);border-radius:5px;padding:1px 5px;font:13px ui-monospace,SFMono-Regular,Consolas,monospace}
.md .code{border:1px solid var(--line);border-radius:10px;margin:0 0 12px;overflow:hidden}.md .codeHead{display:flex;justify-content:space-between;align-items:center;background:var(--panel2);padding:4px 10px;font-size:12px;color:var(--muted)}
.md .codeHead button{border:0;background:transparent;color:var(--muted)}.md pre{margin:0;padding:12px;overflow:auto;background:var(--code)}.md pre code{background:transparent;padding:0}
.md table{border-collapse:collapse;margin:0 0 12px;display:block;overflow:auto}.md th,.md td{border:1px solid var(--line);padding:6px 10px;text-align:left}.md th{background:var(--panel2)}
.md blockquote{margin:0 0 10px;padding:2px 12px;border-left:3px solid var(--line);color:var(--muted)}.md a{color:inherit}.md hr{border:0;border-top:1px solid var(--line)}
.think{border:1px solid var(--line);border-radius:10px;padding:6px 12px;margin:0 0 10px;color:var(--muted);font-size:13px}.think summary{cursor:pointer}
.actions{display:flex;gap:4px;align-items:center;margin-top:2px;color:var(--muted);font-size:12px}.actions button{border:0;background:transparent;color:var(--muted);padding:3px 6px;border-radius:6px}.actions button:hover{background:var(--panel2);color:var(--text)}
.error{color:var(--danger)}.cursor::after{content:'▍';animation:blink 1s steps(2) infinite}@keyframes blink{50%{opacity:0}}
.composerWrap{padding:10px max(14px,calc((100% - 860px)/2)) 16px}
.composer{border:1px solid var(--line);background:var(--panel);border-radius:18px;padding:8px 10px}.composer.drag{outline:2px dashed var(--muted)}
.composer textarea{width:100%;min-height:44px;max-height:240px;resize:none;background:transparent;border:0;outline:0;padding:6px}
.bar{display:flex;gap:8px;align-items:center}.btn{border:1px solid var(--line);background:var(--panel2);border-radius:9px;padding:7px 11px}
.send{margin-left:auto;background:var(--accent);color:var(--accentText);border-color:var(--accent)}
.hint{font-size:11px;color:var(--muted);text-align:center;margin-top:6px}
.attachments{display:flex;flex-wrap:wrap;gap:6px}.chip{border:1px solid var(--line);background:var(--panel2);border-radius:999px;padding:3px 8px;font-size:12px;color:var(--muted)}.chip button{border:0;background:transparent;color:inherit}
.overlay{position:fixed;inset:0;background:#0007;display:none;z-index:20}.overlay.open{display:block}
.panel{position:fixed;right:0;top:0;bottom:0;width:min(520px,94vw);background:var(--panel);border-left:1px solid var(--line);padding:18px;overflow:auto;transform:translateX(100%);transition:.18s;z-index:21}.panel.open{transform:none}
.panel h2{margin:0}.card{border:1px solid var(--line);background:var(--bg);border-radius:12px;padding:12px;margin:12px 0}.card h3{margin:0 0 8px;font-size:14px}
.row{display:flex;gap:8px;align-items:center}.row>.grow{flex:1;min-width:0}.muted{color:var(--muted);font-size:12px}
.card input,.card textarea,.card select{width:100%;background:var(--panel2);border:1px solid var(--line);border-radius:8px;padding:8px}
.model{display:flex;gap:8px;align-items:center;border-top:1px solid var(--line);padding:8px 0}.model:first-of-type{border-top:0}.model .name{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.fit{font-size:11px;border-radius:999px;padding:1px 7px;border:1px solid var(--line)}.fit.great{color:var(--ok)}.fit.ok{color:var(--text)}.fit.warn{color:var(--warn)}
.small{padding:5px 9px;font-size:12px}
@media(max-width:760px){.app{grid-template-columns:1fr}.sidebar{display:none}.chat{padding:20px 12px}.composerWrap{padding:8px}.pill{display:none}.msg.user .body{max-width:92%}}
`;

// Runs in the browser. Kept as a real function so `node --check` and the tests see it; embedded via toString().
function app(TOKEN, renderMarkdown) {
  const HEADERS = { 'content-type': 'application/json', 'x-botconnector-local-token': TOKEN };
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const load = (key, fallback) => { try { return JSON.parse(localStorage.getItem(key)) || fallback; } catch { return fallback; } };
  const save = (key, value) => localStorage.setItem(key, JSON.stringify(value));

  let state = load('botconnector-local-chats-v1', { active: null, chats: [] });
  let settings = load('botconnector-local-settings-v1', { system: '', temperature: 0.7, theme: 'dark', model: '' });
  let models = [];
  let attachments = [];
  let streaming = null; // { requestId, controller, chatId, message }
  let filter = '';

  const persist = () => save('botconnector-local-chats-v1', state);
  const activeChat = () => state.chats.find((c) => c.id === state.active) || null;
  function ensureChat() {
    let c = activeChat();
    if (c) return c;
    c = { id: crypto.randomUUID(), title: 'New chat', createdAt: Date.now(), messages: [] };
    state.chats.unshift(c);
    state.active = c.id;
    persist();
    return c;
  }
  async function api(path, init = {}) {
    const r = await fetch(path, { ...init, headers: { ...HEADERS, ...(init.headers || {}) }, cache: 'no-store' });
    const p = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(p?.error?.message || p?.message || 'HTTP ' + r.status);
    return p;
  }
  const selectedModel = () => models.find((m) => m.path === $('modelSelect').value) || null;

  // ---- rendering ----
  function renderHistory() {
    const box = $('history');
    box.innerHTML = '';
    const f = filter.toLowerCase();
    for (const c of state.chats) {
      if (f && !String(c.title).toLowerCase().includes(f) && !c.messages.some((m) => String(m.content).toLowerCase().includes(f))) continue;
      const row = document.createElement('div');
      row.className = 'item' + (c.id === state.active ? ' active' : '');
      row.innerHTML = '<button class="title"></button><button class="mini" title="Rename">✎</button><button class="mini" title="Delete">🗑</button>';
      const [title, rename, del] = row.querySelectorAll('button');
      title.textContent = c.title || 'New chat';
      title.onclick = () => { state.active = c.id; attachments = []; persist(); renderAll(); };
      rename.onclick = () => {
        const name = prompt('Chat name', c.title);
        if (name && name.trim()) { c.title = name.trim().slice(0, 80); persist(); renderHistory(); }
      };
      del.onclick = () => {
        if (!confirm('Delete "' + c.title + '"?')) return;
        state.chats = state.chats.filter((x) => x.id !== c.id);
        if (state.active === c.id) state.active = state.chats[0]?.id || null;
        persist();
        renderAll();
      };
      box.appendChild(row);
    }
  }

  function messageHtml(m, index, chat) {
    if (m.role === 'user') {
      return '<div class="msg user"><div class="body">' + esc(m.content) + '</div><div class="actions">' +
        (m.files?.length ? '<span>📎 ' + esc(m.files.join(', ')) + '</span>' : '') +
        '<button data-act="copy" data-i="' + index + '">Copy</button><button data-act="edit" data-i="' + index + '">Edit</button></div></div>';
    }
    const live = streaming && streaming.message === m;
    const think = m.reasoning ? '<details class="think"' + (live && !m.content ? ' open' : '') + '><summary>Thinking</summary><div>' + esc(m.reasoning) + '</div></details>' : '';
    const body = m.error ? '<p class="error">' + esc(m.error) + '</p>' : renderMarkdown(m.content || '');
    const isLast = index === chat.messages.length - 1;
    const stats = m.stats ? '<span>' + esc(m.stats) + '</span>' : '';
    const actions = live ? '' : '<div class="actions"><button data-act="copy" data-i="' + index + '">Copy</button>' +
      (isLast ? '<button data-act="regen" data-i="' + index + '">Regenerate</button>' : '') + stats + '</div>';
    return '<div class="msg assistant" data-i="' + index + '"><div class="who">◇ BotConnector Local</div><div class="md' + (live ? ' cursor' : '') + '">' + think + body + '</div>' + actions + '</div>';
  }

  function renderChat() {
    const c = ensureChat();
    const box = $('chat');
    if (!c.messages.length) {
      box.innerHTML = '<div class="empty"><h1>BotConnector Local</h1><div>Private local chat with files, local models, and offline conversation history.</div></div>';
      return;
    }
    const nearBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 80;
    box.innerHTML = c.messages.map((m, i) => messageHtml(m, i, c)).join('');
    if (nearBottom || streaming) box.scrollTop = box.scrollHeight;
  }

  let frame = 0;
  function renderStreaming() {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      const c = activeChat();
      if (!streaming || !c || c.id !== streaming.chatId) return;
      const i = c.messages.indexOf(streaming.message);
      const el = document.querySelector('.msg.assistant[data-i="' + i + '"]');
      if (!el) return renderChat();
      el.outerHTML = messageHtml(streaming.message, i, c);
      const box = $('chat');
      box.scrollTop = box.scrollHeight;
    });
  }

  function renderAttachments() {
    const box = $('attachments');
    box.innerHTML = '';
    attachments.forEach((a, i) => {
      const chip = document.createElement('span');
      chip.className = 'chip';
      chip.innerHTML = esc(a.name) + ' <button title="Remove">×</button>';
      chip.querySelector('button').onclick = () => { attachments.splice(i, 1); renderAttachments(); };
      box.appendChild(chip);
    });
  }

  function renderComposer() {
    $('sendBtn').textContent = streaming ? 'Stop' : 'Send';
    $('sendBtn').classList.toggle('send', !streaming);
  }

  function renderAll() { renderHistory(); renderChat(); renderAttachments(); renderComposer(); }

  // ---- chat ----
  async function run(chat) {
    const model = selectedModel();
    if (!model) { alert('No local model selected. Open Models to download or load one.'); return; }
    const message = { role: 'assistant', content: '', reasoning: '', model: model.name || model.id };
    chat.messages.push(message);
    const history = chat.messages.slice(0, -1).map((m) => ({ role: m.role, content: m.content || '' }));
    const system = settings.system.trim() ? [{ role: 'system', content: settings.system.trim() }] : [];
    const requestId = crypto.randomUUID();
    streaming = { requestId, controller: new AbortController(), chatId: chat.id, message };
    const documentIds = attachments.map((a) => a.id);
    attachments = [];
    renderAll();
    const started = performance.now();
    let firstAt = 0;
    try {
      const r = await fetch('/api/chat', {
        method: 'POST',
        headers: HEADERS,
        signal: streaming.controller.signal,
        body: JSON.stringify({
          model: model.id, runtime: model.runtime, stream: true, request_id: requestId, document_ids: documentIds,
          options: { temperature: Number(settings.temperature) }, messages: [...system, ...history],
        }),
      });
      if (!r.ok) { const p = await r.json().catch(() => ({})); throw new Error(p?.error?.message || 'HTTP ' + r.status); }
      const reader = r.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let cut;
        while ((cut = buffer.indexOf('\n\n')) >= 0) {
          const line = buffer.slice(0, cut);
          buffer = buffer.slice(cut + 2);
          if (!line.startsWith('data: ')) continue;
          const ev = JSON.parse(line.slice(6));
          if (ev.error) throw new Error(ev.error.message);
          // The final "done" event repeats the whole answer; only its usage is new.
          if (!ev.done) {
            if (!firstAt && (ev.content || ev.reasoning)) firstAt = performance.now();
            if (ev.reasoning) message.reasoning += ev.reasoning;
            if (ev.content) message.content += ev.content;
          } else {
            const secs = (performance.now() - (firstAt || started)) / 1000;
            const tokens = Number(ev.usage?.completion_tokens) || Math.round((message.content.length + message.reasoning.length) / 4);
            message.stats = tokens + ' tokens · ' + (secs > 0 ? (tokens / secs).toFixed(1) : '–') + ' tok/s';
          }
          renderStreaming();
        }
      }
    } catch (error) {
      const stopped = streaming?.stopped || error?.name === 'AbortError';
      if (!stopped) message.error = String(error?.message || error);
      else if (!message.content) message.content = '_Stopped._';
    } finally {
      streaming = null;
      persist();
      renderAll();
    }
  }

  async function send() {
    if (streaming) return stop();
    const text = $('prompt').value.trim();
    if (!text) return;
    const chat = ensureChat();
    if (!chat.messages.length) chat.title = text.slice(0, 48);
    chat.messages.push({ role: 'user', content: text, files: attachments.map((a) => a.name) });
    $('prompt').value = '';
    autosize();
    persist();
    await run(chat);
  }

  async function stop() {
    if (!streaming) return;
    streaming.stopped = true;
    await api('/api/chat/cancel', { method: 'POST', body: JSON.stringify({ id: streaming.requestId }) }).catch(() => {});
    streaming?.controller.abort();
  }

  async function onChatClick(e) {
    const copyCode = e.target.closest('[data-copy]');
    if (copyCode) return copy(copyCode.closest('.code').querySelector('pre').textContent, copyCode);
    const btn = e.target.closest('[data-act]');
    if (!btn || streaming) return;
    const chat = activeChat();
    const i = Number(btn.dataset.i);
    const m = chat.messages[i];
    if (btn.dataset.act === 'copy') return copy(m.content, btn);
    if (btn.dataset.act === 'regen') { chat.messages.splice(i); persist(); return run(chat); }
    if (btn.dataset.act === 'edit') {
      const text = prompt('Edit message', m.content);
      if (text == null || !text.trim()) return;
      chat.messages.splice(i);
      chat.messages.push({ role: 'user', content: text.trim() });
      persist();
      return run(chat);
    }
  }

  async function copy(text, btn) {
    try { await navigator.clipboard.writeText(text); } catch {
      const t = document.createElement('textarea');
      t.value = text;
      document.body.appendChild(t);
      t.select();
      document.execCommand('copy');
      t.remove();
    }
    const old = btn.textContent;
    btn.textContent = 'Copied';
    setTimeout(() => { btn.textContent = old; }, 1200);
  }

  function autosize() { const t = $('prompt'); t.style.height = 'auto'; t.style.height = Math.min(240, t.scrollHeight) + 'px'; }

  async function uploadFiles(files) {
    for (const f of files) {
      const data = await new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(String(r.result).split(',')[1] || '');
        r.onerror = reject;
        r.readAsDataURL(f);
      });
      attachments.push(await api('/api/documents', { method: 'POST', body: JSON.stringify({ name: f.name, mime: f.type, base64: data }) }));
    }
    renderAttachments();
  }

  // ---- models & runtime ----
  async function refresh() {
    try {
      const [s, m] = await Promise.all([api('/api/status'), api('/api/models')]);
      models = Array.isArray(m.models) ? m.models : [];
      $('runtime').textContent = s.runtime?.available ? 'Ready · ' + (s.runtime.runtime || 'local runtime') : (s.runtime?.message || 'Runtime not ready');
      $('runtimePill').textContent = s.runtime?.available ? (s.runtime.runtime || 'local') : 'no runtime';
      $('prepareRuntime').hidden = Boolean(s.runtime?.available);
      const h = s.hardware || {};
      const gpu = [...(h.nvidia || []), ...(h.amd || []), ...(h.intel || [])][0];
      $('hardware').textContent = [h.cpu, h.ramGb ? h.ramGb + ' GB RAM' : '', gpu ? gpu.name : 'no GPU'].filter(Boolean).join(' · ') || 'Unknown';
      const sel = $('modelSelect');
      const want = sel.value || settings.model;
      sel.innerHTML = models.length ? '' : '<option value="">No local model — open Models</option>';
      for (const x of models) {
        const o = document.createElement('option');
        o.value = x.path;
        o.textContent = (x.name || x.id) + (x.quant ? ' · ' + x.quant : '') + ' · ' + (x.source || x.runtime || 'local');
        sel.appendChild(o);
      }
      if (models.some((x) => x.path === want)) sel.value = want;
      renderInstalled();
    } catch (e) {
      $('runtime').textContent = String(e.message || e);
    }
  }

  function renderInstalled() {
    const box = $('installed');
    box.innerHTML = models.length ? '' : '<div class="muted">No local model yet. Download one below.</div>';
    for (const m of models) {
      const row = document.createElement('div');
      row.className = 'model';
      row.innerHTML = '<span class="name"></span><button class="btn small">Load</button><button class="btn small">Unload</button><button class="btn small">Delete</button>';
      row.querySelector('.name').textContent = (m.name || m.id) + (m.quant ? ' · ' + m.quant : '');
      const [loadBtn, unloadBtn, delBtn] = row.querySelectorAll('button');
      const act = (action) => api('/api/models/' + action, { method: 'POST', body: JSON.stringify({ model: m.id, runtime: m.runtime }) }).then(refresh).catch((e) => alert(e.message));
      loadBtn.onclick = () => act('load');
      unloadBtn.onclick = () => act('unload');
      delBtn.onclick = () => { if (confirm('Delete ' + (m.name || m.id) + ' from this device?')) act('delete'); };
      box.appendChild(row);
    }
  }

  function renderCatalog(box, list) {
    box.innerHTML = list.length ? '' : '<div class="muted">Nothing found.</div>';
    for (const m of list) {
      const level = m.compatibility?.level || 'unknown';
      const row = document.createElement('div');
      row.className = 'model';
      row.innerHTML = '<span class="name"></span><span class="fit ' + esc(level) + '">' + esc(level) + '</span><button class="btn small">Download</button>';
      const size = m.compatibility?.paramsB ? ' · ' + m.compatibility.paramsB + 'B' : '';
      row.querySelector('.name').textContent = m.id + size;
      row.querySelector('.name').title = m.id;
      row.querySelector('button').onclick = () => download(m.id);
      box.appendChild(row);
    }
  }

  async function loadRecommendations() {
    $('recommended').innerHTML = '<div class="muted">Checking what fits this device…</div>';
    try { renderCatalog($('recommended'), (await api('/api/catalog/recommendations', { method: 'POST', body: '{}' })).models || []); }
    catch (e) { $('recommended').innerHTML = '<div class="muted">' + esc(e.message) + '</div>'; }
  }

  async function searchCatalog() {
    const text = $('catalogQuery').value.trim();
    if (!text) return;
    if (text.includes('/') && !text.includes(' ')) return download(text);
    $('results').innerHTML = '<div class="muted">Searching…</div>';
    try { renderCatalog($('results'), ((await api('/api/catalog/search?q=' + encodeURIComponent(text))).models || []).slice(0, 20)); }
    catch (e) { $('results').innerHTML = '<div class="muted">' + esc(e.message) + '</div>'; }
  }

  async function poll(start, statusPath, label) {
    for (;;) {
      const s = await api(statusPath, { method: 'POST', body: JSON.stringify({ id: start.id }) });
      $('jobStatus').textContent = label + ': ' + (s.status || 'working') + (s.percent != null ? ' ' + s.percent + '%' : '');
      if (s.status === 'completed') return;
      if (s.status === 'failed' || s.status === 'cancelled') throw new Error(s.error || s.status);
      await new Promise((r) => setTimeout(r, 1000));
    }
  }

  async function prepareRuntime() {
    try {
      await poll(await api('/api/runtime/install', { method: 'POST', body: JSON.stringify({ backend: 'auto' }) }), '/api/runtime/install/status', 'Runtime');
      await refresh();
    } catch (e) { $('jobStatus').textContent = String(e.message || e); }
  }

  async function download(id) {
    try {
      const status = await api('/api/status');
      if (!status.runtime?.available) await prepareRuntime();
      await poll(await api('/api/models/pull', { method: 'POST', body: JSON.stringify({ model: id }) }), '/api/models/pull/status', 'Download ' + id);
      $('jobStatus').textContent = id + ' is ready. Pick it in the model menu.';
      await refresh();
    } catch (e) { $('jobStatus').textContent = String(e.message || e); }
  }

  // ---- settings ----
  function applySettings() {
    document.documentElement.dataset.theme = settings.theme;
    $('themeBtn').textContent = settings.theme === 'light' ? '☾ Dark mode' : '☀ Light mode';
    $('system').value = settings.system;
    $('temperature').value = settings.temperature;
    $('tempValue').textContent = Number(settings.temperature).toFixed(1);
  }
  const persistSettings = () => save('botconnector-local-settings-v1', settings);

  const open = (id) => { $(id).classList.add('open'); $('overlay').classList.add('open'); };
  const close = () => { for (const el of document.querySelectorAll('.panel.open,.overlay.open')) el.classList.remove('open'); };

  $('newChat').onclick = () => { if (streaming) return; state.active = null; attachments = []; ensureChat(); renderAll(); $('prompt').focus(); };
  $('search').oninput = (e) => { filter = e.target.value; renderHistory(); };
  $('chat').onclick = onChatClick;
  $('sendBtn').onclick = send;
  $('prompt').addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(); } });
  $('prompt').addEventListener('input', autosize);
  $('attachBtn').onclick = () => $('fileInput').click();
  $('fileInput').onchange = (e) => uploadFiles([...e.target.files]).catch((err) => alert(err.message));
  $('modelSelect').onchange = () => { settings.model = $('modelSelect').value; persistSettings(); };
  $('openModels').onclick = () => { open('modelsPanel'); refresh(); loadRecommendations(); };
  $('openSettings').onclick = () => open('settingsPanel');
  $('overlay').onclick = close;
  for (const b of document.querySelectorAll('[data-close]')) b.onclick = close;
  $('themeBtn').onclick = () => { settings.theme = settings.theme === 'light' ? 'dark' : 'light'; persistSettings(); applySettings(); };
  $('system').oninput = (e) => { settings.system = e.target.value; persistSettings(); };
  $('temperature').oninput = (e) => { settings.temperature = Number(e.target.value); $('tempValue').textContent = settings.temperature.toFixed(1); persistSettings(); };
  $('prepareRuntime').onclick = prepareRuntime;
  $('catalogSearch').onclick = searchCatalog;
  $('catalogQuery').addEventListener('keydown', (e) => { if (e.key === 'Enter') searchCatalog(); });
  const composer = $('composer');
  for (const ev of ['dragenter', 'dragover']) composer.addEventListener(ev, (e) => { e.preventDefault(); composer.classList.add('drag'); });
  for (const ev of ['dragleave', 'drop']) composer.addEventListener(ev, (e) => { e.preventDefault(); composer.classList.remove('drag'); });
  composer.addEventListener('drop', (e) => uploadFiles([...e.dataTransfer.files]).catch((err) => alert(err.message)));

  applySettings();
  ensureChat();
  renderAll();
  refresh();
}

function localUiHtml({ token, host, port }) {
  const localUrl = 'http://' + host + ':' + port;
  // String concatenation, not a template literal: the embedded function sources contain backticks.
  return '<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width,initial-scale=1">\n' +
    '<title>BotConnector Local</title>\n<link rel="icon" href="data:,">\n<style>' + STYLE + '</style>\n</head>\n<body>\n' +
    `<div class="app">
  <aside class="sidebar">
    <div class="brand">◇ BotConnector Local</div>
    <button class="newchat" id="newChat">＋ New chat</button>
    <input class="search" id="search" placeholder="Search chats">
    <div class="history" id="history"></div>
    <div class="sideBottom">
      <button id="openModels">▦ Models</button>
      <button id="openSettings">⚙ Settings</button>
      <button id="themeBtn">☀ Light mode</button>
    </div>
  </aside>
  <main class="main">
    <div class="topbar">
      <select id="modelSelect"><option value="">Detecting local models…</option></select>
      <span class="pill" id="runtimePill">…</span>
      <span class="pill right">OFFLINE · Localhost only</span>
    </div>
    <div class="chat" id="chat"></div>
    <div class="composerWrap">
      <div class="composer" id="composer">
        <div class="attachments" id="attachments"></div>
        <textarea id="prompt" rows="1" placeholder="Message your local model…  (Enter to send, Shift+Enter for a new line)"></textarea>
        <div class="bar">
          <input id="fileInput" type="file" hidden multiple accept=".txt,.md,.markdown,.csv,.json,.jsonl,.yaml,.yml,.xml,.html,.htm,.docx,.js,.ts,.tsx,.jsx,.py,.rs,.go,.java,.c,.cpp,.h,.hpp,.css,.sql,.sh,.ps1,.toml,.ini,.conf,.log">
          <button class="btn" id="attachBtn">📎 Attach</button>
          <button class="btn send" id="sendBtn">Send</button>
        </div>
      </div>
      <div class="hint">Inference and attached document text stay on this device.</div>
    </div>
  </main>
</div>
<div class="overlay" id="overlay"></div>
<aside class="panel" id="modelsPanel">
  <div class="row"><h2 class="grow">Models</h2><button class="btn" data-close>✕</button></div>
  <div class="card"><h3>This device</h3><div class="muted" id="hardware">Checking…</div><div class="muted" id="runtime">Checking…</div>
    <button class="btn small" id="prepareRuntime" hidden style="margin-top:8px">Install local runtime</button></div>
  <div class="muted" id="jobStatus"></div>
  <div class="card"><h3>Installed</h3><div id="installed"></div></div>
  <div class="card"><h3>Recommended for this device</h3><div id="recommended"></div></div>
  <div class="card"><h3>Search Hugging Face (GGUF)</h3>
    <div class="row"><input class="grow" id="catalogQuery" placeholder="e.g. qwen, gemma, llama — or a repo id"><button class="btn small" id="catalogSearch">Search</button></div>
    <div id="results"></div></div>
  <div class="card"><h3>Local endpoint</h3><div class="muted">__LOCAL_URL__ · OpenAI-compatible API at /v1</div></div>
</aside>
<aside class="panel" id="settingsPanel">
  <div class="row"><h2 class="grow">Settings</h2><button class="btn" data-close>✕</button></div>
  <div class="card"><h3>System prompt</h3><textarea id="system" rows="5" placeholder="Optional instructions for every chat, e.g. Answer in Bahasa Indonesia."></textarea></div>
  <div class="card"><h3>Temperature <span class="muted" id="tempValue"></span></h3><input id="temperature" type="range" min="0" max="2" step="0.1">
    <div class="muted">Lower is more precise, higher is more creative.</div></div>
  <div class="card"><h3>Privacy</h3><div class="muted">Chats are saved in this browser only. Nothing is sent to BotConnector cloud from this page.</div></div>
</aside>
`.replace('__LOCAL_URL__', localUrl) +
    '<script>\n' + renderMarkdown.toString() + '\n(' + app.toString() + ')(' + JSON.stringify(token) + ', renderMarkdown);\n</script>\n</body>\n</html>';
}

module.exports = { localUiHtml };
