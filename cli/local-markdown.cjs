'use strict';

// Self-contained on purpose: local-ui.cjs embeds renderMarkdown.toString() into the page, so it may not
// reference anything outside its own body. Everything is escaped first; only the tags built here reach the DOM.
function renderMarkdown(source) {
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const inline = (text) => {
    const codes = [];
    let s = esc(text).replace(/`([^`]+)`/g, (_, c) => '\u0000' + (codes.push('<code>' + c + '</code>') - 1) + '\u0000');
    s = s
      .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+|mailto:[^\s)]+)\)/g, (_, t, u) => '<a href="' + u + '" target="_blank" rel="noopener noreferrer">' + t + '</a>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/__([^_]+)__/g, '<strong>$1</strong>')
      .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>')
      .replace(/(^|[^\w])_([^_\s][^_]*)_(?!\w)/g, '$1<em>$2</em>')
      .replace(/~~([^~]+)~~/g, '<del>$1</del>');
    return s.replace(/\u0000(\d+)\u0000/g, (_, i) => codes[Number(i)]);
  };
  const cells = (row) => row.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());

  const blocks = (text) => {
    const lines = text.split('\n');
    const out = [];
    let para = [];
    const flush = () => {
      if (para.length) out.push('<p>' + para.map(inline).join('<br>') + '</p>');
      para = [];
    };
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const fence = line.match(/^\s*```\s*([\w+#.-]*)\s*$/);
      if (fence) {
        flush();
        const code = [];
        i++;
        while (i < lines.length && !/^\s*```\s*$/.test(lines[i])) code.push(lines[i++]);
        out.push('<div class="code"><div class="codeHead"><span>' + esc(fence[1] || 'code') + '</span><button type="button" data-copy>Copy</button></div><pre><code>' + esc(code.join('\n')) + '</code></pre></div>');
        continue;
      }
      if (!line.trim()) { flush(); continue; }
      const heading = line.match(/^(#{1,6})\s+(.*)$/);
      if (heading) { flush(); out.push('<h' + heading[1].length + '>' + inline(heading[2]) + '</h' + heading[1].length + '>'); continue; }
      if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) { flush(); out.push('<hr>'); continue; }
      if (/^\s*\|.*\|\s*$/.test(line) && i + 1 < lines.length && /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(lines[i + 1])) {
        flush();
        const head = cells(line);
        i += 2;
        const rows = [];
        while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) rows.push(cells(lines[i++]));
        i--;
        out.push('<table><thead><tr>' + head.map((c) => '<th>' + inline(c) + '</th>').join('') + '</tr></thead><tbody>' +
          rows.map((r) => '<tr>' + r.map((c) => '<td>' + inline(c) + '</td>').join('') + '</tr>').join('') + '</tbody></table>');
        continue;
      }
      if (/^\s*>/.test(line)) {
        flush();
        const quote = [];
        while (i < lines.length && /^\s*>/.test(lines[i])) quote.push(lines[i++].replace(/^\s*>\s?/, ''));
        i--;
        out.push('<blockquote>' + quote.map(inline).join('<br>') + '</blockquote>');
        continue;
      }
      const list = line.match(/^\s*([-*+]|\d+[.)])\s+/);
      if (list) {
        flush();
        const ordered = /\d/.test(list[1]);
        const items = [];
        while (i < lines.length && /^\s*([-*+]|\d+[.)])\s+/.test(lines[i]) && /\d/.test(lines[i].match(/^\s*([-*+]|\d+[.)])/)[1]) === ordered) {
          items.push(lines[i++].replace(/^\s*([-*+]|\d+[.)])\s+/, ''));
        }
        i--;
        const tag = ordered ? 'ol' : 'ul';
        out.push('<' + tag + '>' + items.map((t) => '<li>' + inline(t) + '</li>').join('') + '</' + tag + '>');
        continue;
      }
      para.push(line);
    }
    flush();
    return out.join('');
  };

  // Reasoning models wrap their thoughts in <think>…</think>; while streaming the closing tag may not exist yet.
  let text = String(source || '').replace(/\r\n?/g, '\n');
  let html = '';
  for (;;) {
    const open = text.indexOf('<think>');
    if (open < 0) break;
    html += blocks(text.slice(0, open));
    const close = text.indexOf('</think>', open);
    const inner = close < 0 ? text.slice(open + 7) : text.slice(open + 7, close);
    html += '<details class="think"' + (close < 0 ? ' open' : '') + '><summary>Thinking</summary><div>' + blocks(inner.trim()).replace(/^<p>([\s\S]*)<\/p>$/, '$1') + '</div></details>';
    text = close < 0 ? '' : text.slice(close + 8);
  }
  return html + blocks(text);
}

module.exports = { renderMarkdown };
