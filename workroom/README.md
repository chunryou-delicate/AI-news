# 업무방 현황판

Claude Code 세션 여러 개를 사무실 그림 하나로 보는 현황판이에요. 프로젝트 폴더 하나가 회의실 하나이고, 세션 하나가 사람 한 명으로 앉아 있어요.

- **평면도:** 회의실이 줄마다 늘어서 있고 사이사이 복도가 있어요. 사람마다 표정과 작은 말풍선으로 지금 상태(일하는 중, 승인 대기, 답변 대기, 내 차례, 막힘)와 최근에 한 말을 보여 줘요.
- **회의실 안:** 회의실을 누르면 확대되면서 안으로 들어가요. 자리가 넓게 바뀌고, 말풍선에 최근에 한 말이 9줄까지 보여요(마우스를 올리면 전부). 말풍선을 누르면 그 사람이 최근에 한 말이 큰 카드로 나와요.
- **회의록:** 회의실 안 오른쪽에 회의록이 쌓여요. 지시, 말, 보고, 세션 간 메시지, 회의 진행을 시간순으로 보여 주고, "회의록 저장"으로 .md 파일을 받을 수 있어요.
- **오케스트레이션 회의:** 의장 세션이 회의 상태 파일을 남기면 화이트보드에 안건과 라운드가, 명패에 역할 이름이 나와요.
- **화면 배치:** 위쪽 단추로 "꽉 차게"(화면 폭을 끝까지 씀), "패널 ⇄"(오른쪽 패널을 왼쪽으로), "패널 숨김"을 고르고, 패널 가장자리를 끌어서 폭을 바꿔요.

## 3D 사무실 (2D/3D 단추)

`office3d.js`가 같은 기록으로 3D 사무실을 그려요. Three.js(r149)를 jsDelivr에서 불러오므로 인터넷이 필요해요. 링크 끝에 `?d=3d`를 붙이면 바로 3D로 열려요.

- **사람이 실제 상태대로 움직여요.**
  - 일하는 중: 자기 자리에서 타자를 쳐요. 방금 말했으면 손짓하며 말하고, 회의 의장은 화이트보드 앞에서 발표해요.
  - 승인·답변 대기: 대표실 책상 앞에 와서 줄을 서고 손을 흔들거나 들어요.
  - 막힘: 자리에서 일어나 머리를 짚어요.
  - 일 없이 10분 넘음: 15~30분에 한 번 가까운 탕비실로 다녀와요. 한꺼번에는 쉬는 사람의 4분의 1까지만 가요.
  - 30분 넘음: 수면실 침대에서 일이 생길 때까지 자요.
  - 새 세션·끝난 세션: 엘리베이터로 오가요. 워커(서브에이전트)는 로봇이고, 문으로 들어와 앉아요.
- **사무실:**
  - 회의실이 줄마다 늘어서고, 줄 끝마다 탕비실이 있어요.
  - 아래쪽에 대표실·휴게실·수면실이 있어요.
- **대표 (나):**
  - 대표실 책상에 앉아 있는 ★ 캐릭터예요.
  - 누르면 골라지고, 바닥을 누르면 그리로 걸어가요.
  - 어떤 캐릭터를 쓸지는 "조명" 판의 ◀ ▶로 골라요.
- **조명 판:**
  - 사무실 색 테마를 바꿔요(파스텔·우드·모던·밤).
  - 밝기와 빛 색(차갑게↔따뜻하게)을 조절해요.
- **움직이기:**
  - 끌면 이동, 오른쪽 버튼으로 끌면 회전, 휠로 확대해요. 폰은 한 손가락·두 손가락으로 해요.
  - 방을 누르면 그 회의실로 들어가 회의록을 봐요.

사람 모델은 `models/p<번호>.js`에 들어 있어요. GLB를 base64로 넣어 두어 `file://`에서도 읽혀요.

- 1~16번은 Meshy로 만든 캐릭터예요. 1~6번은 동작을 직접 넣었고, 7~16번은 같은 뼈대라 1·2번 동작을 빌려 붙였어요.
- 화면에 나오는 캐릭터만 그때그때 불러와요. 그동안은 도형 사람으로 그려요.
- 다시 만들 때는 `tools/build-people.js`를 써요.
  - 하는 일: 텍스처 여백 채우고 1024로 줄이기, 동작 15fps·16비트로 줄이기, 다른 캐릭터 동작 빌려 붙이기(엉덩이 높이 비율 맞춤).
  - 만든 파일은 `~/.claude/workroom/models/`에 두어요.
  - 이 PC에는 다른 프로젝트(빛식물) 캐릭터로 만든 17~24번도 있어요. 이 저장소에는 올리지 않아요.

## 설치

Node.js가 필요해요.

```sh
node workroom/deploy.js
```

`~/.claude/workroom/`에 코드를 복사하고, `~/.claude/settings.json`에 현황판 훅을 추가해요. 다른 훅(예: Orca 훅)은 그대로 둬요. 그다음 `~/.claude/workroom/현황판.html`을 브라우저로 열면 돼요.

- 방 목록은 `~/.claude/workroom/rooms.json`에서 바꿔요. 세션의 작업 폴더가 `paths` 아래에 있으면 그 방에 앉아요. 어느 방에도 안 맞으면 "기타" 라운지로 가요.
- 훅 빼기: `node ~/.claude/workroom/install-hooks.js --uninstall`

## 폰에서 보기 (같은 와이파이)

`node ~/.claude/workroom/server.js`를 띄우면 같은 와이파이의 폰에서 현황판을 볼 수 있어요. 처음 띄울 때 `server.json`에 열쇠(token)를 만들고, 폰에서 열 링크(`http://<PC 주소>:8790/?k=<열쇠>`)를 보여 줘요. `node server.js --link`로 링크를 다시 볼 수 있어요.

- 현황판 화면과 그 화면이 읽는 파일만 내보내고, 열쇠가 맞아야 열려요. 한 번 열면 30일 동안 기억해요.
- PC를 켤 때마다 자동으로 띄우려면 시작프로그램 폴더에 숨김 실행 스크립트를 두면 돼요.

## 밖에서 폰으로 보기 (Cloudflare 임시 터널)

`bin/cloudflared(.exe)`(Cloudflare 공식 배포본)를 두고 `node ~/.claude/workroom/tunnel.js`를 띄우면 server.js 화면을 https://…trycloudflare.com 바깥 주소로 이어 줘요. 열쇠가 있어야 열리는 건 같아요.

- 임시 터널이라 다시 띄울 때마다 주소가 바뀌어요. 새 주소가 나오면 `tunnel.json`에 적고, 동기화용 비공개 저장소 main 브랜치의 `LINK.md`에도 링크를 적어 둬요. 폰의 GitHub에서 그 파일을 열면 늘 지금 링크가 있어요.
- `node tunnel.js --link`로 지금 링크를 볼 수 있어요.
- 링크(열쇠 포함)를 아는 사람은 누구나 볼 수 있으니 남에게 보내지 마세요. 열쇠를 바꾸려면 `server.json`을 지우고 server.js 와 tunnel.js 를 다시 띄우세요.

## 다른 컴퓨터 세션도 같이 보기

다른 컴퓨터(예: 회사 노트북)의 세션을 이 현황판에 "<컴퓨터 이름> 층"으로 함께 보여 줄 수 있어요. 주고받는 길은 **비공개** git 저장소예요. 이 저장소는 공개라서 기록을 여기에 올리면 안 돼요.

- 보내는 컴퓨터는 자기 기록(세션 상태, 말, 회의록) 스냅숏을 저장소의 `m/<컴퓨터 키>` 브랜치에 최대 1분에 한 번 덮어써요. 커밋 1개만 유지해서 기록이 쌓이지 않아요.
- 받는 컴퓨터는 1분마다 다른 컴퓨터 브랜치를 받아 와요. 받은 기록은 `~/.claude/workroom/remote/`에 들어가요.
- 보내는 컴퓨터에서는 방 목록을 따로 정하지 않아도 돼요(`--auto-rooms`). 세션의 프로젝트 폴더(가장 바깥 git 저장소, 없으면 작업 폴더) 이름으로 방이 생겨요.
- 회사 컴퓨터에서 보낼 때는 업무 대화 내용이 개인 저장소로 나간다는 점을 회사 보안 규정과 함께 확인하세요.

보내는 쪽 (git, Node.js, 비공개 저장소에 접근할 GitHub 로그인이 필요해요):

```sh
git clone -b workroom-dashboard https://github.com/chunryou-delicate/ai-news.git
cd ai-news
node workroom/deploy.js --machine "회사 노트북" --sync <비공개 저장소 주소> --push --auto-rooms
```

받는 쪽 (Windows에서는 `--schedule`로 1분마다 받기를 작업 스케줄러에 등록해요):

```sh
node workroom/deploy.js --machine "집 컴퓨터" --sync <비공개 저장소 주소> --pull --schedule
```

- **회의록 보관:** 동기화를 켠 컴퓨터는 자기 회의록(.md)을 비공개 저장소 main 브랜치의 `minutes/<컴퓨터>/<방>/<날짜>.md`로 커밋해요. 바뀐 게 있으면 10분마다(`sync.json`의 `archiveMinutes`), 회의가 끝나면 바로 올려요. 끄려면 `"archive": false`.
- 끄기: `~/.claude/workroom/sync.json` 지우기, 작업 스케줄러는 `node workroom/deploy.js --no-hooks --unschedule`
- 동기화 결과는 `~/.claude/workroom/sync-status.json`, 오류는 `error.log`에 남아요

## 파일

| 파일 | 하는 일 |
|---|---|
| `hook.js` | Claude Code 훅. 이벤트마다 세션 상태와 회의록을 기록하고 `state.js`, `speech.js`, `logs/*.js`를 다시 만들어요. `node hook.js --rebuild`로 수동 재생성 |
| `install-hooks.js` | `~/.claude/settings.json`에 훅을 넣거나(`--uninstall`이면 빼기) |
| `현황판.html` | 현황판 화면. `file://`로 열어도 되도록 데이터를 `<script>`로 1.5초마다 다시 읽어요 |
| `office3d.js` | 3D 사무실. 현황판이 넘겨 주는 장면(방·자리·사람·말)대로 사람을 움직여요 |
| `models/p*.js` | 3D 사람 모델 (Meshy 캐릭터, base64 GLB) |
| `tools/build-people.js` | Meshy GLB를 3D 화면용 `models/p*.js`로 줄이는 도구 |
| `rooms.json` | 회의실(프로젝트 폴더) 목록 |
| `server.js` | 같은 와이파이의 폰에서 보는 작은 웹 서버 (열쇠가 있어야 열림) |
| `tunnel.js` | 밖에서 보기용 Cloudflare 임시 터널을 띄우고, 바뀐 링크를 비공개 저장소 LINK.md 에 적음 |
| `sync.js` | 다른 컴퓨터와 비공개 git 저장소로 기록 주고받기 (`sync.json` 설정) |
| `deploy.js` | 이 폴더의 코드를 `~/.claude/workroom`에 복사하고 훅 설치. 동기화 설정과 작업 스케줄러 등록도 해요 |

## 기록이 쌓이는 곳 (`~/.claude/workroom/`, 저장소에는 안 올라감)

- `sessions/<세션ID>.json`: 세션별 상태
- `minutes/<방>/<날짜>.jsonl`: 회의록 원본. 도구 사용 내역은 `<날짜>.tools.jsonl`에 따로 쌓이고, 원본은 30일 지나면 지워요
- `minutes/<방>/<날짜>.md`: 사람이 읽는 회의록. 자동으로 다시 써져요
- `meetings/<이름>.json`: 오케스트레이션 의장 세션이 남기는 회의 상태 파일

## 회의 상태 파일 형식

의장 세션이 `~/.claude/workroom/meetings/<이름>.json`에 단계마다 덮어써요.

```json
{
  "room": "New world",
  "agenda": "002 엔진과 언어",
  "round": "r1",
  "phase": "1라운드 입장문 작성 중",
  "waitingForUser": false,
  "waitingReason": "",
  "chair": { "sessionId": "…", "orcaAgentSessionId": "…" },
  "roles": [
    { "role": "world", "label": "세계관", "agent": "claude", "state": "working", "terminal": "structworker_…", "output": "docs/agenda/002/r1-world.md" }
  ],
  "updatedAt": 1792860000000
}
```

- `round`: r1, r2, synthesis, critic, wrapup, done 중 하나
- `roles[].state`: waiting, working, done, error 중 하나
- 역할은 `terminal`(Orca 워커 handle), `paneKey`, `tabId`, `sessionId` 중 하나로 실제 세션과 짝지어요
- 회의가 끝나면 `round`를 `done`으로 두거나 파일을 지워요
