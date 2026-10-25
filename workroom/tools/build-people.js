'use strict';
// Meshy 에서 뽑은 사람 캐릭터(GLB)를 현황판 3D 화면용으로 줄인다.
// 사용법: node build-people.js <원본 폴더> <출력 폴더> [번호...]
//   원본 폴더: a<번호>.glb (동작 10개 묶음), t<번호>.glb (타자 동작, 같은 뼈대)
//   출력: p<번호>.js  → window.__WR_PEOPLE__[번호] = { glb, clips, walkV } (file:// 에서도 script 태그로 읽힌다)
// 다른 뼈대의 동작을 붙일 때: node build-people.js --borrow <출력 폴더> <번호> <리깅 모델.glb> <동작 파일.glb>...
//   같은 이름의 동작은 먼저 준 파일 것을 쓴다 (예: 빛식물 캐릭터는 자기 서기·걷기·앉기를 먼저 주고, 나머지는 Meshy 동작).
// 하는 일:
//   - 텍스처를 1024 한 장에 다시 늘어놓는다. UV 조각마다 여백을 두고 그 조각 색으로 채워서
//     멀리서 볼 때(밉맵) 옆 조각 색이 섞여 이음매가 선으로 비치지 않게 한다.
//   - 법선을 UV 이음매 너머까지 이어서 다시 계산한다 (이음매마다 빛이 끊겨 선처럼 보이지 않게).
//   - 동작은 뼈마다 "기본자세에서 얼마나 돌았나"를 월드 기준으로 옮겨 붙인다.
//     뼈대마다 기본자세(T자세·A자세, 뼈 축 방향)가 달라도 같은 자세가 나온다. 위치는 엉덩이(Hips)만, 15fps, 회전은 16비트.
//   - 걷기 동작의 발 속도(walkV, m/s)를 재 둔다. 다리가 짧은 캐릭터가 미끄러지듯 걷지 않게 화면이 동작 빠르기를 맞춘다.
// 필요: ffmpeg
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const SRC = process.argv[2];
const OUT = process.argv[3];
const TEX = 1024;          // 최종 텍스처 크기
const FPS = 15;
const CLIP_NAMES = [
  [/walk/i, 'walk'], [/^idle$/i, 'idle'], [/chair_sit_idle/i, 'sit'], [/sitting_answering/i, 'talkSit'], [/wave/i, 'wave'],
  [/left_hand_raised/i, 'ask'], [/headache/i, 'headache'], [/stand_and_drink/i, 'drink'], [/sit_and_drink/i, 'sitDrink'],
  [/right_hand_open/i, 'present'], [/retarget/i, 'type'], [/sleep/i, 'sleep'], [/doze/i, 'doze'],
];
// 모든 캐릭터에 더 붙일 동작 파일 (쉼표로 구분, 예: 빛식물 프로젝트의 sleep·doze 클립)
const EXTRA = (process.env.WR_EXTRA_ANIMS || '').split(',').filter(Boolean);

// ---------- GLB 읽기 ----------
function readGlb(file) {
  const buf = fs.readFileSync(file);
  const jsonLen = buf.readUInt32LE(12);
  const json = JSON.parse(buf.slice(20, 20 + jsonLen).toString('utf8'));
  const binStart = 20 + jsonLen;
  const binLen = buf.readUInt32LE(binStart);
  return { file, json, bin: buf.slice(binStart + 8, binStart + 8 + binLen) };
}
const COMP = { 5120: Int8Array, 5121: Uint8Array, 5122: Int16Array, 5123: Uint16Array, 5125: Uint32Array, 5126: Float32Array };
const NCOMP = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };
function accessor(g, i) {
  const a = g.json.accessors[i], bv = g.json.bufferViews[a.bufferView];
  const T = COMP[a.componentType], n = NCOMP[a.type], size = T.BYTES_PER_ELEMENT;
  const out = new T(a.count * n);
  const stride = bv.byteStride || n * size;
  const base = g.bin.byteOffset + (bv.byteOffset || 0) + (a.byteOffset || 0);
  if (stride === n * size) {
    out.set(new T(g.bin.buffer.slice(base, base + a.count * stride)));
  } else {
    for (let k = 0; k < a.count; k++) out.set(new T(g.bin.buffer.slice(base + k * stride, base + k * stride + n * size)), k * n);
  }
  // 정규화된 정수(예: 16비트 회전)는 -1~1 실수로 바꾼다
  if (a.normalized && T !== Float32Array) {
    const max = { 5120: 127, 5121: 255, 5122: 32767, 5123: 65535 }[a.componentType];
    return { data: Float32Array.from(out, (x) => Math.max(-1, x / max)), n, a };
  }
  return { data: out, n, a };
}

// ---------- 새 GLB 만들기 ----------
function Builder() {
  const parts = [];
  let len = 0;
  const json = { asset: { version: '2.0', generator: 'workroom build-people' }, accessors: [], bufferViews: [], buffers: [{ byteLength: 0 }] };
  function view(bytes, target) {
    const pad = (4 - (len % 4)) % 4;
    if (pad) { parts.push(Buffer.alloc(pad)); len += pad; }
    const v = { buffer: 0, byteOffset: len, byteLength: bytes.length };
    if (target) v.target = target;
    json.bufferViews.push(v);
    parts.push(bytes);
    len += bytes.length;
    return json.bufferViews.length - 1;
  }
  function acc(typed, type, componentType, opts) {
    const bytes = Buffer.from(typed.buffer, typed.byteOffset, typed.byteLength);
    const a = Object.assign({ bufferView: view(bytes, opts && opts.target), componentType, count: typed.length / NCOMP[type], type }, opts && opts.extra || {});
    json.accessors.push(a);
    return json.accessors.length - 1;
  }
  function finish() {
    const pad = (4 - (len % 4)) % 4;
    if (pad) { parts.push(Buffer.alloc(pad)); len += pad; }
    json.buffers[0].byteLength = len;
    let js = Buffer.from(JSON.stringify(json), 'utf8');
    js = Buffer.concat([js, Buffer.alloc((4 - (js.length % 4)) % 4, 0x20)]);
    const bin = Buffer.concat(parts);
    const head = Buffer.alloc(12);
    head.writeUInt32LE(0x46546c67, 0); head.writeUInt32LE(2, 4); head.writeUInt32LE(12 + 8 + js.length + 8 + bin.length, 8);
    const c1 = Buffer.alloc(8); c1.writeUInt32LE(js.length, 0); c1.writeUInt32LE(0x4e4f534a, 4);
    const c2 = Buffer.alloc(8); c2.writeUInt32LE(bin.length, 0); c2.writeUInt32LE(0x004e4942, 4);
    return Buffer.concat([head, c1, js, c2, bin]);
  }
  return { json, view, acc, finish };
}

// ---------- 회전 계산 (사원수 [x, y, z, w]) ----------
const qmul = (a, b) => [
  a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
  a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
  a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
  a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2]];
const qinv = (q) => [-q[0], -q[1], -q[2], q[3]];
const qnorm = (q) => { const l = Math.hypot(q[0], q[1], q[2], q[3]) || 1; return [q[0] / l, q[1] / l, q[2] / l, q[3] / l]; };
const qrot = (q, v) => { const p = qmul(qmul(q, [v[0], v[1], v[2], 0]), qinv(q)); return [p[0], p[1], p[2]]; };
const vsub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const vlen = (a) => Math.hypot(a[0], a[1], a[2]);
// a 방향을 b 방향으로 돌리는 가장 짧은 회전
function qarc(a, b) {
  const la = vlen(a), lb = vlen(b);
  if (!la || !lb) return [0, 0, 0, 1];
  const x = [a[0] / la, a[1] / la, a[2] / la], y = [b[0] / lb, b[1] / lb, b[2] / lb];
  const d = x[0] * y[0] + x[1] * y[1] + x[2] * y[2];
  if (d < -0.9999) { const ax = Math.abs(x[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0]; const c = [x[1] * ax[2] - x[2] * ax[1], x[2] * ax[0] - x[0] * ax[2], x[0] * ax[1] - x[1] * ax[0]]; return qnorm([c[0], c[1], c[2], 0]); }
  const c = [x[1] * y[2] - x[2] * y[1], x[2] * y[0] - x[0] * y[2], x[0] * y[1] - x[1] * y[0]];
  return qnorm([c[0], c[1], c[2], 1 + d]);
}

// ---------- 뼈대 ----------
function rigOf(g) {
  const nodes = g.json.nodes, parent = nodes.map(() => -1);
  nodes.forEach((n, i) => (n.children || []).forEach((c) => { parent[c] = i; }));
  const local = nodes.map((n) => ({ t: n.translation || [0, 0, 0], r: n.rotation || [0, 0, 0, 1], s: n.scale ? n.scale[0] : 1 }));
  const order = [];
  const visit = (i) => { order.push(i); (nodes[i].children || []).forEach(visit); };
  nodes.forEach((n, i) => { if (parent[i] < 0) visit(i); });
  const byName = {};
  nodes.forEach((n, i) => { if (n.name != null && byName[n.name] == null) byName[n.name] = i; });
  const rig = { g, nodes, parent, local, order, byName };
  rig.rest = pose(rig, (i) => local[i]);
  // 뼈 방향을 잴 다음 뼈: 자식이 여럿이면 어깨·다리·headfront 가 아닌 쪽(척추·목·머리 끝)
  rig.next = nodes.map((n, i) => {
    const kids = (n.children || []).filter((c) => /^(Hips|Spine\d*|neck|Head|head_end|(Left|Right)(Shoulder|Arm|ForeArm|Hand|UpLeg|Leg|Foot|ToeBase))$/.test(nodes[c].name || ''));
    if (kids.length <= 1) return kids.length ? kids[0] : -1;
    const main = kids.filter((c) => !/Shoulder|UpLeg/.test(nodes[c].name));
    return main.length ? main[0] : kids[0];
  });
  const hips = byName.Hips;
  rig.hipsY = hips != null ? rig.rest[hips].t[1] : 0;
  return rig;
}
// 각 마디의 지역 변환(localOf)으로 월드 변환을 구한다 (크기는 균일하다고 본다)
function pose(rig, localOf) {
  const W = new Array(rig.nodes.length);
  for (const i of rig.order) {
    const L = localOf(i), p = rig.parent[i];
    if (p < 0) { W[i] = { t: L.t.slice(), r: L.r.slice(), s: L.s }; continue; }
    const P = W[p], tt = qrot(P.r, L.t);
    W[i] = { t: [P.t[0] + P.s * tt[0], P.t[1] + P.s * tt[1], P.t[2] + P.s * tt[2]], r: qmul(P.r, L.r), s: P.s * L.s };
  }
  return W;
}
function boneDir(rig, W, i) {
  const n = rig.next[i];
  return n >= 0 ? vsub(W[n].t, W[i].t) : null;
}

// ---------- 동작 옮겨 붙이기 ----------
function clipName(n) {
  const short = String(n).split('|').filter((x) => x && x !== 'Armature' && x !== 'baselayer').pop() || n;
  for (const [re, key] of CLIP_NAMES) if (re.test(short)) return key;
  return null;
}
function channelSampler(g, an, ch) {
  const s = an.samplers[ch.sampler];
  const times = accessor(g, s.input).data, vals = accessor(g, s.output).data;
  const n = ch.target.path === 'rotation' ? 4 : 3;
  const cubic = s.interpolation === 'CUBICSPLINE', step = s.interpolation === 'STEP';
  const at = (k) => { const o = (cubic ? k * 3 + 1 : k) * n; return Array.from(vals.slice(o, o + n)); };
  return (t) => {
    if (t <= times[0]) return at(0);
    const last = times.length - 1;
    if (t >= times[last]) return at(last);
    let k = 0;
    while (k < last - 1 && times[k + 1] <= t) k++;
    const a = at(k);
    if (step) return a;
    const b = at(k + 1), f = (t - times[k]) / (times[k + 1] - times[k]);
    if (n === 4) {
      const sign = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3] < 0 ? -1 : 1;
      return qnorm(a.map((x, c) => x * (1 - f) + b[c] * sign * f));
    }
    return a.map((x, c) => x * (1 - f) + b[c] * f);
  };
}
// 원본(S)의 동작 an 을 대상 뼈대(A)에 옮겨 붙인다.
//   뼈마다: 대상 월드 회전 = (원본 월드 회전 · 원본 기본자세⁻¹) · (기본자세 뼈 방향 맞춤) · 대상 기본자세
function retarget(B, A, S, an, name) {
  const rigA = A.rig, rigS = S.rig;
  const chans = {};
  let dur = 0;
  an.channels.forEach((ch) => {
    if (ch.target.path !== 'rotation' && ch.target.path !== 'translation') return;
    (chans[ch.target.node] = chans[ch.target.node] || {})[ch.target.path] = channelSampler(S.g, an, ch);
    const inp = S.g.json.accessors[an.samplers[ch.sampler].input];
    dur = Math.max(dur, inp.max ? inp.max[0] : 0);
  });
  const frames = Math.max(2, Math.round(dur * FPS) + 1);
  const joints = A.g.json.skins[0].joints;
  const pairs = joints.map((j) => ({ a: j, s: rigS.byName[rigA.nodes[j].name] })).filter((p) => p.s != null);
  // 기본자세에서 뼈 방향이 다르면(예: T자세 ↔ A자세) 원본 쪽 방향으로 맞춰 둔다. 끝 뼈(손 등)는 부모 것을 따른다.
  const fix = {};
  for (const i of rigA.order) {
    const p = pairs.find((x) => x.a === i);
    if (!p) continue;
    const da = boneDir(rigA, rigA.rest, i), ds = boneDir(rigS, rigS.rest, p.s);
    fix[i] = da && ds ? qarc(da, ds) : (fix[rigA.parent[i]] || [0, 0, 0, 1]);
  }
  const hipsA = rigA.byName.Hips, hipsS = rigS.byName.Hips;
  const ratio = hipsA != null && hipsS != null && rigS.hipsY ? rigA.hipsY / rigS.hipsY : 1;
  const rot = pairs.map(() => new Float32Array(frames * 4)), hipT = new Float32Array(frames * 3);
  const times = new Float32Array(frames);
  const feet = [];
  for (let k = 0; k < frames; k++) {
    const t = times[k] = dur * k / (frames - 1);
    const WS = pose(rigS, (i) => ({
      t: chans[i] && chans[i].translation ? chans[i].translation(t) : rigS.local[i].t,
      r: chans[i] && chans[i].rotation ? chans[i].rotation(t) : rigS.local[i].r,
      s: rigS.local[i].s,
    }));
    const want = {};
    pairs.forEach((p) => {
      const delta = qmul(WS[p.s].r, qinv(rigS.rest[p.s].r));
      want[p.a] = qnorm(qmul(qmul(delta, fix[p.a]), rigA.rest[p.a].r));
    });
    let hipWorld = null;
    if (hipsA != null && hipsS != null) {
      const d = vsub(WS[hipsS].t, rigS.rest[hipsS].t);
      hipWorld = [rigA.rest[hipsA].t[0] + d[0] * ratio, rigA.rest[hipsA].t[1] + d[1] * ratio, rigA.rest[hipsA].t[2] + d[2] * ratio];
    }
    const localR = {}, WA = new Array(rigA.nodes.length);
    for (const i of rigA.order) {
      const p = rigA.parent[i], P = p < 0 ? { t: [0, 0, 0], r: [0, 0, 0, 1], s: 1 } : WA[p];
      const L = rigA.local[i];
      const r = want[i] ? qnorm(qmul(qinv(P.r), want[i])) : L.r;
      let tl = L.t;
      if (i === hipsA && hipWorld) { const v = qrot(qinv(P.r), vsub(hipWorld, P.t)); tl = [v[0] / P.s, v[1] / P.s, v[2] / P.s]; }
      if (want[i]) localR[i] = r;
      if (i === hipsA) hipT.set(tl, k * 3);
      const tt = qrot(P.r, tl);
      WA[i] = { t: [P.t[0] + P.s * tt[0], P.t[1] + P.s * tt[1], P.t[2] + P.s * tt[2]], r: qmul(P.r, r), s: P.s * L.s };
    }
    pairs.forEach((p, j) => {
      let q = localR[p.a];
      if (k > 0) { const o = (k - 1) * 4, pr = rot[j]; if (pr[o] * q[0] + pr[o + 1] * q[1] + pr[o + 2] * q[2] + pr[o + 3] * q[3] < 0) q = q.map((x) => -x); }
      rot[j].set(q, k * 4);
    });
    const lf = rigA.byName.LeftFoot, rf = rigA.byName.RightFoot;
    if (lf != null && rf != null) feet.push([WA[lf].t, WA[rf].t]);
  }
  const samplers = [], channels = [];
  const ti = B.acc(times, 'SCALAR', 5126, { extra: { min: [times[0]], max: [times[frames - 1]] } });
  pairs.forEach((p, j) => {
    const q = new Int16Array(frames * 4);
    for (let c = 0; c < q.length; c++) q[c] = Math.round(Math.max(-1, Math.min(1, rot[j][c])) * 32767);
    samplers.push({ input: ti, output: B.acc(q, 'VEC4', 5122, { extra: { normalized: true } }), interpolation: 'LINEAR' });
    channels.push({ sampler: samplers.length - 1, target: { node: p.a, path: 'rotation' } });
  });
  if (hipsA != null && hipsS != null) {
    samplers.push({ input: ti, output: B.acc(hipT, 'VEC3', 5126), interpolation: 'LINEAR' });
    channels.push({ sampler: samplers.length - 1, target: { node: hipsA, path: 'translation' } });
  }
  // 걷기: 매 순간 땅에 닿은(더 낮은) 발이 뒤로 밀리는 빠르기의 평균 = 제자리 걷기 동작의 걷는 속도
  let walkV = 0;
  if (name === 'walk' && feet.length > 2 && dur > 0) {
    let sum = 0;
    for (let k = 1; k < feet.length; k++) {
      const c = feet[k][0][1] <= feet[k][1][1] ? 0 : 1;
      sum += (feet[k][c][2] - feet[k - 1][c][2]) / (times[k] - times[k - 1]);
    }
    walkV = Math.abs(sum / (feet.length - 1));
  }
  return { anim: { name, samplers, channels }, walkV };
}

// ---------- 법선: UV 이음매에서 갈라진 법선을 이어 붙인다 ----------
// 원래 법선(부드럽게 다듬어 둔 것)을 쓰되, 면 감김과 반대로 뒤집힌 것은 바로잡고,
// 같은 자리의 꼭짓점끼리 방향이 비슷한(60° 안) 것을 평균한다. 날카로운 모서리와 앞뒤로 겹친 얇은 면은 따로 남는다.
function smoothNormals(pos, idx, orig) {
  const nv = pos.length / 3, nt = idx.length / 3;
  const fn = new Float32Array(nt * 3);
  for (let t = 0; t < nt; t++) {
    const a = idx[t * 3] * 3, b = idx[t * 3 + 1] * 3, c = idx[t * 3 + 2] * 3;
    const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2];
    const vx = pos[c] - pos[a], vy = pos[c + 1] - pos[a + 1], vz = pos[c + 2] - pos[a + 2];
    fn[t * 3] = uy * vz - uz * vy; fn[t * 3 + 1] = uz * vx - ux * vz; fn[t * 3 + 2] = ux * vy - uy * vx;
  }
  let lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let v = 0; v < nv; v++) for (let c = 0; c < 3; c++) { lo[c] = Math.min(lo[c], pos[v * 3 + c]); hi[c] = Math.max(hi[c], pos[v * 3 + c]); }
  const eps = Math.hypot(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]) * 1e-6 || 1e-9;
  const key = (v) => Math.round(pos[v * 3] / eps) + ',' + Math.round(pos[v * 3 + 1] / eps) + ',' + Math.round(pos[v * 3 + 2] / eps);
  const group = new Map(), gid = new Int32Array(nv);
  for (let v = 0; v < nv; v++) { const k = key(v); if (!group.has(k)) group.set(k, group.size); gid[v] = group.get(k); }
  const vFaces = Array.from({ length: nv }, () => []), members = Array.from({ length: group.size }, () => []);
  for (let t = 0; t < nt; t++) for (let e = 0; e < 3; e++) vFaces[idx[t * 3 + e]].push(t);
  for (let v = 0; v < nv; v++) members[gid[v]].push(v);
  // 1) 꼭짓점마다 쓸 법선: 원래 법선을 면 감김 쪽으로 맞춘다 (없거나 0 이면 붙은 면들의 평균)
  const n0 = new Float32Array(nv * 3);
  for (let v = 0; v < nv; v++) {
    let rx = 0, ry = 0, rz = 0;
    for (const t of vFaces[v]) { rx += fn[t * 3]; ry += fn[t * 3 + 1]; rz += fn[t * 3 + 2]; }
    const rl = Math.hypot(rx, ry, rz) || 1;
    rx /= rl; ry /= rl; rz /= rl;
    let ox = orig ? orig[v * 3] : 0, oy = orig ? orig[v * 3 + 1] : 0, oz = orig ? orig[v * 3 + 2] : 0;
    const ol = Math.hypot(ox, oy, oz);
    if (!ol) { ox = rx; oy = ry; oz = rz; } else { ox /= ol; oy /= ol; oz /= ol; if (ox * rx + oy * ry + oz * rz < 0) { ox = -ox; oy = -oy; oz = -oz; } }
    n0[v * 3] = ox; n0[v * 3 + 1] = oy; n0[v * 3 + 2] = oz;
  }
  // 2) 같은 자리에서 방향이 비슷한 것끼리 평균
  const out = new Float32Array(nv * 3);
  for (let v = 0; v < nv; v++) {
    let sx = 0, sy = 0, sz = 0;
    for (const u of members[gid[v]]) {
      if (n0[u * 3] * n0[v * 3] + n0[u * 3 + 1] * n0[v * 3 + 1] + n0[u * 3 + 2] * n0[v * 3 + 2] > 0.5) { sx += n0[u * 3]; sy += n0[u * 3 + 1]; sz += n0[u * 3 + 2]; }
    }
    const l = Math.hypot(sx, sy, sz) || 1;
    out[v * 3] = sx / l; out[v * 3 + 1] = sy / l; out[v * 3 + 2] = sz / l;
  }
  return out;
}

// ---------- 텍스처: 여백 채우고 줄이기 ----------
function ffmpeg(args) { execFileSync('ffmpeg', ['-y', '-loglevel', 'error'].concat(args), { stdio: ['ignore', 'ignore', 'inherit'] }); }
function probeSize(file) {
  const out = execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', file], { encoding: 'utf8' });
  const [w, h] = out.trim().split(',').map(Number);
  return { w, h };
}
// 점과 선분 사이 거리². 아주 가는 삼각형도 놓치지 않게, 텍셀 중심이 삼각형에서 0.75 텍셀 안이면 그 삼각형 것으로 본다
// (놓치면 그 아래 원래 색을 옆 조각 색으로 덮어써서 줄이 생긴다).
function segDist2(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay, l = dx * dx + dy * dy;
  const t = l ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l)) : 0;
  const ex = ax + t * dx - px, ey = ay + t * dy - py;
  return ex * ex + ey * ey;
}
// 빈 곳을 모두 가장 가까운 채워진 텍셀 색으로 (jump flooding)
function fillNearest(rgb, cov, W, H) {
  let seed = new Int32Array(W * H).fill(-1), next = new Int32Array(W * H);
  for (let k = 0; k < W * H; k++) if (cov[k]) seed[k] = k;
  const d2 = (k, s) => { const dx = (k % W) - (s % W), dy = ((k / W) | 0) - ((s / W) | 0); return dx * dx + dy * dy; };
  const steps = [];
  for (let s = 1 << Math.ceil(Math.log2(Math.max(W, H))) >> 1; s >= 1; s >>= 1) steps.push(s);
  steps.push(1);
  for (const st of steps) {
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const k = y * W + x;
        let best = seed[k], bd = best >= 0 ? d2(k, best) : Infinity;
        for (let dy = -st; dy <= st; dy += st) {
          const ny = y + dy;
          if (ny < 0 || ny >= H) continue;
          for (let dx = -st; dx <= st; dx += st) {
            const nx = x + dx;
            if (nx < 0 || nx >= W || (!dx && !dy)) continue;
            const s = seed[ny * W + nx];
            if (s >= 0) { const d = d2(k, s); if (d < bd) { bd = d; best = s; } }
          }
        }
        next[k] = best;
      }
    }
    const t = seed; seed = next; next = t;
  }
  for (let k = 0; k < W * H; k++) if (!cov[k] && seed[k] >= 0) { const s = seed[k]; rgb[k * 3] = rgb[s * 3]; rgb[k * 3 + 1] = rgb[s * 3 + 1]; rgb[k * 3 + 2] = rgb[s * 3 + 2]; }
}
// ---------- 텍스처 다시 배치 ----------
// Meshy 텍스처는 UV 조각이 1,000개 넘게 틈 없이 붙어 있어서, 멀리서 볼 때(밉맵) 옆 조각 색이 섞여 이음매마다 선이 생긴다.
// 조각마다 사방에 GUT 텍셀 여백을 두고 ALIGN 칸에 맞춰 새 텍스처에 다시 늘어놓는다.
// 밉맵 2단계(4×4)까지는 한 칸이 한 조각 안에만 있어서 섞이지 않는다 (화면은 그 이상 흐리게 보지 않는다).
const GUT = 2, ALIGN = 4;
// 삼각형으로 이어진 꼭짓점, 그리고 자리와 UV 가 같은 꼭짓점(법선만 달라 갈라 둔 것)을 한 조각으로 묶는다
function islandsOf(idx, nv, pos, uv) {
  const par = Int32Array.from({ length: nv }, (_, i) => i);
  const find = (x) => { while (par[x] !== x) { par[x] = par[par[x]]; x = par[x]; } return x; };
  const join = (a, b) => { a = find(a); b = find(b); if (a !== b) par[b] = a; };
  for (let t = 0; t < idx.length / 3; t++) { join(idx[t * 3], idx[t * 3 + 1]); join(idx[t * 3], idx[t * 3 + 2]); }
  const same = new Map();
  for (let v = 0; v < nv; v++) {
    const k = [pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]].map((x) => Math.round(x * 1e5)).join(',') + '|' + Math.round(uv[v * 2] * 1e6) + ',' + Math.round(uv[v * 2 + 1] * 1e6);
    if (same.has(k)) join(same.get(k), v); else same.set(k, v);
  }
  const id = new Int32Array(nv).fill(-1), roots = new Map();
  for (let v = 0; v < nv; v++) { const r = find(v); if (!roots.has(r)) roots.set(r, roots.size); id[v] = roots.get(r); }
  return { id, count: roots.size };
}
function shelfPack(rects, size) {
  const order = rects.map((r, i) => i).sort((a, b) => rects[b].h - rects[a].h || rects[b].w - rects[a].w);
  let x = 0, y = 0, shelf = 0;
  const at = new Array(rects.length);
  for (const i of order) {
    const r = rects[i];
    if (r.w > size) return null;
    if (x + r.w > size) { x = 0; y += shelf; shelf = 0; }
    if (y + r.h > size) return null;
    at[i] = { x, y };
    x += r.w;
    shelf = Math.max(shelf, r.h);
  }
  return at;
}
function repack(rgb, W, H, uv, idx, pos) {
  const nv = uv.length / 2;
  const { id: isl, count } = islandsOf(idx, nv, pos, uv);
  // 원본 해상도에서 텍셀마다 어느 조각 것인지 (가는 삼각형도 닿으면 표시)
  const owner = new Int32Array(W * H).fill(-1);
  const R2 = 0.75 * 0.75;
  const box = Array.from({ length: count }, () => ({ x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity }));
  for (let v = 0; v < nv; v++) {
    const b = box[isl[v]], x = uv[v * 2] * W, y = uv[v * 2 + 1] * H;
    b.x0 = Math.min(b.x0, x); b.x1 = Math.max(b.x1, x); b.y0 = Math.min(b.y0, y); b.y1 = Math.max(b.y1, y);
  }
  for (let t = 0; t < idx.length / 3; t++) {
    const i0 = idx[t * 3], i1 = idx[t * 3 + 1], i2 = idx[t * 3 + 2], k = isl[i0];
    const x0 = uv[i0 * 2] * W, y0 = uv[i0 * 2 + 1] * H, x1 = uv[i1 * 2] * W, y1 = uv[i1 * 2 + 1] * H, x2 = uv[i2 * 2] * W, y2 = uv[i2 * 2 + 1] * H;
    const minX = Math.max(0, Math.floor(Math.min(x0, x1, x2)) - 1), maxX = Math.min(W - 1, Math.ceil(Math.max(x0, x1, x2)) + 1);
    const minY = Math.max(0, Math.floor(Math.min(y0, y1, y2)) - 1), maxY = Math.min(H - 1, Math.ceil(Math.max(y0, y1, y2)) + 1);
    const area = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0);
    for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
      const px = x + 0.5, py = y + 0.5;
      let inside = false;
      if (Math.abs(area) > 1e-12) {
        const w0 = ((x1 - px) * (y2 - py) - (x2 - px) * (y1 - py)) / area, w1 = ((x2 - px) * (y0 - py) - (x0 - px) * (y2 - py)) / area;
        inside = w0 >= 0 && w1 >= 0 && 1 - w0 - w1 >= 0;
      }
      if (inside || segDist2(px, py, x0, y0, x1, y1) <= R2 || segDist2(px, py, x1, y1, x2, y2) <= R2 || segDist2(px, py, x2, y2, x0, y0) <= R2) {
        const o = y * W + x;
        // 두 조각이 닿는 텍셀은 삼각형 안쪽인 쪽에 준다
        if (owner[o] < 0 || inside) owner[o] = k;
      }
    }
  }
  // 새 텍스처에서 조각 크기 = 원본 크기 × s. 다 들어가는 가장 큰 s 를 찾는다
  const rectsFor = (s) => box.map((b) => {
    const iw = Math.ceil((b.x1 - b.x0) * s) + 2, ih = Math.ceil((b.y1 - b.y0) * s) + 2;
    return { w: Math.ceil((iw + 2 * GUT) / ALIGN) * ALIGN, h: Math.ceil((ih + 2 * GUT) / ALIGN) * ALIGN };
  });
  let lo = 0.05, hi = 2 * TEX / Math.max(W, H), place = null, s = lo;
  for (let it = 0; it < 22; it++) {
    const mid = (lo + hi) / 2, p = shelfPack(rectsFor(mid), TEX);
    if (p) { lo = mid; place = p; s = mid; } else hi = mid;
  }
  if (!place) throw new Error('텍스처 조각을 다시 배치하지 못했어요');
  const rects = rectsFor(s);
  const out = Buffer.alloc(TEX * TEX * 3);
  const filled = new Uint8Array(TEX * TEX);
  const foot = 1 / s;   // 새 텍셀 하나가 덮는 원본 텍셀 폭
  for (let k = 0; k < count; k++) {
    const b = box[k], r = rects[k], p = place[k];
    const ox = p.x + GUT + 1, oy = p.y + GUT + 1;   // 조각 원점(원본 b.x0, b.y0)이 놓이는 곳
    for (let dy = p.y; dy < p.y + r.h; dy++) {
      for (let dx = p.x; dx < p.x + r.w; dx++) {
        const sx0 = b.x0 + (dx - ox) * foot, sy0 = b.y0 + (dy - oy) * foot;
        let cr = 0, cg = 0, cb = 0, n = 0;
        const xa = Math.floor(sx0), xb = Math.max(xa + 1, Math.ceil(sx0 + foot)), ya = Math.floor(sy0), yb = Math.max(ya + 1, Math.ceil(sy0 + foot));
        for (let y = Math.max(0, ya); y < Math.min(H, yb); y++) for (let x = Math.max(0, xa); x < Math.min(W, xb); x++) {
          const o = y * W + x;
          if (owner[o] !== k) continue;
          cr += rgb[o * 3]; cg += rgb[o * 3 + 1]; cb += rgb[o * 3 + 2]; n++;
        }
        if (n) { const o = dy * TEX + dx; out[o * 3] = cr / n; out[o * 3 + 1] = cg / n; out[o * 3 + 2] = cb / n; filled[o] = 1; }
      }
    }
    // 조각 칸 안의 빈 곳(여백, 다른 조각 자리)은 이 조각의 가장 가까운 색으로 채운다
    const q = [];
    for (let dy = p.y; dy < p.y + r.h; dy++) for (let dx = p.x; dx < p.x + r.w; dx++) if (filled[dy * TEX + dx]) q.push(dy * TEX + dx);
    for (let h = 0; h < q.length; h++) {
      const o = q[h], x = o % TEX, y = (o - x) / TEX;
      for (const [nx, ny] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]) {
        if (nx < p.x || nx >= p.x + r.w || ny < p.y || ny >= p.y + r.h) continue;
        const n2 = ny * TEX + nx;
        if (filled[n2]) continue;
        filled[n2] = 1; out[n2 * 3] = out[o * 3]; out[n2 * 3 + 1] = out[o * 3 + 1]; out[n2 * 3 + 2] = out[o * 3 + 2];
        q.push(n2);
      }
    }
  }
  fillNearest(out, filled, TEX, TEX);
  const nuv = new Float32Array(uv.length);
  for (let v = 0; v < nv; v++) {
    const k = isl[v], b = box[k], p = place[k];
    nuv[v * 2] = (p.x + GUT + 1 + (uv[v * 2] * W - b.x0) * s) / TEX;
    nuv[v * 2 + 1] = (p.y + GUT + 1 + (uv[v * 2 + 1] * H - b.y0) * s) / TEX;
  }
  return { rgb: out, uv: nuv, islands: count, scale: s * Math.max(W, H) / TEX };
}

function texture(g, uv, idx, pos, tmp) {
  const im = g.json.images[0], bv = g.json.bufferViews[im.bufferView];
  const src = path.join(tmp, 'tex_src' + (im.mimeType === 'image/png' ? '.png' : '.jpg'));
  fs.writeFileSync(src, g.bin.slice(bv.byteOffset || 0, (bv.byteOffset || 0) + bv.byteLength));
  const { w, h } = probeSize(src);
  const raw = path.join(tmp, 'tex.raw'), jpg = path.join(tmp, 'tex.jpg');
  ffmpeg(['-i', src, '-f', 'rawvideo', '-pix_fmt', 'rgb24', raw]);
  const r = repack(fs.readFileSync(raw), w, h, uv, idx, pos);
  fs.writeFileSync(raw, r.rgb);
  ffmpeg(['-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', `${TEX}x${TEX}`, '-i', raw, '-q:v', '2', jpg]);
  return { jpg: fs.readFileSync(jpg), uv: r.uv, note: `조각 ${r.islands}개, 원본 대비 ${(r.scale * 100).toFixed(0)}%` };
}

// i: 출력 번호, meshFile: 메시·뼈대를 가져올 GLB, animFiles: 동작을 가져올 GLB 들 (같은 이름은 앞의 것)
function build(i, meshFile, animFiles, note) {
  const A = readGlb(meshFile);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wrp-'));
  const prim = A.json.meshes[0].primitives[0];
  const pos = accessor(A, prim.attributes.POSITION), uv = accessor(A, prim.attributes.TEXCOORD_0);
  const joints = accessor(A, prim.attributes.JOINTS_0), weights = accessor(A, prim.attributes.WEIGHTS_0);
  const index = accessor(A, prim.indices).data;
  const tex = texture(A, uv.data, index, pos.data, tmp), jpg = tex.jpg;
  const normals = smoothNormals(pos.data, index, prim.attributes.NORMAL != null ? accessor(A, prim.attributes.NORMAL).data : null);

  const B = Builder(), J = B.json;
  J.scene = 0;
  J.scenes = A.json.scenes;
  J.nodes = A.json.nodes;
  const w8 = new Uint8Array(weights.data.length);
  for (let v = 0; v < weights.data.length / 4; v++) {
    const s = weights.data[v * 4] + weights.data[v * 4 + 1] + weights.data[v * 4 + 2] + weights.data[v * 4 + 3] || 1;
    let sum = 0;
    for (let c = 0; c < 3; c++) { w8[v * 4 + c] = Math.round(weights.data[v * 4 + c] / s * 255); sum += w8[v * 4 + c]; }
    w8[v * 4 + 3] = Math.max(0, 255 - sum);
  }
  const attrs = {
    POSITION: B.acc(pos.data, 'VEC3', 5126, { target: 34962, extra: { min: pos.a.min, max: pos.a.max } }),
    NORMAL: B.acc(normals, 'VEC3', 5126, { target: 34962 }),
    TEXCOORD_0: B.acc(tex.uv, 'VEC2', 5126, { target: 34962 }),
    JOINTS_0: B.acc(joints.data, 'VEC4', joints.a.componentType, { target: 34962 }),
    WEIGHTS_0: B.acc(w8, 'VEC4', 5121, { target: 34962, extra: { normalized: true } })
  };
  const idxA = pos.a.count < 65536 ? B.acc(Uint16Array.from(index), 'SCALAR', 5123, { target: 34963 }) : B.acc(Uint32Array.from(index), 'SCALAR', 5125, { target: 34963 });
  J.meshes = [{ name: 'person', primitives: [{ attributes: attrs, indices: idxA, material: 0 }] }];
  const ibm = accessor(A, A.json.skins[0].inverseBindMatrices);
  J.skins = [Object.assign({}, A.json.skins[0], { inverseBindMatrices: B.acc(ibm.data, 'MAT4', 5126) })];
  J.images = [{ bufferView: B.view(jpg), mimeType: 'image/jpeg' }];
  J.samplers = [{ magFilter: 9729, minFilter: 9987, wrapS: 33071, wrapT: 33071 }];
  J.textures = [{ source: 0, sampler: 0 }];
  J.materials = [{ name: 'person', pbrMetallicRoughness: { baseColorTexture: { index: 0 }, metallicFactor: 0, roughnessFactor: 0.85 }, doubleSided: true }];

  const target = { g: A, rig: rigOf(A) };
  const anims = [], from = {};
  let walkV = 0;
  animFiles.concat(EXTRA).filter((f) => fs.existsSync(f)).forEach((f) => {
    const g = f === meshFile ? A : readGlb(f);
    const S = g === A ? target : { g, rig: rigOf(g) };
    (g.json.animations || []).forEach((an) => {
      const name = clipName(an.name);
      if (!name || anims.some((x) => x.name === name)) return;
      const r = retarget(B, target, S, an, name);
      anims.push(r.anim);
      from[name] = path.basename(f, '.glb');
      if (name === 'walk') walkV = r.walkV;
    });
  });
  J.animations = anims;
  const glb = B.finish();
  const entry = { glb: glb.toString('base64'), clips: anims.map((a) => a.name), walkV: +walkV.toFixed(3) };
  fs.writeFileSync(path.join(OUT, `p${i}.js`), '// 업무방 현황판 3D 사람 ' + i + ' (' + (note || 'Meshy 로 만든 캐릭터') + ', tools/build-people.js 로 변환)\n' +
    'window.__WR_PEOPLE__ = window.__WR_PEOPLE__ || {};\nwindow.__WR_PEOPLE__[' + i + '] = ' + JSON.stringify(entry) + ';\n');
  if (process.env.WR_DEBUG) fs.writeFileSync(path.join(OUT, `debug-tex${i}.jpg`), jpg);
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(`p${i}: glb ${(glb.length / 1024).toFixed(0)}KB (텍스처 ${(jpg.length / 1024).toFixed(0)}KB, ${tex.note}), walkV ${entry.walkV}, ` +
    Object.keys(from).map((k) => `${k}←${from[k]}`).join(' '));
}

fs.mkdirSync(OUT, { recursive: true });
if (SRC === '--borrow') {
  // 다른 뼈대의 동작을 붙인다: node build-people.js --borrow <출력 폴더> <번호> <리깅 모델.glb> <동작 파일.glb>...
  const i = Number(process.argv[4]);
  build(i, process.argv[5], process.argv.slice(6), '다른 캐릭터 동작을 옮겨 붙임');
} else {
  const ids = fs.readdirSync(SRC).map((f) => /^a(\d+)\.glb$/.exec(f)).filter(Boolean).map((m) => Number(m[1])).sort((a, b) => a - b);
  const only = process.argv.slice(4).map(Number);
  ids.filter((i) => !only.length || only.includes(i)).forEach((i) => build(i, path.join(SRC, `a${i}.glb`), [path.join(SRC, `a${i}.glb`), path.join(SRC, `t${i}.glb`)]));
}
