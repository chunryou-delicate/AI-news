'use strict';
// 저장소의 현황판 코드를 실제로 돌아가는 위치(~/.claude/workroom)에 복사하고 Claude Code 훅을 설치한다.
// 사용법:
//   node deploy.js                 코드 복사 + 훅 설치 (rooms.json 은 없을 때만 복사)
//   node deploy.js --rooms         rooms.json 도 덮어쓴다
//   node deploy.js --no-hooks      훅 설정은 건드리지 않는다
// 다른 컴퓨터와 주고받기 (비공개 git 저장소 사용):
//   보내는 쪽: node deploy.js --machine "회사 노트북" --sync <저장소 주소> --push --auto-rooms
//   받는 쪽:   node deploy.js --machine "집 컴퓨터" --sync <저장소 주소> --pull --schedule
//   모든 컴퓨터가 주고받기(각자 자기 현황판): node deploy.js --machine "회사 노트북" --sync <저장소 주소> --push --pull --server
//   --auto-rooms  방 목록 대신 세션의 프로젝트 폴더 이름으로 방을 만든다
//   --schedule    (Windows) 1분마다 받아 오도록 작업 스케줄러에 등록한다. --unschedule 로 지운다
//   --server      이 컴퓨터 현황판 서버(server.js)를 로그인할 때 자동으로 뜨게 하고 지금 (다시) 띄운다.
//                 서버가 떠 있는 동안 1분마다 동기화하므로 리눅스에서도 --schedule 이 필요 없다. --unserver 로 끈다
//   --local       서버를 이 컴퓨터에서만 열리게 한다 (같은 망의 폰·다른 기기에서는 안 열림)

const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');
const { execFileSync, spawn, spawnSync } = require('child_process');

const TARGET = path.join(os.homedir(), '.claude', 'workroom');
const CODE = ['hook.js', 'install-hooks.js', 'sync.js', 'server.js', 'send.js', 'board.js', 'notify.js', 'statusline.js', 'tunnel.js', '현황판.html', 'office3d.js'];
const TASK = 'WorkroomSync';
const argv = process.argv.slice(2);
const has = (flag) => argv.includes(flag);
const valueOf = (flag) => { const i = argv.indexOf(flag); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : ''; };

fs.mkdirSync(TARGET, { recursive: true });
for (const f of CODE) {
  fs.copyFileSync(path.join(__dirname, f), path.join(TARGET, f));
  console.log('복사:', f);
}

// 3D 사람 모델 (models/p<번호>.js). 저장소에 있는 것만 복사하고, 이 PC에만 있는 모델은 그대로 둔다.
const MODELS = path.join(__dirname, 'models');
if (fs.existsSync(MODELS)) {
  fs.mkdirSync(path.join(TARGET, 'models'), { recursive: true });
  const files = fs.readdirSync(MODELS).filter((f) => /^p\d+\.js$/.test(f));
  files.forEach((f) => fs.copyFileSync(path.join(MODELS, f), path.join(TARGET, 'models', f)));
  console.log(`복사: models/ (${files.length}명)`);
}

const rooms = path.join(TARGET, 'rooms.json');
// 기본 방 목록(rooms.json)은 만든 사람 PC의 폴더라서, 그 폴더가 하나도 없는 컴퓨터에서는 자동 방(프로젝트 폴더 이름)으로 한다.
function defaultRoomsFit() {
  try {
    const def = JSON.parse(fs.readFileSync(path.join(__dirname, 'rooms.json'), 'utf8'));
    return (def.rooms || []).some((r) => (r.paths || []).some((p) => fs.existsSync(p)));
  } catch (_) { return false; }
}
if (!has('--auto-rooms') && !fs.existsSync(rooms) && !defaultRoomsFit()) {
  argv.push('--auto-rooms');
  console.log('기본 방 목록의 폴더가 이 컴퓨터에 없어서 프로젝트 폴더 이름으로 방을 만들어요.');
}
if (has('--auto-rooms')) {
  if (!fs.existsSync(rooms) || has('--rooms')) {
    fs.writeFileSync(rooms, JSON.stringify({ auto: true }, null, 2) + '\n');
    console.log('rooms.json: 프로젝트 폴더 이름으로 방 만들기');
  } else {
    console.log('그대로 둠: rooms.json (덮어쓰려면 --rooms)');
  }
} else if (!fs.existsSync(rooms) || has('--rooms')) {
  fs.copyFileSync(path.join(__dirname, 'rooms.json'), rooms);
  console.log('복사: rooms.json');
} else {
  console.log('그대로 둠: rooms.json (덮어쓰려면 --rooms)');
}

const readJson = (file) => { try { return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, '')); } catch (_) { return null; } };

const repo = valueOf('--sync');
if (repo) {
  // 컴퓨터 이름이 바뀌면 저장소에 새 브랜치가 생겨 같은 컴퓨터가 두 번 보이므로, 따로 주지 않으면 전 이름을 쓴다.
  const prev = readJson(path.join(TARGET, 'sync.json')) || {};
  const cfg = Object.assign({}, prev, {
    repo,
    machine: valueOf('--machine') || prev.machine || os.hostname(),
    push: has('--push'),
    pull: has('--pull'),
    intervalSec: Number(valueOf('--interval')) || prev.intervalSec || 60,
  });
  fs.writeFileSync(path.join(TARGET, 'sync.json'), JSON.stringify(cfg, null, 2) + '\n');
  console.log(`sync.json: ${cfg.machine} (${[cfg.push && '보내기', cfg.pull && '받기'].filter(Boolean).join(', ') || '꺼짐'})`);
}

if (!has('--no-hooks')) {
  execFileSync(process.execPath, [path.join(TARGET, 'install-hooks.js')], { stdio: 'inherit' });
}
execFileSync(process.execPath, [path.join(TARGET, 'hook.js'), '--rebuild'], { stdio: 'inherit' });

if (repo) {
  // 처음 한 번은 앞에서 돌려서, git 로그인 창이 뜨면 바로 로그인할 수 있게 한다.
  console.log('첫 동기화 중…');
  execFileSync(process.execPath, [path.join(TARGET, 'sync.js'), '--interactive', '--verbose'], { stdio: 'inherit' });
}

if (has('--schedule') && process.platform === 'win32') {
  // 콘솔 창이 깜빡이지 않도록 wscript 로 숨겨서 실행한다.
  const vbs = path.join(TARGET, 'sync-hidden.vbs');
  fs.writeFileSync(vbs, `CreateObject("WScript.Shell").Run """${process.execPath}"" ""${path.join(TARGET, 'sync.js')}""", 0, False\r\n`);
  execFileSync('schtasks', ['/Create', '/F', '/TN', TASK, '/SC', 'MINUTE', '/MO', '1', '/TR', `wscript.exe //B //Nologo "${vbs}"`], { stdio: 'inherit' });
  console.log(`작업 스케줄러: ${TASK} (1분마다 동기화)`);
}
if (has('--unschedule') && process.platform === 'win32') {
  execFileSync('schtasks', ['/Delete', '/F', '/TN', TASK], { stdio: 'inherit' });
}

// ---------- 현황판 서버 (--server / --unserver) ----------
const SERVER = path.join(TARGET, 'server.js');
const SERVER_CFG = path.join(TARGET, 'server.json');
const STARTUP_VBS = process.platform === 'win32' && process.env.APPDATA
  ? path.join(process.env.APPDATA, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup', 'workroom-server.vbs') : '';
const UNIT_DIR = path.join(os.homedir(), '.config', 'systemd', 'user');
const UNIT = 'workroom-server.service';
const hasSystemd = () => process.platform === 'linux' && spawnSync('systemctl', ['--user', 'show-environment'], { stdio: 'ignore' }).status === 0;

// 떠 있는 서버(예전 코드일 수 있다)를 끈다. 열쇠가 맞고 이 컴퓨터에서 부를 때만 서버가 받아 준다.
function quitServer() {
  const cfg = readJson(SERVER_CFG);
  if (!cfg || !cfg.token) return Promise.resolve();
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port: Number(cfg.port) || 8790, path: `/__quit?k=${encodeURIComponent(cfg.token)}`, timeout: 2000 }, (res) => {
      res.resume();
      res.on('end', () => setTimeout(resolve, 500));
    });
    req.on('error', () => resolve());
    req.on('timeout', () => { req.destroy(); resolve(); });
  });
}

async function setupServer() {
  if (has('--local')) {
    const cfg = Object.assign({ port: 8790 }, readJson(SERVER_CFG) || {}, { host: '127.0.0.1' });
    fs.writeFileSync(SERVER_CFG, JSON.stringify(cfg, null, 2) + '\n');
    console.log('server.json: 이 컴퓨터에서만 열림 (127.0.0.1)');
  }
  await quitServer();
  if (STARTUP_VBS) {
    fs.writeFileSync(STARTUP_VBS, `CreateObject("WScript.Shell").Run """${process.execPath}"" ""${SERVER}""", 0, False\r\n`);
    console.log('시작프로그램: workroom-server.vbs (로그인하면 서버가 떠요)');
  }
  if (hasSystemd()) {
    fs.mkdirSync(UNIT_DIR, { recursive: true });
    fs.writeFileSync(path.join(UNIT_DIR, UNIT), [
      '[Unit]', 'Description=Workroom dashboard server', '',
      '[Service]', `ExecStart="${process.execPath}" "${SERVER}"`, 'Restart=on-failure', '',
      '[Install]', 'WantedBy=default.target', '',
    ].join('\n'));
    execFileSync('systemctl', ['--user', 'daemon-reload'], { stdio: 'inherit' });
    execFileSync('systemctl', ['--user', 'enable', UNIT], { stdio: 'inherit' });
    execFileSync('systemctl', ['--user', 'restart', UNIT], { stdio: 'inherit' });
    console.log(`systemd: ${UNIT} (로그인하면 서버가 떠요)`);
  } else if (STARTUP_VBS) {
    // 시작프로그램과 같은 길(wscript)로 띄워야 이 창을 닫아도 서버가 남는다.
    spawn('wscript.exe', ['//B', '//Nologo', STARTUP_VBS], { detached: true, stdio: 'ignore' }).unref();
  } else {
    console.log('이 컴퓨터는 자동 실행을 등록하지 못했어요. 켤 때마다 node ' + SERVER + ' 를 띄우세요.');
    spawn(process.execPath, [SERVER], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
  }
  await new Promise((r) => setTimeout(r, 1500));
  // 링크에는 열쇠가 들어 있어서 화면에 찍지 않는다.
  console.log(`현황판 서버를 띄웠어요. 브라우저로 열기: node "${SERVER}" --open   (폰 링크: --link)`);
}

async function removeServer() {
  await quitServer();
  if (STARTUP_VBS) try { fs.unlinkSync(STARTUP_VBS); } catch (_) {}
  if (hasSystemd()) {
    spawnSync('systemctl', ['--user', 'disable', '--now', UNIT], { stdio: 'inherit' });
    try { fs.unlinkSync(path.join(UNIT_DIR, UNIT)); } catch (_) {}
  }
  console.log('현황판 서버를 끄고 자동 실행을 지웠어요.');
}

(async () => {
  if (has('--server')) await setupServer();
  if (has('--unserver')) await removeServer();
  console.log('현황판:', path.join(TARGET, '현황판.html'));
})().catch((e) => { console.error(e && e.message || e); process.exitCode = 1; });
