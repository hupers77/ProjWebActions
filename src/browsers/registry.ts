import { existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type { AppConfig, BrowserType } from "../config/schema.js";
import { WebloopError } from "../core/errors.js";

/**
 * 설치된 Chromium 계열 브라우저 찾기.
 * Playwright는 Edge/Chrome은 channel로 띄울 수 있지만 Whale은 channel이 없으므로
 * 모든 브라우저를 executablePath 방식으로 통일한다.
 */
export interface BrowserInfo {
  type: BrowserType;
  label: string;
  executablePath?: string;
  found: boolean;
  candidates: string[];
  /** 경로를 못 찾았을 때 Playwright channel로 시도 가능한 경우 */
  channel?: string;
  source: "config" | "env" | "auto" | "channel" | "none";
}

const LABELS: Record<BrowserType, string> = {
  edge: "Microsoft Edge",
  chrome: "Google Chrome",
  whale: "NAVER Whale",
  chromium: "Chromium",
  custom: "사용자 지정",
};

const CHANNEL: Partial<Record<BrowserType, string>> = { edge: "msedge", chrome: "chrome", chromium: "chromium" };

function winDirs(): string[] {
  const env = process.env;
  return [env["ProgramFiles"], env["ProgramFiles(x86)"], env["LOCALAPPDATA"]].filter(Boolean) as string[];
}

export function candidatePaths(type: BrowserType, platform: NodeJS.Platform = process.platform): string[] {
  const home = homedir();
  if (platform === "win32") {
    const rel: Record<BrowserType, string[]> = {
      edge: ["Microsoft\\Edge\\Application\\msedge.exe"],
      chrome: ["Google\\Chrome\\Application\\chrome.exe"],
      whale: ["Naver\\Naver Whale\\Application\\whale.exe"],
      chromium: ["Chromium\\Application\\chrome.exe"],
      custom: [],
    };
    const dirs = winDirs();
    if (!dirs.length) dirs.push("C:\\Program Files", "C:\\Program Files (x86)", join(home, "AppData", "Local"));
    return dirs.flatMap((d) => rel[type].map((r) => `${d}\\${r}`));
  }
  if (platform === "darwin") {
    const apps: Record<BrowserType, string[]> = {
      edge: ["Microsoft Edge.app/Contents/MacOS/Microsoft Edge"],
      chrome: ["Google Chrome.app/Contents/MacOS/Google Chrome"],
      whale: ["Whale.app/Contents/MacOS/Whale", "Naver Whale.app/Contents/MacOS/Naver Whale"],
      chromium: ["Chromium.app/Contents/MacOS/Chromium"],
      custom: [],
    };
    return ["/Applications", join(home, "Applications")].flatMap((d) => apps[type].map((a) => `${d}/${a}`));
  }
  const linux: Record<BrowserType, string[]> = {
    edge: ["/usr/bin/microsoft-edge", "/usr/bin/microsoft-edge-stable", "/opt/microsoft/msedge/msedge"],
    chrome: ["/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/opt/google/chrome/chrome"],
    whale: ["/usr/bin/naver-whale", "/usr/bin/naver-whale-stable", "/opt/naver/whale/whale"],
    chromium: ["/usr/bin/chromium", "/usr/bin/chromium-browser"],
    custom: [],
  };
  return linux[type];
}

const ENV_PATH: Record<BrowserType, string> = {
  edge: "WEBLOOP_EDGE_PATH",
  chrome: "WEBLOOP_CHROME_PATH",
  whale: "WEBLOOP_WHALE_PATH",
  chromium: "WEBLOOP_CHROMIUM_PATH",
  custom: "WEBLOOP_BROWSER_PATH",
};

export function detectBrowser(type: BrowserType, config?: AppConfig, explicitPath?: string): BrowserInfo {
  const candidates = candidatePaths(type);
  const base = { type, label: LABELS[type], candidates };
  if (explicitPath) return { ...base, executablePath: explicitPath, found: existsSync(explicitPath), source: "config" };
  const envPath = process.env[ENV_PATH[type]];
  if (envPath) return { ...base, executablePath: envPath, found: existsSync(envPath), source: "env" };
  const cfgPath = config?.browsers?.[type]?.executablePath;
  if (cfgPath) return { ...base, executablePath: cfgPath, found: existsSync(cfgPath), source: "config" };
  const hit = candidates.find((c) => existsSync(c));
  if (hit) return { ...base, executablePath: hit, found: true, source: "auto" };
  return { ...base, found: false, channel: CHANNEL[type], source: "none" };
}

export function detectAll(config?: AppConfig): BrowserInfo[] {
  return (["edge", "chrome", "whale", "chromium"] as BrowserType[]).map((t) => detectBrowser(t, config));
}

/** 실제로 띄울 브라우저 결정. 우선순위: CLI --browser > 환경변수 WEBLOOP_BROWSER > 프로파일 browser.type > config.browser */
export function chooseBrowserType(opts: { cli?: string; profile?: BrowserType; config: AppConfig }): BrowserType {
  const raw = opts.cli || process.env["WEBLOOP_BROWSER"] || opts.profile || opts.config.browser;
  const v = String(raw).toLowerCase();
  const alias: Record<string, BrowserType> = { msedge: "edge", "microsoft-edge": "edge", "google-chrome": "chrome", naver: "whale", "naver-whale": "whale" };
  const t = (alias[v] ?? v) as BrowserType;
  if (!["edge", "chrome", "whale", "chromium", "custom"].includes(t)) {
    throw new WebloopError("config", `알 수 없는 브라우저: ${raw}`, "edge | chrome | whale | chromium | custom 중 하나를 쓰세요.");
  }
  return t;
}

export function resolveLaunchTarget(type: BrowserType, config: AppConfig, explicitPath?: string): { executablePath?: string; channel?: string; info: BrowserInfo } {
  const info = detectBrowser(type, config, explicitPath);
  if (info.executablePath && info.found) return { executablePath: info.executablePath, info };
  if (info.executablePath && !info.found) {
    throw new WebloopError("browser_not_found", `${info.label} 실행 파일이 없음: ${info.executablePath}`, "경로를 확인하거나 webloop.local.yaml의 browsers.<이름>.executablePath를 고치세요.");
  }
  if (info.channel && type !== "chromium") return { channel: info.channel, info };
  throw new WebloopError(
    "browser_not_found",
    `${info.label}을(를) 찾지 못했습니다.`,
    `찾아본 위치:\n${info.candidates.map((c) => "  " + c).join("\n")}\n설치 경로가 다르면 webloop.local.yaml에\n  browsers:\n    ${type}:\n      executablePath: "<경로>"\n를 추가하거나 환경변수 ${ENV_PATH[type]}를 설정하세요.`,
  );
}
