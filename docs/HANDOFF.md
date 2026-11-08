# 인수인계 문서 — Windows PC(Edge)에서 이어서 개발·검증하기

이 문서는 실제 사이트를 적용할 **Windows PC의 Claude**가 읽고 바로 이어서 작업하도록 쓴 것입니다.
작성일: 2026-11-08 · 앞선 개발과 Mac 테스트는 다른 환경에서 했습니다.

## 0. 먼저 알아둘 것 (사용자 지시)

- 사용자에게는 **한국어**로 답합니다.
- **GitHub Actions 워크플로를 추가하거나 켜지 않습니다.** 빌드·테스트는 로컬에서만 합니다.
- CLI는 **Windows와 macOS 모두**에서 동작해야 합니다. 경로는 `node:path`만 쓰고, 파일은 UTF-8로 읽고 씁니다.
- 테스트는 Mac에서 Whale로, 실제 사이트 적용은 **Windows PC에서 Edge로** 합니다. 첫 사이트는 https://www.perplexity.ai/ 입니다.
- CAPTCHA와 봇 차단은 우회하지 않습니다. 사람 확인이 필요하면 종료 코드 3으로 멈춥니다.
- 저장소 규칙은 `CLAUDE.md`, 사용 방법은 `README.md`, `docs/CLI.md`, `docs/PROFILES.md`에 있습니다. 원본 계획서는 `docs/PLAN.md`, 계획서 검토 결과는 `docs/REVIEW.md`입니다.

## 1. 현재 상태

webloop(Node.js + TypeScript, `playwright-core`)의 첫 버전이 main에 병합되어 있습니다(PR #1).

**구현됨**
- 브라우저 선택: Edge, Chrome, Whale, Chromium. 설치된 브라우저의 실행 파일을 Playwright로 직접 띄웁니다. Windows와 macOS 설치 경로를 자동으로 찾습니다.
- 명령: `init`, `doctor`, `browsers`, `login`, `profile list|validate|test`, `send`, `run`, `eval`, `list`, `status`, `logs`, `result`, `stop`, `ui`, `help --json`
- 반복 루프: 완료 감지(`new_element`, `selector_hidden`, `text_stable`, `network_idle` 등), 규칙형 평가, `fixed`/`template`/`llm` 재작성, 종료 코드 0/1/2/3/4/5/6/7/130
- 웹 UI(`webloop ui`, 127.0.0.1:4777): 실행 목록, 회차별 상세, 중지 버튼
- Perplexity 프로파일: `profiles/perplexity.yaml`

**검증된 것**
- 리눅스 Chromium + 로컬 목업 사이트: 단위 테스트 13개, e2e 9개 통과
- **Mac + Whale + 실제 Perplexity**: `webloop profile test perplexity --send "안녕하세요"`가 종료 코드 0으로 정상 동작했습니다. 응답 수집과 파일 저장까지 확인했습니다.

**아직 검증하지 않은 것**
- **Windows + Edge 전체**(이 문서의 3장 절차가 그 검증입니다)
- 로그인 상태에서 Perplexity 사용, 긴 답변(심층 검색), 여러 회차 반복(`run`)을 실제 사이트에 적용
- `llm_judge`와 `refine: llm`의 실제 `claude -p` 연동
- `mode: cdp`(이미 실행 중인 브라우저에 붙기)
- `webloop login`의 실제 사용

## 2. 실행 방법 (Windows PowerShell)

Node.js 20 이상(LTS 22 권장)이 필요합니다.

```powershell
git clone https://github.com/hupers77/ProjWebActions.git
cd ProjWebActions
npm install
npm run build
node dist\cli\index.js doctor
node dist\cli\index.js browsers
```

저장소 기본 브라우저는 `edge`(`webloop.config.yaml`)라서 Windows에서는 별도 설정이 필요 없습니다. 다른 브라우저를 쓰려면 `--browser chrome`처럼 지정하거나, 이 PC 전용 설정 파일 `webloop.local.yaml`(git 제외)에 `browser: chrome`을 적습니다. Edge가 기본 경로에 없으면 같은 파일에 적습니다.

```yaml
browsers:
  edge:
    executablePath: "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe"
```

`webloop` 명령으로 쓰려면 `npm link`를 하면 되고, 안 하면 `node dist\cli\index.js`로 실행합니다.

## 3. Windows + Edge 검증 절차

아래를 순서대로 하고 결과를 기록합니다. 실패하면 4장의 우선순위에 따라 고칩니다.

1. `npm run test:unit` 통과
2. `$env:WEBLOOP_TEST_BROWSER = "edge"; npm run test:e2e` 통과 (목업 사이트 대상, 창은 숨김)
3. `node dist\cli\index.js doctor`에서 Edge 경로가 잡히고 콘솔 코드페이지 안내가 나오는지 확인
4. `node dist\cli\index.js profile test perplexity`에서 입력창 셀렉터가 1개 이상 찾아지는지 확인
5. `node dist\cli\index.js profile test perplexity --send "안녕하세요"`가 종료 코드 0인지 확인
6. **한글 입출력**: 한글 프롬프트를 파일로 저장한 뒤 `send -p perplexity --prompt-file .\q.txt --out .\answer.md`를 실행하고, `answer.md`의 한글이 깨지지 않았는지 확인
7. `--json` 출력을 PowerShell에서 받아 한글이 깨지는지 확인 (5.3 참고)
8. 경로에 공백이나 한글이 있는 폴더에서도 실행해 본다
9. `webloop ui`를 띄우고 브라우저에서 http://127.0.0.1:4777 접속, 진행 표시와 중지 버튼이 동작하는지 확인
10. 같은 프로파일로 두 실행을 동시에 시도해 종료 코드 7(프로필 잠김)이 나는지 확인
11. 보안 확인 화면이 뜨는 경우: 종료 코드 3으로 멈추면 정상이며, `webloop login perplexity`로 직접 통과한 뒤 다시 실행

**주의**: Edge 창이 이미 열려 있는 일반 프로필과 webloop 전용 프로필은 분리되어 있습니다(`.webloop\browser\perplexity\edge\`). 전용 프로필에서는 처음에 로그인이 되어 있지 않습니다. 로그인이 필요하면 `login`으로 한 번 해 주세요. 비밀번호는 저장하지 않습니다.

## 4. 남은 작업과 우선순위

### P0 — 실사용 전에 반드시

1. **Windows + Edge 검증**(3장). 실패한 항목은 원인을 찾아 고칩니다. Windows에서 특히 의심할 곳은 다음입니다.
   - 브라우저 프로세스 종료 후 프로필 폴더 잠금이 풀리는 시점(`src/core/lock.ts`, `src/drivers/playwright.ts`)
   - `run.json` 저장(`src/store/runStore.ts`의 `save`)에서 다른 프로세스가 읽는 중일 때의 오류
   - `--detach` 자식 프로세스 실행(`src/cli/index.ts`의 `maybeDetach`)
   - `llm_judge`가 호출하는 `claude`가 `.cmd` 래퍼라서 `shell` 옵션이 필요한 부분(`src/core/llm.ts`)
2. **출처 칩 텍스트 제거**(5.1 참고). 본문에 `korean.go+1` 같은 글자가 붙는 문제를 프로파일에서 해결합니다.
3. **셀렉터 안정성 점검**. 로그인 상태와 비로그인 상태에서 `profile test`를 모두 해 보고, 사이트가 바뀌어도 버티도록 후보 셀렉터를 보강합니다.

### P1 — 실사용하면서

4. **여러 회차 반복(`run`)을 Perplexity에 실제로 적용**. `goals/perplexity-example.yaml`을 돌려 보고, `session: new`와 `continue` 두 가지에서 완료 감지가 정확한지 확인합니다. 긴 답변에서 `text_stable` 시간(현재 3초)과 `timeoutMs`를 조정합니다.
5. **`webloop login` 실사용 확인**과 로그인 풀림 감지(`authCheck`) 보강
6. **`claude -p` 연동 검증**: `llm_judge`와 `refine: llm`을 실제로 돌려 본다. `llm.args`가 설치된 Claude Code 버전과 맞는지 확인합니다.
7. **`run --resume`**(종료 코드 3 이후 이어서 실행). 계획서에는 있으나 미구현입니다.

### P2 — 여유가 있을 때

8. `mode: cdp` 실측(Edge를 `--remote-debugging-port=9222`로 띄워서 붙기). `webloop browsers --cdp-help`가 명령을 보여 줍니다.
9. 전체 JSON Schema 평가(`json_valid`는 필수 키만 검사)
10. `profile record`(codegen 대체), 다른 사이트 프로파일 추가
11. 새 AI 세션이 `AGENTS.md`와 `docs/CLI.md`만 보고 과제를 해내는지 검증(계획서 M8 기준)

## 5. 알려진 이슈

### 5.1 Perplexity 답변에 출처 칩 글자가 붙음 (확인됨, 미수정)
Mac 실측 결과 응답 끝에 `korean.go+1` 같은 글자가 붙었습니다. Perplexity가 답변 안에 넣는 출처 표시 칩이 텍스트로 이어 붙는 것입니다. 출처 링크 자체는 `extra.sources`에 따로 수집됩니다.
- 해결 방향: `src/extract/extract.ts`에서 본문을 뽑기 전에, 프로파일에 지정한 셀렉터의 요소를 제거하거나 빼는 옵션(예: `extract.exclude: [셀렉터...]`)을 추가하고, `profiles/perplexity.yaml`에 출처 칩 셀렉터를 넣습니다. 실제 DOM은 개발자 도구로 확인하세요.
- 이 변경은 프로파일 스키마(`src/config/schema.ts`)와 `docs/PROFILES.md`도 함께 고쳐야 합니다.

### 5.2 Perplexity 셀렉터는 사이트 개편에 약함
`#ask-input`, `div[id^='markdown-content-']`, 중지 버튼 `aria-label` 등은 현재 구조 기준입니다. 깨지면 종료 코드 5가 납니다. `profile test`로 점검하세요.

### 5.3 Windows 콘솔 한글
PowerShell에서 출력을 변수나 파이프로 받으면 코드페이지 때문에 한글이 깨질 수 있습니다. 권장 방법은 `--out <파일>`(UTF-8 저장)이나 `[Console]::OutputEncoding = [Text.Encoding]::UTF8`를 먼저 실행하는 것입니다. 실제로 깨지는지 3장 7번에서 확인하고, 깨진다면 `--json` 출력을 파일로 쓰는 `--json-out <파일>` 같은 옵션을 추가하는 것을 검토하세요.

### 5.4 브라우저별 프로필 분리
Edge, Whale, Chrome의 프로필 데이터는 서로 호환되지 않아 `.webloop/browser/<프로파일>/<브라우저>/`로 분리했습니다. 그래서 브라우저를 바꾸면 다시 로그인해야 합니다.

### 5.5 Whale 호환성
Whale은 Mac에서 정상 동작했습니다. Whale 버전이 Playwright가 기대하는 Chromium보다 많이 낮으면 일부 기능이 실패할 수 있습니다. 그 경우 `mode: cdp`로 우회할 수 있습니다.

### 5.6 이용약관
자동화 사용 전 Perplexity 이용약관을 확인해야 합니다. 많이 호출해야 한다면 공식 API(Sonar API)를 우선 검토하세요. 프로파일의 `cooldownMs`(기본 5초)를 줄이지 마세요.

## 6. 개발 규칙 요약

- 명령·옵션·종료 코드를 바꾸면 `src/cli/commands-meta.ts`, `docs/CLI.md`, `AGENTS.md`를 함께 고칩니다.
- 사이트별 차이는 코드가 아니라 `profiles/*.yaml`로 흡수합니다. 스키마는 `src/config/schema.ts`(zod)입니다.
- 새 기능에는 `test/unit` 또는 `test/e2e`(목업 사이트 `test/mock-site/server.ts`) 테스트를 추가합니다. e2e 브라우저는 `WEBLOOP_TEST_BROWSER`로 지정합니다.
- 작업은 브랜치에서 하고 PR로 올립니다. PR 설명은 기존 PR(#1)의 형식을 따릅니다.
- `.webloop/`와 `webloop.local.yaml`은 git에 올리지 않습니다. 로그인 세션이 들어 있으니 커밋하지 마세요.

## 7. 이 문서를 읽은 Claude가 처음 할 일

1. `README.md`와 이 문서를 읽고, 2장 순서로 설치·빌드합니다.
2. 3장 검증을 하고 결과(통과/실패)를 사용자에게 한국어로 보고합니다.
3. 4장 P0부터 진행합니다. 막히면 증상과 로그(`webloop logs last`)를 사용자에게 알려 주세요.
