import { mkdirSync } from "node:fs";
import { extname, join } from "node:path";
import type { Locator, Page } from "playwright-core";
import type { Profile, Selector } from "../config/schema.js";
import { resolveSelector } from "../drivers/playwright.js";
import { renderTemplate } from "../core/util.js";

export interface Extracted {
  text: string;
  html: string;
  format: "text" | "markdown" | "html";
  /** format에 맞춘 본문 */
  body: string;
  extra: Record<string, string[]>;
  files: string[];
}

/** 브라우저 안에서 실행되는 간단한 HTML → Markdown 변환기 */
function htmlToMarkdownInPage(root: Element): string {
  const walk = (node: Node, ctx: { list?: "ul" | "ol"; idx?: number; depth: number }): string => {
    if (node.nodeType === Node.TEXT_NODE) return (node.textContent ?? "").replace(/\s+/g, " ");
    if (node.nodeType !== Node.ELEMENT_NODE) return "";
    const el = node as HTMLElement;
    const tag = el.tagName.toLowerCase();
    if (["script", "style", "svg", "button", "noscript"].includes(tag)) return "";
    const kids = (c = ctx) => Array.from(el.childNodes).map((n) => walk(n, c)).join("");
    switch (tag) {
      case "h1": case "h2": case "h3": case "h4": case "h5": case "h6":
        return `\n\n${"#".repeat(Number(tag[1]))} ${kids().trim()}\n\n`;
      case "p": return `\n\n${kids().trim()}\n\n`;
      case "br": return "\n";
      case "hr": return "\n\n---\n\n";
      case "strong": case "b": { const t = kids().trim(); return t ? `**${t}**` : ""; }
      case "em": case "i": { const t = kids().trim(); return t ? `*${t}*` : ""; }
      case "code": return el.closest("pre") ? (el.textContent ?? "") : `\`${el.textContent ?? ""}\``;
      case "pre": {
        const code = el.querySelector("code");
        const lang = (code?.className.match(/language-([\w-]+)/) ?? [])[1] ?? "";
        return `\n\n\`\`\`${lang}\n${(el.textContent ?? "").replace(/\n$/, "")}\n\`\`\`\n\n`;
      }
      case "a": {
        const t = kids().trim();
        const href = el.getAttribute("href");
        return href && t && !href.startsWith("javascript:") ? `[${t}](${(el as HTMLAnchorElement).href})` : t;
      }
      case "ul": case "ol": {
        let i = 0;
        const items = Array.from(el.children).map((li) => {
          i++;
          const inner = walk(li, { list: tag as "ul" | "ol", idx: i, depth: ctx.depth + 1 }).trim();
          const indent = "  ".repeat(ctx.depth);
          return `${indent}${tag === "ol" ? `${i}.` : "-"} ${inner}`;
        });
        return `\n${items.join("\n")}\n`;
      }
      case "li": return kids();
      case "blockquote": return `\n\n${kids().trim().split("\n").map((l) => "> " + l).join("\n")}\n\n`;
      case "table": {
        const rows = Array.from(el.querySelectorAll("tr")).map((tr) =>
          Array.from(tr.querySelectorAll("th,td")).map((c) => (c.textContent ?? "").trim().replace(/\|/g, "\\|")),
        );
        if (!rows.length) return "";
        const w = Math.max(...rows.map((r) => r.length));
        const line = (r: string[]) => `| ${Array.from({ length: w }, (_, k) => r[k] ?? "").join(" | ")} |`;
        return `\n\n${line(rows[0]!)}\n| ${Array.from({ length: w }, () => "---").join(" | ")} |\n${rows.slice(1).map(line).join("\n")}\n\n`;
      }
      default: return kids();
    }
  };
  return walk(root, { depth: 0 }).replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

async function pick(loc: Locator, mode: "last" | "first" | "all"): Promise<Locator[]> {
  const n = await loc.count();
  if (n === 0) return [];
  if (mode === "first") return [loc.nth(0)];
  if (mode === "last") return [loc.nth(n - 1)];
  return Array.from({ length: n }, (_, i) => loc.nth(i));
}

export async function extract(page: Page, profile: Profile, ctx: { iteration: number; dir: string; timeoutMs?: number }): Promise<Extracted> {
  const ex = profile.extract;
  const { locator } = await resolveSelector(page, ex.text, { timeoutMs: ctx.timeoutMs ?? 10000, what: "응답(extract.text)" });
  const els = await pick(locator, ex.pick);
  const texts: string[] = [];
  const htmls: string[] = [];
  const mds: string[] = [];
  for (const el of els) {
    texts.push((await el.innerText()).trim());
    htmls.push(await el.evaluate((e) => (e as HTMLElement).outerHTML));
    if (ex.format === "markdown") {
      mds.push(await el.evaluate(htmlToMarkdownInPage as (e: Element) => string));
    }
  }
  const sep = "\n\n---\n\n";
  const text = texts.join(sep);
  const html = htmls.join("\n");
  const body = ex.format === "markdown" ? mds.join(sep) : ex.format === "html" ? html : text;

  const extra: Record<string, string[]> = {};
  for (const [key, sel] of Object.entries(ex.extra ?? {})) {
    extra[key] = await collectAll(page, sel);
  }

  const files: string[] = [];
  if (ex.download) {
    const dlDir = join(ctx.dir, "downloads");
    mkdirSync(dlDir, { recursive: true });
    const { locator: btn } = await resolveSelector(page, ex.download.click, { timeoutMs: 10000, what: "다운로드 버튼", state: "visible" });
    const [dl] = await Promise.all([page.waitForEvent("download", { timeout: ex.download.timeoutMs }), btn.last().click()]);
    const suggested = dl.suggestedFilename();
    const name = renderTemplate(ex.download.saveAs, { iteration: ctx.iteration, ext: extname(suggested), name: suggested });
    const target = join(dlDir, name);
    await dl.saveAs(target);
    files.push(target);
  }
  return { text, html, body, format: ex.format, extra, files };
}

async function collectAll(page: Page, sel: Selector): Promise<string[]> {
  for (const s of Array.isArray(sel) ? sel : [sel]) {
    const loc = page.locator(s);
    const n = await loc.count().catch(() => 0);
    if (!n) continue;
    const out: string[] = [];
    for (let i = 0; i < n; i++) {
      const el = loc.nth(i);
      const href = await el.getAttribute("href").catch(() => null);
      const t = ((await el.innerText().catch(() => "")) ?? "").trim().replace(/\s+/g, " ");
      out.push(href ? `${t} <${href}>` : t);
    }
    return out;
  }
  return [];
}
