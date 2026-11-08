import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { startMockSite } from "../mock-site/server.js";
import { detectAll } from "../../src/browsers/registry.js";

/**
 * 빌드된 CLI(dist)를 실제로 실행해 목업 사이트에 대고 검증한다.
 * 브라우저: WEBLOOP_TEST_BROWSER(기본: 설치된 것 중 chromium > chrome > edge > whale)
 * 예) macOS + Whale:  WEBLOOP_TEST_BROWSER=whale npm run test:e2e
 */
const ROOT = resolve(__dirname, "../..");
const CLI = join(ROOT, "dist/cli/index.js");
const found = detectAll().filter((b) => b.found).map((b) => b.type);
const browser = process.env.WEBLOOP_TEST_BROWSER ?? ["chromium", "chrome", "edge", "whale"].find((b) => found.includes(b as any));
const headed = process.env.WEBLOOP_TEST_HEADED === "1";

let mock: Awaited<ReturnType<typeof startMockSite>>;
let ws: string;

// 목업 사이트가 이 프로세스 안에서 돌기 때문에 spawnSync(이벤트 루프 차단)를 쓰면 안 된다
function cli(args: string[], timeout = 90000): Promise<{ code: number | null; json: any; stdout: string; stderr: string }> {
  return new Promise((resolveP) => {
    const child = spawn(process.execPath, [CLI, "--json", "--browser", browser!, ...(headed ? ["--headed"] : ["--headless"]), ...args], { cwd: ws });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (d) => (stdout += d));
    child.stderr.setEncoding("utf8").on("data", (d) => (stderr += d));
    const t = setTimeout(() => child.kill(), timeout);
    child.on("close", (code) => {
      clearTimeout(t);
      let json: any;
      try { json = JSON.parse(stdout); } catch { /* */ }
      resolveP({ code, json, stdout, stderr });
    });
  });
}

describe.skipIf(!browser || !existsSync(CLI))(`e2e (${browser})`, () => {
  beforeAll(async () => {
    mock = await startMockSite();
    ws = mkdtempSync(join(tmpdir(), "webloop-e2e-"));
    mkdirSync(join(ws, "profiles"));
    mkdirSync(join(ws, "goals"));
    writeFileSync(join(ws, "webloop.config.yaml"), "browser: chromium\nui:\n  port: 4799\n");
    const prof = readFileSync(join(ROOT, "profiles/mock-chat.yaml"), "utf8").replace("http://127.0.0.1:4780/", mock.url + "/");
    writeFileSync(join(ws, "profiles/mock-chat.yaml"), prof);
    writeFileSync(join(ws, "profiles/mock-ce.yaml"), prof.replace("name: mock-chat", "name: mock-ce").replace(mock.url + "/", mock.url + "/ce").replace('"textarea#prompt"', '"#ask-input"').replace("method: fill", "method: insert"));
    writeFileSync(join(ws, "profiles/mock-login.yaml"), prof.replace("name: mock-chat", "name: mock-login").replace(mock.url + "/", mock.url + "/needs-login"));
    writeFileSync(join(ws, "profiles/mock-dl.yaml"), prof.replace("name: mock-chat", "name: mock-dl").replace(mock.url + "/", mock.url + "/download").replace("extract:\n", 'extract:\n  download:\n    click: "a.download"\n'));
    writeFileSync(join(ws, "goals/outline.yaml"), readFileSync(join(ROOT, "goals/mock-outline.yaml"), "utf8"));
    writeFileSync(join(ws, "goals/never.yaml"), 'prompt: "목차"\nmaxIterations: 2\ncriteria:\n  - contains: "절대없는단어"\n');
    writeFileSync(join(ws, "goals/file.yaml"), 'prompt: "목차"\nmaxIterations: 1\ncriteria:\n  - file_exists: { ext: ".txt" }\n');
  });
  afterAll(async () => { await mock?.close(); });

  it("send: 1회 전송 후 응답 수집 (exit 0)", async () => {
    const r = await cli(["send", "-p", "mock-chat", "--prompt", "echo:안녕 webloop"]);
    expect(r.code, r.stderr).toBe(0);
    expect(r.json.status).toBe("succeeded");
    expect(r.json.responseText).toBe("안녕 webloop");
    expect(r.json.extra.sources[0]).toContain("example.com/src1");
  });

  it("send: contenteditable 입력창 + 여러 줄 (Perplexity 형태)", async () => {
    const r = await cli(["send", "-p", "mock-ce", "--prompt", "echo:첫 줄\n둘째 줄"]);
    expect(r.code, r.stderr).toBe(0);
    expect(r.json.responseText).toContain("첫 줄");
    expect(r.json.responseText).toContain("둘째 줄");
  });

  it("run: 3번째 시도에서 목표 달성 → exit 0", async () => {
    const r = await cli(["run", "-p", "mock-chat", "-g", "outline"]);
    expect(r.code, r.stderr).toBe(0);
    expect(r.json.iterations).toBe(3);
    expect(r.json.best.iteration).toBe(3);
    expect(readFileSync(join(ws, "out/mock-outline.md"), "utf8")).toContain("장단점");
  });

  it("run: 끝내 미달 → exit 2", async () => {
    const r = await cli(["run", "-p", "mock-chat", "-g", "never"]);
    expect(r.code).toBe(2);
    expect(r.json.status).toBe("failed");
    expect(r.json.reasons[0]).toContain("절대없는단어");
  });

  it("다운로드 수집 + file_exists 평가", async () => {
    const r = await cli(["run", "-p", "mock-dl", "-g", "file"]);
    expect(r.code, r.stderr).toBe(0);
    expect(r.json.files[0]).toMatch(/result-1\.txt$/);
  });

  it("로그인 페이지로 튕기면 exit 3", async () => {
    const r = await cli(["send", "-p", "mock-login", "--prompt", "x"]);
    expect(r.code).toBe(3);
    expect(r.json.error.kind).toBe("needs_human");
  });

  it("list / status / result / eval", async () => {
    const list = await cli(["list"]);
    expect(list.json.runs.length).toBeGreaterThan(0);
    const st = await cli(["status", "last"]);
    expect(st.code).toBe(0);
    const res = await cli(["result", "last"]);
    expect(res.code).toBe(0);
    const run = list.json.runs.find((x: any) => x.kind === "run" && x.status === "succeeded" && x.profile === "mock-chat");
    const ev = await cli(["eval", run.runId, "-g", "outline"]);
    expect(ev.json.results.at(-1).passed).toBe(true);
  });

  it("stop: --detach 실행을 중지하면 stopped(130)", async () => {
    const d = await cli(["run", "-p", "mock-chat", "-g", "never", "--detach"]);
    expect(d.json.detached).toBe(true);
    const runId = d.json.runId;
    await new Promise((r) => setTimeout(r, 2500));
    await cli(["stop", runId]);
    let st: any;
    for (let i = 0; i < 60; i++) {
      st = (await cli(["status", runId])).json;
      if (["stopped", "failed", "succeeded"].includes(st.status)) break;
      await new Promise((r) => setTimeout(r, 500));
    }
    expect(st.status).toBe("stopped");
    expect(st.exitCode).toBe(130);
  });

  it("ui: API와 화면 응답", async () => {
    const child = spawn(process.execPath, [CLI, "ui", "--port", "4799"], { cwd: ws, stdio: "ignore" });
    try {
      let runs: any;
      for (let i = 0; i < 30; i++) {
        try { runs = await (await fetch("http://127.0.0.1:4799/api/runs")).json(); break; } catch { await new Promise((r) => setTimeout(r, 200)); }
      }
      expect(runs.length).toBeGreaterThan(0);
      const detail = await (await fetch(`http://127.0.0.1:4799/api/runs/${runs[0].runId}`)).json();
      expect(detail.details).toBeDefined();
      const html = await (await fetch(`http://127.0.0.1:4799/runs/${runs[0].runId}`)).text();
      expect(html).toContain("webloop");
      const bad = await fetch(`http://127.0.0.1:4799/files/${runs[0].runId}/..%2F..%2Fwebloop.config.yaml`);
      expect(bad.status).not.toBe(200);
    } finally {
      child.kill();
    }
  });
});
