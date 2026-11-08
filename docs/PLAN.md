# 웹 자동화 반복 에이전트 CLI 개발 계획서

Nov 8, 2026 · @사랑나무아빠

## 1. 개요와 목표

프로젝트 가칭은 **webloop**입니다. CLI로 호출하면 브라우저를 띄워 지정한 웹사이트의 입력창에 글자를 보내고, 응답이 완성될 때까지 기다린 뒤 결과를 텍스트나 파일로 받아옵니다. 받아온 결과를 목표 조건과 비교해서, 조건을 못 채우면 프롬프트를 고쳐 다시 보내는 과정을 목표 달성이나 최대 횟수에 이를 때까지 반복합니다.

**완료 기준 (v1.0)**

- `webloop run` 한 줄로 "입력 → 대기 → 수집 → 평가 → 재시도" 루프가 끝까지 돈다.
- 사이트별 차이는 코드가 아니라 YAML 프로파일로 흡수한다. 새 사이트 추가에 코드 수정이 필요 없다.
- 사람이 브라우저에서 `http://localhost:4777`을 열면 실행 목록, 반복 회차별 프롬프트/응답/스크린샷/평가 결과를 실시간으로 볼 수 있다.
- 다른 AI(Claude Code 등)가 `docs/CLI.md`와 `--json` 출력만 보고 이 도구를 정확히 쓸 수 있다.
- Windows 10/11에서 PowerShell, VS Code 터미널 모두 동작한다.

## 2. 범위

**포함**

- Playwright 기반 브라우저 조작: 접속, 입력, 제출, 대기, 텍스트 추출, 파일 다운로드, 스크린샷
- 로그인 세션 유지: 전용 브라우저 프로필 또는 이미 실행 중인 Chrome에 CDP로 붙기
- 목표 평가기: 규칙 기반(포함/정규식/JSON 스키마/파일 존재) + 선택적 LLM 판정(`claude -p` 호출)
- 프롬프트 재작성 전략: 고정 후보 목록, 템플릿, LLM 재작성
- 두 가지 실행 모드: 자율 반복(`run`)과 외부 AI가 한 단계씩 조종하는 단계 모드(`send`)
- 로컬 웹 UI (조회 + 중지 버튼)
- 사람/AI용 CLI 설명서

**제외 (v1.0 이후 검토)**

- CAPTCHA 자동 해결, 봇 차단 우회 (하지 않음)
- 여러 사이트 동시 병렬 실행, 원격 서버 배포
- 웹 UI에서 새 실행을 만들고 설정하는 기능 (v1은 조회 위주)
- webloop 자체를 MCP 서버로 노출 (M8 이후 선택 과제)

## 3. 아키텍처

```
[사람 / 다른 AI]
      │  webloop run / send / status ... (--json)
      ▼
┌──────────────── CLI (commander) ────────────────┐
│                                                 │
│  Orchestrator (반복 루프, 상태 머신)              │
│    ├─ Driver ── PlaywrightDriver (기본)          │
│    │           └ CdpAttachDriver (기존 Chrome)   │
│    ├─ Waiter   (완료 감지 전략)                   │
│    ├─ Extractor(텍스트/HTML/다운로드 수집)        │
│    ├─ Evaluator(규칙 + LLM 판정)                  │
│    └─ Refiner  (다음 프롬프트 생성)               │
│                                                 │
│  RunStore  runs/<runId>/... + events.jsonl      │
└────────────────────┬────────────────────────────┘
                     │ 파일 감시 / SSE
                     ▼
           Web UI 서버 (localhost:4777)
```

**구성요소 역할**

- **Orchestrator**: 한 번의 실행(run)을 관리합니다. 상태는 `queued → running → evaluating → (retrying) → succeeded | failed | stopped`로 움직이고, 상태가 바뀔 때마다 이벤트를 기록합니다.
- **Driver**: 브라우저 조작을 추상화한 인터페이스입니다. `open / fill / submit / waitFor / extract / download / screenshot`만 노출해서, 나중에 Chrome DevTools MCP 같은 다른 백엔드로 바꿔 끼울 수 있게 합니다.
- **Waiter**: "응답이 다 나왔다"를 판단합니다. 채팅형 사이트는 글자가 스트리밍되므로 단순 셀렉터 대기로는 부족합니다(5장 참고).
- **Evaluator / Refiner**: 결과를 판정하고, 실패 시 다음 시도의 프롬프트를 만듭니다.
- **RunStore**: 모든 결과를 파일로 남깁니다. 웹 UI와 `status` 명령은 이 파일만 읽으므로 CLI 프로세스와 UI 서버가 분리됩니다.

**Playwright와 Chrome DevTools MCP의 관계**

Chrome DevTools MCP는 AI 에이전트가 브라우저를 조작하라고 만든 도구입니다. 이 프로그램처럼 코드가 루프를 직접 돌리는 경우에는 Playwright를 바로 쓰는 쪽이 빠르고 결정적입니다. 그래서 v1은 Playwright를 기본 드라이버로 두고, DevTools MCP의 장점(이미 로그인된 내 Chrome 재사용)은 CDP 접속 드라이버(`connectOverCDP`)로 흡수합니다. MCP 클라이언트 드라이버는 Driver 인터페이스 뒤에 선택 과제로 둡니다.

## 4. 기술 스택

| 영역 | 선택 | 이유 |
| --- | --- | --- |
| 언어/런타임 | Node.js 22 LTS + TypeScript | Playwright·MCP SDK가 1급 지원, Windows 설치 쉬움 |
| 브라우저 | Playwright (`playwright` 패키지, Chromium/Chrome 채널) | 자동 대기, 다운로드 이벤트, 영속 컨텍스트, CDP 접속 지원 |
| CLI | commander + zod(옵션 검증) | 서브커맨드 구조, 명확한 오류 메시지 |
| 설정 | YAML (`yaml`) + zod 스키마 | 사람과 AI 모두 읽고 쓰기 쉬움 |
| 로그 | pino (JSON 라인) | `events.jsonl`과 형식 통일 |
| 웹 UI 서버 | Fastify + SSE | 가볍고 빠름, 실시간 갱신은 SSE로 충분 |
| 웹 UI 화면 | 정적 HTML + 바닐라 JS (빌드 없음) | "간단한 UI" 요구에 맞춤, 나중에 React로 교체 가능 |
| LLM 판정/재작성 | `claude -p` CLI 호출 (선택) | 별도 API 키 관리 없이 기존 Claude 구독 활용 |
| 테스트 | Vitest + 로컬 목업 사이트(Fastify) | 실제 사이트 없이 루프 전체를 재현 |
| 패키징 | npm 전역 설치(`npm i -g`) / `npx webloop` | Windows PATH 등록 자동 |

대안: 회사 표준이 Python이라면 Playwright for Python + Typer + FastAPI 조합으로 같은 구조를 그대로 옮길 수 있습니다.

## 5. 핵심 반복 루프 설계

```
for i in 1..maxIterations:
  1. prompt_i 준비   (첨 회: 사용자 입력 / 이후: Refiner 결과)
  2. 입력          fill(inputSelector, prompt_i) → submit
  3. 대기          Waiter: 완료 조건 충족 or timeout
  4. 수집          Extractor: text / html / download / screenshot
  5. 평가          Evaluator(result, goal) → {passed, score, reasons}
  6. passed → succeeded 종료
     아니면 Refiner(prompt_i, result, reasons) → prompt_{i+1}
maxIterations 초과 → failed(goal_not_met), 가장 점수 높은 회차를 best로 표시
```

**완료 감지 전략 (Waiter)** — 프로파일에서 여러 개를 AND로 조합합니다.

| 전략 | 설명 | 맞는 사이트 |
| --- | --- | --- |
| `selector_visible` | 결과 요소가 나타나면 완료 | 검색·변환 결과 페이지 |
| `selector_hidden` | "생성 중" 스피너·중지 버튼이 사라지면 완료 | AI 채팅형 |
| `text_stable` | 결과 텍스트가 N ms 동안 변하지 않으면 완료 | 스트리밍 응답 |
| `network_idle` | 네트워크 요청이 멈추면 완료 | 일반 웹페이지 |
| `response_match` | 특정 URL 패턴의 응답이 오면 완료 (본문도 캡처 가능) | API로 결과를 받는 SPA |
| `download` | 다운로드 이벤트가 발생하면 완료 | 파일 생성형 |

모든 전략에는 `timeoutMs`가 있고, 타임아웃되면 현재까지 본 내용을 수집하고 회차를 `timeout`으로 기록합니다(재시도 여부는 설정).

**평가기 (Evaluator)** — 목표 파일의 `criteria`를 순서대로 검사합니다. 규칙형을 먼저 실행하고, 모두 통과한 경우에만 비싼 LLM 판정을 돌립니다.

- `contains` / `not_contains` / `regex`
- `min_length` / `max_length`
- `json_schema` (응답에서 JSON 블록을 뽑아 검증)
- `file_exists` (확장자, 최소 크기)
- `command` (외부 스크립트 실행, 종료 코드 0이면 통과 — 예: 생성된 코드를 컴파일)
- `llm_judge` (자연어 기준을 `claude -p`에 넘겨 `{passed, score, reasons}` JSON을 받음)

**재작성기 (Refiner)**

- `fixed`: 목표 파일에 적어둔 프롬프트 후보를 순서대로 사용
- `template`: `{{prompt}}`, `{{reasons}}`, `{{last_response}}` 변수를 넣은 후속 프롬프트 (예: "이전 답변에서 {{reasons}}가 빠졌습니다. 보완해 주세요.")
- `llm`: 실패 사유와 이전 응답을 `claude -p`에 주고 다음 프롬프트를 받음
- `external`: 루프를 멈추고 외부 AI에게 결정을 넘김 (단계 모드)

채팅형 사이트는 같은 대화에 후속 질문을 이어 갈지(`session: continue`), 매번 새 대화를 열지(`session: new`)를 프로파일에서 고릅니다.

**안전장치**: `maxIterations`(기본 5), 전체 `deadlineMs`, 회차 간 `cooldownMs`(기본 3초), 같은 응답이 2회 연속이면 조기 종료, `webloop stop`/UI 중지 버튼.

## 6. 사이트 프로파일과 목표 파일

사이트마다 다른 부분은 `profiles/<이름>.yaml`에, 매번 바뀌는 목표는 `goals/<이름>.yaml`에 둡니다.

**프로파일 예시** (`profiles/sample-chat.yaml`)

```yaml
name: sample-chat
url: https://example.com/chat
browser:
  mode: persistent          # persistent | cdp | ephemeral
  userDataDir: ./.webloop/browser/sample-chat
  # cdpUrl: http://127.0.0.1:9222   # mode: cdp 일 때
  headless: false
session: continue           # continue | new
newSession:                 # session: new 일 때 새 대화 열기
  click: "button[aria-label='New chat']"
input:
  selector: "textarea#prompt"
  method: fill              # fill | type(키 입력 흉내)
submit:
  press: Enter              # 또는 click: "button[type=submit]"
wait:
  all:
    - selector_hidden: "button[aria-label='Stop']"
    - text_stable: { selector: ".message:last-child", ms: 2000 }
  timeoutMs: 180000
extract:
  text: ".message:last-child"
  format: markdown          # text | markdown | html
  download:                 # 선택
    click: "a.download"
    saveAs: "result-{{iteration}}{{ext}}"
authCheck:                  # 로그인 풀림 감지 → exit 3
  urlContains: "/login"
```

**목표 파일 예시** (`goals/blog-outline.yaml`)

```yaml
prompt: "Windows 파일 복구 프로그램 리뷰 글 목차를 만들어줘"
maxIterations: 5
criteria:
  - contains: ["설치", "사용법", "장단점"]
  - min_length: 800
  - llm_judge: "목차가 6개 이상이고 각 항목에 한 줄 설명이 있는가"
refine:
  strategy: template
  template: |
    이전 답변에 다음 문제가 있었습니다: {{reasons}}
    이를 반영해서 다시 작성해 주세요.
output:
  saveTo: ./out/blog-outline.md
```

`webloop profile test <이름>`은 브라우저를 띄워 각 셀렉터가 실제 페이지에서 찾아지는지 검사하고, `webloop profile record <url>`은 Playwright codegen을 띄워 셀렉터를 찾는 것을 돕습니다.

## 7. CLI 명령어 설계

| 명령 | 역할 |
| --- | --- |
| `webloop init` | 현재 폴더에 `webloop.config.yaml`, `profiles/`, `goals/` 생성 |
| `webloop doctor` | Node/브라우저/권한/`claude` CLI/콘솔 UTF-8 점검 |
| `webloop login <profile>` | 화면이 보이는 브라우저를 열어 사람이 직접 로그인, 세션 저장 |
| `webloop profile list \| validate \| test \| record` | 프로파일 관리·검증 |
| `webloop send -p <profile> --prompt "..."` | **단계 모드**: 1회 입력→대기→수집만 하고 결과 반환. 평가·재시도는 호출한 쪽(사람/AI)이 판단 |
| `webloop run -p <profile> -g <goal.yaml>` | **자율 모드**: 목표 달성까지 반복 |
| `webloop eval <runId> -g <goal.yaml>` | 이미 받은 결과를 다시 평가 (브라우저 없이) |
| `webloop list` | 실행 목록 |
| `webloop status <runId>` | 상태·현재 회차·마지막 평가 |
| `webloop logs <runId> [--follow]` | 이벤트 스트림 출력 |
| `webloop result <runId> [--iteration N\|best]` | 최종/특정 회차 응답 본문·파일 경로 |
| `webloop stop <runId>` | 실행 중지 (다음 안전 지점에서) |
| `webloop ui [--port 4777]` | 진행 상황 웹 UI 서버 실행 |
| `webloop help --json` | 전체 명령/옵션 스키마를 JSON으로 출력 (AI용) |

**공통 옵션**: `--json`(사람용 출력 대신 마지막에 JSON 한 개만 stdout으로, 로그는 stderr), `--prompt-file <경로>`(긴 프롬프트·따옴표 문제 회피), `--headed/--headless`, `--max-iter`, `--timeout`, `--detach`(백그라운드 실행 후 runId만 반환), `--out <폴더>`.

**종료 코드** (AI가 분기하기 쉬우도록 고정)

| 코드 | 의미 |
| --- | --- |
| 0 | 성공 (run: 목표 달성 / send: 수집 완료) |
| 1 | 일반 오류 (설정, 예외) |
| 2 | 최대 횟수 내 목표 미달성 |
| 3 | 로그인 필요 / 사람 개입 필요(CAPTCHA 등) |
| 4 | 대기 시간 초과 |
| 5 | 셀렉터를 찾지 못함 (사이트 구조 변경 의심) |
| 130 | 사용자 중지 |

**`--json` 출력 예시** (`run`)

```json
{
  "runId": "20261108-160812-a1b2",
  "status": "succeeded",
  "iterations": 3,
  "best": { "iteration": 3, "score": 0.92 },
  "responseText": "...",
  "files": ["runs/20261108-160812-a1b2/iterations/03/downloads/result.md"],
  "reasons": [],
  "uiUrl": "http://localhost:4777/runs/20261108-160812-a1b2"
}
```

## 8. 진행 상태 웹 UI

`webloop ui`로 띄우는 로컬 전용 서버입니다(127.0.0.1에만 바인딩). `run` 실행 시 `--ui` 옵션을 주면 서버가 없을 때 자동으로 함께 띄웁니다.

**화면 2개**

- **실행 목록** (`/`): runId, 프로파일, 상태 배지, 현재/최대 회차, 시작 시각, 소요 시간. 실행 중인 항목은 자동 갱신.
- **실행 상세** (`/runs/:id`): 왼쪽은 회차별 타임라인(프롬프트 → 대기 → 응답 → 평가 ✓/✗와 사유), 오른쪽은 선택한 회차의 응답 본문, 스크린샷, 다운로드 파일 링크. 상단에 중지 버튼과 라이브 스크린샷(대기 중 3초마다 갱신).

**API**

- `GET /api/runs`, `GET /api/runs/:id`, `GET /api/runs/:id/iterations/:n`
- `GET /api/runs/:id/events` (SSE, `events.jsonl` tail)
- `GET /files/:runId/*` (스크린샷·다운로드 파일)
- `POST /api/runs/:id/stop` (실행 폴더에 `stop.flag` 생성 → Orchestrator가 다음 지점에서 감지)

UI가 파일만 읽기 때문에 UI를 꺼도 실행에는 영향이 없고, 다른 AI가 돌린 실행도 사람이 그대로 지켜볼 수 있습니다.

## 9. 데이터 저장 구조와 프로젝트 폴더 구조

**실행 결과** — DB 없이 파일로 시작합니다. 사람이 탐색기로 열어봐도 바로 알 수 있고, 다른 AI도 그대로 읽을 수 있기 때문입니다.

```
.webloop/
  browser/<profile>/          # 영속 브라우저 프로필(로그인 세션) — git 제외
  runs/<runId>/
    run.json                  # 메타: profile, goal, status, 시간, best
    events.jsonl              # 상태 변화 이벤트 (UI·logs가 tail)
    stop.flag                 # 존재하면 중지 요청
    iterations/01/
      prompt.txt
      response.md
      response.html
      eval.json               # {passed, score, reasons, criteria[]}
      screenshot.png
      downloads/...
```

**이벤트 형식** (한 줄에 하나)

```json
{"ts":"2026-11-08T07:08:12Z","type":"iteration.started","iteration":2}
{"ts":"...","type":"wait.progress","iteration":2,"chars":1532}
{"ts":"...","type":"eval.done","iteration":2,"passed":false,"reasons":["'장단점' 미포함"]}
```

**소스 폴더 구조**

```
webloop/
  src/
    cli/            # commander 명령 정의, 출력 포맷(사람/JSON)
    core/           # orchestrator, state machine, types
    drivers/        # playwright.ts, cdp.ts, (mcp.ts)
    wait/           # 완료 감지 전략들
    extract/        # text/markdown/html/download
    eval/           # 규칙 평가기 + llm_judge
    refine/         # fixed/template/llm/external
    store/          # RunStore, events
    config/         # zod 스키마, YAML 로더
    ui/             # fastify 서버 + public/(html, js, css)
  profiles/         # 예시 프로파일
  goals/            # 예시 목표
  test/
    mock-site/      # 테스트용 가짜 채팅·다운로드 사이트
    e2e/  unit/
  docs/
    CLI.md          # 전체 명령 설명서
    PROFILES.md     # 프로파일/목표 작성법
  AGENTS.md         # AI 에이전트용 요약 사용법
  CLAUDE.md         # 이 저장소를 개발하는 Claude Code용 규칙
  README.md
```

## 10. 개발 단계별 마일스톤

기간은 퇴근 후·주말에 바이브코딩으로 진행한다는 가정의 대략적인 작업일입니다. 각 단계는 "끝났다"를 확인할 수 있는 검증 항목을 갖습니다.

| 단계 | 내용 | 완료 확인 | 예상 |
| --- | --- | --- | --- |
| M0 준비 | 저장소, TS/ESLint/Vitest, CLAUDE.md, 목업 사이트 | `npm test` 통과, 목업 사이트 구동 | 1일 |
| M1 단일 송신 | PlaywrightDriver, 입력·제출·`selector_visible` 대기·텍스트 추출, `send` 명령 | 목업 사이트에 `send` → 응답 출력 | 2일 |
| M2 프로파일·대기 | YAML+zod, 나머지 대기 전략, 다운로드, 스크린샷, 영속 프로필, `login`, `profile test` | 스트리밍 목업 + 다운로드 목업 통과, 실제 사이트 1곳 수동 확인 | 3일 |
| M3 반복 루프 | Orchestrator, 규칙 평가기, fixed/template 재작성, `run`, 종료 코드, 안전장치 | 목업이 3번째 시도에서야 조건 만족 → exit 0, 끝내 미달 → exit 2 | 3일 |
| M4 저장·조회 | RunStore, events.jsonl, `list/status/logs/result/stop`, `--json`, `--detach` | 모든 명령의 JSON 출력이 스키마 테스트 통과 | 2일 |
| M5 웹 UI | Fastify, SSE, 목록/상세 화면, 중지 버튼 | 실행 중 UI에서 회차가 실시간으로 늘어나고 중지가 동작 | 3일 |
| M6 LLM 연동 | `llm_judge`, `refine: llm` (`claude -p --output-format json`) | 자연어 기준으로 판정·재작성되는 e2e | 2일 |
| M7 CDP·Windows | `mode: cdp` 기존 Chrome 접속, Windows 경로·인코딩·PowerShell 검증, `doctor` | Windows에서 전체 e2e 통과 | 2일 |
| M8 문서·마무리 | CLI.md, PROFILES.md, AGENTS.md, `help --json`, Claude Code 스킬, README | 새 Claude Code 세션이 문서만 보고 목업 사이트 과제를 해냄 | 2일 |

합계 약 20 작업일. M1이 끝나면 실제로 쓰려는 사이트에 바로 붙여 보고, 그 사이트의 특성(스트리밍 여부, 다운로드 방식)에 맞춰 M2 우선순위를 조정하는 것을 권합니다.

## 11. 리스크와 대응

| 리스크 | 영향 | 대응 |
| --- | --- | --- |
| 사이트 UI 변경으로 셀렉터 깨짐 | 실행 실패 | role/text 기반 셀렉터 우선, 후보 셀렉터 목록 허용, exit 5로 명확히 알림, `profile test`로 빠른 점검 |
| 스트리밍 응답의 완료 시점 오판 | 잘린 응답으로 평가 | `selector_hidden` + `text_stable` 조합을 기본 권장, 안정 대기 시간 조절 |
| CAPTCHA·봇 차단·로그아웃 | 루프 중단 | 우회하지 않음. `authCheck` 감지 시 exit 3 + UI에 "사람 개입 필요" 표시, headed 브라우저에서 직접 처리 후 `run --resume` |
| 서비스 약관의 자동화 금지 | 계정 제재 | 프로파일별 약관 확인을 README에 명시, `cooldownMs`로 요청 간격 유지, 공식 API가 있으면 그쪽 우선 |
| 무한 반복·비용 폭주 | 사용량 소진 | maxIterations·deadline 필수값, 동일 응답 조기 종료, llm\_judge 호출 횟수 제한 |
| 로그인 세션·개인정보 유출 | 보안 | `.webloop/browser`는 `.gitignore`, UI는 127.0.0.1 전용, 비밀번호는 프로파일에 저장하지 않고 직접 로그인만 지원 |
| 한 브라우저 프로필을 두 실행이 동시에 사용 | 프로필 잠금 오류 | 프로파일 단위 잠금 파일, 사용 중이면 대기 또는 즉시 오류 |
| Windows 환경 차이 (경로, 한글 인코딩, 따옴표) | 깨진 입력·출력 | `--prompt-file` 권장, 출력 UTF-8 고정, `path` 모듈만 사용, Windows CI(GitHub Actions) 포함 |

## 12. 다른 AI용 CLI 설명서 계획과 다음 할 일

설명서는 "사람이 읽는 문서"와 "AI가 읽는 문서"를 나눠서, 코드와 어긋나지 않게 만듭니다.

- **`docs/CLI.md`** (전체 레퍼런스): 명령마다 목적 → 문법 → 옵션 표(타입, 기본값, 필수 여부) → 예시(PowerShell과 bash 각각) → `--json` 출력 스키마 → 종료 코드 → 자주 나는 오류와 해결법. 옵션 표는 zod 스키마에서 자동 생성해 문서와 코드가 항상 일치하게 합니다(`npm run docs:cli`).
- **`AGENTS.md`** (AI용 요약, 1\~2페이지): 언제 `run`을 쓰고 언제 `send` 루프를 직접 돌릴지, 표준 작업 순서(`doctor` → `profile test` → `run --json` → 종료 코드별 다음 행동), "exit 3이면 사용자에게 로그인을 요청하고 멈춘다" 같은 행동 규칙.
- **`webloop help --json`**: 명령·옵션·출력 스키마를 기계가 읽을 수 있는 형태로. 문서가 없어도 AI가 스스로 알아낼 수 있게 합니다.
- **Claude Code 스킬** (`skills/webloop/SKILL.md`): "웹사이트에 보내고 결과가 만족할 때까지 반복" 요청이 오면 이 도구를 쓰도록 연결.
- **검증**: 문서만 주고 새 AI 세션에 목업 사이트 과제 3개를 시켜 성공하는지 확인(M8 완료 기준).

**다음 할 일**

- [ ] 대상 웹사이트 1곳 확정하고 로그인 필요 여부·응답 방식(스트리밍/다운로드) 정리
- [ ] 해당 사이트 약관에서 자동화 허용 여부 확인
- [ ] 프로젝트 이름 확정 (가칭 webloop)
- [ ] GitHub 저장소 생성 후 M0 시작: Claude Code에게 이 계획서를 넘기고 `CLAUDE.md` + 목업 사이트부터 만들기
