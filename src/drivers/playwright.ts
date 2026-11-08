import { mkdirSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { chromium, type Browser, type BrowserContext, type Locator, type Page } from "playwright-core";
import type { AppConfig, Profile, Selector, BrowserType } from "../config/schema.js";
import { chooseBrowserType, resolveLaunchTarget, type BrowserInfo } from "../browsers/registry.js";
import { WebloopError } from "../core/errors.js";
import { sleep } from "../core/util.js";

export interface LaunchOptions {
  workspaceRoot: string;
  dataDir: string;
  config: AppConfig;
  profile: Profile;
  browser?: string;
  executablePath?: string;
  headless?: boolean;
}

export interface Session {
  page: Page;
  context: BrowserContext;
  browserType: BrowserType;
  browserInfo: BrowserInfo;
  close(): Promise<void>;
}

export function userDataDirFor(opts: { dataDir: string; workspaceRoot: string; profile: Profile; browserType: BrowserType }): string {
  const p = opts.profile.browser.userDataDir;
  if (p) {
    const base = isAbsolute(p) ? p : resolve(opts.workspaceRoot, p);
    // 브라우저 종류가 다르면 프로필 데이터 형식이 달라 충돌하므로 브라우저별로 나눈다
    return join(base, opts.browserType);
  }
  return join(opts.dataDir, "browser", opts.profile.name, opts.browserType);
}

export async function launch(opts: LaunchOptions): Promise<Session> {
  const { profile, config } = opts;
  const browserType = chooseBrowserType({ cli: opts.browser, profile: profile.browser.type, config });
  const target = resolveLaunchTarget(browserType, config, opts.executablePath ?? profile.browser.executablePath);
  const headless = opts.headless ?? config.headless ?? profile.browser.headless;
  const args = [...(config.browsers?.[browserType]?.args ?? []), ...profile.browser.args];
  const common = {
    executablePath: target.executablePath,
    channel: target.channel,
    headless,
    args,
  };
  const ctxOpts = {
    viewport: profile.browser.viewport ?? null,
    locale: profile.browser.locale,
    acceptDownloads: true,
  };

  const mode = profile.browser.mode;
  try {
    if (mode === "cdp") {
      const url = profile.browser.cdpUrl ?? "http://127.0.0.1:9222";
      const browser: Browser = await chromium.connectOverCDP(url);
      const context = browser.contexts()[0] ?? (await browser.newContext(ctxOpts));
      const page = await context.newPage();
      return {
        page,
        context,
        browserType,
        browserInfo: target.info,
        close: async () => {
          await page.close().catch(() => {});
          // CDP 모드는 사용자가 띄운 브라우저이므로 닫지 않고 연결만 끊는다
        },
      };
    }
    if (mode === "ephemeral") {
      const browser = await chromium.launch(common);
      const context = await browser.newContext(ctxOpts);
      const page = await context.newPage();
      return { page, context, browserType, browserInfo: target.info, close: () => browser.close() };
    }
    const dir = userDataDirFor({ dataDir: opts.dataDir, workspaceRoot: opts.workspaceRoot, profile, browserType });
    mkdirSync(dir, { recursive: true });
    const context = await chromium.launchPersistentContext(dir, { ...common, ...ctxOpts });
    const page = context.pages()[0] ?? (await context.newPage());
    return { page, context, browserType, browserInfo: target.info, close: () => context.close() };
  } catch (e) {
    if (e instanceof WebloopError) throw e;
    const msg = (e as Error).message ?? String(e);
    if (/ProcessSingleton|SingletonLock|user data directory is already in use|profile.*in use/i.test(msg)) {
      throw new WebloopError("profile_locked", "브라우저 프로필 폴더가 이미 사용 중입니다.", "같은 프로파일로 실행 중인 webloop나 브라우저 창을 닫고 다시 시도하세요.");
    }
    if (mode === "cdp" && /ECONNREFUSED|connect/i.test(msg)) {
      throw new WebloopError(
        "browser_not_found",
        `CDP 접속 실패: ${profile.browser.cdpUrl ?? "http://127.0.0.1:9222"}`,
        "브라우저를 --remote-debugging-port=9222 옵션으로 먼저 실행하세요. (webloop browsers --cdp-help 참고)",
      );
    }
    throw new WebloopError("error", `브라우저 실행 실패 (${target.info.label}): ${msg}`);
  }
}

/** 셀렉터 후보 중 처음으로 페이지에 존재하는 것을 고른다 */
export async function resolveSelector(
  page: Page,
  sel: Selector,
  opts: { timeoutMs: number; state?: "attached" | "visible"; what: string; shouldStop?: () => boolean },
): Promise<{ selector: string; locator: Locator }> {
  const list = Array.isArray(sel) ? sel : [sel];
  const deadline = Date.now() + opts.timeoutMs;
  for (;;) {
    for (const s of list) {
      const loc = page.locator(s);
      const n = await loc.count().catch(() => 0);
      if (n > 0) {
        if (opts.state !== "visible") return { selector: s, locator: loc };
        for (let i = n - 1; i >= 0; i--) {
          if (await loc.nth(i).isVisible().catch(() => false)) return { selector: s, locator: loc };
        }
      }
    }
    if (opts.shouldStop?.()) throw new WebloopError("stopped", "사용자 중지 요청");
    if (Date.now() > deadline) {
      throw new WebloopError("selector_not_found", `${opts.what} 요소를 찾지 못함: ${list.join(" | ")}`, "사이트 구조가 바뀌었을 수 있습니다. `webloop profile test`로 셀렉터를 점검하세요.");
    }
    await sleep(250);
  }
}

/** 존재하는 첫 후보의 개수 (없으면 0) */
export async function countMatches(page: Page, sel: Selector): Promise<number> {
  for (const s of Array.isArray(sel) ? sel : [sel]) {
    const n = await page.locator(s).count().catch(() => 0);
    if (n > 0) return n;
  }
  return 0;
}
