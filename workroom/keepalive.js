'use strict';
// 항상 켜 둘 세션: keepalive.json 에 적은 세션이 꺼져 있으면 되살린다.
// 2026-11-12 Windows 업데이트가 컴퓨터를 스스로 다시 시작한 뒤, Orca 는 작업 공간을 열 때만 잠든 탭을 되살려서
// AI News 메인 세션이 닷새 동안 꺼져 있었다. 사용자가 "이 세션만은 살아 있어야 한다"고 해서 만들었다.
// 순서 (server.js 가 2분마다 따로 띄운다. 한 번에 하나만 돈다):
//   1) 살아 있으면 끝. Claude 세션 레지스트리(<설정 폴더>/sessions/<pid>.json)에 그 세션 pid 가 살아 있고,
//      이번 부팅 뒤에 켜졌으면 산 것으로 본다 (지난 부팅의 pid 를 다른 프로그램이 다시 쓸 수 있어서).
//   2) Orca 가 안 떠 있으면, 부팅 뒤 15분 안일 때만 orca open 으로 띄운다.
//      (사용자가 일부러 끈 Orca 를 계속 다시 띄우지 않게, 그 뒤에는 Orca 가 켜지기를 기다리기만 한다)
//   3) orca worktree activate 로 그 세션의 작업 공간을 연다. Orca 가 잠든 탭을 원래 명령(--remote-control 등)으로
//      스스로 되살린다. 3분 기다린다. 같은 세션이 둘로 겹치지 않는 길이라 먼저 쓴다.
//   4) 그래도 안 살아나면 Orca 새 터미널에서 claude --resume <id> 로 연다 (send.js 깨우기와 같은 길, 같은 설정 폴더·권한 방식).
//   되살리기 시도는 세션마다 15분에 한 번만 한다. 같은 세션이 둘로 돌면(겹침) 아무것도 끄지 않고 상태에만 적는다.
// 기록: keepalive-status.json (이 컴퓨터에만 둔다, 올리지 않음). 오류는 error.log.
// 사용: node keepalive.js                  확인하고 필요하면 되살린다
//       node keepalive.js --check          살아 있는지만 본다 (아무것도 띄우지 않음)
//       node keepalive.js --add <세션ID> [--remote-control <이름>]   항상 켜 둘 목록에 넣는다
//                                           (현황판 세션 기록에서 프로젝트 폴더·설정 폴더·권한 방식·이름을 읽는다)
//       node keepalive.js --remove <세션ID>  목록에서 뺀다

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const ROOT = __dirname;
const LIST = path.join(ROOT, 'keepalive.json');
const STATUS = path.join(ROOT, 'keepalive-status.json');
const LOCK = path.join(ROOT, 'keepalive.lock');
const ERROR_LOG = path.join(ROOT, 'error.log');
const MIN = 60 * 1000;
const RETRY_MS = 15 * MIN;          // 되살리기 시도 간격
const OPEN_ORCA_UPTIME_MS = 15 * MIN; // 부팅 뒤 이 시간 안에만 Orca 를 직접 띄운다
const RESTORE_WAIT_MS = 3 * MIN;    // 작업 공간을 연 뒤 Orca 가 탭을 되살리기를 기다리는 시간
const START_WAIT_MS = 2 * MIN;      // 새 터미널에서 Claude 가 뜨기를 기다리는 시간

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { return fallback; }
}
function writeAtomic(file, content) {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, content, 'utf8');
  try { fs.renameSync(tmp, file); } catch (_) { fs.writeFileSync(file, content, 'utf8'); try { fs.unlinkSync(tmp); } catch (__) {} }
}
function logError(msg) {
  try { fs.appendFileSync(ERROR_LOG, `[${new Date().toISOString()}] keepalive: ${msg}\n`); } catch (_) {}
}
function sleep(ms) { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); }
function isAlive(pid) {
  if (!pid) return false;
  try { process.kill(Number(pid), 0); return true; } catch (e) { return e.code === 'EPERM'; }
}
function bootAt() { return Date.now() - os.uptime() * 1000; }

// ---------- 살아 있는지 ----------
// hook.js 의 registryDirs 와 같은 곳을 본다: ~/.claude, 그 세션 설정 폴더, Orca 프로필들
function registryDirs(configDir) {
  const home = os.homedir();
  const dirs = [path.join(home, '.claude', 'sessions')];
  if (configDir) dirs.push(path.join(configDir, 'sessions'));
  const orcaRoot = process.platform === 'win32' ? path.join(process.env.APPDATA || path.join(home, 'AppData', 'Roaming'), 'orca')
    : process.platform === 'darwin' ? path.join(home, 'Library', 'Application Support', 'orca')
    : path.join(process.env.XDG_CONFIG_HOME || path.join(home, '.config'), 'orca');
  let profiles = [];
  try { profiles = fs.readdirSync(path.join(orcaRoot, 'claude-profiles')); } catch (_) {}
  for (const p of profiles) dirs.push(path.join(orcaRoot, 'claude-profiles', p, 'home', 'sessions'));
  const seen = new Set();
  return dirs.filter((d) => { const k = path.resolve(d).toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; });
}
// Windows 에서는 그 pid 가 정말 claude(또는 node) 프로세스인지도 본다
function looksLikeClaude(pid) {
  if (process.platform !== 'win32') return true;
  const r = spawnSync('tasklist', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'], { encoding: 'utf8', windowsHide: true, timeout: 15000 });
  const out = String(r.stdout || '');
  if (r.error || !out.trim()) return true;   // 못 물으면 레지스트리를 믿는다
  return /"(claude|node)(\.exe)?"/i.test(out);
}
function livePids(entry) {
  const since = bootAt() - MIN;
  const pids = new Set();
  for (const dir of registryDirs(entry.configDir)) {
    let names = [];
    try { names = fs.readdirSync(dir); } catch (_) { continue; }
    for (const n of names) {
      if (!/^\d+\.json$/.test(n)) continue;
      const r = readJson(path.join(dir, n), null);
      if (!r || r.sessionId !== entry.id) continue;
      if ((Number(r.startedAt) || 0) < since) continue;   // 지난 부팅 때 남은 기록
      if (isAlive(r.pid) && looksLikeClaude(r.pid)) pids.add(Number(r.pid));
    }
  }
  return [...pids];
}

// ---------- Orca ----------
function orcaBin() {
  if (process.env.ORCA_CLI) return process.env.ORCA_CLI;
  const home = os.homedir();
  const cands = process.platform === 'win32'
    ? [path.join(process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local'), 'Programs', 'orca', 'resources', 'bin', 'orca.exe')]
    : process.platform === 'darwin'
      ? ['/Applications/Orca.app/Contents/Resources/bin/orca', path.join(home, 'Applications', 'Orca.app', 'Contents', 'Resources', 'bin', 'orca')]
      : ['/opt/Orca/resources/bin/orca-ide', '/usr/lib/orca/resources/bin/orca-ide', path.join(process.env.XDG_CONFIG_HOME || path.join(home, '.config'), 'orca', 'linux-orca-cli-shim', 'orca')];
  for (const c of cands) if (fs.existsSync(c)) return c;
  return 'orca';
}
// send.js 의 orca() 와 같다: 출력은 파이프 대신 임시 파일로 받는다 (Orca 하위 프로세스가 파이프를 붙잡아 멈추지 않게)
function orca(args, timeout) {
  const base = path.join(os.tmpdir(), `workroom-keepalive-${process.pid}-${crypto.randomBytes(4).toString('hex')}`);
  const fo = fs.openSync(`${base}.out`, 'w');
  let r;
  try { r = spawnSync(orcaBin(), args.concat('--json'), { stdio: ['ignore', fo, 'ignore'], timeout, windowsHide: true }); } finally { fs.closeSync(fo); }
  let out = '';
  try { out = fs.readFileSync(`${base}.out`, 'utf8'); } catch (_) {}
  try { fs.unlinkSync(`${base}.out`); } catch (_) {}
  if (!out.trim()) return { ok: false, error: r && r.error && r.error.code === 'ETIMEDOUT' ? 'Orca 가 답하지 않았어요' : 'Orca 출력이 없어요' };
  try { return JSON.parse(out); } catch (_) { return { ok: false, error: 'Orca 출력을 읽지 못했어요' }; }
}
function orcaErr(r) {
  const e = r && r.error;
  return String((e && (e.message || e.code)) || (typeof e === 'string' ? e : '') || 'Orca 가 받지 못했어요').slice(0, 160);
}
function orcaRunning() {
  const r = orca(['status'], 20000);
  const res = (r && r.result) || {};
  const rt = res.runtime;   // { state: 'ready', reachable: true, ... } (옛 판은 글자였을 수 있다)
  const ready = rt === 'ready' || !!(rt && (rt.state === 'ready' || rt.reachable === true));
  return !!(r && r.ok !== false && res.app && res.app.running && ready);
}

// ---------- 되살리기 ----------
function waitAlive(entry, ms) {
  const until = Date.now() + ms;
  for (;;) {
    const pids = livePids(entry);
    if (pids.length) return pids;
    if (Date.now() > until) return [];
    sleep(15000);
  }
}
function resumeCommand(entry) {
  const q = (s) => `'${String(s).replace(/'/g, "''")}'`;
  // 다시 여는 세션은 늘 바이패스로 연다 (사용자 지정 2026-11-18). 이름이 있으면 붙여 휴대폰 목록 제목을 지킨다.
  const parts = ['claude', '--resume', entry.id, '--permission-mode', 'bypassPermissions'];
  if (!entry.remoteControl && entry.name) parts.push('-n', process.platform === 'win32' ? q(entry.name) : `'${String(entry.name).replace(/'/g, "'\\''")}'`);
  if (entry.remoteControl) parts.push('--remote-control', process.platform === 'win32' ? q(entry.remoteControl) : `'${String(entry.remoteControl).replace(/'/g, "'\\''")}'`);
  const cmd = parts.join(' ');
  if (!entry.configDir) return cmd;
  return process.platform === 'win32' ? `$env:CLAUDE_CONFIG_DIR=${q(entry.configDir)}; ${cmd}` : `CLAUDE_CONFIG_DIR='${String(entry.configDir).replace(/'/g, "'\\''")}' ${cmd}`;
}
function revive(entry) {
  const steps = [];
  if (!orcaRunning()) {
    if (os.uptime() * 1000 > OPEN_ORCA_UPTIME_MS) return { ok: false, how: 'wait-orca', steps, error: 'Orca 가 꺼져 있어요 (부팅 직후가 아니라 Orca 가 켜지기를 기다려요)' };
    const r = orca(['open'], 3 * MIN);
    steps.push('orca open ' + (r && r.ok !== false ? 'ok' : orcaErr(r)));
    if (!orcaRunning()) return { ok: false, how: 'orca-open', steps, error: 'Orca 를 띄우지 못했어요' };
  }
  // 3) 작업 공간 열기 → Orca 가 잠든 탭을 스스로 되살린다
  const a = orca(['worktree', 'activate', '--worktree', 'path:' + entry.project], MIN);
  steps.push('worktree activate ' + (a && a.ok !== false ? 'ok' : orcaErr(a)));
  if (a && a.ok !== false) {
    const pids = waitAlive(entry, RESTORE_WAIT_MS);
    if (pids.length) return { ok: true, how: 'orca-restore', steps, pids };
  }
  // 4) 새 터미널에서 resume (기다리는 동안 다른 길로 살아났을 수 있으니 한 번 더 본다)
  if (livePids(entry).length) return { ok: true, how: 'came-back', steps, pids: livePids(entry) };
  const args = ['terminal', 'create', '--worktree', 'path:' + entry.project, '--title', entry.name || 'Claude Code', '--command', resumeCommand(entry)];
  if (process.platform === 'win32') args.push('--shell', 'powershell.exe');
  const c = orca(args, MIN);
  steps.push('terminal create ' + (c && c.ok !== false ? 'ok' : orcaErr(c)));
  if (!c || c.ok === false) return { ok: false, how: 'new-terminal', steps, error: '새 터미널을 열지 못했어요: ' + orcaErr(c) };
  const pids = waitAlive(entry, START_WAIT_MS);
  return pids.length ? { ok: true, how: 'new-terminal', steps, pids } : { ok: false, how: 'new-terminal', steps, error: '새 터미널을 열었지만 Claude 가 뜨지 않았어요' };
}

// ---------- 목록 관리 ----------
function encodeProject(p) { return String(p || '').replace(/[^A-Za-z0-9]/g, '-'); }
// claude --resume 은 대화 기록이 있는 프로젝트 폴더에서 해야 찾는다. 기록 파일 폴더 이름과 맞는 상위 폴더를 고른다.
function projectOf(s) {
  const want = s.transcriptPath ? path.basename(path.dirname(s.transcriptPath)) : '';
  for (let d = s.cwd || ''; d && path.dirname(d) !== d; d = path.dirname(d)) if (want && encodeProject(d) === want) return d;
  return s.cwd || '';
}
function add(id, remoteControl) {
  const s = readJson(path.join(ROOT, 'sessions', String(id).replace(/[^A-Za-z0-9_-]/g, '_') + '.json'), null);
  if (!s || !s.id) return { ok: false, error: '현황판에 그 세션 기록이 없어요 (이 컴퓨터 세션 아이디를 넣어 주세요)' };
  const list = readJson(LIST, { sessions: [] });
  list.sessions = (list.sessions || []).filter((x) => x.id !== s.id);
  const entry = { id: s.id, name: s.title || '', project: projectOf(s), configDir: s.configDir || '', permissionMode: 'bypassPermissions', remoteControl: remoteControl || '' };
  list.sessions.push(entry);
  writeAtomic(LIST, JSON.stringify(list, null, 2));
  return { ok: true, entry };
}
function remove(id) {
  const list = readJson(LIST, { sessions: [] });
  const before = (list.sessions || []).length;
  list.sessions = (list.sessions || []).filter((x) => x.id !== id);
  writeAtomic(LIST, JSON.stringify(list, null, 2));
  return { ok: true, removed: before - list.sessions.length };
}

// ---------- 한 번 돌기 ----------
function takeLock() {
  try {
    const pid = parseInt(fs.readFileSync(LOCK, 'utf8'), 10);
    if (pid && pid !== process.pid && isAlive(pid)) return false;
  } catch (_) {}
  fs.writeFileSync(LOCK, String(process.pid));
  return true;
}
function runOnce(checkOnly) {
  const list = (readJson(LIST, { sessions: [] }).sessions || []).filter((x) => x && x.id && x.project);
  const prev = readJson(STATUS, { sessions: {} });
  const status = { checkedAt: Date.now(), sessions: {} };
  for (const entry of list) {
    const old = (prev.sessions || {})[entry.id] || {};
    const cur = Object.assign({}, old, { name: entry.name, checkedAt: Date.now() });
    const pids = livePids(entry);
    cur.alive = pids.length > 0;
    cur.duplicate = pids.length > 1;   // 겹침은 끄지 않고 알리기만 한다
    if (cur.duplicate && !old.duplicate) logError(`${entry.name || entry.id} 세션이 프로세스 ${pids.length}개로 겹쳐 돌아요 (끄지 않았어요)`);
    if (!cur.alive && !checkOnly && Date.now() - (old.lastAttemptAt || 0) > RETRY_MS) {
      cur.lastAttemptAt = Date.now();
      let r;
      try { r = revive(entry); } catch (e) { r = { ok: false, error: String(e && e.message || e).slice(0, 160) }; }
      cur.lastResult = { at: Date.now(), ok: r.ok, how: r.how || '', steps: r.steps || [], error: r.error || '' };
      if (r.ok) { cur.alive = true; cur.revivedAt = Date.now(); }
      else if (r.how !== 'wait-orca') logError(`${entry.name || entry.id} 세션을 되살리지 못했어요: ${r.error} (${(r.steps || []).join(' → ')})`);
    }
    status.sessions[entry.id] = cur;
  }
  writeAtomic(STATUS, JSON.stringify(status));
  return status;
}

function main() {
  const args = process.argv.slice(2);
  const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
  if (args.includes('--add')) { console.log(JSON.stringify(add(opt('--add'), opt('--remote-control')))); return; }
  if (args.includes('--remove')) { console.log(JSON.stringify(remove(opt('--remove')))); return; }
  const checkOnly = args.includes('--check');
  if (!checkOnly && !takeLock()) return;
  try {
    const st = runOnce(checkOnly);
    if (checkOnly || process.stdout.isTTY) console.log(JSON.stringify(st));
  } finally {
    if (!checkOnly) { try { if (parseInt(fs.readFileSync(LOCK, 'utf8'), 10) === process.pid) fs.unlinkSync(LOCK); } catch (_) {} }
  }
}

if (require.main === module) main();
module.exports = { livePids, runOnce, add, remove, resumeCommand, orcaRunning };
