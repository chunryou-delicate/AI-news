# 세션 이름 정리 절차 (사용자 지정 2026-11-18)

한 컴퓨터의 모든 Claude 세션 이름을 아래 규칙에 맞춘다. 그 컴퓨터의 AI News 세션이 맡는다. 답변과 진행 메시지는 모두 한국어로 쓴다.

## 규칙

- 세션 이름과 Orca 탭 제목은 `[방] 역할` 꼴로 짓는다. 예: `[NW] 시스템`, `[AI News] 메인`, `[shorts] 제작`
- 방은 현황판의 업무방 이름을 쓴다. 길면 줄인다(New world → `NW`, AI news → `AI News`). 한 컴퓨터 안에서는 같은 방을 늘 같은 꼬리표로 쓴다
- 역할은 짧게 쓴다. 역할을 모르면 그 세션의 첫 지시와 최근 대화를 읽고 짓는다
- 이름에 이미 `[Plan] 게임 기획` 같은 꼬리표가 있으면 역할 앞에 남긴다: `[방] Plan 게임 기획`
- 같은 방에 같은 역할이 둘이면 뒤에 `-1`, `-2` 를 붙인다
- 셸에 들어가는 이름이라 글자·숫자·빈칸과 `._()·[]-` 만 쓴다(쉼표는 `·` 로)

## 공통 안내에 적기

`~/.claude/CLAUDE.md` 끝에 아래 절을 덧붙인다. 이미 있으면 그대로 둔다. 다른 절은 건드리지 않는다.

```
## 세션 열기와 이름 (사용자 지정 2026-11-18)

- 세션은 늘 바이패스 모드로 연다. 다시 열 때도 예전 권한 방식(auto 등)을 따르지 않고 `--permission-mode bypassPermissions` 를 붙인다
- 다시 열 때는 대화를 이어서(`claude --resume <ID>`) 열고, 옛 프로세스와 옛 탭은 닫아 같은 세션이 둘로 돌지 않게 한다
- 세션 이름과 Orca 탭 제목은 `[방] 역할` 꼴로 짓는다. 예: `[NW] 시스템`, `[AI News] 메인`
- 방은 업무방 이름을 쓴다. New world 는 `NW`, AI news 는 `AI News` 로 줄인다. 역할은 짧게 쓴다
- 새 세션이나 역할 탭을 띄울 때는 `claude -n '[방] 역할' --permission-mode bypassPermissions` 처럼 이름을 붙이고, 탭 제목도 같은 이름으로 한다
```

## 세션마다 바꾸는 순서

1. **목록 만들기**
   - `orca terminal list --json` 으로 claude 탭과 탭 제목을 본다.
   - Claude 세션 기록 `<설정 폴더>/sessions/<pid>.json` 에서 `name`, `status`, `bridgeSessionId` 를 본다.
   - 설정 폴더는 `CLAUDE_CONFIG_DIR` 또는 `~/.claude` 다. Orca 로 띄운 세션은 `%APPDATA%\orca\claude-profiles\<프로필>\home` 이다.
   - 탭과 기록은 세션 ID로 짝짓는다. 하나로 못 고르면 그 세션은 건너뛴다.
2. **쉬는 세션만 건드린다**
   - `status` 가 `idle` 이고, `orca terminal read --screen` 으로 본 입력칸(`❯`)이 비어 있을 때만 바꾼다.
   - 일하는 중이거나, 승인 창이 떠 있거나, 사용자가 글을 쓰는 중이면 건너뛰고 나중에 다시 본다.
3. **이름 바꾸기**
   - `orca terminal send --terminal <핸들> --text "/rename <새 이름>" --enter` 를 보낸다.
   - 기록의 `name` 이 새 이름이 됐는지 확인한다.
4. **휴대폰 제목 바꾸기**
   - 휴대폰 Code 목록 제목은 `/rename` 으로 안 바뀐다. 원격 연결을 끊고 새 이름으로 다시 건다.
   - `/remote-control` 을 보내면 창이 뜬다. 위 화살표(`\x1b[A`)를 두 번 보내 `❯ Disconnect this session` 이 됐는지 화면으로 확인하고, Enter 를 보낸다.
   - 기록의 `bridgeSessionId` 가 비면 `/remote-control <새 이름>` 을 보낸다.
   - 창이 예상과 다르면 Esc(`\x1b`)로 닫고 그 세션은 멈춘다.
5. **탭 제목 바꾸기**: `orca terminal rename --terminal <핸들> --title "<새 이름>"`
6. **자기 세션은 맨 마지막에 바꾼다**
   - 자기 입력칸에는 답하는 동안 칠 수 없다. 같은 순서를 돌리는 스크립트를 분리해서(detached) 띄워 둔다.
   - 그 스크립트는 자기 세션이 `idle` 이 된 뒤(답을 마친 뒤) 돌게 한다. 결과는 스크래치패드의 기록 파일에 남긴다.
   - 자기 세션이 `~/.claude/workroom/keepalive.json` 에 들어 있으면 그 항목의 `name`·`remoteControl` 도 새 이름으로 고친다. 이 파일은 커밋하지 않는다.

## 주의

- Git Bash 는 `/` 로 시작하는 인자를 경로로 바꾼다. 예: `/rename` 이 `C:/Program Files/Git/rename` 으로 들어가 그 세션이 엉뚱한 일을 한다. PowerShell 이나 node 에서 보내고, node 에서는 `String.fromCharCode(47)` 로 `/` 를 만든다.
- 다른 세션에는 이름 바꾸기 명령(`/rename`, `/remote-control`)만 보낸다. 다른 지시는 보내지 않는다.
- 이름 때문에 세션을 닫거나 다시 열거나 새로 띄우지 않는다.
- 터미널 핸들, 토큰, 열쇠가 든 링크, 저장소 주소는 화면에 찍거나 파일에 적지 않는다.
- 오류가 나면 마음대로 우회하지 말고, `~/.claude/workroom/error.log` 내용과 함께 알린다.
- 휴대폰 목록에는 옛 이름의 꺼진 항목이 남는다. 지워도 대화는 그대로이고, 지우는 것은 사용자가 한다.

## 끝나면

한 번에 알려 준다:
- 바꾼 이름 목록(옛 이름 → 새 이름)
- 건너뛴 세션과 그 까닭
- 자기 세션 이름을 바꾸는 스크립트를 띄웠는지
