# webloop

웹사이트 입력창에 글을 보내고, 응답이 끝날 때까지 기다린 뒤 결과를 받아오는 CLI입니다.
결과가 목표 조건을 못 채우면 프롬프트를 고쳐 다시 보내는 반복 실행도 할 수 있고, 진행 상황은 간단한 웹 UI로 볼 수 있습니다. 다른 AI(Claude Code 등)가 `--json`으로 호출해 쓰도록 설계했습니다.

- **브라우저 선택**: Microsoft Edge, Google Chrome, NAVER Whale, Chromium (설치된 브라우저를 그대로 사용, 별도 다운로드 없음)
- **OS**: Windows 10/11, macOS
- **첫 사이트 프로파일**: [Perplexity](https://www.perplexity.ai/) (`profiles/perplexity.yaml`)

## 설치

Node.js 20 이상이 필요합니다.

```bash
git clone https://github.com/hupers77/ProjWebActions.git
cd ProjWebActions
npm install
npm run build
npm link            # 'webloop' 명령 등록 (선택). 안 하면 node dist/cli/index.js 로 실행
```

## 처음 설정

```bash
webloop init        # (새 폴더에서 쓸 때) webloop.config.yaml + webloop.local.yaml 생성
webloop browsers    # 설치된 브라우저 확인 (▶ 표시가 선택된 브라우저)
webloop doctor      # 환경 점검
```

이 저장소의 `webloop.config.yaml` 기본 브라우저는 `edge`(Windows 실사용 PC)입니다. Mac에서 Whale로 테스트할 때는 저장소 폴더에 `webloop.local.yaml`(git 제외)을 만들어 덮어씁니다. 새 폴더에서 `init`을 하면 macOS는 `whale`, Windows는 `edge`로 만들어 줍니다.

```yaml
# webloop.local.yaml
browser: whale
# 설치 위치가 다르면:
# browsers:
#   whale:
#     executablePath: "/Applications/Whale.app/Contents/MacOS/Whale"
```

한 번만 다른 브라우저를 쓰려면 `--browser edge`처럼 지정하거나 환경변수 `WEBLOOP_BROWSER`를 씁니다.

## 사용 예 (Perplexity)

```bash
webloop profile test perplexity --send "안녕하세요"     # 셀렉터·전송 점검
webloop send -p perplexity --prompt "Playwright와 Puppeteer 차이를 표로 정리해줘" --out answer.md
webloop run  -p perplexity -g perplexity-example --ui   # 목표 달성까지 반복 + 웹 UI
webloop ui                                              # http://127.0.0.1:4777
```

로그인이 필요하거나 보안 확인 화면이 뜨면 종료 코드 3으로 멈춥니다. `webloop login perplexity`로 창을 열어 직접 처리한 뒤 다시 실행하세요. 로그인 세션은 브라우저별로 `.webloop/browser/perplexity/<브라우저>/`에 저장됩니다.

## 문서

- [docs/CLI.md](docs/CLI.md) — 전체 명령, 옵션, 종료 코드, JSON 출력
- [docs/PROFILES.md](docs/PROFILES.md) — 사이트 프로파일·목표 파일 작성법
- [AGENTS.md](AGENTS.md) — 다른 AI가 이 도구를 쓰는 법
- [docs/HANDOFF.md](docs/HANDOFF.md) — Windows PC에서 이어서 개발·검증하기 위한 인수인계
- [docs/TESTING.md](docs/TESTING.md) — 로컬 테스트 방법 (macOS+Whale, Windows+Edge)
- [docs/REVIEW.md](docs/REVIEW.md) — 계획서 검토 결과와 반영 내용
- [docs/PLAN.md](docs/PLAN.md) — 원본 개발 계획서

## 주의

- CAPTCHA·봇 차단을 우회하지 않습니다. 사람 확인이 뜨면 멈추고 알려 줍니다.
- 자동화하려는 사이트의 이용약관을 먼저 확인하세요. 요청 간격은 프로파일의 `cooldownMs`로 조절합니다.
- 비밀번호는 저장하지 않습니다. 로그인은 `webloop login`으로 사람이 직접 합니다.
- GitHub Actions(원격 빌드/테스트)는 사용하지 않습니다. 테스트는 로컬에서 `npm test`.
