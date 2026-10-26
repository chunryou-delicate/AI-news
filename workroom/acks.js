'use strict';
// 확인할 일 '확인'을 컴퓨터·기기 사이에 맞춘다.
// - acks.json: 이 컴퓨터 현황판(PC·폰)에서 누른 것. { 키: { on: 확인했는지, at: 누른 시각 } }
//   키 = '세션id|그 상태가 시작된 시각' (회의 의견 대기는 'mt:의장 세션id|갱신 시각') — 상태가 바뀌면 키도 바뀌어 다시 뜬다.
// - 다른 컴퓨터 것은 sync.js 가 그 컴퓨터 브랜치의 acks.json 을 remote/<키>/acks.json 으로 받아 둔다.
// - 합칠 때는 키마다 나중에 누른 것이 이긴다 (어디서든 '되살리기'하면 다시 뜬다). 사흘 지난 것은 지운다.
// 서버(server.js)는 지시를 보내면 그 세션의 지금 키를 확인한 것으로 적는다 (답했으면 다른 데서도 사라지게).
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const FILE = path.join(ROOT, 'acks.json');
const REMOTE_DIR = path.join(ROOT, 'remote');
const KEEP = 3 * 24 * 3600 * 1000;

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { return fallback; }
}
function writeAtomic(file, content) {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, content, 'utf8');
  try { fs.renameSync(tmp, file); } catch (_) { fs.writeFileSync(file, content, 'utf8'); try { fs.unlinkSync(tmp); } catch (__) {} }
}
function own() {
  const d = readJson(FILE, {});
  return d && typeof d === 'object' && !Array.isArray(d) ? d : {};
}
// keys 를 확인함(on=true) 또는 되살림(on=false)으로 적는다
function set(keys, on) {
  const d = own(), now = Date.now();
  for (const k of keys || []) if (typeof k === 'string' && k && k.length < 200) d[k] = { on: !!on, at: now };
  for (const k of Object.keys(d)) if (now - (d[k].at || 0) > KEEP) delete d[k];
  writeAtomic(FILE, JSON.stringify(d));
  return d;
}
// 이 컴퓨터와 다른 컴퓨터 것을 합쳐 지금 확인된 키만: { 키: 누른 시각 }
function merged() {
  const maps = [own()];
  let dirs = [];
  try { dirs = fs.readdirSync(REMOTE_DIR); } catch (_) {}
  for (const d of dirs) {
    const m = readJson(path.join(REMOTE_DIR, d, 'acks.json'), null);
    if (m && typeof m === 'object') maps.push(m);
  }
  const best = {}, now = Date.now();
  for (const m of maps) {
    for (const k of Object.keys(m)) {
      const v = m[k];
      if (!v || typeof v.at !== 'number' || now - v.at > KEEP) continue;
      if (!best[k] || v.at > best[k].at) best[k] = v;
    }
  }
  const out = {};
  for (const k of Object.keys(best)) if (best[k].on) out[k] = best[k].at;
  return out;
}
// 그 세션이 지금 기다리는 것(상태가 시작된 시각)을 확인한 것으로 — 지시를 보냈을 때
function markSession(state, sid) {
  const s = ((state && state.sessions) || []).find((x) => x.id === sid);
  if (!s) return;
  set([`${s.id}|${s.stateSince || 0}`], true);
}

module.exports = { FILE, own, set, merged, markSession };
