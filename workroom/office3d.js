'use strict';
// 업무방 현황판의 3D 사무실. 현황판.html 의 2D/3D 단추로 바꿔 본다.
// 현황판.html 이 1.5초마다 넘겨 주는 장면(방, 자리, 사람, 말)을 받아, 세션의 실제 상태대로 사람이 움직인다.
//   일하는 중        → 자기 자리에 앉아 타자 (방금 말했으면 손짓하며 말하기, 회의 의장은 화이트보드 앞에서 발표)
//   승인·답변 대기   → 로비의 대표 자리로 와서 줄 서서 손을 흔든다 / 손을 들고 묻는다
//   막힘             → 자리에서 일어나 머리를 짚는다
//   내 차례·대기 5분 넘음 → 가끔 커피, 정수기, 소파로 쉬러 다녀온다
//   새 세션 / 끝난 세션 → 엘리베이터에서 나와 자리로 / 엘리베이터로 나간다
//   워커(서브에이전트) → 로봇이 문으로 들어와 앉았다가, 일이 끝나면 문으로 나간다
// 사람은 Meshy 로 만든 캐릭터 6명(models/p1~p6.js)을 세션마다 하나씩 골라 머리·상의·바지 색을 바꿔 입힌다.
// 모델을 못 읽으면 도형으로 만든 사람으로 대신 그린다.
// Three.js r149 를 jsDelivr 에서 ES 모듈로 불러온다: window.Office3D.load().then(api => api.mount(...))
(function () {
  var CDN = 'https://cdn.jsdelivr.net/npm/three@0.149.0';
  var ready = null;
  window.Office3D = {
    load: function () {
      if (!ready) {
        ready = Promise.all([
          import(CDN + '/+esm'),
          import(CDN + '/examples/jsm/loaders/GLTFLoader.js/+esm'),
          import(CDN + '/examples/jsm/utils/SkeletonUtils.js/+esm')
        ]).then(function (m) { return define(m[0], m[1].GLTFLoader, m[2]); });
      }
      return ready;
    }
  };

  function define(T, GLTFLoader, SkeletonUtils) {
    T.ColorManagement.legacyMode = false;

    // ---------- 치수 (미터) ----------
    var SEAT = 1.25;                 // 자리 간격 (말풍선이 옆 사람과 겹치지 않게 넉넉히)
    var ROOM_D = 6.2;                // 방 깊이 (뒷벽 → 유리 앞벽)
    var CORR = 2.6;                  // 방 앞 복도 폭
    var SPINE0 = 2.8;                // 왼쪽 세로 복도 폭
    var SIDE_W = 2.0;                // 컴퓨터가 여럿이면 복도 왼쪽에 두는 층 표시 띠 (층마다 세로 색 줄 + 눕힌 층 이름·동기화)
    var SPINE = SPINE0;              // 방이 시작하는 x (층 표시 띠가 있으면 그만큼 오른쪽으로)
    function spineX() { return SPINE - SPINE0 / 2; }   // 세로 복도 가운데 (사람이 걷는 줄)
    var ZONE_D = 3.4;                // 컴퓨터마다 층 안내 띠 (바닥에 층 이름을 크게 쓴다)
    var ZONE_COLORS = ['#3b7ddd', '#e0703c', '#2e9d6c', '#9a5bd5', '#d39b12', '#d6457a'];   // 층마다 띠·바닥 글씨·이름표 색
    var LANE_D = 1.6;                // 맨 앞 로비 길 (엘리베이터, 아래쪽 방 문 앞)
    var LOBBY_D = 8.6;               // 맨 앞 로비 전체 (길 + 대표실·휴게실·수면실)
    var PANTRY_W = 4.2;              // 줄마다 오른쪽 끝 탕비실 폭
    var BED_HIP = 0.62;              // 누웠을 때 엉덩이 뼈 높이 (침대 윗면 0.5)
    var SLEEP_AFTER = 30 * 60000;    // 이만큼 넘게 쉬면 수면실에서 잔다
    var WALL_H = 2.3, LOW_H = 1.0, WALL_T = 0.1;
    var CW_H = 3.0, CW_GLASS = 2.55, CW_MOD = 1.5, CW_O = 0.16;   // 바깥 커튼월: 높이, 유리 윗선(그 위는 층 슬래브 띠), 멀리언 간격, 바닥 가장자리에서 바깥으로 뺀 거리
    var CITY_FLOOR = 32, FLOOR_H = 3.6;   // 도시 배경을 켜면 사무실이 이 층 높이에 있다 (아래로 건물 몸통과 거리)
    var PLATE_H = 0.5, PLATE_Y = 1.3;   // 유리 명패: 1배일 때 높이(m), 가운데 높이
    var PLATE_PPM = 256, PLATE_CW = 1024, PLATE_CH = 128;   // 명패 그림: 1m 에 256px
    var PLATE_MIN_PX = 22;              // 명패가 화면에서 이보다 낮게 보이면 유리 안에서 키운다 (이름 글씨 10px 쯤)
    var TAG_DESK_Y = 1.18;              // 책상에 앉은 사람 이름표 높이 (머리 옆). 모두 같은 높이라 한 줄로 가지런하다
    var TAG_FONT = 9, TAG_PAD = 10;     // 이름표 글씨 크기(px), 글씨 밖 폭(왼쪽 띠·안쪽 여백, 현황판.html 의 .o3-tag 와 맞춘다)
    var SEAT_HIP = 0.63;             // 앉았을 때 엉덩이 뼈 높이 (의자 윗면 0.49)
    var SEAT_FWD = 0.12;             // 앉았을 때 엉덩이를 의자 가운데에서 탁자 쪽으로 당기는 거리 (소파 등)
    // 책상 의자에서는 동작마다 다르게: 쉬며 앉아 있을 때(sit)는 무릎에 팔을 대고 푹 숙이는 순간이 있어서 조금 뒤로
    // (머리가 책상·노트북에 박히지 않게), 타자 칠 때(type)는 몸이 꼿꼿하니 앞으로 당겨 손이 노트북 쪽에 닿게.
    var SEAT_FWD_FOR = { sit: 0.02, talkSit: 0.04, type: 0.22 };
    var BREAK_AFTER = 10 * 60000;    // 일이 없는 채로(내 차례·대기) 이만큼 지나면 가끔 커피·탕비실로 쉬러 간다
    var WALK_SPEED = 0.95;           // 걷기 동작(Casual Walk)을 원래 빠르기로 틀 때 발이 안 미끄러지는 이동 속도 (m/s)
    var WALK_V_REF = 0.65;           // 그때 걷기 동작의 발 속도 값(build-people.js 의 walkV). 다리가 짧으면 walkV 가 달라 동작 빠르기를 맞춘다
    var MODEL_VER = 3;               // models/p*.js 를 바꾸면 올린다 (브라우저 캐시)
    var TEX_MAX_LOD = 2;             // 사람 텍스처를 이보다 더 흐린 밉맵 단계로 보지 않는다 (조각 여백이 그 단계까지만 있어서, 넘으면 옆 조각 색이 섞여 선이 생긴다)
    // models/p<번호>.js 로 있는 캐릭터: 1~16 은 Meshy 로 만든 사무직, 17~24 는 빛식물 프로젝트 캐릭터(동작은 빌려 붙임)
    var PEOPLE_IDS = [];
    for (var pid = 1; pid <= 24; pid++) PEOPLE_IDS.push(pid);
    var CHAR_NAMES = {
      1: '파란 셔츠', 2: '분홍 블라우스', 3: '초록 스웨터·안경', 4: '겨자 가디건', 5: '네이비 블레이저', 6: '보라 후드',
      7: '회색 머리 신사', 8: '민트 블라우스', 9: '빨간 폴로', 10: '청록 블레이저', 11: '주황 후드', 12: '빨간 머리',
      13: '올리브 재킷', 14: '곱슬머리 보라 블라우스', 15: '네이비 터틀넥', 16: '분홍 가디건',
      17: '빛식물 자취남', 18: '빛식물 가장(남)', 19: '빛식물 주부(남)', 20: '빛식물 연구원(남)',
      21: '빛식물 자취녀', 22: '빛식물 가장(여)', 23: '빛식물 주부(여)', 24: '빛식물 연구원(여)'
    };
    var FONT = '"Pretendard", "Malgun Gothic", "Apple SD Gothic Neo", system-ui, sans-serif';

    // 사무실 색 테마 (조명 단추로 고른다. 페이지가 어두운 테마여도 사무실은 따로 고른 색으로 그린다)
    var THEMES = {
      pastel: {
        name: '파스텔', bg: '#cfd9e4', floor: '#eeece7', floorLine: '#e0dcd4', carpet: '#d3dde8', lounge: '#eadcc6', lobby: '#e3cba6', lobbyLine: '#cfb38a',
        wall: '#fbfaf6', cap: '#a7b1bc', glass: '#d6ecfa', table: '#d4a878', tableEdge: '#ad7f55', chair: '#5b6370', metal: '#c2cad3',
        sofa: '#8db2d3', sofaSeat: '#a7c6e0', laptop: '#dadfe5', frame: '#bcc5ce', pot: '#e08b5b', counter: '#f5f1ea', rug: '#efdfc2', desk: '#c0915f', mat: '#9fabb8',
        seats: ['#f2a7a0', '#9cc7e8', '#f5d48a', '#a8d8b9', '#c9b5e8', '#f7b98b']
      },
      wood: {
        name: '우드', bg: '#d6cdc2', floor: '#e6dccd', floorLine: '#d6c8b4', carpet: '#cbb89a', lounge: '#dcc6a2', lobby: '#c49a6b', lobbyLine: '#a98256',
        wall: '#f3ece1', cap: '#8a7560', glass: '#e8dcc6', table: '#9c6b43', tableEdge: '#7a5233', chair: '#4a3c30', metal: '#a89a8a',
        sofa: '#7a8f6a', sofaSeat: '#93a883', laptop: '#cfc8bf', frame: '#8a7560', pot: '#b86b45', counter: '#ede3d3', rug: '#d4bd96', desk: '#8a5e3c', mat: '#8a7560',
        seats: ['#c98b6b', '#8fae8b', '#d9b26a', '#9a8fb5', '#c47f7f', '#7fa3b5']
      },
      modern: {
        name: '모던', bg: '#c3c9d1', floor: '#e2e4e7', floorLine: '#d0d4d9', carpet: '#98a1ac', lounge: '#b7b0a6', lobby: '#bcc1c7', lobbyLine: '#aab0b7',
        wall: '#f1f2f4', cap: '#4a525c', glass: '#cbd9e5', table: '#ecebe8', tableEdge: '#9aa0a8', chair: '#2f343b', metal: '#8f969e',
        sofa: '#4f5862', sofaSeat: '#66707b', laptop: '#c7ccd2', frame: '#4a525c', pot: '#d6d6d6', counter: '#f4f5f6', rug: '#c0c4ca', desk: '#3a3f46', mat: '#4a525c',
        seats: ['#3a7bd5', '#e05a4f', '#2fa37a', '#f2b134', '#8b5cf6', '#5b6573']
      },
      night: {
        name: '밤', bg: '#1b222d', floor: '#3a3f48', floorLine: '#454b55', carpet: '#3b485a', lounge: '#4b4035', lobby: '#4a3d30', lobbyLine: '#57493b',
        wall: '#59616e', cap: '#2a2f36', glass: '#6c8aa8', table: '#7a5a3c', tableEdge: '#5a422c', chair: '#22262c', metal: '#5d6670',
        sofa: '#3e5468', sofaSeat: '#4a6379', laptop: '#8d959e', frame: '#5b6570', pot: '#9a5f3b', counter: '#4a4f57', rug: '#4a4034', desk: '#5b4733', mat: '#3a434d',
        seats: ['#9a5a54', '#4f6f8f', '#9a8040', '#4f7f62', '#6f5f94', '#9a6a48']
      }
    };
    var COMMON = { screenOff: '#3d4650', screenOn: '#c6ecff', board: '#ffffff', boardInk: '#2b3743', boardMuted: '#6b7178', plant: '#62b56f', plantDark: '#469a5a' };
    var PAL = Object.assign({}, COMMON, THEMES.pastel);
    var PANTS = ['#2d3440', '#3b4a5e', '#5a4a3c', '#26303a', '#6b6f78', '#4a4f57'];
    // 자세 → 메시 동작
    var CLIP_FOR = { walk: 'walk', stand: 'idle', sit: 'sit', lounge: 'sit', type: 'type', sofa: 'sitDrink', doze: 'doze', sleep: 'sleep', cup: 'drink', raise: 'wave', ask: 'ask', slump: 'headache', present: 'present' };
    var SITTING = { sit: 1, lounge: 1, type: 1, sofa: 1, doze: 1, sleep: 1 };
    var CHAR_SCALE = { 6: 0.86 };     // 6번은 머리가 큰 카툰 비율이라 다른 사람보다 커 보여서 전체를 줄인다

    function roomWidth(k) { return k * SEAT + 3.0; }
    function skyKind(h) { return h >= 6 && h < 17 ? 'day' : h >= 17 && h < 20 ? 'dusk' : 'night'; }
    function hash(str) {
      var h = 2166136261;
      for (var i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
      return h >>> 0;
    }
    function esc(s) {
      return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
        return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
      });
    }
    function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
    function angDiff(a, b) {
      var d = (a - b) % (Math.PI * 2);
      if (d > Math.PI) d -= Math.PI * 2;
      if (d < -Math.PI) d += Math.PI * 2;
      return d;
    }
    function shade(hex, k) {
      var c = new T.Color(hex);
      c.multiplyScalar(k);
      return '#' + c.getHexString();
    }

    // 모든 물건이 같이 쓰는 기본 도형 (크기는 scale 로 바꾼다)
    var G = {
      box: new T.BoxGeometry(1, 1, 1),
      cyl: new T.CylinderGeometry(0.5, 0.5, 1, 14),
      sph: new T.SphereGeometry(0.5, 16, 12),
      cap: new T.SphereGeometry(0.5, 16, 8, 0, Math.PI * 2, 0, Math.PI * 0.56),
      ico: new T.IcosahedronGeometry(0.5, 1),
      ring: new T.TorusGeometry(0.5, 0.14, 4, 12),
      plane: new T.PlaneGeometry(1, 1)
    };
    function mesh(geo, m, sx, sy, sz, x, y, z, parent) {
      var o = new T.Mesh(geo, m);
      o.scale.set(sx, sy, sz);
      o.position.set(x, y, z);
      if (parent) parent.add(o);
      return o;
    }

    // ---------- 도형으로 만든 사람·로봇 (메시 모델을 못 읽을 때, 워커 로봇) ----------
    // 둘 다 같은 뼈대(엉덩이 → 허벅지 → 정강이, 몸통 → 팔·머리)라서 같은 자세 계산을 쓴다. 정면은 +z.
    function makePerson(p) {
      var mats = [], L = p.look || {};
      function M(c) { var m = new T.MeshLambertMaterial({ color: c }); mats.push(m); return m; }
      var skin = M(L.skin || '#efc39b'), hair = M(L.hair || '#2a2321'), shirt = M(L.shirt || '#4f7cc4');
      var pants = M(PANTS[hash(p.id) % PANTS.length]), shoe = M('#1e2226'), dark = M('#1b1f24');
      var top = L.outfit === 'blazer' ? M(L.jacket || '#2f3a4a') : L.outfit === 'hoodie' ? M(shade(L.shirt || '#4f7cc4', 0.86)) : shirt;
      var root = new T.Group(), hip = new T.Group();
      hip.position.y = 0.86;
      root.add(hip);
      function leg(side) {
        var th = new T.Group();
        th.position.set(side * 0.1, 0, 0);
        hip.add(th);
        mesh(G.box, pants, 0.16, 0.44, 0.18, 0, -0.21, 0, th);
        var sh = new T.Group();
        sh.position.y = -0.42;
        th.add(sh);
        mesh(G.box, pants, 0.14, 0.4, 0.16, 0, -0.2, 0, sh);
        mesh(G.box, shoe, 0.15, 0.07, 0.26, 0, -0.41, 0.04, sh);
        return [th, sh];
      }
      var l0 = leg(-1), l1 = leg(1);
      var torso = new T.Group();
      hip.add(torso);
      mesh(G.box, top, 0.42, 0.56, 0.25, 0, 0.3, 0, torso);
      if (L.outfit === 'blazer') mesh(G.box, shirt, 0.12, 0.42, 0.02, 0, 0.36, 0.126, torso);
      mesh(G.box, skin, 0.1, 0.08, 0.1, 0, 0.62, 0, torso);
      var head = new T.Group();
      head.position.y = 0.8;
      torso.add(head);
      mesh(G.sph, skin, 0.3, 0.33, 0.3, 0, 0, 0, head);
      mesh(G.box, dark, 0.035, 0.045, 0.02, -0.06, 0.01, 0.142, head);
      mesh(G.box, dark, 0.035, 0.045, 0.02, 0.06, 0.01, 0.142, head);
      var cap = mesh(G.cap, hair, 0.33, 0.33, 0.33, 0, 0.02, -0.01, head);
      cap.rotation.x = -0.35;
      if (L.style === 'long') mesh(G.box, hair, 0.3, 0.34, 0.1, 0, -0.1, -0.12, head);
      if (L.style === 'bun') mesh(G.sph, hair, 0.13, 0.13, 0.13, 0, 0.17, -0.1, head);
      function arm(side) {
        var a = new T.Group();
        a.position.set(side * 0.27, 0.54, 0);
        torso.add(a);
        mesh(G.box, top, 0.11, 0.5, 0.12, 0, -0.24, 0, a);
        mesh(G.box, skin, 0.09, 0.09, 0.1, 0, -0.52, 0, a);
        return a;
      }
      var a0 = arm(-1), a1 = arm(1);
      var cup = mesh(G.cyl, M('#f4f1ea'), 0.07, 0.09, 0.07, 0, -0.6, 0.05, a1);
      cup.visible = false;
      root.traverse(function (o) { if (o.isMesh) o.castShadow = true; });
      return { root: root, hip: hip, th: [l0[0], l1[0]], sh: [l0[1], l1[1]], arm: [a0, a1], torso: torso, head: head, cup: cup, mats: mats, standHip: 0.86, sitHip: 0.5, top: 0.24 };
    }

    function makeRobot(p) {
      var mats = [];
      function M(c) { var m = new T.MeshLambertMaterial({ color: c }); mats.push(m); return m; }
      var body = M('#eef2f6'), joint = M('#9aa6b3'), accent = M(p.color || '#4f7cc4'), visor = M('#1d2731');
      var eye = new T.MeshBasicMaterial({ color: '#7fe7ff' });
      mats.push(eye);
      var root = new T.Group(), hip = new T.Group();
      hip.position.y = 0.86;
      root.add(hip);
      function leg(side) {
        var th = new T.Group();
        th.position.set(side * 0.1, 0, 0);
        hip.add(th);
        mesh(G.box, joint, 0.13, 0.44, 0.14, 0, -0.21, 0, th);
        var sh = new T.Group();
        sh.position.y = -0.42;
        th.add(sh);
        mesh(G.box, joint, 0.12, 0.4, 0.13, 0, -0.2, 0, sh);
        mesh(G.box, body, 0.16, 0.08, 0.25, 0, -0.41, 0.04, sh);
        return [th, sh];
      }
      var l0 = leg(-1), l1 = leg(1);
      var torso = new T.Group();
      hip.add(torso);
      mesh(G.box, body, 0.44, 0.5, 0.32, 0, 0.28, 0, torso);
      mesh(G.box, accent, 0.45, 0.07, 0.33, 0, 0.38, 0, torso);
      var head = new T.Group();
      head.position.y = 0.76;
      torso.add(head);
      mesh(G.box, body, 0.34, 0.28, 0.3, 0, 0, 0, head);
      mesh(G.box, visor, 0.28, 0.12, 0.02, 0, 0.01, 0.151, head);
      mesh(G.box, eye, 0.05, 0.035, 0.01, -0.065, 0.01, 0.163, head);
      mesh(G.box, eye, 0.05, 0.035, 0.01, 0.065, 0.01, 0.163, head);
      mesh(G.cyl, joint, 0.02, 0.16, 0.02, 0, 0.22, 0, head);
      mesh(G.sph, accent, 0.07, 0.07, 0.07, 0, 0.31, 0, head);
      function arm(side) {
        var a = new T.Group();
        a.position.set(side * 0.28, 0.48, 0);
        torso.add(a);
        mesh(G.box, joint, 0.1, 0.46, 0.11, 0, -0.22, 0, a);
        mesh(G.box, accent, 0.11, 0.1, 0.11, 0, -0.48, 0, a);
        return a;
      }
      var a0 = arm(-1), a1 = arm(1);
      root.scale.setScalar(0.78);
      root.traverse(function (o) { if (o.isMesh) o.castShadow = true; });
      return { root: root, hip: hip, th: [l0[0], l1[0]], sh: [l0[1], l1[1]], arm: [a0, a1], torso: torso, head: head, cup: null, mats: mats, standHip: 0.86, sitHip: 0.5 / 0.78, top: 0.3 * 0.78 };
    }

    // ---------- 메시 캐릭터 ----------
    // 한 명에 1.5MB 쯤이라 화면에 실제로 나오는 캐릭터만 그때그때 불러온다 (그동안은 도형 사람으로 그린다).
    var PEOPLE = {}, peopleAsked = {}, peopleListeners = [], gltfLoader = null;
    function needPerson(i) {
      if (PEOPLE[i] || peopleAsked[i]) return;
      peopleAsked[i] = true;
      if (!gltfLoader) gltfLoader = new GLTFLoader();
      var loader = gltfLoader;
      (function () {
        var el = document.createElement('script');
        el.src = 'models/p' + i + '.js?v=' + MODEL_VER;
        el.onload = function () {
          el.remove();
          var e = window.__WR_PEOPLE__ && window.__WR_PEOPLE__[i];
          if (!e || !e.glb) return;
          var raw = atob(e.glb), bytes = new Uint8Array(raw.length);
          for (var k = 0; k < raw.length; k++) bytes[k] = raw.charCodeAt(k);
          e.glb = null;
          loader.parse(bytes.buffer, '', function (gltf) {
            try { addPerson(i, e, gltf); } catch (err) { console.warn('사람 모델 ' + i + ' 준비 실패', err); }
          }, function (err) { console.warn('사람 모델 ' + i + ' 읽기 실패', err); });
        };
        el.onerror = function () { el.remove(); };
        document.head.appendChild(el);
      })();
    }
    function addPerson(i, e, gltf) {
      var skinned = null;
      gltf.scene.traverse(function (o) { if (o.isSkinnedMesh && !skinned) skinned = o; });
      if (!skinned) return;
      var clips = {};
      gltf.animations.forEach(function (c) { clips[c.name] = c; });
      var tpl = { i: i, scene: gltf.scene, clips: clips, material: skinned.material, sit: {}, scale: CHAR_SCALE[i] || 1, walkV: e.walkV || 0 };
      // 앉는 동작마다 엉덩이 뼈가 어디 오는지 재 둔다 (의자 높이·위치에 맞추려고)
      Object.keys(clips).forEach(function (name) {
        var probe = SkeletonUtils.clone(gltf.scene), mixer = new T.AnimationMixer(probe);
        mixer.clipAction(clips[name]).play();
        mixer.update(0.05);
        probe.updateMatrixWorld(true);
        var hips = probe.getObjectByName('Hips'), v = new T.Vector3();
        if (hips) { hips.getWorldPosition(v); tpl.sit[name] = { x: v.x, y: v.y, z: v.z }; }
        mixer.stopAllAction();
      });
      // 키가 작은 캐릭터(빛식물 1.4~1.5m)는 앉는 높이도 낮춘다 (의자 윗면 0.49 보다는 위)
      tpl.seatHip = tpl.sit.idle ? clamp(tpl.sit.idle.y * tpl.scale * 0.76, 0.53, SEAT_HIP) : SEAT_HIP;
      PEOPLE[i] = tpl;
      peopleListeners.forEach(function (fn) { fn(i); });
    }
    // 사람 텍스처를 TEX_MAX_LOD 단계보다 흐리게 보지 않게 한다 (WebGL2 에서만, 아니면 원래대로)
    var MAP_LINE = 'vec4 sampledDiffuseColor = texture2D( map, vUv );';
    function clampMapLod(shader) {
      if (T.ShaderChunk.map_fragment.indexOf(MAP_LINE) < 0) return;
      shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>', T.ShaderChunk.map_fragment.replace(MAP_LINE,
        '#if __VERSION__ >= 300\n' +
        '  vec2 wrT = vUv * vec2( textureSize( map, 0 ) ); vec2 wrX = dFdx( wrT ), wrY = dFdy( wrT );\n' +
        '  vec4 sampledDiffuseColor = textureLod( map, vUv, clamp( 0.5 * log2( max( dot( wrX, wrX ), dot( wrY, wrY ) ) ), 0.0, ' + TEX_MAX_LOD.toFixed(1) + ' ) );\n' +
        '#else\n  ' + MAP_LINE + '\n#endif'));
    }
    function clampLodKey() { return 'wr-lod' + TEX_MAX_LOD; }
    // 세션마다 캐릭터 하나를 정해 둔다 (같은 세션은 늘 같은 사람)
    function charOf(p) { return PEOPLE_IDS[hash(String(p.id) + ':char') % PEOPLE_IDS.length]; }
    function makeModel(p, tpl) {
      var root = new T.Group(), inner = SkeletonUtils.clone(tpl.scene);
      inner.scale.setScalar(tpl.scale);
      root.add(inner);
      // 원래 색 그대로 쓴다 (사람마다 투명도를 따로 바꿀 수 있게 재질만 복사)
      var mat = tpl.material.clone();
      mat.roughness = 0.85;
      mat.onBeforeCompile = clampMapLod;
      mat.customProgramCacheKey = clampLodKey;
      inner.traverse(function (o) {
        if (o.isMesh) { o.material = mat; o.castShadow = true; o.frustumCulled = false; }
      });
      var mixer = new T.AnimationMixer(inner), actions = {};
      Object.keys(tpl.clips).forEach(function (k) { actions[k] = mixer.clipAction(tpl.clips[k]); });
      return { model: true, root: root, inner: inner, mixer: mixer, actions: actions, tpl: tpl, cur: '', mats: [mat], head: inner.getObjectByName('head_end') || inner.getObjectByName('Head'), top: 0.07 };
    }

    // ---------- 화면 하나 ----------
    function mount(container, host) {
      var coarse = !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches);
      var renderer = new T.WebGLRenderer({ antialias: true });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, coarse ? 1.5 : 2));
      renderer.outputEncoding = T.sRGBEncoding;
      renderer.toneMapping = T.ACESFilmicToneMapping;   // 밝은 곳이 하얗게 날아가지 않게
      renderer.shadowMap.enabled = !coarse;
      renderer.shadowMap.type = T.PCFSoftShadowMap;
      renderer.setClearColor(PAL.bg);
      // 조명 설정 (테마, 밝기, 빛 색). 이 브라우저에 기억해 둔다.
      var LOOK_KEY = 'workroom-3d-look';
      var look = { theme: 'pastel', light: 0.85, warmth: 0.55, ceo: 1, city: !coarse, sky: 'auto' };   // 도시 배경은 폰에서는 처음에 끈다
      try { Object.assign(look, JSON.parse(localStorage.getItem(LOOK_KEY) || '{}')); } catch (_) {}
      if (!THEMES[look.theme]) look.theme = 'pastel';
      var aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
      var canvas = renderer.domElement;
      canvas.setAttribute('aria-label', '3D 사무실');
      canvas.tabIndex = 0;
      container.appendChild(canvas);

      var layer = document.createElement('div');
      layer.className = 'o3-layer';
      container.appendChild(layer);
      var tools = document.createElement('div');
      tools.className = 'o3-tools';
      tools.innerHTML = '<button type="button" data-a="left" title="왼쪽으로 돌리기" aria-label="왼쪽으로 돌리기">⟲</button>' +
        '<button type="button" data-a="right" title="오른쪽으로 돌리기" aria-label="오른쪽으로 돌리기">⟳</button>' +
        '<button type="button" data-a="out" title="축소" aria-label="축소">−</button>' +
        '<button type="button" data-a="in" title="확대" aria-label="확대">+</button>' +
        '<button type="button" data-a="home" class="wide" title="전체 보기">전체</button>' +
        '<button type="button" data-a="look" class="wide" title="사무실 색과 조명 바꾸기" aria-expanded="false">조명</button>' +
        '<button type="button" data-a="city" class="wide" title="건물 아래 거리와 주변 빌딩 (느리면 끄세요)" aria-pressed="false">도시</button>';
      container.appendChild(tools);
      var lookPanel = document.createElement('div');
      lookPanel.className = 'o3-look';
      lookPanel.hidden = true;
      lookPanel.innerHTML = '<div class="o3-look-row"><span>사무실</span><div class="o3-themes">' +
        Object.keys(THEMES).map(function (k) { return '<button type="button" data-theme="' + k + '">' + THEMES[k].name + '</button>'; }).join('') + '</div></div>' +
        '<div class="o3-look-row"><span>바깥</span><div class="o3-themes">' +
        [['auto', '시각대로'], ['day', '낮'], ['dusk', '저녁'], ['night', '밤']].map(function (k) { return '<button type="button" data-sky="' + k[0] + '">' + k[1] + '</button>'; }).join('') + '</div></div>' +
        '<label class="o3-look-row"><span>밝기</span><input type="range" min="0.4" max="1.5" step="0.05" data-k="light"></label>' +
        '<label class="o3-look-row"><span>빛 색</span><input type="range" min="0" max="1" step="0.05" data-k="warmth"><em>차갑게 ↔ 따뜻하게</em></label>' +
        '<div class="o3-look-row"><span>대표</span><button type="button" class="o3-ceo-btn" data-ceo="-1" aria-label="이전 캐릭터">◀</button>' +
        '<b class="o3-ceo-name"></b><button type="button" class="o3-ceo-btn" data-ceo="1" aria-label="다음 캐릭터">▶</button></div>';
      container.appendChild(lookPanel);
      var backBtn = document.createElement('button');
      backBtn.type = 'button';
      backBtn.className = 'rv-back o3-back';
      backBtn.textContent = '← 방 나가기';
      backBtn.hidden = true;
      container.appendChild(backBtn);
      var hint = document.createElement('div');
      hint.className = 'o3-hint';
      var hintText = coarse ? '한 손가락으로 이동 · 두 손가락으로 확대·회전 · 방을 누르면 들어가요 · 대표(★)를 누르면 움직여요'
        : '끌어서 이동 · 오른쪽 버튼으로 끌면 회전 · 휠로 확대 · 방을 누르면 들어가요 · 대표(★)를 누르면 움직여요';
      hint.textContent = hintText;
      container.appendChild(hint);
      setTimeout(function () { hint.classList.add('fade'); }, 9000);

      var scene = new T.Scene();
      var camera = new T.PerspectiveCamera(35, 1, 0.4, 4500);
      var hemi = new T.HemisphereLight('#ffffff', '#d9cfc2', 0.75);
      var amb = new T.AmbientLight('#ffffff', 0.18);
      scene.add(hemi, amb);
      var sun = new T.DirectionalLight('#fff4e2', 1.05);
      sun.castShadow = !coarse;
      sun.shadow.mapSize.set(2048, 2048);
      sun.shadow.bias = -0.0004;
      sun.shadow.normalBias = 0.03;
      scene.add(sun, sun.target);
      var COOL = new T.Color('#d6e4ff'), WARM = new T.Color('#ffe2c2');
      function applyLight() {
        renderer.toneMappingExposure = look.light;
        var c = COOL.clone().lerp(WARM, look.warmth);
        hemi.color.copy(c);
        sun.color.copy(c);
        amb.color.copy(c);
      }
      applyLight();
      var shadowMat = new T.MeshBasicMaterial({ map: blobTexture(), transparent: true, depthWrite: false });

      var W = null, builtKey = '', actors = {}, snap = null, focus = null, first = true;
      var view = { x: 0, y: 0, z: 0, az: 0, el: 0.92, dist: 40 }, goal = Object.assign({}, view);
      var userMoved = false, maxDist = 200;
      var cw = 0, ch = 0, raf = 0, lastT = 0;
      var V = new T.Vector3(), HV = new T.Vector3();

      // 메시 캐릭터가 늦게 도착하면 도형 사람을 그 캐릭터로 바꾼다
      peopleListeners.push(function () { Object.keys(actors).forEach(function (id) { upgrade(actors[id]); }); });

      // ---------- 그림 재료 ----------
      function blobTexture() {
        var c = document.createElement('canvas');
        c.width = c.height = 64;
        var x = c.getContext('2d');
        var gr = x.createRadialGradient(32, 32, 0, 32, 32, 32);
        gr.addColorStop(0, 'rgba(0,0,0,0.22)');
        gr.addColorStop(1, 'rgba(0,0,0,0)');
        x.fillStyle = gr;
        x.fillRect(0, 0, 64, 64);
        return new T.CanvasTexture(c);
      }
      function tileTexture(base, line, planks) {
        var c = document.createElement('canvas');
        c.width = c.height = 64;
        var x = c.getContext('2d');
        x.fillStyle = base;
        x.fillRect(0, 0, 64, 64);
        x.fillStyle = line;
        if (planks) {
          for (var y = 0; y < 64; y += 16) x.fillRect(0, y, 64, 1.5);
          x.fillRect(20, 0, 1.5, 16); x.fillRect(52, 16, 1.5, 16); x.fillRect(36, 32, 1.5, 16); x.fillRect(8, 48, 1.5, 16);
        } else {
          x.fillRect(0, 0, 64, 2);
          x.fillRect(0, 0, 2, 64);
        }
        var t = new T.CanvasTexture(c);
        t.wrapS = t.wrapT = T.RepeatWrapping;
        t.anisotropy = aniso;
        t.encoding = T.sRGBEncoding;
        return t;
      }
      // 둥근 네모 길 (canvas roundRect 가 없는 브라우저도 있어서 직접)
      function rrect(x, l, t, w, h, r) {
        x.beginPath();
        x.moveTo(l + r, t);
        x.arcTo(l + w, t, l + w, t + h, r);
        x.arcTo(l + w, t + h, l, t + h, r);
        x.arcTo(l, t + h, l, t, r);
        x.arcTo(l, t, l + w, t, r);
        x.closePath();
      }
      // 명패 글씨: [번호] 이름. 왼쪽 띠는 방 상태 색, 승인 대기 같은 알림이면 테두리를 그 색으로.
      function drawPlate(pl, no, name, color, alert) {
        var key = [no, name, color, alert].join('|');
        if (pl.key === key) return;
        pl.key = key;
        var c = pl.tc.canvas, x = c.getContext('2d'), H = c.height;
        x.clearRect(0, 0, c.width, H);
        x.textBaseline = 'middle';
        x.font = '800 60px ' + FONT;
        var nw = no ? x.measureText(no).width + 20 : 0, padL = 40, padR = 32;
        x.font = '800 70px ' + FONT;
        var maxW = Math.min(c.width, Math.floor(pl.room * PLATE_PPM)) - padL - padR - nw;
        var w = Math.ceil(padL + nw + Math.min(x.measureText(name).width, maxW) + padR);
        x.save();
        rrect(x, 2, 2, w - 4, H - 4, 18);
        x.fillStyle = 'rgba(255,255,255,0.95)';
        x.fill();
        x.clip();
        x.fillStyle = color || '#8f969d';
        x.fillRect(0, 0, 16, H);
        x.restore();
        rrect(x, 3, 3, w - 6, H - 6, 17);
        x.lineWidth = alert ? 8 : 3;
        x.strokeStyle = alert ? color || '#e5534b' : 'rgba(70,80,92,0.3)';
        x.stroke();
        // 위에서 비스듬히 보면 세로가 눌려 보여서 글씨만 세로로 조금 늘려 쓴다
        x.save();
        x.translate(0, H / 2 + 3);
        x.scale(1, 1.25);
        if (no) {
          x.font = '800 60px ' + FONT;
          x.fillStyle = '#8a929c';
          x.fillText(no, padL, 0);
        }
        x.font = '800 70px ' + FONT;
        x.fillStyle = '#1f2328';
        fillFit(x, name, padL + nw, 0, maxW);
        x.restore();
        pl.w = w / PLATE_PPM;
        pl.maxS = Math.max(1, Math.min((pl.room - 0.2) / pl.w, 1.3 / PLATE_H));
        pl.tc.tex.repeat.set(w / c.width, 1);
        pl.tc.tex.needsUpdate = true;
        pl.mesh.scale.x = pl.w;
      }
      function textCanvas(w, h) {
        var c = document.createElement('canvas');
        c.width = w;
        c.height = h;
        var t = new T.CanvasTexture(c);
        t.anisotropy = aniso;
        t.encoding = T.sRGBEncoding;
        return { canvas: c, tex: t };
      }
      function fillFit(x, text, px, py, maxW) {
        var t = String(text || '');
        if (x.measureText(t).width > maxW) {
          while (t.length > 1 && x.measureText(t + '…').width > maxW) t = t.slice(0, -1);
          t += '…';
        }
        x.fillText(t, px, py);
      }

      // 같은 재료를 쓰는 고정 물건을 한 덩어리로 합쳐 그리기 횟수를 줄인다.
      function mergeStatic(root) {
        root.updateMatrixWorld(true);
        var buckets = {}, order = [];
        root.traverse(function (o) {
          if (!o.isMesh) return;
          var b = buckets[o.material.uuid];
          if (!b) { b = buckets[o.material.uuid] = { m: o.material, list: [] }; order.push(b); }
          b.list.push(o);
        });
        var out = new T.Group(), nm = new T.Matrix3(), v = new T.Vector3();
        order.forEach(function (b) {
          var pos = [], nor = [];
          b.list.forEach(function (o) {
            var geo = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry;
            var p = geo.attributes.position, nn = geo.attributes.normal;
            nm.getNormalMatrix(o.matrixWorld);
            for (var i = 0; i < p.count; i++) {
              v.fromBufferAttribute(p, i).applyMatrix4(o.matrixWorld);
              pos.push(v.x, v.y, v.z);
              v.fromBufferAttribute(nn, i).applyMatrix3(nm).normalize();
              nor.push(v.x, v.y, v.z);
            }
            if (geo !== o.geometry) geo.dispose();
          });
          var merged = new T.BufferGeometry();
          merged.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
          merged.setAttribute('normal', new T.Float32BufferAttribute(nor, 3));
          var mm = new T.Mesh(merged, b.m);
          mm.castShadow = !b.m.transparent;
          mm.receiveShadow = true;
          out.add(mm);
        });
        return out;
      }

      // ---------- 사무실 짓기 ----------
      // 한 줄에 놓을 방 수: 화면이 넓으면 많이, 폰처럼 좁으면 적게
      function colsFor(n) {
        var aspect = cw && ch ? cw / ch : 1.4;
        return clamp(Math.ceil(Math.sqrt(Math.max(1, n) * aspect * 1.6)), 2, 6);
      }

      function roomGeo(r, x0, z0, row) {
        var k = r.k, w = roomWidth(k), tlen = k * SEAT + 0.3, tx0 = x0 + 0.85;   // 탁자 양 끝에 머리 자리 의자가 들어가게 조금 왼쪽으로
        var R = {
          name: r.name, kind: r.kind, k: k, x0: x0, z0: z0, w: w, x1: x0 + w, z1: z0 + ROOM_D, row: row,
          xSide: x0 + w - 0.85, zBack: z0 + 0.72, zFar: z0 + 1.52, zTable: z0 + 2.55, zNear: z0 + 3.58, zFront: z0 + 4.5, zDoor: z0 + ROOM_D - 0.45,
          tx0: tx0, tlen: tlen, tcx: tx0 + tlen / 2, seatX: [], laptops: { far: [], near: [] }, boardKey: '', labelKey: ''
        };
        for (var i = 0; i < k; i++) R.seatX.push(tx0 + 0.15 + SEAT * (i + 0.5));
        return R;
      }

      function build(s) {
        if (W) disposeWorld();
        PAL = Object.assign({}, COMMON, THEMES[look.theme] || THEMES.pastel);
        renderer.setClearColor(PAL.bg);
        var P = PAL, trash = [];
        function lam(c) { var m = new T.MeshLambertMaterial({ color: c }); trash.push(m); return m; }
        function basic(c) { var m = new T.MeshBasicMaterial({ color: c }); trash.push(m); return m; }
        function zoneSideWidth(name) {
          var x = document.createElement('canvas').getContext('2d');
          x.font = '800 132px ' + FONT;
          var nw = x.measureText(name + ' 층').width;
          x.font = '700 76px ' + FONT;
          return Math.ceil(nw + 40 + x.measureText('999분 전 동기화').width + 32);
        }
        // 다시 그리는 바닥 글씨 (층 옆 '이 컴퓨터' / 'n분 전 동기화')
        function zoneCanvas(w, h) {
          var c = document.createElement('canvas');
          c.width = w;
          c.height = h;
          var t = new T.CanvasTexture(c);
          t.anisotropy = aniso;
          t.encoding = T.sRGBEncoding;
          var m = new T.MeshLambertMaterial({ map: t, transparent: true, depthWrite: false });
          trash.push(m, t);
          return { c: c, x: c.getContext('2d'), tex: t, mat: m };
        }
        // 바닥에 칠하는 큰 글씨 (층 이름). 바탕은 투명하게 두고 글씨만 칠한다.
        function floorText(text, color) {
          var font = '800 150px ' + FONT, c = document.createElement('canvas'), x = c.getContext('2d');
          x.font = font;
          c.width = Math.ceil(x.measureText(text).width) + 40;
          c.height = 200;
          x.font = font;
          x.fillStyle = color;
          x.textBaseline = 'middle';
          x.fillText(text, 20, 104);
          var t = new T.CanvasTexture(c);
          t.anisotropy = aniso;
          t.encoding = T.sRGBEncoding;
          var m = new T.MeshLambertMaterial({ map: t, transparent: true, depthWrite: false });
          trash.push(m, t);
          return { mat: m, aspect: c.width / c.height };
        }
        var M = {
          wall: lam(P.wall), cap: lam(P.cap), table: lam(P.table), tableEdge: lam(P.tableEdge), chair: lam(P.chair),
          sofa: lam(P.sofa), sofaSeat: lam(P.sofaSeat), laptop: lam(P.laptop), screenOff: basic(P.screenOff), screenOn: basic(P.screenOn),
          frame: lam(P.frame), plant: lam(P.plant), plantDark: lam(P.plantDark), pot: lam(P.pot), metal: lam(P.metal), counter: lam(P.counter),
          rug: lam(P.rug), desk: lam(P.desk), mat: lam(P.mat), carpet: lam(P.carpet), lounge: lam(P.lounge),
          dark: lam('#3a414a'), white: lam('#ffffff'), cooler: lam('#e8f0f6'), water: lam('#8fd0f2'), led: basic('#ff8a4c'),
          seats: P.seats.map(function (c) { return lam(c); }),
          ceoFloor: lam(shade(P.lobby, 0.92)), napFloor: lam(shade(P.carpet, 0.62)), vending: lam(P.seats[0]), fridge: lam('#e9eef2'),
          mullion: lam(shade(P.cap, 0.72)), spandrel: lam(shade(P.cap, 0.5)), gold: lam('#d8b24a'), felt: lam('#2f7d5b'), fish: lam('#f08a3c'),
          bulb: basic('#fff1d2'), menu: lam('#2f3a35'), curtain: lam(shade(P.counter, 0.97)), fruit: [lam('#f2b134'), lam('#e05a4f'), lam('#7fb069')],
          glass: new T.MeshLambertMaterial({ color: P.glass, transparent: true, opacity: 0.22, depthWrite: false, side: T.DoubleSide }),
          tank: new T.MeshLambertMaterial({ color: '#7fcbe8', transparent: true, opacity: 0.42, depthWrite: false })
        };
        trash.push(M.glass, M.tank);
        var root = new T.Group(), keep = new T.Group(), dyn = new T.Group();
        function box(w, h, d, m, x, y, z, parent) { return mesh(G.box, m, w, h, d, x, y, z, parent || root); }
        function plant(x, z, sc) {
          mesh(G.cyl, M.pot, 0.3 * sc, 0.32 * sc, 0.3 * sc, x, 0.16 * sc, z, root);
          mesh(G.ico, M.plant, 0.56 * sc, 0.62 * sc, 0.56 * sc, x, 0.62 * sc, z, root);
          mesh(G.ico, M.plantDark, 0.36 * sc, 0.4 * sc, 0.36 * sc, x + 0.1 * sc, 0.88 * sc, z - 0.05 * sc, root);
        }
        function wallX(xa, xb, z) {
          var len = xb - xa, cx = (xa + xb) / 2;
          box(len, LOW_H, WALL_T, M.wall, cx, LOW_H / 2, z);
          box(len, 0.04, WALL_T + 0.02, M.cap, cx, LOW_H, z);
          box(len, WALL_H - LOW_H, 0.03, M.glass, cx, LOW_H + (WALL_H - LOW_H) / 2, z);
          box(len, 0.05, WALL_T, M.cap, cx, WALL_H, z);
        }
        function wallZ(x, za, zb) {
          var len = zb - za, cz = (za + zb) / 2;
          box(WALL_T, LOW_H, len, M.wall, x, LOW_H / 2, cz);
          box(WALL_T + 0.02, 0.04, len, M.cap, x, LOW_H, cz);
          box(0.03, WALL_H - LOW_H, len, M.glass, x, LOW_H + (WALL_H - LOW_H) / 2, cz);
          box(WALL_T, 0.05, len, M.cap, x, WALL_H, cz);
        }
        function glassFront(xa, xb, z, parent) {
          var len = xb - xa, cx = (xa + xb) / 2;
          if (len <= 0.05) return;
          box(len, 0.1, 0.1, M.cap, cx, 0.05, z, parent);
          box(len, WALL_H - 0.1, 0.03, M.glass, cx, 0.1 + (WALL_H - 0.1) / 2, z, parent);
          box(len, 0.05, 0.1, M.cap, cx, WALL_H, z, parent);
          for (var x = xa + 1.8; x < xb - 0.4; x += 1.8) box(0.04, WALL_H, 0.06, M.cap, x, WALL_H / 2, z, parent);
        }
        function chair(x, z, dir, seatMat) {   // dir: 앉은 사람이 보는 쪽 (+1 = +z)
          box(0.48, 0.08, 0.48, seatMat, x, 0.45, z);
          box(0.48, 0.5, 0.07, seatMat, x, 0.78, z - dir * 0.25);
          box(0.05, 0.38, 0.05, M.metal, x, 0.22, z);
          box(0.5, 0.04, 0.08, M.chair, x, 0.04, z);
          box(0.08, 0.04, 0.5, M.chair, x, 0.04, z);
        }
        function armchair(x, z, dir) {
          box(0.7, 0.4, 0.62, M.sofa, x, 0.2, z);
          box(0.62, 0.1, 0.56, M.sofaSeat, x, 0.44, z + dir * 0.02);
          box(0.7, 0.5, 0.16, M.sofa, x, 0.62, z - dir * 0.28);
          box(0.12, 0.2, 0.6, M.sofa, x - 0.32, 0.5, z);
          box(0.12, 0.2, 0.6, M.sofa, x + 0.32, 0.5, z);
        }
        function laptop(x, z, dir) {   // dir: 쓰는 사람이 보는 쪽. 화면이 사람 쪽을 본다.
          var grp = new T.Group();
          grp.position.set(x, 0.72, z);
          if (dir < 0) grp.rotation.y = Math.PI;
          mesh(G.box, M.laptop, 0.34, 0.02, 0.24, 0, 0, 0, grp);
          var lid = new T.Group();
          lid.position.set(0, 0.01, 0.12);
          lid.rotation.x = 0.22;
          grp.add(lid);
          mesh(G.box, M.laptop, 0.34, 0.23, 0.015, 0, 0.115, 0, lid);
          var scr = mesh(G.plane, M.screenOff, 0.3, 0.19, 1, 0, 0.115, -0.009, lid);
          scr.rotation.y = Math.PI;
          grp.traverse(function (o) { if (o.isMesh) o.castShadow = true; });
          grp.visible = false;
          dyn.add(grp);
          return { grp: grp, scr: scr };
        }
        // 명패: 유리벽(xa~xb, 앞면 z)에 붙이는 이름판. 글씨는 drawPlate 가 쓰고, 크기는 fitPlates 가 화면에 맞춰 키운다.
        function makePlate(xa, xb, z) {
          var tc = textCanvas(PLATE_CW, PLATE_CH);
          var m = new T.MeshBasicMaterial({ map: tc.tex, transparent: true, depthWrite: false });
          trash.push(m, tc.tex);
          var pl = { tc: tc, x: (xa + xb) / 2, z: z + 0.07, room: xb - xa, w: 1, maxS: 1, key: '', small: false };
          pl.mesh = mesh(G.plane, m, 1, PLATE_H, 1, pl.x, PLATE_Y, pl.z, dyn);
          pl.mesh.renderOrder = 2;
          W.plates.push(pl);
          return pl;
        }

        // ---------- 꾸밈 가구 (아래쪽 방·탕비실). 모두 root 에 넣어 재료별로 합친다 ----------
        function grp(x, z, yaw) {   // 돌려 놓는 가구 묶음. yaw 0 이면 앞(앉은 사람이 보는 쪽)이 +z
          var g = new T.Group();
          g.position.set(x, 0, z);
          g.rotation.y = yaw || 0;
          root.add(g);
          return g;
        }
        function seatChair(x, z, yaw, mat) {
          var g = grp(x, z, yaw);
          box(0.44, 0.06, 0.44, mat, 0, 0.46, 0, g);
          box(0.44, 0.42, 0.06, mat, 0, 0.72, -0.2, g);
          box(0.04, 0.44, 0.04, M.metal, 0, 0.22, 0, g);
          box(0.42, 0.03, 0.06, M.chair, 0, 0.02, 0, g);
          box(0.06, 0.03, 0.42, M.chair, 0, 0.02, 0, g);
        }
        function roundTable(x, z, d, h) {
          mesh(G.cyl, M.table, d, 0.05, d, x, h, z, root);
          mesh(G.cyl, M.metal, 0.07, h, 0.07, x, h / 2, z, root);
          mesh(G.cyl, M.metal, d * 0.55, 0.03, d * 0.55, x, 0.015, z, root);
        }
        function stool(x, z, mat) {
          mesh(G.cyl, mat, 0.36, 0.06, 0.36, x, 0.7, z, root);
          mesh(G.cyl, M.metal, 0.05, 0.68, 0.05, x, 0.34, z, root);
          mesh(G.cyl, M.metal, 0.32, 0.03, 0.32, x, 0.015, z, root);
        }
        function floorLamp(x, z) {
          mesh(G.cyl, M.metal, 0.28, 0.03, 0.28, x, 0.015, z, root);
          mesh(G.cyl, M.metal, 0.03, 1.45, 0.03, x, 0.74, z, root);
          mesh(G.cyl, M.bulb, 0.36, 0.26, 0.36, x, 1.55, z, root);
        }
        function tree(x, z, sc) {   // 키 큰 화분 나무
          mesh(G.cyl, M.pot, 0.42 * sc, 0.42 * sc, 0.42 * sc, x, 0.21 * sc, z, root);
          mesh(G.cyl, M.tableEdge, 0.06 * sc, 0.9 * sc, 0.06 * sc, x, 0.8 * sc, z, root);
          mesh(G.ico, M.plant, 0.8 * sc, 0.75 * sc, 0.8 * sc, x, 1.35 * sc, z, root);
          mesh(G.ico, M.plantDark, 0.55 * sc, 0.5 * sc, 0.55 * sc, x - 0.18 * sc, 1.12 * sc, z + 0.12 * sc, root);
          mesh(G.ico, M.plant, 0.5 * sc, 0.48 * sc, 0.5 * sc, x + 0.16 * sc, 1.72 * sc, z - 0.08 * sc, root);
        }
        function rug(x, z, w, d, m) { box(w, 0.008, d, m || M.rug, x, 0.016, z); }
        // 침대 이불 두 벌: 빈 침대는 발치에 개어 둔 이불, 누가 자면 어깨 아래를 덮는 볼록한 이불 (frame 에서 바꿔 보인다)
        function blanket(x, z, m) {
          var folded = new T.Group(), draped = new T.Group();
          folded.position.set(x, 0, z);
          draped.position.set(x, 0, z);
          mesh(G.box, m, 0.88, 0.07, 0.42, 0, 0.535, 0.62, folded);
          mesh(G.box, m, 0.84, 0.06, 0.38, 0, 0.6, 0.62, folded);
          mesh(G.box, M.white, 0.85, 0.015, 0.06, 0, 0.635, 0.45, folded);
          mesh(G.box, m, 0.98, 0.05, 1.56, 0, 0.525, 0.3, draped);
          mesh(G.box, m, 0.03, 0.16, 1.56, -0.49, 0.44, 0.3, draped);
          mesh(G.box, m, 0.03, 0.16, 1.56, 0.49, 0.44, 0.3, draped);
          mesh(G.box, m, 0.98, 0.16, 0.03, 0, 0.44, 1.08, draped);
          var mound = mesh(G.sph, m, 0.86, 0.62, 1.56, 0, 0.56, 0.3, draped);
          mesh(G.box, m, 0.8, 0.22, 0.8, 0, 0.63, 0.62, draped);   // 발끝이 이불 밖으로 비치지 않게 다리 쪽을 조금 더 높게
          mound.castShadow = true;
          mesh(G.box, M.white, 0.97, 0.06, 0.14, 0, 0.535, -0.43, draped);
          draped.visible = false;
          dyn.add(folded, draped);
          return { folded: folded, draped: draped };
        }
        function chairAt(g, seatMat) {   // chair 와 같은 모양을 묶음 g 안에 (앞 = +z)
          box(0.48, 0.08, 0.48, seatMat, 0, 0.45, 0, g);
          box(0.48, 0.5, 0.07, seatMat, 0, 0.78, -0.25, g);
          box(0.05, 0.38, 0.05, M.metal, 0, 0.22, 0, g);
          box(0.5, 0.04, 0.08, M.chair, 0, 0.04, 0, g);
          box(0.08, 0.04, 0.5, M.chair, 0, 0.04, 0, g);
        }
        function armchairAt(g) {   // armchair 와 같은 모양을 묶음 g 안에 (앞 = +z)
          box(0.7, 0.4, 0.62, M.sofa, 0, 0.2, 0, g);
          box(0.62, 0.1, 0.56, M.sofaSeat, 0, 0.44, 0.02, g);
          box(0.7, 0.5, 0.16, M.sofa, 0, 0.62, -0.28, g);
          box(0.12, 0.2, 0.6, M.sofa, -0.32, 0.5, 0, g);
          box(0.12, 0.2, 0.6, M.sofa, 0.32, 0.5, 0, g);
        }
        function sofaAt(g, len) {   // 길이 len 소파를 묶음 g 안에 (앞 = +z)
          box(len, 0.4, 0.8, M.sofa, 0, 0.2, 0, g);
          box(len - 0.1, 0.1, 0.7, M.sofaSeat, 0, 0.44, 0.05, g);
          box(len, 0.5, 0.18, M.sofa, 0, 0.62, -0.36, g);
          box(0.14, 0.22, 0.8, M.sofa, -len / 2 + 0.07, 0.5, 0, g);
          box(0.14, 0.22, 0.8, M.sofa, len / 2 - 0.07, 0.5, 0, g);
        }
        function nook(cx, cz) {   // 깔개 위에 마주 보는 안락의자 둘, 가운데 작은 탁자, 뒤에 스탠드 (폭 2.6 · 깊이 1.8)
          rug(cx, cz, 2.6, 1.8, M.carpet);
          armchairAt(grp(cx - 0.85, cz, Math.PI / 2));
          armchairAt(grp(cx + 0.85, cz, -Math.PI / 2));
          roundTable(cx, cz, 0.55, 0.45);
          floorLamp(cx, cz - 0.7);
        }

        // 방 배치: 컴퓨터마다 묶고, 한 줄에 cols 개씩. 다른 컴퓨터가 있으면 컴퓨터마다(이 컴퓨터도) 앞에 층 안내 띠를 둔다.
        var groups = [];
        s.rooms.forEach(function (r) {
          var last = groups[groups.length - 1];
          if (!last || last.machine !== r.machine) { last = { machine: r.machine, rooms: [] }; groups.push(last); }
          last.rooms.push(r);
        });
        var multi = groups.some(function (gr) { return gr.machine; });
        SPINE = SPINE0 + (multi ? SIDE_W : 0);
        var cols = colsFor(s.rooms.length);
        var z = 0, maxX = SPINE + cols * roomWidth(4), rooms = {}, rows = [], zones = [], breaks = [], labels = [];
        groups.forEach(function (gr) {
          if (multi) {
            zones.push({ name: gr.machine || s.self || '이 컴퓨터', self: !gr.machine, color: ZONE_COLORS[zones.length % ZONE_COLORS.length], z0: z, z1: z + ZONE_D });
            z += ZONE_D;
          }
          for (var i = 0; i < gr.rooms.length; i += cols) {
            var row = { i: rows.length, z0: z, zc: z + ROOM_D + CORR / 2, x1: SPINE, rooms: [] };
            gr.rooms.slice(i, i + cols).forEach(function (r) {
              var R = roomGeo(r, row.x1, z, row);
              rooms[r.name] = R;
              row.rooms.push(R);
              row.x1 = R.x1;
            });
            row.pantry = { x0: row.x1, x1: row.x1 + PANTRY_W };
            row.x1 += PANTRY_W;
            maxX = Math.max(maxX, row.x1);
            rows.push(row);
            z += ROOM_D + CORR;
          }
        });
        var zL = z, lobby = { z0: zL, z1: zL + LOBBY_D };
        W = { rooms: rooms, rows: rows, zones: zones, lobby: lobby, width: maxX, depth: lobby.z1, laneZ: zL + 0.8, breaks: breaks, labels: labels, plates: [], cut: [], trash: trash, M: M };

        // 햇빛 그림자가 사무실 전체에 닿게
        var cx0 = maxX / 2, cz0 = lobby.z1 / 2, rad = Math.hypot(maxX, lobby.z1) / 2 + 1;
        sun.position.set(cx0 - 14, 34, cz0 + 22);
        sun.target.position.set(cx0, 0, cz0);
        sun.target.updateMatrixWorld();
        var sc = sun.shadow.camera;
        sc.left = -rad; sc.right = rad; sc.top = rad; sc.bottom = -rad; sc.near = 1; sc.far = 140;
        sc.updateProjectionMatrix();

        // 바닥: 건물 타일, 로비 마루
        var tex = tileTexture(P.floor, P.floorLine, false);
        tex.repeat.set(maxX / 1.2, Math.max(zL, 1) / 1.2);
        var fm = new T.MeshLambertMaterial({ map: tex });
        trash.push(fm, tex);
        if (zL > 0) { var fl = mesh(G.plane, fm, maxX, zL, 1, maxX / 2, 0, zL / 2, keep); fl.rotation.x = -Math.PI / 2; fl.receiveShadow = true; }
        var ltex = tileTexture(P.lobby, P.lobbyLine, true);
        ltex.repeat.set(maxX / 2.4, LOBBY_D / 2.4);
        var lm = new T.MeshLambertMaterial({ map: ltex });
        trash.push(lm, ltex);
        var lf = mesh(G.plane, lm, maxX, LOBBY_D, 1, maxX / 2, 0, zL + LOBBY_D / 2, keep);
        lf.rotation.x = -Math.PI / 2;
        lf.receiveShadow = true;
        // 층 안내 (컴퓨터가 여럿일 때). 화면에 떠 있는 카드 대신 바닥에 칠한다.
        // - 가로 띠: 층 색으로 물든 바닥, 양쪽 색 줄, 크게 쓴 층 이름과 그 옆에 작게 '이 컴퓨터' / 'n분 전 동기화'
        // - 세로 줄: 건물 맨 왼쪽 띠에 그 층 방들이 이어지는 만큼 색 줄 두 개, 그 사이에 층 이름·동기화를 눕혀 쓴다
        // 동기화 글씨는 바뀔 때마다 updateZones 가 캔버스에 다시 그린다.
        zones.forEach(function (zn, zi) {
          var zc = (zn.z0 + zn.z1) / 2, edge = lam(zn.color), tint = lam(new T.Color(P.floor).lerp(new T.Color(zn.color), 0.18));
          box(maxX - SIDE_W, 0.012, ZONE_D - 0.3, tint, (maxX + SIDE_W) / 2, 0.006, zc);
          box(maxX - SIDE_W, 0.016, 0.12, edge, (maxX + SIDE_W) / 2, 0.008, zn.z0 + 0.2);
          box(maxX - SIDE_W, 0.016, 0.12, edge, (maxX + SIDE_W) / 2, 0.008, zn.z1 - 0.2);
          // 글씨는 띠 뒤쪽에 쓴다 (앞쪽은 카메라에서 보면 바로 앞 방 뒷벽에 가린다)
          var paint = floorText(zn.name + ' 층', zn.color), span = maxX - SPINE - 1;
          var th = Math.min(ZONE_D - 1.4, span / paint.aspect), tw = th * paint.aspect;
          for (var tx = SPINE + 0.6; tx === SPINE + 0.6 || tx + tw <= maxX - 0.4; tx += tw + 9) {
            var tm = mesh(G.plane, paint.mat, tw, th, 1, tx + tw / 2, 0.02, zn.z0 + 0.35 + th / 2, keep);
            tm.rotation.x = -Math.PI / 2;
            tm.receiveShadow = true;
          }
          zn.band = zoneCanvas(1024, 128);
          var sh = Math.min(0.9, th * 0.5), sw = sh * 8;
          var sm = mesh(G.plane, zn.band.mat, sw, sh, 1, SPINE + 0.6 + tw + 0.25 + sw / 2, 0.021, zn.z0 + 0.35 + th * 0.62, keep);
          sm.rotation.x = -Math.PI / 2;
          // 세로 줄: 그 층의 띠부터 다음 층(또는 로비) 앞까지
          var zEnd = zi + 1 < zones.length ? zones[zi + 1].z0 : zL, len = zEnd - zn.z0 - 0.3, mz = zn.z0 + 0.15 + len / 2;
          box(SIDE_W - 0.2, 0.012, len, tint, SIDE_W / 2, 0.006, mz);
          box(0.1, 0.016, len, edge, 0.17, 0.008, mz);
          box(0.1, 0.016, len, edge, SIDE_W - 0.17, 0.008, mz);
          // 캔버스 길이는 층 이름 + 가장 긴 상태 글씨에 맞춘다 (남는 자리 없이 글씨를 크게)
          zn.side = zoneCanvas(zoneSideWidth(zn.name), 192);
          var vh = SIDE_W - 0.55, vw = vh * zn.side.c.width / 192;
          if (vw > len - 0.4) { vw = len - 0.4; vh = vw * 192 / zn.side.c.width; }
          var vm = mesh(G.plane, zn.side.mat, vw, vh, 1, SIDE_W / 2, 0.021, mz, keep);
          vm.rotation.set(-Math.PI / 2, 0, Math.PI / 2);   // 글씨가 앞(카메라 쪽)에서 안쪽으로 읽히고, 글자 위가 바깥(왼쪽)을 본다
          drawZoneTags(zn, zn.self ? '이 컴퓨터' : '');
        });

        // 방
        var roomNo = 0;
        rows.forEach(function (row) {
          row.rooms.forEach(function (R, ri) {
            var x0 = R.x0, z0 = R.z0, w = R.w, z1 = R.z1, lounge = R.kind === 'lounge';
            var seatMat = M.seats[roomNo++ % M.seats.length];
            box(w - WALL_T, 0.012, ROOM_D - WALL_T, lounge ? M.lounge : M.carpet, x0 + w / 2, 0.006, z0 + ROOM_D / 2);
            wallX(x0, x0 + w, z0);
            wallZ(x0, z0, z1);
            if (ri === row.rooms.length - 1) wallZ(x0 + w, z0, z1);
            // 앞 유리벽은 방마다 따로 묶는다 (그 방에 들어가 볼 때는 치운다)
            var dl = R.xSide - 0.6, dr = R.xSide + 0.6, front = new T.Group();
            glassFront(x0, dl, z1, front);
            glassFront(dr, x0 + w, z1, front);
            box(0.08, WALL_H, 0.12, M.cap, dl, WALL_H / 2, z1, front);
            box(0.08, WALL_H, 0.12, M.cap, dr, WALL_H / 2, z1, front);
            box(dr - dl, 0.14, 0.12, M.cap, R.xSide, WALL_H - 0.07, z1, front);
            R.front = mergeStatic(front);
            R.front.traverse(function (o) { if (o.isMesh) trash.push(o.geometry); });
            dyn.add(R.front);
            box(1.1, 0.01, 0.55, M.mat, R.xSide, 0.006, z1 + 0.4);
            if (lounge) {
              box(R.tlen + 0.5, 0.008, 2.9, M.rug, R.tcx, 0.016, R.zTable);
              box(R.tlen - 0.5, 0.05, 0.7, M.table, R.tcx, 0.42, R.zTable);
              box(0.06, 0.4, 0.6, M.tableEdge, R.tx0 + 0.4, 0.2, R.zTable);
              box(0.06, 0.4, 0.6, M.tableEdge, R.tx0 + R.tlen - 0.4, 0.2, R.zTable);
            } else {
              box(R.tlen, 0.06, 1.1, M.table, R.tcx, 0.69, R.zTable);   // 윗면 0.72
              box(R.tlen - 0.1, 0.04, 1.0, M.tableEdge, R.tcx, 0.65, R.zTable);
              box(0.08, 0.63, 0.8, M.tableEdge, R.tx0 + 0.25, 0.315, R.zTable);
              box(0.08, 0.63, 0.8, M.tableEdge, R.tx0 + R.tlen - 0.25, 0.315, R.zTable);
            }
            R.seatX.forEach(function (x) {
              if (lounge) { armchair(x, R.zFar, 1); armchair(x, R.zNear, -1); }
              else {
                chair(x, R.zFar, 1, seatMat);
                chair(x, R.zNear, -1, seatMat);
                R.laptops.far.push(laptop(x, R.zTable - 0.3, 1));
                R.laptops.near.push(laptop(x, R.zTable + 0.3, -1));
              }
            });
            // 탁자 양 끝 머리 자리 의자 (빈 자리를 채운다. 오른쪽은 문 쪽 통로에 닿지 않게)
            if (lounge) {
              armchairAt(grp(R.tx0 - 0.25, R.zTable, Math.PI / 2));
              armchairAt(grp(R.tx0 + R.tlen + 0.25, R.zTable, -Math.PI / 2));
            } else {
              chairAt(grp(R.tx0 - 0.42, R.zTable, Math.PI / 2), seatMat);
              chairAt(grp(R.tx0 + R.tlen + 0.42, R.zTable, -Math.PI / 2), seatMat);
            }
            plant(x0 + 0.45, z1 - 0.45, 1);
            // 화이트보드 (뒷벽)
            var bw = Math.min(2.4, R.tlen * 0.8), bh = bw * 272 / 512;
            box(bw + 0.08, bh + 0.08, 0.04, M.frame, R.tcx, 1.5, z0 + WALL_T / 2 + 0.02);
            R.board = textCanvas(512, 272);
            var bm = new T.MeshBasicMaterial({ map: R.board.tex });
            trash.push(bm, R.board.tex);
            mesh(G.plane, bm, bw, bh, 1, R.tcx, 1.5, z0 + WALL_T / 2 + 0.045, keep);
            // 문 위 상태등
            var lampMat = new T.MeshBasicMaterial({ color: '#8f969d' });
            trash.push(lampMat);
            R.lamp = mesh(G.box, lampMat, 0.3, 0.07, 0.07, R.xSide, WALL_H + 0.06, z1 + 0.02, dyn);
            // 명패: 앞 유리 문 왼쪽 칸 가운데. 너무 멀거나 뒤에서 볼 때만 그 자리에 글자 이름표를 띄운다.
            R.plate = makePlate(x0 + 0.1, dl - 0.05, z1);
            var el = document.createElement('button');
            el.type = 'button';
            el.className = 'o3-room';
            el.setAttribute('data-room', R.name);
            layer.appendChild(el);
            R.label = el;
            labels.push({ el: el, plate: R.plate, ax: '-50%', ay: '-50%', room: R.name });
          });
          // 복도: 방 사이 화분
          var zb = row.z0 + ROOM_D + CORR - 0.35;
          row.rooms.forEach(function (R, i) { if (i) plant(R.x0, zb, 0.8); });
          plant(0.45, row.z0 + 1.0, 0.9);
          // 탕비실: 줄 오른쪽 끝, 복도 쪽에 문. 커피 바·냉장고·작은 소파. 이 줄 사람들이 멀리 안 가고 여기서 쉰다.
          var pk = row.pantry, px0 = pk.x0, px1 = pk.x1, pz0 = row.z0, pz1 = row.z0 + ROOM_D, pdoor = px0 + 1.0;
          var pplace = { t: 'corr', row: row, room: 'pantry' + row.i, door: pdoor, az: pz0 + 2.3 };
          pk.place = pplace;
          box(PANTRY_W - WALL_T, 0.012, ROOM_D - WALL_T, M.lounge, (px0 + px1) / 2, 0.006, (pz0 + pz1) / 2);
          wallX(px0, px1, pz0);
          wallZ(px1, pz0, pz1);
          glassFront(px0, pdoor - 0.6, pz1);
          glassFront(pdoor + 0.6, px1, pz1);
          box(0.08, WALL_H, 0.12, M.cap, pdoor - 0.6, WALL_H / 2, pz1);
          box(0.08, WALL_H, 0.12, M.cap, pdoor + 0.6, WALL_H / 2, pz1);
          box(1.2, 0.14, 0.12, M.cap, pdoor, WALL_H - 0.07, pz1);
          box(1.1, 0.01, 0.55, M.mat, pdoor, 0.006, pz1 + 0.4);
          var cw2 = PANTRY_W - 1.3;
          box(cw2, 0.95, 0.6, M.counter, px0 + 0.15 + cw2 / 2, 0.475, pz0 + 0.45);
          box(cw2 + 0.06, 0.04, 0.66, M.tableEdge, px0 + 0.15 + cw2 / 2, 0.97, pz0 + 0.45);
          box(0.4, 0.5, 0.38, M.dark, px0 + 0.55, 1.24, pz0 + 0.45);
          box(0.06, 0.06, 0.02, M.led, px0 + 0.55, 1.36, pz0 + 0.65);
          for (var cu = 0; cu < 4; cu++) mesh(G.cyl, M.white, 0.07, 0.09, 0.07, px0 + 1.2 + cu * 0.16, 1.035, pz0 + 0.45, root);
          box(0.85, 1.9, 0.7, M.fridge, px1 - 0.6, 0.95, pz0 + 0.45);
          box(0.03, 0.5, 0.02, M.metal, px1 - 0.25, 1.25, pz0 + 0.81);
          sofa(px1 - 0.55, pz0 + 3.6, 2.0, -1);
          box(0.6, 0.05, 0.9, M.table, px1 - 1.55, 0.4, pz0 + 3.6);
          box(0.5, 0.36, 0.06, M.tableEdge, px1 - 1.55, 0.2, pz0 + 3.6);
          plant(px0 + 0.45, pz1 - 0.5, 0.9);
          // 부엌 살림: 위 수납장, 개수대, 전자레인지, 과일 그릇, 정수기, 분리수거함, 높은 탁자와 의자, 소파 앞 깔개
          box(cw2, 0.62, 0.34, M.counter, px0 + 0.15 + cw2 / 2, 1.88, pz0 + 0.27);
          for (var cd = 1; cd < 4; cd++) box(0.015, 0.56, 0.01, M.tableEdge, px0 + 0.15 + cw2 * cd / 4, 1.88, pz0 + 0.445);
          box(cw2 + 0.04, 0.03, 0.36, M.tableEdge, px0 + 0.15 + cw2 / 2, 1.555, pz0 + 0.27);
          box(0.5, 0.012, 0.36, M.metal, px0 + 2.05, 0.995, pz0 + 0.45);
          mesh(G.cyl, M.metal, 0.03, 0.26, 0.03, px0 + 2.05, 1.12, pz0 + 0.22, root);
          box(0.03, 0.03, 0.16, M.metal, px0 + 2.05, 1.24, pz0 + 0.3);
          box(0.5, 0.3, 0.36, M.white, px0 + 2.7, 1.14, pz0 + 0.38);
          box(0.3, 0.2, 0.01, M.dark, px0 + 2.64, 1.14, pz0 + 0.565);
          box(0.08, 0.2, 0.01, M.mullion, px0 + 2.88, 1.14, pz0 + 0.565);
          box(0.32, 0.95, 0.32, M.cooler, px0 + 0.32, 0.475, pz0 + 3.0);
          mesh(G.cyl, M.water, 0.24, 0.36, 0.24, px0 + 0.32, 1.13, pz0 + 3.0, root);
          box(0.12, 0.05, 0.02, M.dark, px0 + 0.32, 0.8, pz0 + 3.17);
          [M.seats[1], M.seats[3], M.seats[2]].forEach(function (bm, i) {
            box(0.3, 0.5, 0.3, bm, px0 + 0.28, 0.25, pz0 + 4.0 + i * 0.36);
            box(0.32, 0.03, 0.32, M.dark, px0 + 0.28, 0.515, pz0 + 4.0 + i * 0.36);
          });
          mesh(G.cyl, M.table, 0.66, 0.04, 0.66, px0 + 2.1, 1.02, pz0 + 5.1, root);
          mesh(G.cyl, M.metal, 0.06, 1.0, 0.06, px0 + 2.1, 0.5, pz0 + 5.1, root);
          mesh(G.cyl, M.metal, 0.4, 0.03, 0.4, px0 + 2.1, 0.015, pz0 + 5.1, root);
          mesh(G.cyl, M.white, 0.26, 0.06, 0.26, px0 + 2.1, 1.07, pz0 + 5.1, root);
          M.fruit.forEach(function (fm, i) { mesh(G.sph, fm, 0.09, 0.09, 0.09, px0 + 2.04 + i * 0.06, 1.12, pz0 + 5.07 + (i % 2) * 0.06, root); });
          stool(px0 + 2.1, pz0 + 4.62, M.seats[4]);
          stool(px0 + 2.1, pz0 + 5.58, M.seats[4]);
          rug(px1 - 1.3, pz0 + 3.6, 1.6, 2.4);
          [0, 1].forEach(function (k) {
            breaks.push({ key: 'pcup' + row.i + k, place: pplace, x: px0 + 0.9 + k * 0.9, ax: px0 + 0.9 + k * 0.9, z: pz0 + 1.25, yaw: Math.PI, pose: 'cup' });
            breaks.push({ key: 'psofa' + row.i + k, place: pplace, x: px1 - 0.6, ax: px1 - 1.2, z: pz0 + 3.6 + (k ? 0.5 : -0.5), yaw: -Math.PI / 2, pose: k ? 'doze' : 'sofa' });
          });
          var pl = document.createElement('div');
          pl.className = 'o3-room static';
          pl.textContent = '탕비실';
          pl.style.setProperty('--rc', '#c9925a');
          layer.appendChild(pl);
          var ppl = makePlate(pdoor + 0.65, px1 - 0.1, pz1);
          drawPlate(ppl, '', '탕비실', '#c9925a', false);
          labels.push({ el: pl, plate: ppl, ax: '-50%', ay: '-50%', minPpm: 7 });
        });

        // 아래쪽: 엘리베이터 + 대표실 · 휴게실 · 수면실. 세 방은 벽과 문이 있고, 문 앞으로 로비 길(laneZ)이 지난다.
        var rz0 = zL + LANE_D, rz1 = lobby.z1;
        var ez = zL + LANE_D / 2;
        box(0.3, 2.5, 1.4, M.cap, 0.15, 1.25, ez);
        box(0.04, 2.1, 0.6, M.metal, 0.32, 1.05, ez - 0.31);
        box(0.04, 2.1, 0.6, M.metal, 0.32, 1.05, ez + 0.31);
        box(0.03, 0.14, 0.5, M.led, 0.32, 2.3, ez);
        W.elev = { key: 'elev', place: { t: 'lobby' }, x: 0.9, ax: 0.9, z: ez, yaw: -Math.PI / 2, pose: 'stand' };
        labels.push({ el: spotLabel('엘리베이터'), x: 0.3, y: 2.75, z: ez, ax: '-50%', ay: '-100%', minPpm: 9 });
        plant(spineX(), rz1 - 0.6, 1.2);
        plant(spineX(), rz0 + 1.2, 0.9);

        var avail = maxX - SPINE, xA = SPINE, xB = xA + avail * 0.36, xC = xB + avail * 0.37, xD = maxX;
        // 벽(아래 벽돌, 위 유리)과 위쪽 문이 있는 방 하나. 카메라 쪽(아래) 벽은 유리만 둔다.
        function lowerRoom(x0, x1, name, floorMat, accent) {
          var doorX = x0 + 1.3, Rm = { name: name, x0: x0, x1: x1, z0: rz0, z1: rz1, doorX: doorX };
          box(x1 - x0 - WALL_T, 0.012, rz1 - rz0 - WALL_T, floorMat, (x0 + x1) / 2, 0.007, (rz0 + rz1) / 2);
          wallX(x0, doorX - 0.6, rz0);
          wallX(doorX + 0.6, x1, rz0);
          box(0.08, WALL_H, 0.12, M.cap, doorX - 0.6, WALL_H / 2, rz0);
          box(0.08, WALL_H, 0.12, M.cap, doorX + 0.6, WALL_H / 2, rz0);
          box(1.2, 0.14, 0.12, M.cap, doorX, WALL_H - 0.07, rz0);
          box(1.1, 0.01, 0.55, M.mat, doorX, 0.006, rz0 - 0.4);
          wallZ(x0, rz0, rz1);
          wallZ(x1, rz0, rz1);
          glassFront(x0, x1, rz1);
          var el = document.createElement('div');
          el.className = 'o3-room static';
          el.textContent = name;
          el.style.setProperty('--rc', accent);
          layer.appendChild(el);
          // 명패는 카메라 쪽 유리 가운데
          var pl = makePlate(x0 + 0.3, x1 - 0.3, rz1);
          drawPlate(pl, '', name, accent, false);
          labels.push({ el: el, plate: pl, ax: '-50%', ay: '-50%' });
          Rm.place = function (az) { return { t: 'lobby', room: name, door: doorX, az: az }; };
          return Rm;
        }
        function shelf(x, z, w, rot) {   // 앞이 트인 책장 (rot: 왼쪽 벽을 따라 z 방향이면 true, 앞은 +x. 아니면 뒷벽을 따라, 앞은 +z)
          var g = grp(x, z, rot ? Math.PI / 2 : 0);
          box(w, 1.9, 0.03, M.tableEdge, 0, 0.95, -0.185, g);
          box(0.04, 1.9, 0.4, M.tableEdge, -w / 2 + 0.02, 0.95, 0, g);
          box(0.04, 1.9, 0.4, M.tableEdge, w / 2 - 0.02, 0.95, 0, g);
          box(w, 0.04, 0.4, M.tableEdge, 0, 1.88, 0, g);
          box(w, 0.08, 0.4, M.tableEdge, 0, 0.04, 0, g);
          for (var sy = 0.35; sy < 1.8; sy += 0.42) {
            box(w - 0.08, 0.03, 0.38, M.table, 0, sy, 0, g);
            for (var bk = 0; bk < 5; bk++) {
              var off = -w / 2 + 0.2 + bk * (w - 0.3) / 5, mat = M.seats[(bk + Math.round(sy * 10)) % M.seats.length];
              box(0.1, 0.27 + (bk % 3) * 0.02, 0.28, mat, off, sy + 0.16, -0.03, g);
            }
          }
        }
        function sofa(cx, cz, len, face) {   // face: 앉은 사람이 보는 쪽 (+1 = +x, -1 = -x)
          box(0.8, 0.4, len, M.sofa, cx, 0.2, cz);
          box(0.7, 0.1, len - 0.1, M.sofaSeat, cx + face * 0.05, 0.44, cz);
          box(0.18, 0.5, len, M.sofa, cx - face * 0.36, 0.62, cz);
          box(0.8, 0.22, 0.14, M.sofa, cx, 0.5, cz - len / 2 + 0.02);
          box(0.8, 0.22, 0.14, M.sofa, cx, 0.5, cz + len / 2 - 0.02);
        }

        // 대표실: 큰 책상과 의자(대표 자리), 책장, 손님 소파. 승인·답변을 기다리는 사람은 책상 앞에 줄을 선다.
        var ceoR = lowerRoom(xA, xB, '대표실', M.ceoFloor, '#d4a017');
        var dx = xA + (xB - xA) * 0.48, dz = rz0 + 2.9;
        box(3.2, 0.008, 2.6, M.rug, dx, 0.016, dz + 0.1);
        // 책상 윗면 0.745, 대표 의자는 책상 모서리에서 0.47 뒤 (방 책상과 같은 이유로 조금 낮추고 뒤로 뺐다)
        var chairZ = dz - 0.99;
        box(2.4, 0.07, 1.05, M.desk, dx, 0.71, dz);
        box(2.3, 0.65, 0.05, M.desk, dx, 0.345, dz + 0.48);
        box(0.06, 0.67, 1.0, M.desk, dx - 1.15, 0.335, dz);
        box(0.06, 0.67, 1.0, M.desk, dx + 1.15, 0.335, dz);
        box(0.7, 0.42, 0.04, M.dark, dx - 0.2, 1.03, dz - 0.25);
        box(0.06, 0.2, 0.06, M.dark, dx - 0.2, 0.83, dz - 0.25);
        box(0.05, 0.45, 0.05, M.metal, dx + 0.85, 0.94, dz - 0.2);
        box(0.22, 0.12, 0.22, M.led, dx + 0.85, 1.2, dz - 0.2);
        box(0.6, 0.1, 0.58, M.chair, dx, 0.47, chairZ);
        box(0.64, 1.05, 0.12, M.chair, dx, 1.05, chairZ - 0.32);
        box(0.05, 0.4, 0.05, M.metal, dx, 0.22, chairZ);
        box(0.56, 0.04, 0.08, M.metal, dx, 0.04, chairZ);
        box(0.08, 0.04, 0.56, M.metal, dx, 0.04, chairZ);
        var np = textCanvas(256, 72), nx = np.canvas.getContext('2d');
        nx.fillStyle = '#fffdf8';
        nx.fillRect(0, 0, 256, 72);
        nx.fillStyle = '#2b2118';
        nx.font = '800 40px ' + FONT;
        nx.textAlign = 'center';
        nx.textBaseline = 'middle';
        nx.fillText('대표', 128, 38);
        var nm = new T.MeshBasicMaterial({ map: np.tex });
        trash.push(nm, np.tex);
        mesh(G.plane, nm, 0.62, 0.17, 1, dx, 0.55, dz + 0.505, keep);
        shelf(xA + 0.35, rz0 + 2.2, 1.6, true);
        shelf(xA + 0.35, rz0 + 4.0, 1.6, true);
        sofa(xB - 0.65, rz1 - 1.7, 2.0, -1);
        box(0.7, 0.05, 1.1, M.table, xB - 1.75, 0.4, rz1 - 1.7);
        box(0.6, 0.36, 0.06, M.tableEdge, xB - 1.75, 0.2, rz1 - 1.7);
        plant(xB - 0.5, rz0 + 0.6, 1.2);
        plant(xA + 0.5, rz1 - 0.5, 1.1);
        // 대표실 꾸밈 (사람이 다니는 길: 문 → rz0+0.75 → 대표 의자, 문 → 책상 앞 줄. 그 길은 비워 둔다)
        //   책상 뒤 낮은 장(트로피·액자·분재), 책상 옆 스탠드, 문 옆 옷걸이, 앞 유리 쪽 어항, 소파 쪽 깔개·안락의자·스탠드, 넓으면 오른쪽 원탁 회의 자리
        box(2.5, 0.66, 0.38, M.desk, dx, 0.33, rz0 + 0.28);
        box(2.56, 0.04, 0.42, M.tableEdge, dx, 0.68, rz0 + 0.28);
        for (var cdv = -1; cdv <= 1; cdv++) box(0.015, 0.5, 0.01, M.tableEdge, dx + cdv * 0.62, 0.33, rz0 + 0.475);
        [-0.95, -0.6].forEach(function (o, i) {
          mesh(G.cyl, M.dark, 0.14, 0.05, 0.14, dx + o, 0.725, rz0 + 0.28, root);
          mesh(G.cyl, M.gold, 0.05, 0.14 + i * 0.05, 0.05, dx + o, 0.82 + i * 0.025, rz0 + 0.28, root);
          mesh(G.sph, M.gold, 0.16, 0.13, 0.16, dx + o, 0.93 + i * 0.05, rz0 + 0.28, root);
        });
        [[-0.05, 0.3, 0.24], [0.32, 0.24, 0.3]].forEach(function (f) {
          var fr = box(f[1], f[2], 0.03, M.dark, dx + f[0], 0.7 + f[2] / 2, rz0 + 0.24);
          fr.rotation.x = -0.12;
          var ph = box(f[1] - 0.06, f[2] - 0.06, 0.01, M.seats[f[0] < 0 ? 1 : 3], dx + f[0], 0.7 + f[2] / 2, rz0 + 0.26);
          ph.rotation.x = -0.12;
        });
        mesh(G.cyl, M.pot, 0.2, 0.12, 0.2, dx + 0.9, 0.76, rz0 + 0.28, root);
        mesh(G.ico, M.plantDark, 0.34, 0.24, 0.3, dx + 0.9, 0.93, rz0 + 0.28, root);
        floorLamp(dx + 1.6, dz - 0.6);
        mesh(G.cyl, M.metal, 0.3, 0.03, 0.3, xA + 0.4, 0.015, rz0 + 0.5, root);
        mesh(G.cyl, M.metal, 0.04, 1.75, 0.04, xA + 0.4, 0.875, rz0 + 0.5, root);
        box(0.36, 0.03, 0.03, M.metal, xA + 0.4, 1.72, rz0 + 0.5);
        box(0.34, 0.62, 0.12, M.seats[5], xA + 0.4, 1.36, rz0 + 0.58);
        mesh(G.cap, M.dark, 0.28, 0.2, 0.28, xA + 0.4, 1.77, rz0 + 0.5, root);
        if (dx - 1.7 > xA + 2.9) {
          box(1.6, 0.72, 0.46, M.desk, xA + 1.95, 0.36, rz1 - 0.42);
          box(1.56, 0.5, 0.42, M.tank, xA + 1.95, 0.97, rz1 - 0.42);
          box(1.6, 0.04, 0.46, M.dark, xA + 1.95, 1.24, rz1 - 0.42);
          box(1.5, 0.06, 0.38, M.counter, xA + 1.95, 0.75, rz1 - 0.42);
          [[-0.5, 0.95, 0], [-0.1, 1.05, 1], [0.35, 0.9, 0], [0.55, 1.08, 1]].forEach(function (f) {
            box(0.11, 0.05, 0.03, f[2] ? M.gold : M.fish, xA + 1.95 + f[0], f[1], rz1 - 0.4 + f[2] * 0.08);
          });
          [-0.62, -0.3, 0.2, 0.6].forEach(function (o, i) { mesh(G.cyl, M.plantDark, 0.04, 0.22 + (i % 2) * 0.12, 0.04, xA + 1.95 + o, 0.86 + (i % 2) * 0.06, rz1 - 0.48, root); });
        }
        rug(xB - 1.55, rz1 - 1.7, 2.7, 2.6, M.carpet);
        floorLamp(xB - 0.45, rz1 - 0.4);
        if (xB - 3.2 > dx + 1.8) { var ac = grp(xB - 2.75, rz1 - 1.7, Math.PI / 2); armchairAt(ac); }
        if (xB - 4.0 > dx + 1.8) {
          var mtx = xB - 2.5, mtz = rz0 + 2.0;
          roundTable(mtx, mtz, 1.15, 0.72);
          [0, 1, 2, 3].forEach(function (k) {
            var ang = k * Math.PI / 2 + Math.PI / 4;
            seatChair(mtx + Math.sin(ang) * 0.78, mtz + Math.cos(ang) * 0.78, ang + Math.PI, M.chair);
          });
          box(0.04, 1.0, 1.3, M.white, xB - 0.13, 1.3, mtz);
          box(0.05, 1.08, 1.38, M.frame, xB - 0.09, 1.3, mtz);
          mesh(G.cyl, M.rug, 2.7, 0.008, 2.7, mtx, 0.016, mtz, root);
        }
        tree(xB - 0.5, rz1 - 2.9, 1.0);
        // 뒷벽 진열장 (유리문 안에 트로피·상패)
        if (dx + 3.0 < xB - 0.9) {
          var vx = dx + 2.2;
          box(1.4, 1.75, 0.03, M.desk, vx, 0.875, rz0 + 0.115);
          box(0.05, 1.75, 0.4, M.desk, vx - 0.675, 0.875, rz0 + 0.3);
          box(0.05, 1.75, 0.4, M.desk, vx + 0.675, 0.875, rz0 + 0.3);
          box(1.4, 0.05, 0.4, M.desk, vx, 1.725, rz0 + 0.3);
          box(1.4, 0.3, 0.4, M.desk, vx, 0.15, rz0 + 0.3);
          box(1.3, 1.4, 0.02, M.tank, vx, 1.0, rz0 + 0.51);
          [0.55, 1.05, 1.5].forEach(function (sy, i) {
            box(1.3, 0.03, 0.34, M.counter, vx, sy, rz0 + 0.3);
            [-0.4, 0, 0.4].forEach(function (o, k) {
              if ((i + k) % 2) box(0.2, 0.26, 0.04, M.gold, vx + o, sy + 0.14, rz0 + 0.25);
              else { mesh(G.cyl, M.gold, 0.08, 0.16, 0.08, vx + o, sy + 0.09, rz0 + 0.3, root); mesh(G.sph, M.gold, 0.15, 0.12, 0.15, vx + o, sy + 0.22, rz0 + 0.3, root); }
            });
          });
        }
        // 책장 앞 지구본
        mesh(G.cyl, M.tableEdge, 0.3, 0.04, 0.3, xA + 0.95, 0.02, rz0 + 5.35, root);
        mesh(G.cyl, M.tableEdge, 0.05, 0.7, 0.05, xA + 0.95, 0.37, rz0 + 5.35, root);
        mesh(G.sph, M.water, 0.42, 0.42, 0.42, xA + 0.95, 0.92, rz0 + 5.35, root);
        mesh(G.ico, M.plant, 0.2, 0.16, 0.16, xA + 1.0, 1.0, rz0 + 5.45, root);
        mesh(G.ico, M.plant, 0.14, 0.12, 0.12, xA + 0.86, 0.85, rz0 + 5.5, root);
        // 방이 넓으면(화면이 넓어 한 줄에 방이 많을 때) 빈 바닥에 손님 자리를 더 둔다: 문~대표 의자 길과 줄 서는 길 사이, 앞쪽 오른편
        if (dx - 1.9 - (xA + 1.9) >= 2.8) nook((xA + 1.9 + dx - 1.9) / 2, rz0 + 2.3);
        if (xB - 3.3 - (dx + 1.8) >= 2.8) nook((dx + 1.8 + xB - 3.3) / 2, rz0 + 5.6);
        W.desk = { x: dx, z: dz, room: ceoR };
        W.ceoSeat = { key: 'ceo-seat', place: ceoR.place(rz0 + 0.75), x: dx, ax: dx, z: chairZ, yaw: 0, pose: 'sit' };

        // 휴게실: 커피 바, 마주 보는 소파 둘, 자판기, 동그란 탁자
        var loungeR = lowerRoom(xB, xC, '휴게실', M.lounge, '#4fae7c');
        var bz = rz0 + 0.45, bx0 = xC - 3.6;
        box(3.2, 0.95, 0.6, M.counter, bx0 + 1.6, 0.475, bz);
        box(3.26, 0.04, 0.66, M.tableEdge, bx0 + 1.6, 0.97, bz);
        box(0.4, 0.5, 0.38, M.dark, bx0 + 0.5, 1.24, bz);
        box(0.06, 0.06, 0.02, M.led, bx0 + 0.5, 1.36, bz + 0.2);
        for (var c = 0; c < 5; c++) mesh(G.cyl, M.white, 0.07, 0.09, 0.07, bx0 + 1.3 + c * 0.16, 1.035, bz, root);
        for (var j = 0; j < 3; j++) breaks.push({ key: 'coffee' + j, place: loungeR.place(rz0 + 1.3), x: bx0 + 0.7 + j * 0.9, ax: bx0 + 0.7 + j * 0.9, z: rz0 + 1.25, yaw: Math.PI, pose: 'cup' });
        box(0.9, 1.9, 0.7, M.vending, xB + 0.55, 0.95, rz0 + 1.6);
        box(0.6, 1.2, 0.02, M.screenOn, xB + 0.95, 1.15, rz0 + 1.6);
        var scx = (xB + xC) / 2 - 0.6, scz = rz1 - 2.5;
        box(4.4, 0.008, 3.0, M.rug, scx, 0.016, scz);
        box(1.1, 0.05, 0.8, M.table, scx, 0.4, scz);
        box(0.9, 0.36, 0.06, M.tableEdge, scx, 0.2, scz);
        [-1, 1].forEach(function (side) {
          var sbx = scx + side * 1.6;
          sofa(sbx, scz, 2.2, -side);
          [-0.5, 0.5].forEach(function (o, n) {
            breaks.push({ key: 'sofa' + side + n, place: loungeR.place(rz0 + 1.3), x: sbx - side * 0.05, ax: scx + side * 0.95, z: scz + o, yaw: -side * Math.PI / 2, pose: n ? 'doze' : 'sofa' });
          });
        });
        mesh(G.cyl, M.table, 0.9, 0.05, 0.9, xC - 1.2, 0.74, rz1 - 1.3, root);
        mesh(G.cyl, M.metal, 0.08, 0.72, 0.08, xC - 1.2, 0.36, rz1 - 1.3, root);
        plant(xC - 0.5, rz1 - 0.5, 1.2);
        plant(xB + 0.5, rz1 - 0.5, 1.0);
        // 휴게실 꾸밈 (사람 길: 문 → rz0+1.3 줄 → 커피 바·소파. 그 줄과 소파로 가는 길은 비워 둔다)
        //   커피 바 위 메뉴판, 뒷벽 오락기·책장·정수기, 왼쪽 탁구대, 오른쪽 둥근 탁자 의자·높은 탁자, 빈백, 소파 옆 스탠드
        box(2.3, 0.64, 0.04, M.menu, bx0 + 1.6, 1.8, rz0 + 0.1);
        for (var mr = 0; mr < 4; mr++) {
          box(0.62, 0.035, 0.01, M.white, bx0 + 0.95, 1.98 - mr * 0.12, rz0 + 0.125);
          box(0.62, 0.035, 0.01, M.white, bx0 + 2.25, 1.98 - mr * 0.12, rz0 + 0.125);
        }
        var lbx = xB + 2.4;
        [0, 1].forEach(function (k) {
          if (lbx + 0.4 > bx0 - 0.15) return;
          var g = grp(lbx, rz0 + 0.42, 0);
          box(0.68, 1.7, 0.6, M.seats[k ? 4 : 1], 0, 0.85, 0, g);
          var bz2 = box(0.58, 0.5, 0.04, M.dark, 0, 1.3, 0.3, g);
          bz2.rotation.x = -0.2;
          var sc2 = box(0.46, 0.38, 0.01, M.screenOn, 0, 1.3, 0.325, g);
          sc2.rotation.x = -0.2;
          var cp = box(0.66, 0.06, 0.3, M.dark, 0, 0.98, 0.4, g);
          cp.rotation.x = 0.3;
          mesh(G.sph, M.fruit[1], 0.07, 0.07, 0.07, -0.12, 1.07, 0.42, g);
          mesh(G.sph, M.fruit[0], 0.05, 0.05, 0.05, 0.1, 1.06, 0.44, g);
          box(0.64, 0.16, 0.05, M.bulb, 0, 1.62, 0.29, g);
          lbx += 0.8;
        });
        if (lbx + 2.2 < bx0 - 0.15) { shelf(lbx + 1.0, rz0 + 0.3, 2.0, false); lbx += 2.2; }
        if (lbx + 0.4 < bx0 - 0.15) {
          box(0.32, 0.95, 0.32, M.cooler, bx0 - 0.4, 0.475, rz0 + 0.3);
          mesh(G.cyl, M.water, 0.24, 0.36, 0.24, bx0 - 0.4, 1.13, rz0 + 0.3, root);
        }
        tree(xB + 0.45, rz0 + 2.4, 0.9);
        var ltx0 = xB + 0.4, ltx1 = scx - 2.35;
        if (ltx1 - ltx0 >= 2.0) {
          var ptx = (ltx0 + ltx1) / 2, ptz = rz0 + 4.35;
          box(1.52, 0.05, 2.74, M.felt, ptx, 0.74, ptz);
          box(0.02, 0.052, 2.74, M.white, ptx, 0.741, ptz);
          box(1.52, 0.052, 0.03, M.white, ptx, 0.741, ptz - 1.355);
          box(1.52, 0.052, 0.03, M.white, ptx, 0.741, ptz + 1.355);
          box(1.7, 0.15, 0.02, M.white, ptx, 0.84, ptz);
          [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(function (c) { box(0.06, 0.72, 0.06, M.dark, ptx + c[0] * 0.62, 0.36, ptz + c[1] * 1.1); });
          mesh(G.cyl, M.fruit[1], 0.16, 0.02, 0.16, ptx - 0.3, 0.775, ptz - 0.7, root);
          box(0.03, 0.02, 0.1, M.tableEdge, ptx - 0.3, 0.775, ptz - 0.57);
          mesh(G.cyl, M.dark, 0.16, 0.02, 0.16, ptx + 0.35, 0.775, ptz + 0.8, root);
          box(0.03, 0.02, 0.1, M.tableEdge, ptx + 0.35, 0.775, ptz + 0.93);
          mesh(G.sph, M.white, 0.04, 0.04, 0.04, ptx + 0.1, 0.785, ptz + 0.3, root);
        }
        floorLamp(scx - 2.2, scz - 1.3);
        floorLamp(scx + 2.2, scz - 1.3);
        var rtx = xC - 1.2, rtz = rz1 - 1.3;
        if (rtx - 0.95 > scx + 2.35) seatChair(rtx - 0.72, rtz, Math.PI / 2, M.seats[2]);
        seatChair(rtx, rtz - 0.72, 0, M.seats[2]);
        seatChair(rtx + 0.66, rtz, -Math.PI / 2, M.seats[2]);
        if (xC - 0.3 - (scx + 2.35) >= 2.4) {
          var htx = xC - 1.4, htz = rz0 + 3.3;
          mesh(G.cyl, M.table, 0.7, 0.04, 0.7, htx, 1.02, htz, root);
          mesh(G.cyl, M.metal, 0.06, 1.0, 0.06, htx, 0.5, htz, root);
          mesh(G.cyl, M.metal, 0.42, 0.03, 0.42, htx, 0.015, htz, root);
          stool(htx - 0.52, htz, M.seats[0]);
          stool(htx + 0.52, htz, M.seats[0]);
          stool(htx, htz + 0.52, M.seats[0]);
        }
        if (xC - 2.3 - (scx + 2.35) >= 2.1) {
          mesh(G.sph, M.seats[3], 0.8, 0.5, 0.78, scx + 2.95, 0.25, rz1 - 0.85, root);
          mesh(G.sph, M.seats[5], 0.78, 0.48, 0.8, scx + 3.8, 0.24, rz1 - 0.7, root);
        }
        if (ltx1 - ltx0 >= 2.0) {   // 탁구대 앞 빈백
          mesh(G.sph, M.seats[0], 0.78, 0.48, 0.76, ptx - 0.5, 0.24, rz1 - 0.6, root);
          mesh(G.sph, M.seats[2], 0.76, 0.46, 0.8, ptx + 0.45, 0.23, rz1 - 0.68, root);
        }
        if (ltx1 - ltx0 >= 5.0) {   // 넓으면 탁구대 옆 축구 게임대
          var fbx = ptx + 2.0, fbz = rz0 + 4.35;
          box(1.2, 0.22, 0.72, M.tableEdge, fbx, 0.8, fbz);
          box(1.1, 0.02, 0.62, M.felt, fbx, 0.9, fbz);
          [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(function (c) { box(0.07, 0.7, 0.07, M.dark, fbx + c[0] * 0.52, 0.35, fbz + c[1] * 0.28); });
          for (var fr = 0; fr < 6; fr++) {
            var rx = fbx - 0.45 + fr * 0.18;
            var rod = mesh(G.cyl, M.metal, 0.025, 0.95, 0.025, rx, 0.97, fbz, root);
            rod.rotation.x = Math.PI / 2;
            for (var fm = -1; fm <= 1; fm += 2) box(0.04, 0.1, 0.05, M.seats[fr < 3 ? 1 : 0], rx, 0.95, fbz + fm * 0.14);
          }
        }
        if (xC - 2.4 - (scx + 2.4) >= 2.8) {   // 넓으면 오른쪽에 TV 와 TV 보는 소파
          var tvx = (scx + 2.4 + xC - 2.4) / 2, tvz = rz0 + 2.35;
          rug(tvx, rz0 + 3.25, 2.8, 2.3, M.carpet);
          box(1.8, 0.5, 0.42, M.tableEdge, tvx, 0.25, tvz);
          box(1.5, 0.86, 0.06, M.dark, tvx, 1.0, tvz);
          box(1.4, 0.76, 0.01, M.screenOn, tvx, 1.0, tvz + 0.035);
          sofaAt(grp(tvx, rz0 + 4.1, Math.PI), 2.2);
          plant(tvx + 1.25, tvz, 0.8);
        }
        rug((xB + 2.0 + bx0 - 0.2) / 2, rz0 + 1.3, bx0 - xB - 2.2, 0.9, M.carpet);   // 커피 바로 가는 길 깔개
        // 오른쪽 벽 다트판
        var dart = mesh(G.cyl, M.dark, 0.56, 0.04, 0.56, xC - 0.08, 1.55, rz0 + 2.3, root);
        dart.rotation.z = Math.PI / 2;
        var dr1 = mesh(G.cyl, M.fruit[1], 0.4, 0.045, 0.4, xC - 0.085, 1.55, rz0 + 2.3, root);
        dr1.rotation.z = Math.PI / 2;
        var dr2 = mesh(G.cyl, M.white, 0.22, 0.05, 0.22, xC - 0.09, 1.55, rz0 + 2.3, root);
        dr2.rotation.z = Math.PI / 2;
        var dr3 = mesh(G.cyl, M.fruit[1], 0.07, 0.055, 0.07, xC - 0.095, 1.55, rz0 + 2.3, root);
        dr3.rotation.z = Math.PI / 2;

        // 수면실: 침대 여럿(방이 넓으면 6개까지)과 머리맡 스탠드. 오래 쉬는 세션이 와서 잔다.
        var napR = lowerRoom(xC, xD, '수면실', M.napFloor, '#7a86c8');
        W.lower = [ceoR, loungeR, napR];
        var nBeds = Math.max(1, Math.min(2, Math.floor((xD - xC - 1.6) / 1.5)), Math.min(6, Math.floor((xD - xC - 3.0) / 1.5))), bedZ = rz1 - 1.9;
        for (var bi = 0; bi < nBeds; bi++) {
          var bxx = xC + 1.4 + bi * 1.5;
          box(1.0, 0.36, 2.05, M.tableEdge, bxx, 0.18, bedZ);
          box(0.92, 0.14, 1.95, M.white, bxx, 0.43, bedZ);
          box(0.62, 0.1, 0.34, M.white, bxx, 0.55, bedZ - 0.75);
          box(1.0, 0.7, 0.08, M.tableEdge, bxx, 0.35, bedZ - 1.02);
          if (bi < nBeds - 1) {
            box(0.36, 0.5, 0.36, M.tableEdge, bxx + 0.75, 0.25, bedZ - 0.75);
            box(0.18, 0.18, 0.18, M.led, bxx + 0.75, 0.6, bedZ - 0.75);
          }
          breaks.push({ key: 'bed' + bi, place: napR.place(bedZ - 1.5), x: bxx, ax: bxx, z: bedZ, yaw: 0, pose: 'sleep', sleep: true, cover: blanket(bxx, bedZ, M.seats[bi % M.seats.length]) });
          box(0.1, 0.04, 0.24, M.seats[(bi + 2) % M.seats.length], bxx - 0.08, 0.04, rz1 - 0.5);
          box(0.1, 0.04, 0.24, M.seats[(bi + 2) % M.seats.length], bxx + 0.08, 0.04, rz1 - 0.48);
        }
        plant(xD - 0.5, rz0 + 0.6, 1.0);
        // 수면실 꾸밈 (사람 길: 문 → rz0+3.6 줄 → 침대. 그 줄 위쪽 뒷벽에만 놓는다)
        //   뒷벽 안마의자, 왼쪽 벽 담요 선반, 침대 발치 깔개·슬리퍼, 오른쪽 빈자리에 소파·스탠드·나무
        var bedsEnd = xC + 1.4 + (nBeds - 1) * 1.5 + 0.5;
        rug((xC + 0.9 + bedsEnd) / 2, rz1 - 0.48, bedsEnd - xC - 0.6, 0.62, M.rug);
        for (var mc = 0, mcx = xC + 2.6; mc < 3 && mcx + 0.45 < xD - 1.05; mc++, mcx += 1.05) {
          var mg = grp(mcx, rz0 + 0.7, 0);
          box(0.78, 0.36, 0.9, M.dark, 0, 0.18, 0, mg);
          box(0.6, 0.14, 0.62, M.seats[(mc * 2 + 1) % M.seats.length], 0, 0.43, 0.04, mg);
          var mb = box(0.66, 0.95, 0.22, M.dark, 0, 0.88, -0.36, mg);
          mb.rotation.x = -0.32;
          var mp = box(0.5, 0.7, 0.06, M.seats[(mc * 2 + 1) % M.seats.length], 0, 0.9, -0.24, mg);
          mp.rotation.x = -0.32;
          box(0.16, 0.36, 0.78, M.dark, -0.39, 0.54, 0.02, mg);
          box(0.16, 0.36, 0.78, M.dark, 0.39, 0.54, 0.02, mg);
          var ml = box(0.46, 0.12, 0.5, M.dark, 0, 0.26, 0.6, mg);
          ml.rotation.x = 0.55;
        }
        var bg = grp(xC + 0.33, rz0 + 2.25, Math.PI / 2);   // 담요·베개 선반 (앞이 트여 +x 쪽을 본다)
        box(1.4, 1.5, 0.03, M.tableEdge, 0, 0.75, -0.2, bg);
        box(0.04, 1.5, 0.42, M.tableEdge, -0.68, 0.75, 0, bg);
        box(0.04, 1.5, 0.42, M.tableEdge, 0.68, 0.75, 0, bg);
        box(1.4, 0.04, 0.42, M.tableEdge, 0, 1.5, 0, bg);
        for (var bl = 0; bl < 3; bl++) {
          box(1.34, 0.03, 0.4, M.table, 0, 0.06 + bl * 0.48, 0, bg);
          for (var bs = 0; bs < 3; bs++) {
            for (var bh = 0; bh < 2; bh++) box(0.36, 0.09, 0.32, M.seats[(bl + bs + bh * 3) % M.seats.length], -0.44 + bs * 0.44, 0.12 + bl * 0.48 + bh * 0.1, 0, bg);
          }
        }
        var napFree = xD - 0.15 - bedsEnd;
        if (napFree >= 1.6) {
          sofa(xD - 0.6, rz0 + 5.0, 2.0, -1);
          rug(xD - 0.15 - Math.min(1.7, napFree - 0.2) / 2, rz0 + 5.0, Math.min(1.7, napFree - 0.2), 2.5, M.carpet);
          floorLamp(xD - 0.45, rz0 + 3.6);
        }
        if (napFree >= 2.6) tree(bedsEnd + 0.55, rz1 - 0.55, 0.95);
        if (xD - 1.2 - (bedsEnd + 0.5) >= 2.8) nook((bedsEnd + 0.5 + xD - 1.2) / 2, rz0 + 2.2);
        // 침대 사이 낮은 천 칸막이, 가운데 큰 깔개, 왼쪽 앞 구석 달 모양 등
        for (var pi2 = 0; pi2 < nBeds - 1; pi2++) box(0.04, 1.0, 1.45, M.curtain, xC + 1.4 + pi2 * 1.5 + 0.75, 0.5, bedZ + 0.28);
        var nrx0 = xC + 1.0, nrx1 = Math.min(xD - 1.2, Math.max(bedsEnd, xC + 4.5));
        rug((nrx0 + nrx1) / 2, rz0 + 2.45, nrx1 - nrx0, 1.5, M.lounge);
        mesh(G.sph, M.bulb, 0.34, 0.34, 0.34, xC + 0.42, 0.19, rz1 - 0.42, root);
        mesh(G.cyl, M.tableEdge, 0.3, 0.04, 0.3, xC + 0.42, 0.02, rz1 - 0.42, root);

        // 바깥벽: 사방 커튼월 (바닥부터 투명한 유리, 1.5m 마다 세로 멀리언, 위쪽 가로대, 맨 위는 층 슬래브 띠).
        // 도시 배경을 켜면 유리 너머로 거리와 빌딩이 보인다. 카메라가 어느 면 바깥쪽으로 돌면 그 면은 감추고 아래 턱만 남긴다.
        // 왼쪽 면의 엘리베이터 자리는 막힌 벽.
        var cwMat = new T.MeshLambertMaterial({ color: '#b4cfe3', transparent: true, opacity: 0.2, depthWrite: false, side: T.DoubleSide });
        trash.push(cwMat);
        var cwLenX = maxX + CW_O * 2, cwLenZ = lobby.z1 + CW_O * 2;
        function curtainWall(x, z, rot, len, solid) {   // (x, z) 에서 시작해 len 만큼, 안쪽이 로컬 +z
          var parts = new T.Group(), panes = new T.Group();
          [parts, panes].forEach(function (o) { o.position.set(x, 0, z); o.rotation.y = rot; });
          box(len, CW_H - CW_GLASS, 0.1, M.spandrel, len / 2, (CW_H + CW_GLASS) / 2, 0, parts);
          box(len, 0.06, 0.18, M.mullion, len / 2, CW_H - 0.03, 0.02, parts);
          box(len, 0.06, 0.14, M.mullion, len / 2, CW_GLASS, 0.04, parts);
          box(len, 0.045, 0.1, M.mullion, len / 2, 2.05, 0.04, parts);
          var n = Math.max(1, Math.round(len / CW_MOD)), step = len / n;
          for (var i = 0; i <= n; i++) {
            var mx = i * step;
            if (solid && Math.abs(mx - solid[0]) < solid[1] / 2) continue;
            box(0.07, CW_H, 0.14, M.mullion, mx, CW_H / 2, 0.04, parts);
          }
          var spans = [[0, len]];
          if (solid) {
            var sa = solid[0] - solid[1] / 2, sb = solid[0] + solid[1] / 2;
            box(sb - sa, CW_H, 0.14, M.wall, solid[0], CW_H / 2, 0.03, parts);
            spans = [[0, sa], [sb, len]];
          }
          spans.forEach(function (sp) {
            var gw = sp[1] - sp[0], gh = CW_GLASS - 0.1;
            if (gw <= 0.05) return;
            var geo = new T.PlaneGeometry(gw, gh);
            trash.push(geo);
            var pm = new T.Mesh(geo, cwMat);
            pm.position.set((sp[0] + sp[1]) / 2, 0.1 + gh / 2, -0.02);
            panes.add(pm);
          });
          var side = mergeStatic(parts);
          side.traverse(function (o) { if (o.isMesh) trash.push(o.geometry); });
          side.add(panes);
          return side;
        }
        var walls = [
          { obj: curtainWall(-CW_O, -CW_O, 0, cwLenX), nx: 0, nz: -1 },
          { obj: curtainWall(maxX + CW_O, lobby.z1 + CW_O, Math.PI, cwLenX), nx: 0, nz: 1 },
          { obj: curtainWall(-CW_O, lobby.z1 + CW_O, Math.PI / 2, cwLenZ, [lobby.z1 + CW_O - ez, 2.2]), nx: -1, nz: 0 },
          { obj: curtainWall(maxX + CW_O, -CW_O, -Math.PI / 2, cwLenZ), nx: 1, nz: 0 }
        ];
        walls.forEach(function (c) { W.cut.push(c); scene.add(c.obj); });
        // 아래 턱 (벽을 감춰도 건물 가장자리가 보이게)
        box(cwLenX + 0.12, 0.12, 0.3, M.mullion, maxX / 2, 0.06, -CW_O);
        box(cwLenX + 0.12, 0.12, 0.3, M.mullion, maxX / 2, 0.06, lobby.z1 + CW_O);
        box(0.3, 0.12, cwLenZ, M.mullion, -CW_O, 0.06, lobby.z1 / 2);
        box(0.3, 0.12, cwLenZ, M.mullion, maxX + CW_O, 0.06, lobby.z1 / 2);

        W.merged = mergeStatic(root);
        W.merged.traverse(function (o) { if (o.isMesh) trash.push(o.geometry); });
        W.keep = keep;
        W.dyn = dyn;
        scene.add(W.merged, keep, dyn);
        maxDist = 0;
        if (look.city) attachCity(s.hour);
      }

      function spotLabel(text) {
        var el = document.createElement('div');
        el.className = 'o3-spot';
        el.textContent = text;
        layer.appendChild(el);
        return el;
      }

      function disposeWorld() {
        scene.remove(W.merged, W.keep, W.dyn);
        W.cut.forEach(function (c) { scene.remove(c.obj); });
        W.trash.forEach(function (t) { t.dispose(); });
        W.labels.forEach(function (lb) { lb.el.remove(); });
        Object.keys(actors).forEach(function (id) { if (actors[id].brk) actors[id].brk = null; });
        detachCity();
        W = null;
      }

      // ---------- 도시 배경 (도구 막대의 '도시' 단추로 켜고 끈다. 느린 컴퓨터는 끄면 된다) ----------
      // 사무실은 CITY_FLOOR 층. 그 아래로 우리 건물 몸통(층마다 슬래브 띠가 있는 유리 외벽)과 저층부 옥상 정원,
      // 둘레는 바둑판 도로(차선·횡단보도·달리는 차)와 여러 모양·높이의 빌딩(유리 타워, 사무 빌딩, 아파트 단지, 저층 상가),
      // 공원, 북쪽 강과 다리, 더 멀리는 안개 속 빌딩 숲. 가까운 건물은 사무실 바닥보다 낮게 둬서 화면을 가리지 않는다.
      // 건물은 외벽 모양별 재료 몇 개에 모두 합쳐 그리고, 나무와 차는 InstancedMesh 라서 그리기 횟수가 적다.
      var CITY_SKY = {
        day: { fog: '#c9d9e6', road: '#5a6069', walk: '#cec8bd', lot: '#bcb6ab', park: '#93bf7e', water: '#6d9cc2', lane: '#f2f1ea', mid: '#e7c34c', bridge: '#a7a39b', light: 1, glow: 0 },
        dusk: { fog: '#d8ab94', road: '#4b4950', walk: '#b6a396', lot: '#a69488', park: '#7d9868', water: '#878cad', lane: '#e9dccb', mid: '#e0b24a', bridge: '#958980', light: 0.72, glow: 0.55 },
        night: { fog: '#141c33', road: '#1d2129', walk: '#373a42', lot: '#2c2f37', park: '#22322a', water: '#182640', lane: '#7b786d', mid: '#7b6a35', bridge: '#4a4a52', light: 0.34, glow: 1 }
      };
      var city = null;
      // 도시 배경 시간대: 조명 판에서 고른 것, '시각대로'면 지금 시각
      function skyNow(hour) { return CITY_SKY[look.sky] ? look.sky : skyKind(hour); }
      function attachCity(hour) {
        detachCity();
        if (!W) return;
        city = makeCity(hour);
        scene.add(city.group);
        scene.fog = city.fog;
        renderer.setClearColor(city.bg);
        refitDist();
      }
      function detachCity() {
        if (!city) return;
        scene.remove(city.group);
        city.dispose();
        city = null;
        scene.fog = null;
        renderer.setClearColor(PAL.bg);
        refitDist();
      }
      // 도시가 있으면 더 멀리까지 물러나 볼 수 있게 (전체 보기 거리는 그대로)
      function refitDist() {
        if (!W || !cw) return;
        var f = overview();
        if (!userMoved && !focus) flyTo(f);
      }

      function makeCity(hour) {
        var kind = skyNow(hour), C = CITY_SKY[kind], G0 = -CITY_FLOOR * FLOOR_H, night = kind === 'night';
        var bw = W.width, bd = W.depth, cx = bw / 2, cz = bd / 2, GR = 640;
        var group = new T.Group(), junk = [];
        var seed = 20251025;
        function rnd() { seed = (seed * 16807) % 2147483647; return seed / 2147483647; }
        function pick(a) { return a[Math.floor(rnd() * a.length)]; }
        function col(hex, k) { var c = new T.Color(hex); if (k != null) c.multiplyScalar(k); return c; }

        // 도로망: 우리 블록(건물 + 저층부 + 보도) 둘레부터 바깥으로 RW 폭 도로, BLK 블록
        var RW = 16, BLK = 76, POD = 10;
        var tx0 = -CW_O, tx1 = bw + CW_O, tz0 = -CW_O, tz1 = bd + CW_O;
        var hx = bw / 2 + CW_O + POD + 8, hz = bd / 2 + CW_O + POD + 8;
        function roadCenters(c, h) {
          var out = [];
          for (var p = h + RW / 2; p < GR; p += RW + BLK) out.push(c + p, c - p);
          return out.sort(function (a, b) { return a - b; });
        }
        function spans(r) { var out = []; for (var i = 0; i + 1 < r.length; i++) out.push([r[i] + RW / 2, r[i + 1] - RW / 2]); return out; }
        var rx = roadCenters(cx, hx), rz = roadCenters(cz, hz), bxs = spans(rx), bzs = spans(rz);
        var ic = 0;
        bzs.forEach(function (sp, j) { if (sp[0] <= cz && sp[1] >= cz) ic = j; });
        var riverRow = ic - 2, rv = bzs[riverRow] || null;   // 우리 건물 북쪽 두 블록 너머로 강이 지난다
        // 다리는 세 도로에 하나 (우리 건물 양옆 도로는 늘 다리)
        var inner = rx.slice().sort(function (a, b) { return Math.abs(a - cx) - Math.abs(b - cx); }).slice(0, 2);
        var bridge = {};
        rx.forEach(function (x, i) { if (i % 3 === 1 || inner.indexOf(x) >= 0) bridge[x] = true; });

        // ---- 땅 그림 (도로·차선·횡단보도·보도·공원·강). 2048px 한 장이 GR*2 m 를 덮는다
        var GS = 2048, PX = GS / (2 * GR), gcv = document.createElement('canvas');
        gcv.width = gcv.height = GS;
        var g = gcv.getContext('2d');
        function X(x) { return (x - (cx - GR)) * PX; }
        function Z(z) { return (z - (cz - GR)) * PX; }
        function rect(x0, z0, x1, z1, c) { g.fillStyle = c; g.fillRect(X(x0), Z(z0), (x1 - x0) * PX, (z1 - z0) * PX); }
        g.fillStyle = C.road;
        g.fillRect(0, 0, GS, GS);
        // 차선: 가운데 노란 겹선, 양쪽 흰 점선
        g.lineWidth = Math.max(1, 0.2 * PX);
        rx.forEach(function (x) {
          g.setLineDash([]); g.strokeStyle = C.mid;
          [-0.25, 0.25].forEach(function (o) { g.beginPath(); g.moveTo(X(x + o), 0); g.lineTo(X(x + o), GS); g.stroke(); });
          g.setLineDash([3 * PX, 5 * PX]); g.strokeStyle = C.lane;
          [-RW / 4, RW / 4].forEach(function (o) { g.beginPath(); g.moveTo(X(x + o), 0); g.lineTo(X(x + o), GS); g.stroke(); });
        });
        rz.forEach(function (z) {
          g.setLineDash([]); g.strokeStyle = C.mid;
          [-0.25, 0.25].forEach(function (o) { g.beginPath(); g.moveTo(0, Z(z + o)); g.lineTo(GS, Z(z + o)); g.stroke(); });
          g.setLineDash([3 * PX, 5 * PX]); g.strokeStyle = C.lane;
          [-RW / 4, RW / 4].forEach(function (o) { g.beginPath(); g.moveTo(0, Z(z + o)); g.lineTo(GS, Z(z + o)); g.stroke(); });
        });
        g.setLineDash([]);
        // 교차로: 차선을 지우고 네 방향 횡단보도
        rx.forEach(function (x) {
          rz.forEach(function (z) {
            rect(x - RW / 2, z - RW / 2, x + RW / 2, z + RW / 2, C.road);
            g.fillStyle = C.lane;
            for (var o = -RW / 2 + 1.2; o < RW / 2 - 1; o += 1.3) {
              g.fillRect(X(x + o), Z(z - RW / 2 - 3.4), 0.65 * PX, 3 * PX);
              g.fillRect(X(x + o), Z(z + RW / 2 + 0.4), 0.65 * PX, 3 * PX);
              g.fillRect(X(x - RW / 2 - 3.4), Z(z + o), 3 * PX, 0.65 * PX);
              g.fillRect(X(x + RW / 2 + 0.4), Z(z + o), 3 * PX, 0.65 * PX);
            }
          });
        });

        // ---- 건물: 외벽 모양별로 모아 한 덩어리씩
        var TILE = { glass: [6, 7.2], office: [6, 7.2], apt: [6, 5.6], low: [8, 8], roof: [1, 1] };
        var B = {};
        function bucket(k) { return B[k] || (B[k] = { p: [], n: [], u: [], c: [] }); }
        function quad(k, a, b, c2, d, n, uv, cl) {
          var bk = bucket(k), vs = [a, b, c2, a, c2, d], us = [[uv[0], uv[1]], [uv[2], uv[1]], [uv[2], uv[3]], [uv[0], uv[1]], [uv[2], uv[3]], [uv[0], uv[3]]];
          for (var i = 0; i < 6; i++) {
            bk.p.push(vs[i][0], vs[i][1], vs[i][2]);
            bk.n.push(n[0], n[1], n[2]);
            bk.u.push(us[i][0], us[i][1]);
            bk.c.push(cl.r, cl.g, cl.b);
          }
        }
        // 상자 건물 (옆면은 외벽 k, 윗면은 지붕 roofC). 창이 층에 맞게 땅에서부터 잰 높이로 UV 를 준다
        function boxB(k, x0, x1, z0, z1, y0, y1, cl, roofC) {
          var t = TILE[k], v0 = (y0 - G0) / t[1], v1 = (y1 - G0) / t[1], ux = (x1 - x0) / t[0], uz = (z1 - z0) / t[0];
          quad(k, [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [0, 0, 1], [0, v0, ux, v1], cl);
          quad(k, [x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [0, 0, -1], [0, v0, ux, v1], cl);
          quad(k, [x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [1, 0, 0], [0, v0, uz, v1], cl);
          quad(k, [x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], [-1, 0, 0], [0, v0, uz, v1], cl);
          if (roofC) quad('roof', [x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], [0, 1, 0], [0, 0, 0, 0], roofC);
        }
        function cylB(k, x, z, r, y0, y1, cl, roofC) {
          var t = TILE[k], v0 = (y0 - G0) / t[1], v1 = (y1 - G0) / t[1], n = 18, du = 2 * Math.PI * r / n / t[0], rb = bucket('roof');
          for (var i = 0; i < n; i++) {
            var a0 = i / n * Math.PI * 2, a1 = (i + 1) / n * Math.PI * 2, am = (a0 + a1) / 2;
            var p0 = [x + r * Math.sin(a0), z + r * Math.cos(a0)], p1 = [x + r * Math.sin(a1), z + r * Math.cos(a1)];
            quad(k, [p0[0], y0, p0[1]], [p1[0], y0, p1[1]], [p1[0], y1, p1[1]], [p0[0], y1, p0[1]], [Math.sin(am), 0, Math.cos(am)], [i * du, v0, (i + 1) * du, v1], cl);
            [[x, y1, z], [p0[0], y1, p0[1]], [p1[0], y1, p1[1]]].forEach(function (v) { rb.p.push(v[0], v[1], v[2]); rb.n.push(0, 1, 0); rb.u.push(0, 0); rb.c.push(roofC.r, roofC.g, roofC.b); });
          }
        }
        var ROOF = [col('#a9adb2'), col('#9da3a8'), col('#b8b2a8'), col('#8e959c')], MECH = col('#c9cdd1'), GARDEN = col('#8db57a');
        var TINT = {
          glass: [col('#d4e4ff'), col('#c9efe8'), col('#e8e8ea'), col('#d6def0'), col('#bfd6ea'), col('#e4dcd0')],
          office: [col('#ffffff'), col('#f2e6d8'), col('#e3e8ee'), col('#f4dcce'), col('#e6e0d4')],
          apt: [col('#ffffff'), col('#f6f1e7'), col('#eef2f6')],
          low: [col('#efc3ab'), col('#e2cfae'), col('#cfdcc6'), col('#e6cfb5'), col('#cfd6e0'), col('#d9b0a0'), col('#f0e4c8')]
        };
        var BAND = [col('#3f7fc0'), col('#c0503f'), col('#3f9a6a'), col('#d49a2a'), col('#7a55b0')];   // 아파트 꼭대기 띠
        // 옥상 기계실·물탱크, 아주 높은 탑은 안테나
        function rooftop(x0, x1, z0, z1, top) {
          var w = x1 - x0, d = z1 - z0;
          if (top - G0 < 25 || w < 8 || d < 8) return;
          var mw = w * (0.25 + rnd() * 0.2), md = d * (0.25 + rnd() * 0.2), mx = x0 + w * (0.2 + rnd() * 0.4), mz = z0 + d * (0.2 + rnd() * 0.4);
          boxB('roof', mx, mx + mw, mz, mz + md, top, top + 3 + rnd() * 3, MECH, MECH);
          if (top - G0 > 150 && rnd() < 0.6) boxB('roof', x0 + w / 2 - 0.4, x0 + w / 2 + 0.4, z0 + d / 2 - 0.4, z0 + d / 2 + 0.4, top, top + 12 + rnd() * 14, MECH, MECH);
        }
        // 빌딩 하나: 높으면 2~3 단으로 들어가며 올라간다
        function tower(x0, x1, z0, z1, h, k) {
          var cl = pick(TINT[k]), roofC = pick(ROOF), y = G0;
          if (k === 'glass' && rnd() < 0.12 && Math.abs((x1 - x0) - (z1 - z0)) < 10) {
            var r = Math.min(x1 - x0, z1 - z0) / 2;
            cylB(k, (x0 + x1) / 2, (z0 + z1) / 2, r, G0, G0 + h, cl, roofC);
            return;
          }
          var tiers = h > 70 && rnd() < 0.45 ? (h > 130 && rnd() < 0.5 ? 3 : 2) : 1;
          for (var t = 0; t < tiers; t++) {
            var top = t === tiers - 1 ? G0 + h : G0 + h * (t === 0 ? 0.45 + rnd() * 0.2 : 0.74 + rnd() * 0.1);
            boxB(k, x0, x1, z0, z1, y, top, cl, roofC);
            var ix = (x1 - x0) * (0.1 + rnd() * 0.1), iz = (z1 - z0) * (0.1 + rnd() * 0.1);
            if (t < tiers - 1) { x0 += ix; x1 -= ix; z0 += iz; z1 -= iz; }
            y = top;
          }
          rooftop(x0, x1, z0, z1, G0 + h);
        }

        var trees = [];
        function treeAt(x, z, r, y) { trees.push(x, z, r, y == null ? G0 : y); }
        function lawnTrees(x0, x1, z0, z1, n) { for (var i = 0; i < n; i++) treeAt(x0 + rnd() * (x1 - x0), z0 + rnd() * (z1 - z0), 2 + rnd() * 2.2); }

        // ---- 우리 건물: 저층부(옥상 정원) 위로 유리 몸통이 사무실 바닥 바로 아래까지
        var podH = 3 * FLOOR_H + 1.4;
        boxB('office', tx0 - POD, tx1 + POD, tz0 - POD, tz1 + POD, G0, G0 + podH, col('#f4efe6'), GARDEN);
        boxB('glass', tx0, tx1, tz0, tz1, G0 + podH, -0.03, col('#dce9f6'), null);
        boxB('roof', cx - 14, cx + 14, tz1 + POD, tz1 + POD + 5, G0 + 5.4, G0 + 6, col('#e9ecef'), col('#e9ecef'));   // 정문 차양
        for (var pt = 0; pt < 1; pt += 0.035) {
          var per = 2 * (tx1 - tx0 + tz1 - tz0 + 4 * POD) * pt, gx0 = tx0 - POD + 3, gx1 = tx1 + POD - 3, gz0 = tz0 - POD + 3, gz1 = tz1 + POD - 3, L1 = gx1 - gx0, L2 = gz1 - gz0;
          var qx, qz, pp = per % (2 * (L1 + L2));
          if (pp < L1) { qx = gx0 + pp; qz = gz0; } else if (pp < L1 + L2) { qx = gx1; qz = gz0 + pp - L1; } else if (pp < 2 * L1 + L2) { qx = gx1 - (pp - L1 - L2); qz = gz1; } else { qx = gx0; qz = gz1 - (pp - 2 * L1 - L2); }
          treeAt(qx, qz, 1.8 + rnd() * 0.8, G0 + podH);
        }

        // ---- 블록마다 채우기
        bxs.forEach(function (sx) {
          bzs.forEach(function (sz, j) {
            var x0 = sx[0], x1 = sx[1], z0 = sz[0], z1 = sz[1], mx = (x0 + x1) / 2, mz = (z0 + z1) / 2;
            var ours = x0 <= cx && x1 >= cx && z0 <= cz && z1 >= cz;
            rect(x0, z0, x1, z1, C.walk);
            if (ours) {
              rect(x0 + 2, z0 + 2, x1 - 2, z1 - 2, shadeHex(C.walk, 1.06));
              for (var tz = z0 + 4; tz < z1 - 2; tz += 9) { treeAt(x0 + 4, tz, 2.4); treeAt(x1 - 4, tz, 2.4); }
              return;
            }
            if (j === riverRow) return;   // 강은 아래에서 한 번에 그린다
            var ins = 3.5, lx0 = x0 + ins, lx1 = x1 - ins, lz0 = z0 + ins, lz1 = z1 - ins;
            var dist = Math.max(Math.abs(mx - cx) - hx, Math.abs(mz - cz) - hz), hmax = dist < 170 ? 98 : 230;
            var nearRiver = j === riverRow - 1 || j === riverRow + 1, r = rnd();
            var type = nearRiver && r < 0.4 ? 'park' : r < 0.08 ? 'park' : r < 0.3 ? 'apt' : r < 0.68 ? 'biz' : 'low';
            for (var st = x0 + 7; st < x1 - 3; st += 12) { treeAt(st, z0 + 1.6, 2); treeAt(st, z1 - 1.6, 2); }   // 가로수
            if (type === 'park') {
              rect(lx0, lz0, lx1, lz1, C.park);
              g.strokeStyle = C.walk; g.lineWidth = 2.2 * PX;
              g.beginPath(); g.moveTo(X(lx0), Z(lz0 + (lz1 - lz0) * 0.3)); g.quadraticCurveTo(X(mx), Z(mz + 18), X(lx1), Z(lz0 + (lz1 - lz0) * 0.7)); g.stroke();
              if (rnd() < 0.5) { g.fillStyle = C.water; g.beginPath(); g.ellipse(X(mx + 10), Z(mz - 10), 14 * PX, 9 * PX, 0.3, 0, Math.PI * 2); g.fill(); }
              lawnTrees(lx0 + 2, lx1 - 2, lz0 + 2, lz1 - 2, 26 + Math.floor(rnd() * 16));
            } else if (type === 'apt') {   // 아파트 단지: 나란한 판상형 동, 꼭대기 색 띠, 동 사이 잔디와 나무
              rect(lx0, lz0, lx1, lz1, mixHex(C.park, C.lot, 0.5));
              var band = pick(BAND), cl = pick(TINT.apt);
              for (var az = lz0 + 6; az + 13 <= lz1 - 4; az += 25) {
                var ah = Math.min(hmax, 42 + rnd() * 30);
                boxB('apt', lx0 + 5, lx1 - 5, az, az + 13, G0, G0 + ah - 2.5, cl, null);
                boxB('roof', lx0 + 5, lx1 - 5, az, az + 13, G0 + ah - 2.5, G0 + ah, band, pick(ROOF));
                lawnTrees(lx0 + 4, lx1 - 4, az + 15, az + 22, 5);
              }
            } else if (type === 'biz') {   // 업무 지구: 1~4 필지에 유리·사무 빌딩
              rect(lx0, lz0, lx1, lz1, C.lot);
              var sxn = rnd() < 0.6 ? 2 : 1, szn = rnd() < 0.6 ? 2 : 1, pw = (lx1 - lx0) / sxn, pd = (lz1 - lz0) / szn;
              for (var a = 0; a < sxn; a++) {
                for (var b = 0; b < szn; b++) {
                  var px0 = lx0 + a * pw, pz0 = lz0 + b * pd, sb = 3 + rnd() * 4;
                  var h = 22 + Math.pow(rnd(), 1.5) * (hmax - 22);
                  tower(px0 + sb, px0 + pw - sb, pz0 + sb, pz0 + pd - sb, h, rnd() < 0.55 ? 'glass' : 'office');
                }
              }
            } else {   // 저층 상가·주택, 군데군데 주차장
              rect(lx0, lz0, lx1, lz1, C.lot);
              var n = 3, cwid = (lx1 - lx0) / n, cdep = (lz1 - lz0) / n;
              for (var p = 0; p < n; p++) {
                for (var q = 0; q < n; q++) {
                  var qx0 = lx0 + p * cwid, qz0 = lz0 + q * cdep;
                  if (rnd() < 0.2) {
                    g.strokeStyle = C.lane; g.lineWidth = Math.max(1, 0.15 * PX);
                    for (var ps = qx0 + 2; ps < qx0 + cwid - 2; ps += 2.6) { g.beginPath(); g.moveTo(X(ps), Z(qz0 + 3)); g.lineTo(X(ps), Z(qz0 + 8)); g.stroke(); }
                    continue;
                  }
                  var e = 1.5 + rnd() * 2.5;
                  tower(qx0 + e, qx0 + cwid - e, qz0 + e, qz0 + cdep - e, 7 + rnd() * 20, 'low');
                }
              }
            }
          });
        });
        // 강: 둑길 사이를 끝까지 흐르고, 다리가 있는 도로만 건너간다 (난간은 밝은 줄)
        if (rv) {
          rect(cx - GR, rv[0] + 3, cx + GR, rv[1] - 3, C.water);
          rx.forEach(function (x) {
            if (!bridge[x]) return;
            rect(x - RW / 2, rv[0] + 3, x + RW / 2, rv[1] - 3, C.road);
            g.fillStyle = C.mid;
            [-0.25, 0.25].forEach(function (o) { g.fillRect(X(x + o) - 0.5, Z(rv[0] + 3), Math.max(1, 0.2 * PX), (rv[1] - rv[0] - 6) * PX); });
            rect(x - RW / 2 - 0.9, rv[0] + 2, x - RW / 2, rv[1] - 2, C.bridge);
            rect(x + RW / 2, rv[0] + 2, x + RW / 2 + 0.9, rv[1] - 2, C.bridge);
          });
        }
        // 밤에는 가로등 불빛
        if (C.glow > 0.5) {
          rx.forEach(function (x) { for (var z = cz - GR; z < cz + GR; z += 24) { glowDot(x - RW / 2 - 1, z); glowDot(x + RW / 2 + 1, z + 12); } });
          rz.forEach(function (z) { for (var x = cx - GR; x < cx + GR; x += 24) { glowDot(x, z - RW / 2 - 1); glowDot(x + 12, z + RW / 2 + 1); } });
        }
        function glowDot(x, z) {
          var gr = g.createRadialGradient(X(x), Z(z), 0, X(x), Z(z), 5 * PX);
          gr.addColorStop(0, 'rgba(255,214,140,0.45)');
          gr.addColorStop(1, 'rgba(255,214,140,0)');
          g.fillStyle = gr;
          g.fillRect(X(x) - 5 * PX, Z(z) - 5 * PX, 10 * PX, 10 * PX);
        }
        // 가장자리는 먼 땅 색으로 흐리게 (그 너머 큰 땅과 이어지게)
        var edge = g.createRadialGradient(GS / 2, GS / 2, GS * 0.36, GS / 2, GS / 2, GS * 0.5);
        edge.addColorStop(0, hexA(C.lot, 0));
        edge.addColorStop(1, hexA(C.lot, 1));
        g.fillStyle = edge;
        g.fillRect(0, 0, GS, GS);
        g.fillStyle = C.lot;
        [[0, 0, GS, 2], [0, GS - 2, GS, 2], [0, 0, 2, GS], [GS - 2, 0, 2, GS]].forEach(function (r) { g.fillRect(r[0], r[1], r[2], r[3]); });
        var gtex = new T.CanvasTexture(gcv);
        gtex.anisotropy = aniso;
        gtex.encoding = T.sRGBEncoding;
        var gmat = new T.MeshBasicMaterial({ map: gtex });
        var ground = new T.Mesh(new T.PlaneGeometry(GR * 2, GR * 2), gmat);
        ground.rotation.x = -Math.PI / 2;
        ground.position.set(cx, G0, cz);
        var farMat = new T.MeshBasicMaterial({ color: C.lot });
        var farGround = new T.Mesh(new T.PlaneGeometry(9000, 9000), farMat);
        farGround.rotation.x = -Math.PI / 2;
        farGround.position.set(cx, G0 - 0.4, cz);
        group.add(farGround, ground);
        junk.push(gtex, gmat, ground.geometry, farMat, farGround.geometry);

        // ---- 먼 빌딩 숲 (안개 속으로 흐려진다)
        for (var fx = -1850; fx <= 1850; fx += 72) {
          for (var fz = -1850; fz <= 1850; fz += 72) {
            var wx = cx + fx + (rnd() - 0.5) * 30, wz = cz + fz + (rnd() - 0.5) * 30, rr = Math.hypot(fx, fz);
            if ((Math.abs(wx - cx) < GR + 20 && Math.abs(wz - cz) < GR + 20) || rr > 1900 || rnd() < 0.3) continue;
            var fw = 18 + rnd() * 30, fd = 18 + rnd() * 30;
            var fh = 20 + Math.pow(rnd(), 1.7) * 230 * (0.55 + 0.45 * Math.pow(Math.sin(Math.atan2(fz, fx) * 3 + 1.3), 2));
            tower(wx - fw / 2, wx + fw / 2, wz - fd / 2, wz + fd / 2, fh, fh > 90 ? (rnd() < 0.6 ? 'glass' : 'office') : pick(['office', 'apt', 'low', 'office']));
          }
        }

        // ---- 외벽 그림: 모양마다 한 칸(TILE) 그림과, 밤에 켜진 창만 그린 그림
        function facade(k, lit) {
          var c = document.createElement('canvas'), S = 256;
          c.width = c.height = S;
          var x = c.getContext('2d'), sd = { glass: 3, office: 5, apt: 7, low: 9 }[k] * (lit ? 13 : 1);
          function r2() { sd = (sd * 16807) % 2147483647; return sd / 2147483647; }
          x.fillStyle = lit ? '#000000' : { glass: '#4b5c6d', office: '#ddd7cd', apt: '#efebe3', low: '#e4dacd' }[k];
          x.fillRect(0, 0, S, S);
          function win(px, py, w, h, base) {
            if (lit) {
              if (r2() < 0.34) { x.fillStyle = r2() < 0.8 ? '#ffd38c' : '#cfe4ff'; x.fillRect(px, py, w, h); }
              return;
            }
            var gr = x.createLinearGradient(0, py, 0, py + h);
            gr.addColorStop(0, base[0]);
            gr.addColorStop(1, base[1]);
            x.fillStyle = gr;
            x.fillRect(px, py, w, h);
          }
          var f, i;
          if (k === 'glass') {        // 4칸 × 2층: 층 위쪽에 슬래브 띠, 칸 사이 멀리언
            for (f = 0; f < 2; f++) for (i = 0; i < 4; i++) win(i * 64 + 2, f * 128 + 24, 60, 102, ['#a9c9dd', '#5e83a0']);
          } else if (k === 'office') { // 4칸 × 2층: 층 가운데 띠창, 칸 사이 기둥
            for (f = 0; f < 2; f++) for (i = 0; i < 4; i++) win(i * 64 + 7, f * 128 + 34, 50, 64, ['#7d93a4', '#4f6474']);
          } else if (k === 'apt') {    // 2세대 × 2층: 큰 베란다 창과 난간
            for (f = 0; f < 2; f++) for (i = 0; i < 2; i++) {
              win(i * 128 + 10, f * 128 + 22, 108, 84, ['#b7c8d4', '#8ea4b4']);
              if (!lit) { x.fillStyle = '#f7f5f0'; x.fillRect(i * 128 + 10, f * 128 + 70, 108, 5); }
            }
          } else {                     // 3창 × 2층
            for (f = 0; f < 2; f++) for (i = 0; i < 3; i++) win(i * 85 + 14, f * 128 + 34, 56, 58, ['#8195a3', '#5b6d7b']);
          }
          var t = new T.CanvasTexture(c);
          t.wrapS = t.wrapT = T.RepeatWrapping;
          t.anisotropy = aniso;
          t.encoding = T.sRGBEncoding;
          junk.push(t);
          return t;
        }
        ['glass', 'office', 'apt', 'low', 'roof'].forEach(function (k) {
          var bk = B[k];
          if (!bk || !bk.p.length) return;
          var geo = new T.BufferGeometry();
          geo.setAttribute('position', new T.Float32BufferAttribute(bk.p, 3));
          geo.setAttribute('normal', new T.Float32BufferAttribute(bk.n, 3));
          geo.setAttribute('uv', new T.Float32BufferAttribute(bk.u, 2));
          geo.setAttribute('color', new T.Float32BufferAttribute(bk.c, 3));
          var m = k === 'roof' ? new T.MeshLambertMaterial({ vertexColors: true })
            : new T.MeshLambertMaterial({ map: facade(k, false), vertexColors: true, emissive: 0xffffff, emissiveMap: facade(k, true), emissiveIntensity: C.glow });
          m.color.setScalar(C.light);
          junk.push(geo, m);
          var me = new T.Mesh(geo, m);
          me.frustumCulled = false;
          group.add(me);
        });

        // ---- 나무 (꼭대기 잎만 보이니 각진 공 하나씩)
        var tn = trees.length / 4, tgeo = new T.IcosahedronGeometry(1, 0), tmat = new T.MeshLambertMaterial({ color: '#ffffff' });
        tmat.color.setScalar(C.light * (C.glow > 0.5 ? 0.7 : 1));
        var tm = new T.InstancedMesh(tgeo, tmat, tn), M4 = new T.Matrix4(), TC = new T.Color();
        for (var ti = 0; ti < tn; ti++) {
          var trr = trees[ti * 4 + 2];
          M4.makeScale(trr, trr * 0.85, trr).setPosition(trees[ti * 4], trees[ti * 4 + 3] + 1.6 + trr * 0.8, trees[ti * 4 + 1]);
          tm.setMatrixAt(ti, M4);
          tm.setColorAt(ti, TC.setHSL(0.27 + rnd() * 0.08, 0.38 + rnd() * 0.15, 0.36 + rnd() * 0.12));
        }
        tm.frustumCulled = false;
        group.add(tm);
        junk.push(tgeo, tmat);

        // ---- 달리는 차: 도로마다 양방향 두 차선. 밤에는 앞뒤 불빛만 보이게 밝은 점으로
        var cars = [], CAR_COLORS = ['#f4f4f2', '#1d1f24', '#b9bec4', '#c8392f', '#2f5da8', '#e7e2d6', '#4d5560', '#2f7d5b'];
        // 차는 [t0, t1] 구간을 돌고 돈다. 다리가 없는 도로는 강 앞에서 끊기므로 강 남쪽·북쪽을 따로 돈다
        function addLane(axis, c, off, dir, t0, t1) {
          if (t0 == null) { t0 = -GR; t1 = GR; }
          for (var t = t0 + rnd() * 40; t < t1; t += 35 + rnd() * 70) {
            var bus = rnd() < 0.06;
            cars.push({ axis: axis, c: c + off, t: t, t0: t0, t1: t1, v: dir * (9 + rnd() * 6), len: bus ? 11 : 4.4, col: bus ? '#3a8f4f' : pick(CAR_COLORS), dir: dir });
          }
        }
        rx.forEach(function (x) {
          if (Math.abs(x - cx) >= 470) return;
          if (!rv || bridge[x]) { addLane('z', x, RW * 0.19, 1); addLane('z', x, -RW * 0.19, -1); return; }
          [[-GR, rv[0] - 2 - cz], [rv[1] + 2 - cz, GR]].forEach(function (r) { addLane('z', x, RW * 0.19, 1, r[0], r[1]); addLane('z', x, -RW * 0.19, -1, r[0], r[1]); });
        });
        rz.forEach(function (z) { if (Math.abs(z - cz) < 470) { addLane('x', z, -RW * 0.19, 1); addLane('x', z, RW * 0.19, -1); } });
        var cgeo = new T.BoxGeometry(1, 1, 1), cmat = night ? new T.MeshBasicMaterial({ color: '#ffffff' }) : new T.MeshLambertMaterial({ color: '#ffffff' });
        if (!night) cmat.color.setScalar(C.light);
        var cm = new T.InstancedMesh(cgeo, cmat, cars.length);
        cars.forEach(function (k, i) { cm.setColorAt(i, TC.set(night ? (k.dir > 0 ? '#fff1c8' : '#ff5b4a') : k.col)); });
        cm.frustumCulled = false;
        cm.instanceMatrix.setUsage(T.DynamicDrawUsage);
        group.add(cm);
        junk.push(cgeo, cmat);
        function placeCars(dt) {
          cars.forEach(function (k, i) {
            k.t += k.v * dt;
            if (k.t > k.t1) k.t -= k.t1 - k.t0; else if (k.t < k.t0) k.t += k.t1 - k.t0;
            var w = night ? 1.2 : 1.9, h = night ? 0.5 : 1.45, l = night ? k.len * 0.5 : k.len;
            if (k.axis === 'z') M4.makeScale(w, h, l).setPosition(k.c, G0 + h / 2 + 0.05, cz + k.t);
            else M4.makeScale(l, h, w).setPosition(cx + k.t, G0 + h / 2 + 0.05, k.c);
            cm.setMatrixAt(i, M4);
          });
          cm.instanceMatrix.needsUpdate = true;
        }
        placeCars(0);

        return {
          kind: kind,
          group: group,
          fog: new T.Fog(C.fog, 320, 2000),
          bg: C.fog,
          tick: placeCars,
          dispose: function () { junk.forEach(function (j) { j.dispose(); }); tm.dispose(); cm.dispose(); }
        };
      }
      function shadeHex(hex, k) { return '#' + new T.Color(hex).multiplyScalar(k).getHexString(); }
      function mixHex(a, b, t) { return '#' + new T.Color(a).lerp(new T.Color(b), t).getHexString(); }
      function hexA(hex, a) { var n = parseInt(hex.slice(1), 16); return 'rgba(' + (n >> 16 & 255) + ',' + (n >> 8 & 255) + ',' + (n & 255) + ',' + a + ')'; }

      // ---------- 방 표시 (화이트보드, 노트북, 상태등, 이름표) ----------
      function updateRoom(R, r) {
        var occ = { far: {}, near: {} };
        r.people.forEach(function (p) { occ[p.row][p.seat] = p; });
        ['far', 'near'].forEach(function (row) {
          R.laptops[row].forEach(function (lp, i) {
            var p = occ[row][i];
            lp.grp.visible = !!p;
            lp.scr.material = p && p.state === 'working' ? W.M.screenOn : W.M.screenOff;
          });
        });
        R.lamp.material.color.set(r.status.color || '#8f969d');
        R.blink = !!r.status.blink;
        drawBoard(R, r);
        drawPlate(R.plate, r.no ? String(r.no) : '', r.label, r.status.color, !!r.alert);
        // 글자 이름표(명패가 너무 작거나 뒷면이 보일 때 그 자리에 뜬다)도 명패와 같은 모양: [번호] 이름, 왼쪽 띠는 상태 색
        var label = r.status.label + (r.overflow ? ' +' + r.overflow : '');
        var lk = [r.no, r.label, label, r.status.color, r.alert].join('|');
        if (R.labelKey !== lk) {
          R.labelKey = lk;
          R.label.innerHTML = (r.no ? '<em>' + esc(r.no) + '</em>' : '') + esc(r.label);
          R.label.style.setProperty('--rc', r.status.color || '#8f969d');
          R.label.classList.toggle('alert', !!r.alert);
          R.label.title = r.label + ' · ' + label;
          R.label.setAttribute('aria-label', r.label + ' 회의실 들어가기 (' + label + ')');
        }
      }

      function drawBoard(R, r) {
        var mt = r.meeting, P = PAL;
        var key = JSON.stringify([r.no, r.label, r.status, mt, r.people.length]);
        if (R.boardKey === key) return;
        R.boardKey = key;
        var c = R.board.canvas, x = c.getContext('2d'), mw = c.width - 48;
        x.fillStyle = P.board;
        x.fillRect(0, 0, c.width, c.height);
        x.textBaseline = 'top';
        x.fillStyle = P.boardInk;
        x.font = '800 44px ' + FONT;
        fillFit(x, (r.no ? r.no + '  ' : '') + r.label, 24, 22, mw);
        if (mt) {
          x.font = '700 31px ' + FONT;
          fillFit(x, '안건 ' + mt.agenda, 24, 92, mw);
          x.fillStyle = P.boardMuted;
          x.font = '600 26px ' + FONT;
          fillFit(x, mt.phase, 24, 138, mw);
          if (mt.waiting) { x.fillStyle = '#d4820f'; x.font = '700 26px ' + FONT; fillFit(x, '의장 의견 대기', 24, 178, mw); }
        } else {
          x.fillStyle = r.status.color || P.boardInk;
          x.font = '700 32px ' + FONT;
          fillFit(x, r.status.label, 24, 98, mw);
        }
        var people = r.people.filter(function (p) { return !p.worker; }).length, bots = r.people.length - people;
        x.fillStyle = P.boardMuted;
        x.font = '600 24px ' + FONT;
        fillFit(x, people ? '세션 ' + people + '명' + (bots ? ' · 워커 ' + bots : '') : '비어 있음', 24, c.height - 48, mw);
        R.board.tex.needsUpdate = true;
      }

      // 층 옆 글씨: 이 컴퓨터는 '이 컴퓨터', 다른 컴퓨터는 마지막으로 받은 때 ('n분 전 동기화')
      function updateZones() {
        W.zones.forEach(function (zn) {
          var m = (snap.machines || []).filter(function (x) { return x.name === zn.name; })[0];
          drawZoneTags(zn, zn.self ? '이 컴퓨터' : m ? m.ago + ' 전 동기화' : '');
        });
      }
      function drawZoneTags(zn, status) {
        if (!zn.band || zn.tagText === status) return;
        zn.tagText = status;
        var b = zn.band, bx = b.x;
        bx.clearRect(0, 0, b.c.width, b.c.height);
        bx.font = '700 84px ' + FONT;
        bx.fillStyle = zn.color;
        bx.textBaseline = 'middle';
        bx.fillText(status, 8, b.c.height / 2 + 4);
        b.tex.needsUpdate = true;
        // 세로 줄: 층 이름(크게) + 상태(작게)를 한 줄로, 넘치면 줄여서 가운데에
        var v = zn.side, vx = v.x, name = zn.name + ' 층', k = 1;
        vx.clearRect(0, 0, v.c.width, v.c.height);
        vx.textBaseline = 'middle';
        vx.font = '800 132px ' + FONT;
        var nw = vx.measureText(name).width;
        vx.font = '700 76px ' + FONT;
        var stw = status ? vx.measureText(status).width + 40 : 0;
        if (nw + stw + 24 > v.c.width) k = v.c.width / (nw + stw + 24);
        var x0 = (v.c.width - (nw + stw) * k) / 2, mid = v.c.height / 2 + 6;
        vx.fillStyle = zn.color;
        vx.font = '800 ' + Math.floor(132 * k) + 'px ' + FONT;
        vx.fillText(name, x0, mid);
        if (status) {
          vx.globalAlpha = 0.85;
          vx.font = '700 ' + Math.floor(76 * k) + 'px ' + FONT;
          vx.fillText(status, x0 + (nw + 40) * k, mid + 14 * k);
          vx.globalAlpha = 1;
        }
        v.tex.needsUpdate = true;
      }

      // ---------- 갈 곳 ----------
      function roomPlace(R, lane) { return { t: 'room', R: R, lane: lane }; }
      function seatSpot(R, row, i, pose) {
        var x = R.seatX[i] != null ? R.seatX[i] : R.tcx;
        if (row === 'far') return { key: 'seat:' + R.name + ':f' + i, place: roomPlace(R, 'back'), x: x, ax: x, z: R.zFar, yaw: 0, pose: pose };
        return { key: 'seat:' + R.name + ':n' + i, place: roomPlace(R, 'front'), x: x, ax: x, z: R.zNear, yaw: Math.PI, pose: pose };
      }
      function standSpot(R, row, i) {
        var x = R.seatX[i] != null ? R.seatX[i] : R.tcx;
        if (row === 'far') return { key: 'stand:' + R.name + ':f' + i, place: roomPlace(R, 'back'), x: x, ax: x, z: R.zBack + 0.12, yaw: 0, pose: 'slump' };
        return { key: 'stand:' + R.name + ':n' + i, place: roomPlace(R, 'front'), x: x, ax: x, z: R.zFront - 0.05, yaw: Math.PI, pose: 'slump' };
      }
      function boardSpot(R) {
        var x = R.tcx + Math.min(1.25, R.tlen * 0.4 + 0.15);
        return { key: 'board:' + R.name, place: roomPlace(R, 'back'), x: x, ax: x, z: R.z0 + 0.55, yaw: 0, pose: 'present' };
      }
      // 승인·답변 대기: 대표실 책상 앞에 한 줄 넷씩 서서 책상(대표) 쪽을 본다
      function queueSpot(j, pose) {
        var x = W.desk.x - 1.2 + (j % 4) * 0.8, az = W.desk.z + 0.95;
        return { key: 'q' + j, place: W.desk.room.place(az), x: x, ax: x, z: W.desk.z + 1.4 + Math.floor(j / 4) * 0.8, yaw: Math.PI, pose: pose };
      }
      function doorSpot(R) {
        return { key: 'door:' + R.name, place: { t: 'corr', row: R.row }, x: R.xSide, ax: R.xSide, z: R.row.zc - 0.3, yaw: Math.PI, pose: 'stand' };
      }
      function baseSpot(p, R, slot, meeting) {
        if (!R) return W.elev;
        if (p.worker) return seatSpot(R, p.row, p.seat, 'type');
        var st = p.state;
        if (st === 'approval' || st === 'question') return queueSpot(slot[p.id] || 0, st === 'question' ? 'ask' : 'raise');
        if (st === 'error') return standSpot(R, p.row, p.seat);
        if (st === 'working') return p.chair && meeting ? boardSpot(R) : seatSpot(R, p.row, p.seat, 'type');
        return seatSpot(R, p.row, p.seat, R.kind === 'lounge' ? 'lounge' : 'sit');
      }
      function resting(a, now) {
        var b = a.base, p = a.p;
        return !!b && (b.pose === 'sit' || b.pose === 'lounge') && (p.state === 'done' || p.state === 'idle') && now - (p.since || now) > BREAK_AFTER;
      }

      // ---------- 길 찾기 ----------
      // 방 안은 뒤쪽 통로(back)·앞쪽 통로(front)·문 옆 통로, 밖은 방 앞 복도·왼쪽 세로 복도·로비 길(laneZ)만 따라 걷는다.
      function wp(x, z, place) { return { x: x, z: z, place: place }; }
      function laneZ(R, lane) { return lane === 'back' ? R.zBack : R.zFront; }
      function exitTo(pts, pos, pl) {
        if (pl.t === 'room') {
          var R = pl.R;
          pts.push(wp(pos.x, laneZ(R, pl.lane), pl));
          if (pl.lane === 'back') pts.push(wp(R.xSide, R.zBack, pl));
          pts.push(wp(R.xSide, R.zFront, roomPlace(R, 'front')));
          pts.push(wp(R.xSide, R.zDoor, roomPlace(R, 'front')));
          pts.push(wp(R.xSide, R.row.zc, { t: 'corr', row: R.row }));
          return { row: R.row, x: R.xSide };
        }
        // 문 달린 곳(탕비실, 아래쪽 방): 안쪽 통로(az) → 문 → 복도·로비 길
        if (pl.door != null) {
          var out = pl.t === 'corr' ? { t: 'corr', row: pl.row } : { t: 'lobby' };
          pts.push(wp(pos.x, pl.az, pl));
          pts.push(wp(pl.door, pl.az, pl));
          pts.push(wp(pl.door, pl.t === 'corr' ? pl.row.zc : W.laneZ, out));
          return pl.t === 'corr' ? { row: pl.row, x: pl.door } : { lobby: true, x: pl.door };
        }
        if (pl.t === 'corr') { pts.push(wp(pos.x, pl.row.zc, pl)); return { row: pl.row, x: pos.x }; }
        if (pl.t === 'lobby') { pts.push(wp(pos.x, W.laneZ, pl)); return { lobby: true, x: pos.x }; }
        return { spine: true };
      }
      function entryOf(spot) {
        var pl = spot.place;
        if (pl.t === 'room') {
          var R = pl.R, pts = [];
          pts.push(wp(R.xSide, R.row.zc, { t: 'corr', row: R.row }));
          pts.push(wp(R.xSide, R.zDoor, roomPlace(R, 'front')));
          pts.push(wp(R.xSide, R.zFront, roomPlace(R, 'front')));
          if (pl.lane === 'back') pts.push(wp(R.xSide, R.zBack, pl));
          pts.push(wp(spot.ax, laneZ(R, pl.lane), pl));
          return { hub: { row: R.row, x: R.xSide }, pts: pts };
        }
        if (pl.door != null) {
          var lane = pl.t === 'corr' ? pl.row.zc : W.laneZ, outside = pl.t === 'corr' ? { t: 'corr', row: pl.row } : { t: 'lobby' };
          return {
            hub: pl.t === 'corr' ? { row: pl.row, x: pl.door } : { lobby: true, x: pl.door },
            pts: [wp(pl.door, lane, outside), wp(pl.door, pl.az, pl), wp(spot.ax, pl.az, pl)]
          };
        }
        if (pl.t === 'corr') return { hub: { row: pl.row, x: spot.ax }, pts: [wp(spot.ax, pl.row.zc, pl)] };
        return { hub: { lobby: true, x: spot.ax }, pts: [wp(spot.ax, W.laneZ, pl), wp(spot.ax, spot.z, pl)] };
      }
      function travel(pts, A, B) {
        if (A.row && B.row && A.row === B.row) { if (A.x !== B.x) pts.push(wp(B.x, A.row.zc, { t: 'corr', row: A.row })); return; }
        if (A.lobby && B.lobby) return;
        var sp = { t: 'spine' }, xs = spineX();
        if (A.lobby) pts.push(wp(xs, W.laneZ, sp));
        else if (A.row) pts.push(wp(xs, A.row.zc, sp));
        pts.push(wp(xs, B.lobby ? W.laneZ : B.row.zc, sp));
      }
      function route(a, spot) {
        var pts = [], pl = a.place, to = spot.place;
        if (pl.t === 'room' && to.t === 'room' && pl.R === to.R) {
          var R = to.R, zA = laneZ(R, pl.lane), zB = laneZ(R, to.lane);
          pts.push(wp(a.pos.x, zA, pl));
          if (pl.lane !== to.lane) { pts.push(wp(R.xSide, zA, pl)); pts.push(wp(R.xSide, zB, to)); }
          pts.push(wp(spot.ax, zB, to));
        } else if (pl.room && pl.room === to.room) {
          // 같은 탕비실·아래쪽 방 안에서 옮길 때(줄이 당겨질 때 등): 안쪽 통로로
          pts.push(wp(a.pos.x, pl.az, pl));
          pts.push(wp(spot.ax, to.az, to));
        } else if (pl.t === 'lobby' && to.t === 'lobby' && !pl.room && !to.room && Math.abs(a.pos.x - spot.x) + Math.abs(a.pos.z - spot.z) < 2.6) {
          // 로비 길에서 조금 옮길 때는 바로 간다
        } else {
          var hub = exitTo(pts, a.pos, pl), en = entryOf(spot);
          travel(pts, hub, en.hub);
          pts = pts.concat(en.pts);
        }
        pts.push(wp(spot.x, spot.z, to));
        var out = [], px = a.pos.x, pz = a.pos.z;
        pts.forEach(function (q) {
          if (Math.abs(q.x - px) + Math.abs(q.z - pz) > 0.04) { out.push(q); px = q.x; pz = q.z; }
          else if (out.length) out[out.length - 1].place = q.place;
          else a.place = q.place;
        });
        return out;
      }

      // ---------- 사람 움직이기 ----------
      function charFor(p) { return p.charId || charOf(p); }
      function bodyFor(p) {
        if (p.worker) return makeRobot(p);
        var id = charFor(p);
        needPerson(id);
        return PEOPLE[id] ? makeModel(p, PEOPLE[id]) : makePerson(p);
      }
      function attachBody(a, parts) {
        a.parts = parts;
        a.obj = parts.root;
        var sh = new T.Mesh(G.plane, shadowMat);
        sh.rotation.x = -Math.PI / 2;
        sh.scale.set(0.8, 0.8, 1);
        sh.position.y = 0.014;
        a.obj.add(sh);
        a.shadow = sh;
        a.obj.position.set(a.pos.x, 0, a.pos.z);
        a.obj.rotation.y = a.yaw;
        scene.add(a.obj);
        if (a.id === CEO_ID) a.obj.add(ceoRing);
        a.snapPose = true;
        if (a.alpha < 1) setAlpha(a, true);
      }
      // 도형 사람으로 먼저 그렸다가 메시 캐릭터가 도착하면 바꿔 낀다
      function upgrade(a) {
        var id = charFor(a.p);
        if (a.worker || !PEOPLE[id] || (a.parts.model && a.parts.tpl === PEOPLE[id])) return;
        scene.remove(a.obj);
        if (a.parts.mixer) a.parts.mixer.stopAllAction();
        a.parts.mats.forEach(function (m) { m.dispose(); });
        attachBody(a, makeModel(a.p, PEOPLE[id]));
      }
      function createActor(p) {
        var a = {
          id: p.id, p: p, worker: !!p.worker, pos: new T.Vector3(), yaw: 0, path: [], spot: null, spotKey: '',
          place: { t: 'lobby' }, pose: 'stand', moving: false, walk: 0, speed: 1.4, seed: (hash(p.id) % 1000) / 100, alpha: 1, fadeDir: 0,
          leaving: false, brk: null, base: null, nextBreak: Date.now() + 2 * 60000 + Math.random() * 10 * 60000, snapPose: true, room: ''
        };
        attachBody(a, bodyFor(p));
        a.tag = document.createElement('div');
        a.tag.className = 'o3-tag';
        a.tag.setAttribute('data-pid', p.worker ? p.parent : p.id);
        a.tag.hidden = true;
        layer.appendChild(a.tag);
        a.bub = document.createElement('div');
        a.bub.className = 'o3-bub';
        a.bub.setAttribute('data-bid', p.id);
        a.bub.hidden = true;
        layer.appendChild(a.bub);
        return a;
      }
      function destroy(a) {
        endBreak(a);
        scene.remove(a.obj);
        if (a.parts.mixer) a.parts.mixer.stopAllAction();
        a.parts.mats.forEach(function (m) { m.dispose(); });
        a.tag.remove();
        a.bub.remove();
        delete actors[a.id];
      }
      function endBreak(a) {
        if (a.brk) { a.brk.spot.by = null; a.brk = null; }
      }
      function placeAt(a, spot) {
        a.pos.set(spot.x, 0, spot.z);
        a.yaw = spot.yaw;
        a.place = spot.place;
        a.path = [];
        a.spot = Object.assign({}, spot);
        a.spotKey = spot.key;
        a.pose = spot.pose;
        a.snapPose = true;
      }
      function go(a, spot) {
        a.spot = Object.assign({}, spot);
        a.spotKey = spot.key;
        a.path = route(a, spot);
        var len = 0, px = a.pos.x, pz = a.pos.z;
        a.path.forEach(function (q) { len += Math.abs(q.x - px) + Math.abs(q.z - pz); px = q.x; pz = q.z; });
        a.speed = clamp(len / 16, WALK_SPEED, 1.4);    // 보통 걸음, 아주 멀면 조금 빨리 (그래도 16초 넘게 걸리지 않게)
        if (!a.path.length) arrived(a);
      }
      function arrived(a) {
        a.pose = a.spot.pose;
        a.place = a.spot.place;
        if (a.leaving) a.fadeDir = -1;
      }
      function leave(a) {
        if (a.leaving) return;
        a.leaving = true;
        endBreak(a);
        var R = W.rooms[a.room];
        go(a, a.worker && R ? doorSpot(R) : W.elev);
      }
      function turn(a, target, k) { a.yaw += angDiff(target, a.yaw) * Math.min(1, k); }
      function setAlpha(a, force) {
        var tr = a.alpha < 0.999;
        a.parts.mats.forEach(function (m) {
          if (m.transparent !== tr || force) { m.transparent = tr; m.needsUpdate = true; }
          m.opacity = a.alpha;
        });
        a.shadow.visible = a.alpha > 0.4;
      }

      function step(a, dt, t) {
        if (a.path.length) {
          var w = a.path[0], dx = w.x - a.pos.x, dz = w.z - a.pos.z, d = Math.sqrt(dx * dx + dz * dz), mv = a.speed * dt;
          if (d > 0.001) turn(a, Math.atan2(dx, dz), dt * 10);
          if (d <= mv) {
            a.pos.x = w.x; a.pos.z = w.z;
            if (w.place) a.place = w.place;
            a.path.shift();
            if (!a.path.length) arrived(a);
          } else {
            a.pos.x += dx / d * mv;
            a.pos.z += dz / d * mv;
          }
          a.moving = a.path.length > 0;
          a.walk += dt * a.speed * 4.6;
        } else {
          a.moving = false;
          if (a.spot) turn(a, a.spot.yaw, dt * 7);
        }
        if (a.fadeDir) {
          a.alpha = clamp(a.alpha + a.fadeDir * dt * 2.2, 0, 1);
          setAlpha(a);
          if (a.fadeDir > 0 && a.alpha >= 1) a.fadeDir = 0;
          if (a.fadeDir < 0 && a.alpha <= 0) { destroy(a); return; }
        }
        a.obj.position.set(a.pos.x, 0, a.pos.z);
        a.obj.rotation.y = a.yaw;
        if (a.parts.model) modelPose(a, dt); else pose(a, dt, t);
      }

      // 메시 캐릭터: 자세에 맞는 동작으로 부드럽게 넘어가고, 앉는 동작이면 엉덩이를 의자 위에 맞춘다.
      function modelPose(a, dt) {
        var P = a.parts, ps = a.moving ? 'walk' : a.pose, clip = CLIP_FOR[ps] || 'idle';
        var b = a.p.bubble;
        if (clip === 'type' && b && b.kind === 'say' && Date.now() - (b.t || 0) < 45000) clip = 'talkSit';   // 방금 말했으면 손짓하며 말하기
        if (!P.actions[clip]) clip = P.actions.idle ? 'idle' : Object.keys(P.actions)[0];
        if (P.cur !== clip) {
          var next = P.actions[clip], fade = a.snapPose ? 0 : 0.35;
          next.reset();
          next.time = (a.seed * 1.7) % next.getClip().duration;
          next.setEffectiveWeight(1).fadeIn(fade).play();
          if (P.cur && P.actions[P.cur]) P.actions[P.cur].fadeOut(fade);
          P.cur = clip;
        }
        if (clip === 'walk') P.actions.walk.timeScale = a.speed / WALK_SPEED * WALK_V_REF / (P.tpl.walkV || WALK_V_REF);   // 발이 미끄러지지 않게 걸음 속도를 이동 속도에 맞춘다
        P.mixer.update(dt);
        // 앉는 동작은 원래 사람이 원점에서 뒤·옆으로 비켜 앉게 만들어져 있어서 엉덩이를 의자 가운데로 옮긴다
        var s = SITTING[ps] && P.tpl.sit[clip], tx = 0, ty = 0, tz = 0;
        if (s && clip === 'sleep') { tx = -s.x * P.tpl.scale; ty = BED_HIP - s.y * P.tpl.scale; tz = 0.05 - s.z * P.tpl.scale; }   // 침대 가운데에 눕힌다
        else if (s) { tx = -s.x * P.tpl.scale; ty = P.tpl.seatHip - s.y * P.tpl.scale; tz = (clip in SEAT_FWD_FOR ? SEAT_FWD_FOR[clip] : SEAT_FWD) - s.z * P.tpl.scale; }
        var k = a.snapPose ? 1 : Math.min(1, dt * 7);
        P.inner.position.x += (tx - P.inner.position.x) * k;
        P.inner.position.y += (ty - P.inner.position.y) * k;
        P.inner.position.z += (tz - P.inner.position.z) * k;
        a.snapPose = false;
      }

      // 도형 사람·로봇: 관절 목표 각도를 정하고 부드럽게 따라간다.
      function pose(a, dt, t) {
        var P = a.parts, s = a.seed, ps = a.moving ? 'walk' : a.pose;
        var J = { hip: P.standHip, t0: 0, t1: 0, s0: 0, s1: 0, x0: 0, x1: 0, z0: -0.06, z1: 0.06, tor: 0, hx: 0 };
        if (ps === 'walk') {
          var sn = Math.sin(a.walk), cs = Math.cos(a.walk);
          J.t0 = 0.5 * sn; J.t1 = -0.5 * sn;
          J.s0 = Math.max(0, -sn) * 0.7; J.s1 = Math.max(0, sn) * 0.7;
          J.x0 = -0.42 * sn; J.x1 = 0.42 * sn;
          J.hip = P.standHip + 0.025 * Math.abs(cs);
        } else if (SITTING[ps]) {
          J.hip = P.sitHip; J.t0 = J.t1 = -1.5; J.s0 = J.s1 = 1.5;
          if (ps === 'type') {
            J.x0 = -1.12 + 0.09 * Math.sin(t * 11 + s); J.x1 = -1.12 + 0.09 * Math.sin(t * 11 + s + 1.9);
            J.z0 = 0.24; J.z1 = -0.24; J.hx = 0.14; J.tor = 0.08;
          } else if (ps === 'lounge' || ps === 'sofa' || ps === 'doze' || ps === 'sleep') {
            J.x0 = J.x1 = -0.35; J.z0 = -0.12; J.z1 = 0.12; J.tor = -0.12; J.hx = -0.05;
          } else {
            J.x0 = J.x1 = -0.7; J.z0 = 0.12; J.z1 = -0.12; J.hx = 0.05 * Math.sin(t * 0.7 + s);
          }
        } else if (ps === 'raise') {
          J.x1 = -2.8; J.z1 = 0.2 + 0.28 * Math.sin(t * 5 + s); J.hx = -0.12;
        } else if (ps === 'ask') {
          J.x1 = -2.3; J.z1 = 0.12; J.hx = -0.08; J.tor = 0.03 * Math.sin(t * 2 + s);
        } else if (ps === 'slump') {
          J.tor = 0.22; J.hx = 0.5; J.x0 = J.x1 = 0.12;
        } else if (ps === 'present') {
          J.x1 = -1.4 + 0.28 * Math.sin(t * 2.1 + s); J.z1 = 0.55; J.x0 = -0.15;
        } else if (ps === 'cup') {
          var sip = Math.max(0, Math.sin(t * 0.8 + s) - 0.7) * 3;
          J.x1 = -1.2 - 0.5 * sip; J.z1 = -0.35; J.hx = -0.15 * sip;
        }
        J.tor += 0.012 * Math.sin(t * 1.7 + s);
        var k = Math.min(1, dt * (ps === 'walk' ? 25 : 10));
        if (a.snapPose) { k = 1; a.snapPose = false; }
        P.hip.position.y += (J.hip - P.hip.position.y) * k;
        P.th[0].rotation.x += (J.t0 - P.th[0].rotation.x) * k;
        P.th[1].rotation.x += (J.t1 - P.th[1].rotation.x) * k;
        P.sh[0].rotation.x += (J.s0 - P.sh[0].rotation.x) * k;
        P.sh[1].rotation.x += (J.s1 - P.sh[1].rotation.x) * k;
        P.arm[0].rotation.x += (J.x0 - P.arm[0].rotation.x) * k;
        P.arm[1].rotation.x += (J.x1 - P.arm[1].rotation.x) * k;
        P.arm[0].rotation.z += (J.z0 - P.arm[0].rotation.z) * k;
        P.arm[1].rotation.z += (J.z1 - P.arm[1].rotation.z) * k;
        P.torso.rotation.x += (J.tor - P.torso.rotation.x) * k;
        P.head.rotation.x += (J.hx - P.head.rotation.x) * k;
        if (P.cup) P.cup.visible = ps === 'cup';
      }

      // 쉬는 세션: 가끔 비어 있는 쉼터(탕비실, 휴게실, 수면실)에 다녀온다.
      // 너무 돌아다니지 않게 한 사람은 15~30분에 한 번, 동시에는 쉬는 사람의 4분의 1까지만 간다. 잠든 사람은 일이 생길 때까지 잔다.
      function tickBreaks(now) {
        var list = Object.keys(actors).map(function (id) { return actors[id]; });
        var restingN = 0, onBreak = 0;
        list.forEach(function (a) {
          if (a.worker || a.ceo || !a.base) return;
          if (resting(a, now)) restingN++;
          if (a.brk) onBreak++;
        });
        var cap = Math.max(1, Math.floor(restingN / 4));
        list.forEach(function (a) {
          if (a.worker || a.leaving || !a.base) return;
          var idle = resting(a, now);
          if (a.brk) {
            if (!idle) { endBreak(a); go(a, a.base); return; }
            if (a.path.length || a.brk.spot.sleep) return;
            if (!a.brk.until) a.brk.until = now + 40000 + Math.random() * 50000;
            else if (now > a.brk.until) { endBreak(a); go(a, a.base); a.nextBreak = now + 15 * 60000 + Math.random() * 15 * 60000; }
            return;
          }
          if (!idle || now < a.nextBreak || a.path.length || onBreak >= cap) return;
          onBreak++;
          // 아주 오래 쉬면 수면실 침대로, 아니면 가까운 쉼터(대개 그 줄 탕비실) 가운데 하나로
          var long = now - (a.p.since || now) > SLEEP_AFTER;
          var free = W.breaks.filter(function (b) { return !b.by && !!b.sleep === long; });
          if (!free.length) free = W.breaks.filter(function (b) { return !b.by && !b.sleep; });
          if (!free.length) { a.nextBreak = now + 30000; return; }
          free.sort(function (p, q) { return Math.abs(p.x - a.pos.x) + Math.abs(p.z - a.pos.z) - (Math.abs(q.x - a.pos.x) + Math.abs(q.z - a.pos.z)); });
          var b = free[Math.floor(Math.random() * Math.min(free.length, long ? free.length : 3))];
          b.by = a.id;
          a.brk = { spot: b, until: 0 };
          go(a, b);
        });
      }

      // ---------- 장면 받기 ----------
      function update(s) {
        snap = s;
        var key = JSON.stringify([look.theme, colsFor(s.rooms.length), s.self || '', s.rooms.map(function (r) { return [r.name, r.k, r.kind, r.machine]; })]);
        var relayout = false;
        if (key !== builtKey) {
          if (W) {
            // 방 배치가 바뀌면 걷던 길이 틀어지므로 모두 제자리로 옮긴다. 떠나던 사람은 바로 지운다.
            Object.keys(actors).forEach(function (id) { if (actors[id].leaving) destroy(actors[id]); });
          }
          build(s);
          builtKey = key;
          relayout = !first;
          resize(true);
        }
        // '시각대로'면 저녁·밤이 되면 도시만 다시 짓는다 (사무실은 그대로)
        if (city && city.kind !== skyNow(s.hour)) attachCity(s.hour);
        var queue = [];
        s.rooms.forEach(function (r) {
          r.people.forEach(function (p) { if (!p.worker && (p.state === 'approval' || p.state === 'question')) queue.push(p); });
        });
        queue.sort(function (a, b) { return (a.since || 0) - (b.since || 0) || (a.id < b.id ? -1 : 1); });
        var slot = {}, seen = {}, now = Date.now();
        queue.forEach(function (p, i) { slot[p.id] = i; });
        s.rooms.forEach(function (r) {
          var R = W.rooms[r.name];
          r.people.forEach(function (p) {
            seen[p.id] = true;
            var a = actors[p.id], fresh = !a;
            if (fresh) a = actors[p.id] = createActor(p);
            a.p = p;
            a.room = r.name;
            if (a.leaving) { a.leaving = false; a.fadeDir = 1; }
            var base = baseSpot(p, R, slot, r.meeting);
            a.base = base;
            var spot = base;
            if (a.brk) { if (resting(a, now)) spot = a.brk.spot; else endBreak(a); }
            if (fresh && !first) {
              placeAt(a, p.worker && R ? doorSpot(R) : W.elev);
              a.alpha = 0; setAlpha(a); a.fadeDir = 1;
              go(a, spot);
            } else if (fresh || relayout) placeAt(a, spot);
            else if (spot.key !== a.spotKey) go(a, spot);
            else {
              a.spot.pose = spot.pose;
              a.spot.yaw = spot.yaw;
              if (!a.path.length) a.pose = spot.pose;
            }
            setOverlay(a, p);
          });
          updateRoom(R, r);
        });
        Object.keys(actors).forEach(function (id) { if (!seen[id] && !actors[id].ceo) leave(actors[id]); });
        placeCeo(relayout || !actors[CEO_ID]);
        updateZones();
        if (s.focus !== focus || first) {
          focus = s.focus && W.rooms[s.focus] ? s.focus : null;
          backBtn.hidden = !focus;
          flyTo(focus ? roomFit(W.rooms[focus]) : overview());
          if (first) snapView();
        }
        first = false;
      }

      function setOverlay(a, p) {
        var st = p.state, key = p.name + '|' + st;
        if (a.tagKey !== key) {
          a.tagKey = key;
          // 상태 색은 이름표 왼쪽 띠로. 기호는 알림(승인·답변·막힘)과 대표만
          var ico = { approval: '!', question: '?', error: '!', ceo: '★' }[st] || '';
          a.alertIco = !!ico;   // 멀리서도 아이콘만은 보이게
          a.tag.style.setProperty('--sc', st === 'ceo' ? '#d4a017' : (snap.colors && snap.colors[st]) || '#8f969d');
          a.tagIco = ico ? '<b class="ico">' + ico + '</b>' : '';
          a.tagName = p.name;
          a.tagFit = '';
          a.tag.innerHTML = a.tagIco + '<span>' + esc(p.name) + '</span>';
          a.tag.title = (p.title || p.name) + ' · ' + ((snap.labels && snap.labels[st]) || st);
        }
        var b = p.bubble, bk = b && !p.worker ? b.kind + '|' + b.text : '';
        if (a.bubKey !== bk) {
          a.bubKey = bk;
          a.bubSize = null;
          a.bub.style.setProperty('--c', p.color || '#8f969d');
          a.bub.innerHTML = bk ? '<b>' + esc(p.name) + '</b><p>' + esc(b.text) + '</p>' : '';
        }
      }

      // ---------- 카메라 ----------
      function camPos(v, out) {
        var ce = Math.cos(v.el);
        return out.set(v.x + v.dist * Math.sin(v.az) * ce, v.y + v.dist * Math.sin(v.el), v.z + v.dist * Math.cos(v.az) * ce);
      }
      function applyView() {
        camPos(view, camera.position);
        camera.lookAt(view.x, view.y, view.z);
        camera.updateMatrixWorld();
      }
      function snapView() { Object.assign(view, goal); applyView(); }
      function flyTo(v) { Object.assign(goal, v); userMoved = false; }
      function stepCamera(dt) {
        var k = 1 - Math.exp(-dt * 5);
        view.x += (goal.x - view.x) * k;
        view.y += (goal.y - view.y) * k;
        view.z += (goal.z - view.z) * k;
        view.dist += (goal.dist - view.dist) * k;
        view.el += (goal.el - view.el) * k;
        view.az += angDiff(goal.az, view.az) * k;
        applyView();
      }
      // 상자 하나가 화면에 다 들어오는 거리 (화면 가장자리 limit 안쪽)
      function fitBox(x0, x1, z0, z1, h, limit, el, az) {
        var cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, corners = [];
        [x0, x1].forEach(function (x) { [z0, z1].forEach(function (z) { corners.push([x, 0, z], [x, h, z]); }); });
        var tmp = { x: cx, y: 0, z: cz, az: az, el: el, dist: 0 }, lo = 2, hi = 600;
        for (var i = 0; i < 24; i++) {
          tmp.dist = (lo + hi) / 2;
          camPos(tmp, camera.position);
          camera.lookAt(cx, 0, cz);
          camera.updateMatrixWorld();
          var ok = corners.every(function (c) {
            V.set(c[0], c[1], c[2]).project(camera);
            return V.z < 1 && Math.abs(V.x) <= limit && Math.abs(V.y) <= limit;
          });
          if (ok) hi = tmp.dist; else lo = tmp.dist;
        }
        applyView();
        return { x: cx, y: 0, z: cz, az: az, el: el, dist: hi };
      }
      function overview() {
        var f = fitBox(-0.3, W.width + 0.3, -0.3, W.depth + 0.3, 2.6, 0.9, 0.92, goal.az);
        maxDist = f.dist * (city ? 2.8 : 1.6);   // 도시가 있으면 더 물러나 둘러볼 수 있게
        return f;
      }
      function roomFit(R) {
        return fitBox(R.x0 - 0.2, R.x1 + 0.2, R.z0 - 0.2, R.z1 + 0.6, 2.4, 0.76, 1.06, goal.az);
      }
      function ground(px, py) {
        var ndc = new T.Vector2(px / cw * 2 - 1, -(py / ch) * 2 + 1), ray = new T.Raycaster();
        ray.setFromCamera(ndc, camera);
        var out = new T.Vector3();
        return ray.ray.intersectPlane(new T.Plane(new T.Vector3(0, 1, 0), 0), out) ? out : null;
      }
      function roomAt(x, z) {
        var names = Object.keys(W.rooms);
        for (var i = 0; i < names.length; i++) {
          var R = W.rooms[names[i]];
          if (x >= R.x0 && x <= R.x1 && z >= R.z0 && z <= R.z1 + 0.3) return R;
        }
        return null;
      }
      function panBy(dx, dy) {
        var wpp = 2 * view.dist * Math.tan(camera.fov * Math.PI / 360) / ch;
        var f = dy * wpp / Math.max(0.3, Math.sin(view.el));
        var mx = -Math.cos(view.az) * dx * wpp - Math.sin(view.az) * f;
        var mz = Math.sin(view.az) * dx * wpp - Math.cos(view.az) * f;
        view.x += mx; view.z += mz; goal.x += mx; goal.z += mz;
        userMoved = true;
      }
      function rotateBy(dx, dy) {
        view.az -= dx * 0.006;
        goal.az = view.az;
        view.el = goal.el = clamp(view.el + dy * 0.004, 0.42, 1.45);
        userMoved = true;
      }
      function zoomAt(px, py, f) {
        var p1 = ground(px, py);
        view.dist = goal.dist = clamp(view.dist * f, 2.5, Math.max(maxDist, 20));
        applyView();
        var p2 = ground(px, py);
        if (p1 && p2) { view.x += p1.x - p2.x; view.z += p1.z - p2.z; goal.x = view.x; goal.z = view.z; }
        applyView();
        userMoved = true;
      }

      // ---------- 입력 ----------
      var pointers = {}, drag = null;
      function pts2() {
        var ids = Object.keys(pointers);
        return ids.length >= 2 ? [pointers[ids[0]], pointers[ids[1]]] : null;
      }
      canvas.addEventListener('pointerdown', function (e) {
        try { canvas.setPointerCapture(e.pointerId); } catch (_) {}
        var r = canvas.getBoundingClientRect();
        pointers[e.pointerId] = { x: e.clientX - r.left, y: e.clientY - r.top };
        var two = pts2();
        if (two) {
          drag = { mode: 'pinch', moved: true, d: Math.hypot(two[0].x - two[1].x, two[0].y - two[1].y), ang: Math.atan2(two[1].y - two[0].y, two[1].x - two[0].x), mx: (two[0].x + two[1].x) / 2, my: (two[0].y + two[1].y) / 2 };
        } else {
          var p = pointers[e.pointerId];
          drag = { mode: e.button === 2 || e.ctrlKey || e.shiftKey || e.altKey ? 'rot' : 'pan', sx: p.x, sy: p.y, lx: p.x, ly: p.y, moved: false, button: e.button };
        }
      });
      canvas.addEventListener('pointermove', function (e) {
        if (!pointers[e.pointerId] || !drag) return;
        var r = canvas.getBoundingClientRect();
        pointers[e.pointerId] = { x: e.clientX - r.left, y: e.clientY - r.top };
        if (drag.mode === 'pinch') {
          var two = pts2();
          if (!two) return;
          var d = Math.hypot(two[0].x - two[1].x, two[0].y - two[1].y), ang = Math.atan2(two[1].y - two[0].y, two[1].x - two[0].x);
          var mx = (two[0].x + two[1].x) / 2, my = (two[0].y + two[1].y) / 2;
          panBy(mx - drag.mx, my - drag.my);
          if (d > 10 && drag.d > 10) zoomAt(mx, my, drag.d / d);
          view.az -= angDiff(ang, drag.ang);
          goal.az = view.az;
          drag.d = d; drag.ang = ang; drag.mx = mx; drag.my = my;
          return;
        }
        var p = pointers[e.pointerId], dx = p.x - drag.lx, dy = p.y - drag.ly;
        drag.lx = p.x; drag.ly = p.y;
        if (!drag.moved && Math.abs(p.x - drag.sx) + Math.abs(p.y - drag.sy) < 6) return;
        drag.moved = true;
        if (drag.mode === 'rot') rotateBy(dx, dy); else panBy(dx, dy);
      });
      function endPointer(e) {
        if (!pointers[e.pointerId]) return;
        var p = pointers[e.pointerId];
        delete pointers[e.pointerId];
        var left = Object.keys(pointers);
        if (left.length === 1) {   // 두 손가락에서 한 손가락이 남으면 이어서 끌기
          var q = pointers[left[0]];
          drag = { mode: 'pan', sx: q.x, sy: q.y, lx: q.x, ly: q.y, moved: true };
          return;
        }
        if (!left.length) {
          if (drag && !drag.moved && e.type === 'pointerup' && (drag.button === 0 || drag.button == null)) pick(p.x, p.y);
          drag = null;
        }
      }
      canvas.addEventListener('pointerup', endPointer);
      canvas.addEventListener('pointercancel', endPointer);
      canvas.addEventListener('contextmenu', function (e) { e.preventDefault(); });
      container.addEventListener('wheel', function (e) {
        if (e.target.closest && e.target.closest('.o3-bub, .speech-card, .o3-look')) return;   // 말풍선·카드·조명 판 안은 그대로
        e.preventDefault();
        var r = canvas.getBoundingClientRect();
        zoomAt(e.clientX - r.left, e.clientY - r.top, Math.exp(clamp(e.deltaY, -120, 120) * 0.0016));
      }, { passive: false });
      tools.addEventListener('click', function (e) {
        var b = e.target.closest('button[data-a]');
        if (!b || !W) return;
        var act = b.getAttribute('data-a');
        if (act === 'left') goal.az += Math.PI / 4;
        else if (act === 'right') goal.az -= Math.PI / 4;
        else if (act === 'in') goal.dist = Math.max(2.5, goal.dist / 1.35);
        else if (act === 'out') goal.dist = Math.min(Math.max(maxDist, 20), goal.dist * 1.35);
        else if (act === 'home') { if (focus) host.back(); else flyTo(overview()); }
        else if (act === 'look') {
          lookPanel.hidden = !lookPanel.hidden;
          b.setAttribute('aria-expanded', String(!lookPanel.hidden));
          syncLookPanel();
          return;
        } else if (act === 'city') {
          look.city = !look.city;
          saveLook();
          syncCityBtn();
          if (look.city) attachCity(snap ? snap.hour : new Date().getHours()); else detachCity();
          return;
        }
        userMoved = act !== 'home';
      });
      // 조명 판: 테마를 바꾸면 사무실을 다시 짓고, 밝기·빛 색은 바로 바뀐다
      function syncLookPanel() {
        lookPanel.querySelectorAll('[data-theme]').forEach(function (b) { b.classList.toggle('on', b.getAttribute('data-theme') === look.theme); });
        lookPanel.querySelectorAll('[data-sky]').forEach(function (b) { b.classList.toggle('on', b.getAttribute('data-sky') === (look.sky || 'auto')); });
        lookPanel.querySelectorAll('input[data-k]').forEach(function (inp) { inp.value = look[inp.getAttribute('data-k')]; });
        lookPanel.querySelector('.o3-ceo-name').textContent = look.ceo + '. ' + (CHAR_NAMES[look.ceo] || '');
      }
      function saveLook() { try { localStorage.setItem(LOOK_KEY, JSON.stringify(look)); } catch (_) {} }
      function syncCityBtn() { tools.querySelector('[data-a="city"]').setAttribute('aria-pressed', String(!!look.city)); }
      syncCityBtn();
      lookPanel.addEventListener('click', function (e) {
        var cb = e.target.closest('[data-ceo]');
        if (cb) {
          // 대표 캐릭터 바꾸기: 그 캐릭터를 불러와서 갈아 입힌다
          var n = PEOPLE_IDS.length, idx = PEOPLE_IDS.indexOf(look.ceo);
          look.ceo = PEOPLE_IDS[((idx < 0 ? 0 : idx) + Number(cb.getAttribute('data-ceo')) + n) % n];
          saveLook();
          syncLookPanel();
          var ca = actors[CEO_ID];
          if (ca) { ca.p = ceoPerson(); needPerson(look.ceo); upgrade(ca); if (ceoRing.parent !== ca.obj) ca.obj.add(ceoRing); }
          return;
        }
        var sb = e.target.closest('[data-sky]');
        if (sb) {
          // 도시 배경 시간대: 시각대로 / 낮 / 저녁 / 밤 (사무실은 그대로, 도시만 다시 짓는다)
          look.sky = sb.getAttribute('data-sky');
          saveLook();
          syncLookPanel();
          if (city && snap) attachCity(snap.hour);
          return;
        }
        var b = e.target.closest('[data-theme]');
        if (!b || b.getAttribute('data-theme') === look.theme) return;
        look.theme = b.getAttribute('data-theme');
        saveLook();
        syncLookPanel();
        if (snap) update(snap);
      });
      lookPanel.addEventListener('input', function (e) {
        var k = e.target.getAttribute && e.target.getAttribute('data-k');
        if (!k) return;
        look[k] = Number(e.target.value);
        applyLight();
        saveLook();
      });
      backBtn.addEventListener('click', function (e) { e.stopPropagation(); host.back(); });
      layer.addEventListener('click', function (e) {
        var t = e.target.closest('[data-room],[data-pid],[data-bid]');
        if (!t) return;
        e.stopPropagation();
        if (t.hasAttribute('data-room')) { host.room(t.getAttribute('data-room')); return; }
        if (t.getAttribute('data-pid') === CEO_ID) { selectCeo(!actors[CEO_ID].selected); return; }
        if (t.hasAttribute('data-pid')) { host.person(t.getAttribute('data-pid')); return; }
        var a = actors[t.getAttribute('data-bid')];
        if (!a) return;
        // 말풍선을 누르면 방에 들어가지 않고 그 사람이 한 말 카드만
        host.speech(a.id);
      });

      // 손가락은 마우스보다 굵어서, 터치 화면에서는 사람을 고르는 범위를 넓힌다 (사람을 눌렀는데 방에 들어가 버리지 않게)
      var TOUCH = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
      function pick(px, py) {
        if (!W) return;
        var best = null, bd = 1e9;
        Object.keys(actors).forEach(function (id) {
          var a = actors[id], sc = a.scr;
          if (!sc || a.alpha < 0.5) return;
          var hw = Math.max(TOUCH ? 20 : 10, sc.ppm * (TOUCH ? 0.45 : 0.3)), hb = Math.max(TOUCH ? 34 : 24, sc.ppm * (SITTING[a.pose] ? 1.0 : 1.5));
          var dx = Math.abs(px - sc.x), dy = py - sc.y;
          if (dx > hw || dy < (TOUCH ? -14 : -6) || dy > hb) return;
          if (dx < bd) { bd = dx; best = a; }
        });
        // 대표: 누르면 고르고/놓고, 고른 동안 바닥을 누르면 그리로 걸어간다
        var ceo = actors[CEO_ID];
        if (best && best.ceo) { selectCeo(!ceo.selected); return; }
        if (ceo && ceo.selected) {
          var gp0 = ground(px, py);
          if (gp0) moveCeo(gp0.x, gp0.z);
          return;
        }
        if (best) { host.person(best.worker ? best.p.parent : best.id); return; }
        var gp = ground(px, py), R = gp && roomAt(gp.x, gp.z);
        if (R) host.room(R.name);
      }

      // ---------- 대표 (나) ----------
      // 세션과 상관없는 내 캐릭터. 처음엔 대표실 책상에 앉아 있고, 골라서 바닥을 누르면 그리로 걸어간다.
      var CEO_ID = '__ceo';
      var ceoRing = new T.Mesh(new T.RingGeometry(0.42, 0.52, 32), new T.MeshBasicMaterial({ color: '#f2c14e', transparent: true, opacity: 0.9, depthWrite: false }));
      ceoRing.rotation.x = -Math.PI / 2;
      ceoRing.position.y = 0.02;
      ceoRing.visible = false;
      function ceoPerson() { return { id: CEO_ID, name: '대표 (나)', title: '대표 (나) · 누르면 골라서 움직여요', state: 'ceo', charId: look.ceo, color: '#d4a017' }; }
      function placeCeo(force) {
        var a = actors[CEO_ID];
        if (!a) {
          a = actors[CEO_ID] = createActor(ceoPerson());
          a.ceo = true;
          a.tag.setAttribute('data-pid', CEO_ID);
          force = true;
        }
        a.room = '';
        if (force) placeAt(a, W.ceoSeat);
        if (ceoRing.parent !== a.obj) a.obj.add(ceoRing);
        setOverlay(a, a.p);
      }
      function selectCeo(on) {
        var a = actors[CEO_ID];
        if (!a) return;
        a.selected = on;
        ceoRing.visible = on;
        a.tag.classList.toggle('sel', on);
        hint.textContent = on ? '바닥을 누르면 대표가 그리로 걸어가요 · 대표를 다시 누르면 놓아요' : hintText;
        hint.classList.toggle('fade', !on);
      }
      // 누른 바닥 자리를 걸어갈 수 있는 곳(방 통로, 탕비실, 복도, 로비, 아래쪽 방)으로 맞춘다
      function spotAt(x, z) {
        var key = 'ceo:' + Math.round(x * 10) + ':' + Math.round(z * 10), seat = W.ceoSeat;
        if (Math.abs(x - seat.x) < 0.9 && Math.abs(z - seat.z) < 0.9) return seat;
        var R = roomAt(x, z);
        if (R && z <= R.z1) {
          var lane = z < R.zTable ? 'back' : 'front', rx = clamp(x, R.x0 + 0.4, R.x1 - 0.4);
          return { key: key, place: roomPlace(R, lane), x: rx, ax: rx, z: laneZ(R, lane), yaw: lane === 'back' ? 0 : Math.PI, pose: 'stand' };
        }
        for (var i = 0; i < W.rows.length; i++) {
          var row = W.rows[i], pk = row.pantry;
          if (z >= row.z0 && z <= row.z0 + ROOM_D && x >= pk.x0 && x <= pk.x1) {
            var tx = clamp(x, pk.x0 + 0.4, pk.x1 - 0.5), tz = clamp(z, row.z0 + 1.2, row.z0 + ROOM_D - 0.5);
            return { key: key, place: pk.place, x: tx, ax: tx, z: tz, yaw: 0, pose: 'stand' };
          }
          if (z > row.z0 + ROOM_D && z <= row.z0 + ROOM_D + CORR) {
            var cx = clamp(x, 0.5, row.x1 - 0.3);
            return { key: key, place: { t: 'corr', row: row }, x: cx, ax: cx, z: clamp(z, row.zc - 0.8, row.zc + 0.8), yaw: 0, pose: 'stand' };
          }
        }
        if (z >= W.lobby.z0 && z < W.lobby.z0 + LANE_D) return { key: key, place: { t: 'lobby' }, x: clamp(x, 0.6, W.width - 0.4), ax: clamp(x, 0.6, W.width - 0.4), z: z, yaw: 0, pose: 'stand' };
        for (var j = 0; j < W.lower.length; j++) {
          var L = W.lower[j];
          if (x >= L.x0 && x <= L.x1 && z >= L.z0 && z <= L.z1) {
            var lx = clamp(x, L.x0 + 0.4, L.x1 - 0.4), lz = clamp(z, L.z0 + 0.6, L.z1 - 0.4);
            return { key: key, place: L.place(L.z0 + 0.75), x: lx, ax: lx, z: lz, yaw: 0, pose: 'stand' };
          }
        }
        if (x < SPINE && z < W.lobby.z0 && W.rows.length) {   // 왼쪽 세로 복도: 가까운 줄 복도로
          var near = W.rows.reduce(function (p, q) { return Math.abs(q.zc - z) < Math.abs(p.zc - z) ? q : p; });
          return { key: key, place: { t: 'corr', row: near }, x: spineX(), ax: spineX(), z: near.zc, yaw: 0, pose: 'stand' };
        }
        return null;
      }
      function moveCeo(x, z) {
        var a = actors[CEO_ID], spot = a && spotAt(x, z);
        if (!spot) return;
        go(a, spot);
        a.speed = Math.max(a.speed, 1.2);
      }

      // ---------- 머리 위 이름표·말풍선 ----------
      function screenOf(v) {
        V.copy(v).project(camera);
        if (V.z > 1 || V.z < -1) return null;
        return { x: (V.x + 1) * 0.5 * cw, y: (1 - V.y) * 0.5 * ch };
      }
      function put(el, x, y, ax, ay) {
        el.style.transform = 'translate(' + Math.round(x) + 'px,' + Math.round(y) + 'px) translate(' + ax + ',' + ay + ')';
      }
      function vis(el, on) { if (el.hidden === on) el.hidden = !on; }
      // 이름표 글씨를 폭 w(px) 에 두 줄까지 단어 단위로 나눈다. 한 단어가 한 줄보다 길거나 두 줄을 넘치면 말줄임.
      var tagCtx = null;
      function tagW(t) {
        if (!tagCtx) {
          tagCtx = document.createElement('canvas').getContext('2d');
          tagCtx.font = '700 ' + TAG_FONT + 'px ' + (getComputedStyle(layer).fontFamily || FONT);
        }
        return tagCtx.measureText(t).width;
      }
      function cutTo(t, w) {
        if (tagW(t) <= w) return t;
        while (t.length > 1 && tagW(t + '…') > w) t = t.slice(0, -1);
        return t + '…';
      }
      function fitName(name, w) {
        var words = String(name || '').split(/\s+/).filter(Boolean), lines = [];
        while (words.length && lines.length < 2) {
          var line = '';
          while (words.length && tagW(line ? line + ' ' + words[0] : words[0]) <= w) line = line ? line + ' ' + words.shift() : words.shift();
          if (!line) line = cutTo(words.shift(), w);
          lines.push(line);
        }
        if (words.length) lines[lines.length - 1] = cutTo(lines[lines.length - 1] + ' ' + words.join(' '), w);
        return lines;
      }
      function hit(p, q) { return p.x < q.x + q.w + 3 && q.x < p.x + p.w + 3 && p.y < q.y + q.h + 3 && q.y < p.y + p.h + 3; }

      // 유리 명패 크기: 화면에서 PLATE_MIN_PX 보다 낮게 보이면 유리 폭 안에서 키운다.
      // 그래도 글씨가 작거나 명패 뒷면·옆면이 보이면 small 로 두고 명패 대신 그 자리에 같은 모양의 글자 이름표를 띄운다.
      // off: 그 방에 들어가 볼 때 (앞 유리와 함께 치운다)
      function fitPlates() {
        W.plates.forEach(function (pl) {
          pl.small = false;
          pl.mesh.visible = !pl.off;
          if (pl.off) return;
          HV.set(pl.x, PLATE_Y - PLATE_H / 2, pl.z);
          var a = screenOf(HV);
          HV.y += PLATE_H;
          var b = screenOf(HV);
          var d = camera.position.distanceTo(HV), face = d > 0 ? (camera.position.z - pl.z) / d : 0;
          var px = a && b ? a.y - b.y : 0;
          var s = px > 0.5 ? clamp(PLATE_MIN_PX / px, 1, pl.maxS) : 1;
          pl.mesh.scale.set(pl.w * s, PLATE_H * s, 1);
          pl.mesh.position.y = Math.max(PLATE_Y, 0.25 + PLATE_H * s / 2);
          pl.small = face < 0.3 || px * s < PLATE_MIN_PX * 0.9;
          pl.mesh.visible = !pl.small;
        });
      }

      function layoutOverlays() {
        var focal = ch / (2 * Math.tan(camera.fov * Math.PI / 360));
        var placed = [];   // 화면에 놓인 층 이름표·말풍선 (말풍선이 비켜 간다)
        W.labels.forEach(function (lb) {
          if (lb.plate) HV.set(lb.plate.x, lb.plate.mesh.position.y, lb.plate.z);
          else HV.set(lb.x, lb.y, lb.z);
          var ppm = focal / camera.position.distanceTo(HV), sp = screenOf(HV);
          var on = !!sp && sp.x > -240 && sp.x < cw + 240 && sp.y > -40 && sp.y < ch + 40 && (!lb.minPpm || ppm >= lb.minPpm) && lb.room !== focus;
          if (lb.plate && !lb.plate.small) on = false;
          if (lb.zone) on = !!sp && !focus;
          vis(lb.el, on);
          if (!on) return;
          if (lb.zone) {
            // 층 이름표: 건물 왼쪽 바깥에 붙이고, 그 자리가 화면 밖이면 화면 왼쪽 끝에 붙인다.
            // 그때 높이는 띠가 그 자리를 지나는 높이로 맞춘다 (띠는 화면에서도 곧은 줄이다).
            if (!lb.w) { lb.w = lb.el.offsetWidth; lb.h = lb.el.offsetHeight; }
            var zx = clamp(sp.x - 10, lb.w + 8, cw - 8), zy = sp.y;
            HV.set(W.width, lb.y, lb.z);
            var sb = zx > sp.x ? screenOf(HV) : null;
            if (sb && sb.x - sp.x > 1) zy += (sb.y - sp.y) * (zx - lb.w / 2 - sp.x) / (sb.x - sp.x);
            if (zy < -40 || zy > ch + 40) { vis(lb.el, false); return; }
            put(lb.el, zx, zy, '-100%', '-50%');
            placed.push({ x: zx - lb.w, y: zy - lb.h / 2, w: lb.w, h: lb.h });
            return;
          }
          put(lb.el, sp.x, sp.y, lb.ax, lb.ay);
          if (lb.room) {
            // 멀리서 보면 방 이름만, 가까우면 상태까지
            var mode = (focus ? 'dim' : '') + (ppm < 20 ? ' compact' : '');
            if (lb.mode !== mode) { lb.el.classList.toggle('dim', !!focus); lb.el.classList.toggle('compact', ppm < 20); lb.mode = mode; }
          }
        });
        var list = Object.keys(actors).map(function (id) { return actors[id]; });
        var latest = 0;
        list.forEach(function (a) {
          var b = a.p.bubble;
          if (b && b.kind === 'say' && !b.old && !a.worker && (!focus || a.room === focus) && b.t > latest) latest = b.t;
        });
        var items = [];
        list.forEach(function (a) {
          a.parts.head.getWorldPosition(HV);
          var headY = HV.y;
          HV.y += a.parts.top;
          var ppm = focal / camera.position.distanceTo(HV), sp = screenOf(HV);
          a.scr = sp ? { x: sp.x, y: sp.y, ppm: ppm } : null;
          var on = !!sp && a.alpha > 0.3 && sp.x > -120 && sp.x < cw + 120 && sp.y > -120 && sp.y < ch + 240;
          var inFocus = !!focus && a.room === focus;
          // 이름표는 머리 오른쪽 옆에 네모로. 책상에 앉은 사람은 모두 같은 높이(TAG_DESK_Y)라 한 줄로 가지런하고,
          // 폭은 옆자리 사람 머리에 닿지 않을 만큼만 (넘치면 두 줄, 그래도 넘치면 말줄임). 그 폭이 안 나오면 멀리서처럼 감춘다.
          var still = !a.moving && a.alpha > 0.9, desk = still && a.spotKey.indexOf('seat:') === 0;
          var gap = desk ? SEAT : still && /^q\d/.test(a.spotKey) ? 0.8 : 1.6;
          var mw = Math.min(150, Math.floor(((gap - 0.22) * ppm - 2) / 2) * 2);
          var full = on && (inFocus || ppm > 34) && mw >= 36, icon = on && !full && a.alertIco;
          vis(a.tag, full || icon);
          var top = sp ? sp.y - 4 : 0;
          if (a.tagMode !== (icon ? 'icon' : 'full')) { a.tag.classList.toggle('icon-only', icon); a.tagMode = icon ? 'icon' : 'full'; }
          if (icon) {
            put(a.tag, sp.x, sp.y, '-50%', '-100%');
            top = sp.y - 24;
          } else if (full) {
            var fk = mw + '|' + a.tagKey;
            if (a.tagFit !== fk) {
              a.tagFit = fk;
              a.tag.innerHTML = a.tagIco + '<span>' + fitName(a.tagName, mw - TAG_PAD - (a.tagIco ? 15 : 0)).map(esc).join('<br>') + '</span>';
            }
            HV.y = desk && SITTING[a.pose] ? TAG_DESK_Y : headY - 0.1;
            var tp = screenOf(HV) || sp;
            put(a.tag, sp.x + 0.11 * ppm + 1, tp.y, '0', '-50%');
          }
          var b = a.p.bubble, want = on && !a.worker && !!a.bubKey && b && b.kind !== 'mini' && a.alpha > 0.6;
          if (want && focus) want = inFocus || b.kind === 'alert';
          else if (want && ppm < 12) want = b.kind === 'alert' || b.t === latest;
          if (!want) { vis(a.bub, false); return; }
          var big = inFocus;
          var below = big && a.p.row === 'near' && a.spotKey.indexOf('seat:') === 0 && !a.moving;
          // 방 안에서는 2D 처럼 말풍선 폭을 자리 간격에 맞춰 옆 사람 말풍선과 나란히 선다.
          var mw = Math.round((big ? clamp(SEAT * ppm - 8, 84, 360) : clamp(SEAT * ppm * 1.8, 96, 210)) / 4) * 4;
          var isLatest = b.kind === 'say' && b.t === latest;
          var cls = 'o3-bub ' + b.kind + (b.old ? ' old' : '') + (big ? ' big' : '') + (below ? ' below' : '') + (isLatest ? ' latest' : '');
          if (a.bubCls !== cls) { a.bub.className = cls; a.bubCls = cls; a.bubSize = null; }
          if (a.bubMw !== mw) { a.bub.style.setProperty('--mw', mw + 'px'); a.bubMw = mw; a.bubSize = null; }
          var y = top;
          if (below) {
            HV.set(a.pos.x - Math.sin(a.yaw) * 0.45, 0, a.pos.z - Math.cos(a.yaw) * 0.45);
            var fp = screenOf(HV);
            y = fp ? fp.y + 8 : top;
          }
          // 겹치면 알림 → 가장 최근 말 → 최근 말 → 하던 일 → 조금 지난 말 순서로 남긴다
          items.push({ a: a, x: sp.x, y: y, below: below, prio: (b.kind === 'alert' ? 4 : b.kind === 'say' ? (isLatest ? 3 : b.old ? 0.5 : 2) : 1) + (b.t || 0) / 1e13 });
        });
        // 크기가 바뀐 말풍선만 다시 잰다 (한꺼번에 보이게 한 뒤 읽어서 레이아웃은 한 번만)
        items.forEach(function (it) { if (!it.a.bubSize) vis(it.a.bub, true); });
        items.forEach(function (it) { if (!it.a.bubSize) it.a.bubSize = { w: it.a.bub.offsetWidth, h: it.a.bub.offsetHeight }; });
        items.sort(function (p, q) { return q.prio - p.prio; });
        items.forEach(function (it) {
          // 겹치면 위(아래)로 두 번까지 비켜 보고, 그래도 겹치면 감춘다.
          var s = it.a.bubSize, r = { x: it.x - s.w / 2, y: it.below ? it.y : it.y - s.h, w: s.w, h: s.h };
          for (var n = 0; n < 2; n++) {
            var o = null;
            for (var i = 0; i < placed.length; i++) if (hit(placed[i], r)) { o = placed[i]; break; }
            if (!o) break;
            r.y = it.below ? o.y + o.h + 4 : o.y - s.h - 4;
          }
          var ok = r.y + r.h > 0 && r.y < ch && !placed.some(function (q) { return hit(q, r); });
          vis(it.a.bub, ok);
          if (!ok) return;
          placed.push(r);
          it.a.bub.style.zIndex = String(10 + Math.floor(it.prio));
          put(it.a.bub, r.x + s.w / 2, it.below ? r.y : r.y + s.h, '-50%', it.below ? '0' : '-100%');
        });
      }

      // ---------- 그리기 ----------
      function resize(force) {
        var w = container.clientWidth, h = container.clientHeight;
        if (!w || !h || (!force && w === cw && h === ch)) return;
        cw = w; ch = h;
        renderer.setSize(w, h, false);
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
        Object.keys(actors).forEach(function (id) { actors[id].bubSize = null; });
        if (W && !userMoved) flyTo(focus ? roomFit(W.rooms[focus]) : overview());
      }
      if (window.ResizeObserver) new ResizeObserver(function () { resize(); }).observe(container);
      else window.addEventListener('resize', function () { resize(); });

      function frame(t) {
        raf = requestAnimationFrame(frame);
        if (!W) return;
        if (lastT && t - lastT < (coarse ? 30 : 15)) return;
        var dt = lastT ? Math.min(0.1, (t - lastT) / 1000) : 0.016;
        lastT = t;
        if (!cw) resize(true);
        stepCamera(dt);
        tickBreaks(Date.now());
        var sec = t / 1000;
        Object.keys(actors).forEach(function (id) { if (actors[id]) step(actors[id], dt, sec); });
        if (city) city.tick(dt);
        Object.keys(W.rooms).forEach(function (n) {
          var R = W.rooms[n];
          R.lamp.visible = !R.blink || Math.floor(sec * 2.4) % 2 === 0;
          R.front.visible = focus !== n;
          R.plate.off = focus === n;
        });
        // 침대에 누가 누워 자면 볼록한 이불을 덮고, 아니면 개어 둔 이불
        W.breaks.forEach(function (b) {
          if (!b.cover) return;
          var sa = b.by && actors[b.by];
          var on = !!sa && !sa.moving && sa.pose === 'sleep' && Math.abs(sa.pos.x - b.x) + Math.abs(sa.pos.z - b.z) < 0.3;
          if (b.cover.draped.visible !== on) { b.cover.draped.visible = on; b.cover.folded.visible = !on; }
        });
        var dirX = Math.sin(view.az), dirZ = Math.cos(view.az);
        W.cut.forEach(function (c) { c.obj.visible = dirX * c.nx + dirZ * c.nz <= 0.25; });
        fitPlates();
        renderer.render(scene, camera);
        layoutOverlays();
      }

      function show(on) {
        if (on) {
          resize(true);
          if (!raf) { lastT = 0; raf = requestAnimationFrame(frame); }
        } else if (raf) {
          cancelAnimationFrame(raf);
          raf = 0;
        }
      }

      return { update: update, show: show };
    }

    return { mount: mount };
  }
})();
