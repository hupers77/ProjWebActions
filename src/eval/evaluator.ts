import { existsSync, statSync } from "node:fs";
import { extname } from "node:path";
import { spawn } from "node:child_process";
import type { Criterion } from "../config/schema.js";
import { runLlm, type LlmOptions } from "../core/llm.js";

export interface CriterionResult {
  type: string;
  passed: boolean;
  reason?: string;
  score?: number;
}

export interface EvalResult {
  passed: boolean;
  score: number;
  reasons: string[];
  criteria: CriterionResult[];
}

export interface EvalInput {
  text: string;
  files: string[];
  prompt: string;
  goalPrompt: string;
  cwd: string;
  responseFile?: string;
}

const arr = (v: string | string[]) => (Array.isArray(v) ? v : [v]);

function extractJson(text: string): unknown {
  const fence = text.match(/```(?:json)?\s*\n([\s\S]*?)```/);
  const candidates = [fence?.[1], text];
  for (const c of candidates) {
    if (!c) continue;
    const s = c.indexOf("{");
    const a = c.indexOf("[");
    const start = s === -1 ? a : a === -1 ? s : Math.min(s, a);
    if (start === -1) continue;
    const end = Math.max(c.lastIndexOf("}"), c.lastIndexOf("]"));
    try {
      return JSON.parse(c.slice(start, end + 1));
    } catch {
      /* 다음 후보 */
    }
  }
  return undefined;
}

function runCommand(cmd: string, input: EvalInput, timeoutMs = 60000): Promise<{ code: number; out: string }> {
  return new Promise((resolve) => {
    const child = spawn(cmd, {
      shell: true,
      cwd: input.cwd,
      env: { ...process.env, WEBLOOP_RESPONSE_FILE: input.responseFile ?? "", WEBLOOP_FILES: input.files.join(process.platform === "win32" ? ";" : ":") },
      windowsHide: true,
    });
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));
    const t = setTimeout(() => child.kill(), timeoutMs);
    child.stdin.end(input.text);
    child.on("close", (code) => {
      clearTimeout(t);
      resolve({ code: code ?? 1, out: out.slice(-2000) });
    });
    child.on("error", (e) => {
      clearTimeout(t);
      resolve({ code: 1, out: e.message });
    });
  });
}

export async function evaluate(criteria: Criterion[], input: EvalInput, llm?: LlmOptions): Promise<EvalResult> {
  const results: CriterionResult[] = [];
  const text = input.text;
  const llmCriteria: string[] = [];
  for (const c of criteria) {
    if ("contains" in c) {
      const missing = arr(c.contains).filter((w) => !text.includes(w));
      results.push({ type: "contains", passed: missing.length === 0, reason: missing.length ? `${missing.map((m) => `'${m}'`).join(", ")} 미포함` : undefined });
    } else if ("not_contains" in c) {
      const found = arr(c.not_contains).filter((w) => text.includes(w));
      results.push({ type: "not_contains", passed: found.length === 0, reason: found.length ? `${found.map((m) => `'${m}'`).join(", ")} 포함됨` : undefined });
    } else if ("regex" in c) {
      const ok = new RegExp(c.regex, c.flags ?? "").test(text);
      results.push({ type: "regex", passed: ok, reason: ok ? undefined : `정규식 /${c.regex}/ 불일치` });
    } else if ("min_length" in c) {
      const ok = text.length >= c.min_length;
      results.push({ type: "min_length", passed: ok, reason: ok ? undefined : `길이 ${text.length}자 < 최소 ${c.min_length}자` });
    } else if ("max_length" in c) {
      const ok = text.length <= c.max_length;
      results.push({ type: "max_length", passed: ok, reason: ok ? undefined : `길이 ${text.length}자 > 최대 ${c.max_length}자` });
    } else if ("json_valid" in c) {
      const j = extractJson(text) as Record<string, unknown> | undefined;
      if (j === undefined) results.push({ type: "json_valid", passed: false, reason: "응답에서 JSON을 찾지 못함" });
      else {
        const missing = c.json_valid.required.filter((k) => !(j && typeof j === "object" && k in j));
        results.push({ type: "json_valid", passed: missing.length === 0, reason: missing.length ? `JSON 필수 키 누락: ${missing.join(", ")}` : undefined });
      }
    } else if ("file_exists" in c) {
      const hit = input.files.find((f) => existsSync(f) && (!c.file_exists.ext || extname(f).toLowerCase() === c.file_exists.ext.toLowerCase()) && statSync(f).size >= c.file_exists.minBytes);
      results.push({ type: "file_exists", passed: !!hit, reason: hit ? undefined : `조건에 맞는 다운로드 파일 없음${c.file_exists.ext ? ` (${c.file_exists.ext})` : ""}` });
    } else if ("command" in c) {
      const r = await runCommand(c.command, input, c.timeoutMs);
      results.push({ type: "command", passed: r.code === 0, reason: r.code === 0 ? undefined : `명령 실패(exit ${r.code}): ${r.out.trim().split("\n").slice(-3).join(" / ")}` });
    } else if ("llm_judge" in c) {
      llmCriteria.push(c.llm_judge);
    }
  }

  // 비싼 LLM 판정은 규칙형이 모두 통과했을 때만
  const rulesPassed = results.every((r) => r.passed);
  for (const crit of llmCriteria) {
    if (!rulesPassed || !llm) {
      results.push({ type: "llm_judge", passed: false, reason: llm ? "규칙 평가 실패로 LLM 판정 생략" : "LLM 설정 없음" });
      continue;
    }
    results.push(await llmJudge(crit, input, llm));
  }

  const passed = results.every((r) => r.passed);
  const scores = results.map((r) => r.score ?? (r.passed ? 1 : 0));
  const score = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : 1;
  return { passed, score: Math.round(score * 100) / 100, reasons: results.filter((r) => !r.passed && r.reason).map((r) => r.reason!), criteria: results };
}

async function llmJudge(criterion: string, input: EvalInput, llm: LlmOptions): Promise<CriterionResult> {
  const prompt = [
    "너는 웹사이트 응답을 평가하는 심사자다. 아래 기준으로 응답을 평가하고 JSON 한 개만 출력하라.",
    '형식: {"passed": true|false, "score": 0~1 사이 숫자, "reasons": ["부족한 점", ...]}',
    `## 기준\n${criterion}`,
    `## 원래 요청\n${input.goalPrompt}`,
    `## 응답\n${input.text.slice(0, 30000)}`,
  ].join("\n\n");
  try {
    const out = await runLlm(prompt, llm);
    const j = extractJson(out) as { passed?: boolean; score?: number; reasons?: string[] } | undefined;
    if (!j || typeof j.passed !== "boolean") return { type: "llm_judge", passed: false, reason: "LLM 판정 결과 해석 실패" };
    return { type: "llm_judge", passed: j.passed, score: typeof j.score === "number" ? j.score : undefined, reason: j.passed ? undefined : (j.reasons ?? []).join("; ") || "LLM 기준 미달" };
  } catch (e) {
    return { type: "llm_judge", passed: false, reason: `LLM 호출 실패: ${(e as Error).message}` };
  }
}
