import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import type { Goal, Profile } from "../config/schema.js";
import type { Workspace } from "../config/load.js";
import { launch, resolveSelector, type Session } from "../drivers/playwright.js";
import { Waiter } from "../wait/waiter.js";
import { extract } from "../extract/extract.js";
import { evaluate, type EvalResult } from "../eval/evaluator.js";
import { refine } from "../refine/refiner.js";
import { RunStore, type IterationMeta, type RunMeta, type RunStatus } from "../store/runStore.js";
import { ExitCode, WebloopError, toWebloopError } from "./errors.js";
import { checkAuth } from "./auth.js";
import { acquireLock } from "./lock.js";
import { sleep } from "./util.js";
import type { LlmOptions } from "./llm.js";

export interface RunOptions {
  ws: Workspace;
  profile: Profile;
  profileFile: string;
  goal: Goal;
  goalFile?: string;
  kind: "run" | "send";
  runId: string;
  browser?: string;
  executablePath?: string;
  headless?: boolean;
  log: (msg: string) => void;
  keepOpen?: boolean;
}

export interface RunResult {
  runId: string;
  kind: "run" | "send";
  status: RunStatus;
  exitCode: number;
  iterations: number;
  best?: { iteration: number; score: number };
  prompt?: string;
  responseText: string;
  responseFile?: string;
  files: string[];
  extra?: Record<string, string[]>;
  reasons: string[];
  error?: { kind: string; message: string; hint?: string };
  runDir: string;
  outputFile?: string;
}

interface IterOutcome {
  meta: IterationMeta;
  body: string;
  text: string;
  eval?: EvalResult;
  extra: Record<string, string[]>;
  responseFile?: string;
}

async function prepareConversation(session: Session, profile: Profile, iteration: number, sessionMode: "continue" | "new", shouldStop: () => boolean) {
  const page = session.page;
  const needsNavigate = iteration === 1 || (sessionMode === "new" && !profile.newSession?.click);
  if (needsNavigate) {
    const target = iteration === 1 ? profile.url : profile.newSession?.goto ?? profile.url;
    await page.goto(target, { waitUntil: "domcontentloaded", timeout: 60000 });
  } else if (sessionMode === "new" && profile.newSession?.click) {
    const { locator } = await resolveSelector(page, profile.newSession.click, { timeoutMs: 10000, what: "새 대화 버튼", state: "visible", shouldStop });
    await locator.first().click();
  }
  await checkAuth(page, profile);
  if (profile.ready) {
    await resolveSelector(page, profile.ready.selector, { timeoutMs: profile.ready.timeoutMs, what: "페이지 준비(ready)", state: "visible", shouldStop });
  }
}

async function typePrompt(session: Session, profile: Profile, prompt: string, shouldStop: () => boolean) {
  const page = session.page;
  const { locator } = await resolveSelector(page, profile.input.selector, { timeoutMs: 30000, what: "입력창(input)", state: "visible", shouldStop });
  const el = locator.first();
  await el.click();
  const method = profile.input.method;
  if (method === "fill") {
    await el.fill(prompt);
    return;
  }
  if (profile.input.clear) {
    await page.keyboard.press(process.platform === "darwin" ? "Meta+A" : "Control+A");
    await page.keyboard.press("Backspace");
  }
  if (method === "insert") {
    // 줄바꿈이 Enter(전송)로 해석되지 않도록 한 번에 삽입
    await page.keyboard.insertText(prompt);
  } else {
    // type: 실제 키 입력 흉내. 줄바꿈은 Shift+Enter
    const lines = prompt.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      if (i > 0) await page.keyboard.press("Shift+Enter");
      await page.keyboard.type(lines[i]!, { delay: 15 });
    }
  }
}

async function submitPrompt(session: Session, profile: Profile, shouldStop: () => boolean) {
  const page = session.page;
  const s = profile.submit;
  if ("press" in s) {
    await page.keyboard.press(s.press);
  } else {
    const { locator } = await resolveSelector(page, s.click, { timeoutMs: 10000, what: "제출 버튼(submit)", state: "visible", shouldStop });
    await locator.last().click();
  }
}

export async function executeRun(opts: RunOptions): Promise<RunResult> {
  const { ws, profile, goal, runId, log } = opts;
  const store = new RunStore(ws.dataDir);
  const maxIterations = opts.kind === "send" ? 1 : goal.maxIterations;
  const meta: RunMeta = store.load(runId) ?? {
    runId,
    kind: opts.kind,
    profile: profile.name,
    goal: opts.goalFile,
    status: "queued",
    createdAt: new Date().toISOString(),
    maxIterations,
    currentIteration: 0,
    iterations: [],
  };
  meta.pid = process.pid;
  meta.maxIterations = maxIterations;
  store.create(meta);
  store.event(runId, "run.queued", { profile: profile.name, kind: opts.kind });

  const llm: LlmOptions = { ...ws.config.llm, calls: { n: 0 } };
  const shouldStop = () => store.stopRequested(runId);
  const deadline = Date.now() + goal.deadlineMs;
  const sessionMode = goal.session ?? profile.session;
  const setStatus = (s: RunStatus, extra: Record<string, unknown> = {}) => {
    meta.status = s;
    store.save(meta);
    store.event(runId, "status", { status: s, ...extra });
  };

  let session: Session | undefined;
  let release: (() => void) | undefined;
  const outcomes: IterOutcome[] = [];
  let finalError: WebloopError | undefined;
  let prompt = goal.prompt ?? "";
  let refineExternal = false;

  try {
    if (!prompt.trim()) throw new WebloopError("config", "보낼 프롬프트가 비어 있습니다.", "--prompt, --prompt-file 또는 목표 파일의 prompt를 지정하세요.");
    meta.startedAt = new Date().toISOString();
    setStatus("running");
    log(`브라우저 실행 중...`);
    // 잠금 키는 프로파일+브라우저 (브라우저별로 프로필 폴더가 다름)
    session = await launch({ workspaceRoot: ws.root, dataDir: ws.dataDir, config: ws.config, profile, browser: opts.browser, executablePath: opts.executablePath, headless: opts.headless });
    if (profile.browser.mode === "persistent") release = acquireLock(ws.dataDir, `${profile.name}-${session.browserType}`, runId);
    meta.browser = session.browserType;
    store.save(meta);
    store.event(runId, "browser.launched", { browser: session.browserType, executablePath: session.browserInfo.executablePath ?? session.browserInfo.channel });
    log(`브라우저: ${session.browserInfo.label} (${session.browserInfo.executablePath ?? "channel " + session.browserInfo.channel})`);

    for (let i = 1; i <= maxIterations; i++) {
      if (shouldStop()) throw new WebloopError("stopped", "사용자 중지 요청");
      if (Date.now() > deadline) throw new WebloopError("timeout", `전체 제한 시간(${goal.deadlineMs}ms) 초과`);
      meta.currentIteration = i;
      setStatus(i === 1 ? "running" : "retrying");
      store.event(runId, "iteration.started", { iteration: i });
      store.writeIterFile(runId, i, "prompt.txt", prompt);
      log(`[${i}/${maxIterations}] 입력 전송: ${prompt.slice(0, 60).replace(/\s+/g, " ")}${prompt.length > 60 ? "..." : ""}`);

      const it: IterationMeta = { iteration: i, status: "ok", startedAt: new Date().toISOString() };
      meta.iterations.push(it);
      const outcome: IterOutcome = { meta: it, body: "", text: "", extra: {} };
      outcomes.push(outcome);

      const page = session.page;
      await prepareConversation(session, profile, i, sessionMode, shouldStop);
      await typePrompt(session, profile, prompt, shouldStop);
      const waiter = new Waiter(page, profile);
      await waiter.prepare();
      await submitPrompt(session, profile, shouldStop);
      store.event(runId, "prompt.submitted", { iteration: i });

      const dir = store.iterDir(runId, i);
      const shot = async (name: string) => {
        mkdirSync(dir, { recursive: true });
        await page.screenshot({ path: `${dir}/${name}`, fullPage: false }).catch(() => {});
      };
      let lastShot = 0;
      const w = await waiter.wait({
        shouldStop,
        textSelector: profile.extract.text,
        onProgress: (chars, elapsedMs) => {
          store.event(runId, "wait.progress", { iteration: i, chars, elapsedMs });
          if (Date.now() - lastShot > 3000) {
            lastShot = Date.now();
            void shot("live.png");
          }
        },
      });
      it.elapsedMs = w.elapsedMs;
      if (w.timedOut) {
        it.status = "timeout";
        store.event(runId, "wait.timeout", { iteration: i, elapsedMs: w.elapsedMs });
        log(`  대기 시간 초과 (${w.elapsedMs}ms) — 현재까지 내용 수집`);
      } else {
        log(`  응답 완료 (${Math.round(w.elapsedMs / 100) / 10}s)`);
      }
      await shot("screenshot.png");

      const ex = await extract(page, profile, { iteration: i, dir });
      outcome.body = ex.body;
      outcome.text = ex.text;
      outcome.extra = ex.extra;
      it.chars = ex.text.length;
      it.files = ex.files;
      const ext = ex.format === "html" ? "html" : ex.format === "markdown" ? "md" : "txt";
      outcome.responseFile = store.writeIterFile(runId, i, `response.${ext}`, ex.body);
      store.writeIterFile(runId, i, "response.html", ex.html);
      if (Object.keys(ex.extra).length) store.writeIterFile(runId, i, "extra.json", JSON.stringify(ex.extra, null, 2));
      store.event(runId, "extract.done", { iteration: i, chars: ex.text.length, files: ex.files });

      // 평가
      if (opts.kind === "run") {
        setStatus("evaluating");
        const ev = await evaluate(goal.criteria, { text: ex.body, files: ex.files, prompt, goalPrompt: goal.prompt ?? "", cwd: ws.root, responseFile: outcome.responseFile }, llm);
        outcome.eval = ev;
        it.passed = ev.passed;
        it.score = ev.score;
        it.reasons = ev.reasons;
        store.writeIterFile(runId, i, "eval.json", JSON.stringify(ev, null, 2));
        store.event(runId, "eval.done", { iteration: i, passed: ev.passed, score: ev.score, reasons: ev.reasons });
        log(`  평가: ${ev.passed ? "통과" : "미달"} (score ${ev.score})${ev.reasons.length ? " — " + ev.reasons.join("; ") : ""}`);
      } else {
        it.passed = it.status === "ok";
        it.score = it.passed ? 1 : 0;
      }
      it.endedAt = new Date().toISOString();
      updateBest(meta);
      store.save(meta);

      if (it.passed && it.status === "ok") break;
      if (opts.kind === "send" || i === maxIterations) break;

      const prev = outcomes[outcomes.length - 2];
      if (goal.stopOnSameResponse && prev && prev.body.trim() === outcome.body.trim()) {
        store.event(runId, "early_stop", { reason: "same_response" });
        log("  같은 응답이 2회 연속 — 조기 종료");
        break;
      }
      const next = await refine(goal, { iteration: i, goalPrompt: goal.prompt ?? "", lastPrompt: prompt, lastResponse: outcome.body, reasons: outcome.eval?.reasons ?? [] }, llm);
      if (next.kind === "exhausted") {
        log("  준비된 프롬프트 후보 소진");
        break;
      }
      if (next.kind === "external") {
        refineExternal = true;
        break;
      }
      prompt = next.prompt;
      store.event(runId, "refine.done", { iteration: i, nextPrompt: prompt.slice(0, 500) });
      await sleepInterruptible(profile.cooldownMs, shouldStop);
    }
  } catch (e) {
    finalError = toWebloopError(e);
    const cur = outcomes[outcomes.length - 1];
    if (cur && !cur.meta.endedAt) {
      cur.meta.status = "error";
      cur.meta.error = finalError.message;
      cur.meta.endedAt = new Date().toISOString();
      if (session) await session.page.screenshot({ path: `${store.iterDir(runId, cur.meta.iteration)}/error.png` }).catch(() => {});
    }
  } finally {
    if (session && !opts.keepOpen) await session.close().catch(() => {});
    release?.();
  }

  // 결과 정리
  const bestIdx = meta.best ? outcomes.findIndex((o) => o.meta.iteration === meta.best!.iteration) : -1;
  const best = bestIdx >= 0 ? outcomes[bestIdx]! : outcomes[outcomes.length - 1];
  const succeeded = !finalError && !!best && best.meta.passed === true && best.meta.status === "ok";
  let status: RunStatus;
  let exitCode: number;
  if (finalError) {
    status = finalError.kind === "stopped" ? "stopped" : "failed";
    exitCode = finalError.exitCode;
  } else if (succeeded) {
    status = "succeeded";
    exitCode = ExitCode.OK;
  } else {
    status = "failed";
    const last = outcomes[outcomes.length - 1];
    exitCode = last?.meta.status === "timeout" ? ExitCode.TIMEOUT : ExitCode.GOAL_NOT_MET;
  }

  let outputFile: string | undefined;
  if (best?.body && goal.output?.saveTo) {
    outputFile = isAbsolute(goal.output.saveTo) ? goal.output.saveTo : resolve(ws.root, goal.output.saveTo);
    mkdirSync(dirname(outputFile), { recursive: true });
    writeFileSync(outputFile, best.body, "utf8");
  }

  meta.status = status;
  meta.exitCode = exitCode;
  meta.endedAt = new Date().toISOString();
  meta.outputFile = outputFile;
  if (finalError) meta.error = { kind: finalError.kind, message: finalError.message, hint: finalError.hint };
  store.save(meta);
  store.event(runId, "run.finished", { status, exitCode, best: meta.best, external: refineExternal || undefined });

  return {
    runId,
    kind: opts.kind,
    status,
    exitCode,
    iterations: outcomes.length,
    best: meta.best,
    prompt: best ? store.readIterFile(runId, best.meta.iteration, "prompt.txt") : undefined,
    responseText: best?.body ?? "",
    responseFile: best?.responseFile,
    files: outcomes.flatMap((o) => o.meta.files ?? []),
    extra: best?.extra && Object.keys(best.extra).length ? best.extra : undefined,
    reasons: best?.eval?.reasons ?? (finalError ? [finalError.message] : []),
    error: meta.error,
    runDir: store.runDir(runId),
    outputFile,
  };
}

function updateBest(meta: RunMeta) {
  let best: { iteration: number; score: number } | undefined;
  for (const it of meta.iterations) {
    if (it.score === undefined) continue;
    if (!best || it.score > best.score || (it.score === best.score && it.passed)) best = { iteration: it.iteration, score: it.score };
  }
  meta.best = best;
}

async function sleepInterruptible(ms: number, shouldStop: () => boolean) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (shouldStop()) throw new WebloopError("stopped", "사용자 중지 요청");
    await sleep(Math.min(250, end - Date.now()));
  }
}
