import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, isAbsolute, join, resolve, extname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import YAML from "yaml";
import { z } from "zod";
import { AppConfig, Goal, Profile } from "./schema.js";
import { WebloopError } from "../core/errors.js";

export const CONFIG_FILE = "webloop.config.yaml";
export const LOCAL_CONFIG_FILE = "webloop.local.yaml";

/** 패키지 루트 (번들된 예시 profiles/goals 위치) */
export const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

export interface Workspace {
  root: string;
  config: AppConfig;
  configFiles: string[];
  dataDir: string;
  profilesDir: string;
  goalsDir: string;
}

function findRoot(start: string): string {
  let dir = resolve(start);
  for (;;) {
    if (existsSync(join(dir, CONFIG_FILE))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return resolve(start);
    dir = parent;
  }
}

function readYaml(file: string): unknown {
  // BOM 제거 (Windows 메모장 저장 파일 대응)
  const text = readFileSync(file, "utf8").replace(/^﻿/, "");
  try {
    return YAML.parse(text) ?? {};
  } catch (e) {
    throw new WebloopError("config", `YAML 파싱 실패: ${file}: ${(e as Error).message}`);
  }
}

function deepMerge(a: any, b: any): any {
  if (Array.isArray(a) || Array.isArray(b) || typeof a !== "object" || typeof b !== "object" || !a || !b) return b ?? a;
  const out: any = { ...a };
  for (const k of Object.keys(b)) out[k] = deepMerge(a[k], b[k]);
  return out;
}

export function formatZodError(err: z.ZodError, file: string): string {
  const lines = err.issues.map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`);
  return `설정 검증 실패: ${file}\n${lines.join("\n")}`;
}

export function loadWorkspace(cwd = process.cwd()): Workspace {
  const root = findRoot(cwd);
  const files: string[] = [];
  let raw: any = {};
  for (const f of [CONFIG_FILE, LOCAL_CONFIG_FILE]) {
    const p = join(root, f);
    if (existsSync(p)) {
      raw = deepMerge(raw, readYaml(p));
      files.push(p);
    }
  }
  const parsed = AppConfig.safeParse(raw);
  if (!parsed.success) throw new WebloopError("config", formatZodError(parsed.error, files.join(", ") || CONFIG_FILE));
  const config = parsed.data;
  const abs = (p: string) => (isAbsolute(p) ? p : resolve(root, p));
  return {
    root,
    config,
    configFiles: files,
    dataDir: abs(config.dataDir),
    profilesDir: abs(config.profilesDir),
    goalsDir: abs(config.goalsDir),
  };
}

function resolveNamed(nameOrPath: string, dirs: string[], kind: string): string {
  const candidates: string[] = [];
  if (extname(nameOrPath) === ".yaml" || extname(nameOrPath) === ".yml" || nameOrPath.includes("/") || nameOrPath.includes("\\")) {
    candidates.push(resolve(nameOrPath));
  }
  for (const d of dirs) {
    candidates.push(join(d, `${nameOrPath}.yaml`), join(d, `${nameOrPath}.yml`));
  }
  const hit = candidates.find((c) => existsSync(c));
  if (!hit) {
    throw new WebloopError("config", `${kind}을(를) 찾을 수 없음: ${nameOrPath}`, `찾아본 위치:\n${candidates.map((c) => "  " + c).join("\n")}`);
  }
  return hit;
}

export function loadProfile(ws: Workspace, nameOrPath: string): { profile: Profile; file: string } {
  const file = resolveNamed(nameOrPath, [ws.profilesDir, join(PACKAGE_ROOT, "profiles")], "프로파일");
  const parsed = Profile.safeParse(readYaml(file));
  if (!parsed.success) throw new WebloopError("config", formatZodError(parsed.error, file));
  return { profile: parsed.data, file };
}

export function loadGoal(ws: Workspace, nameOrPath: string): { goal: Goal; file: string } {
  const file = resolveNamed(nameOrPath, [ws.goalsDir, join(PACKAGE_ROOT, "goals")], "목표 파일");
  const parsed = Goal.safeParse(readYaml(file));
  if (!parsed.success) throw new WebloopError("config", formatZodError(parsed.error, file));
  const goal = parsed.data;
  if (goal.promptFile && !goal.prompt) {
    const pf = isAbsolute(goal.promptFile) ? goal.promptFile : resolve(dirname(file), goal.promptFile);
    goal.prompt = readFileSync(pf, "utf8").replace(/^﻿/, "");
  }
  return { goal, file };
}

export function listProfiles(ws: Workspace): { name: string; file: string; bundled: boolean }[] {
  const out: { name: string; file: string; bundled: boolean }[] = [];
  const seen = new Set<string>();
  for (const [dir, bundled] of [[ws.profilesDir, false], [join(PACKAGE_ROOT, "profiles"), true]] as const) {
    if (!existsSync(dir)) continue;
    for (const f of readdirSync(dir)) {
      if (!/\.ya?ml$/.test(f)) continue;
      const name = basename(f, extname(f));
      if (seen.has(name)) continue;
      seen.add(name);
      out.push({ name, file: join(dir, f), bundled: bundled && resolve(dir) !== resolve(ws.profilesDir) });
    }
  }
  return out;
}
