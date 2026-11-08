import type { Goal } from "../config/schema.js";
import { renderTemplate } from "../core/util.js";
import { runLlm, type LlmOptions } from "../core/llm.js";

export interface RefineInput {
  iteration: number; // 방금 끝난 회차 (1부터)
  goalPrompt: string;
  lastPrompt: string;
  lastResponse: string;
  reasons: string[];
}

export type RefineOutcome = { kind: "prompt"; prompt: string } | { kind: "exhausted" } | { kind: "external" };

const DEFAULT_TEMPLATE = "이전 답변에 다음 문제가 있었습니다: {{reasons}}\n이를 반영해서 원래 요청에 다시 답해 주세요.\n\n원래 요청: {{goal_prompt}}";

export async function refine(goal: Goal, input: RefineInput, llm?: LlmOptions): Promise<RefineOutcome> {
  const r = goal.refine;
  const vars = {
    prompt: input.lastPrompt,
    goal_prompt: input.goalPrompt,
    reasons: input.reasons.join("; "),
    last_response: input.lastResponse.slice(0, 8000),
    iteration: input.iteration + 1,
  };
  switch (r.strategy) {
    case "fixed": {
      const next = r.prompts?.[input.iteration - 1];
      return next ? { kind: "prompt", prompt: renderTemplate(next, vars) } : { kind: "exhausted" };
    }
    case "template":
      return { kind: "prompt", prompt: renderTemplate(r.template ?? DEFAULT_TEMPLATE, vars) };
    case "llm": {
      if (!llm) return { kind: "prompt", prompt: renderTemplate(DEFAULT_TEMPLATE, vars) };
      const ask = [
        "너는 웹 서비스에 보낼 프롬프트를 고쳐 쓰는 도우미다. 다음 시도에 보낼 프롬프트 본문만 출력하라. 설명 금지.",
        r.instruction ? `## 추가 지침\n${r.instruction}` : "",
        `## 원래 목표\n${input.goalPrompt}`,
        `## 직전 프롬프트\n${input.lastPrompt}`,
        `## 직전 응답(일부)\n${vars.last_response}`,
        `## 실패 사유\n${vars.reasons}`,
      ].filter(Boolean).join("\n\n");
      const out = (await runLlm(ask, llm)).trim();
      return { kind: "prompt", prompt: out || renderTemplate(DEFAULT_TEMPLATE, vars) };
    }
    case "external":
      return { kind: "external" };
  }
}
