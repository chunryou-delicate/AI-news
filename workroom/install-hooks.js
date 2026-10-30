'use strict';
// 업무방 현황판 훅을 ~/.claude/settings.json 에 추가하거나(기본) 뺀다(--uninstall).
// --statusline: 상태줄 사이에 사용량 기록(statusline.js)을 끼운다 (원래 상태줄은 이어서 부름), --statusline-off: 원래대로.
// 기존 설정과 Orca 훅은 그대로 두고, 이 현황판 훅만 넣고 뺀다.
const fs = require('fs');
const path = require('path');
const os = require('os');

const SETTINGS = path.join(os.homedir(), '.claude', 'settings.json');
const HOOK_SCRIPT = path.join(__dirname, 'hook.js').replace(/\\/g, '/');

const EVENTS = [
  ['SessionStart', null, true],
  ['UserPromptSubmit', null, true],
  ['PreToolUse', '*', true],
  ['PostToolUse', '*', true],
  ['PostToolUseFailure', '*', true],
  ['PermissionRequest', '*', true],
  ['PermissionDenied', null, true],
  ['Notification', 'permission_prompt|idle_prompt|elicitation_dialog|elicitation_url_dialog|agent_needs_input', true],
  ['SubagentStart', null, true],
  ['SubagentStop', null, true],
  ['MessageDisplay', null, true],
  ['Stop', null, true],
  ['StopFailure', null, true],
  ['SessionEnd', null, false],
];

function isOurs(group) {
  return group && Array.isArray(group.hooks) && group.hooks.some((h) => Array.isArray(h.args) && h.args.some((a) => String(a).replace(/\\/g, '/') === HOOK_SCRIPT));
}

// Claude Code 를 막 설치한 컴퓨터에는 settings.json 이 아직 없을 수 있다.
const text = fs.existsSync(SETTINGS) ? fs.readFileSync(SETTINGS, 'utf8').replace(/^﻿/, '') : '{}';
const settings = JSON.parse(text.trim() || '{}');
fs.mkdirSync(path.dirname(SETTINGS), { recursive: true });
settings.hooks = settings.hooks || {};

for (const ev of Object.keys(settings.hooks)) {
  if (Array.isArray(settings.hooks[ev])) {
    settings.hooks[ev] = settings.hooks[ev].filter((g) => !isOurs(g));
    if (!settings.hooks[ev].length) delete settings.hooks[ev];
  }
}

if (!process.argv.includes('--uninstall')) {
  for (const [ev, matcher, async] of EVENTS) {
    const hook = { type: 'command', command: 'node', args: [HOOK_SCRIPT] };
    if (async) hook.async = true; else hook.timeout = 3;
    const group = matcher ? { matcher, hooks: [hook] } : { hooks: [hook] };
    (settings.hooks[ev] = settings.hooks[ev] || []).push(group);
  }
}

// 상태줄 사용량 기록(statusline.js): --statusline 로 켠 컴퓨터만. 원래 상태줄 명령은 statusline-next.json 에 적어 두고 그대로 이어 부른다.
// 켜 둔 컴퓨터에서 다시 설치할 때 다른 프로그램(Orca 등)이 상태줄을 제 것으로 되돌려 놨으면 그걸 다시 이어 붙인다.
const NEXT_FILE = path.join(__dirname, 'statusline-next.json');
const OUR_STATUS = `node "${path.join(__dirname, 'statusline.js').replace(/\\/g, '/')}"`;
const isOurStatus = (sl) => !!(sl && typeof sl.command === 'string' && sl.command.replace(/\\/g, '/').includes('/statusline.js') && sl.command.includes(path.basename(__dirname)));
let statusMsg = '';
if (process.argv.includes('--statusline-off') || process.argv.includes('--uninstall')) {
  if (fs.existsSync(NEXT_FILE)) {
    const prev = JSON.parse(fs.readFileSync(NEXT_FILE, 'utf8') || '{}');
    if (isOurStatus(settings.statusLine)) {
      if (prev.command) settings.statusLine = Object.assign({}, settings.statusLine, { command: prev.command });
      else delete settings.statusLine;
    }
    fs.unlinkSync(NEXT_FILE);
    statusMsg = ' 상태줄은 원래대로 돌려놨어요.';
  }
} else if (process.argv.includes('--statusline') || fs.existsSync(NEXT_FILE)) {
  if (!isOurStatus(settings.statusLine)) {
    fs.writeFileSync(NEXT_FILE, JSON.stringify({ command: (settings.statusLine && settings.statusLine.command) || '' }, null, 2) + '\n');
    settings.statusLine = Object.assign({ type: 'command' }, settings.statusLine || {}, { command: OUR_STATUS });
  }
  statusMsg = ' 상태줄 사용량 기록도 켜져 있어요 (원래 상태줄은 그대로 이어서 불러요).';
}

const out = JSON.stringify(settings, null, 2) + '\n';
JSON.parse(out);
const tmp = SETTINGS + '.workroom.tmp';
fs.writeFileSync(tmp, out, 'utf8');
fs.renameSync(tmp, SETTINGS);
console.log((process.argv.includes('--uninstall') ? '현황판 훅을 뺐어요.' : '현황판 훅을 넣었어요.') + statusMsg);
