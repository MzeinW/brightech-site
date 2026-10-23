#!/usr/bin/env node
'use strict';
/**
 * Local preview of a built site (default dist/), with Netlify-style _headers and pretty URLs.
 *   node scripts/serve.js [dir] [port]          (port defaults to 8099; binds to 127.0.0.1 only)
 * To preview the backoffice too:  BT_INCLUDE_ADMIN=1 node scripts/build.js && node scripts/serve.js
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const dir = path.resolve(process.argv[2] || path.join(__dirname, '..', 'dist'));
const port = Number(process.argv[3] || process.env.PORT || 8099);
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.yml': 'text/yaml; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml', '.woff2': 'font/woff2', '.ico': 'image/x-icon',
};

function headerRules() {
  const f = path.join(dir, '_headers');
  if (!fs.existsSync(f)) return [];
  const rules = [];
  let cur = null;
  for (const line of fs.readFileSync(f, 'utf8').split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    if (/^\s/.test(line)) { const i = line.indexOf(':'); if (cur && i > 0) cur.headers.push([line.slice(0, i).trim(), line.slice(i + 1).trim()]); }
    else { cur = { pattern: line.trim(), headers: [] }; rules.push(cur); }
  }
  return rules;
}
const matches = (pattern, p) => (pattern.endsWith('/*') ? p.startsWith(pattern.slice(0, -1)) : pattern === p);

http.createServer((req, res) => {
  let p;
  try { p = decodeURIComponent(new URL(req.url, 'http://x').pathname); } catch (e) { res.writeHead(400); return res.end('bad request'); }
  if (p.includes('\0') || p.split('/').includes('..')) { res.writeHead(400); return res.end('bad path'); }
  const extra = [];
  for (const r of headerRules()) if (matches(r.pattern, p)) extra.push(...r.headers);

  let file = path.join(dir, p);
  let status = 200;
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) {
    if (!p.endsWith('/')) { res.writeHead(301, { Location: p + '/' }); return res.end(); }
    file = path.join(file, 'index.html');
  } else if (!fs.existsSync(file) && fs.existsSync(file + '.html')) file += '.html'; // pretty URLs
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
    file = path.join(dir, '404.html'); status = 404;
    if (!fs.existsSync(file)) { res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('not found'); }
  }
  const headers = { 'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' };
  for (const [k, v] of extra) headers[k] = v;
  res.writeHead(status, headers);
  fs.createReadStream(file).pipe(res);
}).listen(port, '127.0.0.1', () => console.log('serving ' + dir + ' at http://127.0.0.1:' + port + '/'));
