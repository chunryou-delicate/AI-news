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
    var SPINE = 2.8;                 // 왼쪽 세로 복도 폭
    var ZONE_D = 3.4;                // 컴퓨터마다 층 안내 띠 (바닥에 층 이름을 크게 쓴다)
    var ZONE_COLORS = ['#3b7ddd', '#e0703c', '#2e9d6c', '#9a5bd5', '#d39b12', '#d6457a'];   // 층마다 띠·바닥 글씨·이름표 색
    var LANE_D = 1.6;                // 맨 앞 로비 길 (엘리베이터, 아래쪽 방 문 앞)
    var LOBBY_D = 8.6;               // 맨 앞 로비 전체 (길 + 대표실·휴게실·수면실)
    var PANTRY_W = 4.2;              // 줄마다 오른쪽 끝 탕비실 폭
    var BED_HIP = 0.62;              // 누웠을 때 엉덩이 뼈 높이 (침대 윗면 0.5)
    var SLEEP_AFTER = 30 * 60000;    // 이만큼 넘게 쉬면 수면실에서 잔다
    var WALL_H = 2.3, LOW_H = 1.0, WALL_T = 0.1;
    var SEAT_HIP = 0.63;             // 앉았을 때 엉덩이 뼈 높이 (의자 윗면 0.49)
    var SEAT_FWD = 0.12;             // 앉았을 때 엉덩이를 의자 가운데에서 탁자 쪽으로 당기는 거리 (손이 노트북에 닿게)
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
    var SKY = { day: '#bfe3f7', dusk: '#f2b48c', night: '#2c4170' };
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
      var look = { theme: 'pastel', light: 0.85, warmth: 0.55, ceo: 1 };
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
        '<button type="button" data-a="look" class="wide" title="사무실 색과 조명 바꾸기" aria-expanded="false">조명</button>';
      container.appendChild(tools);
      var lookPanel = document.createElement('div');
      lookPanel.className = 'o3-look';
      lookPanel.hidden = true;
      lookPanel.innerHTML = '<div class="o3-look-row"><span>사무실</span><div class="o3-themes">' +
        Object.keys(THEMES).map(function (k) { return '<button type="button" data-theme="' + k + '">' + THEMES[k].name + '</button>'; }).join('') + '</div></div>' +
        '<label class="o3-look-row"><span>밝기</span><input type="range" min="0.4" max="1.5" step="0.05" data-k="light"></label>' +
        '<label class="o3-look-row"><span>빛 색</span><input type="range" min="0" max="1" step="0.05" data-k="warmth"><em>차갑게 ↔ 따뜻하게</em></label>' +
        '<div class="o3-look-row"><span>대표</span><button type="button" class="o3-ceo-btn" data-ceo="-1" aria-label="이전 캐릭터">◀</button>' +
        '<b class="o3-ceo-name"></b><button type="button" class="o3-ceo-btn" data-ceo="1" aria-label="다음 캐릭터">▶</button></div>';
      container.appendChild(lookPanel);
      var backBtn = document.createElement('button');
      backBtn.type = 'button';
      backBtn.className = 'rv-back o3-back';
      backBtn.textContent = '← 전체 보기';
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
      var camera = new T.PerspectiveCamera(35, 1, 0.1, 800);
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
        var k = r.k, w = roomWidth(k), tlen = k * SEAT + 0.3, tx0 = x0 + 1.1;
        var R = {
          name: r.name, kind: r.kind, k: k, x0: x0, z0: z0, w: w, x1: x0 + w, z1: z0 + ROOM_D, row: row,
          xSide: x0 + w - 0.85, zBack: z0 + 0.72, zFar: z0 + 1.66, zTable: z0 + 2.55, zNear: z0 + 3.44, zFront: z0 + 4.5, zDoor: z0 + ROOM_D - 0.45,
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
          sky: basic(SKY[skyKind(s.hour)]), dark: lam('#3a414a'), white: lam('#ffffff'), cooler: lam('#e8f0f6'), water: lam('#8fd0f2'), led: basic('#ff8a4c'),
          seats: P.seats.map(function (c) { return lam(c); }),
          ceoFloor: lam(shade(P.lobby, 0.92)), napFloor: lam(shade(P.carpet, 0.62)), vending: lam(P.seats[0]), fridge: lam('#e9eef2'),
          glass: new T.MeshLambertMaterial({ color: P.glass, transparent: true, opacity: 0.22, depthWrite: false, side: T.DoubleSide })
        };
        trash.push(M.glass);
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
          grp.position.set(x, 0.77, z);
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

        // 방 배치: 컴퓨터마다 묶고, 한 줄에 cols 개씩. 다른 컴퓨터가 있으면 컴퓨터마다(이 컴퓨터도) 앞에 층 안내 띠를 둔다.
        var groups = [];
        s.rooms.forEach(function (r) {
          var last = groups[groups.length - 1];
          if (!last || last.machine !== r.machine) { last = { machine: r.machine, rooms: [] }; groups.push(last); }
          last.rooms.push(r);
        });
        var multi = groups.some(function (gr) { return gr.machine; });
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
        W = { rooms: rooms, rows: rows, zones: zones, lobby: lobby, width: maxX, depth: lobby.z1, laneZ: zL + 0.8, breaks: breaks, labels: labels, cut: [], trash: trash, M: M };

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
        // 층 안내 띠: 층 색으로 물든 바닥, 양쪽 색 줄, 바닥에 크게 쓴 층 이름 (이름표가 가려져도 층이 보이게)
        zones.forEach(function (zn) {
          var zc = (zn.z0 + zn.z1) / 2, edge = lam(zn.color);
          box(maxX, 0.012, ZONE_D - 0.3, lam(new T.Color(P.floor).lerp(new T.Color(zn.color), 0.18)), maxX / 2, 0.006, zc);
          box(maxX, 0.016, 0.12, edge, maxX / 2, 0.008, zn.z0 + 0.2);
          box(maxX, 0.016, 0.12, edge, maxX / 2, 0.008, zn.z1 - 0.2);
          // 글씨는 띠 뒤쪽에 쓴다 (앞쪽은 카메라에서 보면 바로 앞 방 뒷벽에 가린다)
          var paint = floorText(zn.name + ' 층', zn.color), span = maxX - SPINE - 1;
          var th = Math.min(ZONE_D - 1.4, span / paint.aspect), tw = th * paint.aspect;
          for (var tx = SPINE + 0.6; tx === SPINE + 0.6 || tx + tw <= maxX - 0.4; tx += tw + 9) {
            var tm = mesh(G.plane, paint.mat, tw, th, 1, tx + tw / 2, 0.02, zn.z0 + 0.35 + th / 2, keep);
            tm.rotation.x = -Math.PI / 2;
            tm.receiveShadow = true;
          }
          var el = document.createElement('div');
          el.className = 'o3-zone';
          el.style.setProperty('--zc', zn.color);
          layer.appendChild(el);
          labels.push({ el: el, x: 0, y: 0.05, z: zc, zone: zn.name, self: zn.self });
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
              box(R.tlen, 0.06, 1.1, M.table, R.tcx, 0.74, R.zTable);
              box(R.tlen - 0.1, 0.04, 1.0, M.tableEdge, R.tcx, 0.7, R.zTable);
              box(0.08, 0.68, 0.8, M.tableEdge, R.tx0 + 0.25, 0.34, R.zTable);
              box(0.08, 0.68, 0.8, M.tableEdge, R.tx0 + R.tlen - 0.25, 0.34, R.zTable);
            }
            R.seatX.forEach(function (x) {
              if (lounge) { armchair(x, R.zFar, 1); armchair(x, R.zNear, -1); }
              else {
                chair(x, R.zFar, 1, seatMat);
                chair(x, R.zNear, -1, seatMat);
                R.laptops.far.push(laptop(x, R.zTable - 0.28, 1));
                R.laptops.near.push(laptop(x, R.zTable + 0.28, -1));
              }
            });
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
            var el = document.createElement('button');
            el.type = 'button';
            el.className = 'o3-room';
            el.setAttribute('data-room', R.name);
            layer.appendChild(el);
            R.label = el;
            labels.push({ el: el, x: x0 + w / 2, y: WALL_H + 0.3, z: z1, ax: '-50%', ay: '-100%', room: R.name });
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
          [0, 1].forEach(function (k) {
            breaks.push({ key: 'pcup' + row.i + k, place: pplace, x: px0 + 0.9 + k * 0.9, ax: px0 + 0.9 + k * 0.9, z: pz0 + 1.25, yaw: Math.PI, pose: 'cup' });
            breaks.push({ key: 'psofa' + row.i + k, place: pplace, x: px1 - 0.6, ax: px1 - 1.2, z: pz0 + 3.6 + (k ? 0.5 : -0.5), yaw: -Math.PI / 2, pose: k ? 'doze' : 'sofa' });
          });
          var pl = document.createElement('div');
          pl.className = 'o3-room static';
          pl.textContent = '탕비실';
          layer.appendChild(pl);
          labels.push({ el: pl, x: (px0 + px1) / 2, y: WALL_H + 0.3, z: pz1, ax: '-50%', ay: '-100%', minPpm: 7 });
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
        plant(SPINE / 2, rz1 - 0.6, 1.2);
        plant(SPINE / 2, rz0 + 1.2, 0.9);

        var avail = maxX - SPINE, xA = SPINE, xB = xA + avail * 0.36, xC = xB + avail * 0.37, xD = maxX;
        // 벽(아래 벽돌, 위 유리)과 위쪽 문이 있는 방 하나. 카메라 쪽(아래) 벽은 유리만 둔다.
        function lowerRoom(x0, x1, name, floorMat) {
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
          layer.appendChild(el);
          labels.push({ el: el, x: (x0 + x1) / 2, y: WALL_H + 0.3, z: rz0, ax: '-50%', ay: '-100%' });
          Rm.place = function (az) { return { t: 'lobby', room: name, door: doorX, az: az }; };
          return Rm;
        }
        function shelf(x, z, w, rot) {   // 책장 (rot: 벽을 따라 z 방향이면 true)
          var sw = rot ? 0.4 : w, sd = rot ? w : 0.4;
          box(sw, 1.9, sd, M.tableEdge, x, 0.95, z);
          for (var sy = 0.35; sy < 1.8; sy += 0.42) {
            box(rot ? 0.42 : w - 0.08, 0.03, rot ? w - 0.08 : 0.42, M.table, x, sy, z);
            for (var bk = 0; bk < 5; bk++) {
              var off = -w / 2 + 0.2 + bk * (w - 0.3) / 5, mat = M.seats[(bk + Math.round(sy * 10)) % M.seats.length];
              box(rot ? 0.28 : 0.1, 0.3, rot ? 0.1 : 0.28, mat, rot ? x : x + off, sy + 0.17, rot ? z + off : z);
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
        var ceoR = lowerRoom(xA, xB, '대표실', M.ceoFloor);
        var dx = xA + (xB - xA) * 0.48, dz = rz0 + 2.9;
        box(3.2, 0.008, 2.6, M.rug, dx, 0.016, dz + 0.1);
        box(2.4, 0.07, 1.05, M.desk, dx, 0.76, dz);
        box(2.3, 0.7, 0.05, M.desk, dx, 0.37, dz + 0.48);
        box(0.06, 0.72, 1.0, M.desk, dx - 1.15, 0.36, dz);
        box(0.06, 0.72, 1.0, M.desk, dx + 1.15, 0.36, dz);
        box(0.7, 0.42, 0.04, M.dark, dx - 0.2, 1.08, dz - 0.25);
        box(0.06, 0.2, 0.06, M.dark, dx - 0.2, 0.88, dz - 0.25);
        box(0.05, 0.45, 0.05, M.metal, dx + 0.85, 0.99, dz - 0.2);
        box(0.22, 0.12, 0.22, M.led, dx + 0.85, 1.25, dz - 0.2);
        box(0.6, 0.1, 0.58, M.chair, dx, 0.47, dz - 0.85);
        box(0.64, 1.05, 0.12, M.chair, dx, 1.05, dz - 1.17);
        box(0.05, 0.4, 0.05, M.metal, dx, 0.22, dz - 0.85);
        box(0.56, 0.04, 0.08, M.metal, dx, 0.04, dz - 0.85);
        box(0.08, 0.04, 0.56, M.metal, dx, 0.04, dz - 0.85);
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
        W.desk = { x: dx, z: dz, room: ceoR };
        W.ceoSeat = { key: 'ceo-seat', place: ceoR.place(rz0 + 0.75), x: dx, ax: dx, z: dz - 0.85, yaw: 0, pose: 'sit' };

        // 휴게실: 커피 바, 마주 보는 소파 둘, 자판기, 동그란 탁자
        var loungeR = lowerRoom(xB, xC, '휴게실', M.lounge);
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

        // 수면실: 침대 여럿과 머리맡 스탠드. 오래 쉬는 세션이 와서 잔다.
        var napR = lowerRoom(xC, xD, '수면실', M.napFloor);
        W.lower = [ceoR, loungeR, napR];
        var nBeds = Math.max(1, Math.min(4, Math.floor((xD - xC - 1.6) / 1.5))), bedZ = rz1 - 1.9;
        for (var bi = 0; bi < nBeds; bi++) {
          var bxx = xC + 1.4 + bi * 1.5;
          box(1.0, 0.36, 2.05, M.tableEdge, bxx, 0.18, bedZ);
          box(0.92, 0.14, 1.95, M.white, bxx, 0.43, bedZ);
          box(0.62, 0.1, 0.34, M.white, bxx, 0.55, bedZ - 0.75);
          box(0.96, 0.08, 1.2, M.seats[bi % M.seats.length], bxx, 0.52, bedZ + 0.35);
          box(1.0, 0.7, 0.08, M.tableEdge, bxx, 0.35, bedZ - 1.02);
          if (bi < nBeds - 1) {
            box(0.36, 0.5, 0.36, M.tableEdge, bxx + 0.75, 0.25, bedZ - 0.75);
            box(0.18, 0.18, 0.18, M.led, bxx + 0.75, 0.6, bedZ - 0.75);
          }
          breaks.push({ key: 'bed' + bi, place: napR.place(bedZ - 1.5), x: bxx, ax: bxx, z: bedZ, yaw: 0, pose: 'sleep', sleep: true });
        }
        plant(xD - 0.5, rz0 + 0.6, 1.0);

        // 바깥벽: 뒤·왼쪽은 창문 있는 높은 벽(카메라가 그 바깥쪽으로 돌면 감춘다), 오른쪽·앞은 낮은 턱
        var backWall = new T.Group(), leftWall = new T.Group();
        box(maxX + 0.24, 2.9, 0.12, M.wall, maxX / 2, 1.45, -0.12, backWall);
        for (var wx = 1.4; wx < maxX - 0.9; wx += 2.4) box(1.7, 1.1, 0.02, M.sky, wx, 1.75, -0.055, backWall);
        box(0.12, 2.9, lobby.z1 + 0.24, M.wall, -0.12, 1.45, lobby.z1 / 2, leftWall);
        for (var wz = 1.4; wz < lobby.z1 - 0.9; wz += 2.4) if (Math.abs(wz - ez) > 1.4) box(0.02, 1.1, 1.7, M.sky, -0.055, 1.75, wz, leftWall);
        box(0.12, 0.35, lobby.z1, M.wall, maxX + 0.06, 0.175, lobby.z1 / 2);
        box(maxX, 0.35, 0.12, M.wall, maxX / 2, 0.175, lobby.z1 + 0.06);
        W.cut.push({ obj: backWall, nx: 0, nz: -1 }, { obj: leftWall, nx: -1, nz: 0 });
        scene.add(backWall, leftWall);

        W.merged = mergeStatic(root);
        W.merged.traverse(function (o) { if (o.isMesh) trash.push(o.geometry); });
        W.keep = keep;
        W.dyn = dyn;
        scene.add(W.merged, keep, dyn);
        maxDist = 0;
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
        W = null;
      }

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
        var label = r.status.label + (r.overflow ? ' +' + r.overflow : '');
        var lk = [r.no, r.label, label, r.status.color, r.alert].join('|');
        if (R.labelKey !== lk) {
          R.labelKey = lk;
          R.label.innerHTML = (r.no ? '<em>' + esc(r.no) + '</em>' : '') + esc(r.label) + '<i style="background:' + esc(r.status.color) + '"></i><span>' + esc(label) + '</span>';
          R.label.classList.toggle('alert', !!r.alert);
          R.label.setAttribute('aria-label', r.label + ' 회의실 들어가기');
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

      function updateZones() {
        W.labels.forEach(function (lb) {
          if (!lb.zone) return;
          var m = (snap.machines || []).filter(function (x) { return x.name === lb.zone; })[0];
          var html = '<b>' + esc(lb.zone) + '</b> 층' + (lb.self ? '<span>이 컴퓨터</span>' : m ? '<span>' + esc(m.ago) + ' 전 동기화</span>' : '');
          if (lb.html !== html) { lb.el.innerHTML = html; lb.html = html; lb.w = 0; }
        });
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
        var sp = { t: 'spine' }, xs = SPINE / 2;
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
        else if (s) { tx = -s.x * P.tpl.scale; ty = P.tpl.seatHip - s.y * P.tpl.scale; tz = SEAT_FWD - s.z * P.tpl.scale; }
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
        var key = JSON.stringify([look.theme, skyKind(s.hour), colsFor(s.rooms.length), s.self || '', s.rooms.map(function (r) { return [r.name, r.k, r.kind, r.machine]; })]);
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
          var ico = { approval: '!', question: '?', error: '!', done: '✓', ceo: '★' }[st] || '';
          a.alertIco = st === 'approval' || st === 'question' || st === 'error' || st === 'ceo';   // 멀리서도 아이콘만은 보이게
          a.tag.style.setProperty('--sc', st === 'ceo' ? '#d4a017' : (snap.colors && snap.colors[st]) || '#8f969d');
          a.tag.innerHTML = (ico ? '<b class="ico">' + ico + '</b>' : '<i></i>') + '<span>' + esc(p.name) + '</span>';
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
        maxDist = f.dist * 1.6;
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
        }
        userMoved = act !== 'home';
      });
      // 조명 판: 테마를 바꾸면 사무실을 다시 짓고, 밝기·빛 색은 바로 바뀐다
      function syncLookPanel() {
        lookPanel.querySelectorAll('[data-theme]').forEach(function (b) { b.classList.toggle('on', b.getAttribute('data-theme') === look.theme); });
        lookPanel.querySelectorAll('input[data-k]').forEach(function (inp) { inp.value = look[inp.getAttribute('data-k')]; });
        lookPanel.querySelector('.o3-ceo-name').textContent = look.ceo + '. ' + (CHAR_NAMES[look.ceo] || '');
      }
      function saveLook() { try { localStorage.setItem(LOOK_KEY, JSON.stringify(look)); } catch (_) {} }
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
        if (focus && a.room === focus) host.speech(a.id); else host.room(a.room);
      });

      function pick(px, py) {
        if (!W) return;
        var best = null, bd = 1e9;
        Object.keys(actors).forEach(function (id) {
          var a = actors[id], sc = a.scr;
          if (!sc || a.alpha < 0.5) return;
          var hw = Math.max(10, sc.ppm * 0.3), hb = Math.max(24, sc.ppm * (SITTING[a.pose] ? 1.0 : 1.5));
          var dx = Math.abs(px - sc.x), dy = py - sc.y;
          if (dx > hw || dy < -6 || dy > hb) return;
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
          return { key: key, place: { t: 'corr', row: near }, x: SPINE / 2, ax: SPINE / 2, z: near.zc, yaw: 0, pose: 'stand' };
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
      function hit(p, q) { return p.x < q.x + q.w + 3 && q.x < p.x + p.w + 3 && p.y < q.y + q.h + 3 && q.y < p.y + p.h + 3; }

      function layoutOverlays() {
        var focal = ch / (2 * Math.tan(camera.fov * Math.PI / 360));
        var placed = [];   // 화면에 놓인 층 이름표·말풍선 (말풍선이 비켜 간다)
        W.labels.forEach(function (lb) {
          HV.set(lb.x, lb.y, lb.z);
          var ppm = focal / camera.position.distanceTo(HV), sp = screenOf(HV);
          var on = !!sp && sp.x > -240 && sp.x < cw + 240 && sp.y > -40 && sp.y < ch + 40 && (!lb.minPpm || ppm >= lb.minPpm) && lb.room !== focus;
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
          if (b && b.kind === 'say' && !a.worker && (!focus || a.room === focus) && b.t > latest) latest = b.t;
        });
        var items = [];
        list.forEach(function (a) {
          a.parts.head.getWorldPosition(HV);
          HV.y += a.parts.top;
          var ppm = focal / camera.position.distanceTo(HV), sp = screenOf(HV);
          a.scr = sp ? { x: sp.x, y: sp.y, ppm: ppm } : null;
          var on = !!sp && a.alpha > 0.3 && sp.x > -120 && sp.x < cw + 120 && sp.y > -120 && sp.y < ch + 240;
          var inFocus = !!focus && a.room === focus;
          var full = on && (inFocus || ppm > 34), icon = on && !full && a.alertIco;
          vis(a.tag, full || icon);
          var top = sp ? sp.y - 4 : 0;
          if (full || icon) {
            var mode = icon ? 'icon' : 'full';
            if (a.tagMode !== mode) { a.tag.classList.toggle('icon-only', icon); a.tagMode = mode; }
            put(a.tag, sp.x, sp.y, '-50%', '-100%');
            top = sp.y - (icon ? 24 : 22);
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
          var cls = 'o3-bub ' + b.kind + (big ? ' big' : '') + (below ? ' below' : '') + (isLatest ? ' latest' : '');
          if (a.bubCls !== cls) { a.bub.className = cls; a.bubCls = cls; a.bubSize = null; }
          if (a.bubMw !== mw) { a.bub.style.setProperty('--mw', mw + 'px'); a.bubMw = mw; a.bubSize = null; }
          var y = top;
          if (below) {
            HV.set(a.pos.x - Math.sin(a.yaw) * 0.45, 0, a.pos.z - Math.cos(a.yaw) * 0.45);
            var fp = screenOf(HV);
            y = fp ? fp.y + 8 : top;
          }
          items.push({ a: a, x: sp.x, y: y, below: below, prio: (b.kind === 'alert' ? 4 : b.kind === 'say' ? (isLatest ? 3 : 2) : 1) + (b.t || 0) / 1e13 });
        });
        // 크기가 바뀐 말풍선만 다시 잰다 (한꺼번에 보이게 한 뒤 읽어서 레이아웃은 한 번만)
        items.forEach(function (it) { if (!it.a.bubSize) vis(it.a.bub, true); });
        items.forEach(function (it) { if (!it.a.bubSize) it.a.bubSize = { w: it.a.bub.offsetWidth, h: it.a.bub.offsetHeight }; });
        items.sort(function (p, q) { return q.prio - p.prio; });
        items.forEach(function (it) {
          // 겹치면 위(아래)로 비켜 보고(방 안은 두 번, 멀리서는 한 번), 그래도 겹치면 감춘다.
          var s = it.a.bubSize, r = { x: it.x - s.w / 2, y: it.below ? it.y : it.y - s.h, w: s.w, h: s.h };
          for (var n = 0; n < (focus ? 2 : 1); n++) {
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
        Object.keys(W.rooms).forEach(function (n) {
          var R = W.rooms[n];
          R.lamp.visible = !R.blink || Math.floor(sec * 2.4) % 2 === 0;
          R.front.visible = focus !== n;
        });
        var dirX = Math.sin(view.az), dirZ = Math.cos(view.az);
        W.cut.forEach(function (c) { c.obj.visible = dirX * c.nx + dirZ * c.nz <= 0.25; });
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
