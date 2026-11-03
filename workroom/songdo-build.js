'use strict';
// 3D 사무실 '도시' 배경용 송도 지도(city-songdo.js)를 OpenStreetMap 자료로 만든다.
// 포스코이앤씨 송도사옥(인천타워대로 241, 쌍둥이 39층) 둘레 약 1.8km 의 건물·도로·물·공원과 해안선.
// 사용법: node songdo-build.js --fetch <자료 폴더>   Overpass 에서 받아 그 폴더에 두고 만든다
//         node songdo-build.js <자료 폴더>           이미 받아 둔 b.json·r.json·w.json·g.json·rel.json 으로 만든다
// 만든 파일은 같은 폴더(workroom)의 city-songdo.js. 지도 자료 © OpenStreetMap contributors, ODbL 1.0.
const fs = require('fs');
const path = require('path');
const https = require('https');

const LAT0 = 37.3922213, LON0 = 126.6341187;     // OSM '포스코건설 송도사옥' 저층부
const KX = 111320 * Math.cos(LAT0 * Math.PI / 180), KZ = 110574;
const ROT = -62 * Math.PI / 180;                  // 인천타워대로(사옥 정면)가 화면 가로와 나란하게 돌린다
const US = 377648832, TWIN = 377648833, PODIUM = 316290866;   // 서쪽 동(사무실이 있는 동), 동쪽 동, 저층부
const BB = '37.3760,126.6137,37.4084,126.6545';   // 건물·도로·공원 (사옥에서 동서 1.8km, 남북 1.6km)
const WB = '37.3550,126.5900,37.4250,126.6800';   // 물·해안선 (더 넓게)
const SEA_R = 2800, SEA_CELL = 20;                // 바다 칸 지도: 반경, 칸 크기(m)
const OUT = path.join(__dirname, 'city-songdo.js');

const QUERIES = {
  'b.json': `[out:json][timeout:110];(way["building"](${BB});relation["building"](${BB}););out geom tags;`,
  'r.json': `[out:json][timeout:110];way["highway"~"^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|motorway_link|trunk_link|primary_link|secondary_link|pedestrian)$"](${BB});out geom tags;`,
  'w.json': `[out:json][timeout:140];(way["natural"~"^(water|coastline|wetland|beach|bay)$"](${WB});relation["natural"~"^(water|bay)$"](${WB});way["landuse"="reservoir"](${WB}););out geom tags;`,
  'g.json': `[out:json][timeout:140];(way["leisure"~"^(park|golf_course|pitch|garden|playground)$"](${BB});relation["leisure"~"^(park|golf_course)$"](${BB});way["landuse"~"^(grass|forest|construction|meadow|recreation_ground|brownfield|greenfield)$"](${BB});relation["landuse"~"^(grass|forest|construction)$"](${BB}););out geom tags;`,
};
const ENDPOINTS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter', 'https://overpass.private.coffee/api/interpreter'];

function post(url, q) {
  return new Promise((resolve) => {
    const body = 'data=' + encodeURIComponent(q);
    const req = https.request(url, { method: 'POST', timeout: 160000, headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body), 'User-Agent': 'workroom-dashboard songdo-build' } }, (res) => {
      let s = ''; res.setEncoding('utf8'); res.on('data', (d) => { s += d; }); res.on('end', () => resolve(s));
    });
    req.on('error', () => resolve('')); req.on('timeout', () => { req.destroy(); resolve(''); });
    req.end(body);
  });
}
async function fetchAll(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const get = async (file, q) => {
    for (const ep of ENDPOINTS) {
      const s = await post(ep, q);
      if (s.trim().startsWith('{')) { fs.writeFileSync(path.join(dir, file), s); console.log('받음', file, s.length); return; }
      console.log('실패', file, ep);
    }
    throw new Error(file + ' 를 받지 못했어요 (Overpass 서버가 바쁨, 잠시 뒤 다시)');
  };
  for (const [f, q] of Object.entries(QUERIES)) await get(f, q);
  // 관계(여러 조각 건물·호수·공원)는 'out geom tags' 로는 조각 모양이 빠져서 번호로 다시 받는다
  const ids = new Set();
  for (const f of ['b.json', 'w.json', 'g.json']) for (const e of load(dir, f)) if (e.type === 'relation') ids.add(e.id);
  if (ids.size) await get('rel.json', `[out:json][timeout:140];(${[...ids].map((i) => `relation(${i});`).join('')});out geom;`);
  else fs.writeFileSync(path.join(dir, 'rel.json'), '{"elements":[]}');
}
function load(dir, f) { return JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')).elements || []; }

// ---- 좌표: 위경도 → 사옥 기준 미터(x 동, z 남) → 돌림 → 서쪽 동 한가운데가 (0,0)
const proj = (p) => { const x = (p.lon - LON0) * KX, z = -(p.lat - LAT0) * KZ; return [x * Math.cos(ROT) - z * Math.sin(ROT), x * Math.sin(ROT) + z * Math.cos(ROT)]; };
let OX = 0, OZ = 0;
const T = (p) => { const q = proj(p); return [q[0] - OX, q[1] - OZ]; };

function areaOf(r) { let a = 0; for (let i = 0; i < r.length; i++) { const p = r[i], q = r[(i + 1) % r.length]; a += p[0] * q[1] - q[0] * p[1]; } return a / 2; }
function simplify(pts, tol) {   // 더글러스-포이커
  if (pts.length < 4) return pts;
  const keep = new Array(pts.length).fill(false); keep[0] = keep[pts.length - 1] = true;
  const st = [[0, pts.length - 1]];
  while (st.length) {
    const [a, b] = st.pop(); let md = 0, mi = -1;
    const [ax, az] = pts[a], [bx, bz] = pts[b], L = Math.hypot(bx - ax, bz - az) || 1e-9;
    for (let i = a + 1; i < b; i++) { const d = Math.abs((bx - ax) * (az - pts[i][1]) - (ax - pts[i][0]) * (bz - az)) / L; if (d > md) { md = d; mi = i; } }
    if (md > tol) { keep[mi] = true; st.push([a, mi], [mi, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}
// 닫힌 고리: 끝점 빼고, 줄이고, 바깥은 시계 반대(넓이<0), 구멍은 반대로
function ring(pts, tol, hole) {
  let r = pts.slice();
  if (r.length > 1 && Math.hypot(r[0][0] - r[r.length - 1][0], r[0][1] - r[r.length - 1][1]) < 0.01) r.pop();
  if (r.length < 3) return null;
  // 시작점과 가장 먼 점에서 둘로 나눠 줄인다 (닫힌 고리를 한 번에 넣으면 양 끝이 같아 다 지워진다)
  let k = 0, kd = -1;
  r.forEach((p, i) => { const d = Math.hypot(p[0] - r[0][0], p[1] - r[0][1]); if (d > kd) { kd = d; k = i; } });
  r = simplify(r.slice(0, k + 1), tol).concat(simplify(r.slice(k).concat([r[0]]), tol).slice(1, -1));
  if (r.length < 3) return null;
  if ((areaOf(r) < 0) === !!hole) r.reverse();
  return r;
}
// 여러 조각(way)으로 된 관계의 고리를 끝점끼리 이어 붙인다
function assemble(parts) {
  const segs = parts.map((p) => p.slice()), out = [];
  const eq = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]) < 0.05;
  while (segs.length) {
    let cur = segs.shift();
    for (let guard = 0; guard < 500 && !eq(cur[0], cur[cur.length - 1]); guard++) {
      const i = segs.findIndex((s) => eq(s[0], cur[cur.length - 1]) || eq(s[s.length - 1], cur[cur.length - 1]));
      if (i < 0) break;
      let s = segs.splice(i, 1)[0];
      if (!eq(s[0], cur[cur.length - 1])) s = s.reverse();
      cur = cur.concat(s.slice(1));
    }
    if (cur.length >= 4) out.push(cur);
  }
  return out;
}
function polysOf(e, relById) {
  if (e.type === 'way') return e.geometry ? [{ outer: e.geometry.map(T), inner: [] }] : [];
  const r = relById[e.id];
  if (!r) return [];
  const ms = (r.members || []).filter((m) => m.type === 'way' && m.geometry);
  const outers = assemble(ms.filter((m) => m.role !== 'inner').map((m) => m.geometry.map(T)));
  const inners = assemble(ms.filter((m) => m.role === 'inner').map((m) => m.geometry.map(T)));
  return outers.map((o) => ({ outer: o, inner: inners.filter((h) => inside(h[0], o)) }));
}
function inside(p, r) {
  let c = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const a = r[i], b = r[j];
    if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1]) + a[0]) c = !c;
  }
  return c;
}
const flat = (r) => { const o = []; r.forEach((p) => o.push(Math.round(p[0] * 10) / 10, Math.round(p[1] * 10) / 10)); return o; };

// 건물 높이: height → 층수 → 종류·넓이로 어림
function heightOf(t, area) {
  const h = parseFloat(t.height);
  if (h > 0) return h;
  const lv = parseFloat(t['building:levels']);
  const per = t.building === 'apartments' ? 2.9 : /commercial|office|hotel/.test(t.building) ? 4 : 3.5;
  if (lv > 0) return lv * per;
  if (t.building === 'apartments') return area > 600 ? 45 : 12;
  if (/commercial|office|hotel|retail/.test(t.building)) return area > 3000 ? 20 : 12;
  if (/school|university|hospital|public/.test(t.building)) return 16;
  if (/industrial|warehouse/.test(t.building)) return 10;
  return area > 2000 ? 15 : 8;
}
// 외벽 모양: 0 유리 타워, 1 사무 빌딩, 2 아파트, 3 저층
function kindOf(t, h, id) {
  const b = t.building;
  if (b === 'apartments') return h >= 130 ? 0 : h < 16 ? 3 : 2;
  if (/industrial|warehouse/.test(b)) return 3;
  if (/school|university|kindergarten|hospital|church|public/.test(b)) return h >= 16 ? 1 : 3;
  if (h >= 35) return id % 5 < 3 ? 0 : 1;
  return h >= 16 ? 1 : 3;
}

function build(dir) {
  const B = load(dir, 'b.json'), R = load(dir, 'r.json'), Wt = load(dir, 'w.json'), G = load(dir, 'g.json'), REL = load(dir, 'rel.json');
  const relById = {}; REL.forEach((e) => { relById[e.id] = e; });
  // (0,0) 을 서쪽 동 한가운데로
  const us = B.find((e) => e.id === US);
  if (!us) throw new Error('사옥 서쪽 동(way ' + US + ')이 자료에 없어요');
  const ur = us.geometry.map(proj), ux = ur.map((p) => p[0]), uz = ur.map((p) => p[1]);
  OX = (Math.min(...ux) + Math.max(...ux)) / 2; OZ = (Math.min(...uz) + Math.max(...uz)) / 2;
  const bbox = (r) => { const xs = r.map((p) => p[0]), zs = r.map((p) => p[1]); return [Math.min(...xs), Math.min(...zs), Math.max(...xs), Math.max(...zs)].map((v) => Math.round(v * 10) / 10); };

  const out = { v: 1, credit: '지도 © OpenStreetMap', us: bbox(us.geometry.map(T)), twin: null, b: [], r: [], w: [], g: [], mud: [], far: [], sea: null };
  // ---- 건물: [모양, 높이, 표시, 바깥고리, 구멍...]  표시 1 쌍둥이 동, 2 저층부, 4 트라이볼(그릇 모양)
  let nb = 0;
  for (const e of B) {
    if (e.id === US || !e.tags || /^(construction|roof)$/.test(e.tags.building)) continue;
    for (const pg of polysOf(e, relById)) {
      const o = ring(pg.outer, 0.6, false);
      if (!o) continue;
      const a = Math.abs(areaOf(o));
      if (a < 12) continue;
      const t = e.tags, h = heightOf(t, a);
      let flag = e.id === TWIN ? 1 : e.id === PODIUM ? 2 : t.name === '트라이볼' ? 4 : 0;
      const row = [kindOf(t, h, e.id), Math.round(h * 10) / 10, flag, flat(o)];
      pg.inner.forEach((hr) => { const r = ring(hr, 0.6, true); if (r) row.push(flat(r)); });
      out.b.push(row); nb++;
      if (flag === 1) out.twin = bbox(o);
    }
  }
  // ---- 도로: [등급, 일방, 다리, 좌표]  등급 0 고속·간선, 1 주간선, 2 보조간선, 3 집산, 4 생활·연결, 5 보행
  const CLS = { motorway: 0, trunk: 0, primary: 1, secondary: 2, tertiary: 3, unclassified: 4, residential: 4, motorway_link: 4, trunk_link: 4, primary_link: 4, secondary_link: 4, pedestrian: 5 };
  for (const e of R) {
    if (!e.geometry || CLS[e.tags.highway] == null) continue;
    const pts = simplify(e.geometry.map(T), 1.2);
    if (pts.length < 2) continue;
    out.r.push([CLS[e.tags.highway], e.tags.oneway === 'yes' || /motorway/.test(e.tags.highway) ? 1 : 0, e.tags.bridge === 'yes' ? 1 : 0, flat(pts)]);
  }
  // ---- 물(호수·운하·유수지)과 갯벌, 해안선
  const coast = [];
  for (const e of Wt) {
    const t = e.tags || {};
    if (t.natural === 'coastline') { if (e.geometry) coast.push(e.geometry.map(T)); continue; }
    const isW = t.natural === 'water' || t.landuse === 'reservoir' || t.natural === 'bay';
    if (!isW && t.natural !== 'wetland') continue;
    for (const pg of polysOf(e, relById)) {
      const o = ring(pg.outer, 1.5, false);
      if (!o || Math.abs(areaOf(o)) < 300) continue;
      const row = [flat(o)];
      pg.inner.forEach((hr) => { const r = ring(hr, 1.5, true); if (r) row.push(flat(r)); });
      (isW ? out.w : out.mud).push(row);
    }
  }
  // ---- 녹지: [종류, 바깥고리, 구멍...]  0 공원·잔디, 1 골프장, 2 숲, 3 운동장, 4 빈 땅(공사장)
  const GK = (t) => t.leisure === 'golf_course' ? 1 : t.landuse === 'forest' ? 2 : t.leisure === 'pitch' ? 3 : /construction|brownfield|greenfield/.test(t.landuse || '') ? 4 : 0;
  for (const e of G) {
    for (const pg of polysOf(e, relById)) {
      const o = ring(pg.outer, 1.5, false);
      if (!o || Math.abs(areaOf(o)) < 150) continue;
      const row = [GK(e.tags || {}), flat(o)];
      pg.inner.forEach((hr) => { const r = ring(hr, 1.5, true); if (r) row.push(flat(r)); });
      out.g.push(row);
    }
  }
  out.g.sort((a, b) => (a[0] === 4 ? -1 : 0) - (b[0] === 4 ? -1 : 0));   // 공사장 먼저, 공원은 그 위에

  // ---- 바다 칸 지도: 해안선 칸으로 땅을 덩어리로 나누고, 덩어리마다 해안선 양쪽 표시로 바다인지 정한다.
  // OSM 해안선은 가는 쪽 왼쪽이 땅, 오른쪽이 바다. 송도와 본토 사이 물길처럼 해안선이 범위 밖으로 끊긴 곳이 있어서
  // 한 덩어리에 바다·땅 표시가 섞이면 많은 쪽을 따르고, 사옥이 있는 덩어리는 늘 땅으로 둔다.
  const N = Math.round(2 * SEA_R / SEA_CELL), grid = new Uint8Array(N * N);   // 0 땅, 1 해안선, 2 바다
  const cell = (x, z) => [Math.floor((x + SEA_R) / SEA_CELL), Math.floor((z + SEA_R) / SEA_CELL)];
  const marks = [];   // [칸 x, 칸 z, +1 바다 쪽 / -1 땅 쪽]
  for (const c of coast) {
    for (let i = 0; i + 1 < c.length; i++) {
      const a = c[i], b = c[i + 1], L = Math.hypot(b[0] - a[0], b[1] - a[1]), n = Math.max(1, Math.ceil(L / (SEA_CELL / 3)));
      for (let k = 0; k <= n; k++) { const [gx, gz] = cell(a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n); if (gx >= 0 && gz >= 0 && gx < N && gz < N) grid[gz * N + gx] = 1; }
      if (L > 1) {
        const mx = (a[0] + b[0]) / 2, mz = (a[1] + b[1]) / 2, rx = -(b[1] - a[1]) / L, rz = (b[0] - a[0]) / L, o = SEA_CELL * 1.6;
        marks.push(cell(mx + rx * o, mz + rz * o).concat(L), cell(mx - rx * o, mz - rz * o).concat(-L));
      }
    }
  }
  const comp = new Int32Array(N * N).fill(-1), votes = [];
  for (let s = 0; s < N * N; s++) {
    if (grid[s] !== 0 || comp[s] >= 0) continue;
    const id = votes.length, st = [s]; votes.push(0); comp[s] = id;
    while (st.length) {
      const i = st.pop(), gx = i % N, gz = (i - gx) / N;
      [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(([dx, dz]) => { const x = gx + dx, z = gz + dz, j = z * N + x; if (x >= 0 && z >= 0 && x < N && z < N && grid[j] === 0 && comp[j] < 0) { comp[j] = id; st.push(j); } });
    }
  }
  marks.forEach(([gx, gz, w]) => { if (gx >= 0 && gz >= 0 && gx < N && gz < N && comp[gz * N + gx] >= 0) votes[comp[gz * N + gx]] += w; });
  const [c0x, c0z] = cell(0, 0), home = comp[c0z * N + c0x];
  for (let i = 0; i < N * N; i++) if (grid[i] === 0 && comp[i] !== home && votes[comp[i]] > 0) grid[i] = 2;
  for (let i = 0; i < N * N; i++) {   // 해안선 칸은 이웃 바다가 둘 넘으면 바다
    if (grid[i] !== 1) continue;
    const gx = i % N, gz = (i - gx) / N;
    let n = 0; [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(([dx, dz]) => { const x = gx + dx, z = gz + dz; if (x >= 0 && z >= 0 && x < N && z < N && grid[z * N + x] === 2) n++; });
    grid[i] = n >= 2 ? 3 : 0;
  }
  for (let i = 0; i < N * N; i++) if (grid[i] === 3) grid[i] = 2;
  let seaN = 0; for (let i = 0; i < N * N; i++) if (grid[i] === 2) seaN++;
  const okSea = seaN > 0 && seaN < N * N * 0.8;
  if (okSea) {
    const rle = [];
    for (let z = 0; z < N; z++) {
      const row = []; let cur = 0, run = 0;
      for (let x = 0; x < N; x++) { const s = grid[z * N + x] === 2 ? 1 : 0; if (s === cur) run++; else { row.push(run); cur = s; run = 1; } }
      row.push(run); rle.push(row);
    }
    out.sea = { r: SEA_R, n: N, rle };
  } else console.log('바다 칸 지도를 만들지 못해 뺐어요 (해안선 자료가 이상함)');

  // ---- 자료 밖(1.8km 너머) 땅에는 먼 아파트·빌딩 숲: [x, z, 가로, 세로, 높이, 모양]
  let sd = 20261103; const rnd = () => { sd = (sd * 16807) % 2147483647; return sd / 2147483647; };
  const inv = (x, z) => { x += OX; z += OZ; return [x * Math.cos(-ROT) - z * Math.sin(-ROT), x * Math.sin(-ROT) + z * Math.cos(-ROT)]; };   // 돌리기 전(동·남) 미터
  for (let x = -2700; x <= 2700; x += 75) {
    for (let z = -2700; z <= 2700; z += 75) {
      const wx = x + (rnd() - 0.5) * 30, wz = z + (rnd() - 0.5) * 30, d = Math.hypot(wx, wz);
      const [e, s] = inv(wx, wz);
      if (d > 2750 || (Math.abs(e) < 1780 && Math.abs(s) < 1600) || rnd() < 0.35) continue;
      if (out.sea) { const [gx, gz] = cell(wx, wz); if (gx < 0 || gz < 0 || gx >= N || gz >= N || grid[gz * N + gx]) continue; }
      const h = 25 + Math.pow(rnd(), 1.4) * 110;
      out.far.push([Math.round(wx), Math.round(wz), Math.round(18 + rnd() * 26), Math.round(14 + rnd() * 22), Math.round(h), rnd() < 0.6 ? 2 : h > 70 ? 0 : 1]);
    }
  }

  const js = '// 3D 사무실 \'도시\' 배경: 포스코이앤씨 송도사옥 둘레 송도 지도. songdo-build.js 로 만든 파일이라 손으로 고치지 않는다.\n' +
    '// 좌표는 미터, 사옥 서쪽 동 한가운데가 (0,0), 인천타워대로가 x 축과 나란하게 62° 돌렸다 (x 오른쪽, z 앞쪽).\n' +
    '// 지도 자료 © OpenStreetMap contributors, ODbL 1.0 (https://www.openstreetmap.org/copyright)\n' +
    'window.OFFICE3D_CITY = ' + JSON.stringify(out) + ';\n';
  fs.writeFileSync(OUT, js);
  console.log(`만듦: ${path.basename(OUT)} ${Math.round(js.length / 1024)}KB · 건물 ${nb} · 도로 ${out.r.length} · 물 ${out.w.length} · 갯벌 ${out.mud.length} · 녹지 ${out.g.length} · 먼 빌딩 ${out.far.length} · 바다 ${out.sea ? seaN + '칸' : '없음'} · 옆 동 ${out.twin ? 'O' : 'X'}`);
  return { grid, N };
}

module.exports = { build };
if (require.main === module) {
  const args = process.argv.slice(2), doFetch = args.includes('--fetch'), dir = args.filter((a) => a !== '--fetch')[0];
  if (!dir) { console.log('사용법: node songdo-build.js [--fetch] <자료 폴더>'); process.exit(1); }
  (doFetch ? fetchAll(dir) : Promise.resolve()).then(() => build(dir)).catch((e) => { console.error(String(e.message || e)); process.exit(1); });
}
