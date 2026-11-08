#!/usr/bin/env node
import { Command, Option } from "commander";
import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, readdirSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { createInterface } from "node:readline";
import { loadWorkspace, loadProfile, loadGoal, listProfiles, PACKAGE_ROOT, CONFIG_FILE, LOCAL_CONFIG_FILE, type Workspace } from "../config/load.js";
import { Goal, type Profile } from "../config/schema.js";
import { detectAll, chooseBrowserType, detectBrowser } from "../browsers/registry.js";
import { launch, resolveSelector, countMatches } from "../drivers/playwright.js";
import { executeRun, type RunResult } from "../core/orchestrator.js";
import { evaluate } from "../eval/evaluator.js";
import { RunStore } from "../store/runStore.js";
import { WebloopError, ExitCode } from "../core/errors.js";
import { newRunId, sleep } from "../core/util.js";
import { makeOut, type Out } from "./output.js";
import { COMMANDS, EXIT_CODES, GLOBAL_OPTIONS, RUN_RESULT_SCHEMA } from "./commands-meta.js";
import { startUiServer, isUiRunning } from "../ui/server.js";

const pkg = JSON.parse(readFileSync(join(PACKAGE_ROOT, "package.json"), "utf8")) as { version: string };

interface GlobalOpts {
  json?: boolean;
  browser?: string;
  browserPath?: string;
  headless?: boolean;
  quiet?: boolean;
}

function ctx(cmd: Command): { g: GlobalOpts; out: Out; ws: Workspace } {
  const g = cmd.optsWithGlobals() as GlobalOpts;
  const out = makeOut(!!g.json, !!g.quiet);
  try {
    return { g, out, ws: loadWorkspace() };
  } catch (e) {
    return out.fail(e);
  }
}

function readPrompt(o: { prompt?: string; promptFile?: string }): string | undefined {
  if (o.promptFile) {
    if (o.promptFile === "-") return readFileSync(0, "utf8");
    return readFileSync(resolve(o.promptFile), "utf8").replace(/^\uFEFF/, "");
  }
  return o.prompt;
}

function uiUrl(ws: Workspace, runId: string) {
  return `http://127.0.0.1:${ws.config.ui.port}/runs/${runId}`;
}

function humanResult(r: RunResult): string {
  const lines = [
    "",
    `── 결과 ─────────────────────────────`,
    `runId   : ${r.runId}`,
    `상태    : ${r.status} (exit ${r.exitCode})${r.best ? `  best=${r.best.iteration}회차 score ${r.best.score}` : ""}`,
    `회차    : ${r.iterations}`,
  ];
  if (r.reasons.length && r.status !== "succeeded") lines.push(`사유    : ${r.reasons.join("; ")}`);
  if (r.error?.hint) lines.push(`도움말  : ${r.error.hint}`);
  if (r.responseFile) lines.push(`응답파일: ${r.responseFile}`);
  if (r.outputFile) lines.push(`저장    : ${r.outputFile}`);
  if (r.files.length) lines.push(`다운로드: ${r.files.join(", ")}`);
  lines.push("─────────────────────────────────────", "", r.responseText);
  if (r.extra) for (const [k, v] of Object.entries(r.extra)) if (v.length) lines.push("", `[${k}]`, ...v.map((x) => `- ${x}`));
  return lines.join("\n");
}

const program = new Command();
program
  .name("webloop")
  .description("웹사이트 입력창에 글을 보내고 응답을 받아오는 CLI. 목표를 만족할 때까지 반복할 수 있다.")
  .version(pkg.version)
  .option("--json", "결과를 JSON 하나로 stdout에 출력 (로그는 stderr)")
  .option("--browser <name>", "브라우저: edge | chrome | whale | chromium | custom")
  .option("--browser-path <path>", "브라우저 실행 파일 경로 직접 지정")
  .addOption(new Option("--headless", "브라우저 창 숨김"))
  .addOption(new Option("--headed", "브라우저 창 표시").implies({ headless: false }))
  .option("--quiet", "진행 로그 숨김")
  .showHelpAfterError();

// ── init ──────────────────────────────────────────────
program
  .command("init")
  .description("현재 폴더에 설정 파일과 profiles/, goals/ 생성")
  .action((_o, cmd: Command) => {
    const g = cmd.optsWithGlobals() as GlobalOpts;
    const out = makeOut(!!g.json, !!g.quiet);
    const root = process.cwd();
    const created: string[] = [];
    const write = (rel: string, content: string) => {
      const p = join(root, rel);
      if (existsSync(p)) return;
      mkdirSync(dirname(p), { recursive: true });
      writeFileSync(p, content, "utf8");
      created.push(rel);
    };
    write(
      CONFIG_FILE,
      `# webloop 공용 설정 (git에 올려도 되는 값)\n# 기본 브라우저: edge | chrome | whale | chromium\nbrowser: edge\nprofilesDir: ./profiles\ngoalsDir: ./goals\ndataDir: ./.webloop\nui:\n  port: 4777\n`,
    );
    const local = g.browser ?? (process.platform === "darwin" ? "whale" : "edge");
    write(
      LOCAL_CONFIG_FILE,
      `# 이 PC 전용 설정 (git 제외). webloop.config.yaml 값을 덮어쓴다.\nbrowser: ${local}\n# 설치 경로가 기본과 다르면 지정\n# browsers:\n#   whale:\n#     executablePath: "/Applications/Whale.app/Contents/MacOS/Whale"\n#   edge:\n#     executablePath: "C:\\\\Program Files (x86)\\\\Microsoft\\\\Edge\\\\Application\\\\msedge.exe"\n`,
    );
    for (const dir of ["profiles", "goals"]) {
      const src = join(PACKAGE_ROOT, dir);
      if (resolve(src) === resolve(root, dir) || !existsSync(src)) continue;
      mkdirSync(join(root, dir), { recursive: true });
      for (const f of readdirSync(src)) {
        if (!existsSync(join(root, dir, f))) {
          copyFileSync(join(src, f), join(root, dir, f));
          created.push(`${dir}/${f}`);
        }
      }
    }
    const gi = join(root, ".gitignore");
    const giText = existsSync(gi) ? readFileSync(gi, "utf8") : "";
    const need = [".webloop/", "webloop.local.yaml"].filter((l) => !giText.includes(l));
    if (need.length) {
      writeFileSync(gi, giText + (giText && !giText.endsWith("\n") ? "\n" : "") + need.join("\n") + "\n", "utf8");
      created.push(".gitignore (갱신)");
    }
    out.done({ ok: true, root, created }, () => (created.length ? `생성됨:\n${created.map((c) => "  " + c).join("\n")}` : "이미 초기화되어 있습니다."));
  });

// ── doctor ────────────────────────────────────────────
program
  .command("doctor")
  .description("실행 환경 점검")
  .action((_o, cmd: Command) => {
    const { g, out, ws } = ctx(cmd);
    const checks: { name: string; ok: boolean; detail: string }[] = [];
    const major = Number(process.versions.node.split(".")[0]);
    checks.push({ name: "Node.js", ok: major >= 20, detail: `v${process.versions.node} (20 이상 필요)` });
    checks.push({ name: "OS", ok: true, detail: `${process.platform} ${process.arch}` });
    checks.push({ name: "설정 파일", ok: true, detail: ws.configFiles.length ? ws.configFiles.join(", ") : "없음 (기본값 사용, `webloop init` 권장)" });
    let selected = "";
    try {
      selected = chooseBrowserType({ cli: g.browser, config: ws.config });
    } catch (e) {
      checks.push({ name: "선택 브라우저", ok: false, detail: (e as Error).message });
    }
    for (const b of detectAll(ws.config)) {
      const mark = b.type === selected ? " ← 선택됨" : "";
      checks.push({ name: `브라우저 ${b.label}`, ok: b.found || b.type !== selected, detail: (b.found ? b.executablePath! : "없음") + mark });
    }
    const claude = spawnSync(ws.config.llm.command, ["--version"], { shell: process.platform === "win32", encoding: "utf8", timeout: 15000 });
    checks.push({ name: "claude CLI (선택)", ok: true, detail: claude.status === 0 ? claude.stdout.trim() : "없음 — llm_judge / refine: llm 사용 불가" });
    if (process.platform === "win32") {
      const cp = spawnSync("cmd", ["/c", "chcp"], { encoding: "utf8" });
      const code = (cp.stdout.match(/(\d+)/) ?? [])[1] ?? "?";
      checks.push({ name: "콘솔 코드페이지", ok: true, detail: `${code}${code === "65001" ? " (UTF-8)" : " — 출력을 파이프로 받으면 한글이 깨질 수 있음. --json + --out 파일 사용 또는 [Console]::OutputEncoding=[Text.Encoding]::UTF8 권장"}` });
    }
    const dataOk = (() => {
      try {
        mkdirSync(ws.dataDir, { recursive: true });
        return true;
      } catch {
        return false;
      }
    })();
    checks.push({ name: "데이터 폴더", ok: dataOk, detail: ws.dataDir });
    const allOk = checks.every((c) => c.ok);
    out.done({ ok: allOk, checks }, () => checks.map((c) => `${c.ok ? "✓" : "✗"} ${c.name.padEnd(22)} ${c.detail}`).join("\n"), allOk ? 0 : 1);
  });

// ── browsers ──────────────────────────────────────────
program
  .command("browsers")
  .description("설치된 브라우저 탐지")
  .option("--cdp-help", "기존 브라우저에 CDP로 붙는 방법 출력")
  .action((o: { cdpHelp?: boolean }, cmd: Command) => {
    const { g, out, ws } = ctx(cmd);
    const list = detectAll(ws.config);
    let selected: string | undefined;
    try {
      selected = chooseBrowserType({ cli: g.browser, config: ws.config });
    } catch {
      /* 무시 */
    }
    out.done({ selected, browsers: list }, () => {
      const lines = list.map((b) => `${b.type === selected ? "▶" : " "} ${b.type.padEnd(9)} ${b.found ? "✓ " + b.executablePath : "✗ 설치 안 됨"}`);
      if (o.cdpHelp) {
        const sel = selected ? detectBrowser(selected as any, ws.config) : undefined;
        const exe = sel?.executablePath ?? "<브라우저 경로>";
        lines.push(
          "",
          "CDP 모드: 평소 쓰는 브라우저를 디버깅 포트로 띄운 뒤 프로파일에 browser.mode: cdp 지정",
          process.platform === "win32"
            ? `  & "${exe}" --remote-debugging-port=9222 --user-data-dir="$env:LOCALAPPDATA\\webloop-cdp"`
            : `  "${exe}" --remote-debugging-port=9222 --user-data-dir="$HOME/.webloop-cdp"`,
        );
      }
      return lines.join("\n");
    });
  });

// ── login ─────────────────────────────────────────────
program
  .command("login <profile>")
  .description("화면이 보이는 브라우저로 사이트를 열어 직접 로그인/보안 확인 (세션은 전용 프로필에 저장)")
  .action(async (name: string, _o, cmd: Command) => {
    const { g, out, ws } = ctx(cmd);
    try {
      const { profile } = loadProfile(ws, name);
      const s = await launch({ workspaceRoot: ws.root, dataDir: ws.dataDir, config: ws.config, profile, browser: g.browser, executablePath: g.browserPath, headless: false });
      await s.page.goto(profile.url, { waitUntil: "domcontentloaded" }).catch(() => {});
      out.log(`${s.browserInfo.label} 창에서 로그인/확인을 마친 뒤, 브라우저 창을 닫거나 여기서 Enter를 누르세요.`);
      await new Promise<void>((res) => {
        s.context.on("close", () => res());
        if (process.stdin.isTTY) {
          const rl = createInterface({ input: process.stdin });
          rl.once("line", () => { rl.close(); res(); });
        }
      });
      await s.close().catch(() => {});
      out.done({ ok: true, profile: profile.name, browser: s.browserType }, () => "세션을 저장했습니다.");
      process.exit(0);
    } catch (e) {
      out.fail(e);
    }
  });

// ── profile ───────────────────────────────────────────
const profileCmd = program.command("profile").description("프로파일 관리");
profileCmd
  .command("list")
  .action((_o, cmd: Command) => {
    const { out, ws } = ctx(cmd);
    const list = listProfiles(ws).map((p) => {
      try {
        const { profile } = loadProfile(ws, p.file);
        return { ...p, url: profile.url, description: profile.description, valid: true };
      } catch (e) {
        return { ...p, valid: false, error: (e as Error).message };
      }
    });
    out.done({ profiles: list }, () => list.map((p) => `${p.valid ? "✓" : "✗"} ${p.name.padEnd(16)} ${"url" in p ? p.url : p.error}${p.bundled ? "  (기본 제공)" : ""}`).join("\n") || "프로파일 없음");
  });
profileCmd
  .command("validate <profile>")
  .action((name: string, _o, cmd: Command) => {
    const { out, ws } = ctx(cmd);
    try {
      const { profile, file } = loadProfile(ws, name);
      out.done({ ok: true, file, profile }, () => `✓ ${file} 검증 통과`);
    } catch (e) {
      out.fail(e);
    }
  });
profileCmd
  .command("test <profile>")
  .description("실제 페이지에서 셀렉터 점검")
  .option("--send <text>", "점검 후 실제로 1회 전송까지 시험")
  .option("--keep-open", "점검 후 브라우저를 닫지 않음 (Enter로 종료)")
  .action(async (name: string, o: { send?: string; keepOpen?: boolean }, cmd: Command) => {
    const { g, out, ws } = ctx(cmd);
    let session: Awaited<ReturnType<typeof launch>> | undefined;
    try {
      const { profile } = loadProfile(ws, name);
      session = await launch({ workspaceRoot: ws.root, dataDir: ws.dataDir, config: ws.config, profile, browser: g.browser, executablePath: g.browserPath, headless: g.headless });
      out.log(`${session.browserInfo.label}로 ${profile.url} 여는 중...`);
      const page = session.page;
      await page.goto(profile.url, { waitUntil: "domcontentloaded", timeout: 60000 });
      await sleep(3000);
      const results: { item: string; selector: string; found: number; note?: string }[] = [];
      const probe = async (item: string, sel: Profile["input"]["selector"] | undefined, note?: string) => {
        if (!sel) return;
        for (const s of Array.isArray(sel) ? sel : [sel]) {
          const n = await page.locator(s).count().catch(() => -1);
          results.push({ item, selector: s, found: n, note });
        }
      };
      await probe("ready", profile.ready?.selector);
      await probe("input", profile.input.selector);
      if ("click" in profile.submit) await probe("submit", profile.submit.click, "입력 후 나타날 수 있음");
      await probe("newSession", profile.newSession?.click);
      await probe("extract.text", profile.extract.text, "응답 후 생김");
      for (const w of profile.wait.all) {
        if ("selector_hidden" in w) await probe("wait.selector_hidden", w.selector_hidden, "생성 중에만 보임");
        if ("selector_visible" in w) await probe("wait.selector_visible", w.selector_visible);
        if ("new_element" in w) await probe("wait.new_element", w.new_element, "응답 후 생김");
      }
      const title = await page.title();
      let sendResult: RunResult | undefined;
      if (o.send) {
        await session.close();
        session = undefined;
        const runId = newRunId();
        sendResult = await executeRun({ ws, profile, profileFile: name, goal: Goal.parse({ prompt: o.send }), kind: "send", runId, browser: g.browser, executablePath: g.browserPath, headless: g.headless, log: out.log });
        for (const r of results) {
          if (r.found === 0 && (r.item === "extract.text" || r.item === "wait.new_element") && sendResult.status === "succeeded") r.note = "전송 후 확인됨";
        }
      }
      const inputOk = results.some((r) => r.item === "input" && r.found > 0);
      const okAll = inputOk && (!sendResult || sendResult.status === "succeeded");
      out.done({ ok: okAll, title, url: page.url?.() ?? profile.url, checks: results, send: sendResult }, () => {
        const lines = [`페이지 제목: ${title}`, ""];
        for (const r of results) lines.push(`${r.found > 0 ? "✓" : r.found === 0 ? "·" : "✗"} ${r.item.padEnd(22)} ${String(r.found).padStart(2)}개  ${r.selector}${r.note && r.found <= 0 ? `  (${r.note})` : ""}`);
        if (!inputOk) lines.push("", "✗ 입력창을 찾지 못했습니다. 로그인/보안 확인 화면인지 `webloop login`으로 확인하세요.");
        if (sendResult) lines.push(humanResult(sendResult));
        return lines.join("\n");
      }, okAll ? 0 : sendResult ? sendResult.exitCode : ExitCode.SELECTOR_NOT_FOUND);
      if (o.keepOpen && session && process.stdin.isTTY) {
        out.log("Enter를 누르면 종료합니다.");
        await new Promise<void>((res) => createInterface({ input: process.stdin }).once("line", () => res()));
      }
    } catch (e) {
      out.fail(e);
    } finally {
      await session?.close().catch(() => {});
    }
  });

// ── send / run 공통 ──────────────────────────────────
function maybeDetach(cmd: Command, ws: Workspace, out: Out, kind: string, profileName: string): boolean {
  const o = cmd.opts() as { detach?: boolean; runId?: string };
  if (!o.detach) return false;
  const runId = newRunId();
  const args = process.argv.slice(2).filter((a) => a !== "--detach");
  args.push("--run-id", runId);
  const child = spawn(process.execPath, [process.argv[1]!, ...args], { detached: true, stdio: "ignore", windowsHide: true, cwd: process.cwd() });
  child.unref();
  const store = new RunStore(ws.dataDir);
  store.create({ runId, kind: kind as "run" | "send", profile: profileName, status: "queued", createdAt: new Date().toISOString(), maxIterations: 0, currentIteration: 0, iterations: [], pid: child.pid });
  out.done({ runId, status: "queued", detached: true, pid: child.pid, uiUrl: uiUrl(ws, runId) }, () => `백그라운드 실행 시작: ${runId}\n진행 확인: webloop status ${runId}  /  webloop logs ${runId} --follow`);
  return true;
}

async function ensureUi(ws: Workspace, out: Out) {
  if (await isUiRunning(ws.config.ui.port)) return;
  const child = spawn(process.execPath, [process.argv[1]!, "ui", "--quiet"], { detached: true, stdio: "ignore", windowsHide: true, cwd: process.cwd() });
  child.unref();
  out.log(`웹 UI: http://127.0.0.1:${ws.config.ui.port}`);
}

program
  .command("send")
  .description("단계 모드: 1회 입력 → 대기 → 수집")
  .requiredOption("-p, --profile <profile>", "프로파일 이름 또는 경로")
  .option("--prompt <text>", "보낼 글")
  .option("--prompt-file <path>", "보낼 글 파일 (UTF-8, '-'면 stdin)")
  .option("--timeout <ms>", "응답 대기 제한(ms)", (v) => Number(v))
  .option("--out <file>", "응답 본문을 저장할 파일")
  .option("--session <mode>", "continue | new")
  .option("--detach", "백그라운드 실행 후 runId만 반환")
  .option("--ui", "웹 UI 서버를 함께 띄움")
  .addOption(new Option("--run-id <id>").hideHelp())
  .action(async (o: { profile: string; prompt?: string; promptFile?: string; timeout?: number; out?: string; session?: "continue" | "new"; ui?: boolean; runId?: string }, cmd: Command) => {
    const { g, out, ws } = ctx(cmd);
    try {
      const { profile, file } = loadProfile(ws, o.profile);
      if (o.timeout) profile.wait.timeoutMs = o.timeout;
      const prompt = readPrompt(o);
      if (!prompt) throw new WebloopError("config", "--prompt 또는 --prompt-file이 필요합니다.");
      if (maybeDetach(cmd, ws, out, "send", profile.name)) return;
      if (o.ui) await ensureUi(ws, out);
      const goal = Goal.parse({ prompt, session: o.session, output: o.out ? { saveTo: resolve(o.out) } : undefined });
      const r = await executeRun({ ws, profile, profileFile: file, goal, kind: "send", runId: o.runId ?? newRunId(), browser: g.browser, executablePath: g.browserPath, headless: g.headless, log: out.log });
      out.done({ ...r, uiUrl: uiUrl(ws, r.runId) }, () => humanResult(r), r.exitCode);
    } catch (e) {
      out.fail(e);
    }
  });

program
  .command("run")
  .description("자율 모드: 목표 달성까지 반복")
  .requiredOption("-p, --profile <profile>", "프로파일 이름 또는 경로")
  .option("-g, --goal <goal>", "목표 파일 이름 또는 경로")
  .option("--prompt <text>", "목표 파일의 prompt 대신 사용")
  .option("--prompt-file <path>", "프롬프트 파일 (UTF-8, '-'면 stdin)")
  .option("--max-iter <n>", "최대 반복 횟수", (v) => Number(v))
  .option("--timeout <ms>", "회차별 응답 대기 제한(ms)", (v) => Number(v))
  .option("--out <file>", "최종(best) 응답 저장 파일")
  .option("--detach", "백그라운드 실행 후 runId만 반환")
  .option("--ui", "웹 UI 서버를 함께 띄움")
  .addOption(new Option("--run-id <id>").hideHelp())
  .action(async (o: { profile: string; goal?: string; prompt?: string; promptFile?: string; maxIter?: number; timeout?: number; out?: string; ui?: boolean; runId?: string }, cmd: Command) => {
    const { g, out, ws } = ctx(cmd);
    try {
      const { profile, file } = loadProfile(ws, o.profile);
      if (o.timeout) profile.wait.timeoutMs = o.timeout;
      let goal: Goal;
      let goalFile: string | undefined;
      if (o.goal) {
        const l = loadGoal(ws, o.goal);
        goal = l.goal;
        goalFile = l.file;
      } else goal = Goal.parse({});
      const p = readPrompt(o);
      if (p) goal.prompt = p;
      if (o.maxIter) goal.maxIterations = o.maxIter;
      if (o.out) goal.output = { saveTo: resolve(o.out) };
      if (!goal.prompt) throw new WebloopError("config", "프롬프트가 없습니다. 목표 파일의 prompt 또는 --prompt를 지정하세요.");
      if (maybeDetach(cmd, ws, out, "run", profile.name)) return;
      if (o.ui) await ensureUi(ws, out);
      const r = await executeRun({ ws, profile, profileFile: file, goal, goalFile, kind: "run", runId: o.runId ?? newRunId(), browser: g.browser, executablePath: g.browserPath, headless: g.headless, log: out.log });
      out.done({ ...r, uiUrl: uiUrl(ws, r.runId) }, () => humanResult(r), r.exitCode);
    } catch (e) {
      out.fail(e);
    }
  });

// ── eval ──────────────────────────────────────────────
program
  .command("eval <runId>")
  .description("저장된 응답을 브라우저 없이 다시 평가")
  .requiredOption("-g, --goal <goal>", "목표 파일")
  .option("--iteration <n>", "회차 (기본: 전체)", (v) => Number(v))
  .action(async (id: string, o: { goal: string; iteration?: number }, cmd: Command) => {
    const { out, ws } = ctx(cmd);
    try {
      const store = new RunStore(ws.dataDir);
      const runId = store.resolveId(id);
      const meta = runId ? store.load(runId) : undefined;
      if (!meta) throw new WebloopError("config", `실행을 찾을 수 없음: ${id}`);
      const { goal } = loadGoal(ws, o.goal);
      const its = meta.iterations.filter((i) => !o.iteration || i.iteration === o.iteration);
      const results: ({ iteration: number } & Awaited<ReturnType<typeof evaluate>>)[] = [];
      for (const it of its) {
        const body = store.readIterFile(meta.runId, it.iteration, "response.md") ?? store.readIterFile(meta.runId, it.iteration, "response.txt") ?? "";
        const ev = await evaluate(goal.criteria, { text: body, files: it.files ?? [], prompt: store.readIterFile(meta.runId, it.iteration, "prompt.txt") ?? "", goalPrompt: goal.prompt ?? "", cwd: ws.root }, { ...ws.config.llm, calls: { n: 0 } });
        results.push({ iteration: it.iteration, ...ev });
      }
      const anyPass = results.some((r) => r.passed);
      out.done({ runId: meta.runId, results }, () => results.map((r) => `${r.iteration}회차: ${r.passed ? "통과" : "미달"} score ${r.score}${r.reasons.length ? " — " + r.reasons.join("; ") : ""}`).join("\n"), anyPass ? 0 : ExitCode.GOAL_NOT_MET);
    } catch (e) {
      out.fail(e);
    }
  });

// ── list / status / logs / result / stop ─────────────
program
  .command("list")
  .description("실행 목록")
  .option("--limit <n>", "개수", (v) => Number(v), 20)
  .action((o: { limit: number }, cmd: Command) => {
    const { out, ws } = ctx(cmd);
    const runs = new RunStore(ws.dataDir).list().slice(0, o.limit);
    out.done({ runs: runs.map(({ iterations, ...r }) => ({ ...r, iterationCount: iterations.length })) }, () =>
      runs.map((r) => `${r.runId}  ${r.kind.padEnd(4)}  ${r.status.padEnd(10)}  ${r.profile.padEnd(14)} ${r.currentIteration}/${r.maxIterations}  ${r.createdAt}`).join("\n") || "실행 기록 없음",
    );
  });

function needRun(ws: Workspace, id: string) {
  const store = new RunStore(ws.dataDir);
  const runId = store.resolveId(id);
  const meta = runId ? store.load(runId) : undefined;
  if (!meta) throw new WebloopError("config", `실행을 찾을 수 없음: ${id}`, "`webloop list`로 runId를 확인하세요.");
  return { store, meta };
}

program
  .command("status <runId>")
  .description("상태·현재 회차·마지막 평가 ('last' 가능)")
  .action((id: string, _o, cmd: Command) => {
    const { out, ws } = ctx(cmd);
    try {
      const { meta } = needRun(ws, id);
      const last = meta.iterations[meta.iterations.length - 1];
      out.done({ ...meta, lastIteration: last }, () =>
        [
          `runId : ${meta.runId} (${meta.kind})`,
          `상태  : ${meta.status}${meta.exitCode !== undefined ? ` (exit ${meta.exitCode})` : ""}`,
          `회차  : ${meta.currentIteration}/${meta.maxIterations}`,
          `브라우저: ${meta.browser ?? "-"}  프로파일: ${meta.profile}`,
          last ? `마지막: ${last.iteration}회차 ${last.status}${last.passed !== undefined ? (last.passed ? " 통과" : " 미달") : ""}${last.reasons?.length ? " — " + last.reasons.join("; ") : ""}` : "",
          meta.error ? `오류  : ${meta.error.message}` : "",
        ].filter(Boolean).join("\n"),
      );
    } catch (e) {
      out.fail(e);
    }
  });

program
  .command("logs <runId>")
  .description("이벤트 스트림 출력")
  .option("-f, --follow", "끝날 때까지 계속 출력")
  .action(async (id: string, o: { follow?: boolean }, cmd: Command) => {
    const { out, ws } = ctx(cmd);
    try {
      const { store, meta } = needRun(ws, id);
      let pos = 0;
      const all: unknown[] = [];
      for (;;) {
        const { events, size } = store.readEvents(meta.runId, pos);
        pos = size;
        for (const ev of events) {
          if (out.json) all.push(ev);
          else process.stdout.write(`${ev.ts}  ${ev.type}  ${JSON.stringify({ ...ev, ts: undefined, type: undefined })}\n`);
          if (ev.type === "run.finished" && o.follow) {
            if (out.json) out.done({ events: all }, () => "");
            return;
          }
        }
        if (!o.follow) break;
        await sleep(500);
      }
      if (out.json) out.done({ events: all }, () => "");
    } catch (e) {
      out.fail(e);
    }
  });

program
  .command("result <runId>")
  .description("응답 본문과 파일 경로 ('last' 가능)")
  .option("--iteration <n>", "회차 번호 또는 best", "best")
  .option("--out <file>", "본문을 파일로 저장")
  .action((id: string, o: { iteration: string; out?: string }, cmd: Command) => {
    const { out, ws } = ctx(cmd);
    try {
      const { store, meta } = needRun(ws, id);
      const n = o.iteration === "best" ? meta.best?.iteration ?? meta.iterations[meta.iterations.length - 1]?.iteration : Number(o.iteration);
      if (!n) throw new WebloopError("config", "수집된 회차가 없습니다.");
      const it = meta.iterations.find((i) => i.iteration === n);
      const body = store.readIterFile(meta.runId, n, "response.md") ?? store.readIterFile(meta.runId, n, "response.txt") ?? "";
      const extra = store.readIterFile(meta.runId, n, "extra.json");
      if (o.out) writeFileSync(resolve(o.out), body, "utf8");
      out.done(
        { runId: meta.runId, iteration: n, status: meta.status, passed: it?.passed, score: it?.score, reasons: it?.reasons ?? [], prompt: store.readIterFile(meta.runId, n, "prompt.txt"), responseText: body, extra: extra ? JSON.parse(extra) : undefined, files: it?.files ?? [], dir: store.iterDir(meta.runId, n) },
        () => body,
      );
    } catch (e) {
      out.fail(e);
    }
  });

program
  .command("stop <runId>")
  .description("실행 중지 요청")
  .action((id: string, _o, cmd: Command) => {
    const { out, ws } = ctx(cmd);
    try {
      const { store, meta } = needRun(ws, id);
      store.requestStop(meta.runId);
      out.done({ ok: true, runId: meta.runId }, () => `중지 요청: ${meta.runId}`);
    } catch (e) {
      out.fail(e);
    }
  });

// ── ui ────────────────────────────────────────────────
program
  .command("ui")
  .description("진행 상황 웹 UI (127.0.0.1 전용)")
  .option("--port <n>", "포트", (v) => Number(v))
  .action(async (o: { port?: number }, cmd: Command) => {
    const { out, ws } = ctx(cmd);
    try {
      const port = o.port ?? ws.config.ui.port;
      await startUiServer({ dataDir: ws.dataDir, port });
      out.log(`webloop UI: http://127.0.0.1:${port}  (Ctrl+C로 종료)`);
    } catch (e) {
      out.fail(e);
    }
  });

// ── help --json ───────────────────────────────────────
program
  .command("help-json", { hidden: true })
  .action(() => printHelpJson());

function printHelpJson() {
  process.stdout.write(
    JSON.stringify({ name: "webloop", version: pkg.version, globalOptions: GLOBAL_OPTIONS, commands: COMMANDS, exitCodes: EXIT_CODES, runResult: RUN_RESULT_SCHEMA, docs: ["docs/CLI.md", "docs/PROFILES.md", "AGENTS.md"] }, null, 2) + "\n",
  );
}

const argv = process.argv.slice(2);
if (argv[0] === "help" && argv.includes("--json")) {
  printHelpJson();
} else {
  program.parseAsync(process.argv).catch((e) => makeOut(argv.includes("--json")).fail(e));
}
