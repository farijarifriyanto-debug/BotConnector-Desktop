'use strict';

const { renderMarkdown } = require('./local-markdown.cjs');

const STYLE = `
:root{
  color-scheme:dark;
  --bg:#0b0d10;
  --sidebar:#0d0f12;
  --surface:#111419;
  --surface-2:#171b21;
  --surface-3:#1c2128;
  --line:#242a32;
  --line-soft:#1b2026;
  --text:#f4f6f8;
  --muted:#8b949e;
  --muted-2:#626b76;
  --accent:#f4f6f8;
  --accent-text:#0b0d10;
  --danger:#ff8182;
  --ok:#7dd3a6;
  --warn:#e9c46a;
  --focus:#7c8cff;
  --user:#1a1f26;
  --code:#080a0d;
  --shadow:0 24px 70px rgba(0,0,0,.34);
}
[data-theme=light]{
  color-scheme:light;
  --bg:#ffffff;
  --sidebar:#f8f9fa;
  --surface:#ffffff;
  --surface-2:#f4f5f6;
  --surface-3:#eceff2;
  --line:#dfe3e7;
  --line-soft:#eceff2;
  --text:#15181c;
  --muted:#66707a;
  --muted-2:#8b949e;
  --accent:#15181c;
  --accent-text:#fff;
  --danger:#c33c3c;
  --ok:#257a4d;
  --warn:#9a6c14;
  --focus:#5566e8;
  --user:#f0f2f4;
  --code:#f5f6f8;
  --shadow:0 24px 70px rgba(20,25,30,.12);
}
*{box-sizing:border-box}
html,body{height:100%}
body{
  margin:0;
  overflow:hidden;
  background:var(--bg);
  color:var(--text);
  font:14px/1.55 Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
  -webkit-font-smoothing:antialiased;
}
button,input,select,textarea{font:inherit;color:inherit}
button{cursor:pointer}
button:disabled{opacity:.45;cursor:not-allowed}
[hidden]{display:none!important}
button:focus-visible,input:focus-visible,select:focus-visible,textarea:focus-visible{
  outline:2px solid color-mix(in srgb,var(--focus) 70%,transparent);
  outline-offset:2px;
}
svg{display:block}
.app{
  height:100%;
  display:grid;
  grid-template-columns:260px minmax(0,1fr);
  background:var(--bg);
}
.sidebar{
  min-height:0;
  background:var(--sidebar);
  border-right:1px solid var(--line-soft);
  display:flex;
  flex-direction:column;
}
.sidebarHead{
  padding:16px 14px 12px;
}
.brandRow{
  display:flex;
  align-items:center;
  gap:10px;
  min-height:32px;
  padding:0 4px 12px;
}
.brandMark{
  width:28px;height:28px;border-radius:8px;
  display:grid;place-items:center;
  background:var(--text);color:var(--bg);
  font-size:11px;font-weight:800;letter-spacing:-.02em;
}
.brandCopy{min-width:0}
.brand{
  font-size:14px;
  font-weight:730;
  letter-spacing:-.01em;
  line-height:1.2;
}
.brandSub{
  margin-top:2px;
  color:var(--muted-2);
  font-size:10.5px;
  line-height:1.2;
}
.newchat{
  width:100%;
  border:1px solid var(--line);
  background:var(--surface);
  border-radius:11px;
  min-height:40px;
  padding:0 12px;
  display:flex;
  align-items:center;
  gap:9px;
  color:var(--text);
  text-align:left;
  font-weight:610;
  transition:.16s ease;
}
.newchat:hover{background:var(--surface-2);border-color:color-mix(in srgb,var(--line) 65%,var(--text))}
.iconBox{
  width:24px;height:24px;display:grid;place-items:center;color:var(--muted);
}
.iconBox svg{width:16px;height:16px;stroke:currentColor}
.searchWrap{
  position:relative;
  margin-top:10px;
}
.searchIcon{
  position:absolute;left:10px;top:50%;transform:translateY(-50%);
  color:var(--muted-2);pointer-events:none;
}
.searchIcon svg{width:14px;height:14px;stroke:currentColor}
.search{
  width:100%;
  min-height:36px;
  border:0;
  background:transparent;
  border-radius:9px;
  padding:0 10px 0 32px;
  color:var(--text);
  outline:0;
}
.search::placeholder{color:var(--muted-2)}
.search:hover,.search:focus{background:var(--surface-2)}
.sideSectionLabel{
  padding:8px 16px 6px;
  color:var(--muted-2);
  font-size:10px;
  font-weight:700;
  letter-spacing:.08em;
  text-transform:uppercase;
}
.history{
  overflow:auto;
  padding:0 8px 10px;
  flex:1;
  scrollbar-width:thin;
  scrollbar-color:var(--line) transparent;
}
.item{
  position:relative;
  display:flex;
  align-items:center;
  border-radius:9px;
  margin:1px 0;
  min-height:36px;
}
.item:hover,.item.active{background:var(--surface-2)}
.item .title{
  flex:1;
  min-width:0;
  border:0;
  background:transparent;
  padding:8px 76px 8px 10px;
  text-align:left;
  white-space:nowrap;
  overflow:hidden;
  text-overflow:ellipsis;
  color:color-mix(in srgb,var(--text) 88%,var(--muted));
}
.item.active .title{color:var(--text)}
.item .mini{
  position:absolute;
  right:6px;
  visibility:hidden;
  border:0;
  background:transparent;
  color:var(--muted-2);
  padding:5px;
  border-radius:7px;
  width:28px;height:28px;
  display:grid;place-items:center;
}
.item .mini svg{width:14px;height:14px;stroke:currentColor}
.item .mini.rename{right:34px}
.item:hover .mini,.item.active .mini{visibility:visible}
.item .mini:hover{background:var(--surface-3);color:var(--text)}
.sideBottom{
  border-top:1px solid var(--line-soft);
  padding:8px;
  display:grid;
  gap:2px;
}
.sideBottom button{
  border:0;
  background:transparent;
  color:var(--muted);
  text-align:left;
  padding:8px 10px;
  border-radius:8px;
  min-height:36px;
  display:flex;
  align-items:center;
  gap:9px;
}
.sideBottom button:hover{background:var(--surface-2);color:var(--text)}
.sideBottom svg{width:16px;height:16px;stroke:currentColor}
.main{min-width:0;min-height:0;display:flex;flex-direction:column;position:relative}
.topbar{
  height:58px;
  flex:0 0 58px;
  border-bottom:1px solid var(--line-soft);
  display:flex;
  align-items:center;
  gap:10px;
  padding:0 18px;
  background:color-mix(in srgb,var(--bg) 88%,transparent);
  backdrop-filter:blur(14px);
  z-index:4;
}
.modelControl{
  min-width:0;
  display:flex;
  align-items:center;
  gap:8px;
}
.modelLabel{
  color:var(--muted-2);
  font-size:10px;
  font-weight:700;
  letter-spacing:.08em;
  text-transform:uppercase;
}
.topbar select{
  max-width:min(520px,52vw);
  min-height:36px;
  background:transparent;
  border:0;
  border-radius:9px;
  padding:0 30px 0 9px;
  font-weight:650;
  letter-spacing:-.01em;
  text-overflow:ellipsis;
}
.topbar select:hover{background:var(--surface-2)}
.pill{
  border:1px solid var(--line);
  border-radius:999px;
  min-height:26px;
  padding:0 9px;
  display:inline-flex;
  align-items:center;
  gap:6px;
  color:var(--muted);
  font-size:11px;
  white-space:nowrap;
}
.pillDot{width:6px;height:6px;border-radius:50%;background:var(--ok)}
.pill.right{margin-left:auto}
.modelActions{display:flex;gap:6px;align-items:center}
.modelLoadState{min-height:30px;display:inline-flex;align-items:center;padding:0 9px;border:1px solid var(--line);border-radius:999px;color:var(--muted);font-size:10.5px;font-weight:650;white-space:nowrap}
.modelLoadState.loaded{border-color:color-mix(in srgb,var(--ok) 40%,var(--line));background:color-mix(in srgb,var(--ok) 8%,transparent);color:var(--ok)}
.modelLoadState.unloaded{color:var(--muted)}
.activeModelPill{max-width:220px;overflow:hidden;text-overflow:ellipsis}
.fitGrid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin-bottom:12px}
.fitMetric{border:1px solid var(--line);border-radius:11px;background:var(--bg);padding:11px;min-width:0}
.fitMetric span{display:block;color:var(--muted);font-size:9.5px;font-weight:700;letter-spacing:.07em;text-transform:uppercase;margin-bottom:4px}
.fitMetric strong{display:block;font-size:12px;font-weight:650;overflow-wrap:anywhere}
.fitUseCase{min-height:36px;background:var(--surface-2);border:1px solid var(--line);border-radius:9px;padding:0 10px}
.connectBtn{margin-left:auto;border-radius:999px;min-height:30px;padding:0 11px;font-size:11px}
.connectBtn.connected{border-color:color-mix(in srgb,var(--ok) 40%,var(--line));color:var(--ok)}
.connectBtn.paired{border-color:color-mix(in srgb,var(--warn) 40%,var(--line));color:var(--warn)}
.chat{
  flex:1;
  overflow:auto;
  padding:36px max(22px,calc((100% - 820px)/2)) 160px;
  scrollbar-width:thin;
  scrollbar-color:var(--line) transparent;
}
.empty{
  min-height:calc(100vh - 260px);
  display:flex;
  flex-direction:column;
  justify-content:center;
  align-items:center;
  max-width:720px;
  margin:0 auto;
  text-align:center;
  color:var(--muted);
}
.emptyMark{
  width:42px;height:42px;border-radius:13px;
  display:grid;place-items:center;
  margin-bottom:18px;
  border:1px solid var(--line);
  background:linear-gradient(180deg,var(--surface-2),var(--surface));
  color:var(--text);
  font-size:12px;font-weight:800;
}
.empty h1{
  color:var(--text);
  font-size:30px;
  line-height:1.15;
  letter-spacing:-.035em;
  margin:0 0 8px;
  font-weight:720;
}
.emptyLead{max-width:520px;font-size:13px;color:var(--muted)}
.quickGrid{
  width:100%;
  display:grid;
  grid-template-columns:repeat(2,minmax(0,1fr));
  gap:9px;
  margin-top:24px;
}
.quick{
  border:1px solid var(--line);
  background:var(--surface);
  color:var(--text);
  border-radius:12px;
  padding:13px 14px;
  min-height:58px;
  text-align:left;
  transition:.16s ease;
}
.quick:hover{background:var(--surface-2);transform:translateY(-1px)}
.quick strong{display:block;font-size:12.5px;margin-bottom:2px}
.quick span{display:block;color:var(--muted);font-size:11.5px}
.msg{margin:0 0 28px}
.msg.user{display:flex;flex-direction:column;align-items:flex-end}
.msg.user .body{
  background:var(--user);
  border:1px solid color-mix(in srgb,var(--line) 70%,transparent);
  border-radius:16px 16px 4px 16px;
  padding:10px 14px;
  max-width:min(78%,640px);
  white-space:pre-wrap;
  overflow-wrap:anywhere;
}
.msg.assistant{max-width:100%}
.msg.assistant .who{
  display:flex;
  align-items:center;
  gap:8px;
  margin-bottom:8px;
  color:var(--muted);
  font-size:11px;
  font-weight:650;
}
.msg.assistant .who::before{
  content:"BC";
  width:22px;height:22px;border-radius:7px;
  display:grid;place-items:center;
  background:var(--text);color:var(--bg);
  font-size:8px;font-weight:800;
}
.md{overflow-wrap:anywhere;color:color-mix(in srgb,var(--text) 94%,var(--muted))}
.md p{margin:0 0 11px}
.md h1,.md h2,.md h3,.md h4{margin:18px 0 9px;line-height:1.28;letter-spacing:-.02em}
.md ul,.md ol{margin:0 0 11px;padding-left:24px}
.md code{
  background:var(--surface-2);
  border:1px solid var(--line-soft);
  border-radius:5px;
  padding:1px 5px;
  font:12.5px ui-monospace,SFMono-Regular,Consolas,monospace;
}
.md .code{
  border:1px solid var(--line);
  border-radius:12px;
  margin:0 0 14px;
  overflow:hidden;
  background:var(--code);
}
.md .codeHead{
  display:flex;justify-content:space-between;align-items:center;
  background:var(--surface-2);
  border-bottom:1px solid var(--line);
  padding:6px 10px;
  font-size:11px;color:var(--muted);
}
.md .codeHead button{border:0;background:transparent;color:var(--muted);padding:3px 6px;border-radius:6px}
.md .codeHead button:hover{background:var(--surface-3);color:var(--text)}
.md pre{margin:0;padding:13px;overflow:auto;background:var(--code)}
.md pre code{background:transparent;border:0;padding:0}
.md table{border-collapse:collapse;margin:0 0 12px;display:block;overflow:auto}
.md th,.md td{border:1px solid var(--line);padding:7px 10px;text-align:left}
.md th{background:var(--surface-2)}
.md blockquote{margin:0 0 10px;padding:2px 12px;border-left:2px solid var(--muted-2);color:var(--muted)}
.md a{color:inherit;text-decoration-color:var(--muted-2)}
.md hr{border:0;border-top:1px solid var(--line)}
.think{
  border:1px solid var(--line);
  border-radius:10px;
  padding:7px 10px;
  margin:0 0 10px;
  color:var(--muted);
  font-size:12px;
  background:var(--surface);
}
.think summary{cursor:pointer;font-weight:620}
.actions{
  display:flex;
  gap:3px;
  align-items:center;
  min-height:28px;
  margin-top:4px;
  color:var(--muted-2);
  font-size:11px;
}
.actions button{
  border:0;
  background:transparent;
  color:var(--muted-2);
  padding:4px 7px;
  border-radius:7px;
}
.actions button:hover{background:var(--surface-2);color:var(--text)}
.responseStats{margin-left:3px;color:var(--muted-2);font-variant-numeric:tabular-nums}
.send:disabled{opacity:.35;background:var(--surface-3);border-color:var(--line);color:var(--muted-2)}
.error{color:var(--danger)}
.cursor::after{content:"";display:inline-block;width:2px;height:1em;margin-left:3px;vertical-align:-2px;background:var(--text);animation:blink 1s steps(2) infinite}
@keyframes blink{50%{opacity:0}}
.composerWrap{
  position:absolute;
  left:0;right:0;bottom:0;
  padding:16px max(18px,calc((100% - 820px)/2)) 18px;
  background:linear-gradient(180deg,transparent 0%,var(--bg) 24%,var(--bg) 100%);
  z-index:5;
}
.composer{
  border:1px solid var(--line);
  background:color-mix(in srgb,var(--surface) 96%,transparent);
  border-radius:20px;
  padding:9px 10px 8px;
  box-shadow:0 12px 34px rgba(0,0,0,.18);
  transition:border-color .16s ease,box-shadow .16s ease;
}
.composer:focus-within{
  border-color:color-mix(in srgb,var(--line) 40%,var(--text));
  box-shadow:0 16px 48px rgba(0,0,0,.24);
}
.composer.drag{border-color:var(--focus);box-shadow:0 0 0 3px color-mix(in srgb,var(--focus) 15%,transparent)}
.composer textarea{
  width:100%;
  min-height:48px;
  max-height:220px;
  resize:none;
  background:transparent;
  border:0;
  outline:0;
  padding:7px 9px 4px;
  line-height:1.55;
}
.composer textarea::placeholder{color:var(--muted-2)}
.bar{display:flex;gap:6px;align-items:center;padding:2px 2px 0}
.btn{
  border:1px solid var(--line);
  background:transparent;
  border-radius:9px;
  min-height:34px;
  padding:0 10px;
  display:inline-flex;
  align-items:center;
  justify-content:center;
  gap:7px;
  color:var(--muted);
  transition:.14s ease;
}
.btn:hover{background:var(--surface-2);color:var(--text)}
.btn svg{width:15px;height:15px;stroke:currentColor}
.btn.toolBtn.active{
  border-color:color-mix(in srgb,var(--focus) 45%,var(--line));
  background:color-mix(in srgb,var(--focus) 10%,transparent);
  color:color-mix(in srgb,var(--text) 90%,var(--focus));
}
.send{
  margin-left:auto;
  width:34px;
  padding:0;
  border-radius:10px;
  background:var(--accent);
  color:var(--accent-text);
  border-color:var(--accent);
}
.send:hover{background:color-mix(in srgb,var(--accent) 84%,var(--muted));color:var(--accent-text)}
.hint{font-size:10.5px;color:var(--muted-2);text-align:center;margin-top:7px}
.attachments{display:flex;flex-wrap:wrap;gap:6px;padding:0 5px}
.chip{
  border:1px solid var(--line);
  background:var(--surface-2);
  border-radius:9px;
  padding:5px 8px;
  font-size:11px;
  color:var(--muted);
}
.chip button{border:0;background:transparent;color:inherit;padding:0 0 0 6px}
.overlay{
  position:fixed;inset:0;background:rgba(0,0,0,.46);
  opacity:0;visibility:hidden;
  transition:.18s ease;
  z-index:20;
  backdrop-filter:blur(2px);
}
.overlay.open{opacity:1;visibility:visible}
.panel{
  position:fixed;
  right:12px;top:12px;bottom:12px;
  width:min(500px,calc(100vw - 24px));
  background:var(--surface);
  border:1px solid var(--line);
  border-radius:16px;
  padding:18px;
  overflow:auto;
  transform:translateX(calc(100% + 24px));
  transition:.2s ease;
  z-index:21;
  box-shadow:var(--shadow);
}
.panel.open{transform:none}
.panelHead{
  position:sticky;
  top:-18px;
  z-index:2;
  margin:-18px -18px 14px;
  padding:16px 18px 12px;
  background:color-mix(in srgb,var(--surface) 94%,transparent);
  border-bottom:1px solid var(--line-soft);
  backdrop-filter:blur(12px);
}
.panel h2{margin:0;font-size:18px;letter-spacing:-.02em}
.panelLead{margin-top:4px;color:var(--muted);font-size:11.5px}
.card{
  border:1px solid var(--line);
  background:var(--bg);
  border-radius:12px;
  padding:13px;
  margin:10px 0;
}
.card h3{margin:0 0 8px;font-size:12.5px;letter-spacing:-.01em}
.row{display:flex;gap:8px;align-items:center}
.row>.grow{flex:1;min-width:0}
.muted{color:var(--muted);font-size:11.5px}
.card input,.card textarea,.card select{
  width:100%;
  background:var(--surface-2);
  border:1px solid var(--line);
  border-radius:9px;
  padding:8px 9px;
}
.model{
  display:flex;
  gap:7px;
  align-items:center;
  border-top:1px solid var(--line-soft);
  padding:9px 0;
}
.model:first-of-type{border-top:0}
.model .name{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.fit,.tag{
  font-size:9.5px;
  border-radius:999px;
  padding:2px 7px;
  border:1px solid var(--line);
  color:var(--muted);
}
.fit.great{color:var(--ok)}.fit.ok{color:var(--text)}.fit.warn{color:var(--warn)}
.small{min-height:30px;padding:0 8px;font-size:11px}
.toolList{display:grid;gap:8px;margin-top:10px}
.toolRow{
  border:1px solid var(--line);
  border-radius:11px;
  padding:11px;
  background:var(--bg);
  transition:.15s ease;
}
.toolRow:hover{border-color:color-mix(in srgb,var(--line) 65%,var(--text))}
.toolTop{display:flex;gap:10px;align-items:flex-start}
.toolTop input{width:auto;margin-top:4px;accent-color:var(--text)}
.toolMain{flex:1;min-width:0}
.toolName{font-weight:650;font-size:12.5px}
.toolDesc{color:var(--muted);font-size:11px;margin-top:2px}
.toolMeta{display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin-top:8px}
.tag.execute{color:var(--warn)}.tag.read{color:var(--ok)}
.approve{margin-left:auto}
.toolTrace{display:grid;gap:7px;margin:0 0 12px}
.toolCall{
  border:1px solid var(--line);
  border-radius:10px;
  background:var(--surface);
  overflow:hidden;
}
.toolCall summary{
  display:flex;align-items:center;gap:8px;
  cursor:pointer;
  padding:8px 10px;
  list-style:none;
}
.toolCall summary::-webkit-details-marker{display:none}
.toolCall summary::before{
  content:"";
  width:7px;height:7px;border-radius:50%;background:var(--muted-2);
}
.toolCallName{font-weight:620;flex:1;font-size:11.5px}
.toolState{font-size:10.5px;color:var(--muted)}
.toolState.done{color:var(--ok)}
.toolState.error{color:var(--danger)}
.toolState.running{color:var(--warn)}
.toolCall:has(.toolState.done) summary::before{background:var(--ok)}
.toolCall:has(.toolState.error) summary::before{background:var(--danger)}
.toolCall:has(.toolState.running) summary::before{background:var(--warn)}
.toolPayload{border-top:1px solid var(--line);padding:9px 10px}
.toolPayload strong{display:block;font-size:10px;color:var(--muted);margin:0 0 4px;text-transform:uppercase;letter-spacing:.06em}
.toolPayload pre{
  margin:0 0 8px;
  white-space:pre-wrap;
  overflow-wrap:anywhere;
  font-size:10.5px;
  color:var(--muted);
  background:var(--code);
  padding:8px;
  border-radius:7px;
}
.mcpServer{display:flex;align-items:center;gap:8px;border-top:1px solid var(--line-soft);padding:8px 0}
.mcpServer:first-child{border-top:0}
.mcpServer .grow{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
@media(max-width:900px){
  .app{grid-template-columns:220px minmax(0,1fr)}
}
.mobileMenu{display:none}
@media(max-width:760px){
  body{overflow:hidden}
  .app{grid-template-columns:1fr}
  .sidebar{
    position:fixed;
    inset:0 auto 0 0;
    width:min(300px,88vw);
    display:flex;
    transform:translateX(-102%);
    transition:transform .2s ease;
    z-index:23;
    box-shadow:var(--shadow);
  }
  .sidebar.mobileOpen{transform:none}
  .mobileMenu{display:grid;width:34px;padding:0}
  .chat{padding:26px 14px 150px}
  .composerWrap{padding:14px 10px 12px}
  .pill{display:none}
  .modelLabel{display:none}
  .topbar{padding:0 10px}
  .modelControl{flex:1;min-width:0}
  .modelActions{display:none}
  .activeModelPill{display:none}
  #openDeviceFit{display:none}
  .connectBtn{width:34px;padding:0;margin-left:auto;flex:0 0 34px}
  .connectBtn span:last-child{display:none}
  .topbar select{width:100%;max-width:calc(100vw - 104px)}
  .msg.user .body{max-width:92%}
  .empty{min-height:calc(100vh - 230px)}
  .quickGrid{grid-template-columns:1fr}
}
`

// Runs in the browser. Kept as a real function so `node --check` and the tests see it; embedded via toString().
// The disk copy wins, except for what this page did before it arrived (e.g. a message sent right after
// opening a new port): chats created since `since` are added, and the chat still streaming is kept.
// Older chats only in this browser's storage are not revived, so a chat deleted on another port stays deleted.
function mergeChatStates(disk, local, since, keepId) {
  const diskIds = new Set(disk.chats.map((c) => c.id));
  const fresh = local.chats.filter((c) => !diskIds.has(c.id) && c.messages.length && (c.id === keepId || c.createdAt >= since));
  const kept = local.chats.find((c) => c.id === keepId && diskIds.has(c.id));
  const chats = [...fresh, ...disk.chats.map((c) => (kept && c.id === kept.id ? kept : c))];
  const mine = fresh.some((c) => c.id === local.active) || (kept && kept.id === local.active);
  return { state: { ...disk, chats, active: mine ? local.active : disk.active }, changed: fresh.length > 0 || !!kept };
}

function app(TOKEN, renderMarkdown, mergeChatStates) {
  const HEADERS = { 'content-type': 'application/json', 'x-botconnector-local-token': TOKEN };
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const iconSvg = (name) => ({
    edit: '<svg viewBox="0 0 24 24" fill="none" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>',
    trash: '<svg viewBox="0 0 24 24" fill="none" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v5M14 11v5"/></svg>',
    send: '<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 19V5"/><path d="m6 11 6-6 6 6"/></svg>',
    stop: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="7" y="7" width="10" height="10" rx="2"/></svg>',
  }[name] || '');
  const load = (key, fallback) => { try { return JSON.parse(localStorage.getItem(key)) || fallback; } catch { return fallback; } };
  const save = (key, value) => localStorage.setItem(key, JSON.stringify(value));

  let state = load('botconnector-local-chats-v1', { active: null, chats: [] });
  let settings = load('botconnector-local-settings-v1', { system: '', temperature: 0.7, theme: 'dark', model: '', tools: [] });
  if (!Array.isArray(settings.tools)) settings.tools = [];
  let models = [];
  let runtimeState = null;
  let hardwareState = {};
  let webAppStatus = { paired: false, connection: 'DISCONNECTED', origin: 'https://app.botconnector.id' };
  let tools = [];
  let mcpServers = [];
  let approvedOnce = new Set();
  let attachments = [];
  let streaming = null; // { requestId, controller, chatId, message }
  let filter = '';

  // The disk copy (via /api/chats) is the source of truth; localStorage is only a fast first paint.
  let diskTimer = 0;
  const pageOpenedAt = Date.now();
  let diskLoaded = false; // never write before reading: a fresh port would overwrite the history with an empty chat
  const saveToDisk = () => {
    if (!diskLoaded) return;
    clearTimeout(diskTimer);
    diskTimer = setTimeout(() => {
      fetch('/api/chats', { method: 'POST', headers: HEADERS, body: JSON.stringify({ state, settings }) }).catch(() => {});
    }, 400);
  };
  const persist = () => { save('botconnector-local-chats-v1', state); saveToDisk(); };
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
  function friendlyModelName(model) {
    const raw = String(model?.name || model?.id || 'Local model');
    const leaf = raw.includes('/') ? raw.slice(raw.lastIndexOf('/') + 1) : raw;
    return leaf
      .replace(/\.gguf$/i, '')
      .replace(/-GGUF$/i, '')
      .replace(/[_-]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }
  function modelOptionLabel(model) {
    return friendlyModelName(model) + (model?.quant ? ' · ' + model.quant : '');
  }
  function modelDetail(model) {
    return [
      String(model?.name || model?.id || '').trim(),
      model?.quant || '',
      model?.runtime || model?.source || '',
    ].filter(Boolean).join(' · ');
  }
  function modelIsLoaded(model) {
    if (!model || !runtimeState) return false;
    const loaded = Array.isArray(runtimeState.loadedModels) ? runtimeState.loadedModels.map(String) : [];
    return loaded.includes(String(model.id)) || String(runtimeState.activeModel || '') === String(model.id);
  }
  function activeLoadedModel() {
    const active = String(runtimeState?.activeModel || '');
    if (!active) return null;
    return models.find((model) => String(model.id) === active) || { id: active, name: active };
  }
  function renderModelActions() {
    const model = selectedModel();
    const loaded = modelIsLoaded(model);
    const state = $('modelLoadState');
    state.textContent = !model ? 'No model' : loaded ? 'Loaded' : 'Unloaded';
    state.classList.toggle('loaded', Boolean(model && loaded));
    state.classList.toggle('unloaded', Boolean(model && !loaded));
    $('loadSelected').hidden = !model || loaded;
    $('unloadSelected').hidden = !model || !loaded;
    $('loadSelected').disabled = !model;
    $('unloadSelected').disabled = !model;

    const active = activeLoadedModel();
    const activePill = $('activeModelPill');
    const selectedIsActive = Boolean(model && active && String(model.id) === String(active.id));
    activePill.hidden = !active || selectedIsActive;
    activePill.textContent = active && !selectedIsActive ? 'Loaded: ' + friendlyModelName(active) : '';
    activePill.title = active && !selectedIsActive ? 'Currently loaded in memory: ' + modelDetail(active) : '';
  }
  function renderWebAppStatus() {
    const connected = webAppStatus.connection === 'CONNECTED';
    const paired = Boolean(webAppStatus.paired);
    const button = $('openWebApp');
    button.classList.toggle('connected', connected);
    button.classList.toggle('paired', paired && !connected);
    button.innerHTML = '<span class="pillDot"></span><span>' + (
      connected ? 'Web App connected' : paired ? 'Web App paired' : 'Connect Web App'
    ) + '</span>';
    $('webAppState').textContent = connected
      ? 'Connected as ' + (webAppStatus.deviceName || 'this device') + '. Local AI can be used from BotConnector Web App while this session stays open.'
      : paired
        ? 'This device is already paired. BotConnector Local will reconnect to the Web App automatically when internet access is available.'
        : 'Not paired yet. Pair this device once to use its local AI from BotConnector Web App.';
    $('webAppCode').disabled = paired;
    $('pairWebApp').hidden = paired;
    $('disconnectWebApp').hidden = !paired;
    $('disconnectWebApp').textContent = paired ? 'Forget pairing' : 'Disconnect';
  }

  // ---- rendering ----
  function renderHistory() {
    const box = $('history');
    box.innerHTML = '';
    const f = filter.toLowerCase();
    for (const c of state.chats) {
      if (f && !String(c.title).toLowerCase().includes(f) && !c.messages.some((m) => String(m.content).toLowerCase().includes(f))) continue;
      const row = document.createElement('div');
      row.className = 'item' + (c.id === state.active ? ' active' : '');
      row.innerHTML = '<button class="title"></button><button class="mini rename" title="Rename chat" aria-label="Rename chat">' + iconSvg('edit') + '</button><button class="mini" title="Delete chat" aria-label="Delete chat">' + iconSvg('trash') + '</button>';
      const [title, rename, del] = row.querySelectorAll('button');
      title.textContent = c.title || 'New chat';
      title.onclick = () => { state.active = c.id; attachments = []; persist(); renderAll(); close(); };
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

  function toolTraceHtml(events) {
    if (!Array.isArray(events) || !events.length) return '';
    const calls = new Map();
    const loose = [];
    for (const event of events) {
      if (!event || !String(event.type || '').startsWith('tool.')) continue;
      if (!event.id) { loose.push(event); continue; }
      const row = calls.get(event.id) || { id: event.id, name: event.name || 'Tool', source: event.source || '', permissionClass: event.permissionClass || '', status: 'running' };
      if (event.name) row.name = event.name;
      if (event.source) row.source = event.source;
      if (event.permissionClass) row.permissionClass = event.permissionClass;
      if (event.arguments !== undefined) row.arguments = event.arguments;
      if (event.result !== undefined) row.result = event.result;
      if (event.type === 'tool.completed') row.status = 'done';
      if (event.type === 'tool.error') { row.status = 'error'; row.error = event.error || 'Tool failed.'; }
      calls.set(event.id, row);
    }
    const rows = [...calls.values()];
    for (const event of loose) {
      if (event.type === 'tool.limit') rows.push({ id: 'limit-' + rows.length, name: 'Tool limit reached', status: 'error', error: 'Maximum tool rounds: ' + event.max_calls });
      else if (event.type === 'tool.error') rows.push({ id: 'error-' + rows.length, name: event.name || 'Tool', status: 'error', error: event.error || 'Tool failed.' });
    }
    if (!rows.length) return '';
    const json = (value) => {
      try {
        const out = JSON.stringify(value, null, 2);
        return esc(out.length > 6000 ? out.slice(0, 6000) + '\n…[truncated]' : out);
      } catch { return esc(String(value)); }
    };
    return '<div class="toolTrace">' + rows.map((row) => {
      const state = row.status === 'done' ? 'Completed' : row.status === 'error' ? 'Failed' : 'Running';
      const payload = (row.arguments !== undefined ? '<strong>Input</strong><pre>' + json(row.arguments) + '</pre>' : '') +
        (row.result !== undefined ? '<strong>Result</strong><pre>' + json(row.result) + '</pre>' : '') +
        (row.error ? '<strong>Error</strong><pre>' + esc(row.error) + '</pre>' : '');
      return '<details class="toolCall"><summary><span class="toolCallName">' + esc(row.name) + '</span><span class="toolState ' + esc(row.status) + '">' + state + '</span></summary>' +
        (payload ? '<div class="toolPayload">' + payload + '</div>' : '') + '</details>';
    }).join('') + '</div>';
  }

  function messageHtml(m, index, chat) {
    if (m.role === 'user') {
      return '<div class="msg user"><div class="body">' + esc(m.content) + '</div><div class="actions">' +
        (m.files?.length ? '<span>Files: ' + esc(m.files.join(', ')) + '</span>' : '') +
        '<button data-act="copy" data-i="' + index + '">Copy</button><button data-act="edit" data-i="' + index + '">Edit</button></div></div>';
    }
    const live = streaming && streaming.message === m;
    const think = m.reasoning ? '<details class="think"' + (live && !m.content ? ' open' : '') + '><summary>Thinking</summary><div>' + esc(m.reasoning) + '</div></details>' : '';
    const body = m.error ? '<p class="error">' + esc(m.error) + '</p>' : renderMarkdown(m.content || '');
    const toolTrace = toolTraceHtml(m.toolEvents);
    const isLast = index === chat.messages.length - 1;
    const stats = m.stats ? '<span class="responseStats" title="Local generation performance">' + esc(m.stats) + '</span>' : '';
    const actions = live ? '' : '<div class="actions"><button data-act="copy" data-i="' + index + '">Copy</button>' +
      (isLast ? '<button data-act="regen" data-i="' + index + '">Regenerate</button>' : '') + stats + '</div>';
    return '<div class="msg assistant" data-i="' + index + '"><div class="who">BotConnector Local</div><div class="md' + (live ? ' cursor' : '') + '">' + think + toolTrace + body + '</div>' + actions + '</div>';
  }

  function renderChat() {
    const c = ensureChat();
    const box = $('chat');
    if (!c.messages.length) {
      box.innerHTML = '<div class="empty"><div class="emptyMark">BC</div><h1>How can I help on this device?</h1><div class="emptyLead">Choose a local model and start a conversation. Model inference runs on this computer, while optional tools are used only when you enable them.</div><div class="quickGrid"><button class="quick" data-prompt="Summarize the key points in this text:"><strong>Summarize something</strong><span>Paste text or attach a local document</span></button><button class="quick" data-prompt="Help me understand and improve this code:"><strong>Work with code</strong><span>Explain, review, or improve a snippet</span></button><button class="quick" data-prompt="Help me compare these options and their tradeoffs:"><strong>Compare options</strong><span>Structure a decision clearly</span></button><button class="quick" data-prompt="Use the selected tools when they are useful for this request:"><strong>Use local tools</strong><span>Search, run code, or call MCP when enabled</span></button></div></div>';
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
      chip.innerHTML = esc(a.name) + ' <button title="Remove file" aria-label="Remove file">Remove</button>';
      chip.querySelector('button').onclick = () => { attachments.splice(i, 1); renderAttachments(); };
      box.appendChild(chip);
    });
  }

  function renderComposer() {
    const button = $('sendBtn');
    button.innerHTML = streaming ? iconSvg('stop') : iconSvg('send');
    button.title = streaming ? 'Stop generation' : 'Send message';
    button.setAttribute('aria-label', button.title);
    button.classList.add('send');
    button.disabled = !streaming && !$('prompt').value.trim();
  }

  function renderAll() { renderHistory(); renderChat(); renderAttachments(); renderComposer(); }

  // ---- chat ----
  async function run(chat) {
    const model = selectedModel();
    if (!model) { alert('No local model selected. Open Models to download or load one.'); return; }
    const message = { role: 'assistant', content: '', reasoning: '', toolEvents: [], model: model.name || model.id };
    chat.messages.push(message);
    const history = chat.messages.slice(0, -1).map((m) => ({ role: m.role, content: m.content || '' }));
    const system = settings.system.trim() ? [{ role: 'system', content: settings.system.trim() }] : [];
    const requestId = crypto.randomUUID();
    streaming = { requestId, controller: new AbortController(), chatId: chat.id, message };
    const documentIds = attachments.map((a) => a.id);
    const selectedTools = [...new Set(settings.tools.map(String).filter(Boolean))].slice(0, 24);
    const approvedForTurn = [...approvedOnce].filter((id) => selectedTools.includes(id));
    approvedOnce = new Set();
    attachments = [];
    renderAll();
    renderTools();
    const started = performance.now();
    let firstAt = 0;
    try {
      const r = await fetch('/api/chat', {
        method: 'POST',
        headers: HEADERS,
        signal: streaming.controller.signal,
        body: JSON.stringify({
          model: model.id, runtime: model.runtime, stream: true, request_id: requestId, document_ids: documentIds,
          tool_mode: selectedTools.length ? 'auto' : 'none', tools: selectedTools, approved_tools: approvedForTurn,
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
          if (ev.tool_event) {
            message.toolEvents.push(ev.tool_event);
            renderStreaming();
            continue;
          }
          // The final "done" event repeats the whole answer; only its usage is new.
          if (!ev.done) {
            if (!firstAt && (ev.content || ev.reasoning)) firstAt = performance.now();
            if (ev.reasoning) message.reasoning += ev.reasoning;
            if (ev.content) message.content += ev.content;
          } else {
            if (!message.toolEvents.length && Array.isArray(ev.tool_events)) message.toolEvents = ev.tool_events;
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
      // Chat can auto-load the selected model. Re-read runtime state so Load/Unload
      // immediately reflects what is actually in RAM/VRAM.
      await refresh().catch(() => {});
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
    renderComposer();
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
    const quick = e.target.closest('[data-prompt]');
    if (quick && !streaming) {
      $('prompt').value = quick.dataset.prompt || '';
      autosize();
      renderComposer();
      $('prompt').focus();
      return;
    }
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
      runtimeState = s.runtime || null;
      hardwareState = s.hardware || {};
      $('runtime').textContent = s.runtime?.available ? 'Ready · ' + (s.runtime.runtime || 'local runtime') : (s.runtime?.message || 'Runtime not ready');
      $('runtimePill').innerHTML = '<span class="pillDot"></span>' + esc(s.runtime?.available ? (s.runtime.runtime || 'local runtime') : 'Runtime unavailable');
      $('prepareRuntime').hidden = Boolean(s.runtime?.available);
      const h = s.hardware || {};
      const gpu = [...(h.nvidia || []), ...(h.amd || []), ...(h.intel || [])][0];
      $('hardware').textContent = [h.cpu, h.ramGb ? h.ramGb + ' GB RAM' : '', gpu ? gpu.name : 'no GPU'].filter(Boolean).join(' · ') || 'Unknown';
      const sel = $('modelSelect');
      const want = sel.value || settings.model;
      sel.innerHTML = models.length ? '' : '<option value="">No local model — open Models</option>';
      // Embedding and rerank models are listed under Models, but they cannot chat.
      for (const x of models.filter((m) => !/embed|rerank/i.test((m.name || '') + ' ' + (m.id || '')))) {
        const o = document.createElement('option');
        o.value = x.path;
        o.textContent = modelOptionLabel(x);
        o.title = modelDetail(x);
        sel.appendChild(o);
      }
      if (models.some((x) => x.path === want)) sel.value = want;
      const current = selectedModel();
      sel.title = current ? modelDetail(current) : 'Select a local chat model';
      renderInstalled();
      renderModelActions();
      renderComposer();
    } catch (e) {
      $('runtime').textContent = String(e.message || e);
    }
  }

  async function selectedModelAction(action) {
    const model = selectedModel();
    if (!model) return;
    const modelId = String(model.id);
    const button = action === 'load' ? $('loadSelected') : $('unloadSelected');
    button.disabled = true;
    button.textContent = action === 'load' ? 'Loading…' : 'Unloading…';
    try {
      await api('/api/models/' + action, {
        method: 'POST',
        body: JSON.stringify({ model: model.id, runtime: model.runtime }),
      });
      await refresh();
      let verified = action === 'load' ? modelIsLoaded(models.find((m) => String(m.id) === modelId)) : !modelIsLoaded({ id: modelId });
      if (!verified) {
        await new Promise((resolve) => setTimeout(resolve, 180));
        await refresh();
        verified = action === 'load' ? modelIsLoaded(models.find((m) => String(m.id) === modelId)) : !modelIsLoaded({ id: modelId });
      }
      if (!verified) throw new Error(action === 'load' ? 'Model load could not be verified.' : 'Model unload could not be verified.');
    } catch (error) {
      alert(error.message || error);
    } finally {
      button.textContent = action === 'load' ? 'Load' : 'Unload';
      renderModelActions();
    }
  }

  async function loadWebAppStatus() {
    try {
      webAppStatus = await api('/api/webapp/status');
      renderWebAppStatus();
    } catch {}
  }

  async function pairWebApp() {
    const code = $('webAppCode').value.trim();
    if (!code) return;
    $('pairWebApp').disabled = true;
    $('webAppMessage').textContent = 'Connecting…';
    try {
      webAppStatus = await api('/api/webapp/pair', {
        method: 'POST',
        body: JSON.stringify({ code }),
      });
      $('webAppCode').value = '';
      $('webAppMessage').textContent = 'Connected.';
      renderWebAppStatus();
    } catch (error) {
      $('webAppMessage').textContent = String(error.message || error);
    } finally {
      $('pairWebApp').disabled = false;
    }
  }

  async function disconnectWebApp() {
    $('disconnectWebApp').disabled = true;
    try {
      webAppStatus = await api('/api/webapp/disconnect', { method: 'POST', body: '{}' });
      $('webAppMessage').textContent = 'Disconnected.';
      renderWebAppStatus();
    } catch (error) {
      $('webAppMessage').textContent = String(error.message || error);
    } finally {
      $('disconnectWebApp').disabled = false;
    }
  }

  function renderInstalled() {
    const box = $('installed');
    box.innerHTML = models.length ? '' : '<div class="muted">No local model yet. Download one below.</div>';
    for (const m of models) {
      const row = document.createElement('div');
      row.className = 'model';
      row.innerHTML = '<span class="name"></span><button class="btn small">Load</button><button class="btn small">Unload</button><button class="btn small">Delete</button>';
      row.querySelector('.name').textContent = modelOptionLabel(m);
      row.querySelector('.name').title = modelDetail(m);
      const [loadBtn, unloadBtn, delBtn] = row.querySelectorAll('button');
      const loaded = modelIsLoaded(m);
      loadBtn.hidden = loaded;
      unloadBtn.hidden = !loaded;
      const act = async (action) => {
        try {
          await api('/api/models/' + action, { method: 'POST', body: JSON.stringify({ model: m.id, runtime: m.runtime }) });
          await refresh();
        } catch (e) {
          alert(e.message);
        }
      };
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

  // ---- device fit ----
  function hardwareValue(h, key) {
    const gpu = [...(h.nvidia || []), ...(h.amd || []), ...(h.intel || [])][0] || null;
    if (key === 'cpu') return String(h.cpu || 'Unknown');
    if (key === 'ram') return h.ramGb ? Number(h.ramGb).toFixed(1) + ' GB total' + (h.freeRamGb ? ' · ' + Number(h.freeRamGb).toFixed(1) + ' GB available' : '') : 'Unknown';
    if (key === 'gpu') return gpu?.name || 'No GPU detected';
    if (key === 'vram') {
      const value = gpu?.vramGb ?? gpu?.vram_gb ?? gpu?.memoryGb ?? gpu?.memory_gb;
      return value ? Number(value).toFixed(1) + ' GB' : (gpu ? 'Shared / dynamic or not reported' : 'Not available');
    }
    if (key === 'npu') return h.npu?.name || (h.npu?.available ? 'NPU detected' : 'No NPU detected');
    if (key === 'system') return [h.platform, h.arch, h.release].filter(Boolean).join(' · ') || 'Unknown';
    if (key === 'backend') return runtimeState?.runtime || 'Not ready';
    return 'Unknown';
  }

  function renderFitHardware() {
    const h = hardwareState || {};
    const fields = {
      fitCpu: hardwareValue(h, 'cpu'),
      fitRam: hardwareValue(h, 'ram'),
      fitGpu: hardwareValue(h, 'gpu'),
      fitVram: hardwareValue(h, 'vram'),
      fitNpu: hardwareValue(h, 'npu'),
      fitSystem: hardwareValue(h, 'system'),
      fitBackend: hardwareValue(h, 'backend'),
    };
    for (const [id, value] of Object.entries(fields)) $(id).textContent = value;
  }

  async function loadDeviceFit() {
    $('fitRecommended').innerHTML = '<div class="muted">Checking models that fit this device…</div>';
    try {
      const status = await api('/api/status');
      runtimeState = status.runtime || null;
      hardwareState = status.hardware || {};
      renderFitHardware();
      const useCase = $('fitUseCase').value;
      const payload = await api('/api/catalog/recommendations', {
        method: 'POST',
        body: JSON.stringify({ query: useCase === 'general' ? '' : useCase, limit: 10 }),
      });
      renderCatalog($('fitRecommended'), payload.models || []);
    } catch (error) {
      $('fitRecommended').innerHTML = '<div class="error">' + esc(error.message || error) + '</div>';
    }
  }

  // ---- tools ----
  function renderTools() {
    const box = $('toolsList');
    if (!box) return;
    const selected = new Set(settings.tools);
    const visible = tools.filter((tool) => tool.status === 'READY');
    box.innerHTML = visible.length ? '' : '<div class="muted">No local tools are available.</div>';
    for (const tool of visible) {
      const row = document.createElement('div');
      row.className = 'toolRow';
      const permission = String(tool.permissionClass || 'READ').toUpperCase();
      const needsApproval = permission !== 'READ';
      row.innerHTML = '<div class="toolTop"><input type="checkbox"><div class="toolMain"><div class="toolName"></div><div class="toolDesc"></div><div class="toolMeta"><span class="tag"></span><span class="tag permission"></span><button class="btn small approve" type="button"></button></div></div></div>';
      const checkbox = row.querySelector('input');
      checkbox.checked = selected.has(tool.id);
      row.querySelector('.toolName').textContent = tool.name;
      row.querySelector('.toolDesc').textContent = tool.description || '';
      const tags = row.querySelectorAll('.tag');
      tags[0].textContent = tool.source || 'local';
      tags[1].textContent = permission;
      tags[1].classList.add(permission === 'READ' ? 'read' : 'execute');
      const approve = row.querySelector('.approve');
      if (!needsApproval) approve.remove();
      else {
        approve.textContent = approvedOnce.has(tool.id) ? 'Approved for next message' : 'Approve once';
        approve.onclick = () => {
          if (!checkbox.checked) {
            checkbox.checked = true;
            if (!settings.tools.includes(tool.id)) settings.tools.push(tool.id);
            persistSettings();
          }
          if (approvedOnce.has(tool.id)) approvedOnce.delete(tool.id);
          else approvedOnce.add(tool.id);
          renderTools();
        };
      }
      checkbox.onchange = () => {
        if (checkbox.checked) {
          if (!settings.tools.includes(tool.id)) settings.tools.push(tool.id);
        } else {
          settings.tools = settings.tools.filter((id) => id !== tool.id);
          approvedOnce.delete(tool.id);
        }
        persistSettings();
        renderTools();
      };
      box.appendChild(row);
    }
    const count = settings.tools.length;
    $('openTools').querySelector('.toolBtnLabel').textContent = count ? 'Tools (' + count + ')' : 'Tools';
    $('openTools').classList.toggle('active', count > 0);

    const mcp = $('mcpServers');
    mcp.innerHTML = mcpServers.length ? '' : '<div class="muted">No MCP server configured. Add servers in ~/.botconnector-device/mcp.json.</div>';
    for (const server of mcpServers) {
      const row = document.createElement('div');
      row.className = 'mcpServer';
      row.innerHTML = '<span class="grow"></span><span class="tag"></span>';
      row.querySelector('.grow').textContent = server.name || server.id;
      row.querySelector('.tag').textContent = server.status || 'UNKNOWN';
      mcp.appendChild(row);
    }
  }

  async function loadTools() {
    try {
      const [toolPayload, mcpPayload] = await Promise.all([api('/api/tools'), api('/api/mcp')]);
      tools = Array.isArray(toolPayload.tools) ? toolPayload.tools : [];
      mcpServers = Array.isArray(mcpPayload.servers) ? mcpPayload.servers : [];
      const valid = new Set(tools.map((tool) => tool.id));
      settings.tools = settings.tools.filter((id) => valid.has(id));
      persistSettings();
      renderTools();
    } catch (error) {
      tools = [];
      mcpServers = [];
      $('toolsList').innerHTML = '<div class="error">' + esc(error.message || error) + '</div>';
    }
  }

  // ---- settings ----
  function applySettings() {
    document.documentElement.dataset.theme = settings.theme;
    $('themeBtn').querySelector('span').textContent = settings.theme === 'light' ? 'Dark mode' : 'Light mode';
    $('system').value = settings.system;
    $('temperature').value = settings.temperature;
    $('tempValue').textContent = Number(settings.temperature).toFixed(1);
  }
  const persistSettings = () => { save('botconnector-local-settings-v1', settings); saveToDisk(); };

  const open = (id) => { $(id).classList.add('open'); $('overlay').classList.add('open'); };
  const close = () => {
    for (const el of document.querySelectorAll('.panel.open,.overlay.open')) el.classList.remove('open');
    $('sidebar').classList.remove('mobileOpen');
  };

  $('newChat').onclick = () => { if (streaming) return; state.active = null; attachments = []; ensureChat(); renderAll(); close(); $('prompt').focus(); };
  $('search').oninput = (e) => { filter = e.target.value; renderHistory(); };
  $('chat').onclick = onChatClick;
  $('sendBtn').onclick = send;
  $('prompt').addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(); } });
  $('prompt').addEventListener('input', () => { autosize(); renderComposer(); });
  $('attachBtn').onclick = () => $('fileInput').click();
  $('fileInput').onchange = (e) => uploadFiles([...e.target.files]).catch((err) => alert(err.message));
  $('modelSelect').onchange = () => {
    settings.model = $('modelSelect').value;
    const current = selectedModel();
    $('modelSelect').title = current ? modelDetail(current) : 'Select a local chat model';
    renderModelActions();
    persistSettings();
  };
  $('loadSelected').onclick = () => selectedModelAction('load');
  $('unloadSelected').onclick = () => selectedModelAction('unload');
  $('openModels').onclick = () => { open('modelsPanel'); refresh(); loadRecommendations(); };
  const openFit = () => { open('deviceFitPanel'); loadDeviceFit(); };
  $('openDeviceFit').onclick = openFit;
  $('openDeviceFitSide').onclick = openFit;
  $('fitScan').onclick = loadDeviceFit;
  $('fitUseCase').onchange = loadDeviceFit;
  $('openTools').onclick = () => { open('toolsPanel'); loadTools(); };
  $('openSettings').onclick = () => open('settingsPanel');
  $('openWebApp').onclick = () => { open('webAppPanel'); loadWebAppStatus(); };
  $('openBotConnectorApp').onclick = () => window.open(webAppStatus.origin || 'https://app.botconnector.id', '_blank', 'noopener,noreferrer');
  $('pairWebApp').onclick = pairWebApp;
  $('disconnectWebApp').onclick = disconnectWebApp;
  $('mobileMenu').onclick = () => { $('sidebar').classList.add('mobileOpen'); $('overlay').classList.add('open'); };
  $('overlay').onclick = close;
  window.addEventListener('focus', () => {
    if (!streaming) refresh().catch(() => {});
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && !streaming) refresh().catch(() => {});
  });
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

  async function loadFromDisk() {
    let saved;
    try { saved = await api('/api/chats'); } catch { return; } // disk unavailable: stay on browser storage only
    diskLoaded = true;
    if (saved.state && Array.isArray(saved.state.chats)) {
      const merged = mergeChatStates(saved.state, state, pageOpenedAt, streaming && streaming.chatId);
      state = merged.state;
      if (saved.settings) settings = { ...settings, ...saved.settings };
      save('botconnector-local-chats-v1', state);
      applySettings();
      ensureChat();
      renderAll();
      if (merged.changed) saveToDisk();
    } else if (state.chats.some((c) => c.messages.length)) {
      saveToDisk(); // first run of this version: move this browser's history to disk
    }
  }

  applySettings();
  ensureChat();
  renderAll();
  refresh();
  loadTools();
  loadWebAppStatus();
  setInterval(loadWebAppStatus, 4000);
  loadFromDisk();
}

function localUiHtml({ token, host, port }) {
  const localUrl = 'http://' + host + ':' + port;
  // String concatenation, not a template literal: the embedded function sources contain backticks.
  return '<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width,initial-scale=1">\n' +
    '<title>BotConnector Local</title>\n<link rel="icon" href="data:,">\n<style>' + STYLE + '</style>\n</head>\n<body>\n' +
    `<div class="app">
  <aside class="sidebar" id="sidebar">
    <div class="sidebarHead">
      <div class="brandRow">
        <div class="brandMark">BC</div>
        <div class="brandCopy">
          <div class="brand">BotConnector Local</div>
          <div class="brandSub">On-device AI workspace</div>
        </div>
      </div>
      <button class="newchat" id="newChat">
        <span class="iconBox"><svg viewBox="0 0 24 24" fill="none" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg></span>
        <span>New chat</span>
      </button>
      <div class="searchWrap">
        <span class="searchIcon"><svg viewBox="0 0 24 24" fill="none" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg></span>
        <input class="search" id="search" placeholder="Search chats">
      </div>
    </div>
    <div class="sideSectionLabel">Chats</div>
    <div class="history" id="history"></div>
    <div class="sideBottom">
      <button id="openModels"><svg viewBox="0 0 24 24" fill="none" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 6h16v12H4z"/><path d="M8 10h8M8 14h5"/></svg><span>Models</span></button>
      <button id="openDeviceFitSide"><svg viewBox="0 0 24 24" fill="none" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 17V7M8 14V10M12 18V6M16 15V9M20 12v0"/></svg><span>Device fit</span></button>
      <button id="openSettings"><svg viewBox="0 0 24 24" fill="none" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.8 1.8 0 0 0 .4 2l.1.1-2.8 2.8-.1-.1a1.8 1.8 0 0 0-2-.4 1.8 1.8 0 0 0-1 1.6v.2h-4V21a1.8 1.8 0 0 0-1-1.6 1.8 1.8 0 0 0-2 .4l-.1.1-2.8-2.8.1-.1a1.8 1.8 0 0 0 .4-2A1.8 1.8 0 0 0 3 14H2.8v-4H3a1.8 1.8 0 0 0 1.6-1 1.8 1.8 0 0 0-.4-2l-.1-.1L6.9 4l.1.1a1.8 1.8 0 0 0 2 .4A1.8 1.8 0 0 0 10 3V2.8h4V3a1.8 1.8 0 0 0 1 1.6 1.8 1.8 0 0 0 2-.4l.1-.1 2.8 2.8-.1.1a1.8 1.8 0 0 0-.4 2A1.8 1.8 0 0 0 21 10h.2v4H21a1.8 1.8 0 0 0-1.6 1Z"/></svg><span>Settings</span></button>
      <button id="themeBtn"><svg viewBox="0 0 24 24" fill="none" stroke-width="1.7" stroke-linecap="round" aria-hidden="true"><path d="M12 3a9 9 0 1 0 9 9 7 7 0 0 1-9-9Z"/></svg><span>Light mode</span></button>
    </div>
  </aside>
  <main class="main">
    <div class="topbar">
      <button class="btn mobileMenu" id="mobileMenu" aria-label="Open navigation"><svg viewBox="0 0 24 24" fill="none" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16"/></svg></button>
      <div class="modelControl">
        <span class="modelLabel">Model</span>
        <select id="modelSelect"><option value="">Detecting local models…</option></select>
      </div>
      <div class="modelActions">
        <span class="modelLoadState" id="modelLoadState">Checking</span>
        <button class="btn small" id="loadSelected" hidden>Load</button>
        <button class="btn small" id="unloadSelected" hidden>Unload</button>
      </div>
      <span class="pill activeModelPill" id="activeModelPill" hidden></span>
      <span class="pill" id="runtimePill"><span class="pillDot"></span>Checking runtime</span>
      <button class="btn" id="openDeviceFit">Device fit</button>
      <button class="btn connectBtn right" id="openWebApp"><span class="pillDot"></span><span>Connect Web App</span></button>
    </div>
    <div class="chat" id="chat"></div>
    <div class="composerWrap">
      <div class="composer" id="composer">
        <div class="attachments" id="attachments"></div>
        <textarea id="prompt" rows="1" placeholder="Message your local model"></textarea>
        <div class="bar">
          <input id="fileInput" type="file" hidden multiple accept=".txt,.md,.markdown,.csv,.json,.jsonl,.yaml,.yml,.xml,.html,.htm,.docx,.js,.ts,.tsx,.jsx,.py,.rs,.go,.java,.c,.cpp,.h,.hpp,.css,.sql,.sh,.ps1,.toml,.ini,.conf,.log">
          <button class="btn" id="attachBtn"><svg viewBox="0 0 24 24" fill="none" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m21.4 11.6-8.5 8.5a6 6 0 0 1-8.5-8.5l9.2-9.2a4 4 0 0 1 5.7 5.7l-9.2 9.2a2 2 0 0 1-2.8-2.8l8.5-8.5"/></svg><span>Attach</span></button>
          <button class="btn toolBtn" id="openTools"><svg viewBox="0 0 24 24" fill="none" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m14.7 6.3 3-3a4.2 4.2 0 0 1-5.5 5.5l-6.7 6.7a2 2 0 1 1-2.8-2.8l6.7-6.7a4.2 4.2 0 0 1 5.5-5.5l-3 3 2.8 2.8Z"/></svg><span class="toolBtnLabel">Tools</span></button>
          <button class="btn send" id="sendBtn" aria-label="Send message"></button>
        </div>
      </div>
      <div class="hint">Local model inference runs on this device. Optional connected tools run only when selected.</div>
    </div>
  </main>
</div>
<div class="overlay" id="overlay"></div>
<aside class="panel" id="modelsPanel">
  <div class="panelHead"><div class="row"><div class="grow"><h2>Models</h2><div class="panelLead">Manage local runtimes and models for this device.</div></div><button class="btn" data-close>Close</button></div></div>
  <div class="card"><h3>This device</h3><div class="muted" id="hardware">Checking…</div><div class="muted" id="runtime">Checking…</div>
    <button class="btn small" id="prepareRuntime" hidden style="margin-top:8px">Install local runtime</button></div>
  <div class="muted" id="jobStatus"></div>
  <div class="card"><h3>Installed</h3><div id="installed"></div></div>
  <div class="card"><h3>Recommended for this device</h3><div id="recommended"></div></div>
  <div class="card"><h3>Find GGUF models</h3>
    <div class="row"><input class="grow" id="catalogQuery" placeholder="Search Qwen, Gemma, Llama, or enter a repo id"><button class="btn small" id="catalogSearch">Search</button></div>
    <div id="results"></div></div>
  <div class="card"><h3>Local endpoint</h3><div class="muted">__LOCAL_URL__ · OpenAI-compatible API at /v1</div></div>
</aside>
<aside class="panel deviceFitPanel" id="deviceFitPanel">
  <div class="panelHead"><div class="row"><div class="grow"><h2>Device fit</h2><div class="panelLead">Hardware detected on this computer and local models that fit it.</div></div><button class="btn" data-close>Close</button></div></div>
  <div class="row" style="margin-bottom:10px">
    <select class="fitUseCase grow" id="fitUseCase" aria-label="Device fit use case">
      <option value="general">General</option>
      <option value="indonesia">Bahasa Indonesia</option>
      <option value="coding">Coding</option>
      <option value="reasoning">Reasoning</option>
      <option value="vision">Vision</option>
      <option value="tools">Tools</option>
    </select>
    <button class="btn" id="fitScan">Scan again</button>
  </div>
  <div class="fitGrid">
    <div class="fitMetric"><span>CPU</span><strong id="fitCpu">Checking…</strong></div>
    <div class="fitMetric"><span>RAM</span><strong id="fitRam">Checking…</strong></div>
    <div class="fitMetric"><span>GPU</span><strong id="fitGpu">Checking…</strong></div>
    <div class="fitMetric"><span>VRAM</span><strong id="fitVram">Checking…</strong></div>
    <div class="fitMetric"><span>NPU</span><strong id="fitNpu">Checking…</strong></div>
    <div class="fitMetric"><span>System</span><strong id="fitSystem">Checking…</strong></div>
    <div class="fitMetric"><span>Backend</span><strong id="fitBackend">Checking…</strong></div>
  </div>
  <div class="card"><h3>Recommended local models</h3><div class="muted" style="margin-bottom:8px">Ranked for this hardware and the selected use case. Download keeps the model on this device.</div><div id="fitRecommended"></div></div>
</aside>
<aside class="panel" id="toolsPanel">
  <div class="panelHead"><div class="row"><div class="grow"><h2>Tools</h2><div class="panelLead">Choose capabilities the local model may use.</div></div><button class="btn" data-close>Close</button></div></div>
  <div class="card"><h3>Available tools</h3><div class="muted">READ tools can run when selected. WRITE and EXECUTE tools also require one-time approval for the next message.</div><div class="toolList" id="toolsList"></div></div>
  <div class="card"><h3>MCP servers</h3><div class="muted">Local MCP servers are loaded from ~/.botconnector-device/mcp.json.</div><div id="mcpServers"></div></div>
</aside>
<aside class="panel" id="webAppPanel">
  <div class="panelHead"><div class="row"><div class="grow"><h2>Connect to Web App</h2><div class="panelLead">Use this local model from BotConnector Web App while inference continues on this device.</div></div><button class="btn" data-close>Close</button></div></div>
  <div class="card">
    <h3>1. Get a pairing code</h3>
    <div class="muted">Open BotConnector Web App, go to Devices, and choose Connect a device.</div>
    <button class="btn" id="openBotConnectorApp" style="margin-top:10px">Open BotConnector Web App</button>
  </div>
  <div class="card">
    <h3>2. Pair this device</h3>
    <div class="muted" id="webAppState"></div>
    <div class="row" style="margin-top:10px"><input class="grow" id="webAppCode" placeholder="Enter pairing code" autocomplete="off"><button class="btn" id="pairWebApp">Connect</button><button class="btn" id="disconnectWebApp" hidden>Disconnect</button></div>
    <div class="muted" id="webAppMessage" style="margin-top:8px"></div>
  </div>
  <div class="card"><h3>How it works</h3><div class="muted">The Web App becomes the interface while inference still runs on this computer. Pairing is saved for this OS user, so after sleep, restart, or hours offline, BotConnector Local reconnects automatically the next time it runs. Use Forget pairing only when you want this device to require a new pairing code.</div></div>
</aside>
<aside class="panel" id="settingsPanel">
  <div class="panelHead"><div class="row"><div class="grow"><h2>Settings</h2><div class="panelLead">Tune the local chat experience on this device.</div></div><button class="btn" data-close>Close</button></div></div>
  <div class="card"><h3>System prompt</h3><textarea id="system" rows="5" placeholder="Optional instructions for every chat, for example: Answer in Bahasa Indonesia."></textarea></div>
  <div class="card"><h3>Temperature <span class="muted" id="tempValue"></span></h3><input id="temperature" type="range" min="0" max="2" step="0.1">
    <div class="muted">Lower values are more focused. Higher values are more varied.</div></div>
  <div class="card"><h3>On-device storage</h3><div class="muted">Chat history is stored on this device. Local model inference stays on this computer. Connected tools such as Web Search may access their configured external source only when you select them.</div></div>
</aside>
`.replace('__LOCAL_URL__', localUrl) +
    '<script>\n' + renderMarkdown.toString() + '\n' + mergeChatStates.toString() + '\n(' + app.toString() + ')(' + JSON.stringify(token) + ', renderMarkdown, mergeChatStates);\n</script>\n</body>\n</html>';
}

module.exports = { localUiHtml, mergeChatStates };
