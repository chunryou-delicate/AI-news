'use strict';
// Claude Code 상태줄(statusLine) 사이에 끼어 사용량을 적는다.
// 받은 JSON 에서 컨텍스트(%)와 5시간·7일 한도만 usage/<세션>.json 에 적고, 원래 상태줄 명령(statusline-next.json 의 command,
// 예: Orca 상태줄)에 같은 입력을 그대로 넘겨 그 출력을 그대로 낸다. 그래서 원래 상태줄은 전과 똑같이 돈다.
// 켜고 끄기: node install-hooks.js --statusline / --statusline-off (꺼 두면 hook.js 가 transcript 로 컨텍스트만 어림한다)
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = __dirname;

function writeAtomic(file, text) {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, text);
  try { fs.renameSync(tmp, file); } catch (_) { fs.writeFileSync(file, text); try { fs.unlinkSync(tmp); } catch (__) {} }
}

function record(j) {
  if (!j || !j.session_id) return;
  const cw = j.context_window || {}, rl = j.rate_limits || {};
  const win = (w) => (w && typeof w.used_percentage === 'number' ? { pct: w.used_percentage, resetsAt: (Number(w.resets_at) || 0) * 1000 } : null);
  const u = {
    t: Date.now(),
    sid: String(j.session_id),
    ctx: typeof cw.used_percentage === 'number' ? { pct: cw.used_percentage, size: cw.context_window_size || 0, tokens: cw.total_input_tokens || 0 } : null,
    five: win(rl.five_hour),
    seven: win(rl.seven_day),
  };
  if (!u.ctx && !u.five && !u.seven) return;
  const dir = path.join(ROOT, 'usage');
  fs.mkdirSync(dir, { recursive: true });
  writeAtomic(path.join(dir, u.sid.replace(/[^\w-]/g, '_') + '.json'), JSON.stringify(u));
}

let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (c) => { raw += c; });
process.stdin.on('end', () => {
  try { record(JSON.parse(raw)); } catch (_) {}
  let out = '';
  try {
    const next = (JSON.parse(fs.readFileSync(path.join(ROOT, 'statusline-next.json'), 'utf8')) || {}).command;
    if (next) {
      const r = spawnSync(next, { input: raw, shell: true, encoding: 'utf8', timeout: 5000, windowsHide: true });
      out = r.stdout || '';
    }
  } catch (_) {}
  process.stdout.write(out);
});
