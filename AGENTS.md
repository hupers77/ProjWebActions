# AGENTS.md — AI 에이전트용 webloop 사용법

webloop는 웹사이트(예: Perplexity)에 글을 보내고 응답을 받아오는 CLI다. 항상 `--json`을 붙여 호출하고, **stdout의 JSON 한 개**와 **종료 코드**로 판단한다. 진행 로그는 stderr로 나온다.

## 언제 무엇을 쓰나

- 한 번 묻고 답을 받으면 끝 → `webloop --json send -p <profile> --prompt-file <파일>`
- 답이 조건(키워드, 길이, JSON 형식 등)을 채울 때까지 자동 반복 → 목표 파일을 만들고 `webloop --json run -p <profile> -g <goal>`
- 답을 직접 판단하며 한 단계씩 진행 → `send`를 반복 호출 (`--session continue`면 같은 대화에 이어 묻기)

## 표준 순서

1. `webloop --json doctor` — 브라우저가 있는지 확인
2. `webloop --json profile list` — 쓸 수 있는 사이트 확인 (`perplexity` 등)
3. 프롬프트는 따옴표 문제를 피하려고 **UTF-8 파일로 저장 후 `--prompt-file`** 사용
4. `send` 또는 `run` 실행 → 종료 코드로 분기
5. 결과 본문은 JSON의 `responseText`, 출처 등은 `extra`

## 종료 코드별 행동

| 코드 | 행동 |
|---|---|
| 0 | `responseText` 사용 |
| 2 | 목표 미달. `reasons`를 보고 프롬프트나 목표를 고쳐 다시 시도할지 판단 |
| 3 | **멈추고 사용자에게 요청**: "`webloop login <profile>`로 브라우저에서 로그인/보안 확인을 해 주세요." 직접 우회 시도 금지 |
| 4 | 시간 초과. 부분 결과가 `responseText`에 있을 수 있음. `--timeout` 늘려 1회만 재시도 |
| 5 | 사이트 구조 변경 의심. `webloop --json profile test <profile>` 결과를 사용자에게 보고 |
| 6 | 브라우저 없음. `webloop --json browsers` 결과를 사용자에게 보고 |
| 7 | 같은 프로파일이 실행 중. 기다렸다가 재시도 |
| 1 | 오류 메시지(`error.message`, `error.hint`)를 사용자에게 보고 |

## 규칙

- 같은 사이트에 짧은 간격으로 대량 호출하지 않는다 (프로파일 `cooldownMs` 존중).
- 긴 작업은 `--detach`로 띄우고 `webloop --json status <runId>`로 확인, 필요하면 `webloop stop <runId>`.
- 브라우저는 사용자가 정한 기본값을 쓴다. 바꿔야 할 때만 `--browser edge|chrome|whale`.
- 전체 명령 스키마: `webloop help --json`. 상세 문서: `docs/CLI.md`, `docs/PROFILES.md`.

## 예시

```bash
printf '%s' "2026년 노벨 물리학상 수상자와 업적을 3줄로" > q.txt
webloop --json send -p perplexity --prompt-file q.txt
```
