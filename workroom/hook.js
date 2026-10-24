'use strict';
// 업무방 현황판: Claude Code 훅 이벤트를 받아 세션 상태를 기록하고 state.js를 다시 만든다.
// 설정: ~/.claude/settings.json 의 hooks 에서 "node <이 파일>" 로 호출된다 (exec form).
// 사용법(수동 재생성): node hook.js --rebuild

const fs = require('fs');
const path = require('path');
const os = require('os');

const ROOT = __dirname;
const SESS_DIR = path.join(ROOT, 'sessions');
const STATE_FILE = path.join(ROOT, 'state.js');
const ROOMS_FILE = path.join(ROOT, 'rooms.json');
const CACHE_FILE = path.join(ROOT, 'title-cache.json');
const MEETINGS_DIR = path.join(ROOT, 'meetings');
const MINUTES_DIR = path.join(ROOT, 'minutes');      // 회의록 원본(jsonl)과 자동 저장 회의록(md)
const LOGS_DIR = path.join(ROOT, 'logs');            // 현황판이 읽는 방별 회의록 (file:// 에서 읽히도록 .js)
const MEETING_CACHE = path.join(ROOT, 'meetings-cache.json');
const MEETING_LOCK = path.join(ROOT, 'meetings.lock');
const ERROR_LOG = path.join(ROOT, 'error.log');
const CLAUDE_DIR = path.join(os.homedir(), '.claude');
const REGISTRY_DIR = path.join(CLAUDE_DIR, 'sessions');
const PROJECTS_DIR = path.join(CLAUDE_DIR, 'projects');

const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const ENDED_VISIBLE_MS = 30 * MIN;   // 끝난 세션을 현황판에 남겨 두는 시간
const QUIET_HIDE_MS = 12 * HOUR;     // 살아 있는지 모르는 세션을 숨기는 기준
const FILE_KEEP_MS = 3 * 24 * HOUR;  // 세션 파일을 지우는 기준
const TAIL_BYTES = 2 * 1024 * 1024;  // 제목을 찾을 때 읽는 transcript 끝부분 크기

const startedAt = Date.now();

function logError(err) {
  try {
    let size = 0;
    try { size = fs.statSync(ERROR_LOG).size; } catch (_) {}
    if (size > 256 * 1024) fs.writeFileSync(ERROR_LOG, '');
    fs.appendFileSync(ERROR_LOG, `[${new Date().toISOString()}] ${err && err.stack || err}\n`);
  } catch (_) {}
}

function sleepMs(ms) {
  try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); } catch (_) {}
}

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { return fallback; }
}

// 임시 파일에 쓰고 rename 한다. 브라우저가 읽는 중이라 rename 이 막히면 몇 번 다시 시도한다.
function writeAtomic(file, text) {
  const tmp = `${file}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
  fs.writeFileSync(tmp, text, 'utf8');
  for (let i = 0; i < 5; i++) {
    try { fs.renameSync(tmp, file); return; } catch (e) {
      if (i === 4) {
        try { fs.writeFileSync(file, text, 'utf8'); } finally { try { fs.unlinkSync(tmp); } catch (_) {} }
        return;
      }
      sleepMs(20);
    }
  }
}

function clip(text, max) {
  if (typeof text !== 'string') return '';
  const oneLine = text.replace(/\s+/g, ' ').trim();
  return oneLine.length > max ? oneLine.slice(0, max - 1) + '…' : oneLine;
}

function safeId(id) {
  return String(id).replace(/[^A-Za-z0-9_-]/g, '_');
}

function normPath(p) {
  return String(p || '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
}

// transcript 끝부분에서 가장 최근 제목(직접 붙인 이름 우선, 없으면 AI 제목)을 찾는다.
function readTitle(transcriptPath) {
  if (!transcriptPath) return null;
  let fd;
  try {
    const size = fs.statSync(transcriptPath).size;
    const len = Math.min(size, TAIL_BYTES);
    const buf = Buffer.alloc(len);
    fd = fs.openSync(transcriptPath, 'r');
    fs.readSync(fd, buf, 0, len, size - len);
    const text = buf.toString('utf8');
    let custom = null;
    let ai = null;
    const re = /"type":"(custom-title|ai-title)","(?:customTitle|aiTitle)":"((?:[^"\\]|\\.)*)"/g;
    let m;
    while ((m = re.exec(text))) {
      let value;
      try { value = JSON.parse(`"${m[2]}"`); } catch (_) { value = m[2]; }
      if (m[1] === 'custom-title') custom = value; else ai = value;
    }
    return custom || ai;
  } catch (_) {
    return null;
  } finally {
    if (fd !== undefined) try { fs.closeSync(fd); } catch (_) {}
  }
}

function summarizeToolInput(toolName, input) {
  if (!input || typeof input !== 'object') return '';
  const pick = input.command || input.file_path || input.path || input.url || input.pattern
    || input.description || input.prompt || input.query || '';
  return clip(`${toolName}${pick ? ': ' + pick : ''}`, 140);
}

function sessionFile(id) {
  return path.join(SESS_DIR, `${safeId(id)}.json`);
}

// ---------- 회의록 ----------

function dayStr(t) {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function hhmm(t) {
  const d = new Date(t);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function roomKey(name) {
  let h = 2166136261;
  for (const ch of String(name)) { h ^= ch.codePointAt(0); h = Math.imul(h, 16777619); }
  return 'r' + (h >>> 0).toString(16);
}

function safeName(name) {
  return String(name).replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').trim() || 'room';
}

function folderOf(cwd) {
  return String(cwd || '').replace(/[\\/]+$/, '').split(/[\\/]/).pop() || '';
}

function clipBlock(t, max) {
  const s = String(t || '').replace(/\r\n/g, '\n').trim();
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

function roundName(r) {
  return { r1: '1라운드', r2: '2라운드', r3: '3라운드', synthesis: '종합', critic: '비평', wrapup: '정리', done: '종료' }[r] || r || '';
}

// 파일 끝부분에서 JSON 줄을 최대 maxLines 개 읽는다.
function readTailEntries(file, maxBytes, maxLines) {
  let fd;
  try {
    const size = fs.statSync(file).size;
    const len = Math.min(size, maxBytes);
    const buf = Buffer.alloc(len);
    fd = fs.openSync(file, 'r');
    fs.readSync(fd, buf, 0, len, size - len);
    let lines = buf.toString('utf8').split('\n');
    if (size > len) lines = lines.slice(1);
    const out = [];
    for (const l of lines) { if (l.trim()) { try { out.push(JSON.parse(l)); } catch (_) {} } }
    return out.slice(-maxLines);
  } catch (_) {
    return [];
  } finally {
    if (fd !== undefined) try { fs.closeSync(fd); } catch (_) {}
  }
}

function minutesDir(roomName) {
  return path.join(MINUTES_DIR, safeName(roomName));
}

function appendEntries(roomName, entries) {
  if (!entries.length) return;
  const dir = minutesDir(roomName);
  fs.mkdirSync(dir, { recursive: true });
  const day = dayStr(Date.now());
  const talk = entries.filter((e) => e.kind !== 'tool').map((e) => JSON.stringify(e) + '\n').join('');
  const tools = entries.filter((e) => e.kind === 'tool').map((e) => JSON.stringify(e) + '\n').join('');
  if (talk) fs.appendFileSync(path.join(dir, `${day}.jsonl`), talk);
  if (tools) fs.appendFileSync(path.join(dir, `${day}.tools.jsonl`), tools);
}

// 한 메시지가 여러 조각(MessageDisplay 배치)으로 들어오므로 같은 메시지끼리 이어 붙인다.
function mergeSay(entries) {
  const out = [];
  const byMsg = new Map();
  for (const e of entries) {
    if (e.kind === 'say' && e.mid) {
      const k = e.sid + '|' + e.mid;
      let item = byMsg.get(k);
      if (!item) { item = Object.assign({}, e, { parts: [] }); byMsg.set(k, item); out.push(item); }
      item.parts.push([e.idx || 0, e.text || '']);
      continue;
    }
    out.push(e);
  }
  for (const item of byMsg.values()) {
    item.text = item.parts.sort((a, b) => a[0] - b[0]).map((p) => p[1]).join('');
    delete item.parts;
  }
  return out;
}

// 세션마다 가장 최근에 한 말과 도구 사용 (평면도 말풍선용)
function latestSpeech(entries) {
  const out = {};
  const lastT = new Map();
  for (const e of entries) if (e.kind === 'say' && e.mid) { const k = e.sid + '|' + e.mid; lastT.set(k, Math.max(lastT.get(k) || 0, e.t)); }
  for (const e of mergeSay(entries)) {
    if (!e.sid) continue;
    const o = out[e.sid] || (out[e.sid] = {});
    const t = e.kind === 'say' && e.mid ? lastT.get(e.sid + '|' + e.mid) || e.t : e.t;
    if (e.kind === 'say' || e.kind === 'report' || e.kind === 'dispatch') {
      if (!o.say || t >= o.say.t) o.say = { t, kind: e.kind, text: String(e.text || '').slice(0, 1500) };
    } else if (e.kind === 'tool') {
      if (!o.tool || t >= o.tool.t) o.tool = { t, text: e.text };
    }
  }
  return out;
}

function writeSpeechJs() {
  const bySid = {};
  let names = [];
  try { names = fs.readdirSync(LOGS_DIR).filter((f) => f.endsWith('.speech.json')); } catch (_) { return; }
  for (const f of names) Object.assign(bySid, readJson(path.join(LOGS_DIR, f), {}));
  writeAtomic(path.join(ROOT, 'speech.js'), `window.__WORKROOM_SPEECH__ = ${JSON.stringify({ generatedAt: Date.now(), bySid })};\n`);
}

// 현황판이 읽는 방별 회의록 파일(logs/<key>.js)을 다시 만든다.
function writeRoomLog(roomName) {
  const dir = minutesDir(roomName);
  const now = Date.now();
  const day = dayStr(now);
  let talk = readTailEntries(path.join(dir, `${day}.jsonl`), 1024 * 1024, 500);
  if (talk.length < 150) talk = readTailEntries(path.join(dir, `${dayStr(now - 24 * HOUR)}.jsonl`), 256 * 1024, 150 - talk.length).concat(talk);
  const tools = readTailEntries(path.join(dir, `${day}.tools.jsonl`), 96 * 1024, 120);
  const key = roomKey(roomName);
  const payload = {
    room: roomName,
    key,
    day,
    mdPath: path.join(dir, `${day}.md`),
    generatedAt: now,
    entries: talk.concat(tools).sort((a, b) => a.t - b.t),
  };
  fs.mkdirSync(LOGS_DIR, { recursive: true });
  writeAtomic(path.join(LOGS_DIR, `${key}.js`),
    `(window.__WORKROOM_LOG__ = window.__WORKROOM_LOG__ || {})[${JSON.stringify(key)}] = ${JSON.stringify(payload)};\n`);
  writeAtomic(path.join(LOGS_DIR, `${key}.speech.json`), JSON.stringify(latestSpeech(payload.entries)));
  writeSpeechJs();
}

const KIND_LABEL = { order: '지시', report: '보고', msg: '메시지', ask: '요청', state: '상태', dispatch: '투입' };

// 사람이 읽는 회의록(minutes/<방>/<날짜>.md)을 그날 기록 전체로 다시 쓴다.
function writeMinutesMd(roomName, day) {
  const dir = minutesDir(roomName);
  const entries = mergeSay(readTailEntries(path.join(dir, `${day}.jsonl`), 32 * 1024 * 1024, 100000));
  if (!entries.length) return;
  // 기록할 때는 아직 역할이 정해지지 않았던 세션도 있으니, 지금 기준 이름(역할·제목)으로 다시 붙인다.
  const names = new Map();
  const nameOf = (sid) => {
    if (!sid) return null;
    if (!names.has(sid)) { const s = readJson(sessionFile(sid), null); names.set(sid, s ? speakerFor(s) : null); }
    return names.get(sid);
  };
  const lines = [`# 회의록 · ${roomName} · ${day}`, '', `> 업무방 현황판이 자동으로 남긴 기록입니다. 도구 사용 내역은 ${day}.tools.jsonl 에 따로 있습니다.`, ''];
  for (const e of entries) {
    if (e.kind === 'meeting') { lines.push('', `### ${hhmm(e.t)} · ${e.text}`, ''); continue; }
    let who = e.who;
    let to = e.to;
    const sp = nameOf(e.sid);
    if (sp && ['order', 'ask', 'msg'].includes(e.kind)) { to = sp.who; if (e.kind === 'order' && sp.role) who = '의장'; }
    else if (sp && e.who !== 'Orca') who = sp.who;
    const label = KIND_LABEL[e.kind];
    const head = `**${who || '?'}${to ? ' → ' + to : ''}**${label ? ` _(${label})_` : ''}`;
    lines.push(`- ${hhmm(e.t)} ${head}: ${String(e.text || '').trim().replace(/\n/g, '\n  ')}`);
  }
  fs.mkdirSync(dir, { recursive: true });
  writeAtomic(path.join(dir, `${day}.md`), lines.join('\n') + '\n');
}

function readMeetingFilesRaw() {
  let names = [];
  try { names = fs.readdirSync(MEETINGS_DIR).filter((f) => f.endsWith('.json')); } catch (_) { return []; }
  const now = Date.now();
  return names.map((f) => readJson(path.join(MEETINGS_DIR, f), null)).filter((m) => {
    if (!m || !m.room) return false;
    const t = typeof m.updatedAt === 'number' ? m.updatedAt : (Date.parse(m.updatedAt) || 0);
    return t && now - t < QUIET_HIDE_MS;
  });
}

function matchesIds(ids, s) {
  if (ids.sessionId && ids.sessionId === s.id) return true;
  const o = s.orca;
  if (!o) return false;
  if (ids.terminal && o.terminal && ids.terminal === o.terminal) return true;
  if (ids.pane && o.pane && ids.pane === o.pane) return true;
  const want = [ids.terminal, ids.agent].map(uuidOf).filter(Boolean);
  return !!(o.agent && want.includes(uuidOf(o.agent)));
}

// 회의록에 적을 말하는 사람 이름: 회의 역할이 있으면 역할 이름, 없으면 세션 제목.
function speakerFor(s) {
  for (const m of readMeetingFilesRaw()) {
    if (matchesIds(idsOf(m.chair), s)) return { who: '의장', role: 'chair' };
    for (const r of (Array.isArray(m.roles) ? m.roles : [])) {
      if (matchesIds(idsOf(r), s)) return { who: clip(text(r.label || r.role), 20), role: text(r.role) };
    }
  }
  return { who: s.title ? clip(s.title, 30) : `${folderOf(s.cwd)} ${String(s.id).slice(0, 4)}` };
}

function argOf(cmd, name) {
  const re = new RegExp(`(?:^|\\s)${name}(?:=|\\s+)(?:"((?:[^"\\\\]|\\\\.)*)"|'([^']*)'|(\\S+))`);
  const m = cmd.match(re);
  if (!m) return '';
  if (m[1] != null) return m[1].replace(/\\(.)/g, '$1');
  return m[2] != null ? m[2] : (m[3] || '');
}

const TOOL_KO = {
  Read: '읽기', Write: '작성', Edit: '수정', MultiEdit: '수정', NotebookEdit: '수정', Bash: '명령', PowerShell: '명령',
  Grep: '검색', Glob: '파일 찾기', WebFetch: '웹 읽기', WebSearch: '웹 검색', Agent: '서브에이전트', Task: '서브에이전트',
  TodoWrite: '할 일 정리', Skill: '스킬',
};

function toolText(tool, input) {
  input = input || {};
  let pick = input.file_path || input.notebook_path || input.path || input.command || input.pattern || input.url || input.query || input.description || '';
  if (input.file_path || input.notebook_path || input.path) pick = String(pick).replace(/\\/g, '/').split('/').slice(-3).join('/');
  return clip(`${TOOL_KO[tool] || tool}${pick ? ' · ' + pick : ''}`, 160);
}

// 훅 이벤트 하나를 회의록 항목으로 바꾼다.
function collectEntries(ev, input, s, sp) {
  const base = { t: startedAt, sid: s.id, who: sp.who };
  const out = [];
  switch (ev) {
    case 'UserPromptSubmit': {
      const p = String(input.prompt || '');
      if (/^\s*You are working inside Orca/i.test(p)) {
        const task = p.split(/^=== TASK ===[ \t]*$/m)[1] || '';
        out.push(Object.assign({}, base, { who: sp.role ? '의장' : '코디네이터', to: sp.who, kind: 'order', text: clipBlock(task || '새 작업 지시', 1200) }));
      } else if (/^\s*You have \d+ orchestration message/i.test(p)) {
        out.push(Object.assign({}, base, { who: 'Orca', kind: 'state', text: '워커 메시지 도착' }));
      } else if (/^\s*<cross-session-message\b/i.test(p)) {
        const from = (p.match(/from-name="([^"]*)"/i) || [])[1] || '다른 세션';
        const body = p.replace(/^\s*<cross-session-message\b[^>]*>/i, '').replace(/<\/cross-session-message>\s*$/i, '');
        out.push(Object.assign({}, base, { who: from, to: sp.who, kind: 'msg', text: clipBlock(body, 1500) }));
      } else if (!/^\s*<[a-z][\w-]*[\s>]/i.test(p) && p.trim()) {
        out.push(Object.assign({}, base, { who: '사용자', to: sp.who, kind: 'ask', text: clipBlock(p, 1500) }));
      }
      break;
    }
    case 'MessageDisplay':
      if (input.delta) out.push(Object.assign({}, base, { kind: 'say', mid: input.message_id || '', idx: Number(input.index) || 0, text: String(input.delta).slice(0, 6000) }));
      break;
    case 'PreToolUse': {
      const tool = input.tool_name || '';
      const ti = input.tool_input || {};
      const cmd = typeof ti.command === 'string' ? ti.command : '';
      if (cmd && /orca\s+orchestration\s+send\b/.test(cmd)) {
        const type = argOf(cmd, '--type');
        if (type !== 'heartbeat') {
          out.push(Object.assign({}, base, { to: sp.role && sp.role !== 'chair' ? '의장' : (argOf(cmd, '--to') || ''), kind: 'report', rtype: type, text: clipBlock(argOf(cmd, '--body') || type || '메시지', 1500) }));
        }
      } else if (cmd && /orca\s+orchestration\s+worker-start\b/.test(cmd)) {
        const title = argOf(cmd, '--task-title');
        const agent = argOf(cmd, '--agent');
        out.push(Object.assign({}, base, { kind: 'dispatch', text: `워커 투입${title ? ': ' + title : ''}${agent ? ' (' + agent + ')' : ''}` }));
      } else if (tool === 'AskUserQuestion') {
        out.push(Object.assign({}, base, { to: '사용자', kind: 'state', text: '질문: ' + questionText(ti) }));
      } else {
        out.push(Object.assign({}, base, { kind: 'tool', tool, text: toolText(tool, ti) }));
      }
      break;
    }
    case 'PermissionRequest':
      out.push(Object.assign({}, base, { kind: 'state', text: '승인 요청 · ' + summarizeToolInput(input.tool_name || '', input.tool_input) }));
      break;
    case 'StopFailure':
      out.push(Object.assign({}, base, { kind: 'state', text: 'API 오류로 멈춤 · ' + clip(input.last_assistant_message || input.error || '', 120) }));
      break;
    case 'SubagentStart':
      out.push(Object.assign({}, base, { kind: 'state', text: `서브에이전트 투입 · ${input.agent_type || 'agent'}` }));
      break;
    case 'SessionStart':
      if (input.source === 'startup' || input.source === 'resume') out.push(Object.assign({}, base, { kind: 'state', text: input.source === 'resume' ? '다시 입장' : '입장' }));
      break;
    case 'SessionEnd':
      out.push(Object.assign({}, base, { kind: 'state', text: '퇴장' }));
      break;
    default:
      break;
  }
  return out;
}

// 회의 상태 파일이 바뀐 것(라운드, 의견 대기, 역할 완료)을 회의록에 남긴다. 여러 훅이 동시에 돌므로 잠금 파일을 쓴다.
function diffMeetings(meetings) {
  let fd;
  try { fd = fs.openSync(MEETING_LOCK, 'wx'); } catch (_) {
    try { if (Date.now() - fs.statSync(MEETING_LOCK).mtimeMs > 5000) fs.unlinkSync(MEETING_LOCK); } catch (__) {}
    return;
  }
  try {
    const cache = readJson(MEETING_CACHE, {});
    const next = {};
    const now = Date.now();
    const touched = new Set();
    for (const m of meetings) {
      const prev = cache[m.key];
      const snap = { room: m.room, agenda: m.agenda, round: m.round, phase: m.phase, wait: m.waitingForUser, reason: m.waitingReason, roles: {} };
      m.roles.forEach((r) => { snap.roles[r.role] = r.state; });
      next[m.key] = snap;
      const base = { t: now, sid: m.chairId || '', who: '의장' };
      const add = [];
      if (!prev || prev.agenda !== snap.agenda) add.push(Object.assign({}, base, { kind: 'meeting', text: `안건 ${snap.agenda} 회의` }));
      if (!prev || prev.round !== snap.round || prev.agenda !== snap.agenda) add.push(Object.assign({}, base, { kind: 'meeting', text: `${roundName(snap.round)} 시작` }));
      if (prev && snap.phase && prev.phase !== snap.phase) add.push(Object.assign({}, base, { kind: 'state', text: '진행 · ' + snap.phase }));
      if (snap.wait && (!prev || !prev.wait)) add.push(Object.assign({}, base, { kind: 'meeting', text: '의장 의견 대기' + (snap.reason ? ' — ' + snap.reason : '') }));
      if (!snap.wait && prev && prev.wait) add.push(Object.assign({}, base, { kind: 'state', text: '의견 반영, 회의 재개' }));
      m.roles.forEach((r) => {
        const before = prev && prev.roles ? prev.roles[r.role] : undefined;
        if (before !== undefined && before !== r.state && r.state === 'done') {
          add.push(Object.assign({}, base, { sid: r.matchId || '', who: r.label, kind: 'state', text: '작업 완료' + (r.output ? ' · ' + r.output : '') }));
        }
      });
      if (add.length) { appendEntries(m.room, add); touched.add(m.room); }
    }
    for (const k of Object.keys(cache)) {
      if (!next[k] && cache[k].room) {
        appendEntries(cache[k].room, [{ t: now, sid: '', who: '의장', kind: 'meeting', text: `안건 ${cache[k].agenda} 회의 종료` }]);
        touched.add(cache[k].room);
      }
    }
    writeAtomic(MEETING_CACHE, JSON.stringify(next));
    for (const room of touched) { writeRoomLog(room); writeMinutesMd(room, dayStr(now)); }
  } catch (e) {
    logError(e);
  } finally {
    try { fs.closeSync(fd); } catch (_) {}
    try { fs.unlinkSync(MEETING_LOCK); } catch (_) {}
  }
}

// 30일 넘은 회의록 원본(jsonl)은 하루 한 번 지운다. 사람이 읽는 md 는 남긴다.
function cleanupMinutes() {
  const marker = path.join(MINUTES_DIR, `.cleaned-${dayStr(Date.now())}`);
  if (fs.existsSync(marker)) return;
  try {
    fs.mkdirSync(MINUTES_DIR, { recursive: true });
    for (const f of fs.readdirSync(MINUTES_DIR)) if (f.startsWith('.cleaned-')) fs.unlinkSync(path.join(MINUTES_DIR, f));
    fs.writeFileSync(marker, '');
    const limit = Date.now() - 30 * 24 * HOUR;
    for (const d of fs.readdirSync(MINUTES_DIR)) {
      const dir = path.join(MINUTES_DIR, d);
      if (!fs.statSync(dir).isDirectory()) continue;
      for (const f of fs.readdirSync(dir)) {
        const fp = path.join(dir, f);
        if (f.endsWith('.jsonl') && fs.statSync(fp).mtimeMs < limit) fs.unlinkSync(fp);
      }
    }
  } catch (e) { logError(e); }
}

// ---------- 훅 이벤트 처리 ----------

// 말(MessageDisplay)은 상태를 바꾸지 않으므로 세션 파일은 읽기만 하고 회의록에만 적는다.
function handleMessage(input) {
  const s = readJson(sessionFile(input.session_id), null)
    || { id: input.session_id, cwd: input.cwd, title: '' };
  if (!s.cwd && input.cwd) s.cwd = input.cwd;
  if (!s.orca && process.env.ORCA_TERMINAL_HANDLE) s.orca = { terminal: process.env.ORCA_TERMINAL_HANDLE, agent: process.env.ORCA_AGENT_SESSION_ID || '' };
  const entries = collectEntries('MessageDisplay', input, s, speakerFor(s));
  if (!entries.length) return;
  const { rooms, other } = loadRooms();
  const room = (roomFor(s.cwd, rooms) || other).name;
  appendEntries(room, entries);
  writeRoomLog(room);
}

function handleEvent(input) {
  const id = input.session_id;
  if (!id) return;
  const ev = input.hook_event_name || '';
  const file = sessionFile(id);
  const prev = readJson(file, null);
  const s = prev || { id, startedAt, state: 'idle', stateSince: startedAt };

  if (input.cwd) s.cwd = input.cwd;
  if (input.transcript_path) s.transcriptPath = input.transcript_path;
  if (input.permission_mode) s.permissionMode = input.permission_mode;
  // Orca 탭·터미널 ID: 회의 상태 파일(meetings/*.json)의 역할과 세션을 짝지을 때 쓴다.
  // 터미널 탭은 TERMINAL_HANDLE/PANE_KEY/TAB_ID 를, 구조화된 채팅 탭은 AGENT_SESSION_ID 를 갖는다.
  const orca = {
    terminal: process.env.ORCA_TERMINAL_HANDLE || '',
    pane: process.env.ORCA_PANE_KEY || '',
    tab: process.env.ORCA_TAB_ID || '',
    agent: process.env.ORCA_AGENT_SESSION_ID || '',
  };
  if (orca.terminal || orca.pane || orca.tab || orca.agent) s.orca = orca;
  s.lastEvent = ev;

  // 비동기 훅은 순서가 뒤바뀔 수 있으므로, 더 최근 이벤트가 이미 기록됐으면 상태는 건드리지 않는다.
  const stale = prev && typeof prev.eventAt === 'number' && prev.eventAt > startedAt;

  let next = null;
  const tool = input.tool_name || '';
  switch (ev) {
    case 'SessionStart':
      if (input.source === 'clear') { s.lastPrompt = ''; s.title = ''; s.lastMessage = ''; }
      if (input.source !== 'compact') next = 'idle';
      if (input.model) s.model = typeof input.model === 'string' ? input.model : (input.model.display_name || input.model.id || '');
      delete s.endedAt;
      break;
    case 'UserPromptSubmit':
      next = 'working';
      // <task-notification> 같은 시스템 메시지나 Orca 워커 안내문은 사람이 보낸 요청이 아니므로 마지막 요청으로 남기지 않는다.
      if (input.prompt && !/^\s*<[a-z][\w-]*[\s>]/i.test(input.prompt) && !/^\s*You are working inside Orca/i.test(input.prompt)
        && !/^\s*You have \d+ orchestration message/i.test(input.prompt)) {
        s.lastPrompt = clip(input.prompt, 200);
      }
      s.promptAt = startedAt;
      s.tool = '';
      s.waitingFor = '';
      break;
    case 'PreToolUse':
      if (tool === 'AskUserQuestion') { next = 'question'; s.waitingFor = clip(questionText(input.tool_input), 140); }
      else if (tool === 'ExitPlanMode') { next = 'approval'; s.waitingFor = '계획 승인'; }
      else { next = 'working'; s.waitingFor = ''; }
      s.tool = tool;
      break;
    case 'PermissionRequest':
      next = 'approval';
      s.tool = tool;
      s.waitingFor = summarizeToolInput(tool, input.tool_input);
      break;
    case 'Notification': {
      const type = input.notification_type || '';
      if (type === 'permission_prompt') {
        next = 'approval';
        if (!s.waitingFor) s.waitingFor = clip(input.message || '권한 승인 필요', 140);
      } else if (type === 'elicitation_dialog' || type === 'elicitation_url_dialog' || type === 'agent_needs_input') {
        next = 'question';
        s.waitingFor = clip(input.message || '입력 필요', 140);
      } else if (type === 'idle_prompt') {
        if (s.state === 'working') next = 'done';
      }
      break;
    }
    case 'PostToolUse':
    case 'PostToolUseFailure':
      next = 'working';
      s.waitingFor = '';
      break;
    case 'Stop':
      next = 'done';
      s.tool = '';
      s.waitingFor = '';
      if (input.last_assistant_message) s.lastMessage = clip(input.last_assistant_message, 200);
      break;
    case 'StopFailure':
      next = 'error';
      s.errorText = clip(input.last_assistant_message || input.error || 'API 오류', 140);
      break;
    case 'SessionEnd':
      next = 'ended';
      s.endedAt = startedAt;
      s.endReason = input.reason || '';
      s.subagents = {};
      break;
    case 'SubagentStart':
      // 서브에이전트(워커)는 같은 방에서 메인 캐릭터 옆에 둘러앉은 작은 캐릭터로 보여 준다.
      if (input.agent_id) {
        s.subagents = s.subagents || {};
        s.subagents[input.agent_id] = { type: clip(input.agent_type || 'agent', 40), since: startedAt };
      }
      break;
    case 'SubagentStop':
      if (input.agent_id && s.subagents) delete s.subagents[input.agent_id];
      break;
    default:
      break;
  }

  if (next && !stale) {
    if (next !== s.state) s.stateSince = startedAt;
    s.state = next;
    s.eventAt = startedAt;
    if (next !== 'error') delete s.errorText;
  }
  s.updatedAt = Date.now();

  if (ev === 'SessionStart' || ev === 'UserPromptSubmit' || ev === 'Stop' || !s.title) {
    const title = readTitle(s.transcriptPath);
    if (title) s.title = clip(title, 80);
  }

  fs.mkdirSync(SESS_DIR, { recursive: true });
  writeAtomic(file, JSON.stringify(s));

  // 회의록
  try {
    const entries = collectEntries(ev, input, s, speakerFor(s));
    if (entries.length || ev === 'Stop') {
      const { rooms, other } = loadRooms();
      const room = (roomFor(s.cwd, rooms) || other).name;
      appendEntries(room, entries);
      writeRoomLog(room);
      if (ev === 'Stop' || ev === 'SessionEnd' || ev === 'StopFailure') writeMinutesMd(room, dayStr(Date.now()));
    }
  } catch (e) {
    logError(e);
  }
}

function questionText(toolInput) {
  try {
    const q = toolInput && toolInput.questions && toolInput.questions[0];
    return (q && (q.question || q.header)) || '질문에 답변 필요';
  } catch (_) {
    return '질문에 답변 필요';
  }
}

// ---------- state.js 만들기 ----------

function isAlive(pid) {
  if (!pid) return false;
  try { process.kill(Number(pid), 0); return true; } catch (e) { return e.code === 'EPERM'; }
}

// Claude Code 가 실행 중인 세션마다 남기는 ~/.claude/sessions/<pid>.json 을 읽는다.
// 공식 문서에 없는 내부 파일이라, 형식이 바뀌어도 현황판이 깨지지 않게 방어적으로 읽는다.
function readRegistry() {
  const map = new Map();
  let names = [];
  try { names = fs.readdirSync(REGISTRY_DIR); } catch (_) { return map; }
  for (const name of names) {
    if (!/^\d+\.json$/.test(name)) continue;
    const r = readJson(path.join(REGISTRY_DIR, name), null);
    if (!r || !r.sessionId) continue;
    map.set(r.sessionId, {
      pid: r.pid,
      alive: isAlive(r.pid),
      cwd: r.cwd,
      name: r.name,
      nameSource: r.nameSource,
      status: r.status,
      statusUpdatedAt: Number(r.statusUpdatedAt) || 0,
      startedAt: Number(r.startedAt) || 0,
      entrypoint: r.entrypoint,
    });
  }
  return map;
}

function findTranscript(sessionId) {
  let dirs = [];
  try { dirs = fs.readdirSync(PROJECTS_DIR); } catch (_) { return null; }
  for (const d of dirs) {
    const f = path.join(PROJECTS_DIR, d, `${sessionId}.jsonl`);
    if (fs.existsSync(f)) return f;
  }
  return null;
}

function loadRooms() {
  const cfg = readJson(ROOMS_FILE, null) || {};
  const rooms = (cfg.rooms || []).map((r, i) => ({
    no: r.no || String((i + 1) * 10),
    name: r.name,
    paths: (Array.isArray(r.paths) ? r.paths : [r.paths]).filter(Boolean),
  }));
  const other = Object.assign({ no: '99', name: '기타' }, cfg.otherRoom || {});
  return { rooms, other };
}

function roomFor(cwd, rooms) {
  const p = normPath(cwd);
  let best = null;
  let bestLen = -1;
  for (const r of rooms) {
    for (const rp of r.paths) {
      const n = normPath(rp);
      if ((p === n || p.startsWith(n + '/')) && n.length > bestLen) { best = r; bestLen = n.length; }
    }
  }
  return best;
}

function rebuild() {
  const now = Date.now();
  const { rooms, other } = loadRooms();
  const registry = readRegistry();
  const cache = readJson(CACHE_FILE, {});
  let cacheDirty = false;
  const sessions = [];
  const seen = new Set();

  let files = [];
  try { files = fs.readdirSync(SESS_DIR).filter((f) => f.endsWith('.json')); } catch (_) {}

  for (const f of files) {
    const full = path.join(SESS_DIR, f);
    const s = readJson(full, null);
    if (!s || !s.id) continue;
    const age = now - (s.updatedAt || 0);
    const reg = registry.get(s.id);

    if (age > FILE_KEEP_MS && !(reg && reg.alive)) { try { fs.unlinkSync(full); } catch (_) {} continue; }

    let state = s.state;
    let quiet = false;
    if (reg) {
      if (!reg.alive && state !== 'ended') { state = 'ended'; s.endedAt = s.endedAt || reg.statusUpdatedAt || s.updatedAt; }
      // Esc 로 중단하면 Stop 훅이 오지 않는다. Claude Code 쪽 상태가 더 최근에 idle 이 되었으면 끝난 것으로 본다.
      if (reg.alive && state === 'working' && reg.status === 'idle' && reg.statusUpdatedAt > (s.eventAt || 0) + 3000) state = 'done';
      if (reg.nameSource === 'user' && reg.name) s.title = reg.name;
    } else if (state !== 'ended' && age > QUIET_HIDE_MS) {
      continue;
    } else if (state !== 'ended' && age > 2 * HOUR) {
      quiet = true;
    }
    if (state === 'ended' && now - (s.endedAt || s.updatedAt || 0) > ENDED_VISIBLE_MS) continue;

    seen.add(s.id);
    sessions.push(publicSession(s, state, quiet, reg, rooms, other));
  }

  // 훅 기록은 없지만 Claude Code 가 실행 중이라고 알려 주는 세션도 보여 준다.
  for (const [id, reg] of registry) {
    if (seen.has(id) || !reg.alive) continue;
    let entry = cache[id];
    if (!entry || now - (entry.checkedAt || 0) > MIN) {
      const tp = (entry && entry.transcriptPath) || findTranscript(id);
      entry = { transcriptPath: tp, title: readTitle(tp) || (entry && entry.title) || '', checkedAt: now };
      cache[id] = entry;
      cacheDirty = true;
    }
    const s = {
      id,
      cwd: reg.cwd,
      title: reg.nameSource === 'user' && reg.name ? reg.name : entry.title,
      startedAt: reg.startedAt,
      stateSince: reg.statusUpdatedAt,
      updatedAt: reg.statusUpdatedAt,
    };
    const state = reg.status === 'busy' ? 'working' : 'idle';
    sessions.push(publicSession(s, state, false, reg, rooms, other));
  }

  if (cacheDirty) {
    for (const k of Object.keys(cache)) if (now - (cache[k].checkedAt || 0) > FILE_KEEP_MS) delete cache[k];
    try { writeAtomic(CACHE_FILE, JSON.stringify(cache)); } catch (e) { logError(e); }
  }

  const meetings = readMeetings(now, sessions);
  diffMeetings(meetings);
  cleanupMinutes();
  const payload = {
    generatedAt: now,
    rooms: rooms.map((r) => ({ no: r.no, name: r.name, key: roomKey(r.name) }))
      .concat([{ no: other.no, name: other.name, key: roomKey(other.name), isOther: true }]),
    sessions,
    meetings,
  };
  writeAtomic(STATE_FILE, `window.__WORKROOM__ = ${JSON.stringify(payload)};\n`);
}

// 오케스트레이션 의장 세션이 남기는 회의 상태 파일(meetings/*.json)을 읽고, 역할마다 실제 세션을 짝지어 둔다.
function text(v) {
  if (v == null) return '';
  if (typeof v === 'string' || typeof v === 'number') return String(v);
  if (typeof v === 'object') return [v.id, v.title || v.name].filter(Boolean).join(' ');
  return '';
}

function idsOf(o) {
  o = o || {};
  return {
    sessionId: text(o.sessionId),
    terminal: text(o.terminal || o.terminalHandle),
    pane: text(o.paneKey || o.pane),
    tab: text(o.tabId || o.tab),
    agent: text(o.orcaAgentSessionId || o.agentSessionId),
  };
}

// "structworker_08c7…-…" 와 "claude_08c7…_…" 처럼 접두어·구분자가 달라도 같은 UUID 면 같은 것으로 본다.
function uuidOf(v) {
  const m = String(v || '').toLowerCase().match(/[0-9a-f]{8}[-_]?[0-9a-f]{4}[-_]?[0-9a-f]{4}[-_]?[0-9a-f]{4}[-_]?[0-9a-f]{12}/);
  return m ? m[0].replace(/[-_]/g, '') : '';
}

function findSession(ids, sessions, taken) {
  const live = sessions.filter((s) => s.state !== 'ended' && !taken.has(s.id));
  const wanted = [ids.terminal, ids.agent].map(uuidOf).filter(Boolean);
  const exact = live.find((s) => (ids.sessionId && s.id === ids.sessionId)
    || (s.orca && ((ids.terminal && s.orca.terminal === ids.terminal) || (ids.pane && s.orca.pane === ids.pane)
      || (s.orca.agent && wanted.includes(uuidOf(s.orca.agent))))));
  if (exact) return exact;
  return live.find((s) => ids.tab && s.orca && s.orca.tab === ids.tab) || null;
}

function readMeetings(now, sessions) {
  let names = [];
  try { names = fs.readdirSync(MEETINGS_DIR).filter((f) => f.endsWith('.json')); } catch (_) { return []; }
  const out = [];
  for (const f of names) {
    const m = readJson(path.join(MEETINGS_DIR, f), null);
    if (!m || !m.room) continue;
    const updatedAt = typeof m.updatedAt === 'number' ? m.updatedAt : (Date.parse(m.updatedAt) || 0);
    if (!updatedAt || now - updatedAt > QUIET_HIDE_MS) continue;
    if (text(m.round) === 'done') continue;
    const taken = new Set();
    const chairIds = idsOf(m.chair);
    const chair = findSession(chairIds, sessions, taken);
    if (chair) taken.add(chair.id);
    const roles = (Array.isArray(m.roles) ? m.roles : []).slice(0, 12).map((r) => {
      const ids = idsOf(r);
      const hit = findSession(ids, sessions, taken);
      if (hit) taken.add(hit.id);
      return {
        role: clip(text(r.role), 24),
        label: clip(text(r.label || r.role), 16),
        agent: clip(text(r.agent), 16),
        state: ['waiting', 'working', 'done', 'error', 'idle'].includes(r.state) ? r.state : 'waiting',
        output: clip(text(r.output), 140),
        matchId: hit ? hit.id : '',
      };
    });
    out.push({
      key: f.replace(/\.json$/, ''),
      room: clip(text(m.room), 40),
      agenda: clip(text(m.agenda), 60),
      round: clip(text(m.round), 20),
      phase: clip(text(m.phase), 60),
      waitingForUser: !!m.waitingForUser,
      waitingReason: clip(text(m.waitingReason), 140),
      chairId: chair ? chair.id : '',
      roles,
      updatedAt,
    });
  }
  return out;
}

function publicSession(s, state, quiet, reg, rooms, other) {
  const room = roomFor(s.cwd, rooms);
  const folder = String(s.cwd || '').replace(/[\\/]+$/, '').split(/[\\/]/).pop() || '';
  // SubagentStop 을 놓친 워커가 계속 남지 않도록, 끝난 세션이거나 6시간 넘은 워커는 뺀다.
  const subagents = state === 'ended' ? [] : Object.values(s.subagents || {})
    .filter((a) => Date.now() - (a.since || 0) < 6 * HOUR)
    .map((a) => ({ type: a.type, since: a.since }));
  return {
    id: s.id,
    room: room ? room.name : other.name,
    folder,
    cwd: s.cwd || '',
    title: s.title || '',
    state,
    quiet,
    stateSince: s.stateSince || s.updatedAt || 0,
    updatedAt: s.updatedAt || 0,
    startedAt: s.startedAt || 0,
    endedAt: s.endedAt || 0,
    lastPrompt: s.lastPrompt || '',
    lastMessage: s.lastMessage || '',
    tool: s.tool || '',
    waitingFor: s.waitingFor || '',
    errorText: s.errorText || '',
    subagents,
    orca: s.orca || null,
    viaRegistryOnly: !s.lastEvent,
    app: reg && reg.entrypoint === 'sdk-ts' ? 'chat' : 'terminal',
  };
}

// ---------- 진입점 ----------

function main() {
  if (process.argv.includes('--rebuild')) {
    rebuild();
    // 수동 재생성 때는 오늘 회의록이 있는 방의 현황판용 파일과 md 도 다시 만든다.
    const day = dayStr(Date.now());
    const { rooms, other } = loadRooms();
    for (const r of rooms.concat([other])) {
      if (fs.existsSync(path.join(minutesDir(r.name), `${day}.jsonl`))) { writeRoomLog(r.name); writeMinutesMd(r.name, day); }
    }
    return;
  }
  let raw = '';
  const guard = setTimeout(() => process.exit(0), 5000);
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (c) => { raw += c; });
  process.stdin.on('end', () => {
    try {
      const input = JSON.parse(raw);
      if (input.hook_event_name === 'MessageDisplay') {
        if (input.session_id) handleMessage(input);
      } else {
        handleEvent(input);
        rebuild();
      }
    } catch (e) {
      logError(e);
    }
    clearTimeout(guard);
  });
}

try { main(); } catch (e) { logError(e); }
