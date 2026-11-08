# CLAUDE.md — 이 저장소를 개발할 때의 규칙

- 언어/런타임: Node.js 20+ (ESM) + TypeScript. 브라우저 제어는 `playwright-core`만 사용(브라우저 다운로드 금지 — 설치된 Edge/Chrome/Whale 사용).
- **GitHub Actions 워크플로를 추가하지 않는다.** 빌드·테스트는 로컬에서만: `npm run build && npm test`.
- Windows와 macOS 모두에서 동작해야 한다: 경로는 `node:path`만, 셸 전용 문법 금지, 파일은 UTF-8로 읽고 쓰기(BOM 허용), 단축키는 OS별 분기.
- 사이트별 차이는 코드가 아니라 `profiles/*.yaml`로 흡수한다. 스키마는 `src/config/schema.ts`(zod).
- 명령/옵션/종료 코드를 바꾸면 `src/cli/commands-meta.ts`, `docs/CLI.md`, `AGENTS.md`를 함께 고친다.
- CAPTCHA·봇 탐지 우회 코드를 넣지 않는다. 사람 확인이 필요하면 exit 3.
- 테스트: `test/unit`(브라우저 없음), `test/e2e`(빌드된 CLI + `test/mock-site`). e2e 브라우저는 `WEBLOOP_TEST_BROWSER`로 지정.
- 구조: `src/cli` 명령 · `src/core` 오케스트레이터/오류/잠금 · `src/browsers` 브라우저 탐지 · `src/drivers` Playwright 실행 · `src/wait` 완료 감지 · `src/extract` 수집 · `src/eval` 평가 · `src/refine` 재작성 · `src/store` 실행 기록 · `src/ui` 웹 UI.
