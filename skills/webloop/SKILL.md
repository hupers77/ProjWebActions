---
name: webloop
description: 웹사이트(Perplexity 등)에 질문을 보내고 답을 받아오거나, 답이 조건을 만족할 때까지 반복해야 할 때 webloop CLI를 사용한다.
---

# webloop 사용

1. `webloop --json profile list`로 대상 사이트 프로파일 확인.
2. 프롬프트를 UTF-8 파일로 저장하고 `webloop --json send -p <profile> --prompt-file <파일>` 실행.
3. 조건이 있으면 목표 YAML(`docs/PROFILES.md` 참고)을 만들어 `webloop --json run -p <profile> -g <goal.yaml>`.
4. 종료 코드 3이면 멈추고 사용자에게 `webloop login <profile>` 실행을 요청한다.
5. 그 외 종료 코드 처리는 `AGENTS.md` 표를 따른다.
