const test = require('node:test');
const assert = require('node:assert/strict');
const { renderMarkdown } = require('./local-markdown.cjs');

test('renders headings, emphasis, inline code, links and lists', () => {
  const html = renderMarkdown('# Judul\n\nIni **tebal**, *miring*, ~~coret~~ dan `kode`.\n\n- satu\n- dua\n\n1. a\n2. b\n\nLihat [docs](https://botconnector.id).');
  assert.match(html, /<h1>Judul<\/h1>/);
  assert.match(html, /<strong>tebal<\/strong>/);
  assert.match(html, /<em>miring<\/em>/);
  assert.match(html, /<del>coret<\/del>/);
  assert.match(html, /<code>kode<\/code>/);
  assert.match(html, /<ul><li>satu<\/li><li>dua<\/li><\/ul>/);
  assert.match(html, /<ol><li>a<\/li><li>b<\/li><\/ol>/);
  assert.match(html, /<a href="https:\/\/botconnector\.id" target="_blank" rel="noopener noreferrer">docs<\/a>/);
});

test('fenced code keeps its text escaped, shows the language and a copy button; unclosed fences still render', () => {
  const html = renderMarkdown('```js\nif (a < b) { x = "<b>" }\n```');
  assert.match(html, /<span>js<\/span>/);
  assert.match(html, /data-copy/);
  assert.match(html, /if \(a &lt; b\) \{ x = &quot;&lt;b&gt;&quot; \}/);
  assert.match(renderMarkdown('```py\nprint(1)'), /<pre><code>print\(1\)<\/code><\/pre>/);
});

test('tables, blockquotes and rules', () => {
  const html = renderMarkdown('| Model | RAM |\n|---|---|\n| Qwen | 4 GB |\n\n> kutipan\n\n---');
  assert.match(html, /<table><thead><tr><th>Model<\/th><th>RAM<\/th><\/tr><\/thead><tbody><tr><td>Qwen<\/td><td>4 GB<\/td><\/tr><\/tbody><\/table>/);
  assert.match(html, /<blockquote>kutipan<\/blockquote>/);
  assert.match(html, /<hr>/);
});

test('<think> becomes a collapsible Thinking block, open while still streaming', () => {
  assert.match(renderMarkdown('<think>hitung dulu</think>Jawaban'), /<details class="think"><summary>Thinking<\/summary><div>hitung dulu<\/div><\/details><p>Jawaban<\/p>/);
  assert.match(renderMarkdown('<think>masih berpikir'), /<details class="think" open>/);
});

test('raw HTML and script links never reach the page', () => {
  const html = renderMarkdown('<img src=x onerror=alert(1)> [klik](javascript:alert(1)) <script>x</script>');
  assert.doesNotMatch(html, /<img|<script|href="javascript/i);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
});
