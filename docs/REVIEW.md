# 계획서 검토 결과 (v0.1 착수 시점)

원본 계획서: [PLAN.md](PLAN.md) · 검토일: 2026-11-08

요구사항(사용자 지시)과 계획서를 비교해 부족하거나 바꿔야 할 부분을 정리하고, 이번 구현에서 어떻게 반영했는지 적었습니다.

## A. 요구사항과 어긋나는 부분

| # | 계획서 내용 | 문제 | 반영 |
|---|---|---|---|
| A1 | 브라우저는 "Chromium/Chrome 채널" | Edge·Chrome·Whale 선택 요구가 없음. Playwright에는 **Whale 채널이 없음** | 모든 브라우저를 `executablePath` 방식으로 통일. OS별 설치 경로 자동 탐지(`webloop browsers`), `--browser`, `WEBLOOP_BROWSER`, 설정 파일로 선택 |
| A2 | 대상 OS가 Windows 10/11 | macOS(테스트: Whale)도 필요 | macOS 경로 탐지, 단축키(⌘A/Ctrl+A) 분기, 경로는 `path` 모듈만 사용 |
| A3 | 리스크 대응에 "Windows CI(GitHub Actions) 포함" | GitHub Actions는 켜지 않기로 함 | `.github/workflows` 없음. 로컬 `npm test` + Mac/Whale e2e + Windows/Edge 수동 점검표([TESTING.md](TESTING.md)) |
| A4 | PC별 설정 개념 없음 | Mac은 Whale, Windows는 Edge로 같은 저장소를 씀 | `webloop.config.yaml`(공용, git) + `webloop.local.yaml`(PC 전용, git 제외)로 분리. `webloop init`이 OS에 맞춰 기본값 작성 |

## B. 빠져 있던 설계

| # | 빠진 점 | 반영 |
|---|---|---|
| B1 | `playwright` 패키지는 설치 시 Chromium을 수백 MB 내려받음. 이 도구는 설치된 브라우저만 씀 | `playwright-core` 사용 (브라우저 다운로드 없음) |
| B2 | 브라우저 종류가 다르면 프로필 데이터 형식이 달라 같은 `userDataDir`를 공유하면 깨짐 | 프로필 폴더를 `.webloop/browser/<프로파일>/<브라우저>/`로 분리 |
| B3 | 평소 쓰는 브라우저 프로필을 그대로 쓰면 브라우저가 켜져 있을 때 잠김 | 기본은 **전용 프로필 + `webloop login`**. 기존 세션이 꼭 필요하면 `mode: cdp` (`webloop browsers --cdp-help`) |
| B4 | 채팅을 이어 갈 때 "마지막 응답 요소"가 직전 답변이라 완료를 오판할 수 있음 | `new_element` 전략 추가(제출 전 개수보다 늘어야 함), `text_stable`은 제출 전 텍스트와 달라야 통과, `selector_hidden`은 생성 시작 전 4초 유예 |
| B5 | contenteditable 입력창(Perplexity 등)에서 `fill`/`type`이 잘 안 먹거나 줄바꿈이 Enter(전송)로 처리됨 | `input.method: insert` 추가 (한 번에 삽입, 줄바꿈 안전). `type`은 줄바꿈을 Shift+Enter로 입력 |
| B6 | 응답 본문 외 부가 정보(출처 링크 등) 수집 방법 없음 | `extract.extra: { 이름: 셀렉터 }` 추가 → JSON 출력 `extra` |
| B7 | 셀렉터 후보 목록은 리스크 표에만 있고 스키마에 없음 | 모든 셀렉터 자리에 문자열 또는 **후보 배열** 허용 |
| B8 | 종료 코드에 "브라우저 없음", "프로필 사용 중" 없음 | `6` 브라우저 실행 파일 없음, `7` 프로필 잠김 추가 |
| B9 | Windows에서 한글 출력이 파이프로 넘어갈 때 PowerShell 코드페이지 때문에 깨짐 | `--out <파일>`(UTF-8) 권장, `doctor`가 코드페이지 점검, `--prompt-file -`(stdin) 지원, 설정 파일 BOM 허용 |
| B10 | `--detach` 동작이 정의되지 않음 | runId를 먼저 만들고 같은 명령을 백그라운드 자식 프로세스로 실행, 즉시 runId 반환 |
| B11 | 웹 UI 보안: 127.0.0.1 바인딩만 언급 | 추가로 Origin 검사(다른 사이트에서 중지 요청 차단), 파일 경로 탈출 차단 |

## C. 계획과 다르게 구현한 것

| # | 계획 | 실제 | 이유 |
|---|---|---|---|
| C1 | 웹 UI 서버 Fastify | Node 내장 `http` | 기능이 단순(조회+SSE+중지)해 의존성 줄임. 필요하면 교체 쉬움 |
| C2 | `profile record` (Playwright codegen) | 미구현 → `profile test --send`로 대체 | codegen은 전체 `playwright` 패키지와 브라우저 다운로드가 필요 |
| C3 | 로그 pino | 이벤트는 `events.jsonl` 직접 기록, 콘솔은 표준 출력 | 의존성 축소, 형식 동일 |
| C4 | `json_schema` 평가 | `json_valid` (JSON 추출 + 필수 키) | 가벼운 버전부터. 전체 JSON Schema는 필요 시 추가 |

## D. 아직 확인이 필요한 것 (사용자 확인 / 실제 PC 검증)

1. **Perplexity 셀렉터 실측** — 개발 환경에서 perplexity.ai 접속이 막혀 있어, 프로파일의 셀렉터는 알려진 구조(`#ask-input`, `div[id^='markdown-content-']` 등)와 후보 목록으로 작성했습니다. Mac에서 `webloop profile test perplexity --send "안녕"`으로 확인이 필요합니다.
2. **로그인 여부** — 비로그인으로 쓸지, 계정 로그인(Pro 기능)할지. 로그인하면 `webloop login perplexity`를 브라우저별로 한 번씩 해야 합니다(Whale/Edge 프로필은 분리됨).
3. **약관** — Perplexity 이용약관의 자동화 관련 조항 확인. 반복 호출이 많다면 공식 Sonar API가 더 안전합니다.
4. **Whale 호환성** — Whale은 Chromium 기반이라 Playwright CDP로 동작해야 하지만, Whale 버전이 Playwright가 기대하는 Chromium보다 많이 낮으면 일부 기능이 실패할 수 있습니다. 실패하면 `mode: cdp`로 우회 가능합니다.
5. 미구현/미검증: `run --resume`, LLM 판정/재작성의 실제 `claude -p` 연동 검증, CDP 모드 실측, Windows 실기 테스트.
