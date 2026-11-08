import { spawn } from "node:child_process";

export interface LlmOptions {
  command: string;
  args: string[];
  maxCalls: number;
  calls: { n: number };
}

/** `claude -p` 같은 CLI에 프롬프트를 stdin으로 넘기고 결과 텍스트를 받는다 */
export function runLlm(prompt: string, opts: LlmOptions, timeoutMs = 180000): Promise<string> {
  if (opts.calls.n >= opts.maxCalls) return Promise.reject(new Error(`LLM 호출 한도(${opts.maxCalls}) 초과`));
  opts.calls.n++;
  return new Promise((resolve, reject) => {
    // Windows에서 claude는 .cmd 래퍼이므로 shell 사용
    const child = spawn(opts.command, opts.args, { shell: process.platform === "win32", windowsHide: true });
    let out = "";
    let err = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    const t = setTimeout(() => { child.kill(); reject(new Error("LLM 응답 시간 초과")); }, timeoutMs);
    child.on("error", (e) => { clearTimeout(t); reject(e); });
    child.on("close", (code) => {
      clearTimeout(t);
      if (code !== 0) return reject(new Error(`exit ${code}: ${err.slice(-500)}`));
      // --output-format json 이면 {"result": "..."} 형태
      try {
        const j = JSON.parse(out);
        if (j && typeof j.result === "string") return resolve(j.result);
      } catch { /* 일반 텍스트 */ }
      resolve(out);
    });
    child.stdin.end(prompt, "utf8");
  });
}
