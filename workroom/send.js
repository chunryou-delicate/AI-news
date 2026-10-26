'use strict';
// 현황판에서 세션에 짧은 지시 보내기, 방에 사람(새 세션) 고용하기.
// - 이 컴퓨터 세션: Orca 명령줄(orca terminal send)로 그 세션 터미널에 입력하고 Enter 를 친다.
//   셸에 잘못 들어가 명령으로 돌지 않게, Orca 가 에이전트(claude 등)가 돌고 있다고 알려 주는 터미널에만 넣는다.
// - 다른 컴퓨터 세션: outbox/ 에 적어 두면 sync.js 가 비공개 저장소의 이 컴퓨터 브랜치(send/<받을 컴퓨터 키>/)로 올리고,
//   받을 컴퓨터의 sync.js 가 받아 자기 Orca 로 넣은 뒤 받음 표시(receipts/)를 올린다. 그걸 보면 outbox 에서 지운다.
// 기록: send-log.json (이 컴퓨터에서 보낸 최근 200건과 상태). 이 컴퓨터에만 두고 올리지 않는다.
// 명령줄: node send.js <세션ID> <지시>          (예: AI News 세션이 다른 세션에 대신 전할 때)
//         node send.js --json <세션ID> <지시>   결과를 JSON 한 줄로 (server.js 가 따로 띄운 프로세스로 부른다)
//         node send.js --hire [--json] <방> <이름>   그 방 프로젝트 폴더에 새 Claude 세션을 띄운다 (현황판 '사람 고용')
// Orca 명령줄은 컴퓨터에 따라 수십 초 걸릴 수 있어서, 터미널 전체 목록(terminal list) 대신 그 터미널 하나(terminal show)만 묻고,
// 출력은 파이프 대신 임시 파일로 받는다 (제한 시간에 끊어도 Orca 쪽 하위 프로세스가 파이프를 붙잡아 오래 멈추지 않게).

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const ROOT = __dirname;
const OUTBOX = path.join(ROOT, 'outbox');
const LOG = path.join(ROOT, 'send-log.json');
const MAX_TEXT = 1000;
const HOUR = 3600 * 1000;
const SHOW_MS = 40 * 1000, SEND_MS = 45 * 1000;   // Orca 명령 제한 시간 (느린 노트북에서 목록이 13~29초 걸렸다)

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { return fallback; }
}
function writeAtomic(file, content) {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, content, 'utf8');
  try { fs.renameSync(tmp, file); } catch (_) { fs.writeFileSync(file, content, 'utf8'); try { fs.unlinkSync(tmp); } catch (__) {} }
}
// sync.js 의 machineKey 와 같아야 한다.
function machineKey(name) {
  let h = 2166136261;
  for (const ch of String('machine:' + name)) { h ^= ch.codePointAt(0); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(16);
}
function myMachine() {
  return (readJson(path.join(ROOT, 'sync.json'), null) || {}).machine || os.hostname();
}

// 한 줄로 (줄바꿈이 들어가면 터미널에서 중간에 Enter 로 들어간다), 제어 문자 빼고, 길이 제한
function cleanText(text) {
  return String(text || '').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT);
}

function readState() {
  try {
    const text = fs.readFileSync(path.join(ROOT, 'state.js'), 'utf8');
    const m = text.match(/=\s*(\{[\s\S]*\})\s*;\s*$/);
    return m ? JSON.parse(m[1]) : { sessions: [] };
  } catch (_) {
    return { sessions: [] };
  }
}

// Orca 명령줄: PATH 의 orca, 없으면 설치 기본 위치
function orcaBin() {
  if (process.env.ORCA_CLI) return process.env.ORCA_CLI;
  const home = os.homedir();
  const cands = process.platform === 'win32'
    ? [path.join(process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local'), 'Programs', 'orca', 'resources', 'bin', 'orca.exe')]
    : process.platform === 'darwin'
      ? ['/Applications/Orca.app/Contents/Resources/bin/orca', path.join(home, 'Applications', 'Orca.app', 'Contents', 'Resources', 'bin', 'orca')]
      : ['/opt/Orca/resources/bin/orca', '/usr/lib/orca/resources/bin/orca', path.join(home, '.local', 'bin', 'orca')];
  for (const c of cands) if (fs.existsSync(c)) return c;
  return 'orca';
}
function orca(args, timeout) {
  const base = path.join(os.tmpdir(), `workroom-orca-${process.pid}-${crypto.randomBytes(4).toString('hex')}`);
  const fo = fs.openSync(`${base}.out`, 'w');
  let r;
  try {
    r = spawnSync(orcaBin(), args.concat('--json'), { stdio: ['ignore', fo, 'ignore'], timeout, windowsHide: true });
  } finally {
    fs.closeSync(fo);
  }
  let out = '';
  try { out = fs.readFileSync(`${base}.out`, 'utf8'); } catch (_) {}
  try { fs.unlinkSync(`${base}.out`); } catch (_) {}
  if (!out.trim()) {
    const timedOut = !!(r.error && r.error.code === 'ETIMEDOUT');
    const e = new Error(timedOut ? 'timeout' : String((r.error && r.error.message) || 'Orca 출력이 없어요'));
    e.timeout = timedOut;
    throw e;
  }
  return JSON.parse(out);
}
function orcaError(r) {
  const e = r && r.error;
  return (e && (e.message || e.code)) || (typeof e === 'string' ? e : '') || 'Orca 가 받지 못했어요';
}

// 이 컴퓨터 세션 터미널에 바로 넣는다
function deliverLocal(sid, text) {
  text = cleanText(text);
  if (!text) return { ok: false, error: '보낼 말이 비어 있어요' };
  const s = (readState().sessions || []).find((x) => x.id === sid && !x.machine);
  if (!s) return { ok: false, error: '이 컴퓨터에서 그 세션을 찾지 못했어요' };
  if (s.state === 'ended') return { ok: false, error: '이미 끝난 세션이에요' };
  const handle = s.orca && s.orca.terminal;
  if (!handle) return { ok: false, error: 'Orca 터미널에서 돌고 있는 세션만 받을 수 있어요 (채팅 탭은 아직 안 돼요)' };
  let info;
  try { info = orca(['terminal', 'show', '--terminal', handle], SHOW_MS); } catch (e) {
    return { ok: false, error: e.timeout ? `Orca 가 ${SHOW_MS / 1000}초 안에 답하지 않았어요 (잠시 뒤 다시 보내 주세요)` : 'Orca 에 연결하지 못했어요 (Orca 가 켜져 있는지 확인)' };
  }
  if (!info || !info.ok) {
    const code = info && info.error && info.error.code;
    return { ok: false, error: /stale|not_found|unknown/i.test(String(code)) ? '그 세션 터미널이 지금 열려 있지 않아요' : orcaError(info) };
  }
  const t = info.result && (info.result.terminal || info.result);
  if (!t || t.handle !== handle) return { ok: false, error: '그 세션 터미널이 지금 열려 있지 않아요' };
  if (!t.agentIdentity || t.connected === false || t.writable === false) {
    return { ok: false, error: '그 터미널에 에이전트가 돌고 있지 않아서 넣지 않았어요 (셸에 명령으로 들어가지 않게)' };
  }
  let r;
  try { r = orca(['terminal', 'send', '--terminal', handle, '--text', text, '--enter'], SEND_MS); } catch (e) {
    return { ok: false, error: e.timeout ? `Orca 가 ${SEND_MS / 1000}초 안에 답하지 않았어요. 들어갔을 수도 있으니 터미널을 보고 다시 보내 주세요` : '보내다 오류가 났어요: ' + String(e.message || e).slice(0, 160) };
  }
  return r && r.ok ? { ok: true } : { ok: false, error: orcaError(r) };
}

// ---------- 보낸 기록 ----------
function readLog() { return readJson(LOG, []); }
function writeLog(list) { writeAtomic(LOG, JSON.stringify(list.slice(-200))); }
function logAdd(entry) { const l = readLog(); l.push(entry); writeLog(l); }
function logUpdate(id, patch) {
  const l = readLog(), e = l.find((x) => x.id === id);
  if (!e) return;
  Object.assign(e, patch);
  writeLog(l);
}

// ---------- 다른 컴퓨터로 ----------
function pendingOutbox() {
  let files = [];
  try { files = fs.readdirSync(OUTBOX).filter((f) => f.endsWith('.json')); } catch (_) { return []; }
  const out = [];
  for (const f of files) {
    const m = readJson(path.join(OUTBOX, f), null);
    if (!m) continue;
    // 하루가 지나도록 받음 표시가 없으면 접는다
    if (Date.now() - (m.at || 0) > 24 * HOUR) {
      logUpdate(m.id, { status: 'failed', error: '하루 동안 그 컴퓨터가 받지 않았어요' });
      try { fs.unlinkSync(path.join(OUTBOX, f)); } catch (_) {}
      continue;
    }
    out.push(m);
  }
  return out;
}
// 받을 컴퓨터가 올린 받음 표시를 보고 정리한다
function applyReceipt(rc, fromMachine) {
  const file = path.join(OUTBOX, `${rc.id}.json`);
  if (!fs.existsSync(file)) return;
  logUpdate(rc.id, rc.ok ? { status: 'delivered', doneAt: rc.at || Date.now() } : { status: 'failed', error: rc.error || `${fromMachine} 에서 넣지 못했어요`, doneAt: rc.at || Date.now() });
  try { fs.unlinkSync(file); } catch (_) {}
}

// 현황판(server.js)과 명령줄이 부른다
function send(sid, text) {
  text = cleanText(text);
  if (!text) return { ok: false, error: '보낼 말이 비어 있어요' };
  const s = (readState().sessions || []).find((x) => x.id === sid);
  if (!s) return { ok: false, error: '그 세션을 찾지 못했어요' };
  const id = crypto.randomBytes(6).toString('hex');
  const base = { id, at: Date.now(), sid, title: s.title || '', room: s.room || '', text };
  if (s.machine) {
    if (s.state === 'ended') return { ok: false, error: '이미 끝난 세션이에요' };
    const sc = readJson(path.join(ROOT, 'sync.json'), null);
    if (!sc || !sc.repo || !sc.push) return { ok: false, error: '이 컴퓨터는 동기화로 올리지 않게 되어 있어서 다른 컴퓨터로 보낼 수 없어요' };
    fs.mkdirSync(OUTBOX, { recursive: true });
    const msg = Object.assign({ to: machineKey(s.machine), toMachine: s.machine, from: myMachine() }, base);
    writeAtomic(path.join(OUTBOX, `${id}.json`), JSON.stringify(msg));
    logAdd(Object.assign({ status: 'queued', toMachine: s.machine }, base));
    return { ok: true, id, status: 'queued', toMachine: s.machine };
  }
  const r = deliverLocal(sid, text);
  logAdd(Object.assign({ status: r.ok ? 'delivered' : 'failed', error: r.error || '', doneAt: Date.now() }, base));
  return Object.assign({ id, status: r.ok ? 'delivered' : 'failed' }, r);
}

// ---------- 사람 고용: 그 방 프로젝트 폴더에 새 Claude 세션 ----------
// Orca 새 터미널(탭 제목 = 이름)에서 claude -n "이름" 으로 시작한다. 다른 컴퓨터 방이면 지시와 같은 길(outbox → 그 컴퓨터 sync.js)로 보낸다.
const CREATE_MS = 60 * 1000;
// 셸에 그대로 들어가므로 글자·숫자·빈칸·몇몇 기호만 남긴다
function cleanName(name) {
  return String(name || '').replace(/[^\p{L}\p{N} ._()·-]+/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, 40);
}
function isDir(p) { try { return !!p && fs.statSync(p).isDirectory(); } catch (_) { return false; } }
function roomsConfig() { return readJson(path.join(ROOT, 'rooms.json'), {}) || {}; }
// 방 폴더: rooms.json 의 paths → 받은 힌트(그 방 세션이 쓰던 폴더) → 이 컴퓨터에서 그 방 세션이 최근에 쓴 폴더
function roomFolder(room, cwdHint) {
  const r = (roomsConfig().rooms || []).find((x) => x.name === room);
  const recent = (readState().sessions || []).filter((s) => !s.machine && s.room === room && s.cwd)
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)).map((s) => s.cwd);
  return [].concat((r && r.paths) || [], cwdHint || [], recent).find(isDir) || '';
}
function hireLocal(room, name, cwdHint) {
  name = cleanName(name);
  if (!name) return { ok: false, error: '이름을 적어 주세요' };
  const other = (roomsConfig().otherRoom || {}).name;
  if (other && room === other) return { ok: false, error: `${other} 라운지는 정해진 폴더가 없어서 고용할 수 없어요` };
  const folder = roomFolder(room, cwdHint);
  if (!folder) return { ok: false, error: '그 방의 프로젝트 폴더를 이 컴퓨터에서 찾지 못했어요' };
  const create = (dir) => orca(['terminal', 'create', '--worktree', 'path:' + dir, '--title', name, '--command', `claude -n "${name}"`], CREATE_MS);
  let r;
  try {
    r = create(folder);
    if (!r || !r.ok) {
      // Orca 에 그 폴더가 아니라 그 안의 작업 폴더만 등록돼 있으면 그쪽에 연다
      const norm = (p) => String(p || '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
      const wt = orca(['worktree', 'list'], SHOW_MS);
      const hit = ((wt && wt.result && wt.result.worktrees) || []).find((w) => norm(w.path).startsWith(norm(folder) + '/'));
      if (hit) r = create(hit.path);
    }
  } catch (e) {
    return { ok: false, error: e.timeout ? `Orca 가 ${CREATE_MS / 1000}초 안에 답하지 않았어요. 탭이 생겼을 수 있으니 Orca 를 보고 다시 해 주세요` : 'Orca 에 연결하지 못했어요 (Orca 가 켜져 있는지 확인)' };
  }
  if (!r || !r.ok) return { ok: false, error: /worktree|not.?found|unknown/i.test(JSON.stringify((r && r.error) || '')) ? 'Orca 에 그 폴더가 프로젝트로 등록돼 있지 않아요' : orcaError(r) };
  return { ok: true, name, folder };
}
// 현황판(server.js)과 명령줄이 부른다. room = 현황판의 방 이름 (다른 컴퓨터 방은 "컴퓨터 · 방")
function hire(room, name) {
  name = cleanName(name);
  if (!name) return { ok: false, error: '이름을 적어 주세요' };
  const st = readState();
  const r = (st.rooms || []).find((x) => x.name === room);
  if (!r) return { ok: false, error: '그 방을 찾지 못했어요' };
  if (r.isOther) return { ok: false, error: '라운지는 정해진 폴더가 없어서 고용할 수 없어요' };
  const id = crypto.randomBytes(6).toString('hex');
  const base = { id, at: Date.now(), kind: 'hire', sid: '', title: name, room, text: `사람 고용: ${name}` };
  if (r.machine) {
    const sc = readJson(path.join(ROOT, 'sync.json'), null);
    if (!sc || !sc.repo || !sc.push) return { ok: false, error: '이 컴퓨터는 동기화로 올리지 않게 되어 있어서 다른 컴퓨터에 고용할 수 없어요' };
    const hint = (st.sessions || []).filter((s) => s.machine === r.machine && s.room === room && s.cwd)
      .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))[0];
    fs.mkdirSync(OUTBOX, { recursive: true });
    const msg = Object.assign({ to: machineKey(r.machine), toMachine: r.machine, from: myMachine(), roomLabel: r.label || room, name, cwd: (hint && hint.cwd) || '' }, base);
    writeAtomic(path.join(OUTBOX, `${id}.json`), JSON.stringify(msg));
    logAdd(Object.assign({ status: 'queued', toMachine: r.machine }, base));
    return { ok: true, id, status: 'queued', toMachine: r.machine };
  }
  const res = hireLocal(room, name);
  logAdd(Object.assign({ status: res.ok ? 'delivered' : 'failed', error: res.error || '', doneAt: Date.now() }, base));
  return Object.assign({ id, status: res.ok ? 'delivered' : 'failed' }, res);
}
// 다른 컴퓨터에서 받은 것 (sync.js): 고용이면 고용, 아니면 지시
function deliverInbound(m) {
  return m.kind === 'hire' ? hireLocal(m.roomLabel, m.name, m.cwd) : deliverLocal(m.sid, m.text);
}

module.exports = { send, deliverLocal, deliverInbound, hire, hireLocal, cleanName, cleanText, pendingOutbox, applyReceipt, readLog, machineKey };

if (require.main === module && process.argv[2] === '--hire') {
  // node send.js --hire [--json] <방> <이름>
  const argv = process.argv.slice(3), json = argv[0] === '--json';
  const [room, ...rest] = json ? argv.slice(1) : argv;
  let r;
  try { r = room && rest.length ? hire(room, rest.join(' ')) : { ok: false, error: '방과 이름이 필요해요' }; } catch (e) { r = { ok: false, error: '고용하다 오류가 났어요: ' + String(e.message || e).slice(0, 160) }; }
  if (json) console.log(JSON.stringify(r));
  else console.log(r.ok ? (r.status === 'queued' ? `${r.toMachine} 로 보냈어요 (동기화 때 그 컴퓨터가 띄움)` : `고용했어요: ${r.name} (${r.folder})`) : `못 했어요: ${r.error}`);
  process.exit(r.ok ? 0 : 1);
} else if (require.main === module) {
  const argv = process.argv.slice(2), json = argv[0] === '--json';
  const [sid, ...rest] = json ? argv.slice(1) : argv;
  if (!sid || !rest.length) {
    console.log(json ? JSON.stringify({ ok: false, error: '세션과 보낼 말이 필요해요' }) : '사용법: node send.js [--json] <세션ID> <지시>');
    process.exit(1);
  }
  let r;
  try { r = send(sid, rest.join(' ')); } catch (e) { r = { ok: false, error: '보내다 오류가 났어요: ' + String(e.message || e).slice(0, 160) }; }
  if (json) console.log(JSON.stringify(r));
  else console.log(r.ok ? (r.status === 'queued' ? `${r.toMachine} 로 보냈어요 (동기화 때 전달)` : '보냈어요') : `못 보냈어요: ${r.error}`);
  process.exit(r.ok ? 0 : 1);
}
