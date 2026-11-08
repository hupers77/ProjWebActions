import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { pad2 } from "../core/util.js";

export type RunStatus = "queued" | "running" | "evaluating" | "retrying" | "succeeded" | "failed" | "stopped";

export interface IterationMeta {
  iteration: number;
  status: "ok" | "timeout" | "error";
  startedAt: string;
  endedAt?: string;
  elapsedMs?: number;
  chars?: number;
  passed?: boolean;
  score?: number;
  reasons?: string[];
  error?: string;
  files?: string[];
}

export interface RunMeta {
  runId: string;
  kind: "run" | "send";
  profile: string;
  goal?: string;
  browser?: string;
  status: RunStatus;
  createdAt: string;
  startedAt?: string;
  endedAt?: string;
  pid?: number;
  maxIterations: number;
  currentIteration: number;
  iterations: IterationMeta[];
  best?: { iteration: number; score: number };
  exitCode?: number;
  error?: { kind: string; message: string; hint?: string };
  outputFile?: string;
}

export interface RunEvent {
  ts: string;
  type: string;
  [k: string]: unknown;
}

export class RunStore {
  constructor(readonly dataDir: string) {}

  get runsDir(): string {
    return join(this.dataDir, "runs");
  }
  runDir(runId: string): string {
    return join(this.runsDir, runId);
  }
  iterDir(runId: string, n: number): string {
    return join(this.runDir(runId), "iterations", pad2(n));
  }

  create(meta: RunMeta): void {
    mkdirSync(this.runDir(meta.runId), { recursive: true });
    this.save(meta);
  }

  save(meta: RunMeta): void {
    const file = join(this.runDir(meta.runId), "run.json");
    writeFileSync(file + ".tmp", JSON.stringify(meta, null, 2), "utf8");
    // Windows에서 rename 덮어쓰기가 막히는 경우가 있어 직접 쓰기로 대체
    try {
      writeFileSync(file, readFileSync(file + ".tmp"));
    } finally {
      rmSync(file + ".tmp", { force: true });
    }
  }

  load(runId: string): RunMeta | undefined {
    const file = join(this.runDir(runId), "run.json");
    if (!existsSync(file)) return undefined;
    try {
      return JSON.parse(readFileSync(file, "utf8")) as RunMeta;
    } catch {
      return undefined;
    }
  }

  list(): RunMeta[] {
    if (!existsSync(this.runsDir)) return [];
    return readdirSync(this.runsDir)
      .map((id) => this.load(id))
      .filter((m): m is RunMeta => !!m)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  /** runId 일부나 'last'로도 찾기 */
  resolveId(idOrPrefix: string): string | undefined {
    if (idOrPrefix === "last" || idOrPrefix === "latest") return this.list()[0]?.runId;
    if (existsSync(join(this.runDir(idOrPrefix), "run.json"))) return idOrPrefix;
    const hits = this.list().filter((m) => m.runId.startsWith(idOrPrefix) || m.runId.endsWith(idOrPrefix));
    return hits.length === 1 ? hits[0]!.runId : undefined;
  }

  event(runId: string, type: string, data: Record<string, unknown> = {}): RunEvent {
    const ev: RunEvent = { ts: new Date().toISOString(), type, ...data };
    appendFileSync(join(this.runDir(runId), "events.jsonl"), JSON.stringify(ev) + "\n", "utf8");
    return ev;
  }

  readEvents(runId: string, fromByte = 0): { events: RunEvent[]; size: number } {
    const file = join(this.runDir(runId), "events.jsonl");
    if (!existsSync(file)) return { events: [], size: 0 };
    const buf = readFileSync(file);
    const chunk = buf.subarray(fromByte).toString("utf8");
    const lastNl = chunk.lastIndexOf("\n");
    if (lastNl === -1) return { events: [], size: fromByte };
    const events = chunk
      .slice(0, lastNl)
      .split("\n")
      .filter(Boolean)
      .map((l) => {
        try { return JSON.parse(l) as RunEvent; } catch { return undefined; }
      })
      .filter((e): e is RunEvent => !!e);
    return { events, size: fromByte + Buffer.byteLength(chunk.slice(0, lastNl + 1), "utf8") };
  }

  requestStop(runId: string): void {
    writeFileSync(join(this.runDir(runId), "stop.flag"), new Date().toISOString(), "utf8");
  }
  stopRequested(runId: string): boolean {
    return existsSync(join(this.runDir(runId), "stop.flag"));
  }

  writeIterFile(runId: string, n: number, name: string, content: string | Buffer): string {
    const dir = this.iterDir(runId, n);
    mkdirSync(dir, { recursive: true });
    const p = join(dir, name);
    writeFileSync(p, content, typeof content === "string" ? "utf8" : undefined);
    return p;
  }
  readIterFile(runId: string, n: number, name: string): string | undefined {
    const p = join(this.iterDir(runId, n), name);
    return existsSync(p) ? readFileSync(p, "utf8") : undefined;
  }
}
