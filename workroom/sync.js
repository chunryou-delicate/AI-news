'use strict';
// 업무방 현황판 동기화: 여러 컴퓨터의 현황판 기록을 비공개 git 저장소로 주고받는다.
// - push: 이 컴퓨터의 상태·말·회의록 스냅숏을 저장소의 m/<컴퓨터키> 브랜치에 덮어쓴다 (커밋 1개만 유지).
// - pull: 다른 컴퓨터 브랜치들을 받아 remote/<컴퓨터키>/ 에 풀고, 현황판이 읽는 logs/*.js 를 만든다.
// - 보관: 회의록(minutes/)과 세션 보고서(reports/<방>/*.md)를 저장소 main 의 minutes/<컴퓨터>/, reports/<컴퓨터>/ 로 올린다.
// - 지시 보내기(send.js): 다른 컴퓨터 세션에 보낼 지시는 send/<받을 컴퓨터 키>/ 로 올리고, 받은 컴퓨터는 Orca 로 넣은 뒤
//   receipts/ 에 받음 표시를 올린다. 받지 않으려면 sync.json 에 "acceptSend": false.
// - 컴퓨터가 아닌 참여자(ChatGPT 등)도 m/<아무 이름> 브랜치에 send/ 를 올려 지시 글을 보낼 수 있다
//   (sync.js 가 workroom@localhost 로 커밋한 브랜치만 컴퓨터, 나머지는 참여자).
//   지시 글만 받고 앞에 "[보낸 곳 에서 온 지시]" 를 붙인다. 닫기·고용·이름 바꾸기는 거절. CHATGPT-INTEGRATION.md
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
const REPORTS_DIR = path.join(ROOT, 'reports');             // 세션이 쓰는 공유용 보고서 reports/<방>/<요청ID>.md → main 의 reports/<컴퓨터>/<방>/
const REPORT_MAX = 64 * 1024;                               // 보고서 한 장 크기 상한 (상세 내용은 프로젝트 git 에)
const sendMod = require('./send.js');
const COMPUTER_EMAIL = 'workroom@localhost';               // 컴퓨터 브랜치(m/<키>) 커밋 작성자. 이게 아니면 참여자 브랜치로 다룬다
const MIN = 60 * 1000;
const LOCK_MAX = 20 * MIN;      // 이보다 오래된 잠금은 주인이 살아 있어도 멈춘 것으로 보고 치운다
const GIT_TIMEOUT = 10 * MIN;   // git 명령 하나가 이보다 오래 걸리면 끊는다 (--interactive 는 제외)
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
    timeout: interactive ? 0 : GIT_TIMEOUT,   // 네트워크가 멈춘 git 이 잠금을 끝없이 쥐고 있지 않게
  });
}

// 동기화 잠금(sync.lock)에는 잡은 프로세스 번호를 적는다. 느린 컴퓨터에서는 한 번 도는 데 2~6분도 걸리는데,
// 예전처럼 3분 지난 잠금을 치우면 아직 도는 동기화와 새 동기화가 같은 git 폴더에서 겹쳐
// 'cannot lock ref', FETCH_HEAD·.lock 오류가 났다. 이제는 주인이 살아 있으면 기다리고,
// 주인이 죽었거나(재부팅 전 잠금 포함) LOCK_MAX 가 지났을 때만 치운다. server.js 의 syncRunning() 도 같은 규칙.
function lockOwnerAlive(file) {
  let st, pid;
  try { st = fs.statSync(file); } catch (_) { return false; }
  const age = Date.now() - st.mtimeMs;
  if (age > LOCK_MAX || age > os.uptime() * 1000) return false;
  try { pid = parseInt(fs.readFileSync(file, 'utf8'), 10); } catch (_) {}
  if (!pid) return age < 3 * MIN;   // 번호를 적지 않던 예전 sync.js 의 잠금
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
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

// ---------- 보고서 (세션 → 워크싱크) ----------
// 세션은 저장소를 만지지 않고 ~/.claude/workroom/reports/<방>/<요청ID>.md 에 짧은 공유용 요약만 쓴다.
// sync.js 가 회의록 보관 때 main 의 reports/<컴퓨터>/<방>/ 로 그대로 비춰 올린다 (지우면 저장소에서도 지움).
// 같은 요청 ID 는 같은 파일을 고쳐 쓴다. 머리말 형식은 README '보고서 올리기'.
// 64KB 가 넘거나 열쇠·토큰·임시 터널 링크처럼 보이는 글이 있으면 올리지 않고 sync-status.json 의 reportsSkipped 에 남긴다.
const SECRET_RE = /(ghp_[A-Za-z0-9]{20,}|github_pat_|gho_[A-Za-z0-9]{20,}|sk-[A-Za-z0-9_-]{20,}|AIza[0-9A-Za-z_-]{30,}|xox[bpa]-[A-Za-z0-9-]{10,}|EAA[A-Za-z0-9]{30,}|ya29\.[A-Za-z0-9_-]{20,}|AKIA[0-9A-Z]{16}|BEGIN [A-Z ]*PRIVATE KEY|trycloudflare\.com|[?&](key|token|access_token)=[A-Za-z0-9_-]{8,}|bot[0-9]{6,}:[A-Za-z0-9_-]{20,})/;

// 방을 통째로 안 올리려면: 그 방 폴더에 .no-sync 파일을 두거나, sync.json 에 "reportsExcludeRooms": ["방"] (기밀 과제 등).
// 모두 끄려면 sync.json 에 "reports": false. 고친 지 30초가 안 된 파일은 쓰는 중일 수 있어 다음 차례에 올린다.
function collectReports(cfg) {
  const ok = [], skipped = [];
  if (cfg.reports === false) return { ok, skipped };
  const exclude = new Set((cfg.reportsExcludeRooms || []).map((r) => safeName(r)));
  let rooms = [];
  try { rooms = fs.readdirSync(REPORTS_DIR).filter((d) => fs.statSync(path.join(REPORTS_DIR, d)).isDirectory()); } catch (_) { return { ok, skipped }; }
  for (const room of rooms) {
    if (exclude.has(safeName(room)) || fs.existsSync(path.join(REPORTS_DIR, room, '.no-sync'))) continue;
    let files = [];
    try { files = fs.readdirSync(path.join(REPORTS_DIR, room)).filter((f) => f.endsWith('.md')); } catch (_) { continue; }
    for (const f of files) {
      const abs = path.join(REPORTS_DIR, room, f);
      const rel = `${safeName(room)}/${safeName(f)}`;
      let st, text;
      try { st = fs.statSync(abs); text = fs.readFileSync(abs, 'utf8'); } catch (_) { continue; }
      if (Date.now() - st.mtimeMs < 30 * 1000) continue;
      if (st.size > REPORT_MAX) { skipped.push({ file: rel, reason: `${Math.round(st.size / 1024)}KB 로 64KB 넘음 (상세는 프로젝트 git 에)` }); continue; }
      if (SECRET_RE.test(text) || (cfg.repo && text.includes(cfg.repo))) { skipped.push({ file: rel, reason: '열쇠·토큰·링크처럼 보이는 글이 있음' }); continue; }
      const m = text.match(/^[ \t]*request[ \t]*:[ \t]*(\S+)/im);
      ok.push({ abs, rel, request: m ? m[1].replace(/^["']|["']$/g, '') : '', mtime: st.mtimeMs, size: st.size });
    }
  }
  return { ok, skipped };
}

// 보고서가 바뀌었는지 보는 표시 (바뀌면 10분을 기다리지 않고 다음 동기화 때 올린다)
function reportsSig(list) {
  return list.map((r) => `${r.rel}:${r.size}:${Math.round(r.mtime)}`).sort().join('|');
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
  // 이 컴퓨터 현황판에서 '확인'한 것 (다른 컴퓨터 현황판에서도 사라지게, acks.js)
  const acks = readJson(path.join(ROOT, 'acks.json'), null);
  if (acks) fs.writeFileSync(path.join(OUT_DIR, 'acks.json'), JSON.stringify(acks));
  // 다른 컴퓨터로 보낼 지시 (받음 표시가 올 때까지 매번 같이 올린다)와, 이 컴퓨터가 받아 넣은 지시의 받음 표시
  for (const m of sendMod.pendingOutbox()) {
    fs.mkdirSync(path.join(OUT_DIR, 'send', m.to), { recursive: true });
    fs.writeFileSync(path.join(OUT_DIR, 'send', m.to, `${m.id}.json`), JSON.stringify(m));
  }
  const done = readJson(INBOX_DONE, {});
  // 그 요청에 세션이 쓴 보고서가 있으면 받음 표시에 main 의 보고서 경로를 넣는다 (ChatGPT 가 바로 찾게)
  const reportOf = {};
  for (const r of collectReports(cfg).ok) if (r.request) reportOf[r.request] = `reports/${safeName(cfg.machine || os.hostname())}/${r.rel}`;
  for (const id of Object.keys(done)) {
    fs.mkdirSync(path.join(OUT_DIR, 'receipts'), { recursive: true });
    const rc = Object.assign({ id }, done[id], reportOf[id] ? { report: reportOf[id] } : {});
    fs.writeFileSync(path.join(OUT_DIR, 'receipts', `${id}.json`), JSON.stringify(rc));
  }
  fs.writeFileSync(path.join(OUT_DIR, 'meta.json'), JSON.stringify({ machine: cfg.machine, key, host: os.hostname(), generatedAt: Date.now() }));

  git(OUT_DIR, ['add', '-A']);
  let hasHead = true;
  try { git(OUT_DIR, ['rev-parse', '--verify', '-q', 'HEAD']); } catch (_) { hasHead = false; }
  const commit = ['-c', 'user.name=workroom', '-c', `user.email=${COMPUTER_EMAIL}`, 'commit', '-q', '--allow-empty', '-m', `snapshot ${cfg.machine} ${new Date().toISOString()}`];
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
  const pulled = [], computers = [];
  fs.mkdirSync(REMOTE_DIR, { recursive: true });
  fs.mkdirSync(LOGS_DIR, { recursive: true });

  for (const key of keys) {
    if (key === own) continue;
    const ref = `refs/remotes/origin/m/${key}`;
    let meta = null;
    let state = null;
    try { meta = JSON.parse(git(IN_DIR, ['show', `${ref}:meta.json`])); } catch (_) {}
    try { state = JSON.parse(git(IN_DIR, ['show', `${ref}:state.json`])); } catch (_) {}
    let author = '';
    try { author = git(IN_DIR, ['log', '-1', '--format=%ae', ref]).trim(); } catch (_) {}
    if (!meta || !meta.machine || !state || author !== COMPUTER_EMAIL) {
      // 컴퓨터가 아닌 참여자(ChatGPT 등)의 브랜치: 컴퓨터 브랜치는 늘 pushSnapshot 이 COMPUTER_EMAIL 로 커밋하고 meta.json·state.json 을 같이 올린다.
      // (ChatGPT 는 GitHub 연결로 사용자 계정 커밋을 올리고, meta.json·state.json 을 흉내 내기도 한다)
      // 현황판에 컴퓨터로 띄우지 않고, 이 컴퓨터로 온 지시 글만 받는다 (닫기·고용·이름 바꾸기는 거절). CHATGPT-INTEGRATION.md
      receiveSends(cfg, own, ref, { machine: externalName(meta, key), external: true });
      continue;
    }
    computers.push(key);
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
    let acks = {};
    try { acks = JSON.parse(git(IN_DIR, ['show', `${ref}:acks.json`])); } catch (_) {}
    writeAtomic(path.join(dir, 'acks.json'), JSON.stringify(acks));
    writeAtomic(path.join(dir, 'meta.json'), JSON.stringify(meta));
    writeAtomic(path.join(dir, 'state.json'), JSON.stringify(state));
    writeAtomic(path.join(dir, 'derived.json'), JSON.stringify(derived));
    pulled.push({ machine: meta.machine, key, generatedAt: meta.generatedAt });
  }

  // 저장소에서 사라진 컴퓨터와, 컴퓨터가 아닌 참여자 브랜치(예전에 컴퓨터로 받아 둔 것 포함)는 지운다.
  for (const d of fs.readdirSync(REMOTE_DIR)) {
    if (computers.includes(d)) continue;
    for (const k of readJson(path.join(REMOTE_DIR, d, 'derived.json'), [])) {
      for (const ext of ['.js', '.speech.json']) try { fs.unlinkSync(path.join(LOGS_DIR, k + ext)); } catch (_) {}
    }
    fs.rmSync(path.join(REMOTE_DIR, d), { recursive: true, force: true });
  }
  return pulled;
}

// 같은 세션에 밀린 지시를 이어 붙인다: 앞의 것 + ' (추가 지시) ' + 뒤의 것. 똑같은 말은 한 번만, 한 번에 넣을 수 있는 길이(1000자)를 넘으면 나눈다.
function mergeSends(items) {
  const parts = [];
  let cur = null;
  const seen = new Set();
  for (const m of items) {
    const t = sendMod.cleanText(m.text);
    if (seen.has(t)) { if (cur) cur.items.push(m); else parts.push(cur = { text: t, items: [m] }); continue; }
    seen.add(t);
    if (cur && (cur.text + ' (추가 지시) ' + t).length <= 1000) { cur.text += ' (추가 지시) ' + t; cur.items.push(m); }
    else parts.push(cur = { text: t, items: [m] });
  }
  return parts;
}

// 컴퓨터가 아닌 참여자 이름: meta.json 의 machine (예: "ChatGPT"), 없으면 브랜치 이름
function externalName(meta, key) {
  return sendMod.cleanText((meta && meta.machine) || `m/${key}`).slice(0, 30) || `m/${key}`;
}

// 다른 컴퓨터 브랜치에서: 이 컴퓨터로 온 지시를 넣고(두 시간 안에 보낸 것만, 한 번씩), 이 컴퓨터가 보낸 지시의 받음 표시를 확인한다.
// meta.external 이면 컴퓨터가 아닌 참여자(ChatGPT 등): 지시 글만 받고, 받은 세션이 사용자가 친 말로 알지 않게 앞에 보낸 곳을 붙인다.
function receiveSends(cfg, own, ref, meta) {
  const list = (prefix) => {
    try { return git(IN_DIR, ['ls-tree', '-r', '--name-only', ref, prefix]).split('\n').map((x) => x.trim()).filter((x) => x.endsWith('.json')); } catch (_) { return []; }
  };
  const done = readJson(INBOX_DONE, {});
  let changed = false, closedAny = false;
  if (own) {
    // 아직 넣지 않은 것을 보낸 순서대로 모으고, 같은 세션에 온 지시는 하나로 합쳐 한 번에 넣는다
    // (동기화 사이에 여러 번 보냈으면 앞서 것에 더해서 들어가게. 똑같은 말은 한 번만). 고용·닫기는 하나씩.
    const fresh = [];
    for (const f of list(`send/${own}/`)) {
      let m;
      try { m = JSON.parse(git(IN_DIR, ['show', `${ref}:${f}`])); } catch (_) { continue; }
      if (!m || !m.id || done[m.id]) continue;
      if (meta.external && sendMod.cleanText(m.text)) m = Object.assign({}, m, { text: `[${meta.machine} 에서 온 지시] ${m.text}` });
      fresh.push(m);
    }
    fresh.sort((a, b) => (a.at || 0) - (b.at || 0));
    const groups = [];
    for (const m of fresh) {
      const isSend = !m.kind || m.kind === 'send';
      const g = isSend ? groups.find((x) => x.send && x.sid === m.sid) : null;
      if (g) g.items.push(m); else groups.push({ sid: m.sid, send: isSend, items: [m] });
    }
    for (const g of groups) {
      const res = {}, ok = [];
      for (const m of g.items) {
        if (cfg.acceptSend === false) res[m.id] = { ok: false, error: '이 컴퓨터는 다른 컴퓨터 지시를 받지 않게 해 두었어요' };
        else if (meta.external && m.kind && m.kind !== 'send') res[m.id] = { ok: false, error: '컴퓨터가 아닌 참여자는 지시 글만 보낼 수 있어요 (닫기·고용·이름 바꾸기는 받지 않아요)' };
        else if (Date.now() - (m.at || 0) > 2 * 3600 * 1000) res[m.id] = { ok: false, error: '너무 늦게 받아서 넣지 않았어요' };
        else ok.push(m);
      }
      if (g.send && ok.length > 1) {
        for (const part of mergeSends(ok)) {
          const r = sendMod.deliverInbound(Object.assign({}, part.items[0], { text: part.text }));
          for (const m of part.items) res[m.id] = Object.assign({}, r, { merged: part.items.length });
        }
      } else {
        for (const m of ok) res[m.id] = sendMod.deliverInbound(m);
      }
      for (const m of g.items) {
        const r = res[m.id];
        if (r.ok && m.kind === 'close') closedAny = true;
        done[m.id] = Object.assign({ ok: !!r.ok, error: r.error || '', at: Date.now(), from: meta.machine, sid: m.sid, merged: r.merged || 0 }, meta.external ? { external: true } : {});
        changed = true;
      }
    }
  }
  // 받음 표시는 컴퓨터 브랜치에서만 믿는다 (참여자 브랜치는 이 컴퓨터가 보낸 지시를 받지 않는다)
  if (!meta.external) for (const f of list('receipts/')) {
    let rc;
    try { rc = JSON.parse(git(IN_DIR, ['show', `${ref}:${f}`])); } catch (_) { continue; }
    if (rc && rc.id) sendMod.applyReceipt(rc, meta.machine);
  }
  for (const id of Object.keys(done)) if (Date.now() - (done[id].at || 0) > 24 * 3600 * 1000) { delete done[id]; changed = true; }
  if (changed) writeAtomic(INBOX_DONE, JSON.stringify(done));
  // 다른 컴퓨터가 보낸 해고·정리로 탭을 닫았으면 상태를 다시 만든다 (강제로 닫으면 퇴장 훅이 안 불린다)
  if (closedAny) {
    try { require('child_process').spawn(process.execPath, [path.join(ROOT, 'hook.js'), '--rebuild'], { detached: true, stdio: 'ignore', windowsHide: true }).unref(); } catch (_) {}
  }
}

// ---------- 회의록 보관 ----------
// 이 컴퓨터의 회의록(minutes/<방>/<날짜>.md)을 저장소 main 브랜치의 minutes/<컴퓨터>/<방>/<날짜>.md 로 커밋한다.
// 다른 컴퓨터나 tunnel.js 도 main 에 올리므로, 밀려나면 새로 받아서 다시 올린다.
function safeName(name) {
  return String(name).replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').trim() || 'room';
}

// 올린 결과: reports-done.json 에 보고서마다 main 경로·올린 커밋·그때 파일 고친 시각을 적는다.
// 세션은 자기 파일의 mtime 이 여기 적힌 것과 같으면 '공유 완료', 아니면 아직 안 올라간 것으로 본다 (규칙 5번: Git 기록과 공유 완료 구분).
const REPORTS_DONE = path.join(ROOT, 'reports-done.json');
function writeReportsDone(machineName, reports) {
  let commit = '';
  try { commit = git(ARCH_DIR, ['rev-parse', 'HEAD']).trim(); } catch (_) {}
  const files = {};
  for (const r of reports) files[r.rel] = { path: `reports/${machineName}/${r.rel}`, request: r.request, mtime: Math.round(r.mtime), commit };
  writeAtomic(REPORTS_DONE, JSON.stringify({ updatedAt: Date.now(), branch: 'main', commit, files }, null, 1));
}

function archiveMinutes(cfg, interactive, reports) {
  let rooms = [];
  try { rooms = fs.readdirSync(MINUTES_DIR).filter((d) => fs.statSync(path.join(MINUTES_DIR, d)).isDirectory()); } catch (_) {}
  reports = reports || collectReports(cfg).ok;
  if (!rooms.length && !reports.length && !fs.existsSync(REPORTS_DIR)) return 'none';
  ensureRepo(ARCH_DIR, cfg.repo);
  const machineName = safeName(cfg.machine || os.hostname());
  const machineDir = path.join('minutes', machineName);
  const reportDir = path.join(ARCH_DIR, 'reports', machineName);
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
    if (fs.existsSync(path.join(ARCH_DIR, 'minutes'))) git(ARCH_DIR, ['add', '-A', 'minutes']);
    // 보고서: 이 컴퓨터 몫(reports/<컴퓨터>/)만 지금 reports/ 폴더 모습으로 통째로 비춘다
    fs.rmSync(reportDir, { recursive: true, force: true });
    for (const r of reports) {
      fs.mkdirSync(path.dirname(path.join(reportDir, r.rel)), { recursive: true });
      fs.copyFileSync(r.abs, path.join(reportDir, r.rel));
    }
    try { git(ARCH_DIR, ['add', '-A', '--', 'reports']); } catch (_) {}   // 아직 아무 보고서도 없으면 경로가 없어 실패한다
    let changed = true;
    try { git(ARCH_DIR, ['diff', '--cached', '--quiet']); changed = false; } catch (_) {}
    if (!changed) { writeReportsDone(machineName, reports); return 'unchanged'; }
    git(ARCH_DIR, ['-c', 'user.name=workroom', '-c', 'user.email=workroom@localhost', 'commit', '-q', '-m',
      `회의록·보고서 ${cfg.machine || os.hostname()} ${new Date().toLocaleString('ko-KR')}`]);
    try {
      git(ARCH_DIR, ['push', '-q', 'origin', 'main'], interactive);
      writeReportsDone(machineName, reports);
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
    // 아직 도는 동기화가 있으면 그대로 둔다. 주인 없는 잠금만 치우고, 이번 차례는 건너뛴다 (다음 차례에 돈다).
    if (!lockOwnerAlive(LOCK)) { try { fs.unlinkSync(LOCK); } catch (__) {} }
    return;
  }
  try { fs.writeSync(fd, String(process.pid)); } catch (_) {}
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
  // 세션 보고서(reports/)가 바뀌었으면 10분을 기다리지 않고 이번에 같이 올린다.
  const rep = collectReports(cfg);
  const sig = reportsSig(rep.ok);
  status.reportsSig = prev.reportsSig || '';
  if (rep.skipped.length) status.reportsSkipped = rep.skipped;
  const due = cfg.archive !== false && (fs.existsSync(ARCHIVE_REQ) || args.includes('--archive') || sig !== status.reportsSig
    || Date.now() - (prev.lastArchive || 0) > (Number(cfg.archiveMinutes) || 10) * MIN);
  try {
    if (due) {
      try { fs.unlinkSync(ARCHIVE_REQ); } catch (_) {}
      status.archive = archiveMinutes(cfg, interactive, rep.ok);
      status.lastArchive = Date.now();
      status.reportsSig = sig;
      status.reports = rep.ok.length;
      delete status.archiveError;
      const prevSkip = JSON.stringify(prev.reportsSkipped || []);
      if (rep.skipped.length && JSON.stringify(rep.skipped) !== prevSkip) logError(`보고서 ${rep.skipped.length}개 안 올림: ${rep.skipped.map((s) => `${s.file} (${s.reason})`).join(', ')}`);
    }
  } catch (e) {
    status.archive = 'failed';
    status.archiveError = String(e && (e.stderr || e.message) || e).trim().slice(0, 300);
    logError(e);
  } finally {
    try { fs.closeSync(fd); } catch (_) {}
    // 너무 오래 걸려 다른 동기화가 잠금을 넘겨받았으면 그쪽 잠금은 지우지 않는다
    try { const owner = fs.readFileSync(LOCK, 'utf8').trim(); if (!owner || owner === String(process.pid)) fs.unlinkSync(LOCK); } catch (_) {}
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
