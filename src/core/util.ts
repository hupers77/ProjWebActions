import { randomBytes } from "node:crypto";

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export function newRunId(now = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  const d = `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}`;
  const t = `${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}`;
  return `${d}-${t}-${randomBytes(2).toString("hex")}`;
}

/** {{name}} 치환. 값이 없으면 빈 문자열 */
export function renderTemplate(tpl: string, vars: Record<string, string | number | undefined>): string {
  return tpl.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k: string) => {
    const v = vars[k];
    return v === undefined ? "" : String(v);
  });
}

export function pad2(n: number): string {
  return String(n).padStart(2, "0");
}
