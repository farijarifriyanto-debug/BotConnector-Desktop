'use strict';

const crypto = require('node:crypto');
const path = require('node:path');
const yauzl = require('yauzl');

const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_EXTRACTED_CHARS = 120000;
const TEXT_EXTENSIONS = new Set([
  '.txt','.md','.markdown','.csv','.json','.jsonl','.yaml','.yml','.xml','.html','.htm',
  '.js','.mjs','.cjs','.ts','.tsx','.jsx','.py','.rs','.go','.java','.c','.cc','.cpp','.h',
  '.hpp','.css','.scss','.sql','.sh','.ps1','.bat','.toml','.ini','.conf','.log'
]);

function cleanXmlText(xml) {
  return String(xml || '')
    .replace(/<w:tab\/?\s*>/g, '\t')
    .replace(/<w:br\/?\s*>/g, '\n')
    .replace(/<\/w:p>/g, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function extractDocx(buffer) {
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(buffer, { lazyEntries: true }, (error, zip) => {
      if (error) return reject(error);
      let settled = false;
      const done = (err, value) => {
        if (settled) return;
        settled = true;
        try { zip.close(); } catch {}
        err ? reject(err) : resolve(value);
      };
      zip.readEntry();
      zip.on('entry', (entry) => {
        if (entry.fileName !== 'word/document.xml') {
          zip.readEntry();
          return;
        }
        zip.openReadStream(entry, (streamError, stream) => {
          if (streamError) return done(streamError);
          const chunks = [];
          stream.on('data', (chunk) => chunks.push(chunk));
          stream.on('error', done);
          stream.on('end', () => done(null, cleanXmlText(Buffer.concat(chunks).toString('utf8'))));
        });
      });
      zip.on('end', () => done(new Error('DOCX document.xml not found.')));
      zip.on('error', done);
    });
  });
}

async function extractText(name, buffer) {
  const ext = path.extname(String(name || '')).toLowerCase();
  if (TEXT_EXTENSIONS.has(ext)) return buffer.toString('utf8').slice(0, MAX_EXTRACTED_CHARS);
  if (ext === '.docx') return (await extractDocx(buffer)).slice(0, MAX_EXTRACTED_CHARS);
  const error = new Error('Unsupported document type. Use TXT, Markdown, CSV, JSON, source code, or DOCX.');
  error.status = 415;
  throw error;
}

function createDocumentStore() {
  const documents = new Map();

  return {
    async add({ name, mime, base64 }) {
      const fileName = String(name || 'document').slice(0, 240);
      let buffer;
      try { buffer = Buffer.from(String(base64 || ''), 'base64'); }
      catch {
        const error = new Error('Invalid file payload.');
        error.status = 400;
        throw error;
      }
      if (!buffer.length) {
        const error = new Error('File is empty.');
        error.status = 400;
        throw error;
      }
      if (buffer.length > MAX_FILE_BYTES) {
        const error = new Error('File is larger than 10 MB.');
        error.status = 413;
        throw error;
      }

      const text = await extractText(fileName, buffer);
      const id = crypto.randomUUID();
      const row = {
        id,
        name: fileName,
        mime: String(mime || 'application/octet-stream'),
        size: buffer.length,
        chars: text.length,
        text,
        createdAt: Date.now(),
      };
      documents.set(id, row);
      return { id, name: row.name, mime: row.mime, size: row.size, chars: row.chars };
    },

    get(id) {
      return documents.get(String(id || '')) || null;
    },

    remove(id) {
      return documents.delete(String(id || ''));
    },

    list() {
      return [...documents.values()].map(({ text, ...meta }) => meta);
    },

    buildContext(ids, maxChars = 50000) {
      let remaining = Math.max(1000, Number(maxChars) || 50000);
      const chunks = [];
      for (const id of Array.isArray(ids) ? ids : []) {
        const doc = documents.get(String(id));
        if (!doc || remaining <= 0) continue;
        const part = doc.text.slice(0, remaining);
        remaining -= part.length;
        chunks.push('--- Attached file: ' + doc.name + ' ---\n' + part);
      }
      return chunks.join('\n\n');
    },
  };
}

module.exports = { createDocumentStore, extractText, MAX_FILE_BYTES, MAX_EXTRACTED_CHARS };
