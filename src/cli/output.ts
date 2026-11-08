import { WebloopError, toWebloopError } from "../core/errors.js";

export interface Out {
  json: boolean;
  /** 사람용 메시지 (json 모드에선 stderr) */
  log(msg: string): void;
  /** 최종 결과 출력 후 종료 코드 설정 */
  done(data: unknown, human: () => string, exitCode?: number): void;
  fail(e: unknown): never;
}

export function makeOut(json: boolean, quiet = false): Out {
  const log = (msg: string) => {
    if (quiet) return;
    (json ? process.stderr : process.stdout).write(msg + "\n");
  };
  return {
    json,
    log,
    done(data, human, exitCode = 0) {
      if (json) process.stdout.write(JSON.stringify(data, null, 2) + "\n");
      else {
        const s = human();
        if (s) process.stdout.write(s + (s.endsWith("\n") ? "" : "\n"));
      }
      process.exitCode = exitCode;
    },
    fail(e) {
      const err: WebloopError = toWebloopError(e);
      if (json) {
        process.stdout.write(JSON.stringify({ ok: false, error: { kind: err.kind, message: err.message, hint: err.hint }, exitCode: err.exitCode }, null, 2) + "\n");
      } else {
        process.stderr.write(`오류: ${err.message}\n${err.hint ? err.hint + "\n" : ""}`);
      }
      process.exit(err.exitCode);
    },
  };
}
