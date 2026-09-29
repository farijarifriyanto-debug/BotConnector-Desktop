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
.fitMeta{margin-top:5px;color:var(--muted);font-size:10.5px;line-height:1.45}
.fitWhy{margin-top:4px;border:0;background:transparent;color:var(--muted);padding:0;font-size:10.5px;text-decoration:underline;text-underline-offset:2px;cursor:pointer}
.fitWhy:hover{color:var(--text)}
.fitReason{margin-top:6px;padding:8px 9px;border:1px solid var(--line-soft);border-radius:8px;background:var(--surface-2);color:var(--muted);font-size:10.5px;line-height:1.5}
.fitBenchmarkMetrics{margin-top:5px;color:var(--muted);font-size:10px;line-height:1.45}
.fitBenchmarkMetrics strong{color:var(--text);font-weight:650}
.fitActionBar{display:flex;gap:8px;align-items:center;margin:0 0 8px}
.fitActionBar .fitViewLead{flex:1;min-width:0;margin:0}
.fitBenchmarkStatus{min-height:16px;margin:0 0 8px}
@media(max-width:620px){.fitActionBar{align-items:flex-start;flex-direction:column}.fitActionBar .row{width:100%}.fitActionBar .btn{flex:1}}
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
.contextStrip{
  display:flex;
  align-items:center;
  gap:7px;
  max-width:820px;
  margin:0 auto 8px;
  padding:0 2px;
}
.contextSelect{position:relative;min-width:0}
.contextButton{
  max-width:310px;
  min-height:32px;
  border:1px solid var(--line);
  background:color-mix(in srgb,var(--surface) 92%,transparent);
  color:var(--muted);
  border-radius:10px;
  padding:0 10px;
  display:flex;
  align-items:center;
  gap:7px;
  font-size:11px;
  font-weight:650;
  white-space:nowrap;
  overflow:hidden;
}
.contextButton:hover,.contextButton.active{background:var(--surface-2);color:var(--text)}
.contextButton .contextText{overflow:hidden;text-overflow:ellipsis}
.contextButton .chev{color:var(--muted-2);font-size:10px}
.contextMenu{
  position:absolute;
  left:0;
  bottom:calc(100% + 7px);
  width:min(360px,calc(100vw - 28px));
  max-height:420px;
  overflow:auto;
  border:1px solid var(--line);
  border-radius:12px;
  background:var(--surface);
  box-shadow:var(--shadow);
  padding:6px;
  display:none;
  z-index:15;
}
.contextMenu.open{display:block}
.contextMenuTitle{padding:7px 8px 5px;color:var(--muted-2);font-size:9.5px;font-weight:750;letter-spacing:.07em;text-transform:uppercase}
.contextOption{
  width:100%;
  border:0;
  background:transparent;
  color:var(--text);
  border-radius:9px;
  padding:9px 10px;
  text-align:left;
  display:grid;
  gap:2px;
}
.contextOption:hover,.contextOption.active{background:var(--surface-2)}
.contextOptionTop{display:flex;align-items:center;gap:8px;font-size:11.5px;font-weight:650}
.contextOptionTop .check{margin-left:auto;color:var(--ok)}
.contextOptionDesc{color:var(--muted);font-size:10.5px;line-height:1.35}
.contextDivider{height:1px;background:var(--line-soft);margin:5px 2px}
.permissionSelect{
  width:auto;
  max-width:170px;
  min-height:34px;
  border:1px solid var(--line);
  background:transparent;
  border-radius:9px;
  padding:0 28px 0 9px;
  color:var(--muted);
  font-size:10.5px;
  font-weight:650;
}
.permissionSelect:hover{background:var(--surface-2);color:var(--text)}
.workspaceSide{padding:0 8px 8px;display:grid;gap:2px;max-height:180px;overflow:auto}
.workspaceSideItem{
  border:0;background:transparent;color:var(--muted);border-radius:8px;
  min-height:34px;padding:7px 9px;text-align:left;display:flex;align-items:center;gap:8px;font-size:11px
}
.workspaceSideItem:hover,.workspaceSideItem.active{background:var(--surface-2);color:var(--text)}
.workspaceSideItem .folder{font-size:13px}.workspaceSideItem .workspaceSideName{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sideSectionRow{display:flex;align-items:center;justify-content:space-between}
.sideSectionAction{border:0;background:transparent;color:var(--muted-2);width:24px;height:24px;border-radius:7px;padding:0;font-size:16px}
.sideSectionAction:hover{background:var(--surface-2);color:var(--text)}
.workspaceManagerItem{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px;align-items:center;padding:9px 0;border-top:1px solid var(--line-soft)}
.workspaceManagerItem:first-child{border-top:0}
.workspaceManagerName{font-size:11.5px;font-weight:650}
.workspaceManagerPath{margin-top:2px;color:var(--muted);font-size:10px;overflow-wrap:anywhere}
.modeSummary{font-size:10px;color:var(--muted-2);margin-left:auto;white-space:nowrap}
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
.modelInfo{flex:1;min-width:0;display:grid;gap:5px}
.modelInfo .name{display:block}
.capabilities{display:flex;flex-wrap:wrap;gap:4px;min-height:17px}
.capability{
  display:inline-flex;
  align-items:center;
  min-height:18px;
  border:1px solid var(--line);
  border-radius:999px;
  padding:0 6px;
  font-size:9px;
  font-weight:650;
  line-height:1;
  color:var(--muted);
  background:var(--surface-2);
  white-space:nowrap;
}
.capability.text{color:var(--text)}
.capability.vision{color:var(--ok)}
.capability.tools{color:var(--accent)}
.capability.reasoning{color:var(--warn)}
.fitFilters{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:10px 0}
.fitFilterCard{border:1px solid var(--line);border-radius:11px;background:var(--bg);padding:11px}
.fitFilterLabel{font-size:10px;font-weight:700;color:var(--muted);margin-bottom:7px}
.fitUseCases{display:flex;gap:5px;flex-wrap:wrap}
.fitUseCaseBtn{min-height:30px;padding:0 9px;border-radius:8px;border:1px solid var(--line);background:var(--surface-2);color:var(--muted);font-size:10.5px;font-weight:650}
.fitUseCaseBtn.active{color:var(--text);background:var(--surface-3);border-color:color-mix(in srgb,var(--line) 55%,var(--text))}
.fitTabs{display:flex;gap:3px;border:1px solid var(--line);background:var(--bg);border-radius:10px;padding:3px;width:max-content;max-width:100%;margin:12px 0 9px}
.fitTab{min-height:30px;padding:0 10px;border:0;border-radius:8px;background:transparent;color:var(--muted);font-size:10.5px;font-weight:650}
.fitTab.active{background:var(--surface-3);color:var(--text)}
.fitBrowse{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px;margin-bottom:8px}
.fitBrowse input,.fitBrowse select{min-height:36px;background:var(--surface-2);border:1px solid var(--line);border-radius:9px;padding:0 10px;color:var(--text)}
.fitBrowse select{width:auto}
.fitViewLead{margin:0 0 8px}
.fit.installed,.fit.loaded{color:var(--ok)}
@media(max-width:620px){.fitFilters{grid-template-columns:1fr}.fitBrowse{grid-template-columns:1fr}.fitBrowse select{width:100%}}
.fit,.tag{
  font-size:9.5px;
  border-radius:999px;
  padding:2px 7px;
  border:1px solid var(--line);
  color:var(--muted);
}
.fit.great{color:var(--ok)}.fit.ok{color:var(--text)}.fit.warn{color:var(--warn)}

/* Device Fit — production workspace */
.deviceFitPanel{
  width:min(680px,calc(100vw - 24px));
  padding:20px;
  background:color-mix(in srgb,var(--surface) 97%,var(--bg));
}
.deviceFitPanel .panelHead{
  top:-20px;
  margin:-20px -20px 18px;
  padding:18px 20px 14px;
}
.fitHeadMeta{display:flex;align-items:center;gap:8px;margin-top:5px;color:var(--muted);font-size:10.5px}
.fitHeadMetaDot{width:5px;height:5px;border-radius:50%;background:var(--ok);box-shadow:0 0 0 3px color-mix(in srgb,var(--ok) 12%,transparent)}
.fitSection{margin:0 0 16px}
.fitSectionHead{display:flex;align-items:flex-end;justify-content:space-between;gap:12px;margin-bottom:9px}
.fitSectionTitle{font-size:11px;font-weight:720;letter-spacing:.02em;color:var(--text)}
.fitSectionHint{font-size:10.5px;color:var(--muted)}
.fitHardwareShell{
  border:1px solid var(--line);
  border-radius:14px;
  background:linear-gradient(180deg,color-mix(in srgb,var(--surface-2) 72%,var(--bg)),var(--bg));
  padding:10px;
}
.fitGrid{grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;margin:0}
.fitMetric{
  position:relative;
  min-height:88px;
  border:1px solid var(--line-soft);
  border-radius:11px;
  background:color-mix(in srgb,var(--surface) 86%,transparent);
  padding:11px 12px;
}
.fitMetric span{font-size:9px;letter-spacing:.08em;margin-bottom:7px}
.fitMetric strong{font-size:12px;line-height:1.35;font-weight:680}
.fitMetricSub{margin-top:7px;color:var(--muted);font-size:9.5px;line-height:1.3}
.fitMetricSub strong{display:inline;font-size:9.5px;color:var(--text)}
.fitHardwareMeta{
  display:flex;align-items:center;gap:8px;flex-wrap:wrap;
  margin-top:9px;padding:9px 2px 0;border-top:1px solid var(--line-soft);
}
.fitHardwareMetaItem{display:inline-flex;align-items:center;gap:6px;min-width:0;color:var(--muted);font-size:10px}
.fitHardwareMetaItem strong{color:var(--text);font-size:10.5px;font-weight:620;overflow-wrap:anywhere}
.fitHardwareMetaSep{width:1px;height:13px;background:var(--line)}
.fitFilters{grid-template-columns:minmax(0,1.35fr) minmax(250px,.9fr);gap:10px;margin:0}
.fitFilterCard{
  border:1px solid var(--line);
  border-radius:13px;
  background:var(--bg);
  padding:12px;
}
.fitFilterLabel{display:flex;align-items:center;justify-content:space-between;gap:8px;font-size:9.5px;letter-spacing:.04em;text-transform:uppercase;margin-bottom:9px}
.fitFilterHelp{font-size:9.5px;font-weight:500;letter-spacing:0;text-transform:none;color:var(--muted-2)}
.fitUseCases{gap:6px}
.fitUseCaseBtn{
  min-height:32px;padding:0 10px;border-radius:999px;
  background:transparent;border-color:var(--line);font-size:10.5px;
  transition:background .14s ease,border-color .14s ease,color .14s ease,transform .14s ease;
}
.fitUseCaseBtn:hover{background:var(--surface-2);color:var(--text);transform:translateY(-1px)}
.fitUseCaseBtn.active{
  color:var(--text);
  background:var(--surface-3);
  border-color:color-mix(in srgb,var(--text) 24%,var(--line));
  box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--text) 4%,transparent);
}
.fitUseCaseBtn.active::before{content:"✓";margin-right:5px;color:var(--ok);font-size:9px}
.fitPreferenceSegments{
  display:grid;grid-template-columns:repeat(3,minmax(0,1fr));
  gap:3px;padding:3px;
  border:1px solid var(--line);
  border-radius:10px;
  background:var(--surface-2);
}
.fitPreferenceBtn{
  min-height:32px;border:0;border-radius:7px;background:transparent;
  color:var(--muted);font-size:10.5px;font-weight:670;
  transition:background .14s ease,color .14s ease,box-shadow .14s ease;
}
.fitPreferenceBtn:hover{color:var(--text)}
.fitPreferenceBtn.active{
  color:var(--text);
  background:var(--surface);
  box-shadow:0 1px 4px color-mix(in srgb,#000 18%,transparent),inset 0 0 0 1px var(--line-soft);
}
.fitPreferenceDescription{margin-top:9px;min-height:30px;color:var(--muted);font-size:10.5px;line-height:1.4}
.fitTabs{
  width:100%;display:grid;grid-template-columns:repeat(3,minmax(0,1fr));
  gap:4px;margin:0 0 10px;padding:4px;border-radius:12px;
}
.fitTab{display:flex;align-items:center;justify-content:center;gap:7px;min-height:34px;padding:0 10px;border-radius:8px}
.fitTab.active{background:var(--surface-3);box-shadow:inset 0 0 0 1px var(--line-soft)}
.fitTabCount{
  min-width:19px;height:18px;display:inline-grid;place-items:center;
  padding:0 5px;border-radius:999px;background:var(--surface-2);
  color:var(--muted);font-size:9px;font-weight:700;
}
.fitTab.active .fitTabCount{background:var(--surface);color:var(--text)}
.fitActionBar{margin:0 0 8px;padding:0 2px}
.fitViewLead{line-height:1.45}
.fitBenchmarkStatus{min-height:0;margin:0 0 8px}
.fitBrowse{grid-template-columns:minmax(0,1fr) 168px;gap:8px;margin:0 0 10px}
.fitSearchField,.fitSortField{position:relative}
.fitSearchField svg{position:absolute;left:11px;top:50%;width:14px;height:14px;transform:translateY(-50%);stroke:var(--muted);pointer-events:none}
.fitBrowse input,.fitBrowse select{width:100%;min-height:38px;border-radius:10px;background:var(--bg);transition:border-color .14s ease,box-shadow .14s ease}
.fitBrowse input{padding-left:34px}
.fitBrowse input:focus,.fitBrowse select:focus{outline:none;border-color:color-mix(in srgb,var(--text) 28%,var(--line));box-shadow:0 0 0 3px color-mix(in srgb,var(--text) 5%,transparent)}
.fitBrowse select{appearance:none;-webkit-appearance:none;padding:0 34px 0 11px}
.fitSortChevron{position:absolute;right:11px;top:50%;transform:translateY(-50%);color:var(--muted);font-size:11px;pointer-events:none}
.fitCatalogSticky{
  position:sticky;top:76px;z-index:4;
  margin:0 -4px 10px;padding:7px 4px 8px;
  background:linear-gradient(180deg,color-mix(in srgb,var(--surface) 98%,transparent) 78%,color-mix(in srgb,var(--surface) 92%,transparent));
  backdrop-filter:blur(14px);
}
.fitBrowse{grid-template-columns:minmax(0,1fr) auto 168px}
.fitFilterField{position:relative}
.fitFilterButton{min-height:38px;display:inline-flex;align-items:center;gap:7px;padding:0 11px;white-space:nowrap}
.fitFilterCount{min-width:18px;height:18px;display:inline-grid;place-items:center;border-radius:999px;background:var(--surface-3);font-size:9px;color:var(--text)}
.fitFilterMenu{
  position:absolute;right:0;top:calc(100% + 7px);z-index:8;
  width:min(330px,calc(100vw - 48px));padding:12px;
  border:1px solid var(--line);border-radius:12px;background:var(--surface);
  box-shadow:var(--shadow);
}
.fitFilterMenuGrid{display:grid;grid-template-columns:1fr 1fr;gap:9px}
.fitFilterMenu label{display:grid;gap:5px;color:var(--muted);font-size:10px}
.fitFilterMenu select{width:100%;min-height:34px;background:var(--bg);border:1px solid var(--line);border-radius:8px;padding:0 8px;color:var(--text)}
.fitFilterChecks{display:flex;flex-wrap:wrap;gap:7px 14px;margin-top:11px;padding-top:10px;border-top:1px solid var(--line-soft)}
.fitFilterChecks label{display:flex;align-items:center;gap:7px;color:var(--text);font-size:10.5px}
.fitFilterChecks input{width:auto;accent-color:var(--text)}
.fitFilterFooter{display:flex;justify-content:space-between;align-items:center;margin-top:11px}
.fitIdentityMeta,.fitTrustMeta,.fitDownloadMeta{color:var(--muted);font-size:10.5px;line-height:1.4}
.fitIdentityMeta{font-weight:580}
.fitTrustMeta{display:flex;gap:6px;flex-wrap:wrap;align-items:center}
.fitTrustBadge,.fitConfidence{
  display:inline-flex;align-items:center;min-height:19px;padding:0 6px;border:1px solid var(--line);
  border-radius:999px;background:var(--surface-2);font-size:9px;font-weight:670;color:var(--muted)
}
.fitTrustBadge.official{color:var(--ok);border-color:color-mix(in srgb,var(--ok) 28%,var(--line))}
.fitConfidence.measured{color:var(--ok);border-color:color-mix(in srgb,var(--ok) 28%,var(--line))}
.fitDownloadMeta{margin-top:1px}
.fitRecommendationHint{
  display:grid;gap:2px;margin:1px 0 2px;padding:8px 9px;border:1px solid color-mix(in srgb,var(--ok) 24%,var(--line));
  border-radius:9px;background:color-mix(in srgb,var(--ok) 5%,var(--surface-2))
}
.fitRecommendationHint strong{font-size:10px;color:var(--text)}
.fitRecommendationHint span{font-size:9.8px;color:var(--muted);line-height:1.4}
.fitTopRecommendation{background:linear-gradient(90deg,color-mix(in srgb,var(--ok) 3%,transparent),transparent 45%)}
.fitDownloadProgress{display:grid;gap:6px;margin-top:2px;padding:8px 9px;border:1px solid var(--line-soft);border-radius:9px;background:var(--surface-2)}
.fitDownloadProgressTop{display:flex;justify-content:space-between;gap:8px;color:var(--muted);font-size:9.8px}
.fitProgressTrack{height:5px;border-radius:999px;background:var(--surface-3);overflow:hidden}
.fitProgressBar{height:100%;width:0;background:var(--text);border-radius:999px;transition:width .2s ease}
.fitCompareChoice{display:flex;align-items:center;gap:6px;color:var(--muted);font-size:10px;margin-top:2px}
.fitCompareChoice input{width:auto;accent-color:var(--text)}
.fitCompareTray{
  position:sticky;bottom:-1px;z-index:6;display:flex;align-items:center;gap:10px;
  margin:10px -4px -4px;padding:10px 12px;border:1px solid var(--line);
  border-radius:12px;background:color-mix(in srgb,var(--surface) 97%,transparent);box-shadow:0 -8px 24px color-mix(in srgb,#000 16%,transparent);backdrop-filter:blur(14px)
}
.fitCompareTray .grow{min-width:0}
.fitCompareNames{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:var(--muted);font-size:10px}
.fitComparePanel{
  position:sticky;bottom:58px;z-index:5;margin:10px -4px 0;padding:12px;
  border:1px solid var(--line);border-radius:12px;background:var(--surface);box-shadow:var(--shadow);
  max-height:50vh;overflow:auto
}
.fitCompareTable{width:100%;border-collapse:collapse;font-size:10px}
.fitCompareTable th,.fitCompareTable td{padding:8px;border-bottom:1px solid var(--line-soft);vertical-align:top;text-align:left}
.fitCompareTable th{color:var(--muted);font-weight:650;position:sticky;top:0;background:var(--surface)}
.fitCompareTable td:first-child{color:var(--muted);width:110px}
.fitStateBox{display:grid;place-items:center;text-align:center;gap:8px;min-height:190px;padding:28px;color:var(--muted)}
.fitStateBox strong{font-size:12px;color:var(--text)}
.fitSkeletonList{display:grid;gap:0}
.fitSkeleton{padding:15px 2px;border-top:1px solid var(--line-soft)}
.fitSkeleton:first-child{border-top:0}
.fitSkeletonLine{height:10px;border-radius:6px;background:linear-gradient(90deg,var(--surface-2),var(--surface-3),var(--surface-2));background-size:220% 100%;animation:fitShimmer 1.2s linear infinite}
.fitSkeletonLine.short{width:42%;margin-top:8px}.fitSkeletonLine.mid{width:68%;margin-top:8px}
@keyframes fitShimmer{to{background-position:-220% 0}}
.deviceFitPanel>.fitSection>.card{margin:0;padding:0 12px;border-radius:14px;background:var(--bg);overflow:hidden}
.deviceFitPanel .model{
  display:grid;grid-template-columns:minmax(0,1fr) auto;column-gap:14px;row-gap:8px;
  align-items:start;padding:14px 2px;border-top:1px solid var(--line-soft);
}
.deviceFitPanel .model:first-of-type{border-top:0}
.deviceFitPanel .modelInfo{gap:6px}
.deviceFitPanel .modelInfo .name{font-size:12.5px;font-weight:690;line-height:1.35;white-space:normal;overflow:visible;text-overflow:clip}
.deviceFitPanel .capabilities{gap:5px}
.deviceFitPanel .capability{min-height:20px;padding:0 7px;background:transparent}
.deviceFitPanel .fitMeta{margin-top:1px;font-size:10.5px}
.deviceFitPanel .fitBenchmarkMetrics{
  margin-top:0;padding:7px 8px;border-radius:8px;
  background:var(--surface-2);border:1px solid var(--line-soft);
}
.deviceFitPanel .model>.fit{
  grid-column:2;grid-row:1;
  justify-self:end;
  min-height:22px;display:inline-flex;align-items:center;
  padding:0 8px;font-weight:700;background:var(--surface-2);
}
.deviceFitPanel .modelActions{
  grid-column:2;grid-row:2 / span 4;
  display:flex;flex-direction:column;gap:6px;min-width:88px;
}
.deviceFitPanel .modelActions .btn{width:100%;justify-content:center}
.fitWhy{
  width:max-content;display:inline-flex;align-items:center;gap:5px;
  margin-top:1px;border:0;background:transparent;color:var(--muted);
  padding:2px 0;font-size:10.5px;font-weight:620;text-decoration:none;cursor:pointer;
}
.fitWhy::after{content:"⌄";font-size:11px;transition:transform .14s ease}
.fitWhy.expanded::after{transform:rotate(180deg)}
.fitWhy:hover{color:var(--text)}
.fitReason{margin-top:2px;padding:9px 10px;border-radius:9px;line-height:1.5}
.fit.great{color:var(--ok);border-color:color-mix(in srgb,var(--ok) 30%,var(--line));background:color-mix(in srgb,var(--ok) 7%,var(--surface-2))}
.fit.ok{color:var(--text)}
.fit.warn{color:var(--warn);border-color:color-mix(in srgb,var(--warn) 30%,var(--line));background:color-mix(in srgb,var(--warn) 6%,var(--surface-2))}
.fit.installed,.fit.loaded{border-color:color-mix(in srgb,var(--ok) 30%,var(--line));background:color-mix(in srgb,var(--ok) 7%,var(--surface-2))}
@media(max-width:720px){
  .deviceFitPanel{right:0;top:0;bottom:0;width:100vw;max-width:none;border-radius:0;padding:16px}
  .deviceFitPanel .panelHead{top:-16px;margin:-16px -16px 16px;padding:15px 16px 12px}
  .fitGrid{grid-template-columns:repeat(2,minmax(0,1fr))}
  .fitFilters{grid-template-columns:1fr}
  .fitBrowse{grid-template-columns:1fr}
  .fitCatalogSticky{top:72px}
  .fitFilterMenu{position:fixed;left:12px;right:12px;top:auto;bottom:12px;width:auto}
  .fitFilterMenuGrid{grid-template-columns:1fr}
  .deviceFitPanel .model{grid-template-columns:minmax(0,1fr)}
  .deviceFitPanel .model>.fit{grid-column:1;grid-row:auto;justify-self:start}
  .deviceFitPanel .modelActions{grid-column:1;grid-row:auto;flex-direction:row;min-width:0}
  .fitTabs{grid-template-columns:1fr}
}
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
  .contextStrip{padding:0 2px;gap:5px}
  .contextButton{max-width:48vw}
  .permissionSelect{max-width:128px}
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
  #unloadActive{display:none}
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
  let workspaceState = { active: null, workspaces: [] };
  let models = [];
  let runtimeState = null;
  let hardwareState = {};
  let fitState = {
    view: 'recommended',
    useCases: ['general'],
    preference: 'balanced',
    query: '',
    sort: 'best',
    recommended: [],
    compatible: [],
    benchmarks: {},
    benchmarkRunning: false,
    benchmarkStop: false,
    benchmarkProgress: null,
    loading: false,
    error: '',
    details: {},
    detailLoading: {},
    downloads: {},
    compare: [],
    compareOpen: false,
    filtersOpen: false,
    filters: {
      maxSizeGb: '',
      minContext: '',
      quant: '',
      publisher: '',
      installedOnly: false,
      benchmarkedOnly: false,
    },
  };
  let fitSearchTimer = 0;
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
  const activeWorkspace = () => workspaceState.active || workspaceState.workspaces[0] || null;
  const activeChat = () => {
    const workspaceId = activeWorkspace()?.id || '';
    return state.chats.find(
      (chat) => chat.id === state.active && (!workspaceId || chat.workspaceId === workspaceId),
    ) || null;
  };
  function ensureChat() {
    let c = activeChat();
    if (c) return c;
    c = {
      id: crypto.randomUUID(),
      title: 'New chat',
      createdAt: Date.now(),
      workspaceId: activeWorkspace()?.id || '',
      messages: [],
    };
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
  async function persistWorkspacePatch(patch) {
    const active = activeWorkspace();
    if (!active) return null;
    const payload = await api('/api/workspaces/update', {
      method: 'POST',
      body: JSON.stringify({ id: active.id, patch }),
    });
    workspaceState.active = payload.active || payload.workspace || active;
    workspaceState.workspaces = Array.isArray(payload.workspaces)
      ? payload.workspaces
      : workspaceState.workspaces.map((row) =>
          row.id === workspaceState.active.id ? workspaceState.active : row
        );
    if ('tools' in patch) settings.tools = [...(workspaceState.active.tools || [])];
    if ('modelPath' in patch) settings.model = workspaceState.active.modelPath || '';
    renderWorkspaceUI();
    persistSettings();
    return workspaceState.active;
  }

  function workspaceModeCopy(mode) {
    return {
      standard: 'Native tools · regular local agent',
      ptc: 'One run_code + generated SDK · multi-step orchestration',
      minimal: 'Small context · run_code only',
      custom: 'Creator preset · selected tools + project instructions',
    }[mode] || 'Native tools · regular local agent';
  }

  function permissionLabel(value) {
    return {
      'read-only': 'Read only',
      'workspace-write': 'Workspace write',
      'full-access': 'Full access',
    }[value] || 'Workspace write';
  }

  function closeContextMenus() {
    $('workspaceMenu')?.classList.remove('open');
    $('modeMenu')?.classList.remove('open');
    $('workspaceButton')?.classList.remove('active');
    $('modeButton')?.classList.remove('active');
  }

  function renderWorkspaceUI() {
    const active = activeWorkspace();
    if (!active) return;
    $('workspaceButtonText').textContent = active.name;
    $('workspaceButton').title = active.path;
    $('modeButtonText').textContent =
      active.mode === 'ptc' ? 'PTC mode' :
      active.mode === 'minimal' ? 'Minimal mode' :
      active.mode === 'custom' ? 'Creator mode' : 'Standard mode';
    $('modeButton').title = workspaceModeCopy(active.mode);
    $('permissionSelect').value = active.permission || 'workspace-write';
    $('workspaceHint').textContent =
      active.name + ' · ' + workspaceModeCopy(active.mode) + ' · ' + permissionLabel(active.permission);

    const workspaceMenu = $('workspaceMenu');
    workspaceMenu.innerHTML = '<div class="contextMenuTitle">Workspaces</div>';
    for (const item of workspaceState.workspaces) {
      const button = document.createElement('button');
      button.className = 'contextOption' + (item.id === active.id ? ' active' : '');
      button.innerHTML =
        '<div class="contextOptionTop"><span>▱</span><span class="contextText"></span><span class="check"></span></div>' +
        '<div class="contextOptionDesc"></div>';
      button.querySelector('.contextText').textContent = item.name;
      button.querySelector('.contextOptionDesc').textContent = item.path;
      button.querySelector('.check').textContent = item.id === active.id ? '✓' : '';
      button.onclick = () => selectWorkspace(item.id);
      workspaceMenu.appendChild(button);
    }
    const divider = document.createElement('div');
    divider.className = 'contextDivider';
    workspaceMenu.appendChild(divider);
    const manage = document.createElement('button');
    manage.className = 'contextOption';
    manage.innerHTML = '<div class="contextOptionTop"><span>＋</span><span>Manage workspaces…</span></div>';
    manage.onclick = () => { closeContextMenus(); renderWorkspaceManager(); open('workspacePanel'); };
    workspaceMenu.appendChild(manage);

    for (const button of document.querySelectorAll('[data-workspace-mode]')) {
      const mode = button.dataset.workspaceMode;
      button.classList.toggle('active', mode === active.mode);
      const check = button.querySelector('.check');
      if (check) check.textContent = mode === active.mode ? '✓' : '';
    }

    const side = $('workspaceSide');
    side.innerHTML = '';
    for (const item of workspaceState.workspaces) {
      const button = document.createElement('button');
      button.className = 'workspaceSideItem' + (item.id === active.id ? ' active' : '');
      button.innerHTML = '<span class="folder">▱</span><span class="workspaceSideName"></span>';
      button.querySelector('.workspaceSideName').textContent = item.name;
      button.title = item.path;
      button.onclick = () => selectWorkspace(item.id);
      side.appendChild(button);
    }

    $('workspaceCustomPrompt').value = active.customPrompt || '';
    $('workspaceActiveName').textContent = active.name;
    $('workspaceActivePath').textContent = active.path;
    $('workspaceModeSummary').textContent = workspaceModeCopy(active.mode);
  }

  async function loadWorkspaces() {
    const payload = await api('/api/workspaces');
    workspaceState = {
      active: payload.active || null,
      workspaces: Array.isArray(payload.workspaces) ? payload.workspaces : [],
    };
    const active = activeWorkspace();
    if (active) {
      settings.tools = Array.isArray(active.tools) ? [...active.tools] : [];
      if (active.modelPath) settings.model = active.modelPath;
      for (const chat of state.chats) {
        if (!chat.workspaceId) chat.workspaceId = active.id;
      }
      const current = state.chats.find((chat) => chat.id === state.active);
      if (!current || current.workspaceId !== active.id) {
        state.active = state.chats.find((chat) => chat.workspaceId === active.id)?.id || null;
      }
    }
    renderWorkspaceUI();
  }

  async function selectWorkspace(id) {
    if (streaming) return;
    const payload = await api('/api/workspaces/select', {
      method: 'POST',
      body: JSON.stringify({ id }),
    });
    workspaceState = {
      active: payload.active || null,
      workspaces: Array.isArray(payload.workspaces) ? payload.workspaces : workspaceState.workspaces,
    };
    const active = activeWorkspace();
    settings.tools = Array.isArray(active?.tools) ? [...active.tools] : [];
    settings.model = active?.modelPath || settings.model;
    state.active = state.chats.find((chat) => chat.workspaceId === active?.id)?.id || null;
    ensureChat();
    persist();
    closeContextMenus();
    renderWorkspaceUI();
    renderAll();
    await Promise.all([refresh().catch(() => {}), loadTools().catch(() => {})]);
  }

  async function addWorkspace() {
    const workspacePath = $('workspacePath').value.trim();
    const name = $('workspaceName').value.trim();
    if (!workspacePath) {
      $('workspaceMessage').textContent = 'Enter an existing local folder path.';
      return;
    }
    $('workspaceAdd').disabled = true;
    $('workspaceMessage').textContent = 'Adding workspace…';
    try {
      const payload = await api('/api/workspaces/add', {
        method: 'POST',
        body: JSON.stringify({ path: workspacePath, name }),
      });
      workspaceState = {
        active: payload.active || null,
        workspaces: Array.isArray(payload.workspaces) ? payload.workspaces : [],
      };
      $('workspaceName').value = '';
      $('workspacePath').value = '';
      $('workspaceMessage').textContent = 'Workspace added.';
      settings.tools = [...(workspaceState.active?.tools || [])];
      settings.model = workspaceState.active?.modelPath || settings.model;
      state.active = state.chats.find((chat) => chat.workspaceId === workspaceState.active?.id)?.id || null;
      ensureChat();
      persist();
      renderWorkspaceUI();
      renderWorkspaceManager();
      renderAll();
      await refresh().catch(() => {});
    } catch (error) {
      $('workspaceMessage').textContent = String(error.message || error);
    } finally {
      $('workspaceAdd').disabled = false;
    }
  }

  async function removeWorkspace(id) {
    if (!confirm('Remove this workspace from BotConnector? The folder and chat files are not deleted.')) return;
    const payload = await api('/api/workspaces/remove', {
      method: 'POST',
      body: JSON.stringify({ id }),
    });
    workspaceState = {
      active: payload.active || null,
      workspaces: Array.isArray(payload.workspaces) ? payload.workspaces : [],
    };
    settings.tools = [...(workspaceState.active?.tools || [])];
    settings.model = workspaceState.active?.modelPath || settings.model;
    state.active = state.chats.find((chat) => chat.workspaceId === workspaceState.active?.id)?.id || null;
    ensureChat();
    persist();
    renderWorkspaceUI();
    renderWorkspaceManager();
    renderAll();
    await refresh().catch(() => {});
  }

  function renderWorkspaceManager() {
    const box = $('workspaceManagerList');
    if (!box) return;
    box.innerHTML = '';
    const active = activeWorkspace();
    for (const item of workspaceState.workspaces) {
      const row = document.createElement('div');
      row.className = 'workspaceManagerItem';
      row.innerHTML =
        '<div><div class="workspaceManagerName"></div><div class="workspaceManagerPath"></div></div>' +
        '<div class="row"><button class="btn small selectWorkspace">Use</button><button class="btn small removeWorkspace">Remove</button></div>';
      row.querySelector('.workspaceManagerName').textContent =
        item.name + (item.id === active?.id ? ' · Active' : '');
      row.querySelector('.workspaceManagerPath').textContent = item.path;
      row.querySelector('.selectWorkspace').disabled = item.id === active?.id;
      row.querySelector('.selectWorkspace').onclick = () => selectWorkspace(item.id).then(renderWorkspaceManager);
      row.querySelector('.removeWorkspace').onclick = () => removeWorkspace(item.id);
      box.appendChild(row);
    }
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
    $('unloadActive').hidden = !active || selectedIsActive;
    $('unloadActive').disabled = !active || selectedIsActive;
  }

  async function unloadActiveModel() {
    const active = activeLoadedModel();
    if (!active) return;
    const model = models.find((item) => String(item.id) === String(active.id)) || active;
    const button = $('unloadActive');
    button.disabled = true;
    button.textContent = 'Unloading…';
    try {
      await api('/api/models/unload', {
        method: 'POST',
        body: JSON.stringify({ model: model.id, runtime: model.runtime || runtimeState?.runtime || '' }),
      });
      await refresh();
      if (activeLoadedModel()) {
        await new Promise((resolve) => setTimeout(resolve, 180));
        await refresh();
      }
      if (activeLoadedModel()) throw new Error('Active model unload could not be verified.');
    } catch (error) {
      alert(error.message || error);
    } finally {
      button.textContent = 'Unload';
      renderModelActions();
    }
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
    const workspaceId = activeWorkspace()?.id || '';
    for (const c of state.chats) {
      if (workspaceId && c.workspaceId !== workspaceId) continue;
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
      const selectedRuntime = selectedModel()?.runtime || s.runtime?.runtime || '';
      $('runtimePill').innerHTML = '<span class="pillDot"></span>' + esc(s.runtime?.available ? (selectedRuntime || 'local runtime') : 'Runtime unavailable');
      $('runtimePill').title = selectedRuntime ? 'Backend for selected model: ' + selectedRuntime : 'Local runtime status';
      $('prepareRuntime').hidden = Boolean(s.runtime?.available);
      const h = s.hardware || {};
      const gpu = [...(h.nvidia || []), ...(h.amd || []), ...(h.intel || [])][0];
      $('hardware').textContent = [h.cpu, h.ramGb ? h.ramGb + ' GB RAM' : '', gpu ? gpu.name : 'no GPU'].filter(Boolean).join(' · ') || 'Unknown';
      const sel = $('modelSelect');
      const want = activeWorkspace()?.modelPath || sel.value || settings.model;
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

  function catalogCapabilities(model) {
    const c = { ...(model?.capabilities || {}) };
    const tags = Array.isArray(model?.tags) ? model.tags.map(String) : [];
    const hay = [model?.id, model?.name, ...tags].filter(Boolean).join(' ').toLowerCase();
    const pipeline = String(model?.pipeline_tag || model?.pipeline || '').toLowerCase();
    if (c.vision == null) c.vision = /vision-language|\bvlm\b|image-text-to-text|multimodal|smolvlm|llava/.test(hay + ' ' + pipeline);
    if (c.coding == null) c.coding = /coder|coding|codegen|programming|fill-in-the-middle|\bfim\b/.test(hay);
    if (c.tools == null) c.tools = /tool[-_ ]?(use|calling)|function[-_ ]?calling/.test(hay);
    if (c.reasoning == null) c.reasoning = /reasoning|reasoner|thinking|qwq|gpt-oss|deepseek-r1|r1-distill|spark-reasoning/.test(hay);
    if (c.embeddings == null) c.embeddings = /embedding|embeddings|sentence-transformers/.test(hay) || ['feature-extraction', 'sentence-similarity'].includes(pipeline);
    if (c.audio == null) c.audio = /whisper|speech|audio/.test(hay) || /audio|speech/.test(pipeline);
    if (c.chat == null) c.chat = !c.embeddings && !c.audio;
    return c;
  }

  function modelCapabilityBadges(capabilities) {
    const c = capabilities || {};
    const items = [
      ['chat', 'Text', 'text'],
      ['vision', 'Vision', 'vision'],
      ['tools', 'Tools', 'tools'],
      ['coding', 'Coding', 'coding'],
      ['reasoning', 'Reasoning', 'reasoning'],
      ['embeddings', 'Embedding', 'embedding'],
      ['audio', 'Audio', 'audio'],
    ];
    return items
      .filter(([key]) => c[key] === true)
      .map(([, label, cls]) => '<span class="capability ' + cls + '">' + label + '</span>')
      .join('');
  }

  function renderCatalog(box, list) {
    box.innerHTML = list.length ? '' : '<div class="muted">Nothing found.</div>';
    for (const m of list) {
      const level = m.compatibility?.level || 'unknown';
      const row = document.createElement('div');
      row.className = 'model';
      row.innerHTML = '<div class="modelInfo"><span class="name"></span><div class="capabilities"></div></div><span class="fit ' + esc(level) + '">' + esc(level) + '</span><button class="btn small">Download</button>';
      const size = m.compatibility?.paramsB ? ' · ' + m.compatibility.paramsB + 'B' : '';
      row.querySelector('.name').textContent = m.id + size;
      row.querySelector('.name').title = m.id;
      const badges = modelCapabilityBadges(catalogCapabilities(m));
      const capabilityBox = row.querySelector('.capabilities');
      capabilityBox.innerHTML = badges;
      capabilityBox.hidden = !badges;
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
    if (key === 'ram') return h.ramGb ? Number(h.ramGb).toFixed(1) + ' GB total' : 'Unknown';
    if (key === 'gpu') return gpu?.name || 'No GPU detected';
    if (key === 'vram') {
      const value = gpu?.vramGb ?? gpu?.vram_gb ?? gpu?.memoryGb ?? gpu?.memory_gb;
      return value ? Number(value).toFixed(1) + ' GB' : (gpu ? 'Shared / dynamic or not reported' : 'Not available');
    }
    if (key === 'npu') return h.npu?.name || (h.npu?.available ? 'NPU detected' : 'No NPU detected');
    if (key === 'system') return [h.platform, h.arch, h.release].filter(Boolean).join(' · ') || 'Unknown';
    if (key === 'backend') {
      const runtimes = Array.isArray(runtimeState?.runtimes)
        ? runtimeState.runtimes.map((item) => item?.runtime).filter(Boolean)
        : [];
      return runtimes.length ? [...new Set(runtimes)].join(' · ') : (runtimeState?.runtime || 'Not ready');
    }
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
    $('fitRamAvailable').textContent = h.freeRamGb
      ? Number(h.freeRamGb).toFixed(1) + ' GB available now'
      : 'Available memory not reported';
  }

  function fitUseCaseMatches(model, useCase) {
    if (useCase === 'general') return true;
    const c = catalogCapabilities(model);
    if (useCase === 'coding') return c.coding === true;
    if (useCase === 'reasoning') return c.reasoning === true;
    if (useCase === 'vision') return c.vision === true;
    if (useCase === 'tools') return c.tools === true;
    if (useCase === 'indonesian') {
      const hay = [model?.id, model?.name, ...(Array.isArray(model?.tags) ? model.tags : [])].filter(Boolean).join(' ').toLowerCase();
      return /indones|bahasa[ -]?indonesia|id-id|bahasaindonesia/.test(hay);
    }
    return true;
  }

  function fitSpecificUseCases() {
    const selected = fitState.useCases.filter((item) => item !== 'general');
    return selected.length ? selected : ['general'];
  }

  function fitLevelRank(level) {
    return ({ great: 0, ok: 1, warn: 2, unknown: 3, no: 9 })[String(level || 'unknown')] ?? 8;
  }

  function fitParams(model) {
    return Number(model?.compatibility?.paramsB || 0);
  }

  function preferenceScore(model) {
    const p = fitParams(model);
    if (!p) return 0;
    if (fitState.preference === 'fast') {
      if (p <= 2) return 260;
      if (p <= 4) return 180;
      if (p <= 7) return 80;
      return 0;
    }
    if (fitState.preference === 'quality') {
      if (p >= 7 && p <= 14) return 260;
      if (p >= 3) return 190;
      return 60;
    }
    if (p >= 3 && p <= 9) return 220;
    if (p > 0 && p < 3) return 120;
    return 80;
  }

  function currentGpuName() {
    const h = hardwareState || {};
    return [...(h.nvidia || []), ...(h.amd || []), ...(h.intel || [])][0]?.name || '';
  }

  function benchmarkMatchesHardware(bench) {
    if (!bench) return false;
    const cpu = String(hardwareState?.cpu || '').trim().toLowerCase();
    const gpu = String(currentGpuName() || '').trim().toLowerCase();
    const benchCpu = String(bench?.hardware?.cpu || '').trim().toLowerCase();
    const benchGpu = String(bench?.hardware?.gpu || '').trim().toLowerCase();
    if (cpu && benchCpu && cpu !== benchCpu) return false;
    if (gpu && benchGpu && gpu !== benchGpu) return false;
    return true;
  }

  function benchmarkScore(model) {
    const local = model?._local || installedMatch(model);
    const bench = modelBenchmark(local);
    if (!bench || !benchmarkMatchesHardware(bench)) return 0;
    const tps = Math.max(0, Number(bench.tokensPerSecond || 0));
    if (!tps) return 20;
    if (fitState.preference === 'fast') return Math.min(320, 20 + tps * 6);
    if (fitState.preference === 'quality') return Math.min(90, 10 + tps * 1.5);
    return Math.min(190, 15 + tps * 3);
  }

  function fitScore(model) {
    const useCases = fitSpecificUseCases();
    const matched = useCases.filter((useCase) => fitUseCaseMatches(model, useCase)).length;
    const missing = useCases.length - matched;
    return (700 - fitLevelRank(model?.compatibility?.level) * 150) +
      matched * 180 - missing * 260 + preferenceScore(model) + benchmarkScore(model) +
      Math.min(90, Math.log10(Math.max(1, Number(model?.downloads || 0))) * 18);
  }

  function normalizedFitSearch(model) {
    const caps = catalogCapabilities(model);
    return [
      model?.id, model?.name, ...(Array.isArray(model?.tags) ? model.tags : []),
      caps.vision ? 'vision' : '', caps.tools ? 'tools' : '', caps.coding ? 'coding' : '',
      caps.reasoning ? 'reasoning' : '', caps.audio ? 'audio' : '',
    ].filter(Boolean).join(' ').toLowerCase();
  }

  function benchmarkKey(model, runtime) {
    return String(runtime || '') + '::' + String(model || '');
  }

  function modelBenchmark(local) {
    if (!local) return null;
    return fitState.benchmarks[benchmarkKey(local.id, local.runtime)] || null;
  }

  function formatGb(value) {
    const n = Number(value || 0);
    if (!n) return '';
    return n >= 10 ? n.toFixed(1) : n.toFixed(1);
  }

  function formatBytes(value) {
    const n = Number(value || 0);
    if (!n) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let size = n;
    let index = 0;
    while (size >= 1024 && index < units.length - 1) {
      size /= 1024;
      index += 1;
    }
    const digits = index >= 3 ? 1 : index === 2 ? 0 : 1;
    return size.toFixed(digits) + ' ' + units[index];
  }

  function fitModelData(model) {
    if (!model) return model;
    const id = String(model?.id || model?.name || '');
    const details = fitState.details[id];
    if (!details) return model;
    return {
      ...model,
      ...details,
      _local: model._local,
      _installed: model._installed,
      capabilities: details.capabilities || model.capabilities,
      compatibility: details.compatibility || model.compatibility,
    };
  }

  function catalogDisplayName(model) {
    const m = fitModelData(model) || {};
    const raw = String(m.id || m.name || 'Local model');
    const leaf = raw.includes('/') ? raw.slice(raw.lastIndexOf('/') + 1) : raw;
    const clean = leaf
      .replace(/\.gguf$/i, '')
      .replace(/[-_.]?GGUF$/i, '')
      .replace(/[-_.](?:IQ\d(?:_[A-Z0-9]+)?|Q\d(?:_[A-Z0-9]+){0,3}|F16|BF16|F32)(?=$|[-_.])/gi, '-');
    const params = Number(m?.compatibility?.paramsB || 0) ||
      Number((clean.match(/(?:^|[-_.])(\d+(?:\.\d+)?)B(?:$|[-_.])/i) || [])[1] || 0);
    const paramLabel = params ? String(params).replace(/\.0$/, '') + 'B' : '';
    const rules = [
      [/qwen[-_. ]*(\d+(?:\.\d+)?)/i, 'Qwen'],
      [/gemma[-_. ]*(\d+(?:\.\d+)?)/i, 'Gemma'],
      [/llama[-_. ]*(\d+(?:\.\d+)?)/i, 'Llama'],
      [/mistral[-_. ]*(\d+(?:\.\d+)?)/i, 'Mistral'],
      [/phi[-_. ]*(\d+(?:\.\d+)?)/i, 'Phi'],
      [/glm[-_. ]*(\d+(?:\.\d+)?)/i, 'GLM'],
    ];
    for (const [pattern, family] of rules) {
      const hit = clean.match(pattern);
      if (!hit) continue;
      let name = family + ' ' + hit[1];
      if (/coder/i.test(clean) && !/coder/i.test(name)) name += ' Coder';
      else if (/(?:^|[-_.])vl(?:$|[-_.])|vision/i.test(clean)) name += ' VL';
      else if (/flash/i.test(clean)) name += ' Flash';
      if (paramLabel && !name.toLowerCase().includes(paramLabel.toLowerCase())) name += ' ' + paramLabel;
      return name.replace(/\s+/g, ' ').trim();
    }
    if (/deepseek/i.test(clean)) {
      return ('DeepSeek' + (/coder/i.test(clean) ? ' Coder' : '') + (paramLabel ? ' ' + paramLabel : '')).trim();
    }
    const words = clean.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim().split(' ');
    const paramIndex = words.findIndex((word) => /^\d+(?:\.\d+)?B$/i.test(word));
    const endAt = paramIndex >= 0 ? Math.min(words.length, paramIndex + 1) : Math.min(words.length, 5);
    const fallback = words.slice(0, endAt).join(' ');
    return fallback || friendlyModelName(m);
  }

  function fitPublisher(model) {
    const m = fitModelData(model) || {};
    if (m.author) return String(m.author);
    const raw = String(m.id || '');
    if (raw.includes('/')) return raw.split('/')[0];
    return String(m?._local?.source || 'Local model');
  }

  function fitLicenseLabel(model) {
    const value = String(fitModelData(model)?.license || '').trim();
    if (!value) return 'License not listed';
    return value.split('-').map((part, index) => index === 0 ? part.charAt(0).toUpperCase() + part.slice(1) : part.toUpperCase()).join('-');
  }

  function fitPreferredQuant(model) {
    const m = fitModelData(model) || {};
    if (m.preferredDownload?.quant) return String(m.preferredDownload.quant);
    if (m.quant) return String(m.quant);
    const raw = String(m.id || m.name || '');
    const hit = raw.toUpperCase().match(/(?:^|[-_.])(IQ\d(?:_[A-Z0-9]+)?|Q\d(?:_[A-Z0-9]+){0,3}|F16|BF16|F32)(?:$|[-_.])/);
    return hit?.[1] || '';
  }

  function fitDownloadGb(model) {
    const m = fitModelData(model) || {};
    const bytes = Number(m.preferredDownload?.size || 0);
    if (bytes > 0) return { gb: bytes / 1024 ** 3, estimated: false };
    const estimated = Number(m.estimatedDownloadGb || m?.compatibility?.estimatedQ4Gb || 0);
    return estimated > 0 ? { gb: estimated, estimated: true } : { gb: 0, estimated: true };
  }

  function fitRecommendedRamGb(model) {
    const download = fitDownloadGb(model).gb;
    if (!download) return 0;
    return Math.ceil(download * 1.25 * 10) / 10;
  }

  function fitHeadroomGb(model) {
    const free = Number(hardwareState?.freeRamGb || 0);
    const ram = fitRecommendedRamGb(model);
    return free && ram ? +(free - ram).toFixed(1) : null;
  }

  function fitContextLabel(model) {
    const n = Number(fitModelData(model)?.contextLength || 0);
    if (!n) return '';
    if (n >= 1024 * 1024) return (n / (1024 * 1024)).toFixed(n % (1024 * 1024) ? 1 : 0) + 'M';
    if (n >= 1024) return (n / 1024).toFixed(n % 1024 ? 1 : 0) + 'K';
    return String(n);
  }

  function fitResourceSummary(model) {
    const m = fitModelData(model) || {};
    const c = m.compatibility || {};
    const bits = [];
    if (c.paramsB) bits.push(Number(c.paramsB).toFixed(1).replace(/\.0$/, '') + 'B parameters');
    const context = fitContextLabel(m);
    if (context) bits.push('Context ' + context);
    return bits.join(' · ');
  }

  function fitDownloadSummary(model) {
    const download = fitDownloadGb(model);
    const ram = fitRecommendedRamGb(model);
    const headroom = fitHeadroomGb(model);
    const bits = [];
    if (download.gb) bits.push((download.estimated ? '~' : '') + formatGb(download.gb) + ' GB download' + (download.estimated ? ' est.' : ''));
    if (ram) bits.push('~' + formatGb(ram) + ' GB RAM recommended');
    if (headroom != null) {
      if (headroom >= 0) bits.push('~' + formatGb(headroom) + ' GB headroom after load');
      else bits.push(formatGb(Number(hardwareState?.freeRamGb || 0)) + ' GB RAM available now');
    }
    return bits.join(' · ');
  }

  function fitIdentitySummary(model) {
    const m = fitModelData(model) || {};
    const quant = fitPreferredQuant(m);
    return [fitPublisher(m), 'GGUF', quant || 'quant resolves on download'].filter(Boolean).join(' · ');
  }

  function fitTrustSummary(model) {
    const m = fitModelData(model) || {};
    const parts = [];
    const isLocalOnly = Boolean(m?._local && !m.author && !String(m.id || '').includes('/'));
    parts.push(isLocalOnly ? 'Local model' : (m.publisherType === 'official' ? 'Official publisher' : 'Community'));
    parts.push(fitLicenseLabel(m));
    parts.push(m.source || m?._local?.source || (String(m.id || '').includes('/') ? 'Hugging Face' : 'Local device'));
    return parts;
  }

  function fitBenchmarkForModel(model) {
    const local = model?._local || installedMatch(model);
    const bench = modelBenchmark(local);
    return bench && benchmarkMatchesHardware(bench) ? bench : null;
  }

  function fitBenchmarkSummary(model) {
    const local = model?._local || installedMatch(model);
    const bench = modelBenchmark(local);
    if (!bench) return '';
    const bits = [];
    const current = benchmarkMatchesHardware(bench);
    if (bench.promptTokensPerSecond) bits.push('Prompt <strong>' + Number(bench.promptTokensPerSecond).toFixed(1) + ' tok/s</strong>');
    if (bench.tokensPerSecond) bits.push((bench.source === 'runtime' ? 'Generate ' : 'Overall ~') + '<strong>' + Number(bench.tokensPerSecond).toFixed(1) + ' tok/s</strong>');
    if (bench.loadMs) bits.push('Load ' + (Number(bench.loadMs) / 1000).toFixed(2) + ' s');
    if (bench.wallMs) bits.push('End-to-end ' + (Number(bench.wallMs) / 1000).toFixed(2) + ' s');
    if (bench.contextTokens) bits.push('Context ' + Math.round(Number(bench.contextTokens) / 1024) + 'K');
    if (!current) bits.push('Previous hardware');
    return bits.join(' · ');
  }

  function fitStatusText(model, local, loaded) {
    const m = fitModelData(model) || {};
    const level = String(m?.compatibility?.level || (loaded ? 'loaded' : local ? 'installed' : 'unknown'));
    const bench = fitBenchmarkForModel(m);
    const base = fitStatusLabel(level);
    return bench?.tokensPerSecond ? base + ' · ' + Number(bench.tokensPerSecond).toFixed(1) + ' tok/s' : base + ' · Estimated';
  }

  function fitReasonText(model) {
    const m = fitModelData(model) || {};
    const c = m.compatibility || {};
    const reasons = [];
    const level = String(c.level || 'unknown');
    if (level === 'great') reasons.push('Fits comfortably on the detected hardware.');
    else if (level === 'ok') reasons.push('Fits the detected hardware with moderate headroom.');
    else if (level === 'warn') reasons.push('Expected to run, but memory or speed headroom may be limited.');
    const download = fitDownloadGb(m);
    if (download.gb) reasons.push((download.estimated ? 'Estimated' : 'Selected') + ' model download is about ' + formatGb(download.gb) + ' GB.');
    const ram = fitRecommendedRamGb(m);
    if (ram) reasons.push('Recommended memory budget is about ' + formatGb(ram) + ' GB including runtime overhead.');
    const useCases = fitSpecificUseCases().filter((item) => item !== 'general');
    if (useCases.length) reasons.push('Matches selected capability: ' + useCases.join(', ') + '.');
    const p = fitParams(m);
    if (p) reasons.push('The ' + fitState.preference + ' preference ranks this ' + p + 'B model against the other compatible choices.');
    const bench = fitBenchmarkForModel(m);
    if (bench?.tokensPerSecond) reasons.push('Measured on this device at ' + Number(bench.tokensPerSecond).toFixed(1) + ' tok/s; this measured speed contributes to the ranking.');
    else reasons.push('Performance is estimated until this model is installed and benchmarked on this device.');
    return reasons.join(' ');
  }

  function fitRecommendationSummary(model) {
    const m = fitModelData(model) || {};
    const bits = [];
    const ram = fitRecommendedRamGb(m);
    const free = Number(hardwareState?.freeRamGb || 0);
    if (ram && free && ram <= free * 0.45) bits.push('Low memory footprint');
    else if (fitHeadroomGb(m) != null && fitHeadroomGb(m) >= 4) bits.push('Comfortable memory headroom');
    const selected = fitSpecificUseCases().filter((item) => item !== 'general');
    if (selected.length) bits.push('Matches ' + selected.join(' + '));
    const bench = fitBenchmarkForModel(m);
    if (bench?.tokensPerSecond) bits.push(Number(bench.tokensPerSecond).toFixed(1) + ' tok/s measured');
    else if (String(m?.compatibility?.level) === 'great') bits.push('Great estimated fit');
    return bits.slice(0, 3).join(' · ') || 'Best current match for this device and profile';
  }

  async function benchmarkOne(local) {
    const result = await api('/api/models/benchmark', {
      method: 'POST',
      body: JSON.stringify({ model: local.id, runtime: local.runtime }),
    });
    fitState.benchmarks[benchmarkKey(local.id, local.runtime)] = result;
    return result;
  }

  async function benchmarkLocalModel(local, button) {
    if (!local || fitState.benchmarkRunning) return;
    button.disabled = true;
    const previous = button.textContent;
    button.textContent = 'Benchmarking…';
    try {
      await benchmarkOne(local);
      await refresh();
      renderDeviceFitModels();
    } catch (error) {
      alert(error.message || error);
      button.disabled = false;
      button.textContent = previous;
    }
  }

  async function benchmarkAllInstalled() {
    if (fitState.benchmarkRunning) return;
    const rows = installedFitModels()
      .filter((model) => catalogCapabilities(model).chat !== false)
      .map((model) => model._local)
      .filter(Boolean);
    if (!rows.length) return;

    fitState.benchmarkRunning = true;
    fitState.benchmarkStop = false;
    fitState.benchmarkProgress = { current: 0, total: rows.length, failed: 0, model: '' };
    renderDeviceFitModels();

    for (let i = 0; i < rows.length; i++) {
      if (fitState.benchmarkStop) break;
      const local = rows[i];
      fitState.benchmarkProgress = { ...fitState.benchmarkProgress, current: i + 1, model: friendlyModelName(local) };
      renderDeviceFitModels();
      try { await benchmarkOne(local); } catch { fitState.benchmarkProgress.failed += 1; }
      renderDeviceFitModels();
    }

    const stopped = fitState.benchmarkStop;
    fitState.benchmarkRunning = false;
    fitState.benchmarkStop = false;
    const progress = fitState.benchmarkProgress || { current: 0, total: rows.length, failed: 0 };
    fitState.benchmarkProgress = { ...progress, done: true, stopped };
    await refresh().catch(() => {});
    renderDeviceFitModels();
  }

  function installedMatch(candidate) {
    const id = String(candidate?.id || candidate?.name || '').toLowerCase();
    const leaf = id.split('/').pop().replace(/[-_.]?gguf$/i, '');
    return models.find((local) => {
      const hay = [local?.id, local?.name, local?.repoId, local?.path].filter(Boolean).join(' ').toLowerCase();
      return (id && hay.includes(id)) || (leaf && leaf.length > 5 && hay.includes(leaf));
    }) || null;
  }

  function fitModelPassesFilters(model) {
    const m = fitModelData(model) || {};
    const f = fitState.filters;
    if (f.maxSizeGb) {
      const size = fitDownloadGb(m).gb;
      if (!size || size > Number(f.maxSizeGb)) return false;
    }
    if (f.minContext) {
      if (Number(m.contextLength || 0) < Number(f.minContext)) return false;
    }
    if (f.quant && fitPreferredQuant(m).toUpperCase() !== String(f.quant).toUpperCase()) return false;
    if (f.publisher && String(m.publisherType || 'community') !== f.publisher) return false;
    const local = m._local || installedMatch(m);
    if (f.installedOnly && !local) return false;
    if (f.benchmarkedOnly && !fitBenchmarkForModel({ ...m, _local: local })) return false;
    return true;
  }

  function compatibleFiltered() {
    const query = fitState.query.trim().toLowerCase();
    return fitState.compatible
      .map(fitModelData)
      .filter((model) => model?.compatibility?.level !== 'no' && catalogCapabilities(model).chat !== false)
      .filter((model) => fitSpecificUseCases().every((useCase) => fitUseCaseMatches(model, useCase)))
      .filter(fitModelPassesFilters)
      .filter((model) => !query || normalizedFitSearch(model).includes(query));
  }

  function recommendedFiltered() {
    const pool = new Map();
    for (const base of [...fitState.recommended, ...fitState.compatible]) {
      const model = fitModelData(base);
      const id = String(model?.id || model?.name || '');
      if (id && !pool.has(id)) pool.set(id, model);
    }
    const query = fitState.query.trim().toLowerCase();
    return [...pool.values()]
      .filter((model) => model?.compatibility?.level !== 'no' && catalogCapabilities(model).chat !== false)
      .filter((model) => fitSpecificUseCases().every((useCase) => fitUseCaseMatches(model, useCase)))
      .filter(fitModelPassesFilters)
      .filter((model) => !query || normalizedFitSearch(model).includes(query))
      .sort((a, b) => fitScore(b) - fitScore(a))
      .slice(0, 12);
  }

  function installedFitModels() {
    const candidates = [...fitState.recommended, ...fitState.compatible].map(fitModelData);
    return models.map((local) => {
      const hay = [local?.id, local?.name, local?.repoId, local?.path].filter(Boolean).join(' ').toLowerCase();
      const matched = candidates.find((candidate) => {
        const id = String(candidate?.id || '').toLowerCase();
        const leaf = id.split('/').pop().replace(/[-_.]?gguf$/i, '');
        return (id && hay.includes(id)) || (leaf && leaf.length > 5 && hay.includes(leaf));
      });
      const row = {
        ...(matched || {}),
        id: matched?.id || local.repoId || local.name || local.id,
        name: local.name || matched?.name || local.id,
        author: matched?.author || (local.repoId ? String(local.repoId).split('/')[0] : null),
        capabilities: matched?.capabilities || local.capabilities || null,
        compatibility: matched?.compatibility || { level: modelIsLoaded(local) ? 'loaded' : 'installed' },
        downloads: matched?.downloads || 0,
        _local: local,
        _installed: true,
      };
      return row;
    }).filter(fitModelPassesFilters).filter((model) => {
      const query = fitState.query.trim().toLowerCase();
      return !query || normalizedFitSearch(model).includes(query);
    });
  }

  function sortFitModels(list) {
    const rows = [...list];
    const sort = fitState.sort;
    if (sort === 'smallest') return rows.sort((a, b) => (fitDownloadGb(a).gb || 999) - (fitDownloadGb(b).gb || 999) || String(a.id || '').localeCompare(String(b.id || '')));
    if (sort === 'popular') return rows.sort((a, b) => Number(b.downloads || 0) - Number(a.downloads || 0));
    if (sort === 'name') return rows.sort((a, b) => catalogDisplayName(a).localeCompare(catalogDisplayName(b)));
    return rows.sort((a, b) => fitScore(b) - fitScore(a));
  }

  function fitStatusLabel(level) {
    return ({
      great: 'Great fit',
      ok: 'Good fit',
      warn: 'May be slow',
      loaded: 'Loaded',
      installed: 'Installed',
      unknown: 'Unknown',
    })[String(level || 'unknown')] || String(level || 'unknown');
  }

  function fitPreferenceCopy(value) {
    if (value === 'fast') return 'Prioritizes lower latency and lighter models for this device.';
    if (value === 'quality') return 'Prioritizes stronger models when this device has enough headroom.';
    return 'Best balance of speed, memory use, and answer quality.';
  }

  function renderFitPreference() {
    for (const button of document.querySelectorAll('[data-fit-preference]')) {
      const active = button.dataset.fitPreference === fitState.preference;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', active ? 'true' : 'false');
    }
    $('fitPreferenceDescription').textContent = fitPreferenceCopy(fitState.preference);
  }

  function activeFitFilterCount() {
    const f = fitState.filters;
    return [f.maxSizeGb, f.minContext, f.quant, f.publisher, f.installedOnly, f.benchmarkedOnly].filter(Boolean).length;
  }

  function renderFitFilters() {
    $('fitFilterSize').value = fitState.filters.maxSizeGb;
    $('fitFilterContext').value = fitState.filters.minContext;
    $('fitFilterQuant').value = fitState.filters.quant;
    $('fitFilterPublisher').value = fitState.filters.publisher;
    $('fitFilterInstalled').checked = fitState.filters.installedOnly;
    $('fitFilterBenchmarked').checked = fitState.filters.benchmarkedOnly;
    $('fitFilterMenu').hidden = !fitState.filtersOpen;
    const count = activeFitFilterCount();
    $('fitFilterCount').hidden = count === 0;
    $('fitFilterCount').textContent = String(count);
    $('fitFiltersBtn').classList.toggle('active', count > 0);
  }

  async function ensureFitDetails(model) {
    const id = String(model?.id || '');
    if (!id.includes('/') || fitState.details[id] || fitState.detailLoading[id]) return;
    fitState.detailLoading[id] = true;
    try {
      fitState.details[id] = await api('/api/catalog/details', {
        method: 'POST',
        body: JSON.stringify({ id }),
      });
      renderDeviceFitModels();
    } catch {
      // Estimated metadata remains usable if a detail lookup is unavailable or rate-limited.
    } finally {
      delete fitState.detailLoading[id];
    }
  }

  function fitDownloadState(model) {
    return fitState.downloads[String(model?.id || '')] || null;
  }

  function fitDownloadStatusText(job) {
    if (!job) return '';
    const percent = Number(job.percent || 0);
    const completed = Number(job.completed || 0);
    const total = Number(job.total || 0);
    const speed = Number(job.bytesPerSecond || 0);
    if (job.status === 'verifying' || String(job.detail || '').toLowerCase().includes('verifying')) return 'Verifying downloaded model…';
    if (job.status === 'rate-limited') {
      const seconds = Math.max(1, Math.ceil(Number(job.retryAfterMs || 0) / 1000));
      return 'Hugging Face rate limit · retrying automatically in ' + seconds + 's';
    }
    if (job.status === 'retrying') return job.detail || 'Connection interrupted · resuming automatically';
    if (job.status === 'failed') return 'Download failed · ' + (job.error || 'Retry available');
    if (job.status === 'cancelled') return 'Download cancelled';
    if (job.status === 'completed') return 'Installed';
    const bits = ['Downloading ' + percent + '%'];
    if (total) bits.push(formatBytes(completed) + ' / ' + formatBytes(total));
    if (speed) bits.push(formatBytes(speed) + '/s');
    return bits.join(' · ');
  }

  async function downloadFitModel(model) {
    const m = fitModelData(model);
    const id = String(m?.id || '');
    if (!id) return;
    const active = Object.values(fitState.downloads).filter((job) => ['queued','resolving','downloading','verifying','retrying','rate-limited'].includes(String(job?.status || ''))).length;
    if (active >= 2 && !fitState.downloads[id]) {
      alert('Two model downloads are already active. Wait for one to finish or cancel it first.');
      return;
    }
    fitState.downloads[id] = { model: id, status: 'resolving', percent: 0, completed: 0, total: 0 };
    renderDeviceFitModels();
    try {
      const status = await api('/api/status');
      if (!status.runtime?.available) await prepareRuntime();
      const start = await api('/api/models/pull', { method: 'POST', body: JSON.stringify({ model: id }) });
      fitState.downloads[id] = { ...start, model: id };
      renderDeviceFitModels();
      for (;;) {
        const job = await api('/api/models/pull/status', { method: 'POST', body: JSON.stringify({ id: start.id }) });
        fitState.downloads[id] = { ...job, model: id };
        renderDeviceFitModels();
        if (job.status === 'completed') {
          await refresh();
          await loadDeviceFit(false);
          return;
        }
        if (job.status === 'failed' || job.status === 'cancelled') return;
        await new Promise((resolve) => setTimeout(resolve, 650));
      }
    } catch (error) {
      fitState.downloads[id] = { ...(fitState.downloads[id] || {}), model: id, status: 'failed', error: String(error.message || error) };
      renderDeviceFitModels();
    }
  }

  async function cancelFitDownload(model) {
    const id = String(model?.id || '');
    const job = fitState.downloads[id];
    if (!job?.id) return;
    try {
      const state = await api('/api/models/pull/cancel', { method: 'POST', body: JSON.stringify({ id: job.id }) });
      fitState.downloads[id] = { ...state, model: id };
    } catch (error) {
      fitState.downloads[id] = { ...job, status: 'failed', error: String(error.message || error) };
    }
    renderDeviceFitModels();
  }

  function useFitModel(local) {
    if (!local?.path) return;
    const option = [...$('modelSelect').options].find((item) => item.value === local.path);
    if (!option) return;
    $('modelSelect').value = local.path;
    settings.model = local.path;
    $('modelSelect').title = modelDetail(local);
    persistSettings();
    renderModelActions();
    close();
    $('prompt').focus();
  }

  function fitCompareId(model) {
    return String(model?.id || model?.name || '');
  }

  function toggleFitCompare(model) {
    const id = fitCompareId(model);
    if (!id) return;
    if (fitState.compare.includes(id)) fitState.compare = fitState.compare.filter((item) => item !== id);
    else {
      if (fitState.compare.length >= 3) {
        alert('Compare supports up to 3 models at a time.');
        return;
      }
      fitState.compare.push(id);
    }
    if (fitState.compare.length < 2) fitState.compareOpen = false;
    renderDeviceFitModels();
  }

  function knownFitModels() {
    const map = new Map();
    for (const model of [...fitState.recommended, ...fitState.compatible, ...installedFitModels()]) {
      const m = fitModelData(model);
      const id = fitCompareId(m);
      if (id && !map.has(id)) map.set(id, m);
    }
    return map;
  }

  function renderFitCompare() {
    const map = knownFitModels();
    fitState.compare = fitState.compare.filter((id) => map.has(id));
    const selected = fitState.compare.map((id) => map.get(id)).filter(Boolean);
    const tray = $('fitCompareTray');
    tray.hidden = selected.length === 0;
    $('fitCompareTitle').textContent = selected.length + ' model' + (selected.length === 1 ? '' : 's') + ' selected';
    $('fitCompareNames').textContent = selected.map(catalogDisplayName).join(' · ');
    $('fitCompareOpen').disabled = selected.length < 2;
    $('fitCompareOpen').textContent = fitState.compareOpen ? 'Hide comparison' : 'Compare';

    const panel = $('fitComparePanel');
    panel.hidden = !fitState.compareOpen || selected.length < 2;
    if (panel.hidden) return;

    const cell = (value) => '<td>' + esc(value || '—') + '</td>';
    const row = (label, values) => '<tr><td>' + esc(label) + '</td>' + values.map(cell).join('') + '</tr>';
    const header = '<tr><th>Compare</th>' + selected.map((m) => '<th title="' + esc(m.id || '') + '">' + esc(catalogDisplayName(m)) + '</th>').join('') + '</tr>';
    const capabilities = (m) => Object.entries(catalogCapabilities(m)).filter(([, value]) => value === true).map(([key]) => key === 'chat' ? 'Text' : key.charAt(0).toUpperCase() + key.slice(1)).join(', ');
    panel.innerHTML =
      '<div class="row" style="margin-bottom:8px"><strong class="grow">Model comparison</strong><button class="btn small" type="button" id="fitCompareClose">Close</button></div>' +
      '<table class="fitCompareTable"><thead>' + header + '</thead><tbody>' +
      row('Fit', selected.map((m) => fitStatusText(m, m._local || installedMatch(m), Boolean((m._local || installedMatch(m)) && modelIsLoaded(m._local || installedMatch(m)))))) +
      row('Parameters', selected.map((m) => m?.compatibility?.paramsB ? Number(m.compatibility.paramsB).toFixed(1).replace(/\.0$/, '') + 'B' : '—')) +
      row('RAM recommended', selected.map((m) => fitRecommendedRamGb(m) ? '~' + formatGb(fitRecommendedRamGb(m)) + ' GB' : '—')) +
      row('Measured speed', selected.map((m) => fitBenchmarkForModel(m)?.tokensPerSecond ? Number(fitBenchmarkForModel(m).tokensPerSecond).toFixed(1) + ' tok/s' : 'Not benchmarked')) +
      row('Context', selected.map((m) => fitContextLabel(m) || 'Not listed')) +
      row('Capabilities', selected.map(capabilities)) +
      row('Publisher', selected.map((m) => fitPublisher(m) + ' · ' + (m.publisherType === 'official' ? 'Official' : 'Community'))) +
      row('License', selected.map(fitLicenseLabel)) +
      '</tbody></table>';
    $('fitCompareClose').onclick = () => { fitState.compareOpen = false; renderFitCompare(); };
  }

  function renderFitSkeleton(label = 'Finding compatible models…') {
    $('fitModels').innerHTML =
      '<div class="fitStateBox" style="min-height:70px;padding-bottom:4px"><strong>' + esc(label) + '</strong></div>' +
      '<div class="fitSkeletonList">' +
      Array.from({ length: 4 }, () => '<div class="fitSkeleton"><div class="fitSkeletonLine"></div><div class="fitSkeletonLine mid"></div><div class="fitSkeletonLine short"></div></div>').join('') +
      '</div>';
  }

  function renderFitError(error) {
    const box = $('fitModels');
    box.innerHTML = '<div class="fitStateBox"><strong>Catalog unavailable</strong><span>' + esc(error || 'Could not load compatible models.') + '</span><button class="btn small" type="button">Retry</button></div>';
    box.querySelector('button').onclick = () => loadDeviceFit(true);
  }

  function renderFitCatalog(list) {
    const box = $('fitModels');
    if (!list.length) {
      const useCases = fitSpecificUseCases().filter((item) => item !== 'general');
      const label = useCases.length
        ? 'No ' + useCases.map((item) => item.charAt(0).toUpperCase() + item.slice(1)).join(' + ') + ' models fit this profile'
        : 'No models match these filters';
      box.innerHTML = '<div class="fitStateBox"><strong>' + esc(label) + '</strong><span>Try another profile, clear filters, or scan the device again.</span><button class="btn small" type="button">Clear filters</button></div>';
      box.querySelector('button').onclick = () => {
        fitState.filters = { maxSizeGb: '', minContext: '', quant: '', publisher: '', installedOnly: false, benchmarkedOnly: false };
        fitState.query = '';
        $('fitSearch').value = '';
        renderDeviceFitModels();
      };
      renderFitCompare();
      return;
    }

    box.innerHTML = '';
    list.forEach((base, index) => {
      const m = fitModelData(base);
      const local = m._local || installedMatch(m);
      const loaded = local ? modelIsLoaded(local) : false;
      const level = String(m?.compatibility?.level || (loaded ? 'loaded' : local ? 'installed' : 'unknown'));
      const bench = fitBenchmarkForModel({ ...m, _local: local });
      const downloadJob = fitDownloadState(m);
      const selectedCompare = fitState.compare.includes(fitCompareId(m));
      const row = document.createElement('div');
      row.className = 'model fitModelCard' + (fitState.view === 'recommended' && index === 0 ? ' fitTopRecommendation' : '');
      row.innerHTML =
        '<div class="modelInfo">' +
          '<span class="name"></span>' +
          '<div class="fitIdentityMeta"></div>' +
          '<div class="fitRecommendationHint" hidden><strong>Recommended for this device</strong><span></span></div>' +
          '<div class="capabilities"></div>' +
          '<div class="fitMeta"></div>' +
          '<div class="fitTrustMeta"></div>' +
          '<div class="fitDownloadMeta"></div>' +
          '<div class="fitBenchmarkMetrics"></div>' +
          '<div class="fitDownloadProgress" hidden><div class="fitDownloadProgressTop"><span class="fitDownloadProgressText"></span><span class="fitDownloadProgressPct"></span></div><div class="fitProgressTrack"><div class="fitProgressBar"></div></div></div>' +
          '<button class="fitWhy" type="button">Why this model?</button>' +
          '<div class="fitReason" hidden></div>' +
          '<label class="fitCompareChoice"><input type="checkbox"> Compare</label>' +
        '</div>' +
        '<span class="fit ' + esc(level) + '"></span>' +
        '<div class="modelActions"><button class="btn small primary"></button><button class="btn small secondary" type="button" hidden></button><button class="btn small benchmark" type="button" hidden>Benchmark</button><button class="btn small cancelDownload" type="button" hidden>Cancel</button></div>';

      const name = row.querySelector('.name');
      name.textContent = catalogDisplayName(m);
      name.title = m.id || m.name || '';

      row.querySelector('.fitIdentityMeta').textContent = fitIdentitySummary(m);
      const recommendedHint = row.querySelector('.fitRecommendationHint');
      if (fitState.view === 'recommended' && index === 0) {
        recommendedHint.hidden = false;
        recommendedHint.querySelector('span').textContent = fitRecommendationSummary(m);
      }

      const badges = modelCapabilityBadges(catalogCapabilities(m));
      const capabilityBox = row.querySelector('.capabilities');
      capabilityBox.innerHTML = badges;
      capabilityBox.hidden = !badges;

      const meta = row.querySelector('.fitMeta');
      meta.textContent = fitResourceSummary(m);
      meta.hidden = !meta.textContent;

      const trust = row.querySelector('.fitTrustMeta');
      const trustParts = fitTrustSummary(m);
      trust.innerHTML =
        '<span class="fitTrustBadge ' + (m.publisherType === 'official' ? 'official' : '') + '">' + esc(trustParts[0]) + '</span>' +
        '<span>' + esc(trustParts[1]) + '</span><span>·</span><span>' + esc(trustParts[2]) + '</span>' +
        '<span class="fitConfidence ' + (bench ? 'measured' : '') + '">' + (bench ? 'Measured' : 'Estimated') + '</span>';

      const downloadMeta = row.querySelector('.fitDownloadMeta');
      downloadMeta.textContent = fitDownloadSummary(m);
      downloadMeta.hidden = !downloadMeta.textContent;

      const perf = row.querySelector('.fitBenchmarkMetrics');
      perf.innerHTML = fitBenchmarkSummary({ ...m, _local: local });
      perf.hidden = !perf.textContent;

      const status = row.querySelector('.fit');
      status.textContent = fitStatusText({ ...m, _local: local }, local, loaded);

      const why = row.querySelector('.fitWhy');
      const reason = row.querySelector('.fitReason');
      reason.textContent = fitReasonText({ ...m, _local: local });
      why.hidden = fitState.view !== 'recommended' || !reason.textContent;
      why.onclick = () => {
        reason.hidden = !reason.hidden;
        why.classList.toggle('expanded', !reason.hidden);
        why.textContent = reason.hidden ? 'Why this model?' : 'Hide details';
      };

      const compare = row.querySelector('.fitCompareChoice input');
      compare.checked = selectedCompare;
      compare.onchange = () => toggleFitCompare(m);

      const primary = row.querySelector('.primary');
      const secondary = row.querySelector('.secondary');
      const benchmark = row.querySelector('.benchmark');
      const cancel = row.querySelector('.cancelDownload');
      const progressBox = row.querySelector('.fitDownloadProgress');

      if (downloadJob && !['completed'].includes(downloadJob.status)) {
        const active = ['queued','resolving','downloading','verifying','retrying','rate-limited'].includes(String(downloadJob.status || ''));
        const text = fitDownloadStatusText(downloadJob);
        progressBox.hidden = false;
        progressBox.querySelector('.fitDownloadProgressText').textContent = text;
        progressBox.querySelector('.fitDownloadProgressPct').textContent = Number(downloadJob.percent || 0) + '%';
        progressBox.querySelector('.fitProgressBar').style.width = Math.max(0, Math.min(100, Number(downloadJob.percent || 0))) + '%';
        if (active) {
          primary.disabled = true;
          primary.textContent = downloadJob.status === 'verifying' ? 'Verifying…' : 'Downloading…';
          cancel.hidden = false;
          cancel.onclick = () => cancelFitDownload(m);
        } else {
          primary.textContent = 'Retry download';
          primary.onclick = () => downloadFitModel(m);
        }
      } else if (local) {
        benchmark.hidden = catalogCapabilities(m).chat === false;
        benchmark.disabled = fitState.benchmarkRunning;
        benchmark.onclick = () => benchmarkLocalModel(local, benchmark);
        if (loaded) {
          primary.textContent = 'Use model';
          primary.onclick = () => useFitModel(local);
          secondary.hidden = false;
          secondary.textContent = 'Unload';
          secondary.onclick = async () => {
            secondary.disabled = true;
            try {
              await api('/api/models/unload', { method: 'POST', body: JSON.stringify({ model: local.id, runtime: local.runtime }) });
              await refresh();
              renderDeviceFitModels();
            } catch (error) { alert(error.message || error); }
          };
        } else {
          primary.textContent = 'Load';
          primary.disabled = fitState.benchmarkRunning;
          primary.onclick = async () => {
            primary.disabled = true;
            primary.textContent = 'Loading…';
            try {
              await api('/api/models/load', { method: 'POST', body: JSON.stringify({ model: local.id, runtime: local.runtime }) });
              await refresh();
              renderDeviceFitModels();
            } catch (error) {
              alert(error.message || error);
              primary.disabled = false;
              primary.textContent = 'Load';
            }
          };
        }
      } else {
        primary.textContent = 'Download';
        primary.onclick = () => downloadFitModel(m);
      }

      row.onmouseenter = () => ensureFitDetails(m);
      row.onfocusin = () => ensureFitDetails(m);
      box.appendChild(row);
    });

    renderFitCompare();
  }

  function renderDeviceFitModels() {
    const recommended = recommendedFiltered();
    const compatible = compatibleFiltered();
    const installed = installedFitModels();
    $('fitTabRecommendedCount').textContent = String(recommended.length);
    $('fitTabInstalledCount').textContent = String(installed.length);
    $('fitTabAllCount').textContent = String(compatible.length);
    for (const tab of document.querySelectorAll('[data-fit-view]')) {
      const active = tab.dataset.fitView === fitState.view;
      tab.classList.toggle('active', active);
      tab.setAttribute('aria-selected', active ? 'true' : 'false');
    }
    renderFitPreference();
    renderFitFilters();
    $('fitSort').value = fitState.sort;
    const lead = fitState.view === 'recommended'
      ? 'Ranked for this hardware, selected capabilities, preference, and measured performance when available.'
      : fitState.view === 'installed'
        ? 'Models already available on this device.'
        : 'Browse compatible models discovered from the Local catalog.';
    $('fitViewLead').textContent = lead;
    const allButton = $('fitBenchmarkAll');
    const stopButton = $('fitBenchmarkStop');
    allButton.hidden = fitState.view !== 'installed' || !installed.length;
    allButton.disabled = fitState.benchmarkRunning;
    stopButton.hidden = !fitState.benchmarkRunning;
    const progress = fitState.benchmarkProgress;
    $('fitBenchmarkStatus').textContent = !progress
      ? ''
      : fitState.benchmarkRunning
        ? 'Benchmarking ' + progress.current + ' / ' + progress.total + (progress.model ? ' · ' + progress.model : '') + (progress.failed ? ' · ' + progress.failed + ' failed' : '')
        : progress.stopped
          ? 'Benchmark stopped after ' + progress.current + ' / ' + progress.total + (progress.failed ? ' · ' + progress.failed + ' failed' : '')
          : progress.done
            ? 'Benchmark complete · ' + progress.total + ' models' + (progress.failed ? ' · ' + progress.failed + ' failed' : '')
            : '';
    if (fitState.loading) {
      renderFitSkeleton('Finding compatible models…');
      return;
    }
    if (fitState.error) {
      renderFitError(fitState.error);
      return;
    }
    const source = fitState.view === 'recommended' ? recommended : fitState.view === 'installed' ? installed : compatible;
    renderFitCatalog(fitState.view === 'installed' ? source : sortFitModels(source));
  }

  function toggleFitUseCase(useCase) {
    if (useCase === 'general') {
      fitState.useCases = ['general'];
    } else {
      const current = fitState.useCases.filter((item) => item !== 'general');
      fitState.useCases = current.includes(useCase) ? current.filter((item) => item !== useCase) : [...current, useCase];
      if (!fitState.useCases.length) fitState.useCases = ['general'];
    }
    for (const button of document.querySelectorAll('[data-fit-usecase]')) {
      button.classList.toggle('active', fitState.useCases.includes(button.dataset.fitUsecase));
    }
    renderDeviceFitModels();
  }

  async function loadFitCompatible(query = '') {
    const params = new URLSearchParams({ q: query, limit: '80', sort: 'downloads' });
    const payload = await api('/api/catalog/search?' + params.toString());
    fitState.compatible = Array.isArray(payload.models) ? payload.models : [];
  }

  async function loadDeviceFit(scanHardware = true) {
    fitState.loading = true;
    fitState.error = '';
    renderFitSkeleton(scanHardware ? 'Scanning hardware…' : 'Finding compatible models…');
    try {
      if (scanHardware) {
        const status = await api('/api/status');
        runtimeState = status.runtime || null;
        hardwareState = status.hardware || {};
        renderFitHardware();
        $('fitScanStatus').textContent = 'Detected locally · updated just now';
        renderFitSkeleton('Finding compatible models…');
      }
      const [recommended, , benchmarkPayload] = await Promise.all([
        api('/api/catalog/recommendations', { method: 'POST', body: JSON.stringify({ limit: 24 }) }),
        loadFitCompatible(fitState.query),
        api('/api/models/benchmarks'),
      ]);
      fitState.recommended = Array.isArray(recommended.models) ? recommended.models : [];
      fitState.benchmarks = Object.fromEntries(
        (Array.isArray(benchmarkPayload?.benchmarks) ? benchmarkPayload.benchmarks : [])
          .map((item) => [benchmarkKey(item?.model, item?.runtime), item]),
      );
    } catch (error) {
      fitState.error = String(error.message || error);
    } finally {
      fitState.loading = false;
      renderDeviceFitModels();
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
        persistWorkspacePatch({ tools: settings.tools }).catch(() => {});
        renderTools();
      };
      box.appendChild(row);
    }
    const mode = activeWorkspace()?.mode || 'standard';
    $('toolsModeNote').textContent =
      mode === 'ptc'
        ? 'PTC exposes one run_code tool to the model and generates an SDK from these selected capabilities.'
        : mode === 'minimal'
          ? 'Minimal mode keeps the model-facing tool set to Run Code only.'
          : mode === 'custom'
            ? 'Creator mode exposes exactly the capabilities selected for this workspace.'
            : 'Standard mode exposes selected capabilities as native tools.';
    const count = settings.tools.length;
    $('openTools').querySelector('.toolBtnLabel').textContent =
      mode === 'ptc' ? 'PTC tools (' + count + ')' :
      mode === 'minimal' ? 'Minimal tools' :
      count ? 'Tools (' + count + ')' : 'Tools';
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
    persistWorkspacePatch({ modelPath: settings.model }).catch(() => {});
  };
  $('loadSelected').onclick = () => selectedModelAction('load');
  $('unloadSelected').onclick = () => selectedModelAction('unload');
  $('unloadActive').onclick = unloadActiveModel;
  $('openModels').onclick = () => { open('modelsPanel'); refresh(); loadRecommendations(); };
  const openFit = () => { open('deviceFitPanel'); loadDeviceFit(); };
  $('openDeviceFit').onclick = openFit;
  $('openDeviceFitSide').onclick = openFit;
  $('fitScan').onclick = () => loadDeviceFit(true);
  for (const button of document.querySelectorAll('[data-fit-usecase]')) {
    button.onclick = () => toggleFitUseCase(button.dataset.fitUsecase);
  }
  for (const tab of document.querySelectorAll('[data-fit-view]')) {
    tab.onclick = () => {
      fitState.view = tab.dataset.fitView;
      fitState.compareOpen = false;
      renderDeviceFitModels();
    };
  }
  for (const button of document.querySelectorAll('[data-fit-preference]')) {
    button.onclick = () => {
      fitState.preference = button.dataset.fitPreference;
      renderDeviceFitModels();
    };
  }
  $('fitFiltersBtn').onclick = () => {
    fitState.filtersOpen = !fitState.filtersOpen;
    renderFitFilters();
  };
  $('fitFilterSize').onchange = (event) => { fitState.filters.maxSizeGb = event.target.value; renderDeviceFitModels(); };
  $('fitFilterContext').onchange = (event) => { fitState.filters.minContext = event.target.value; renderDeviceFitModels(); };
  $('fitFilterQuant').onchange = (event) => { fitState.filters.quant = event.target.value; renderDeviceFitModels(); };
  $('fitFilterPublisher').onchange = (event) => { fitState.filters.publisher = event.target.value; renderDeviceFitModels(); };
  $('fitFilterInstalled').onchange = (event) => { fitState.filters.installedOnly = event.target.checked; renderDeviceFitModels(); };
  $('fitFilterBenchmarked').onchange = (event) => { fitState.filters.benchmarkedOnly = event.target.checked; renderDeviceFitModels(); };
  $('fitFiltersClear').onclick = () => {
    fitState.filters = { maxSizeGb: '', minContext: '', quant: '', publisher: '', installedOnly: false, benchmarkedOnly: false };
    renderDeviceFitModels();
  };
  $('fitCompareOpen').onclick = () => {
    if (fitState.compare.length < 2) return;
    fitState.compareOpen = !fitState.compareOpen;
    renderFitCompare();
  };
  $('fitCompareClear').onclick = () => {
    fitState.compare = [];
    fitState.compareOpen = false;
    renderDeviceFitModels();
  };
  $('fitBenchmarkAll').onclick = benchmarkAllInstalled;
  $('fitBenchmarkStop').onclick = () => {
    if (!fitState.benchmarkRunning) return;
    fitState.benchmarkStop = true;
    $('fitBenchmarkStatus').textContent = 'Stopping after the current model…';
  };
  $('fitSort').onchange = (event) => { fitState.sort = event.target.value; renderDeviceFitModels(); };
  $('fitSearch').oninput = (event) => {
    fitState.query = event.target.value;
    clearTimeout(fitSearchTimer);
    fitSearchTimer = setTimeout(() => loadFitCompatible(fitState.query).then(renderDeviceFitModels).catch(() => renderDeviceFitModels()), 350);
    renderDeviceFitModels();
  };
  $('workspaceButton').onclick = (event) => {
    event.stopPropagation();
    const next = !$('workspaceMenu').classList.contains('open');
    closeContextMenus();
    $('workspaceMenu').classList.toggle('open', next);
    $('workspaceButton').classList.toggle('active', next);
  };
  $('modeButton').onclick = (event) => {
    event.stopPropagation();
    const next = !$('modeMenu').classList.contains('open');
    closeContextMenus();
    $('modeMenu').classList.toggle('open', next);
    $('modeButton').classList.toggle('active', next);
  };
  for (const button of document.querySelectorAll('[data-workspace-mode]')) {
    button.onclick = async () => {
      await persistWorkspacePatch({ mode: button.dataset.workspaceMode });
      closeContextMenus();
      renderWorkspaceUI();
      renderTools();
    };
  }
  $('permissionSelect').onchange = async (event) => {
    await persistWorkspacePatch({ permission: event.target.value });
  };
  $('openWorkspaceManager').onclick = () => { renderWorkspaceManager(); open('workspacePanel'); };
  $('workspaceAdd').onclick = addWorkspace;
  $('workspaceSaveCustom').onclick = async () => {
    await persistWorkspacePatch({ customPrompt: $('workspaceCustomPrompt').value });
    $('workspaceMessage').textContent = 'Creator mode instructions saved.';
  };
  document.addEventListener('click', (event) => {
    if (!event.target.closest('.contextSelect')) closeContextMenus();
  });
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
      const workspace = activeWorkspace();
      if (workspace) {
        for (const chat of state.chats) if (!chat.workspaceId) chat.workspaceId = workspace.id;
        settings.tools = Array.isArray(workspace.tools) ? [...workspace.tools] : [];
        if (workspace.modelPath) settings.model = workspace.modelPath;
        const selected = state.chats.find((chat) => chat.id === state.active);
        if (!selected || selected.workspaceId !== workspace.id) {
          state.active = state.chats.find((chat) => chat.workspaceId === workspace.id)?.id || null;
        }
      }
      save('botconnector-local-chats-v1', state);
      applySettings();
      ensureChat();
      renderAll();
      if (merged.changed) saveToDisk();
    } else if (state.chats.some((c) => c.messages.length)) {
      saveToDisk(); // first run of this version: move this browser's history to disk
    }
  }

  async function bootstrap() {
    applySettings();
    try { await loadWorkspaces(); } catch (error) { console.warn('Workspace load failed', error); }
    ensureChat();
    renderAll();
    renderWorkspaceUI();
    await Promise.all([
      refresh().catch(() => {}),
      loadTools().catch(() => {}),
      loadWebAppStatus().catch(() => {}),
    ]);
    setInterval(loadWebAppStatus, 4000);
    loadFromDisk();
  }
  bootstrap();
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
    <div class="sideSectionLabel sideSectionRow"><span>Workspaces</span><button class="sideSectionAction" id="openWorkspaceManager" title="Manage workspaces">＋</button></div>
    <div class="workspaceSide" id="workspaceSide"></div>
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
      <button class="btn small" id="unloadActive" hidden>Unload</button>
      <span class="pill" id="runtimePill"><span class="pillDot"></span>Checking runtime</span>
      <button class="btn" id="openDeviceFit">Device fit</button>
      <button class="btn connectBtn right" id="openWebApp"><span class="pillDot"></span><span>Connect Web App</span></button>
    </div>
    <div class="chat" id="chat"></div>
    <div class="composerWrap">
      <div class="contextStrip">
        <div class="contextSelect">
          <button class="contextButton" id="workspaceButton" type="button" aria-haspopup="menu" aria-expanded="false"><span>▱</span><span class="contextText" id="workspaceButtonText">Workspace</span><span class="chev">⌄</span></button>
          <div class="contextMenu" id="workspaceMenu" role="menu"></div>
        </div>
        <div class="contextSelect">
          <button class="contextButton" id="modeButton" type="button" aria-haspopup="menu" aria-expanded="false"><span>⌘</span><span class="contextText" id="modeButtonText">Standard mode</span><span class="chev">⌄</span></button>
          <div class="contextMenu" id="modeMenu" role="menu">
            <div class="contextMenuTitle">Agent mode</div>
            <button class="contextOption" data-workspace-mode="standard" type="button"><div class="contextOptionTop"><span>Standard mode</span><span class="check"></span></div><div class="contextOptionDesc">Native tools, normal local agent behavior, and full chat context.</div></button>
            <button class="contextOption" data-workspace-mode="ptc" type="button"><div class="contextOptionTop"><span>PTC mode</span><span class="check"></span></div><div class="contextOptionDesc">One run_code tool with a generated SDK for multi-step tool orchestration.</div></button>
            <button class="contextOption" data-workspace-mode="minimal" type="button"><div class="contextOptionTop"><span>Minimal mode</span><span class="check"></span></div><div class="contextOptionDesc">Small model-facing context and Run Code only when execution is needed.</div></button>
            <button class="contextOption" data-workspace-mode="custom" type="button"><div class="contextOptionTop"><span>Custom mode</span><span class="check"></span></div><div class="contextOptionDesc">Only this workspace’s selected tools plus its custom instructions.</div></button>
          </div>
        </div>
        <span class="modeSummary" id="workspaceModeSummary"></span>
      </div>
      <div class="composer" id="composer">
        <div class="attachments" id="attachments"></div>
        <textarea id="prompt" rows="1" placeholder="Message your local model"></textarea>
        <div class="bar">
          <input id="fileInput" type="file" hidden multiple accept=".txt,.md,.markdown,.csv,.json,.jsonl,.yaml,.yml,.xml,.html,.htm,.docx,.js,.ts,.tsx,.jsx,.py,.rs,.go,.java,.c,.cpp,.h,.hpp,.css,.sql,.sh,.ps1,.toml,.ini,.conf,.log">
          <button class="btn" id="attachBtn"><svg viewBox="0 0 24 24" fill="none" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m21.4 11.6-8.5 8.5a6 6 0 0 1-8.5-8.5l9.2-9.2a4 4 0 0 1 5.7 5.7l-9.2 9.2a2 2 0 0 1-2.8-2.8l8.5-8.5"/></svg><span>Attach</span></button>
          <select class="permissionSelect" id="permissionSelect" aria-label="Workspace permission">
            <option value="read-only">Read only</option>
            <option value="workspace-write">Workspace write</option>
            <option value="full-access">Full access</option>
          </select>
          <button class="btn toolBtn" id="openTools"><svg viewBox="0 0 24 24" fill="none" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m14.7 6.3 3-3a4.2 4.2 0 0 1-5.5 5.5l-6.7 6.7a2 2 0 1 1-2.8-2.8l6.7-6.7a4.2 4.2 0 0 1 5.5-5.5l-3 3 2.8 2.8Z"/></svg><span class="toolBtnLabel">Tools</span></button>
          <button class="btn send" id="sendBtn" aria-label="Send message"></button>
        </div>
      </div>
      <div class="hint" id="workspaceHint">Local model inference runs on this device.</div>
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
  <div class="panelHead">
    <div class="row">
      <div class="grow">
        <h2>Device fit</h2>
        <div class="panelLead">Choose local models using this device's real hardware and measured performance.</div>
        <div class="fitHeadMeta"><span class="fitHeadMetaDot"></span><span id="fitScanStatus">Detected locally</span></div>
      </div>
      <button class="btn" id="fitScan">Scan again</button>
      <button class="btn" data-close>Close</button>
    </div>
  </div>

  <section class="fitSection">
    <div class="fitSectionHead">
      <div class="fitSectionTitle">This device</div>
      <div class="fitSectionHint">Live hardware profile</div>
    </div>
    <div class="fitHardwareShell">
      <div class="fitGrid">
        <div class="fitMetric"><span>Processor</span><strong id="fitCpu">Checking…</strong></div>
        <div class="fitMetric"><span>Memory</span><strong id="fitRam">Checking…</strong><div class="fitMetricSub" id="fitRamAvailable">Checking available memory…</div></div>
        <div class="fitMetric"><span>Graphics</span><strong id="fitGpu">Checking…</strong><div class="fitMetricSub">GPU memory · <strong id="fitVram">Checking…</strong></div></div>
        <div class="fitMetric"><span>Accelerator</span><strong id="fitNpu">Checking…</strong></div>
      </div>
      <div class="fitHardwareMeta">
        <div class="fitHardwareMetaItem"><span>System</span><strong id="fitSystem">Checking…</strong></div>
        <span class="fitHardwareMetaSep"></span>
        <div class="fitHardwareMetaItem"><span>Runtimes</span><strong id="fitBackend">Checking…</strong></div>
      </div>
    </div>
  </section>

  <section class="fitSection">
    <div class="fitSectionHead">
      <div class="fitSectionTitle">Recommendation profile</div>
      <div class="fitSectionHint">Tune ranking without changing the model itself</div>
    </div>
    <div class="fitFilters">
      <div class="fitFilterCard">
        <div class="fitFilterLabel"><span>Use cases</span><span class="fitFilterHelp">Select one or more</span></div>
        <div class="fitUseCases">
          <button class="fitUseCaseBtn active" data-fit-usecase="general">General</button>
          <button class="fitUseCaseBtn" data-fit-usecase="indonesian">Bahasa Indonesia</button>
          <button class="fitUseCaseBtn" data-fit-usecase="coding">Coding</button>
          <button class="fitUseCaseBtn" data-fit-usecase="reasoning">Reasoning</button>
          <button class="fitUseCaseBtn" data-fit-usecase="vision">Vision</button>
          <button class="fitUseCaseBtn" data-fit-usecase="tools">Tools</button>
        </div>
      </div>
      <div class="fitFilterCard">
        <div class="fitFilterLabel"><span>Optimize for</span><span class="fitFilterHelp">Ranking preference</span></div>
        <div class="fitPreferenceSegments" role="group" aria-label="Model ranking preference">
          <button class="fitPreferenceBtn" type="button" data-fit-preference="fast">Fast</button>
          <button class="fitPreferenceBtn active" type="button" data-fit-preference="balanced" aria-pressed="true">Balanced</button>
          <button class="fitPreferenceBtn" type="button" data-fit-preference="quality">Quality</button>
        </div>
        <div class="fitPreferenceDescription" id="fitPreferenceDescription">Best balance of speed, memory use, and answer quality.</div>
      </div>
    </div>
  </section>

  <section class="fitSection">
    <div class="fitCatalogSticky">
      <div class="fitTabs" role="tablist" aria-label="Device fit model views">
        <button class="fitTab active" id="fitTabRecommended" data-fit-view="recommended" role="tab"><span>Recommended</span><span class="fitTabCount" id="fitTabRecommendedCount">0</span></button>
        <button class="fitTab" id="fitTabInstalled" data-fit-view="installed" role="tab"><span>Installed</span><span class="fitTabCount" id="fitTabInstalledCount">0</span></button>
        <button class="fitTab" id="fitTabAll" data-fit-view="all" role="tab"><span>All compatible</span><span class="fitTabCount" id="fitTabAllCount">0</span></button>
      </div>
      <div class="fitActionBar">
        <div class="muted fitViewLead" id="fitViewLead">Ranked for this hardware, selected capabilities, and preference.</div>
        <div class="row">
          <button class="btn small" id="fitBenchmarkAll" hidden>Benchmark all</button>
          <button class="btn small" id="fitBenchmarkStop" hidden>Stop</button>
        </div>
      </div>
      <div class="muted fitBenchmarkStatus" id="fitBenchmarkStatus"></div>
      <div class="fitBrowse">
        <div class="fitSearchField">
          <svg viewBox="0 0 24 24" fill="none" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
          <input id="fitSearch" placeholder="Search model, capability, or family">
        </div>
        <div class="fitFilterField">
          <button class="btn fitFilterButton" type="button" id="fitFiltersBtn">Filters <span class="fitFilterCount" id="fitFilterCount" hidden>0</span></button>
          <div class="fitFilterMenu" id="fitFilterMenu" hidden>
            <div class="fitFilterMenuGrid">
              <label>Model size
                <select id="fitFilterSize">
                  <option value="">Any size</option>
                  <option value="4">Up to 4 GB</option>
                  <option value="8">Up to 8 GB</option>
                  <option value="16">Up to 16 GB</option>
                </select>
              </label>
              <label>Context
                <select id="fitFilterContext">
                  <option value="">Any context</option>
                  <option value="8192">8K+</option>
                  <option value="32768">32K+</option>
                  <option value="131072">128K+</option>
                </select>
              </label>
              <label>Quantization
                <select id="fitFilterQuant">
                  <option value="">Any quantization</option>
                  <option value="Q4_K_M">Q4_K_M</option>
                  <option value="Q5_K_M">Q5_K_M</option>
                  <option value="Q8_0">Q8_0</option>
                </select>
              </label>
              <label>Publisher
                <select id="fitFilterPublisher">
                  <option value="">Any publisher</option>
                  <option value="official">Official publisher</option>
                  <option value="community">Community</option>
                </select>
              </label>
            </div>
            <div class="fitFilterChecks">
              <label><input type="checkbox" id="fitFilterInstalled"> Installed only</label>
              <label><input type="checkbox" id="fitFilterBenchmarked"> Benchmarked only</label>
            </div>
            <div class="fitFilterFooter"><span class="muted">Filters apply locally.</span><button class="btn small" id="fitFiltersClear" type="button">Clear filters</button></div>
          </div>
        </div>
        <div class="fitSortField">
          <select id="fitSort" aria-label="Sort models">
            <option value="best">Best fit</option>
            <option value="smallest">Smallest first</option>
            <option value="popular">Most popular</option>
            <option value="name">Name</option>
          </select>
          <span class="fitSortChevron">⌄</span>
        </div>
      </div>
    </div>
    <div class="card"><div id="fitModels"></div></div>
    <div class="fitComparePanel" id="fitComparePanel" hidden></div>
    <div class="fitCompareTray" id="fitCompareTray" hidden>
      <div class="grow"><strong id="fitCompareTitle">Compare models</strong><div class="fitCompareNames" id="fitCompareNames"></div></div>
      <button class="btn small" id="fitCompareClear" type="button">Clear</button>
      <button class="btn small primary" id="fitCompareOpen" type="button">Compare</button>
    </div>
  </section>
</aside>
<aside class="panel" id="workspacePanel">
  <div class="panelHead"><div class="row"><div class="grow"><h2>Workspaces</h2><div class="panelLead">Persistent local project roots. Removing a workspace never deletes its folder.</div></div><button class="btn" data-close>Close</button></div></div>
  <div class="card">
    <h3>Active workspace</h3>
    <div id="workspaceActiveName" style="font-weight:700"></div>
    <div class="muted" id="workspaceActivePath" style="margin-top:4px;overflow-wrap:anywhere"></div>
  </div>
  <div class="card">
    <h3>Add workspace</h3>
    <div class="muted">Enter an existing folder on this computer. BotConnector stores only its canonical path and workspace settings.</div>
    <input id="workspaceName" placeholder="Display name (optional)" style="margin-top:9px">
    <input id="workspacePath" placeholder="C:\Projects\BotConnector or /home/user/project" style="margin-top:7px">
    <button class="btn" id="workspaceAdd" style="margin-top:8px">Add workspace</button>
    <div class="muted" id="workspaceMessage" style="margin-top:7px"></div>
  </div>
  <div class="card">
    <h3>Registered workspaces</h3>
    <div id="workspaceManagerList"></div>
  </div>
  <div class="card">
    <h3>Creator mode instructions</h3>
    <div class="muted">Used only when this workspace is in Creator mode.</div>
    <textarea id="workspaceCustomPrompt" rows="5" placeholder="Project-specific instructions, conventions, or agent rules." style="margin-top:8px"></textarea>
    <button class="btn" id="workspaceSaveCustom" style="margin-top:8px">Save instructions</button>
  </div>
</aside>
<aside class="panel" id="toolsPanel">
  <div class="panelHead"><div class="row"><div class="grow"><h2>Tools</h2><div class="panelLead">Choose capabilities the local model may use.</div></div><button class="btn" data-close>Close</button></div></div>
  <div class="card"><h3>Available tools</h3><div class="muted" id="toolsModeNote">Standard mode exposes selected capabilities as native tools.</div><div class="muted" style="margin-top:5px">READ tools can run when selected. WRITE and EXECUTE tools require one-time approval unless this workspace uses Full access.</div><div class="toolList" id="toolsList"></div></div>
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
