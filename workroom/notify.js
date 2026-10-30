'use strict';
// 텔레그램 알림 (현황판 서버가 떠 있는 컴퓨터에서만, notify.json 이 있을 때만 돈다).
// - 승인 대기·질문·막힘이 새로 생기면 폰으로 알리고, remindMin(기본 20)분 지나도 그대로면 한 번 더 알린다.
//   처음 켰을 때 이미 있던 것과 6시간 넘은 것은 알리지 않는다.
// - 알림의 빠른 답 단추, 또는 알림에 '답장'으로 쓴 말은 그 세션에 지시로 넣는다. '상태' 라고 보내면 지금 기다리는 것 목록.
//   설정한 대화방(chatId)에서 온 것만 받는다.
// 설정: notify.json (이 컴퓨터에만 두고 커밋하지 않는다)
//   { "telegram": { "token": "<BotFather 가 준 토큰>", "chatId": "" }, "remindMin": 20, "withText": true }
// 처음 한 번: 봇에게 아무 말이나 보낸 뒤  node notify.js --find-chat   (대화방 번호를 찾아 notify.json 에 적는다)
//            node notify.js --test        (시험 알림)
// 토큰은 화면·기록(error.log)에 남기지 않는다.
const fs = require('fs');
const path = require('path');
const https = require('https');

const ROOT = __dirname;
const CFG_FILE = path.join(ROOT, 'notify.json');
const STATE_FILE = path.join(ROOT, 'notify-state.json');
const ERROR_LOG = path.join(ROOT, 'error.log');
const MAX_AGE = 6 * 3600 * 1000;
const CAT = { approval: '✋ 승인 대기', question: '❓ 질문', error: '⛔ 막힘', denied: '✋ 승인 대기 (auto mode가 막음)' };
const QUICK = {
  approval: ['응 진행해', '아니, 하지 마'],
  question: ['알아서 판단해서 해'],
  error: ['다시 해 봐'],
  denied: ['승인: 다시 해 줘', '그건 하지 마'],
};
// auto mode 가 막은 것은 무엇을 승인하는지 그대로 적어 보낸다 (현황판 qrTexts 와 같은 말)
function deniedReplies(what) {
  return [`박사님 승인: 방금 auto mode가 막은 「${what}」 해도 됩니다. 그대로 다시 해 주세요.`, `방금 auto mode가 막은 「${what}」는 하지 마세요. 다른 방법이 있으면 알려 주세요.`];
}

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { return fallback; }
}
function writeAtomic(file, content) {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, content, 'utf8');
  try { fs.renameSync(tmp, file); } catch (_) { fs.writeFileSync(file, content, 'utf8'); try { fs.unlinkSync(tmp); } catch (__) {} }
}
function logError(msg) {
  try { fs.appendFileSync(ERROR_LOG, `[${new Date().toISOString()}] notify: ${String(msg).slice(0, 300)}\n`); } catch (_) {}
}
function config() {
  const c = readJson(CFG_FILE, null);
  const tg = c && c.telegram;
  if (!tg || !tg.token) return null;
  return { token: String(tg.token), chatId: String(tg.chatId || ''), remindMin: Number(c.remindMin) > 0 ? Number(c.remindMin) : 20, withText: c.withText !== false };
}

// 텔레그램 API (오류 글에 토큰이 든 주소가 섞이지 않게 메서드 이름만 남긴다)
function tg(cfg, method, body, timeoutMs) {
  return new Promise((resolve) => {
    const data = Buffer.from(JSON.stringify(body || {}));
    // WORKROOM_TG_TEST=host:port 이면 그 주소의 가짜 텔레그램(http)으로 (시험용)
    const test = process.env.WORKROOM_TG_TEST ? process.env.WORKROOM_TG_TEST.split(':') : null;
    const req = (test ? require('http') : https).request({
      host: test ? test[0] : 'api.telegram.org', port: test ? Number(test[1]) : 443, path: `/bot${cfg.token}/${method}`, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': data.length }, timeout: timeoutMs || 15000,
    }, (res) => {
      let b = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { b += c; });
      res.on('end', () => { try { resolve(JSON.parse(b)); } catch (_) { resolve({ ok: false, description: `응답을 읽지 못했어요 (${res.statusCode})` }); } });
    });
    req.on('timeout', () => { req.destroy(new Error('timeout')); });
    req.on('error', (e) => resolve({ ok: false, description: `${method}: ${e.code || e.message}` }));
    req.end(data);
  });
}

function readState() {
  try {
    const t = fs.readFileSync(path.join(ROOT, 'state.js'), 'utf8');
    return JSON.parse(t.slice(t.indexOf('{'), t.lastIndexOf('}') + 1));
  } catch (_) { return null; }
}
// 지금 사람을 기다리는 것: 세션 상태가 승인·질문·막힘이거나, 차례를 마친 답이 승인·질문으로 끝난 것 (현황판 catOf 와 같은 기준)
function pending(st) {
  const out = [];
  for (const s of (st && st.sessions) || []) {
    const d = s.denied;
    if (d && s.state !== 'ended' && !['approval', 'question', 'error'].includes(s.state)) {
      out.push({ key: `${s.id}|d${d.at || 0}`, sid: s.id, cat: 'denied', since: d.at || 0, room: s.room || '', title: s.title || s.lastPrompt || '이름 없는 세션',
        detail: `${d.what}${d.reason ? ' — ' + d.reason : ''}`, quick: deniedReplies(d.what) });
      continue;
    }
    const cat = ['approval', 'question', 'error'].includes(s.state) ? s.state : s.state === 'done' && (s.ask === 'approval' || s.ask === 'question') ? s.ask : '';
    if (!cat) continue;
    const detail = s.state === 'error' ? s.errorText : s.state === 'done' ? s.askText || s.lastMessage : s.waitingFor;
    out.push({ key: `${s.id}|${s.stateSince || 0}`, sid: s.id, cat, since: s.stateSince || 0, room: s.room || '', title: s.title || s.lastPrompt || '이름 없는 세션', detail: detail || '' });
  }
  return out;
}
function ago(t) {
  const m = Math.max(0, Math.round((Date.now() - t) / 60000));
  return m < 1 ? '방금' : m < 60 ? `${m}분 전` : `${Math.floor(m / 60)}시간 ${m % 60}분 전`;
}
function messageFor(it, cfg, again) {
  const lines = [`${again ? '🔁 아직 그대로 · ' : ''}${CAT[it.cat]} · ${it.room}`, it.title];
  if (cfg.withText && it.detail) lines.push(String(it.detail).slice(0, 300));
  lines.push(`${ago(it.since)} · 답장으로 쓰면 이 세션에 보내요`);
  const quick = QUICK[it.cat] || [];
  return {
    text: lines.join('\n'),
    reply_markup: quick.length ? { inline_keyboard: [quick.map((q, i) => ({ text: q, callback_data: `q${i}` }))] } : undefined,
  };
}

// ---------- 서버 안에서 도는 부분 ----------
let sendFn = null, polling = false, ticking = false;
// 보낸 알림·답장 연결·받은 차례(offset)는 메모리 하나로 들고 고칠 때마다 파일에 쓴다
// (알림 보내기와 폰 답장 받기가 각자 파일을 읽고 쓰면 서로 덮어써서 같은 답장을 두 번 넣을 수 있다).
let NS;
function ns() {
  if (NS === undefined) {
    const s = readJson(STATE_FILE, null);
    NS = s && typeof s === 'object' ? Object.assign({ sent: {}, msgs: {}, offset: 0 }, s) : null;
  }
  return NS;
}
function saveNs() { if (NS) writeAtomic(STATE_FILE, JSON.stringify(NS)); }
async function tick() {
  if (ticking) return;
  const cfg = config();
  if (!cfg || !cfg.chatId) return;
  ticking = true;
  try {
    const st = readState();
    if (!st) return;
    // 어느 기기·컴퓨터에서든 '확인'했거나 답한 것은 알리지 않는다 (다시 알림도)
    let acked = {};
    try { acked = require('./acks.js').merged(); } catch (_) {}
    const items = pending(st).filter((it) => !acked[it.key] && !acked['fire:' + it.sid]), now = Date.now();   // 해고(숨김)한 직원도 알리지 않는다
    if (!ns()) {
      // 처음 켰을 때: 이미 있던 것은 알리지 않고 지금부터 생기는 것만
      NS = { sent: {}, msgs: {}, offset: 0 };
      for (const it of items) NS.sent[it.key] = { at: now, reminded: true, skipped: true };
      saveNs();
      if (!polling) poll();
      return;
    }
    const live = new Set(items.map((it) => it.key));
    for (const it of items) {
      const prev = NS.sent[it.key];
      if (prev && (prev.reminded || now - prev.at < cfg.remindMin * 60000)) continue;
      if (!prev && now - it.since > MAX_AGE) { NS.sent[it.key] = { at: now, reminded: true, skipped: true }; continue; }
      const r = await tg(cfg, 'sendMessage', Object.assign({ chat_id: cfg.chatId, disable_web_page_preview: true }, messageFor(it, cfg, !!prev)));
      if (!r.ok) { logError(`sendMessage: ${r.description || ''}`); break; }
      NS.sent[it.key] = { at: prev ? prev.at : now, reminded: !!prev, msgId: r.result.message_id };
      NS.msgs[r.result.message_id] = Object.assign({ sid: it.sid, cat: it.cat, key: it.key, at: now }, it.quick ? { quick: it.quick } : {});
      saveNs();
    }
    // 끝난 것과 이틀 지난 답장 연결은 지운다
    for (const k of Object.keys(NS.sent)) if (!live.has(k) && now - (NS.sent[k].at || 0) > 3600000) delete NS.sent[k];
    for (const k of Object.keys(NS.msgs)) if (now - (NS.msgs[k].at || 0) > 2 * 86400000) delete NS.msgs[k];
    saveNs();
    if (!polling) poll();
  } catch (e) {
    logError(e && e.message);
  } finally { ticking = false; }
}

// 폰에서 온 것 (빠른 답 단추·답장·'상태')
async function poll() {
  polling = true;
  while (true) {
    const cfg = config();
    if (!cfg || !cfg.chatId) break;
    if (!ns()) NS = { sent: {}, msgs: {}, offset: 0 };
    const r = await tg(cfg, 'getUpdates', { offset: NS.offset || 0, timeout: 25, allowed_updates: ['message', 'callback_query'] }, 35000);
    if (!r.ok) { logError(`getUpdates: ${r.description || ''}`); await new Promise((res) => setTimeout(res, 30000)); continue; }
    for (const u of r.result || []) {
      // 처리하기 전에 차례를 먼저 넘겨 적어 둔다 (중간에 서버가 꺼져도 같은 답장을 두 번 넣지 않게)
      NS.offset = u.update_id + 1;
      saveNs();
      try { await handleUpdate(cfg, NS, u); } catch (e) { logError(e && e.message); }
    }
  }
  polling = false;
}
async function handleUpdate(cfg, ns, u) {
  if (u.callback_query) {
    const q = u.callback_query, msg = q.message || {};
    if (String(msg.chat && msg.chat.id) !== cfg.chatId) return;
    const link = ns.msgs[msg.message_id], idx = Number(String(q.data || '').replace(/^q/, ''));
    const text = link && (link.quick || QUICK[link.cat] || [])[idx];
    if (!link || !text) { await tg(cfg, 'answerCallbackQuery', { callback_query_id: q.id, text: '오래된 알림이라 보낼 곳을 모르겠어요' }); return; }
    const r = sendFn ? await sendFn(link.sid, text) : { ok: false, error: '서버가 아직 준비되지 않았어요' };
    await tg(cfg, 'answerCallbackQuery', { callback_query_id: q.id, text: r.ok ? '보냈어요' : '못 보냈어요' });
    await tg(cfg, 'editMessageReplyMarkup', { chat_id: cfg.chatId, message_id: msg.message_id, reply_markup: { inline_keyboard: [] } });
    await tg(cfg, 'sendMessage', { chat_id: cfg.chatId, reply_to_message_id: msg.message_id, text: r.ok ? `→ 보냄: ${text}${r.status === 'queued' ? ' (다른 컴퓨터라 동기화 때 들어가요)' : ''}` : `못 보냈어요: ${r.error || ''}` });
    return;
  }
  const m = u.message;
  if (!m || String(m.chat && m.chat.id) !== cfg.chatId || !m.text) return;
  const reply = m.reply_to_message && ns.msgs[m.reply_to_message.message_id];
  if (reply) {
    const r = sendFn ? await sendFn(reply.sid, m.text) : { ok: false, error: '서버가 아직 준비되지 않았어요' };
    await tg(cfg, 'sendMessage', { chat_id: cfg.chatId, reply_to_message_id: m.message_id, text: r.ok ? (r.status === 'queued' ? '보냈어요 (다른 컴퓨터라 동기화 때 들어가요)' : '보냈어요') : `못 보냈어요: ${r.error || ''}` });
    return;
  }
  const items = pending(readState());
  const list = items.length ? items.slice(0, 15).map((it) => `${CAT[it.cat]} · ${it.room} · ${it.title} (${ago(it.since)})`).join('\n') : '지금 기다리는 건 없어요.';
  await tg(cfg, 'sendMessage', { chat_id: cfg.chatId, text: /^\/?(상태|status|s)$/i.test(m.text.trim()) ? list : `알림에 '답장'으로 쓰면 그 세션에 보내요. '상태' 라고 보내면 지금 기다리는 것 목록을 보여 줘요.\n\n${list}` });
}

// server.js 가 부른다. send(sid, text) → Promise<{ ok, error, status }>
function start(send) {
  sendFn = send;
  setInterval(() => { tick(); }, 20 * 1000).unref();
  setTimeout(() => { tick(); }, 3000).unref();
}

module.exports = { start, tick, pending };

// ---------- 명령줄: 처음 설정 ----------
if (require.main === module) {
  (async () => {
    const cfg = config();
    if (!cfg) { console.log('notify.json 에 텔레그램 봇 토큰부터 적어 주세요: { "telegram": { "token": "…", "chatId": "" } }'); process.exit(1); }
    if (process.argv.includes('--find-chat')) {
      const r = await tg(cfg, 'getUpdates', { timeout: 0 });
      if (!r.ok) { console.log('텔레그램에 묻지 못했어요: ' + (r.description || '')); process.exit(1); }
      const chats = (r.result || []).map((u) => u.message && u.message.chat).filter((c) => c && c.type === 'private');
      const c = chats[chats.length - 1];
      if (!c) { console.log('봇에게 아무 말이나 먼저 보낸 뒤 다시 해 주세요.'); process.exit(1); }
      const full = readJson(CFG_FILE, {});
      full.telegram.chatId = String(c.id);
      writeAtomic(CFG_FILE, JSON.stringify(full, null, 2) + '\n');
      console.log(`대화방을 찾아 적었어요: ${c.first_name || c.username || '이름 없음'}`);
    } else if (process.argv.includes('--test')) {
      if (!cfg.chatId) { console.log('먼저 node notify.js --find-chat 을 해 주세요.'); process.exit(1); }
      const r = await tg(cfg, 'sendMessage', { chat_id: cfg.chatId, text: '업무방 현황판 알림 시험이에요 ✅\n승인 대기·질문·막힘이 생기면 여기로 알려 드려요.' });
      console.log(r.ok ? '보냈어요. 폰을 확인해 주세요.' : '못 보냈어요: ' + (r.description || ''));
    } else {
      console.log('사용법: node notify.js --find-chat | --test');
    }
  })();
}
