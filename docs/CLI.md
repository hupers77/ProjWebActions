# webloop CLI 레퍼런스

모든 명령은 `webloop <명령>` 형식입니다. 전역 설치 전이라면 `node dist/cli/index.js <명령>` 또는 `npm run dev -- <명령>`으로 실행합니다.
기계가 읽을 수 있는 같은 내용은 `webloop help --json`으로 얻을 수 있습니다.

## 전역 옵션

| 옵션 | 설명 |
|---|---|
| `--json` | 결과를 JSON 한 개로 stdout에 출력. 진행 로그는 stderr |
| `--browser <이름>` | `edge` \| `chrome` \| `whale` \| `chromium` \| `custom` |
| `--browser-path <경로>` | 브라우저 실행 파일 직접 지정 |
| `--headless` / `--headed` | 창 숨김 / 표시 (기본은 프로파일 설정) |
| `--quiet` | 진행 로그 숨김 |

**브라우저 결정 순서**: `--browser` > 환경변수 `WEBLOOP_BROWSER` > 프로파일 `browser.type` > `webloop.local.yaml` > `webloop.config.yaml` (기본 `chrome`)

**실행 파일 경로 결정 순서**: `--browser-path` > 프로파일 `browser.executablePath` > 환경변수(`WEBLOOP_EDGE_PATH`, `WEBLOOP_CHROME_PATH`, `WEBLOOP_WHALE_PATH`, `WEBLOOP_CHROMIUM_PATH`) > 설정 `browsers.<이름>.executablePath` > OS 기본 설치 경로 자동 탐지

## 명령

### `webloop init`
현재 폴더에 `webloop.config.yaml`(공용), `webloop.local.yaml`(이 PC 전용, macOS면 whale / Windows면 edge), `profiles/`, `goals/`를 만들고 `.gitignore`에 `.webloop/`, `webloop.local.yaml`을 추가합니다.

### `webloop doctor`
Node 버전, 브라우저 설치, 설정 파일, `claude` CLI, (Windows) 콘솔 코드페이지를 점검합니다. 문제가 있으면 exit 1.

### `webloop browsers [--cdp-help]`
Edge/Chrome/Whale/Chromium 탐지 결과. `▶`가 현재 선택된 브라우저입니다.

### `webloop login <profile>`
화면이 보이는 브라우저로 사이트를 열어 사람이 직접 로그인·보안 확인을 합니다. 창을 닫거나 터미널에서 Enter를 누르면 끝납니다. 세션은 `.webloop/browser/<profile>/<browser>/`에 저장되며 **브라우저마다 따로** 로그인해야 합니다.

### `webloop profile list | validate <p> | test <p> [--send <글>] [--keep-open]`
- `validate`: YAML 스키마 검사 (브라우저 없이)
- `test`: 실제 페이지에서 각 셀렉터가 몇 개 찾아지는지 표시. `--send`를 주면 1회 전송까지 시험

### `webloop send -p <profile> (--prompt <글> | --prompt-file <경로|->)`
단계 모드. 1회 입력 → 응답 완료 대기 → 수집. 평가·재시도는 호출한 쪽이 판단합니다.

| 옵션 | 설명 |
|---|---|
| `--timeout <ms>` | 응답 대기 제한 (프로파일 `wait.timeoutMs` 덮어쓰기) |
| `--out <파일>` | 응답 본문 저장 (UTF-8) |
| `--session continue\|new` | 대화 이어가기 / 새 대화 |
| `--detach` | 백그라운드 실행, runId 즉시 반환 |
| `--ui` | 웹 UI 서버가 없으면 함께 띄움 |

### `webloop run -p <profile> [-g <goal>] [--prompt <글>]`
자율 모드. 목표 파일(`goals/*.yaml`)의 `criteria`를 만족할 때까지 입력 → 대기 → 수집 → 평가 → 재작성을 반복합니다.
옵션: `--prompt-file`, `--max-iter <n>`, `--timeout <ms>`, `--out <파일>`, `--detach`, `--ui`

### `webloop eval <runId> -g <goal> [--iteration n]`
저장된 응답을 브라우저 없이 다시 평가합니다.

### `webloop list [--limit n]` / `status <runId>` / `logs <runId> [-f]` / `result <runId> [--iteration n|best] [--out 파일]` / `stop <runId>`
runId 자리에는 전체 id, 끝/앞 일부, 또는 `last`를 쓸 수 있습니다. `stop`은 실행 폴더에 `stop.flag`를 만들고, 실행은 다음 안전 지점에서 멈춥니다(exit 130).

### `webloop ui [--port 4777]`
`http://127.0.0.1:4777`에서 실행 목록·회차별 프롬프트/응답/평가/스크린샷을 실시간으로 봅니다. 127.0.0.1에만 열립니다.

## 종료 코드

| 코드 | 의미 | 다음 행동 |
|---|---|---|
| 0 | 성공 | 결과 사용 |
| 1 | 일반 오류 (설정, 예외) | 메시지 확인 |
| 2 | 최대 횟수 내 목표 미달성 | `reasons` 보고 목표/프롬프트 조정 |
| 3 | 사람 개입 필요 (로그인, 보안 확인) | 사용자에게 `webloop login <profile>` 요청 후 중단 |
| 4 | 대기 시간 초과 | `--timeout` 늘리기, `responseText`에 부분 결과 있음 |
| 5 | 셀렉터 못 찾음 | `webloop profile test`로 점검, 프로파일 수정 |
| 6 | 브라우저 실행 파일 없음 | `webloop browsers`, 경로 설정 |
| 7 | 브라우저 프로필 사용 중 | 같은 프로파일 실행이 끝나길 기다리거나 `stop` |
| 130 | 사용자 중지 | — |

## `--json` 출력 (`send`, `run`)

```json
{
  "runId": "20261108-160812-a1b2",
  "kind": "run",
  "status": "succeeded",
  "exitCode": 0,
  "iterations": 3,
  "best": { "iteration": 3, "score": 1 },
  "prompt": "실제로 보낸 프롬프트",
  "responseText": "응답 본문 (markdown)",
  "responseFile": ".webloop/runs/<runId>/iterations/03/response.md",
  "files": [],
  "extra": { "sources": ["제목 <https://...>"] },
  "reasons": [],
  "runDir": ".webloop/runs/<runId>",
  "outputFile": "out/result.md",
  "uiUrl": "http://127.0.0.1:4777/runs/<runId>"
}
```

오류 시: `{ "ok": false, "error": { "kind", "message", "hint" }, "exitCode": n }`

## 예시

bash (macOS):
```bash
webloop --browser whale send -p perplexity --prompt "Playwright와 Puppeteer 차이를 표로 정리해줘" --out answer.md
webloop --json run -p perplexity -g perplexity-example
```

PowerShell (Windows):
```powershell
webloop --browser edge send -p perplexity --prompt-file .\question.txt --out .\answer.md
webloop --json run -p perplexity -g perplexity-example | Out-File -Encoding utf8 result.json
```

## 자주 나는 문제

- **한글이 깨져 보임 (Windows)**: 출력을 변수/파이프로 받을 때 생깁니다. `--out` 파일로 받거나 `[Console]::OutputEncoding = [Text.Encoding]::UTF8`을 먼저 실행하세요.
- **`프로필 폴더가 이미 사용 중`**: 같은 프로파일로 다른 실행이나 `login` 창이 열려 있습니다.
- **exit 3이 계속 남**: headed 모드로 `webloop login <profile>`을 열어 보안 확인을 직접 통과한 뒤 다시 실행하세요. 이 도구는 CAPTCHA를 우회하지 않습니다.
