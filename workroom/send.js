'use strict';
// 현황판에서 세션에 짧은 지시 보내기.
// - 이 컴퓨터 세션: Orca 명령줄(orca terminal send)로 그 세션 터미널에 입력하고 Enter 를 친다.
//   셸에 잘못 들어가 명령으로 돌지 않게, Orca 가 에이전트(claude 등)가 돌고 있다고 알려 주는 터미널에만 넣는다.
// - 다른 컴퓨터 세션: outbox/ 에 적어 두면 sync.js 가 비공개 저장소의 이 컴퓨터 브랜치(send/<받을 컴퓨터 키>/)로 올리고,
//   받을 컴퓨터의 sync.js 가 받아 자기 Orca 로 넣은 뒤 받음 표시(receipts/)를 올린다. 그걸 보면 outbox 에서 지운다.
// 기록: send-log.json (이 컴퓨터에서 보낸 최근 200건과 상태). 이 컴퓨터에만 두고 올리지 않는다.
// 명령줄: node send.js <세션ID> <지시>   (예: AI News 세션이 다른 세션에 대신 전할 때)

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const ROOT = __dirname;
const OUTBOX = path.join(ROOT, 'outbox');
const LOG = path.join(ROOT, 'send-log.json');
const MAX_TEXT = 1000;
const HOUR = 3600 * 1000;

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
  let out;
  try {
    out = execFileSync(orcaBin(), args.concat('--json'), { encoding: 'utf8', timeout, windowsHide: true, maxBuffer: 8 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) {
    out = String(e.stdout || '');
    if (!out.trim()) throw e;
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
  let list;
  try { list = orca(['terminal', 'list'], 15000); } catch (e) { return { ok: false, error: 'Orca 에 연결하지 못했어요 (Orca 가 켜져 있는지 확인)' }; }
  const t = ((list.result && list.result.terminals) || []).find((x) => x.handle === handle);
  if (!t) return { ok: false, error: '그 세션 터미널이 지금 열려 있지 않아요' };
  if (!t.agentIdentity || t.connected === false || t.writable === false) {
    return { ok: false, error: '그 터미널에 에이전트가 돌고 있지 않아서 넣지 않았어요 (셸에 명령으로 들어가지 않게)' };
  }
  let r;
  try { r = orca(['terminal', 'send', '--terminal', handle, '--text', text, '--enter'], 20000); } catch (e) { return { ok: false, error: '보내다 오류가 났어요: ' + String(e.message || e).slice(0, 160) }; }
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

module.exports = { send, deliverLocal, cleanText, pendingOutbox, applyReceipt, readLog, machineKey };

if (require.main === module) {
  const [sid, ...rest] = process.argv.slice(2);
  if (!sid || !rest.length) {
    console.log('사용법: node send.js <세션ID> <지시>');
    process.exit(1);
  }
  const r = send(sid, rest.join(' '));
  console.log(r.ok ? (r.status === 'queued' ? `${r.toMachine} 로 보냈어요 (동기화 때 전달)` : '보냈어요') : `못 보냈어요: ${r.error}`);
  process.exit(r.ok ? 0 : 1);
}
