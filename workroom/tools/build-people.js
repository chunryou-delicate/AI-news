'use strict';
// Meshy 에서 뽑은 사람 캐릭터(GLB)를 현황판 3D 화면용으로 줄인다.
// 사용법: node build-people.js <원본 폴더> <출력 폴더>
//   원본 폴더: a<번호>.glb (동작 10개 묶음), t<번호>.glb (타자 동작, 같은 뼈대)
//   출력: p<번호>.js  → window.__WR_PEOPLE__[번호] = { glb, clips } (file:// 에서도 script 태그로 읽힌다)
// 하는 일:
//   - 텍스처를 1024 로 줄인다. 줄이기 전에 UV 조각 바깥 여백을 조각 가장자리 색으로 채워서
//     멀리서 볼 때(밉맵) 조각 경계가 선으로 비치지 않게 한다.
//   - 동작은 회전은 모든 뼈, 위치는 엉덩이(Hips)만 남기고 15fps 로 줄인다. 회전은 16비트로 줄인다.
//   - 타자 동작(t<번호>.glb)을 같은 파일에 합친다 (뼈 이름으로 맞춘다).
// 필요: ffmpeg
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const SRC = process.argv[2];
const OUT = process.argv[3];
const TEX = 1024;          // 최종 텍스처 크기
const PAD = 24;            // 여백 채우기 (원본 텍셀 기준)
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
  return { json, bin: buf.slice(binStart + 8, binStart + 8 + binLen) };
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
    return { data: out, n, a };
  }
  for (let k = 0; k < a.count; k++) out.set(new T(g.bin.buffer.slice(base + k * stride, base + k * stride + n * size)), k * n);
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

// ---------- 텍스처: 여백 채우고 줄이기 ----------
function ffmpeg(args) { execFileSync('ffmpeg', ['-y', '-loglevel', 'error'].concat(args), { stdio: ['ignore', 'ignore', 'inherit'] }); }
function probeSize(file) {
  const out = execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', file], { encoding: 'utf8' });
  const [w, h] = out.trim().split(',').map(Number);
  return { w, h };
}
// UV 삼각형이 덮는 텍셀 표시
function coverage(uv, idx, W, H) {
  const cov = new Uint8Array(W * H);
  for (let t = 0; t < idx.length / 3; t++) {
    const i0 = idx[t * 3], i1 = idx[t * 3 + 1], i2 = idx[t * 3 + 2];
    const x0 = uv[i0 * 2] * W, y0 = uv[i0 * 2 + 1] * H, x1 = uv[i1 * 2] * W, y1 = uv[i1 * 2 + 1] * H, x2 = uv[i2 * 2] * W, y2 = uv[i2 * 2 + 1] * H;
    const minX = Math.max(0, Math.floor(Math.min(x0, x1, x2)) - 1), maxX = Math.min(W - 1, Math.ceil(Math.max(x0, x1, x2)) + 1);
    const minY = Math.max(0, Math.floor(Math.min(y0, y1, y2)) - 1), maxY = Math.min(H - 1, Math.ceil(Math.max(y0, y1, y2)) + 1);
    const area = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0);
    if (Math.abs(area) < 1e-9) continue;
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const px = x + 0.5, py = y + 0.5;
        const w0 = ((x1 - px) * (y2 - py) - (x2 - px) * (y1 - py)) / area;
        const w1 = ((x2 - px) * (y0 - py) - (x0 - px) * (y2 - py)) / area;
        const w2 = 1 - w0 - w1;
        if (w0 >= -0.05 && w1 >= -0.05 && w2 >= -0.05) cov[y * W + x] = 1;
      }
    }
  }
  return cov;
}
// 덮이지 않은 텍셀을 이웃한 덮인 텍셀의 평균색으로 PAD 번 넓혀 채운다
function dilate(rgb, cov, W, H) {
  let frontier = [];
  for (let k = 0; k < W * H; k++) if (!cov[k]) frontier.push(k);
  for (let it = 0; it < PAD && frontier.length; it++) {
    const fill = [], rest = [];
    for (const k of frontier) {
      const x = k % W, y = (k - x) / W;
      let r = 0, g = 0, b = 0, n = 0;
      if (x > 0 && cov[k - 1]) { r += rgb[(k - 1) * 3]; g += rgb[(k - 1) * 3 + 1]; b += rgb[(k - 1) * 3 + 2]; n++; }
      if (x < W - 1 && cov[k + 1]) { r += rgb[(k + 1) * 3]; g += rgb[(k + 1) * 3 + 1]; b += rgb[(k + 1) * 3 + 2]; n++; }
      if (y > 0 && cov[k - W]) { r += rgb[(k - W) * 3]; g += rgb[(k - W) * 3 + 1]; b += rgb[(k - W) * 3 + 2]; n++; }
      if (y < H - 1 && cov[k + W]) { r += rgb[(k + W) * 3]; g += rgb[(k + W) * 3 + 1]; b += rgb[(k + W) * 3 + 2]; n++; }
      if (n) fill.push([k, r / n, g / n, b / n]); else rest.push(k);
    }
    for (const [k, r, g, b] of fill) { rgb[k * 3] = r; rgb[k * 3 + 1] = g; rgb[k * 3 + 2] = b; cov[k] = 1; }
    frontier = rest;
  }
}
function texture(g, uv, idx, tmp) {
  const im = g.json.images[0], bv = g.json.bufferViews[im.bufferView];
  const src = path.join(tmp, 'tex_src' + (im.mimeType === 'image/png' ? '.png' : '.jpg'));
  fs.writeFileSync(src, g.bin.slice(bv.byteOffset || 0, (bv.byteOffset || 0) + bv.byteLength));
  const { w, h } = probeSize(src);
  const raw = path.join(tmp, 'tex.raw'), jpg = path.join(tmp, 'tex.jpg');
  ffmpeg(['-i', src, '-f', 'rawvideo', '-pix_fmt', 'rgb24', raw]);
  const rgb = fs.readFileSync(raw);
  dilate(rgb, coverage(uv, idx, w, h), w, h);
  fs.writeFileSync(raw, rgb);
  ffmpeg(['-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', `${w}x${h}`, '-i', raw, '-vf', `scale=${TEX}:${TEX}:flags=lanczos`, '-q:v', '3', jpg]);
  return fs.readFileSync(jpg);
}

// ---------- 동작 ----------
function clipName(n) {
  for (const [re, key] of CLIP_NAMES) if (re.test(n)) return key;
  return n;
}
// hipsScale: 다른 캐릭터의 동작을 빌려 쓸 때 다리 길이가 달라서 엉덩이 위치를 그 비율로 늘이고 줄인다
function addAnimations(B, src, nodeMap, out, hipsScale) {
  hipsScale = hipsScale || 1;
  (src.json.animations || []).forEach((an) => {
    const name = clipName(an.name);
    if (out.some((x) => x.name === name)) return;
    const samplers = [], channels = [], timeCache = new Map();
    an.channels.forEach((ch) => {
      const node = src.json.nodes[ch.target.node];
      const dst = nodeMap(node.name);
      if (dst == null) return;
      if (ch.target.path === 'scale') return;
      if (ch.target.path === 'translation' && node.name !== 'Hips') return;
      const s = an.samplers[ch.sampler];
      const times = accessor(src, s.input).data, vals = accessor(src, s.output);
      const keep = [];
      for (let k = 0; k < times.length; k++) if (k % 2 === 0 || k === times.length - 1) keep.push(k);
      const t2 = new Float32Array(keep.map((k) => times[k]));
      const tk = t2.length + ':' + t2[0] + ':' + t2[t2.length - 1];
      let ti = timeCache.get(tk);
      if (ti == null) {
        ti = B.acc(t2, 'SCALAR', 5126, { extra: { min: [t2[0]], max: [t2[t2.length - 1]] } });
        timeCache.set(tk, ti);
      }
      let oi;
      if (ch.target.path === 'rotation') {
        const q = new Int16Array(keep.length * 4);
        keep.forEach((k, j) => { for (let c = 0; c < 4; c++) q[j * 4 + c] = Math.round(Math.max(-1, Math.min(1, vals.data[k * 4 + c])) * 32767); });
        oi = B.acc(q, 'VEC4', 5122, { extra: { normalized: true } });
      } else {
        const v = new Float32Array(keep.length * 3);
        keep.forEach((k, j) => { for (let c = 0; c < 3; c++) v[j * 3 + c] = vals.data[k * 3 + c] * hipsScale; });
        oi = B.acc(v, 'VEC3', 5126);
      }
      samplers.push({ input: ti, output: oi, interpolation: s.interpolation || 'LINEAR' });
      channels.push({ sampler: samplers.length - 1, target: { node: dst, path: ch.target.path } });
    });
    out.push({ name, samplers, channels });
  });
}

// i: 출력 번호, meshFile: 메시·뼈대를 가져올 GLB, animFiles: 동작을 가져올 GLB 들 (뼈 이름으로 맞춘다)
function build(i, meshFile, animFiles, note) {
  const A = readGlb(meshFile);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wrp-'));
  const prim = A.json.meshes[0].primitives[0];
  const pos = accessor(A, prim.attributes.POSITION), nor = accessor(A, prim.attributes.NORMAL), uv = accessor(A, prim.attributes.TEXCOORD_0);
  const joints = accessor(A, prim.attributes.JOINTS_0), weights = accessor(A, prim.attributes.WEIGHTS_0);
  const index = accessor(A, prim.indices).data;
  const jpg = texture(A, uv.data, index, tmp);

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
    NORMAL: B.acc(nor.data, 'VEC3', 5126, { target: 34962 }),
    TEXCOORD_0: B.acc(uv.data, 'VEC2', 5126, { target: 34962 }),
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
  const anims = [];
  const byName = (n) => { const k = A.json.nodes.findIndex((x) => x.name === n); return k < 0 ? null : k; };
  const hipsY = (g) => { const h = g.json.nodes.find((x) => x.name === 'Hips'); return h && h.translation ? h.translation[1] : 0; };
  animFiles.concat(EXTRA).filter((f) => fs.existsSync(f)).forEach((f) => {
    const S = f === meshFile ? A : readGlb(f);
    const scale = S === A || !hipsY(S) ? 1 : hipsY(A) / hipsY(S);
    addAnimations(B, S, byName, anims, scale);
  });
  J.animations = anims;
  const glb = B.finish();
  const entry = { glb: glb.toString('base64'), clips: anims.map((a) => a.name) };
  fs.writeFileSync(path.join(OUT, `p${i}.js`), '// 업무방 현황판 3D 사람 ' + i + ' (' + (note || 'Meshy 로 만든 캐릭터') + ', tools/build-people.js 로 변환)\n' +
    'window.__WR_PEOPLE__ = window.__WR_PEOPLE__ || {};\nwindow.__WR_PEOPLE__[' + i + '] = ' + JSON.stringify(entry) + ';\n');
  if (process.env.WR_DEBUG) fs.writeFileSync(path.join(OUT, `debug-tex${i}.jpg`), jpg);
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(`p${i}: glb ${(glb.length / 1024).toFixed(0)}KB (텍스처 ${(jpg.length / 1024).toFixed(0)}KB), clips ${entry.clips.join(',')}`);
}

fs.mkdirSync(OUT, { recursive: true });
if (SRC === '--borrow') {
  // 동작 없는 리깅 모델에 다른 캐릭터의 동작을 붙인다:
  //   node build-people.js --borrow <출력 폴더> <번호> <리깅 모델.glb> <동작 묶음.glb> [타자.glb]
  const i = Number(process.argv[4]);
  build(i, process.argv[5], process.argv.slice(6), '다른 캐릭터 동작을 빌려 붙임');
} else {
  const ids = fs.readdirSync(SRC).map((f) => /^a(\d+)\.glb$/.exec(f)).filter(Boolean).map((m) => Number(m[1])).sort((a, b) => a - b);
  const only = process.argv.slice(4).map(Number);
  ids.filter((i) => !only.length || only.includes(i)).forEach((i) => build(i, path.join(SRC, `a${i}.glb`), [path.join(SRC, `a${i}.glb`), path.join(SRC, `t${i}.glb`)]));
}
