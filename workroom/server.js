'use strict';
// 업무방 현황판을 같은 와이파이의 폰에서도 볼 수 있게 이 PC에서 띄우는 작은 웹 서버.
// 현황판 화면과 그 화면이 읽는 파일(state.js, speech.js, logs/*.js)만 내보내고,
// 링크에 붙은 열쇠(k)가 맞아야 열린다. 처음 한 번 열면 30일 동안 쿠키로 기억한다.
// 사용법: node server.js          (설정은 server.json: { "port": 8790, "token": "..." }, 없으면 만든다)
//         node server.js --link   폰에서 열 링크만 보여 준다

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const ROOT = __dirname;
const CFG_FILE = path.join(ROOT, 'server.json');
const PAGE = '/현황판.html';
const ALLOWED = /^\/(현황판\.html|state\.js|speech\.js|logs\/r[0-9a-f]+\.js)$/;
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8' };

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { return fallback; }
}

function loadConfig() {
  let cfg = readJson(CFG_FILE, null) || {};
  if (!cfg.token) {
    cfg = Object.assign({ port: 8790 }, cfg, { token: crypto.randomBytes(12).toString('hex') });
    fs.writeFileSync(CFG_FILE, JSON.stringify(cfg, null, 2) + '\n');
  }
  cfg.port = Number(cfg.port) || 8790;
  return cfg;
}

function lanAddresses() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list || []) if (a.family === 'IPv4' && !a.internal && !a.address.startsWith('169.254.')) out.push(a.address);
  }
  return out;
}

function links(cfg) {
  return lanAddresses().map((ip) => `http://${ip}:${cfg.port}/?k=${cfg.token}`);
}

function sameToken(a, b) {
  const x = Buffer.from(String(a || ''));
  const y = Buffer.from(String(b || ''));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

function serve(cfg) {
  const server = http.createServer((req, res) => {
    let u;
    try { u = new URL(req.url, 'http://localhost'); } catch (_) { res.writeHead(400).end(); return; }
    const cookie = (req.headers.cookie || '').split(';').map((c) => c.trim()).find((c) => c.startsWith('wr='));
    const fromQuery = u.searchParams.get('k');
    const ok = sameToken(fromQuery, cfg.token) || sameToken(cookie && cookie.slice(3), cfg.token);
    if (!ok) {
      res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' }).end('링크가 올바르지 않아요. PC에서 받은 링크로 열어 주세요.');
      return;
    }
    const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' };
    if (fromQuery) headers['Set-Cookie'] = `wr=${cfg.token}; Max-Age=${30 * 24 * 3600}; Path=/; HttpOnly; SameSite=Strict`;
    let pathname;
    try { pathname = decodeURIComponent(u.pathname); } catch (_) { res.writeHead(400).end(); return; }
    if (pathname === '/') {
      res.writeHead(302, Object.assign(headers, { Location: encodeURI(PAGE) })).end();
      return;
    }
    if (!ALLOWED.test(pathname)) { res.writeHead(404, headers).end(); return; }
    fs.readFile(path.join(ROOT, pathname), (err, body) => {
      if (err) { res.writeHead(404, headers).end(); return; }
      res.writeHead(200, Object.assign(headers, { 'Content-Type': TYPES[path.extname(pathname)] || 'application/octet-stream' })).end(body);
    });
  });
  server.on('error', (e) => {
    if (e.code === 'EADDRINUSE') process.exit(0);   // 이미 떠 있으면 그대로 둔다
    throw e;
  });
  server.listen(cfg.port, '0.0.0.0', () => {
    for (const l of links(cfg)) console.log(l);
  });
}

const cfg = loadConfig();
if (process.argv.includes('--link')) {
  for (const l of links(cfg)) console.log(l);
} else {
  serve(cfg);
}
