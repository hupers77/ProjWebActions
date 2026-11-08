import type { Page } from "playwright-core";
import type { Profile } from "../config/schema.js";
import { WebloopError } from "./errors.js";

const arr = (v: string | string[] | undefined) => (v === undefined ? [] : Array.isArray(v) ? v : [v]);

/** 로그인 풀림·CAPTCHA 등 사람 개입이 필요한 상태 감지 → exit 3. 우회하지 않는다. */
export async function checkAuth(page: Page, profile: Profile): Promise<void> {
  const a = profile.authCheck;
  if (!a) return;
  const url = page.url();
  for (const u of arr(a.urlContains)) {
    if (url.includes(u)) throw new WebloopError("needs_human", `사람 개입 필요: URL에 '${u}' 포함 (${url})`, `\`webloop login ${profile.name}\`으로 브라우저를 열어 직접 처리한 뒤 다시 실행하세요.`);
  }
  if (a.titleContains) {
    const title = await page.title().catch(() => "");
    for (const t of arr(a.titleContains)) {
      if (title.includes(t)) throw new WebloopError("needs_human", `사람 개입 필요: 페이지 제목 '${title}'`, `\`webloop login ${profile.name}\`으로 브라우저를 열어 직접 확인(로그인/보안 확인)한 뒤 다시 실행하세요.`);
    }
  }
  if (a.selectorVisible) {
    for (const s of Array.isArray(a.selectorVisible) ? a.selectorVisible : [a.selectorVisible]) {
      if (await page.locator(s).first().isVisible().catch(() => false)) {
        throw new WebloopError("needs_human", `사람 개입 필요: '${s}' 요소가 보임`, `\`webloop login ${profile.name}\`으로 직접 처리한 뒤 다시 실행하세요.`);
      }
    }
  }
}
