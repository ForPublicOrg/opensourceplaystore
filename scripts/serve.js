#!/usr/bin/env node
/* Tiny static server for local preview of dist/. Zero dependencies.
   Usage: node scripts/serve.js [port]   (default 8080) */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');

const DIST = path.join(__dirname, '..', 'dist');
const PORT = Number(process.argv[2]) || 8080;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webmanifest': 'application/manifest+json',
  '.xml': 'application/xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
};

http.createServer((req, res) => {
  const urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  let file = path.normalize(path.join(DIST, urlPath));
  if (file !== DIST && !file.startsWith(DIST + path.sep)) {
    res.writeHead(403).end('forbidden');
    return;
  }
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
  if (!fs.existsSync(file)) file = path.join(DIST, '404.html');
  const ext = path.extname(file).toLowerCase();
  res.writeHead(fs.existsSync(file) ? (file.endsWith('404.html') ? 404 : 200) : 404, {
    'Content-Type': MIME[ext] || 'application/octet-stream',
  });
  fs.createReadStream(file).pipe(res);
}).listen(PORT, () => {
  console.log(`Serving dist/ at http://localhost:${PORT}`);
});
