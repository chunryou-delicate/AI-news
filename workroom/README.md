# 업무방 현황판

Claude Code 세션 여러 개를 사무실 그림 하나로 보는 현황판이에요. 프로젝트 폴더 하나가 회의실 하나이고, 세션 하나가 사람 한 명으로 앉아 있어요.

- **평면도:** 회의실이 줄마다 늘어서 있고 사이사이 복도가 있어요. 사람마다 표정과 작은 말풍선으로 지금 상태(일하는 중, 승인 대기, 답변 대기, 내 차례, 막힘)와 최근에 한 말을 보여 줘요.
- **회의실 안:** 회의실을 누르면 확대되면서 안으로 들어가요. 자리가 넓게 바뀌고, 말풍선에 최근에 한 말이 9줄까지 보여요(마우스를 올리면 전부). 말풍선을 누르면 그 사람이 최근에 한 말이 큰 카드로 나와요.
- **회의록:** 회의실 안 오른쪽에 회의록이 쌓여요. 지시, 말, 보고, 세션 간 메시지, 회의 진행을 시간순으로 보여 주고, "회의록 저장"으로 .md 파일을 받을 수 있어요.
- **오케스트레이션 회의:** 의장 세션이 회의 상태 파일을 남기면 화이트보드에 안건과 라운드가, 명패에 역할 이름이 나와요.

## 설치

Node.js가 필요해요.

```sh
node workroom/deploy.js
```

`~/.claude/workroom/`에 코드를 복사하고, `~/.claude/settings.json`에 현황판 훅을 추가해요. 다른 훅(예: Orca 훅)은 그대로 둬요. 그다음 `~/.claude/workroom/현황판.html`을 브라우저로 열면 돼요.

- 방 목록은 `~/.claude/workroom/rooms.json`에서 바꿔요. 세션의 작업 폴더가 `paths` 아래에 있으면 그 방에 앉아요. 어느 방에도 안 맞으면 "기타" 라운지로 가요.
- 훅 빼기: `node ~/.claude/workroom/install-hooks.js --uninstall`

## 파일

| 파일 | 하는 일 |
|---|---|
| `hook.js` | Claude Code 훅. 이벤트마다 세션 상태와 회의록을 기록하고 `state.js`, `speech.js`, `logs/*.js`를 다시 만들어요. `node hook.js --rebuild`로 수동 재생성 |
| `install-hooks.js` | `~/.claude/settings.json`에 훅을 넣거나(`--uninstall`이면 빼기) |
| `현황판.html` | 현황판 화면. `file://`로 열어도 되도록 데이터를 `<script>`로 1.5초마다 다시 읽어요 |
| `rooms.json` | 회의실(프로젝트 폴더) 목록 |
| `deploy.js` | 이 폴더의 코드를 `~/.claude/workroom`에 복사하고 훅 설치 |

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
