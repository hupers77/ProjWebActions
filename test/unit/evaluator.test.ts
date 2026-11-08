import { describe, it, expect } from "vitest";
import { evaluate } from "../../src/eval/evaluator.js";

const base = { files: [], prompt: "p", goalPrompt: "g", cwd: process.cwd() };

describe("evaluate", () => {
  it("contains / min_length", async () => {
    const r = await evaluate([{ contains: ["설치", "사용법"] }, { min_length: 5 }], { ...base, text: "설치 방법만 있음" });
    expect(r.passed).toBe(false);
    expect(r.reasons[0]).toContain("'사용법' 미포함");
    expect(r.score).toBe(0.5);
  });
  it("regex, not_contains, max_length 통과", async () => {
    const r = await evaluate([{ regex: "^##" }, { not_contains: "오류" }, { max_length: 100 }], { ...base, text: "## 제목" });
    expect(r.passed).toBe(true);
    expect(r.score).toBe(1);
  });
  it("json_valid: 코드블록에서 JSON 추출", async () => {
    const text = "답변입니다\n```json\n{\"title\": \"a\", \"items\": []}\n```";
    expect((await evaluate([{ json_valid: { required: ["title", "items"] } }], { ...base, text })).passed).toBe(true);
    const r = await evaluate([{ json_valid: { required: ["missing"] } }], { ...base, text });
    expect(r.reasons[0]).toContain("missing");
  });
  it("command: 종료 코드 0이면 통과 (stdin으로 응답 전달)", async () => {
    const ok = await evaluate([{ command: `node -e "process.stdin.on('data',d=>process.exit(String(d).includes('hello')?0:1))"` }], { ...base, text: "hello" });
    expect(ok.passed).toBe(true);
    const bad = await evaluate([{ command: `node -e "process.exit(3)"` }], { ...base, text: "x" });
    expect(bad.passed).toBe(false);
  });
  it("llm_judge는 규칙 실패 시 생략", async () => {
    const r = await evaluate([{ contains: "없는말" }, { llm_judge: "좋은가" }], { ...base, text: "abc" }, { command: "false", args: [], maxCalls: 1, calls: { n: 0 } });
    expect(r.criteria[1]!.reason).toContain("생략");
  });
});
