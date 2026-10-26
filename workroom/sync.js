'use strict';
// 업무방 현황판 동기화: 여러 컴퓨터의 현황판 기록을 비공개 git 저장소로 주고받는다.
// - push: 이 컴퓨터의 상태·말·회의록 스냅숏을 저장소의 m/<컴퓨터키> 브랜치에 덮어쓴다 (커밋 1개만 유지).
// - pull: 다른 컴퓨터 브랜치들을 받아 remote/<컴퓨터키>/ 에 풀고, 현황판이 읽는 logs/*.js 를 만든다.
// - 지시 보내기(send.js): 다른 컴퓨터 세션에 보낼 지시는 send/<받을 컴퓨터 키>/ 로 올리고, 받은 컴퓨터는 Orca 로 넣은 뒤
//   receipts/ 에 받음 표시를 올린다. 받지 않으려면 sync.json 에 "acceptSend": false.
// 설정: sync.json  { "repo": "...git", "machine": "회사 노트북", "push": true, "pull": false, "intervalSec": 60 }
// 사용법: node sync.js             지금 한 번 동기화
//         node sync.js --defer     (훅이 부름) 마지막 동기화 후 intervalSec 이 지나면 한 번 동기화
//         node sync.js --interactive  처음 로그인처럼 git 이 창을 띄워 물어봐야 할 때

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const ROOT = __dirname;
const SYNC_FILE = path.join(ROOT, 'sync.json');
const STATUS_FILE = path.join(ROOT, 'sync-status.json');
const PENDING = path.join(ROOT, 'sync.pending');
const LOCK = path.join(ROOT, 'sync.lock');
const OUT_DIR = path.join(ROOT, 'sync-out');
const IN_DIR = path.join(ROOT, 'sync-in');
const REMOTE_DIR = path.join(ROOT, 'remote');
const LOGS_DIR = path.join(ROOT, 'logs');
const MINUTES_DIR = path.join(ROOT, 'minutes');
const ARCH_DIR = path.join(ROOT, 'archive-repo');           // 회의록 보관용 (저장소 main 브랜치)
const ARCHIVE_REQ = path.join(ROOT, 'archive.request');     // 회의가 끝나면 hook.js 가 만들어 바로 올리게 한다
const ERROR_LOG = path.join(ROOT, 'error.log');
const INBOX_DONE = path.join(ROOT, 'inbox-done.json');      // 다른 컴퓨터에서 받아 넣은 지시 (받음 표시용, 하루 보관)
const sendMod = require('./send.js');
const MIN = 60 * 1000;
const args = process.argv.slice(2);

function logError(err) {
  try { fs.appendFileSync(ERROR_LOG, `[${new Date().toISOString()}] sync: ${err && err.stack || err}\n`); } catch (_) {}
}

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { return fallback; }
}

function writeAtomic(file, content) {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, content, 'utf8');
  try { fs.renameSync(tmp, file); } catch (_) { fs.writeFileSync(file, content, 'utf8'); try { fs.unlinkSync(tmp); } catch (__) {} }
}

// hook.js 의 roomKey 와 같아야 한다.
function roomKey(name) {
  let h = 2166136261;
  for (const ch of String(name)) { h ^= ch.codePointAt(0); h = Math.imul(h, 16777619); }
  return 'r' + (h >>> 0).toString(16);
}

function machineKey(name) {
  return roomKey('machine:' + name).slice(1);
}

function git(cwd, gitArgs, interactive) {
  const env = Object.assign({}, process.env);
  if (!interactive) env.GIT_TERMINAL_PROMPT = '0';
  return execFileSync('git', ['-C', cwd].concat(gitArgs), {
    encoding: 'utf8', windowsHide: true, env, maxBuffer: 64 * 1024 * 1024,
    stdio: ['ignore', 'pipe', interactive ? 'inherit' : 'pipe'],
  });
}

function ensureRepo(dir, repo) {
  if (!fs.existsSync(path.join(dir, '.git'))) {
    fs.mkdirSync(dir, { recursive: true });
    git(dir, ['init', '-q']);
    git(dir, ['remote', 'add', 'origin', repo]);
  } else {
    git(dir, ['remote', 'set-url', 'origin', repo]);
  }
}

// "window.__X__ = {...};" 또는 "(...)["key"] = {...};" 꼴의 js 파일에서 JSON 부분만 읽는다.
function readJsPayload(file) {
  try {
    const text = fs.readFileSync(file, 'utf8');
    const m = text.match(/=\s*(\{[\s\S]*\})\s*;\s*$/);
    return m ? JSON.parse(m[1]) : null;
  } catch (_) {
    return null;
  }
}

// ---------- push ----------

function pushSnapshot(cfg, interactive) {
  const key = machineKey(cfg.machine);
  ensureRepo(OUT_DIR, cfg.repo);
  for (const f of fs.readdirSync(OUT_DIR)) if (f !== '.git') fs.rmSync(path.join(OUT_DIR, f), { recursive: true, force: true });

  const state = readJsPayload(path.join(ROOT, 'state.js')) || { sessions: [], rooms: [], meetings: [] };
  // 다른 컴퓨터에서 받아 온 것(machine 이 붙은 것)은 다시 올리지 않는다.
  state.sessions = (state.sessions || []).filter((s) => !s.machine);
  state.rooms = (state.rooms || []).filter((r) => !r.machine);
  state.meetings = (state.meetings || []).filter((m) => !m.machine);
  delete state.machines;

  fs.mkdirSync(path.join(OUT_DIR, 'logs'), { recursive: true });
  let logs = [];
  try { logs = fs.readdirSync(LOGS_DIR).filter((f) => /^r[0-9a-f]+\.js$/.test(f)); } catch (_) {}
  for (const f of logs) {
    const payload = readJsPayload(path.join(LOGS_DIR, f));
    if (!payload || payload.remote) continue;
    // 하루 넘게 새 기록이 없는 방 로그는 올리지 않는다 (받는 쪽 pullOthers 와 같은 기준. 저장소에 옛 방이 계속 남지 않게).
    if (Date.now() - (payload.generatedAt || 0) > 24 * 3600 * 1000) continue;
    const speech = readJson(path.join(LOGS_DIR, f.replace(/\.js$/, '.speech.json')), {});
    fs.writeFileSync(path.join(OUT_DIR, 'logs', f.replace(/\.js$/, '.json')), JSON.stringify({ log: payload, speech }));
  }
  fs.writeFileSync(path.join(OUT_DIR, 'state.json'), JSON.stringify(state));
  // 다른 컴퓨터로 보낼 지시 (받음 표시가 올 때까지 매번 같이 올린다)와, 이 컴퓨터가 받아 넣은 지시의 받음 표시
  for (const m of sendMod.pendingOutbox()) {
    fs.mkdirSync(path.join(OUT_DIR, 'send', m.to), { recursive: true });
    fs.writeFileSync(path.join(OUT_DIR, 'send', m.to, `${m.id}.json`), JSON.stringify(m));
  }
  const done = readJson(INBOX_DONE, {});
  for (const id of Object.keys(done)) {
    fs.mkdirSync(path.join(OUT_DIR, 'receipts'), { recursive: true });
    fs.writeFileSync(path.join(OUT_DIR, 'receipts', `${id}.json`), JSON.stringify(Object.assign({ id }, done[id])));
  }
  fs.writeFileSync(path.join(OUT_DIR, 'meta.json'), JSON.stringify({ machine: cfg.machine, key, host: os.hostname(), generatedAt: Date.now() }));

  git(OUT_DIR, ['add', '-A']);
  let hasHead = true;
  try { git(OUT_DIR, ['rev-parse', '--verify', '-q', 'HEAD']); } catch (_) { hasHead = false; }
  const commit = ['-c', 'user.name=workroom', '-c', 'user.email=workroom@localhost', 'commit', '-q', '--allow-empty', '-m', `snapshot ${cfg.machine} ${new Date().toISOString()}`];
  if (hasHead) commit.push('--amend');
  git(OUT_DIR, commit);
  git(OUT_DIR, ['push', '-q', '-f', 'origin', `HEAD:refs/heads/m/${key}`], interactive);
  return key;
}

// ---------- pull ----------

function pullOthers(cfg, interactive) {
  const own = cfg.machine ? machineKey(cfg.machine) : '';
  ensureRepo(IN_DIR, cfg.repo);
  // 저장소에 있는 컴퓨터 브랜치(m/*)를 먼저 확인하고, 있는 것만 받는다 (하나도 없으면 fetch 가 실패하므로).
  const keys = git(IN_DIR, ['ls-remote', 'origin', 'refs/heads/m/*'], interactive).split('\n')
    .map((l) => (l.split('\t')[1] || '').trim().replace(/^refs\/heads\/m\//, '')).filter(Boolean);
  const wanted = keys.filter((k) => k !== own);
  if (wanted.length) {
    git(IN_DIR, ['fetch', '-q', '--depth', '1', 'origin'].concat(wanted.map((k) => `+refs/heads/m/${k}:refs/remotes/origin/m/${k}`)), interactive);
  }
  const pulled = [];
  fs.mkdirSync(REMOTE_DIR, { recursive: true });
  fs.mkdirSync(LOGS_DIR, { recursive: true });

  for (const key of keys) {
    if (key === own) continue;
    const ref = `refs/remotes/origin/m/${key}`;
    let meta;
    let state;
    try {
      meta = JSON.parse(git(IN_DIR, ['show', `${ref}:meta.json`]));
      state = JSON.parse(git(IN_DIR, ['show', `${ref}:state.json`]));
    } catch (e) {
      logError(e);
      continue;
    }
    const dir = path.join(REMOTE_DIR, key);
    fs.mkdirSync(dir, { recursive: true });
    const prevDerived = readJson(path.join(dir, 'derived.json'), []);
    const derived = [];
    let files = [];
    try { files = git(IN_DIR, ['ls-tree', '--name-only', ref, 'logs/']).split('\n').map((s) => s.trim()).filter(Boolean); } catch (_) {}
    for (const f of files) {
      let item;
      try { item = JSON.parse(git(IN_DIR, ['show', `${ref}:${f}`])); } catch (_) { continue; }
      if (!item || !item.log) continue;
      // 하루 넘게 새 기록이 없는 방 로그는 받지 않는다 (지난 회의록은 회의록 트리가 보관 사본으로 보여 준다).
      // 받지 않으면 아래에서 예전에 만든 이 방 파일도 지운다.
      if (Date.now() - (item.log.generatedAt || 0) > 24 * 3600 * 1000) continue;
      // 이 컴퓨터 현황판에서는 "<컴퓨터 이름> · <방 이름>" 방으로 보여 준다.
      const room = `${meta.machine} · ${item.log.room}`;
      const newKey = roomKey(room);
      const payload = Object.assign({}, item.log, { room, key: newKey, remote: true, machine: meta.machine, mdPath: '' });
      writeAtomic(path.join(LOGS_DIR, `${newKey}.js`),
        `(window.__WORKROOM_LOG__ = window.__WORKROOM_LOG__ || {})[${JSON.stringify(newKey)}] = ${JSON.stringify(payload)};\n`);
      writeAtomic(path.join(LOGS_DIR, `${newKey}.speech.json`), JSON.stringify(item.speech || {}));
      derived.push(newKey);
    }
    for (const k of prevDerived) {
      if (!derived.includes(k)) for (const ext of ['.js', '.speech.json']) try { fs.unlinkSync(path.join(LOGS_DIR, k + ext)); } catch (_) {}
    }
    receiveSends(cfg, own, ref, meta);
    writeAtomic(path.join(dir, 'meta.json'), JSON.stringify(meta));
    writeAtomic(path.join(dir, 'state.json'), JSON.stringify(state));
    writeAtomic(path.join(dir, 'derived.json'), JSON.stringify(derived));
    pulled.push({ machine: meta.machine, key, generatedAt: meta.generatedAt });
  }

  // 저장소에서 사라진 컴퓨터는 지운다.
  for (const d of fs.readdirSync(REMOTE_DIR)) {
    if (keys.includes(d) && d !== own) continue;
    for (const k of readJson(path.join(REMOTE_DIR, d, 'derived.json'), [])) {
      for (const ext of ['.js', '.speech.json']) try { fs.unlinkSync(path.join(LOGS_DIR, k + ext)); } catch (_) {}
    }
    fs.rmSync(path.join(REMOTE_DIR, d), { recursive: true, force: true });
  }
  return pulled;
}

// 다른 컴퓨터 브랜치에서: 이 컴퓨터로 온 지시를 넣고(두 시간 안에 보낸 것만, 한 번씩), 이 컴퓨터가 보낸 지시의 받음 표시를 확인한다.
function receiveSends(cfg, own, ref, meta) {
  const list = (prefix) => {
    try { return git(IN_DIR, ['ls-tree', '-r', '--name-only', ref, prefix]).split('\n').map((x) => x.trim()).filter((x) => x.endsWith('.json')); } catch (_) { return []; }
  };
  const done = readJson(INBOX_DONE, {});
  let changed = false;
  if (own) {
    for (const f of list(`send/${own}/`)) {
      let m;
      try { m = JSON.parse(git(IN_DIR, ['show', `${ref}:${f}`])); } catch (_) { continue; }
      if (!m || !m.id || done[m.id]) continue;
      let r;
      if (cfg.acceptSend === false) r = { ok: false, error: '이 컴퓨터는 다른 컴퓨터 지시를 받지 않게 해 두었어요' };
      else if (Date.now() - (m.at || 0) > 2 * 3600 * 1000) r = { ok: false, error: '너무 늦게 받아서 넣지 않았어요' };
      else r = sendMod.deliverInbound(m);
      done[m.id] = { ok: !!r.ok, error: r.error || '', at: Date.now(), from: meta.machine, sid: m.sid };
      changed = true;
    }
  }
  for (const f of list('receipts/')) {
    let rc;
    try { rc = JSON.parse(git(IN_DIR, ['show', `${ref}:${f}`])); } catch (_) { continue; }
    if (rc && rc.id) sendMod.applyReceipt(rc, meta.machine);
  }
  for (const id of Object.keys(done)) if (Date.now() - (done[id].at || 0) > 24 * 3600 * 1000) { delete done[id]; changed = true; }
  if (changed) writeAtomic(INBOX_DONE, JSON.stringify(done));
}

// ---------- 회의록 보관 ----------
// 이 컴퓨터의 회의록(minutes/<방>/<날짜>.md)을 저장소 main 브랜치의 minutes/<컴퓨터>/<방>/<날짜>.md 로 커밋한다.
// 다른 컴퓨터나 tunnel.js 도 main 에 올리므로, 밀려나면 새로 받아서 다시 올린다.
function safeName(name) {
  return String(name).replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').trim() || 'room';
}

function archiveMinutes(cfg, interactive) {
  let rooms = [];
  try { rooms = fs.readdirSync(MINUTES_DIR).filter((d) => fs.statSync(path.join(MINUTES_DIR, d)).isDirectory()); } catch (_) { return 'none'; }
  ensureRepo(ARCH_DIR, cfg.repo);
  const machineDir = path.join('minutes', safeName(cfg.machine || os.hostname()));
  for (let attempt = 0; attempt < 3; attempt++) {
    git(ARCH_DIR, ['fetch', '-q', '--depth', '1', 'origin', 'main'], interactive);
    git(ARCH_DIR, ['checkout', '-q', '-f', '-B', 'main', 'FETCH_HEAD']);
    for (const room of rooms) {
      const src = path.join(MINUTES_DIR, room);
      const dst = path.join(ARCH_DIR, machineDir, room);
      for (const f of fs.readdirSync(src).filter((x) => x.endsWith('.md'))) {
        fs.mkdirSync(dst, { recursive: true });
        fs.copyFileSync(path.join(src, f), path.join(dst, f));
      }
    }
    git(ARCH_DIR, ['add', '-A', 'minutes']);
    let changed = true;
    try { git(ARCH_DIR, ['diff', '--cached', '--quiet']); changed = false; } catch (_) {}
    if (!changed) return 'unchanged';
    git(ARCH_DIR, ['-c', 'user.name=workroom', '-c', 'user.email=workroom@localhost', 'commit', '-q', '-m',
      `회의록 ${cfg.machine || os.hostname()} ${new Date().toLocaleString('ko-KR')}`]);
    try {
      git(ARCH_DIR, ['push', '-q', 'origin', 'main'], interactive);
      return 'pushed';
    } catch (e) {
      if (attempt === 2) throw e;   // 그사이 다른 쪽이 main 에 올렸으면 새로 받아서 다시
    }
  }
  return 'failed';
}

// ---------- 실행 ----------

function runOnce() {
  const cfg = readJson(SYNC_FILE, null);
  if (!cfg || !cfg.repo) return;
  let fd;
  try { fd = fs.openSync(LOCK, 'wx'); } catch (_) {
    try { if (Date.now() - fs.statSync(LOCK).mtimeMs > 3 * MIN) fs.unlinkSync(LOCK); } catch (__) {}
    return;
  }
  const interactive = args.includes('--interactive');
  const prev = readJson(STATUS_FILE, {});
  const status = { lastRun: Date.now(), ok: true, error: '', machine: cfg.machine || '', lastArchive: prev.lastArchive || 0, archive: prev.archive || '' };
  try {
    if (cfg.push) status.pushed = pushSnapshot(cfg, interactive);
    if (cfg.pull) status.pulled = pullOthers(cfg, interactive);
  } catch (e) {
    status.ok = false;
    status.error = String(e && (e.stderr || e.message) || e).trim().slice(0, 400);
    logError(e);
  }
  // 회의록 보관: 회의가 끝났거나(archive.request) 마지막 보관 후 archiveMinutes(기본 10)분이 지났으면 올린다.
  const due = cfg.archive !== false && (fs.existsSync(ARCHIVE_REQ) || args.includes('--archive')
    || Date.now() - (prev.lastArchive || 0) > (Number(cfg.archiveMinutes) || 10) * MIN);
  try {
    if (due) {
      try { fs.unlinkSync(ARCHIVE_REQ); } catch (_) {}
      status.archive = archiveMinutes(cfg, interactive);
      status.lastArchive = Date.now();
      delete status.archiveError;
    }
  } catch (e) {
    status.archive = 'failed';
    status.archiveError = String(e && (e.stderr || e.message) || e).trim().slice(0, 300);
    logError(e);
  } finally {
    try { fs.closeSync(fd); } catch (_) {}
    try { fs.unlinkSync(LOCK); } catch (_) {}
  }
  writeAtomic(STATUS_FILE, JSON.stringify(status));
  // 받아 온 것과 동기화 결과를 현황판(state.js, speech.js)에 반영한다.
  if (cfg.pull) {
    try { execFileSync(process.execPath, [path.join(ROOT, 'hook.js'), '--rebuild'], { windowsHide: true, stdio: 'ignore' }); } catch (e) { logError(e); }
  }
  if (process.stdout.isTTY || args.includes('--verbose')) console.log(JSON.stringify(status));
}

function main() {
  if (args.includes('--defer')) {
    try { if (Date.now() - fs.statSync(PENDING).mtimeMs < 5 * MIN) return; } catch (_) {}
    fs.writeFileSync(PENDING, String(process.pid));
    const cfg = readJson(SYNC_FILE, {});
    const last = readJson(STATUS_FILE, {}).lastRun || 0;
    const wait = Math.max(2000, last + (Number(cfg.intervalSec) || 60) * 1000 - Date.now());
    setTimeout(() => {
      try { fs.unlinkSync(PENDING); } catch (_) {}
      runOnce();
    }, wait);
    return;
  }
  runOnce();
}

try { main(); } catch (e) { logError(e); }
