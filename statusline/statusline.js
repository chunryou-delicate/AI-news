#!/usr/bin/env node
// Claude Code 상태줄 — 2줄
//   1줄: 로그인 ID · 모델 · effort · 프로젝트 폴더 · git 현황 · Remote Control
//   2줄: 컨텍스트 막대·% · ￪In/￬Out 토큰 · 비용 · 세션 시간 · 프롬프트 캐시 · 5h/7d 사용률
// 입력: Claude Code 가 stdin 으로 주는 JSON (https://code.claude.com/docs/en/statusline)
// 디버그: ~/.claude/statusline.debug 파일이 있으면 마지막 입력을 %TEMP%/claude-statusline-input.json 에 남긴다.
//
// 글꼴 주의 (Orca 터미널 글꼴 Noto Sans Mono CJK KR):
//   ↑ ↓ █ ░ … → 같은 기호는 이 글꼴에서 전각이라 1칸에 눌려 깨진다.
//   화살표는 반각 ￪ ￬ (U+FFEA/FFEC), 막대는 배경색 칸, 말줄임은 ~ 를 쓴다.
// 이모지 앞쪽 숫자는 폭을 고정한다 — 갱신 때 이모지 위치가 밀리면 부분 다시 그리기에 구분선이 지워진다.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const CONFIG_DIR = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
const ACCOUNT_FILE = process.env.CLAUDE_CONFIG_DIR
  ? path.join(CONFIG_DIR, '.claude.json')
  : path.join(os.homedir(), '.claude.json');

// ── 색 (256색, 밝은·어두운 배경 모두에서 읽히는 중간 명도) ─────────────────
const paint = (n, bold) => (s) => `\x1b[${bold ? '1;' : ''}38;5;${n}m${s}\x1b[0m`;
const fill = (n) => (s) => `\x1b[48;5;${n}m${s}\x1b[0m`;
const C = {
  sep: paint(246),
  dim: paint(244),
  id: paint(31, true),       // 강청
  model: paint(166, true),   // 주황
  folder: paint(30, true),   // 청록
  branch: paint(127, true),  // 자주
  ahead: paint(33),          // 파랑
  behind: paint(162),        // 분홍
  staged: paint(28),         // 초록
  modified: paint(172),      // 귤색
  untracked: paint(244),
  conflict: paint(160, true),
  clean: paint(28),
  rcOn: paint(28, true),
  rcOff: paint(244),
  tokIn: paint(61, true),    // 남보라
  tokOut: paint(133, true),  // 보라분홍
  cost: paint(136, true),    // 황금
  time: paint(67, true),     // 회청
  hot: paint(202, true),     // 주홍
  cold: paint(39, true),     // 하늘
};
const EFFORT = { low: 244, medium: 37, high: 33, xhigh: 98, max: 199 };
// 사용률 단계: 낮음 청록 → 중간 귤색 → 높음 빨강 (색약 배려: 숫자와 함께 표시)
const levelColor = (p) => (p >= 80 ? 160 : p >= 50 ? 172 : 37);
const level = (p) => paint(levelColor(p), true);
const BAR_TRACK = 253;
const SEP = C.sep(' │ ');

// ── 형식 ────────────────────────────────────────────────────────────────
function kTok(n) {
  if (n == null || !Number.isFinite(n)) return '-';
  const v = n / 1000;
  if (v < 10) return `${v.toFixed(1)}K`;
  return `${Math.round(v).toLocaleString('en-US')}K`;
}
function sizeLabel(n) {
  if (!Number.isFinite(n)) return '';
  return n >= 1000000 ? `${+(n / 1000000).toFixed(1)}M` : `${Math.round(n / 1000)}K`;
}
function duration(ms) {
  if (!Number.isFinite(ms) || ms < 0) return '-';
  const totalMin = Math.floor(ms / 60000);
  if (totalMin < 1) return `${Math.floor(ms / 1000)}s`;
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return h ? `${h}h${String(m).padStart(2, '0')}m` : `${m}m`;
}
function untilEpoch(sec) {
  if (!Number.isFinite(sec)) return '-';
  const s = Math.max(0, Math.round(sec - Date.now() / 1000));
  if (s < 60) return '<1m';
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d) return `${d}d${h}h`;
  if (h) return `${h}h${String(m).padStart(2, '0')}m`;
  return `${m}m`;
}
// 터미널 표시 폭 (한글·이모지 = 2칸)
function width(s) {
  let w = 0;
  for (const ch of s.replace(/\x1b\[[0-9;]*m/g, '')) {
    const cp = ch.codePointAt(0);
    if (cp === 0xfe0f || cp === 0x200d) continue;
    const wide =
      (cp >= 0x1100 && cp <= 0x115f) || (cp >= 0x2e80 && cp <= 0xa4cf) ||
      (cp >= 0xac00 && cp <= 0xd7a3) || (cp >= 0xf900 && cp <= 0xfaff) ||
      (cp >= 0xff00 && cp <= 0xff60) || (cp >= 0x1f300 && cp <= 0x1faff) ||
      cp === 0x231b || cp === 0x23f3 || cp === 0x26a1;
    w += wide ? 2 : 1;
  }
  return w;
}
function clip(s, max) {
  return [...s].length > max ? [...s].slice(0, max - 1).join('') + '~' : s;
}

// ── 정보 수집 ──────────────────────────────────────────────────────────
// 폭 맞춤으로 줄을 여러 번 그려도 git 등은 한 번만 부른다
const memo = (fn) => { const seen = new Map(); return (k) => { if (!seen.has(k)) seen.set(k, fn(k)); return seen.get(k); }; };
const loginId = memo(() => {
  try {
    const acc = JSON.parse(fs.readFileSync(ACCOUNT_FILE, 'utf8')).oauthAccount;
    if (acc && acc.emailAddress) return acc.emailAddress;
  } catch {}
  return process.env.ANTHROPIC_API_KEY ? 'API key' : '-';
});

function modelName(d) {
  const m = d.model || {};
  let name = m.display_name || m.id || '-';
  // display_name 에 버전이 없으면 id (claude-opus-5-5) 에서 붙인다
  const ver = /-(\d+)-(\d+)(?:\b|$)/.exec(m.id || '');
  if (ver && !/\d/.test(name)) name = `${name} ${ver[1]}.${ver[2]}`;
  return name;
}

// 이 PC 는 프로세스 하나 띄우는 데 0.4초쯤 걸려 git 결과를 몇 초 재사용한다
const GIT_CACHE_MS = 5000;
const gitStatus = memo((cwd) => {
  const key = require('crypto').createHash('md5').update(path.resolve(cwd)).digest('hex').slice(0, 12);
  const cacheFile = path.join(os.tmpdir(), `claude-statusline-git-${key}.json`);
  try {
    if (Date.now() - fs.statSync(cacheFile).mtimeMs < GIT_CACHE_MS) return JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
  } catch {}
  const g = readGit(cwd);
  try { fs.writeFileSync(cacheFile, JSON.stringify(g)); } catch {}
  return g;
});

function readGit(cwd) {
  try {
    // --no-optional-locks: 여러 세션이 같은 저장소를 쓰므로 index.lock 을 잡지 않는다
    const out = execFileSync('git', ['--no-optional-locks', 'status', '--porcelain=v2', '--branch'], {
      cwd, encoding: 'utf8', timeout: 2500, stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true,
    });
    const g = { branch: '', oid: '', upstream: false, ahead: 0, behind: 0, staged: 0, modified: 0, untracked: 0, conflicts: 0 };
    for (const line of out.split('\n')) {
      if (line.startsWith('# branch.head ')) g.branch = line.slice(14).trim();
      else if (line.startsWith('# branch.oid ')) g.oid = line.slice(13, 20);
      else if (line.startsWith('# branch.upstream ')) g.upstream = true;
      else if (line.startsWith('# branch.ab ')) {
        const [a, b] = line.slice(12).trim().split(' ');
        g.ahead = Math.abs(parseInt(a, 10)) || 0;
        g.behind = Math.abs(parseInt(b, 10)) || 0;
      } else if (line[0] === '1' || line[0] === '2') {
        if (line[2] !== '.') g.staged++;
        if (line[3] !== '.') g.modified++;
      } else if (line[0] === 'u') g.conflicts++;
      else if (line[0] === '?') g.untracked++;
    }
    if (g.branch === '(detached)') g.branch = `@${g.oid}`;
    return g;
  } catch {
    return null;
  }
}

// Remote Control: 입력 JSON 에 없다. ~/.claude/sessions/<pid>.json 중 이 세션의 파일에
// bridgeSessionId 가 있으면 켜진 것으로 본다.
const remoteControl = memo((sessionId) => {
  if (!sessionId) return null;
  try {
    const dir = path.join(CONFIG_DIR, 'sessions');
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith('.json')) continue;
      try {
        const j = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
        if (j.sessionId === sessionId) return Boolean(j.bridgeSessionId);
      } catch {}
    }
  } catch {}
  return null;
});

// Orca 터미널이 원래 걸어 둔 상태줄(~/.orca/agent-hooks/claude-statusline.cmd)이 하던 일 —
// 입력 JSON 을 Orca 에 POST 해 사용량을 Orca 화면에 띄운다 — 을 같은 요청으로 직접 한다.
// (cmd 를 띄우면 이 PC 에선 1초 넘게 걸리고, 띄워 두고 먼저 끝내면 node 와 함께 죽는다.)
function forwardToOrca(raw) {
  const pane = process.env.ORCA_PANE_KEY;
  if (!pane || process.env.CLAUDE_JOB_DIR || !raw.includes('"rate_limits"')) return Promise.resolve();
  // Orca 스크립트처럼 15초에 한 번만
  const key = require('crypto').createHash('md5').update(pane).digest('hex').slice(0, 12);
  const stamp = path.join(os.tmpdir(), `claude-statusline-orca-${key}.stamp`);
  try {
    if (Date.now() - fs.statSync(stamp).mtimeMs < 15000) return Promise.resolve();
  } catch {}
  try { fs.writeFileSync(stamp, ''); } catch {}

  // 포트·토큰은 Orca 가 재시작하면 바뀐다 — endpoint.cmd 의 최신 값을 우선
  const env = { ...process.env };
  try {
    for (const line of fs.readFileSync(process.env.ORCA_AGENT_HOOK_ENDPOINT, 'utf8').split(/\r?\n/)) {
      const m = /^set\s+"?(ORCA_[A-Z0-9_]+)=(.*?)"?\s*$/i.exec(line);
      if (m) env[m[1]] = m[2];
    }
  } catch {}
  if (!env.ORCA_AGENT_HOOK_PORT || !env.ORCA_AGENT_HOOK_TOKEN) return Promise.resolve();

  const body = new URLSearchParams({
    paneKey: pane,
    configDir: process.env.CLAUDE_CONFIG_DIR || '',
    env: env.ORCA_AGENT_HOOK_ENV || '',
    version: env.ORCA_AGENT_HOOK_VERSION || '',
    payload: raw,
  }).toString();
  return new Promise((resolve) => {
    try {
      const req = require('http').request({
        host: '127.0.0.1', port: Number(env.ORCA_AGENT_HOOK_PORT), path: '/statusline/claude', method: 'POST', timeout: 1500,
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': Buffer.byteLength(body),
          'X-Orca-Agent-Hook-Token': env.ORCA_AGENT_HOOK_TOKEN,
        },
      }, (res) => { res.resume(); res.on('end', resolve); res.on('error', resolve); });
      req.on('error', resolve);
      req.on('timeout', () => { req.destroy(); resolve(); });
      req.end(body);
    } catch { resolve(); }
  });
}

// ── 1줄 ────────────────────────────────────────────────────────────────
function line1(d, v) {
  const id = loginId();
  const idText = v >= 1 ? clip(id.split('@')[0], v >= 2 ? 14 : 20) : id;

  const effort = d.effort && d.effort.level;
  const effortText = effort ? paint(EFFORT[effort] || 98, true)(effort) : C.dim('-');

  const dir = (d.workspace && (d.workspace.project_dir || d.workspace.current_dir)) || d.cwd || '';
  const cur = (d.workspace && d.workspace.current_dir) || d.cwd || dir;
  let folder = path.basename(dir) || dir;
  if (cur && dir && path.resolve(cur) !== path.resolve(dir)) {
    const rel = path.relative(dir, cur).replace(/\\/g, '/');
    folder += rel && !rel.startsWith('..') ? `/${rel}` : ` > ${path.basename(cur)}`;
  }
  folder = clip(folder, v >= 2 ? 14 : v >= 1 ? 22 : 40);

  const g = gitStatus(cur || dir);
  let git;
  if (!g) git = C.dim('🌿 git 없음');
  else {
    const parts = [];
    if (g.upstream) {
      if (g.ahead || v === 0) parts.push((g.ahead ? C.ahead : C.dim)(`￪${g.ahead}`));
      if (g.behind || v === 0) parts.push((g.behind ? C.behind : C.dim)(`￬${g.behind}`));
    } else if (v === 0) parts.push(C.dim('업스트림 없음'));
    if (g.conflicts) parts.push(C.conflict(`!${g.conflicts}`));
    if (g.staged) parts.push(C.staged(`+${g.staged}`));
    if (g.modified) parts.push(C.modified(`~${g.modified}`));
    if (g.untracked) parts.push(C.untracked(`?${g.untracked}`));
    if (!g.conflicts && !g.staged && !g.modified && !g.untracked) parts.push(C.clean('✓'));
    git = `🌿 ${C.branch(clip(g.branch, v >= 2 ? 12 : 24))} ${parts.join(' ')}`;
  }

  const rc = remoteControl(d.session_id);
  const rcText = rc === true ? `📡 ${C.rcOn('RC ON')}` : rc === false ? `📴 ${C.rcOff('RC OFF')}` : `📴 ${C.rcOff('RC ?')}`;

  return [
    `👤 ${C.id(idText)}`,
    `🤖 ${C.model(modelName(d))}`,
    `🧠 ${effortText}`,
    `📁 ${C.folder(folder)}`,
    git,
    rcText,
  ].join(SEP);
}

// ── 2줄 ────────────────────────────────────────────────────────────────
function line2(d, v) {
  const cw = d.context_window || {};
  const cu = cw.current_usage;
  const used = cu ? (cu.input_tokens || 0) + (cu.cache_creation_input_tokens || 0) + (cu.cache_read_input_tokens || 0) : null;
  let pct = cw.used_percentage;
  if (pct == null && used != null && cw.context_window_size) pct = (used / cw.context_window_size) * 100;
  // 막대는 배경색 칸 10개 (글꼴 기호를 쓰지 않는다)
  let ctx;
  if (pct == null) ctx = C.dim('ctx -');
  else {
    const p = Math.max(0, Math.min(100, pct));
    const filled = Math.round(p / 10);
    const bar = v === 0 ? fill(levelColor(p))(' '.repeat(filled)) + fill(BAR_TRACK)(' '.repeat(10 - filled)) + ' ' : '';
    const size = v <= 1 && cw.context_window_size ? C.dim(` /${sizeLabel(cw.context_window_size)}`) : '';
    ctx = `${bar}${level(p)(`${Math.round(p)}%`.padStart(3))}${size}`;
  }

  // 이 뒤로 이모지(🕒 🔥 ⏳)가 오므로 숫자 폭을 고정한다
  const tok = `${C.tokIn(`￪${kTok(cw.total_input_tokens)}`.padEnd(6))} ${C.tokOut(`￬${kTok(cw.total_output_tokens)}`.padEnd(5))}`;

  const cost = d.cost || {};
  const costText = C.cost((Number.isFinite(cost.total_cost_usd) ? `$${cost.total_cost_usd.toFixed(2)}` : '$-').padEnd(6));
  const timeText = `🕒 ${C.time(duration(cost.total_duration_ms).padEnd(5))}`;

  // 프롬프트 캐시: warm 이면 HOT(만료까지 남은 시간), 만료되면 COLD
  const pc = d.prompt_cache;
  let cache;
  if (pc && pc.caching_observed !== false) {
    const now = Date.now() / 1000;
    const warm = pc.warm != null ? pc.warm : Number.isFinite(pc.expires_at) && pc.expires_at > now;
    const hit = (Number.isFinite(pc.hit_ratio) ? `${Math.round(pc.hit_ratio * 100)}%` : '-').padStart(3);
    if (warm) {
      const ttl = pc.ttl && v === 0 ? C.dim(` ${pc.ttl}`) : '';
      const rest = Number.isFinite(pc.expires_at) ? C.dim(` ⏳${untilEpoch(pc.expires_at)}`) : '';
      cache = `🔥 ${C.hot('HOT')} ${C.hot(hit)}${ttl}${rest}`;
    } else cache = `🧊 ${C.cold('COLD')} ${C.cold(hit)}`;
  } else if (cu && used) {
    cache = `💾 캐시 ${C.dim(`${Math.round(((cu.cache_read_input_tokens || 0) / used) * 100)}%`)}`;
  } else cache = `💤 ${C.dim('캐시 -')}`;

  const rl = d.rate_limits || {};
  const limit = (label, r) => {
    if (!r || !Number.isFinite(r.used_percentage)) return `${label} ${C.dim('-')}`;
    const reset = Number.isFinite(r.resets_at) ? C.dim(` (${untilEpoch(r.resets_at)})`) : '';
    return `${label} ${level(r.used_percentage)(`${Math.round(r.used_percentage)}%`)}${reset}`;
  };
  const limits = `${limit('5h', rl.five_hour)} ${C.dim('·')} ${limit('7d', rl.seven_day)}`;

  return [ctx, tok, costText, timeText, cache, limits].join(SEP);
}

// ── 실행 ───────────────────────────────────────────────────────────────
function main() {
  let raw = '';
  try { raw = fs.readFileSync(0, 'utf8'); } catch {}
  let d = {};
  try { d = JSON.parse(raw); } catch {}

  try {
    if (fs.existsSync(path.join(CONFIG_DIR, 'statusline.debug'))) {
      fs.writeFileSync(path.join(os.tmpdir(), 'claude-statusline-input.json'), raw);
      fs.writeFileSync(path.join(os.tmpdir(), 'claude-statusline-env.txt'), `COLUMNS=${process.env.COLUMNS} LINES=${process.env.LINES}\n`);
    }
  } catch {}

  // 폭이 모자라면 단계적으로 줄인다 (0 = 전체, 2 = 가장 짧게)
  const cols = parseInt(process.env.COLUMNS, 10) || 0;
  const fit = (build) => {
    let out = '';
    for (let v = 0; v <= 2; v++) {
      try { out = build(d, v); } catch { out = ''; }
      if (!cols || width(out) <= cols - 2) break;
    }
    return out;
  };
  process.stdout.write(`${fit(line1)}\n${fit(line2)}\n`);
  // 상태줄을 먼저 내보낸 뒤 Orca 로 보낸다
  if (raw) forwardToOrca(raw);
}

main();
