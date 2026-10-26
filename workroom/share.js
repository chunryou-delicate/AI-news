'use strict';
// 업무방 현황판 공유 보기: 다른 사람에게 내 현황판을 구경만 시키는 읽기 전용 서버.
// 본 서버(server.js)와 따로 돌고, 아무 파일도 쓰지 않고, 아무 프로세스(send.js·sync.js·hook.js)도 띄우지 않는다.
//   - GET·HEAD 만 받는다. 지시 보내기·확인·고용·해고·이름 바꾸기·일감 같은 요청(/__send 등)은 모두 403.
//   - 내보내는 것은 현황판 화면과 그 화면이 읽는 파일(server.js 와 같은 목록), 그리고 읽기만 하는 /__acks·/__tasks.
//   - 현황판 화면에 window.WR_SHARE 를 넣어, 화면이 바꾸는 단추를 감추고 요청을 보내지 않게 한다.
//   - 열쇠가 없는 대신 이 컴퓨터(127.0.0.1)에서만 열린다. 바깥에는 --tunnel 로 직접 켠 임시 터널로만 나간다.
// 사용법: node share.js              공유 보기만 띄운다 (이 컴퓨터에서 http://localhost:8791)
//         node share.js --tunnel     공유 보기 + Cloudflare 임시 터널을 띄우고 바깥 링크를 화면에 보여 준다
//                                    (링크는 파일에 적지 않는다. 이 창을 닫거나 Ctrl+C 를 누르면 둘 다 꺼진다)
//         --port <번호>              다른 포트로 (기본 8791)

const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = __dirname;
const PAGE = '/현황판.html';
const ALLOWED = /^\/(현황판\.html|office3d\.js|state\.js|speech\.js|logs\/r[0-9a-f]+\.js|models\/p\d+\.js|minutes-index\.js|minutes-js\/[a-z0-9-]+\.js|activity\.js)$/;
const CACHED = /^\/models\//;
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8' };
const MARK = '<script>window.WR_SHARE = true;</script>';

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
const PORT = Number(arg('--port', 8791)) || 8791;

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { return fallback; }
}
function sendJson(res, headers, code, obj) {
  res.writeHead(code, Object.assign({}, headers, { 'Content-Type': 'application/json; charset=utf-8' })).end(JSON.stringify(obj));
}

// 확인한 것(다른 기기·컴퓨터 것까지 합친 것)과 일감 보드는 읽기만 한다
function acksNow() {
  try { return require('./acks.js').merged(); } catch (_) { return {}; }
}
function tasksNow() {
  const d = readJson(path.join(ROOT, 'tasks.json'), null) || {};
  return { tasks: Array.isArray(d.tasks) ? d.tasks : [], schedules: Array.isArray(d.schedules) ? d.schedules : [] };
}

function serve(onReady) {
  const server = http.createServer((req, res) => {
    const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'X-Robots-Tag': 'noindex' };
    if (req.method !== 'GET' && req.method !== 'HEAD') { sendJson(res, headers, 403, { ok: false, error: '공유 보기에서는 바꿀 수 없어요' }); return; }
    let pathname;
    try { pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname); } catch (_) { res.writeHead(400, headers).end(); return; }
    if (pathname === '/__acks') { sendJson(res, headers, 200, { ok: true, acks: acksNow() }); return; }
    if (pathname === '/__tasks') { sendJson(res, headers, 200, Object.assign({ ok: true }, tasksNow())); return; }
    if (pathname.startsWith('/__')) { sendJson(res, headers, 403, { ok: false, error: '공유 보기에서는 할 수 없어요' }); return; }
    if (pathname === '/') { res.writeHead(302, Object.assign(headers, { Location: encodeURI(PAGE) })).end(); return; }
    if (!ALLOWED.test(pathname)) { res.writeHead(404, headers).end(); return; }
    if (CACHED.test(pathname)) headers['Cache-Control'] = 'public, max-age=604800';
    fs.readFile(path.join(ROOT, pathname), (err, body) => {
      if (err) { res.writeHead(404, headers).end(); return; }
      // 현황판 화면에는 공유 보기 표시를 넣는다 (바꾸는 단추를 감추고 요청을 보내지 않게)
      if (pathname === PAGE) body = Buffer.from(String(body).replace('</head>', MARK + '</head>'));
      res.writeHead(200, Object.assign(headers, { 'Content-Type': TYPES[path.extname(pathname)] || 'application/octet-stream' }));
      res.end(req.method === 'HEAD' ? undefined : body);
    });
  });
  server.on('error', (e) => {
    console.error(e.code === 'EADDRINUSE' ? `포트 ${PORT} 를 이미 쓰고 있어요. 공유 보기가 이미 떠 있거나, --port 로 다른 번호를 주세요.` : String(e.message || e));
    process.exit(1);
  });
  server.listen(PORT, '127.0.0.1', () => {
    console.log(`공유 보기(읽기 전용): http://localhost:${PORT}  (이 컴퓨터에서만)`);
    if (onReady) onReady();
  });
}

// 임시 터널: 새 주소가 나오면 화면에만 보여 준다. cloudflared 가 끝나면 10초 뒤 다시 띄운다 (주소는 바뀐다).
function tunnel() {
  const bin = path.join(ROOT, 'bin', process.platform === 'win32' ? 'cloudflared.exe' : 'cloudflared');
  if (!fs.existsSync(bin)) { console.log('cloudflared 가 없어요 (bin/). 이 컴퓨터 안에서만 볼 수 있어요.'); return; }
  let child = null, current = '', quitting = false;
  const run = () => {
    child = spawn(bin, ['tunnel', '--no-autoupdate', '--url', `http://localhost:${PORT}`], { windowsHide: true });
    const onData = (buf) => {
      const m = buf.toString().match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
      if (m && m[0] !== current) {
        current = m[0];
        console.log(`\n바깥 공유 링크(읽기 전용): ${current}\n이 링크를 받은 사람은 누구나 현황판을 볼 수 있어요. 그만 보이려면 이 창을 닫거나 Ctrl+C.\n`);
      }
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.on('exit', () => { if (!quitting) { console.log('터널이 끊겼어요. 10초 뒤 다시 띄워요 (주소가 바뀌어요).'); setTimeout(run, 10000); } });
  };
  const stop = () => { quitting = true; try { if (child) child.kill(); } catch (_) {} process.exit(0); };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  process.on('SIGHUP', stop);
  run();
}

serve(process.argv.includes('--tunnel') ? tunnel : null);
