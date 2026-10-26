'use strict';
// 업무방 현황판을 같은 와이파이의 폰에서도 볼 수 있게 이 PC에서 띄우는 작은 웹 서버.
// 현황판 화면과 그 화면이 읽는 파일(state.js, speech.js, logs/*.js, 회의록 트리 minutes-index.js·minutes-js/*.js,
// 3D 화면 office3d.js·models/*.js)만 내보내고,
// 링크에 붙은 열쇠(k)가 맞아야 열린다. 처음 한 번 열면 30일 동안 쿠키로 기억한다.
// 사용법: node server.js          (설정은 server.json: { "port": 8790, "token": "...", "host": "0.0.0.0" }, 없으면 만든다)
//         node server.js --link   폰에서 열 링크만 보여 준다
//         node server.js --open   이 컴퓨터 브라우저로 현황판을 연다 (링크를 화면에 찍지 않음)
// host 를 "127.0.0.1" 로 두면 이 컴퓨터에서만 열린다 (회사 노트북처럼 같은 망의 다른 기기에 보이면 안 될 때).
// 동기화(sync.json)를 켠 컴퓨터에서는 서버가 떠 있는 동안 다른 컴퓨터 현황을 계속 받아 온다 (keepSyncing).
// 지시 보내기: 현황판 세션 창에서 보낸 말을 send.js 로 그 세션 터미널에 넣는다 (다른 컴퓨터 세션은 동기화로).
//   열쇠가 맞고 X-Workroom: send 머리글이 붙은 POST 만 받는다 (다른 사이트가 몰래 보내지 못하게).
//   Orca 가 느린 컴퓨터에서도 서버가 멈추지 않게 send.js 를 따로 띄운 프로세스로 한 번에 하나씩 돌린다.
// 사람 고용(/__hire): 방 패널에서 이름을 적으면 send.js --hire 로 그 방 프로젝트 폴더에 새 Claude 세션을 띄운다 (같은 열쇠·머리글·순서).
//   server.json 에 "send": false 를 두면 끈다. (고용도 함께 꺼진다)

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const ROOT = __dirname;
const CFG_FILE = path.join(ROOT, 'server.json');
const PAGE = '/현황판.html';
const ALLOWED = /^\/(현황판\.html|office3d\.js|state\.js|speech\.js|logs\/r[0-9a-f]+\.js|models\/p\d+\.js|minutes-index\.js|minutes-js\/[a-z0-9-]+\.js)$/;
const CACHED = /^\/models\//;   // 3D 사람 모델은 크고 잘 안 바뀌어서 폰이 기억해 두게 한다 (바뀌면 ?v= 를 올린다)
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
  cfg.host = cfg.host || '0.0.0.0';
  return cfg;
}

function localOnly(cfg) {
  return cfg.host === '127.0.0.1' || cfg.host === 'localhost' || cfg.host === '::1';
}

function lanAddresses() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list || []) if (a.family === 'IPv4' && !a.internal && !a.address.startsWith('169.254.')) out.push(a.address);
  }
  return out;
}

function links(cfg) {
  const hosts = ['localhost'].concat(localOnly(cfg) ? [] : lanAddresses());
  return hosts.map((h) => `http://${h}:${cfg.port}/?k=${cfg.token}`);
}

// 작업 스케줄러나 훅이 한동안 동기화하지 않았으면 서버가 대신 sync.js 를 돌린다.
// 리눅스처럼 작업 스케줄러(--schedule)가 없는 컴퓨터도 서버만 떠 있으면 다른 컴퓨터 현황이 계속 새로 온다.
function keepSyncing() {
  const tick = () => {
    const sync = readJson(path.join(ROOT, 'sync.json'), null);
    if (!sync || !sync.repo) return;
    const last = (readJson(path.join(ROOT, 'sync-status.json'), null) || {}).lastRun || 0;
    if (Date.now() - last < (Number(sync.intervalSec) || 60) * 1500) return;
    try {
      require('child_process').spawn(process.execPath, [path.join(ROOT, 'sync.js')], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
    } catch (_) {}
  };
  setTimeout(tick, 5000);
  setInterval(tick, 30 * 1000);
}

// 터널(cloudflared)로 들어온 요청도 127.0.0.1 에서 오므로, 전달 헤더가 붙은 것은 바깥 요청으로 본다.
function fromThisComputer(req) {
  const a = String(req.socket.remoteAddress || '');
  if (req.headers['cf-connecting-ip'] || req.headers['x-forwarded-for']) return false;
  return a === '127.0.0.1' || a === '::1' || a === '::ffff:127.0.0.1';
}

function sameToken(a, b) {
  const x = Buffer.from(String(a || ''));
  const y = Buffer.from(String(b || ''));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

// 지시 보내기 요청 본문 (작은 JSON 만)
function readBody(req, max) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > max) { reject(new Error('too big')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}
function sendJson(res, headers, code, obj) {
  res.writeHead(code, Object.assign({}, headers, { 'Content-Type': 'application/json; charset=utf-8' })).end(JSON.stringify(obj));
}
// 지시 보내기·사람 고용은 한 번에 하나씩, 따로 띄운 node 프로세스로 (기다리는 동안에도 현황판 파일은 계속 나간다)
let sendChain = Promise.resolve();
function sendInChild(args, what) {
  const job = () => new Promise((resolve) => {
    let out = '', done = false, timer = null, child = null;
    const finish = (r) => { if (done) return; done = true; clearTimeout(timer); resolve(r); };
    try {
      child = require('child_process').spawn(process.execPath, [path.join(ROOT, 'send.js')].concat(args), { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
    } catch (_) { finish({ ok: false, error: `${what} 프로세스를 띄우지 못했어요` }); return; }
    timer = setTimeout(() => { try { child.kill(); } catch (_) {} finish({ ok: false, error: `${what}가 2분 안에 끝나지 않았어요 (Orca 가 느려요)` }); }, 120 * 1000);
    child.stdout.on('data', (c) => { out += c; });
    child.on('error', () => finish({ ok: false, error: `${what} 프로세스를 띄우지 못했어요` }));
    // 'close' 는 하위 프로세스가 파이프를 쥐고 있으면 늦게 오므로 'exit' 에서 마무리한다
    child.on('exit', () => setTimeout(() => {
      const last = out.trim().split(/\r?\n/).pop();
      try { finish(JSON.parse(last)); } catch (_) { finish({ ok: false, error: `${what}를 하지 못했어요` }); }
    }, 100));
  });
  const p = sendChain.then(job, job);
  sendChain = p.catch(() => {});
  return p;
}
// 다른 컴퓨터로 가는 것은 바로 동기화를 한 번 돌려 빨리 올린다
function syncSoon(r) {
  if (!r.ok || r.status !== 'queued') return;
  try { require('child_process').spawn(process.execPath, [path.join(ROOT, 'sync.js')], { detached: true, stdio: 'ignore', windowsHide: true }).unref(); } catch (_) {}
}

function handleSend(cfg, req, res, headers, pathname, u) {
  if (cfg.send === false) { sendJson(res, headers, 403, { ok: false, error: '이 컴퓨터는 지시 보내기를 꺼 두었어요' }); return; }
  if (pathname === '/__sends') {
    const sendMod = require('./send.js');
    const sid = u.searchParams.get('sid');
    const list = sendMod.readLog().filter((e) => !sid || e.sid === sid).slice(-20).map((e) => ({
      id: e.id, at: e.at, sid: e.sid, text: e.text, status: e.status, error: e.error || '', toMachine: e.toMachine || '', doneAt: e.doneAt || 0,
    }));
    sendJson(res, headers, 200, { ok: true, list });
    return;
  }
  if (req.method !== 'POST' || req.headers['x-workroom'] !== 'send') { sendJson(res, headers, 400, { ok: false, error: '잘못된 요청' }); return; }
  readBody(req, 8192).then((body) => {
    let j;
    try { j = JSON.parse(body); } catch (_) { sendJson(res, headers, 400, { ok: false, error: '잘못된 요청' }); return; }
    if (pathname === '/__hire') {
      // 사람 고용: 그 방 프로젝트 폴더에 새 Claude 세션 (이름 = 세션 이름·Orca 탭 제목)
      const room = String(j.room || '').slice(0, 120), name = String(j.name || '').slice(0, 80);
      if (!room || !name.trim()) { sendJson(res, headers, 409, { ok: false, error: '방과 이름이 필요해요' }); return; }
      sendInChild(['--hire', '--json', room, name], '고용').then((r) => { syncSoon(r); sendJson(res, headers, r.ok ? 200 : 409, r); });
      return;
    }
    const sid = String(j.sid || ''), text = String(j.text || '').slice(0, 2000);
    if (!sid || !text.trim()) { sendJson(res, headers, 409, { ok: false, error: '보낼 말이 비어 있어요' }); return; }
    sendInChild(['--json', sid, text], '보내기').then((r) => { syncSoon(r); sendJson(res, headers, r.ok ? 200 : 409, r); });
  }, () => sendJson(res, headers, 413, { ok: false, error: '너무 길어요' }));
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
    // 다른 앱에서 링크를 눌러 들어와도 쿠키가 실리도록 Lax 로 둔다 (Strict 면 첫 이동에서 쿠키가 빠져 막힌다).
    if (fromQuery) headers['Set-Cookie'] = `wr=${cfg.token}; Max-Age=${30 * 24 * 3600}; Path=/; HttpOnly; SameSite=Lax`;
    let pathname;
    try { pathname = decodeURIComponent(u.pathname); } catch (_) { res.writeHead(400).end(); return; }
    if (pathname === '/__quit' && fromThisComputer(req)) {
      // deploy.js 가 새 코드로 다시 띄우기 전에 부른다 (이 컴퓨터에서, 열쇠가 맞을 때만).
      res.writeHead(200, headers).end('bye');
      setTimeout(() => process.exit(0), 100);
      return;
    }
    if (pathname === '/__send' || pathname === '/__sends' || pathname === '/__hire') { handleSend(cfg, req, res, headers, pathname, u); return; }
    if (pathname === '/') {
      // 쿠키가 아직 안 실려도 열리도록 열쇠를 주소에 붙인 채로 화면으로 보낸다.
      res.writeHead(302, Object.assign(headers, { Location: encodeURI(PAGE) + (fromQuery ? `?k=${encodeURIComponent(fromQuery)}` : '') })).end();
      return;
    }
    if (!ALLOWED.test(pathname)) { res.writeHead(404, headers).end(); return; }
    if (CACHED.test(pathname)) headers['Cache-Control'] = 'private, max-age=604800';
    fs.readFile(path.join(ROOT, pathname), (err, body) => {
      if (err) { res.writeHead(404, headers).end(); return; }
      res.writeHead(200, Object.assign(headers, { 'Content-Type': TYPES[path.extname(pathname)] || 'application/octet-stream' })).end(body);
    });
  });
  server.on('error', (e) => {
    if (e.code === 'EADDRINUSE') process.exit(0);   // 이미 떠 있으면 그대로 둔다
    throw e;
  });
  server.listen(cfg.port, cfg.host, () => {
    for (const l of links(cfg)) console.log(l);
    keepSyncing();
  });
}

const cfg = loadConfig();
if (process.argv.includes('--link')) {
  for (const l of links(cfg)) console.log(l);
} else if (process.argv.includes('--open')) {
  // 열쇠가 든 링크를 화면에 찍지 않고 이 컴퓨터 브라우저로 바로 연다. 한 번 열면 30일 동안 localhost:<port> 만으로 열린다.
  const url = `http://localhost:${cfg.port}/?k=${cfg.token}`;
  const [cmd, cmdArgs] = process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]]
    : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
  require('child_process').spawn(cmd, cmdArgs, { detached: true, stdio: 'ignore', windowsHide: true }).unref();
} else {
  serve(cfg);
}
