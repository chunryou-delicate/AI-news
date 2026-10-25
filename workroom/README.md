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

- 1~16번은 Meshy로 만든 캐릭터예요. 1~6번은 동작을 직접 넣었고, 7~16번은 1·2번 동작을 옮겨 붙였어요.
- 17~24번은 빛식물 프로젝트 캐릭터예요. 서기·걷기·앉기·손 흔들기·졸기·잠자기는 빛식물 자기 동작이고, 나머지(타자 등)는 Meshy 동작을 옮겨 붙였어요.
- 화면에 나오는 캐릭터만 그때그때 불러와요. 그동안은 도형 사람으로 그려요.
- 다시 만들 때는 `tools/build-people.js`를 써요. 하는 일:
  - 텍스처를 1024 한 장에 다시 늘어놓아요. UV 조각마다 여백을 두어서, 멀리서 볼 때 옆 조각 색이 섞여 이음매가 선으로 보이지 않게 해요. 화면은 사람 텍스처를 밉맵 2단계보다 흐리게 보지 않아요(`TEX_MAX_LOD`).
  - UV 이음매에서 갈라진 법선을 이어 붙여요 (이음매마다 빛이 끊겨 줄처럼 보이지 않게).
  - 동작은 뼈마다 기본자세에서 돈 만큼을 월드 기준으로 옮겨 붙여요. 뼈대마다 기본자세(T자세·A자세, 뼈 축)가 달라도 같은 자세가 나와요. 15fps·16비트로 줄여요.
  - 걷기 동작의 발 속도(`walkV`)를 재 두어, 다리 길이가 달라도 발이 미끄러지지 않게 걷는 빠르기를 맞춰요.
  - 만든 파일은 `~/.claude/workroom/models/`에 두고, 바꾼 뒤에는 `office3d.js`의 `MODEL_VER`를 올려요 (브라우저 캐시).

## 다른 사람에게 공유하기

현황판(뷰어) 코드만 이 저장소에 있어요. 대화 기록·회의록·열쇠 같은 데이터는 `.gitignore`로 빠져 있어서, 받은 사람 컴퓨터에는 그 사람의 Claude Code 세션만 보여요.

받는 사람이 Claude Code에게 이렇게 부탁하면 돼요.

```
https://github.com/chunryou-delicate/AI-news 저장소의 workroom-dashboard 브랜치에 있는
workroom 폴더(업무방 현황판)를 내 컴퓨터에 설치해 줘.
git clone -b workroom-dashboard https://github.com/chunryou-delicate/AI-news.git 한 다음
node workroom/deploy.js 를 실행하고, ~/.claude/workroom/현황판.html 을 브라우저로 열어 줘.
```

- Node.js와 git이 있어야 해요.
- 방 목록은 처음에 그 사람 프로젝트 폴더 이름으로 자동으로 만들어져요. 이 저장소의 `rooms.json` 경로가 그 컴퓨터에 없으면 자동으로 그렇게 해요.
- 다른 컴퓨터 동기화, 폰·외부 링크는 따로 켜야 하는 기능이에요. 아래 절을 보세요.

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
- PC를 켤 때마다 자동으로 띄우려면 `node workroom/deploy.js --server` 를 한 번 실행하세요 (Windows 시작프로그램 / 리눅스 systemd).

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

모든 컴퓨터가 주고받기 (컴퓨터마다 자기 현황판): 각 컴퓨터가 자기 세션은 직접 보여 주고, 다른 컴퓨터 현황은 비공개 저장소에서 받아 "<컴퓨터 이름> 층"으로 붙여요.

```sh
node workroom/deploy.js --machine "회사 노트북" --sync <비공개 저장소 주소> --push --pull --server --local
```

- `--server`: 이 컴퓨터 현황판 서버(server.js)를 로그인할 때 자동으로 뜨게 등록하고 지금 다시 띄워요. Windows는 시작프로그램 폴더, 리눅스는 systemd 사용자 서비스(`workroom-server.service`)를 써요. 서버가 떠 있는 동안 1분마다 동기화하니까 리눅스에서도 `--schedule` 이 필요 없어요. 끄기: `--unserver`
- `--local`: 서버가 이 컴퓨터에서만 열려요. 회사 노트북처럼 같은 망의 다른 기기에서 보이면 안 될 때 써요. 빼면 같은 와이파이의 폰에서도 열려요.
- 여는 법: `node ~/.claude/workroom/server.js --open` (열쇠가 든 링크를 화면에 찍지 않고 브라우저로 바로 열어요. 한 번 열면 30일 동안 `http://localhost:8790` 으로 열려요.)
- 컴퓨터 이름(`--machine`)은 처음 정한 이름을 그대로 쓰세요. 바꾸면 같은 컴퓨터가 새 층으로 하나 더 생겨요. 이름을 빼면 `sync.json` 의 전 이름을 써요.

- **회의록 보관:** 동기화를 켠 컴퓨터는 자기 회의록(.md)을 비공개 저장소 main 브랜치의 `minutes/<컴퓨터>/<방>/<날짜>.md`로 커밋해요. 바뀐 게 있으면 10분마다(`sync.json`의 `archiveMinutes`), 회의가 끝나면 바로 올려요. 끄려면 `"archive": false`.
- 끄기: `~/.claude/workroom/sync.json` 지우기, 작업 스케줄러는 `node workroom/deploy.js --no-hooks --unschedule`
- 동기화 결과는 `~/.claude/workroom/sync-status.json`, 오류는 `error.log`에 남아요

## 세션에 지시 보내기

서버로 연 현황판에서 세션(확인할 일 항목이나 사람)을 누르면 창 아래에 **지시 보내기** 칸이 있어요. 적고 Enter 를 치면:

- **이 컴퓨터 세션:** Orca 명령줄(`orca terminal send`)로 그 세션 터미널에 바로 입력하고 Enter 를 쳐요. 셸에 명령으로 들어가지 않게, Orca 가 에이전트(Claude 등)가 돌고 있다고 알려 주는 터미널에만 넣어요. 채팅 탭 세션은 아직 안 돼요.
- **다른 컴퓨터 세션:** 비공개 동기화 저장소로 보내고, 그 컴퓨터가 동기화할 때(보통 1~2분) 자기 Orca 로 넣은 뒤 받음 표시를 돌려줘요. 두 시간 안에 못 받으면 넣지 않아요. 보내는 컴퓨터는 `push`, 받는 컴퓨터는 `pull` 이 켜져 있어야 해요.
- 창에 최근 보낸 것 세 개와 상태(들어감 · 전달 대기 · 못 넣음)가 보여요. 기록은 `send-log.json` 에만 남아요.
- 현황판 열쇠가 있는 사람은 지시도 보낼 수 있으니 링크를 남에게 주지 마세요. 끄려면 `server.json` 에 `"send": false`, 다른 컴퓨터 지시를 받지 않으려면 `sync.json` 에 `"acceptSend": false`.
- 명령줄로도 보낼 수 있어요: `node ~/.claude/workroom/send.js <세션ID> <지시>` (AI News 세션이 대신 전할 때)

## 파일

| 파일 | 하는 일 |
|---|---|
| `hook.js` | Claude Code 훅. 이벤트마다 세션 상태와 회의록을 기록하고 `state.js`, `speech.js`, `logs/*.js`를 다시 만들어요. `node hook.js --rebuild`로 수동 재생성 |
| `install-hooks.js` | `~/.claude/settings.json`에 훅을 넣거나(`--uninstall`이면 빼기) |
| `현황판.html` | 현황판 화면. `file://`로 열어도 되도록 데이터를 `<script>`로 1.5초마다 다시 읽어요 |
| `office3d.js` | 3D 사무실. 현황판이 넘겨 주는 장면(방·자리·사람·말)대로 사람을 움직여요 |
| `models/p*.js` | 3D 사람 모델 (Meshy 캐릭터, base64 GLB) |
| `tools/build-people.js` | Meshy·빛식물 GLB를 3D 화면용 `models/p*.js`로 줄이는 도구 (텍스처 다시 배치, 법선 이어 붙이기, 동작 옮겨 붙이기) |
| `rooms.json` | 회의실(프로젝트 폴더) 목록 |
| `server.js` | 같은 와이파이의 폰에서 보는 작은 웹 서버 (열쇠가 있어야 열림). 지시 보내기 요청도 받음 |
| `send.js` | 세션에 지시 넣기 (이 컴퓨터는 Orca 로 바로, 다른 컴퓨터는 동기화 저장소로) |
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
