# 프로파일·목표 파일 작성법

사이트마다 다른 부분은 `profiles/<이름>.yaml`, 매번 바뀌는 목표는 `goals/<이름>.yaml`에 둡니다. 새 사이트 추가에 코드 수정은 필요 없습니다.

모든 **셀렉터** 자리에는 문자열 하나 또는 후보 배열을 쓸 수 있습니다. 배열이면 앞에서부터 페이지에 존재하는 첫 번째를 씁니다. Playwright 셀렉터 문법(`text=`, `role=` 등)도 쓸 수 있습니다.

## 프로파일

```yaml
name: perplexity                 # 파일 이름과 같게
url: https://www.perplexity.ai/
browser:
  # type: whale                  # 보통 비워 두고 --browser / 설정 파일로 고름
  mode: persistent               # persistent(로그인 유지) | ephemeral(매번 새로) | cdp(이미 띄운 브라우저에 붙기)
  # userDataDir: ./.webloop/browser/perplexity   # 실제 폴더는 <이 경로>/<브라우저>
  # cdpUrl: http://127.0.0.1:9222
  headless: false
  locale: ko-KR
  args: []                       # 브라우저 추가 인자
session: new                     # new: 매 회차 새 대화 | continue: 같은 대화에 이어 묻기
newSession:                      # session: new 일 때 (둘 중 하나)
  goto: https://www.perplexity.ai/
  # click: "button[aria-label='New chat']"
ready:                           # 페이지가 준비됐다고 볼 요소 (선택)
  selector: "#ask-input"
  timeoutMs: 45000
input:
  selector: ["#ask-input", "textarea"]
  method: insert                 # fill(일반 입력창) | insert(contenteditable, 줄바꿈 안전) | type(키 입력 흉내)
  clear: true
submit:
  press: Enter                   # 또는 click: "button[type=submit]"
wait:
  all:                           # 모두 만족해야 완료
    - new_element: "div[id^='markdown-content-']"     # 제출 전보다 개수가 늘었는가
    - selector_hidden: "button[aria-label*='Stop']"    # 생성 중 버튼이 사라졌는가
    - text_stable: { selector: "div[id^='markdown-content-']", ms: 3000 }  # N ms 동안 변화 없음
    # - selector_visible: ".result"
    # - network_idle: { ms: 1000 }
    # - delay: 2000
  startTimeoutMs: 60000          # new_element가 이 시간 안에 안 생기면 exit 5
  timeoutMs: 300000              # 전체 대기 제한 → 초과 시 exit 4 (부분 결과 수집)
extract:
  text: "div[id^='markdown-content-']"
  format: markdown               # text | markdown | html
  pick: last                     # last | first | all
  extra:                         # 부가 수집 (JSON 출력의 extra)
    sources: "div[id^='markdown-content-'] a[href^='http']"
  # download:
  #   click: "a.download"
  #   saveAs: "result-{{iteration}}{{ext}}"
authCheck:                       # 하나라도 걸리면 exit 3 (사람 개입 필요)
  urlContains: "/login"
  titleContains: ["Just a moment"]
  selectorVisible: "iframe[src*='challenges.cloudflare.com']"
cooldownMs: 5000                 # 회차 사이 대기
```

### 셀렉터 찾는 법
1. 브라우저에서 사이트를 열고 F12(개발자 도구) → 요소 선택으로 입력창/답변 영역을 클릭
2. `id`, `aria-label`, `data-testid`처럼 잘 안 바뀌는 속성을 우선 사용 (자동 생성된 class 이름은 피함)
3. `webloop profile test <이름>`으로 개수 확인 → `--send "테스트"`로 실제 전송 확인

## 목표 파일

```yaml
prompt: "Windows 파일 복구 프로그램 리뷰 글 목차를 만들어줘"
# promptFile: ./prompt.txt      # 긴 프롬프트는 파일로 (목표 파일 기준 상대경로)
maxIterations: 5
deadlineMs: 1800000             # 전체 제한 시간
session: new                    # 프로파일 설정 덮어쓰기 (선택)
stopOnSameResponse: true        # 같은 응답 2회 연속이면 조기 종료
criteria:                       # 규칙형 먼저, 모두 통과해야 llm_judge 실행
  - contains: ["설치", "사용법", "장단점"]
  - not_contains: "죄송합니다"
  - regex: "^##"
    flags: m
  - min_length: 800
  - max_length: 5000
  - json_valid: { required: ["title"] }
  - file_exists: { ext: ".pdf", minBytes: 1000 }
  - command: "node check.js"    # 응답이 stdin으로, 경로가 WEBLOOP_RESPONSE_FILE로 전달. exit 0이면 통과
  - llm_judge: "목차가 6개 이상이고 각 항목에 한 줄 설명이 있는가"
refine:
  strategy: template            # fixed | template | llm | external
  template: |
    이전 답변에 다음 문제가 있었습니다: {{reasons}}
    원래 요청: {{goal_prompt}}
  # prompts: ["두 번째 시도 프롬프트", "세 번째 시도 프롬프트"]   # fixed
  # instruction: "더 구체적으로"   # llm
output:
  saveTo: ./out/result.md       # best 회차 응답 저장
```

템플릿 변수: `{{prompt}}`(직전 프롬프트), `{{goal_prompt}}`, `{{reasons}}`, `{{last_response}}`, `{{iteration}}`(다음 회차 번호)

`llm_judge`와 `refine: llm`은 `claude -p --output-format json`을 호출합니다(설정 `llm.command`, `llm.args`, `llm.maxCalls`로 변경 가능).
