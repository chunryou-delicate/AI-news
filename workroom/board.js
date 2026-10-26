'use strict';
// 일감 보드와 예약 업무 (현황판 '일감' 탭). 현황판 서버(server.js)가 떠 있는 컴퓨터에만 있다: tasks.json (커밋 금지).
// - 일감: 할 일 → 진행 중(방의 사람에게 보내거나 새로 고용하며 첫 지시로 넣음) → 확인 대기(그 세션이 차례를 마침) → 완료.
// - 예약: 정한 요일·시각에 그 방의 그 사람(이름이 같은 세션)에게 보내고, 없으면 그 이름으로 새로 고용하며 넣는다.
//   서버가 꺼져 있던 동안 지난 예약은 30분 안에 켜졌을 때만 늦게라도 보낸다.
// 실제로 보내고 고용하는 일은 server.js 가 넘겨 준 run(args) 로 send.js 를 따로 띄워 한다 (서버가 멈추지 않게).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = __dirname;
const FILE = path.join(ROOT, 'tasks.json');
const MAX_TEXT = 1000;
const LATE_MS = 30 * 60 * 1000;

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { return fallback; }
}
function writeAtomic(file, content) {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, content, 'utf8');
  try { fs.renameSync(tmp, file); } catch (_) { fs.writeFileSync(file, content, 'utf8'); try { fs.unlinkSync(tmp); } catch (__) {} }
}
function load() {
  const d = readJson(FILE, null) || {};
  return { tasks: Array.isArray(d.tasks) ? d.tasks : [], schedules: Array.isArray(d.schedules) ? d.schedules : [] };
}
function save(d) {
  // 완료한 일감은 최근 50개만 남긴다
  const done = d.tasks.filter((t) => t.status === 'done').sort((a, b) => (b.doneAt || 0) - (a.doneAt || 0)).slice(50).map((t) => t.id);
  d.tasks = d.tasks.filter((t) => !done.includes(t.id));
  writeAtomic(FILE, JSON.stringify(d, null, 1));
}
const one = (v, max) => String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
const newId = () => crypto.randomBytes(5).toString('hex');
function readState() {
  try {
    const t = fs.readFileSync(path.join(ROOT, 'state.js'), 'utf8');
    return JSON.parse(t.slice(t.indexOf('{'), t.lastIndexOf('}') + 1));
  } catch (_) { return { sessions: [], rooms: [] }; }
}
const dayStr = (t) => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

// 일감 하나를 방에 보낸다: sid 가 있으면 그 사람에게, 없으면 hireName 으로 새로 고용하며 첫 지시로
async function assign(run, t, to) {
  const text = one(t.text || t.title, MAX_TEXT);
  if (!text) return { ok: false, error: '보낼 내용이 비어 있어요' };
  let r;
  if (to.sid) r = await run(['--json', to.sid, text], '보내기');
  else if (to.room && to.hireName) r = await run(['--hire', '--json', to.room, to.hireName, '--', text], '고용');
  else return { ok: false, error: '보낼 사람이나 새로 고용할 이름이 필요해요' };
  if (!r || !r.ok) return r || { ok: false, error: '보내지 못했어요' };
  Object.assign(t, {
    status: 'doing', room: to.room || t.room || '', sid: to.sid || '', who: to.sid ? (to.who || '') : to.hireName,
    hired: !to.sid, assignedAt: Date.now(), queued: r.status === 'queued', error: r.promptError || '',
  });
  return { ok: true, queued: r.status === 'queued', promptError: r.promptError || '' };
}

// 현황판에서 오는 요청
async function handle(run, body) {
  const d = load();
  const op = String(body.op || '');
  const find = () => d.tasks.find((x) => x.id === body.id);
  let res = { ok: true };
  if (op === 'add') {
    const title = one(body.title, 120), text = one(body.text, MAX_TEXT);
    if (!title && !text) return { ok: false, error: '내용을 적어 주세요' };
    d.tasks.push({ id: newId(), title: title || text.slice(0, 60), text: text || title, room: one(body.room, 120), status: 'todo', createdAt: Date.now() });
  } else if (op === 'update') {
    const t = find();
    if (!t) return { ok: false, error: '그 일감이 없어요' };
    if (body.title != null) t.title = one(body.title, 120);
    if (body.text != null) t.text = one(body.text, MAX_TEXT);
    if (body.room != null) t.room = one(body.room, 120);
  } else if (op === 'delete') {
    d.tasks = d.tasks.filter((x) => x.id !== body.id);
  } else if (op === 'done' || op === 'reopen') {
    const t = find();
    if (!t) return { ok: false, error: '그 일감이 없어요' };
    t.status = op === 'done' ? 'done' : 'todo';
    if (op === 'done') t.doneAt = Date.now(); else { delete t.doneAt; t.sid = ''; t.who = ''; }
  } else if (op === 'assign') {
    const t = find();
    if (!t) return { ok: false, error: '그 일감이 없어요' };
    res = await assign(run, t, { sid: one(body.sid, 80), who: one(body.who, 80), room: one(body.room, 120), hireName: one(body.hireName, 40) });
  } else if (op === 'sched-add') {
    const time = /^\d\d:\d\d$/.test(body.time) ? body.time : '';
    const days = (Array.isArray(body.days) ? body.days : []).map(Number).filter((n) => n >= 0 && n <= 6);
    const who = one(body.who, 40), room = one(body.room, 120), text = one(body.text, MAX_TEXT);
    if (!time || !days.length || !who || !room || !text) return { ok: false, error: '방·이름·내용·시각·요일을 모두 정해 주세요' };
    d.schedules.push({ id: newId(), title: one(body.title, 120) || text.slice(0, 40), text, room, who, time, days, enabled: true, createdAt: Date.now(), lastRun: '' });
  } else if (op === 'sched-del') {
    d.schedules = d.schedules.filter((x) => x.id !== body.id);
  } else if (op === 'sched-toggle') {
    const s = d.schedules.find((x) => x.id === body.id);
    if (!s) return { ok: false, error: '그 예약이 없어요' };
    s.enabled = !s.enabled;
  } else if (op === 'sched-run') {
    const s = d.schedules.find((x) => x.id === body.id);
    if (!s) return { ok: false, error: '그 예약이 없어요' };
    res = await fire(run, d, s);
  } else {
    return { ok: false, error: '모르는 요청이에요' };
  }
  save(d);
  return Object.assign(res, { tasks: d.tasks, schedules: d.schedules });
}

// 예약 하나 실행: 그 방에 이름이 같은 사람이 있으면 그 사람에게, 없으면 그 이름으로 고용하며 넣는다. 일감도 하나 남긴다.
async function fire(run, d, s) {
  const st = readState();
  const person = (st.sessions || []).filter((x) => x.room === s.room && x.state !== 'ended' && String(x.title || '').trim() === s.who)
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))[0];
  const t = { id: newId(), title: `[예약] ${s.title}`, text: s.text, room: s.room, status: 'todo', createdAt: Date.now(), schedId: s.id };
  d.tasks.push(t);
  const r = await assign(run, t, person ? { sid: person.id, who: s.who, room: s.room } : { room: s.room, hireName: s.who });
  s.lastRun = dayStr(Date.now());
  s.lastResult = r.ok ? (person ? '보냄' : '고용하며 보냄') : '실패: ' + (r.error || '');
  if (!r.ok) t.error = r.error || '';
  return r;
}

// 30초마다: 예약 실행, 진행 중인 일감의 상태 맞추기
let busy = false;
async function tick(run) {
  if (busy) return;
  busy = true;
  try {
    const d = load();
    let changed = false;
    const now = Date.now(), today = dayStr(now), wd = new Date(now).getDay();
    for (const s of d.schedules) {
      if (!s.enabled || s.lastRun === today || !s.days.includes(wd)) continue;
      const [h, m] = s.time.split(':').map(Number);
      const at = new Date(now); at.setHours(h, m, 0, 0);
      if (now < at.getTime()) continue;
      if (now - at.getTime() > LATE_MS) { s.lastRun = today; s.lastResult = '서버가 꺼져 있어 건너뜀'; changed = true; continue; }
      await fire(run, d, s);
      changed = true;
    }
    const st = readState();
    const sessions = st.sessions || [];
    for (const t of d.tasks) {
      if (t.status !== 'doing') continue;
      // 새로 고용한 사람은 방에 들어오면(이름이 같고 배정 뒤에 시작한 세션) 짝짓는다
      if (!t.sid && t.hired) {
        const hit = sessions.find((x) => x.room === t.room && String(x.title || '').trim() === t.who && (x.startedAt || 0) >= (t.assignedAt || 0) - 120000);
        if (hit) { t.sid = hit.id; changed = true; }
      }
      const s = t.sid && sessions.find((x) => x.id === t.sid);
      // 그 세션이 차례를 마쳤거나 답을 기다리면 확인 대기로
      if (s && ['done', 'approval', 'question', 'error', 'ended'].includes(s.state) && (s.stateSince || 0) > (t.assignedAt || 0) + 3000) {
        t.status = 'review';
        t.reviewAt = now;
        changed = true;
      }
    }
    if (changed) save(d);
  } catch (_) {
  } finally { busy = false; }
}

function start(run) {
  setInterval(() => { tick(run); }, 30 * 1000).unref();
  setTimeout(() => { tick(run); }, 5000).unref();
}

module.exports = { load, handle, start, tick };
