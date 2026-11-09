'use strict';
// 2줄 상태줄(1줄: 로그인·모델·effort·폴더·git·Remote Control / 2줄: 컨텍스트·토큰·비용·세션 시간·캐시·5h/7d 사용률)을
// 이 컴퓨터의 모든 Claude 설정에 건다.
//
// 하는 일
//   1) 같은 폴더의 statusline.js 를 ~/.claude/statusline.js 로 복사한다. 내용이 다른 옛 파일이 있으면 statusline.js.bak-날짜 로 남긴다.
//   2) ~/.claude 와 Orca 의 Claude 프로필(…/orca/claude-profiles/*/home)마다 settings.json 의 statusLine 만 바꾼다.
//      다른 설정(훅·권한 등)은 건드리지 않는다. 바꾸기 전 settings.json.bak-statusline 으로 한 번 백업한다.
//      현황판 사용량 기록(workroom/statusline.js)이 상태줄 사이에 끼어 있으면 settings 는 그대로 두고,
//      기록기가 이어 부르는 명령(~/.claude/workroom/statusline-next.json)만 이 상태줄로 바꾼다.
//   3) 결과를 한 줄씩 찍는다.
// 사용: node statusline/install.js           설치(여러 번 해도 같음)
//       node statusline/install.js --check   바꾸지 않고 지금 상태만
//       node statusline/install.js --undo    백업에서 statusLine 만 되돌림
// 이미 떠 있는 세션은 settings.json 이 바뀌면 보통 바로(늦어도 30초 안에) 새 상태줄로 바뀐다. 안 바뀌면 그 세션을 다시 열면 된다.
const fs = require('fs'), path = require('path'), os = require('os');

const HOME = os.homedir();
const MODE = process.argv.includes('--undo') ? 'undo' : process.argv.includes('--check') ? 'check' : 'install';
const SRC = path.join(__dirname, 'statusline.js');
const DEST = path.join(HOME, '.claude', 'statusline.js');
const CMD = `node "${DEST.replace(/\\/g, '/')}"`;
const NEXT = path.join(HOME, '.claude', 'workroom', 'statusline-next.json');
const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
const out = [];

function configDirs() {
  const dirs = [path.join(HOME, '.claude')];
  const bases = [
    process.env.APPDATA && path.join(process.env.APPDATA, 'orca', 'claude-profiles'),
    path.join(HOME, '.config', 'orca', 'claude-profiles'),
    path.join(HOME, 'Library', 'Application Support', 'orca', 'claude-profiles'),
  ].filter(Boolean);
  for (const b of bases) {
    let names = [];
    try { names = fs.readdirSync(b); } catch (_) { continue; }
    for (const n of names) { const h = path.join(b, n, 'home'); if (fs.existsSync(path.join(h, 'settings.json'))) dirs.push(h); }
  }
  return dirs;
}
const label = (dir) => (dir === path.join(HOME, '.claude') ? '~/.claude' : 'Orca 프로필 ' + path.basename(path.dirname(dir)).slice(0, 8));
const isRecorder = (sl) => !!(sl && typeof sl.command === 'string' && /workroom[\\/]+statusline\.js/.test(sl.command.replace(/\\/g, '/')));
const isOurs = (c) => typeof c === 'string' && c.replace(/\\/g, '/').toLowerCase() === CMD.toLowerCase();

// 1) 상태줄 파일
if (MODE === 'install') {
  const src = fs.readFileSync(SRC);
  let old = null;
  try { old = fs.readFileSync(DEST); } catch (_) {}
  if (old && Buffer.compare(old, src) === 0) out.push('statusline.js: 이미 같음');
  else {
    if (old) fs.writeFileSync(`${DEST}.bak-${stamp}`, old);
    fs.mkdirSync(path.dirname(DEST), { recursive: true });
    fs.writeFileSync(DEST, src);
    out.push(`statusline.js: ${old ? '바꿈 (옛것은 .bak-' + stamp + ')' : '새로 둠'}`);
  }
}

// 2) 설정마다
let recorderSeen = false;
for (const dir of configDirs()) {
  const f = path.join(dir, 'settings.json');
  let text, j;
  try { text = fs.readFileSync(f, 'utf8'); j = JSON.parse(text); } catch (e) { out.push(`${label(dir)}: settings.json 을 못 읽어 건너뜀 (${e.code || 'JSON 오류'})`); continue; }
  const sl = j.statusLine;
  if (MODE === 'check') {
    out.push(`${label(dir)}: ${isOurs(sl && sl.command) ? '이 상태줄' : isRecorder(sl) ? '현황판 기록기 → ' + (readNext() || '(없음)') : sl ? '다른 상태줄: ' + String(sl.command).slice(0, 80) : '상태줄 없음'}`);
    continue;
  }
  if (MODE === 'undo') {
    let bak;
    try { bak = JSON.parse(fs.readFileSync(f + '.bak-statusline', 'utf8')); } catch (_) { out.push(`${label(dir)}: 백업이 없어 그대로`); continue; }
    if (bak.statusLine) j.statusLine = bak.statusLine; else delete j.statusLine;
    fs.writeFileSync(f, JSON.stringify(j, null, 2) + '\n');
    out.push(`${label(dir)}: statusLine 을 백업대로 되돌림`);
    continue;
  }
  if (isRecorder(sl)) { recorderSeen = true; out.push(`${label(dir)}: 현황판 기록기가 끼어 있어 settings 는 그대로 (기록기 다음 명령을 바꿈)`); continue; }
  if (sl && isOurs(sl.command) && sl.refreshInterval === 30) { out.push(`${label(dir)}: 이미 이 상태줄`); continue; }
  if (!fs.existsSync(f + '.bak-statusline')) fs.writeFileSync(f + '.bak-statusline', text);
  j.statusLine = Object.assign({}, sl && typeof sl === 'object' ? sl : {}, { type: 'command', command: CMD, refreshInterval: 30 });
  fs.writeFileSync(f, JSON.stringify(j, null, 2) + '\n');
  out.push(`${label(dir)}: statusLine 을 이 상태줄로 바꿈${sl && sl.command ? ' (전: ' + String(sl.command).slice(0, 60) + ')' : ''}`);
}
function readNext() { try { return JSON.parse(fs.readFileSync(NEXT, 'utf8')).command || ''; } catch (_) { return ''; } }
if (MODE === 'install' && recorderSeen) {
  const prev = readNext();
  if (isOurs(prev)) out.push('현황판 기록기 다음 명령: 이미 이 상태줄');
  else {
    if (prev) fs.writeFileSync(NEXT + `.bak-${stamp}`, JSON.stringify({ command: prev }, null, 2) + '\n');
    fs.writeFileSync(NEXT, JSON.stringify({ command: CMD }, null, 2) + '\n');
    out.push(`현황판 기록기 다음 명령: 이 상태줄로 바꿈${prev ? ' (전: ' + prev.slice(0, 60) + ')' : ''}`);
  }
}
console.log(out.join('\n'));
