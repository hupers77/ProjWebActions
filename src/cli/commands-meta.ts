/** `webloop help --json`용 기계 판독 가능한 명령 스키마 (AI용). 명령을 바꾸면 여기도 함께 고친다. */
export const EXIT_CODES = {
  0: "성공 (run: 목표 달성 / send: 수집 완료)",
  1: "일반 오류 (설정, 예외)",
  2: "최대 횟수 내 목표 미달성",
  3: "로그인 필요 / 사람 개입 필요 (CAPTCHA, 보안 확인 등)",
  4: "대기 시간 초과",
  5: "셀렉터를 찾지 못함 (사이트 구조 변경 의심)",
  6: "브라우저 실행 파일을 찾지 못함",
  7: "브라우저 프로필 사용 중(잠김)",
  130: "사용자 중지",
};

export const GLOBAL_OPTIONS = [
  { flag: "--json", type: "boolean", desc: "마지막에 JSON 하나만 stdout으로 출력, 진행 로그는 stderr" },
  { flag: "--browser <name>", type: "edge|chrome|whale|chromium|custom", desc: "사용할 브라우저 (기본: 환경변수 WEBLOOP_BROWSER > 프로파일 > webloop.local.yaml/webloop.config.yaml)" },
  { flag: "--browser-path <path>", type: "string", desc: "브라우저 실행 파일 경로 직접 지정" },
  { flag: "--headless / --headed", type: "boolean", desc: "브라우저 창 숨김/표시" },
  { flag: "--quiet", type: "boolean", desc: "진행 로그 숨김" },
];

export const COMMANDS = [
  { name: "init", usage: "webloop init [--browser <name>]", desc: "현재 폴더에 webloop.config.yaml, webloop.local.yaml, profiles/, goals/ 생성" },
  { name: "doctor", usage: "webloop doctor", desc: "Node, 브라우저 설치, 설정, claude CLI, 콘솔 인코딩 점검" },
  { name: "browsers", usage: "webloop browsers", desc: "설치된 브라우저(Edge/Chrome/Whale/Chromium) 탐지 결과", json: "{ selected, browsers: [{type,label,found,executablePath,candidates}] }" },
  { name: "login", usage: "webloop login <profile>", desc: "화면이 보이는 브라우저로 사이트를 열어 사람이 직접 로그인/보안 확인. 창을 닫거나 Enter를 누르면 세션 저장" },
  { name: "profile list", usage: "webloop profile list", desc: "프로파일 목록" },
  { name: "profile validate", usage: "webloop profile validate <profile>", desc: "프로파일 YAML 스키마 검증 (브라우저 없이)" },
  { name: "profile test", usage: "webloop profile test <profile> [--send <text>]", desc: "브라우저를 띄워 각 셀렉터가 실제 페이지에서 찾아지는지 검사. --send를 주면 실제로 1회 전송까지 시험" },
  { name: "send", usage: "webloop send -p <profile> (--prompt <text> | --prompt-file <path>) [--timeout <ms>] [--out <file>]", desc: "단계 모드: 1회 입력→대기→수집. 평가·재시도는 호출한 쪽이 판단", json: "RunResult" },
  { name: "run", usage: "webloop run -p <profile> -g <goal> [--prompt <text>] [--max-iter N] [--detach] [--ui]", desc: "자율 모드: 목표 달성까지 입력→대기→수집→평가→재작성 반복", json: "RunResult" },
  { name: "eval", usage: "webloop eval <runId> -g <goal> [--iteration N]", desc: "저장된 응답을 브라우저 없이 다시 평가" },
  { name: "list", usage: "webloop list [--limit N]", desc: "실행 목록" },
  { name: "status", usage: "webloop status <runId|last>", desc: "상태·현재 회차·마지막 평가" },
  { name: "logs", usage: "webloop logs <runId|last> [--follow]", desc: "이벤트 스트림(events.jsonl) 출력" },
  { name: "result", usage: "webloop result <runId|last> [--iteration N|best] [--out <file>]", desc: "최종/특정 회차 응답 본문과 파일 경로" },
  { name: "stop", usage: "webloop stop <runId|last>", desc: "실행 중지 요청 (다음 안전 지점에서 멈춤)" },
  { name: "ui", usage: "webloop ui [--port 4777]", desc: "진행 상황 웹 UI (127.0.0.1 전용)" },
  { name: "help", usage: "webloop help --json", desc: "이 명령 스키마를 JSON으로 출력" },
];

export const RUN_RESULT_SCHEMA = {
  runId: "string",
  kind: "run | send",
  status: "succeeded | failed | stopped",
  exitCode: "number (EXIT_CODES 참고)",
  iterations: "number",
  best: "{ iteration, score } | undefined",
  prompt: "string — best 회차에 보낸 프롬프트",
  responseText: "string — best 회차 응답 본문 (프로파일 extract.format 형식)",
  responseFile: "string — 응답 파일 경로",
  files: "string[] — 다운로드 파일",
  extra: "Record<string,string[]> — 프로파일 extract.extra 수집값 (예: 출처 링크)",
  reasons: "string[] — 미달 사유",
  error: "{ kind, message, hint } | undefined",
  runDir: "string",
  outputFile: "string | undefined",
  uiUrl: "string",
};
