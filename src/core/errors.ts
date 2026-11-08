/** 종료 코드 (AI가 분기하기 쉽도록 고정) */
export const ExitCode = {
  OK: 0,
  ERROR: 1,
  GOAL_NOT_MET: 2,
  NEEDS_HUMAN: 3,
  TIMEOUT: 4,
  SELECTOR_NOT_FOUND: 5,
  BROWSER_NOT_FOUND: 6,
  PROFILE_LOCKED: 7,
  STOPPED: 130,
} as const;
export type ExitCodeValue = (typeof ExitCode)[keyof typeof ExitCode];

export type ErrorKind =
  | "config"
  | "needs_human"
  | "timeout"
  | "selector_not_found"
  | "browser_not_found"
  | "profile_locked"
  | "stopped"
  | "error";

const kindToExit: Record<ErrorKind, ExitCodeValue> = {
  config: ExitCode.ERROR,
  error: ExitCode.ERROR,
  needs_human: ExitCode.NEEDS_HUMAN,
  timeout: ExitCode.TIMEOUT,
  selector_not_found: ExitCode.SELECTOR_NOT_FOUND,
  browser_not_found: ExitCode.BROWSER_NOT_FOUND,
  profile_locked: ExitCode.PROFILE_LOCKED,
  stopped: ExitCode.STOPPED,
};

export class WebloopError extends Error {
  readonly kind: ErrorKind;
  readonly exitCode: ExitCodeValue;
  readonly hint?: string;
  constructor(kind: ErrorKind, message: string, hint?: string) {
    super(message);
    this.kind = kind;
    this.exitCode = kindToExit[kind];
    this.hint = hint;
  }
}

export function toWebloopError(e: unknown): WebloopError {
  if (e instanceof WebloopError) return e;
  const msg = e instanceof Error ? e.message : String(e);
  if (/Timeout \d+ms exceeded/i.test(msg)) return new WebloopError("timeout", msg);
  return new WebloopError("error", msg);
}
