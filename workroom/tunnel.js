'use strict';
// 밖에서도 폰으로 현황판을 볼 수 있게 Cloudflare 임시 터널(trycloudflare.com)을 띄운다.
// server.js 가 이 PC에서 띄운 현황판(열쇠가 있어야 열림)을 그대로 바깥 주소로 이어 준다.
// 임시 터널은 다시 띄울 때마다 주소가 바뀌므로, 새 주소가 나오면
//   - tunnel.json 에 적고
//   - 비공개 동기화 저장소(sync.json 의 repo) main 브랜치의 LINK.md 에 링크를 적어 둔다 (폰의 GitHub에서 확인).
// 사용법: node tunnel.js          터널을 띄우고 계속 지킨다 (cloudflared 가 끝나면 다시 띄움)
//         node tunnel.js --link   지금 바깥 링크만 보여 준다

const fs = require('fs');
const path = require('path');
const { spawn, execFileSync } = require('child_process');

const ROOT = __dirname;
const BIN = path.join(ROOT, 'bin', process.platform === 'win32' ? 'cloudflared.exe' : 'cloudflared');
const TUNNEL_FILE = path.join(ROOT, 'tunnel.json');
const PID_FILE = path.join(ROOT, 'tunnel.pid');
const LOG_FILE = path.join(ROOT, 'tunnel.log');
const LINK_DIR = path.join(ROOT, 'link-repo');

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { return fallback; }
}

function log(msg) {
  try {
    if (fs.existsSync(LOG_FILE) && fs.statSync(LOG_FILE).size > 512 * 1024) fs.writeFileSync(LOG_FILE, '');
    fs.appendFileSync(LOG_FILE, `[${new Date().toISOString()}] ${msg}\n`);
  } catch (_) {}
}

function alive(pid) {
  try { process.kill(Number(pid), 0); return true; } catch (e) { return e.code === 'EPERM'; }
}

function git(args) {
  return execFileSync('git', ['-C', LINK_DIR].concat(args), {
    encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    env: Object.assign({}, process.env, { GIT_TERMINAL_PROMPT: '0' }),
  });
}

// 비공개 저장소 main 브랜치의 LINK.md 에 지금 링크를 적는다.
function publishLink(link) {
  const sync = readJson(path.join(ROOT, 'sync.json'), null);
  if (!sync || !sync.repo) return;
  try {
    if (!fs.existsSync(path.join(LINK_DIR, '.git'))) {
      fs.mkdirSync(LINK_DIR, { recursive: true });
      git(['init', '-q']);
      git(['remote', 'add', 'origin', sync.repo]);
    }
    git(['fetch', '-q', '--depth', '1', 'origin', 'main']);
    git(['checkout', '-q', '-B', 'main', 'FETCH_HEAD']);
    const now = new Date();
    fs.writeFileSync(path.join(LINK_DIR, 'LINK.md'), [
      '# 업무방 현황판 바깥 링크',
      '',
      `**[현황판 열기](${link})**`,
      '',
      `- 주소: ${link}`,
      `- 바뀐 시각: ${now.toLocaleString('ko-KR')}`,
      '- 집 PC를 다시 켜면 주소가 바뀌고, 이 파일도 새 주소로 바뀌어요.',
      '',
    ].join('\n'));
    git(['add', 'LINK.md']);
    git(['-c', 'user.name=workroom', '-c', 'user.email=workroom@localhost', 'commit', '-q', '-m', `현황판 링크 갱신 ${now.toISOString()}`]);
    git(['push', '-q', 'origin', 'main']);
    log('LINK.md 갱신');
  } catch (e) {
    log('LINK.md 갱신 실패: ' + String(e.stderr || e.message).trim().slice(0, 300));
  }
}

function start(token) {
  let current = '';
  const run = () => {
    const child = spawn(BIN, ['tunnel', '--no-autoupdate', '--url', `http://localhost:${token.port}`], { windowsHide: true });
    const onData = (buf) => {
      const text = buf.toString();
      const m = text.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
      if (m && m[0] !== current) {
        current = m[0];
        const link = `${current}/?k=${token.token}`;
        fs.writeFileSync(TUNNEL_FILE, JSON.stringify({ url: current, link, startedAt: Date.now() }, null, 2));
        log('새 주소 ' + current);
        publishLink(link);
      }
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.on('exit', (code) => {
      log(`cloudflared 종료 (${code}), 10초 뒤 다시 띄움`);
      setTimeout(run, 10000);
    });
  };
  run();
}

function main() {
  if (process.argv.includes('--link')) {
    const t = readJson(TUNNEL_FILE, null);
    console.log(t ? t.link : '아직 터널이 없어요');
    return;
  }
  const pid = fs.existsSync(PID_FILE) ? fs.readFileSync(PID_FILE, 'utf8').trim() : '';
  if (pid && alive(pid) && Number(pid) !== process.pid) return;   // 이미 떠 있음
  fs.writeFileSync(PID_FILE, String(process.pid));
  const server = readJson(path.join(ROOT, 'server.json'), null);
  if (!server || !server.token) { log('server.json 이 없어요. server.js 를 먼저 띄우세요.'); return; }
  log('터널 시작');
  start({ port: Number(server.port) || 8790, token: server.token });
}

main();
