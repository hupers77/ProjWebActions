import type { Page, Request } from "playwright-core";
import type { Profile, Selector, WaitStrategy } from "../config/schema.js";
import { WebloopError } from "../core/errors.js";
import { sleep } from "../core/util.js";
import { checkAuth } from "../core/auth.js";

const list = (s: Selector) => (Array.isArray(s) ? s : [s]);

async function count(page: Page, sel: Selector): Promise<number> {
  let best = 0;
  for (const s of list(sel)) best = Math.max(best, await page.locator(s).count().catch(() => 0));
  return best;
}

async function anyVisible(page: Page, sel: Selector): Promise<boolean> {
  for (const s of list(sel)) {
    const loc = page.locator(s);
    const n = await loc.count().catch(() => 0);
    for (let i = 0; i < n; i++) if (await loc.nth(i).isVisible().catch(() => false)) return true;
  }
  return false;
}

async function lastText(page: Page, sel: Selector): Promise<string> {
  for (const s of list(sel)) {
    const loc = page.locator(s);
    const n = await loc.count().catch(() => 0);
    if (n > 0) return ((await loc.nth(n - 1).innerText({ timeout: 2000 }).catch(() => "")) ?? "").trim();
  }
  return "";
}

export interface WaitResult {
  timedOut: boolean;
  elapsedMs: number;
  chars: number;
}

/**
 * 응답 완료 감지. submit 전에 prepare()로 기준값을 잡고, submit 후 wait()를 부른다.
 * 모든 전략(all)을 동시에 만족해야 완료.
 */
export class Waiter {
  private baselineCounts = new Map<number, number>();
  private baselineText = new Map<number, string>();
  private inflight = 0;
  private lastNet = Date.now();
  private onReq = (_: Request) => { this.inflight++; this.lastNet = Date.now(); };
  private onDone = (_: Request) => { this.inflight = Math.max(0, this.inflight - 1); this.lastNet = Date.now(); };

  constructor(private page: Page, private profile: Profile) {}

  async prepare(): Promise<void> {
    const strategies = this.profile.wait.all;
    for (let i = 0; i < strategies.length; i++) {
      const s = strategies[i]!;
      if ("new_element" in s) this.baselineCounts.set(i, await count(this.page, s.new_element));
      if ("text_stable" in s) this.baselineText.set(i, await lastText(this.page, s.text_stable.selector));
    }
    this.page.on("request", this.onReq);
    this.page.on("requestfinished", this.onDone);
    this.page.on("requestfailed", this.onDone);
  }

  async wait(opts: { shouldStop: () => boolean; onProgress?: (chars: number, elapsedMs: number) => void; textSelector: Selector }): Promise<WaitResult> {
    const { page, profile } = this;
    const strategies = profile.wait.all;
    const start = Date.now();
    const seenVisible = new Set<number>();
    const stableSince = new Map<number, { text: string; since: number }>();
    let lastProgress = 0;
    let chars = 0;
    try {
      for (;;) {
        if (opts.shouldStop()) throw new WebloopError("stopped", "사용자 중지 요청");
        await checkAuth(page, profile);
        const elapsed = Date.now() - start;
        let allOk = true;
        for (let i = 0; i < strategies.length; i++) {
          const ok = await this.check(i, strategies[i]!, elapsed, seenVisible, stableSince);
          if (!ok) { allOk = false; break; }
        }
        chars = (await lastText(page, opts.textSelector)).length;
        if (opts.onProgress && Date.now() - lastProgress > 1500) {
          lastProgress = Date.now();
          opts.onProgress(chars, elapsed);
        }
        if (allOk) return { timedOut: false, elapsedMs: elapsed, chars };
        if (elapsed > profile.wait.timeoutMs) return { timedOut: true, elapsedMs: elapsed, chars };
        await sleep(300);
      }
    } finally {
      page.off("request", this.onReq);
      page.off("requestfinished", this.onDone);
      page.off("requestfailed", this.onDone);
    }
  }

  private async check(
    i: number,
    s: WaitStrategy,
    elapsed: number,
    seenVisible: Set<number>,
    stableSince: Map<number, { text: string; since: number }>,
  ): Promise<boolean> {
    const page = this.page;
    if ("selector_visible" in s) return anyVisible(page, s.selector_visible);
    if ("selector_hidden" in s) {
      const vis = await anyVisible(page, s.selector_hidden);
      if (vis) { seenVisible.add(i); return false; }
      // 아직 한 번도 안 보였다면 생성이 시작되기 전일 수 있으므로 잠시 유예
      return seenVisible.has(i) || elapsed > 4000;
    }
    if ("new_element" in s) {
      const n = await count(page, s.new_element);
      if (elapsed > this.profile.wait.startTimeoutMs && n <= (this.baselineCounts.get(i) ?? 0)) {
        throw new WebloopError("selector_not_found", `제출 후 ${this.profile.wait.startTimeoutMs}ms 안에 새 응답 요소가 나타나지 않음: ${list(s.new_element).join(" | ")}`, "입력/제출이 실제로 되었는지, 응답 셀렉터가 맞는지 `webloop profile test`로 점검하세요.");
      }
      return n > (this.baselineCounts.get(i) ?? 0);
    }
    if ("text_stable" in s) {
      const text = await lastText(page, s.text_stable.selector);
      const now = Date.now();
      const prev = stableSince.get(i);
      if (!prev || prev.text !== text) {
        stableSince.set(i, { text, since: now });
        return false;
      }
      if (!text || text === this.baselineText.get(i)) return false;
      return now - prev.since >= s.text_stable.ms;
    }
    if ("network_idle" in s) return this.inflight === 0 && Date.now() - this.lastNet >= s.network_idle.ms;
    if ("delay" in s) return elapsed >= s.delay;
    return true;
  }
}
