# 현황판 업데이트 절차

다른 컴퓨터의 AI News 세션이 현황판을 최신으로 맞출 때 이 순서대로 한다. 현황판 직원 탭의 **⟳ 다른 컴퓨터 업데이트**가 보내는 지시도 이 파일을 가리킨다. 답변과 진행 메시지는 모두 한국어로 쓴다.

## 할 일

1. 이 저장소(AI News)에서 `workroom-dashboard` 브랜치를 `git pull` 한다. `git log -1 --oneline` 으로 받은 커밋을 확인한다.
2. 배포한다.
   - 현황판 서버를 이 컴퓨터에서 띄우면 `node workroom/deploy.js --server`. 이 컴퓨터에서만 열리게 해 둔 서버(회사 노트북처럼)도 똑같이 `--server` 다. `server.json` 의 `host` 설정은 그대로 남는다.
   - `--local` 은 처음 설치할 때 '이 컴퓨터에서만 열림'으로 정하는 옵션이라(`server.json` 을 다시 쓴다) 업데이트 때는 붙이지 않는다.
   - 서버를 쓰지 않으면 `node workroom/deploy.js`
3. 서버를 다시 켰다면 workroom `server.js` 를 돌리는 node 프로세스 번호가 바뀌었는지 확인한다. 안 바뀌었으면(옛 서버가 `/__quit` 을 몰라서) 그 프로세스만 끄고 시작프로그램의 `workroom-server.vbs` 로 다시 켠다.
4. `~/.claude/workroom` 의 `현황판.html`, `hook.js`, `server.js`, `send.js`, `sync.js`, `board.js`, `notify.js`, `statusline.js` 가 저장소 `workroom/` 의 같은 파일과 똑같은지 확인한다.
5. 열려 있는 현황판 탭(폰 포함)은 새로고침해야 바뀐다고 사용자에게 알려 준다.

## 사용자가 따로 말할 때만

- 5시간·7일 사용량 한도 기록: `node ~/.claude/workroom/install-hooks.js --statusline`
  - `~/.claude/settings.json` 의 `statusLine` 을 현황판 기록기(`statusline.js`)로 감싼다.
  - 원래 상태줄 명령(Orca 등)은 그대로 이어서 불린다.
  - 되돌리기: `--statusline-off`

## 하지 말 것

- 시험한다고 사람 고용(새 세션 띄우기), 세션 닫기, 다른 세션에 지시 보내기를 하지 마.
- `tunnel.js` 는 새로 켜거나 끄지 마.
- `~/.claude/settings.json` 의 다른 훅과 설정은 건드리지 마. 위의 `--statusline` 도 사용자가 말할 때만 한다.
- `sync.json`·`server.json`·`rooms.json` 의 값은 바꾸지 마.
- `notify.json` 은 만들지 마. 텔레그램 알림은 한 컴퓨터에서만 보낸다(여러 대가 보내면 같은 알림이 겹친다).
- 토큰, 비밀번호, 열쇠가 든 링크(`server.js --link`)는 화면에 찍거나 파일에 적지 마. 저장소 주소와 터미널 핸들도 찍지 마.
- `~/.claude/workroom` 의 기록·열쇠 파일은 커밋하지 마. 예: `sessions/`, `minutes/`, `logs/`, `minutes-js/`, `usage/`, `state.js`, `speech.js`, `activity.js`, `server.json`, `sync.json`, `tunnel.json`, `notify.json`, `tasks.json`, `outbox/`, `send-log.json`.
- 오류가 나면 마음대로 우회하지 말고, `~/.claude/workroom/error.log` 내용과 함께 알려 줘.

## 끝나면

한 줄로 알려 준다: 받은 커밋 번호, 배포 결과(서버를 다시 켰다면 프로세스 번호가 바뀌었는지), 오류가 있었는지.
