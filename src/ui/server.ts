import { createServer, type IncomingMessage, type ServerResponse, type Server } from "node:http";
import { createReadStream, existsSync, readFileSync, statSync } from "node:fs";
import { dirname, extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { RunStore } from "../store/runStore.js";

const PUBLIC = join(dirname(fileURLToPath(import.meta.url)), "public");
const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
  ".json": "application/json; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".pdf": "application/pdf",
};

function send(res: ServerResponse, code: number, body: unknown, type = "application/json; charset=utf-8") {
  res.writeHead(code, { "content-type": type, "cache-control": "no-store" });
  res.end(typeof body === "string" || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

function sendFile(res: ServerResponse, file: string) {
  if (!existsSync(file) || !statSync(file).isFile()) return send(res, 404, { error: "not found" });
  res.writeHead(200, { "content-type": MIME[extname(file).toLowerCase()] ?? "application/octet-stream", "cache-control": "no-store" });
  createReadStream(file).pipe(res);
}

function iterationDetail(store: RunStore, runId: string, n: number) {
  const evalRaw = store.readIterFile(runId, n, "eval.json");
  const extra = store.readIterFile(runId, n, "extra.json");
  const dir = store.iterDir(runId, n);
  const rel = (name: string) => (existsSync(join(dir, name)) ? `/files/${runId}/iterations/${String(n).padStart(2, "0")}/${name}` : undefined);
  return {
    iteration: n,
    prompt: store.readIterFile(runId, n, "prompt.txt"),
    response: store.readIterFile(runId, n, "response.md") ?? store.readIterFile(runId, n, "response.txt"),
    eval: evalRaw ? JSON.parse(evalRaw) : undefined,
    extra: extra ? JSON.parse(extra) : undefined,
    screenshot: rel("screenshot.png") ?? rel("error.png"),
    live: rel("live.png"),
  };
}

export function createUiServer(opts: { dataDir: string }): Server {
  const store = new RunStore(opts.dataDir);
  return createServer((req: IncomingMessage, res: ServerResponse) => {
    // 로컬 전용: 다른 사이트에서의 요청(CSRF) 차단
    const origin = req.headers.origin;
    if (origin && !/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(origin)) return send(res, 403, { error: "forbidden" });
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const p = decodeURIComponent(url.pathname);
    const m = (re: RegExp) => p.match(re);
    let mm: RegExpMatchArray | null;

    if (req.method === "GET" && p === "/api/health") return send(res, 200, { ok: true, app: "webloop" });
    if (req.method === "GET" && p === "/api/runs") {
      return send(res, 200, store.list().map(({ iterations, ...r }) => ({ ...r, iterationCount: iterations.length })));
    }
    if (req.method === "GET" && (mm = m(/^\/api\/runs\/([\w-]+)$/))) {
      const meta = store.load(mm[1]!);
      if (!meta) return send(res, 404, { error: "not found" });
      return send(res, 200, { ...meta, details: meta.iterations.map((i) => iterationDetail(store, meta.runId, i.iteration)), stopRequested: store.stopRequested(meta.runId) });
    }
    if (req.method === "GET" && (mm = m(/^\/api\/runs\/([\w-]+)\/iterations\/(\d+)$/))) {
      return send(res, 200, iterationDetail(store, mm[1]!, Number(mm[2])));
    }
    if (req.method === "GET" && (mm = m(/^\/api\/runs\/([\w-]+)\/events$/))) {
      const runId = mm[1]!;
      res.writeHead(200, { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-store", connection: "keep-alive" });
      let pos = 0;
      const tick = () => {
        const { events, size } = store.readEvents(runId, pos);
        pos = size;
        for (const ev of events) res.write(`data: ${JSON.stringify(ev)}\n\n`);
      };
      tick();
      const t = setInterval(tick, 700);
      const ka = setInterval(() => res.write(": ka\n\n"), 15000);
      req.on("close", () => { clearInterval(t); clearInterval(ka); });
      return;
    }
    if (req.method === "POST" && (mm = m(/^\/api\/runs\/([\w-]+)\/stop$/))) {
      if (!store.load(mm[1]!)) return send(res, 404, { error: "not found" });
      store.requestStop(mm[1]!);
      return send(res, 200, { ok: true });
    }
    if (req.method === "GET" && (mm = m(/^\/files\/([\w-]+)\/(.+)$/))) {
      const base = resolve(store.runDir(mm[1]!));
      const target = resolve(base, normalize(mm[2]!));
      if (!target.startsWith(base + sep)) return send(res, 403, { error: "forbidden" });
      return sendFile(res, target);
    }
    if (req.method === "GET" && (p === "/app.js" || p === "/style.css")) return sendFile(res, join(PUBLIC, p.slice(1)));
    if (req.method === "GET" && (p === "/" || /^\/runs\/[\w-]+$/.test(p))) {
      return send(res, 200, readFileSync(join(PUBLIC, "index.html"), "utf8"), MIME[".html"]);
    }
    send(res, 404, { error: "not found" });
  });
}

export function startUiServer(opts: { dataDir: string; port: number }): Promise<Server> {
  const server = createUiServer(opts);
  return new Promise((res, rej) => {
    server.once("error", rej);
    server.listen(opts.port, "127.0.0.1", () => res(server));
  });
}

export async function isUiRunning(port: number): Promise<boolean> {
  try {
    const r = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(800) });
    return r.ok;
  } catch {
    return false;
  }
}
