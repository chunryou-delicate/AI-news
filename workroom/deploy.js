'use strict';
// 저장소의 현황판 코드를 실제로 돌아가는 위치(~/.claude/workroom)에 복사하고 Claude Code 훅을 설치한다.
// 사용법: node deploy.js             코드 복사 + 훅 설치 (rooms.json 은 없을 때만 복사)
//         node deploy.js --rooms     rooms.json 도 덮어쓴다
//         node deploy.js --no-hooks  훅 설정은 건드리지 않는다

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const TARGET = path.join(os.homedir(), '.claude', 'workroom');
const CODE = ['hook.js', 'install-hooks.js', '현황판.html'];

fs.mkdirSync(TARGET, { recursive: true });
for (const f of CODE) {
  fs.copyFileSync(path.join(__dirname, f), path.join(TARGET, f));
  console.log('복사:', f);
}

const rooms = path.join(TARGET, 'rooms.json');
if (!fs.existsSync(rooms) || process.argv.includes('--rooms')) {
  fs.copyFileSync(path.join(__dirname, 'rooms.json'), rooms);
  console.log('복사: rooms.json');
} else {
  console.log('그대로 둠: rooms.json (덮어쓰려면 --rooms)');
}

if (!process.argv.includes('--no-hooks')) {
  execFileSync(process.execPath, [path.join(TARGET, 'install-hooks.js')], { stdio: 'inherit' });
}
execFileSync(process.execPath, [path.join(TARGET, 'hook.js'), '--rebuild'], { stdio: 'inherit' });
console.log('현황판:', path.join(TARGET, '현황판.html'));
