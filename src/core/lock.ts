import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { WebloopError } from "./errors.js";

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** 같은 브라우저 프로필을 두 실행이 동시에 쓰지 않도록 잠금 */
export function acquireLock(dataDir: string, key: string, runId: string): () => void {
  const dir = join(dataDir, "locks");
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${key.replace(/[^\w.-]/g, "_")}.lock`);
  if (existsSync(file)) {
    try {
      const info = JSON.parse(readFileSync(file, "utf8")) as { pid: number; runId: string };
      if (info.pid !== process.pid && alive(info.pid)) {
        throw new WebloopError("profile_locked", `프로파일 '${key}'을(를) 다른 실행(${info.runId}, pid ${info.pid})이 사용 중입니다.`, `끝날 때까지 기다리거나 \`webloop stop ${info.runId}\`로 중지하세요.`);
      }
    } catch (e) {
      if (e instanceof WebloopError) throw e;
    }
  }
  writeFileSync(file, JSON.stringify({ pid: process.pid, runId, at: new Date().toISOString() }), "utf8");
  return () => rmSync(file, { force: true });
}
