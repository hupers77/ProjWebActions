import { describe, it, expect } from "vitest";
import { join } from "node:path";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { loadWorkspace, loadProfile, loadGoal, PACKAGE_ROOT } from "../../src/config/load.js";
import { refine } from "../../src/refine/refiner.js";
import { Goal } from "../../src/config/schema.js";
import { candidatePaths, chooseBrowserType } from "../../src/browsers/registry.js";

describe("config", () => {
  it("번들 프로파일(perplexity, mock-chat)이 스키마를 통과", () => {
    const ws = loadWorkspace(PACKAGE_ROOT);
    expect(loadProfile(ws, "perplexity").profile.url).toBe("https://www.perplexity.ai/");
    expect(loadProfile(ws, "mock-chat").profile.session).toBe("continue");
    expect(loadGoal(ws, "mock-outline").goal.maxIterations).toBe(5);
  });
  it("webloop.local.yaml이 webloop.config.yaml을 덮어쓴다 (PC별 브라우저)", () => {
    const dir = mkdtempSync(join(tmpdir(), "wl-"));
    writeFileSync(join(dir, "webloop.config.yaml"), "browser: edge\nui:\n  port: 5000\n");
    writeFileSync(join(dir, "webloop.local.yaml"), "﻿browser: whale\n");
    mkdirSync(join(dir, "sub"));
    const ws = loadWorkspace(join(dir, "sub"));
    expect(ws.root).toBe(dir);
    expect(ws.config.browser).toBe("whale");
    expect(ws.config.ui.port).toBe(5000);
  });
  it("대기 전략·평가 기준이 키 이름대로 해석된다 (다른 종류로 오인 금지)", () => {
    const ws = loadWorkspace(PACKAGE_ROOT);
    const { profile } = loadProfile(ws, "perplexity");
    expect(Object.keys(profile.wait.all[0]!)).toEqual(["new_element"]);
    expect(Object.keys(profile.wait.all[1]!)).toEqual(["selector_hidden"]);
    const g = Goal.parse({ criteria: [{ file_exists: { ext: ".txt" } }, { json_valid: {} }] });
    expect(Object.keys(g.criteria[0]!)).toEqual(["file_exists"]);
    expect(Object.keys(g.criteria[1]!)).toEqual(["json_valid"]);
    expect(() => Goal.parse({ criteria: [{ contain: "오타" }] })).toThrow();
  });
  it("잘못된 프로파일은 읽기 쉬운 오류", () => {
    const dir = mkdtempSync(join(tmpdir(), "wl-"));
    mkdirSync(join(dir, "profiles"));
    writeFileSync(join(dir, "profiles", "bad.yaml"), "name: bad\nurl: not-a-url\n");
    const ws = loadWorkspace(dir);
    expect(() => loadProfile(ws, "bad")).toThrow(/설정 검증 실패[\s\S]*url/);
  });
});

describe("browsers", () => {
  it("OS별 후보 경로", () => {
    expect(candidatePaths("whale", "darwin")[0]).toBe("/Applications/Whale.app/Contents/MacOS/Whale");
    expect(candidatePaths("edge", "win32").some((p) => p.endsWith("Microsoft\\Edge\\Application\\msedge.exe"))).toBe(true);
    expect(candidatePaths("whale", "win32").some((p) => p.endsWith("Naver\\Naver Whale\\Application\\whale.exe"))).toBe(true);
  });
  it("우선순위: CLI > 환경변수 > 프로파일 > 설정, 별칭 허용", () => {
    const config = { browser: "chrome" } as any;
    const prev = process.env.WEBLOOP_BROWSER;
    delete process.env.WEBLOOP_BROWSER;
    expect(chooseBrowserType({ config })).toBe("chrome");
    expect(chooseBrowserType({ config, profile: "whale" })).toBe("whale");
    process.env.WEBLOOP_BROWSER = "msedge";
    expect(chooseBrowserType({ config, profile: "whale" })).toBe("edge");
    expect(chooseBrowserType({ config, cli: "naver-whale" })).toBe("whale");
    expect(() => chooseBrowserType({ config, cli: "firefox" })).toThrow();
    if (prev === undefined) delete process.env.WEBLOOP_BROWSER; else process.env.WEBLOOP_BROWSER = prev;
  });
});

describe("refine", () => {
  const input = { iteration: 1, goalPrompt: "목차", lastPrompt: "목차", lastResponse: "r", reasons: ["'a' 미포함"] };
  it("template", async () => {
    const g = Goal.parse({ refine: { strategy: "template", template: "{{reasons}} / {{goal_prompt}}" } });
    expect(await refine(g, input)).toEqual({ kind: "prompt", prompt: "'a' 미포함 / 목차" });
  });
  it("fixed: 후보 소진", async () => {
    const g = Goal.parse({ refine: { strategy: "fixed", prompts: ["두번째"] } });
    expect(await refine(g, input)).toEqual({ kind: "prompt", prompt: "두번째" });
    expect(await refine(g, { ...input, iteration: 2 })).toEqual({ kind: "exhausted" });
  });
});
