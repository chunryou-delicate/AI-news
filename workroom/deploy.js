'use strict';
// 저장소의 현황판 코드를 실제로 돌아가는 위치(~/.claude/workroom)에 복사하고 Claude Code 훅을 설치한다.
// 사용법:
//   node deploy.js                 코드 복사 + 훅 설치 (rooms.json 은 없을 때만 복사)
//   node deploy.js --rooms         rooms.json 도 덮어쓴다
//   node deploy.js --no-hooks      훅 설정은 건드리지 않는다
// 다른 컴퓨터와 주고받기 (비공개 git 저장소 사용):
//   보내는 쪽: node deploy.js --machine "회사 노트북" --sync <저장소 주소> --push --auto-rooms
//   받는 쪽:   node deploy.js --machine "집 컴퓨터" --sync <저장소 주소> --pull --schedule
//   --auto-rooms  방 목록 대신 세션의 프로젝트 폴더 이름으로 방을 만든다
//   --schedule    (Windows) 1분마다 받아 오도록 작업 스케줄러에 등록한다. --unschedule 로 지운다

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const TARGET = path.join(os.homedir(), '.claude', 'workroom');
const CODE = ['hook.js', 'install-hooks.js', 'sync.js', 'server.js', 'tunnel.js', '현황판.html', 'office3d.js'];
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

const repo = valueOf('--sync');
if (repo) {
  const cfg = {
    repo,
    machine: valueOf('--machine') || os.hostname(),
    push: has('--push'),
    pull: has('--pull'),
    intervalSec: Number(valueOf('--interval')) || 60,
  };
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

console.log('현황판:', path.join(TARGET, '현황판.html'));
