'use strict';
// 업무방 현황판 훅을 ~/.claude/settings.json 에 추가하거나(기본) 뺀다(--uninstall).
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

const out = JSON.stringify(settings, null, 2) + '\n';
JSON.parse(out);
const tmp = SETTINGS + '.workroom.tmp';
fs.writeFileSync(tmp, out, 'utf8');
fs.renameSync(tmp, SETTINGS);
console.log(process.argv.includes('--uninstall') ? '현황판 훅을 뺐어요.' : '현황판 훅을 넣었어요.');
