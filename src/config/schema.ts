import { z } from "zod";

export const BROWSER_TYPES = ["edge", "chrome", "whale", "chromium", "custom"] as const;
export const BrowserType = z.enum(BROWSER_TYPES);
export type BrowserType = z.infer<typeof BrowserType>;

/** 셀렉터 1개 또는 후보 목록(앞에서부터 먼저 찾아지는 것 사용) */
export const Selector = z.union([z.string().min(1), z.array(z.string().min(1)).min(1)]);
export type Selector = z.infer<typeof Selector>;

const BrowserOverride = z.object({
  executablePath: z.string().optional(),
  args: z.array(z.string()).optional(),
});

/** 프로파일의 browser 섹션: 어떤 브라우저로 띄울지는 보통 config/CLI에서 정하고, 여기서는 세션 방식만 정한다 */
export const ProfileBrowser = z.object({
  type: BrowserType.optional(),
  executablePath: z.string().optional(),
  mode: z.enum(["persistent", "ephemeral", "cdp"]).default("persistent"),
  userDataDir: z.string().optional(),
  cdpUrl: z.string().optional(),
  headless: z.boolean().default(false),
  args: z.array(z.string()).default([]),
  viewport: z.object({ width: z.number(), height: z.number() }).optional(),
  locale: z.string().optional(),
});

// strictObject: 키 이름으로 종류를 구분하므로 다른 키가 섞이면 오류로 처리
const WaitStrategy = z.union([
  z.strictObject({ selector_visible: Selector }),
  z.strictObject({ selector_hidden: Selector }),
  z.strictObject({ text_stable: z.strictObject({ selector: Selector, ms: z.number().default(2000) }) }),
  z.strictObject({ network_idle: z.strictObject({ ms: z.number().default(1000) }) }),
  z.strictObject({ new_element: Selector }),
  z.strictObject({ delay: z.number() }),
]);
export type WaitStrategy = z.infer<typeof WaitStrategy>;

export const Profile = z.object({
  name: z.string(),
  description: z.string().optional(),
  url: z.string().url(),
  terms: z.string().optional(),
  browser: ProfileBrowser.default({ mode: "persistent", headless: false, args: [] }),
  session: z.enum(["continue", "new"]).default("new"),
  newSession: z
    .object({ goto: z.string().optional(), click: Selector.optional() })
    .optional(),
  ready: z.object({ selector: Selector, timeoutMs: z.number().default(30000) }).optional(),
  input: z.object({
    selector: Selector,
    method: z.enum(["fill", "type", "insert"]).default("fill"),
    clear: z.boolean().default(true),
  }),
  submit: z.union([
    z.object({ press: z.string() }),
    z.object({ click: Selector }),
  ]),
  wait: z.object({
    all: z.array(WaitStrategy).min(1),
    startTimeoutMs: z.number().default(30000),
    timeoutMs: z.number().default(180000),
  }),
  extract: z.object({
    text: Selector,
    format: z.enum(["text", "markdown", "html"]).default("markdown"),
    pick: z.enum(["last", "first", "all"]).default("last"),
    extra: z.record(z.string(), Selector).optional(),
    download: z
      .object({ click: Selector, saveAs: z.string().default("result-{{iteration}}{{ext}}"), timeoutMs: z.number().default(60000) })
      .optional(),
  }),
  authCheck: z
    .object({
      urlContains: z.array(z.string()).or(z.string()).optional(),
      selectorVisible: Selector.optional(),
      titleContains: z.array(z.string()).or(z.string()).optional(),
    })
    .optional(),
  cooldownMs: z.number().default(3000),
});
export type Profile = z.infer<typeof Profile>;

const Criterion = z.union([
  z.strictObject({ contains: z.union([z.string(), z.array(z.string())]) }),
  z.strictObject({ not_contains: z.union([z.string(), z.array(z.string())]) }),
  z.strictObject({ regex: z.string(), flags: z.string().optional() }),
  z.strictObject({ min_length: z.number() }),
  z.strictObject({ max_length: z.number() }),
  z.strictObject({ json_valid: z.strictObject({ required: z.array(z.string()).default([]) }) }),
  z.strictObject({ file_exists: z.strictObject({ ext: z.string().optional(), minBytes: z.number().default(1) }) }),
  z.strictObject({ command: z.string(), timeoutMs: z.number().optional() }),
  z.strictObject({ llm_judge: z.string() }),
]);
export type Criterion = z.infer<typeof Criterion>;

export const Goal = z.object({
  prompt: z.string().optional(),
  promptFile: z.string().optional(),
  maxIterations: z.number().int().min(1).max(50).default(5),
  deadlineMs: z.number().default(30 * 60 * 1000),
  criteria: z.array(Criterion).default([]),
  refine: z
    .object({
      strategy: z.enum(["fixed", "template", "llm", "external"]).default("template"),
      prompts: z.array(z.string()).optional(),
      template: z.string().optional(),
      instruction: z.string().optional(),
    })
    .default({ strategy: "template" }),
  session: z.enum(["continue", "new"]).optional(),
  stopOnSameResponse: z.boolean().default(true),
  output: z.object({ saveTo: z.string().optional() }).optional(),
});
export type Goal = z.infer<typeof Goal>;

export const AppConfig = z.object({
  browser: BrowserType.default("chrome"),
  browsers: z.record(z.string(), BrowserOverride).default({}),
  headless: z.boolean().optional(),
  profilesDir: z.string().default("./profiles"),
  goalsDir: z.string().default("./goals"),
  dataDir: z.string().default("./.webloop"),
  ui: z.object({ port: z.number().default(4777) }).default({ port: 4777 }),
  llm: z
    .object({ command: z.string().default("claude"), args: z.array(z.string()).default(["-p", "--output-format", "json"]), maxCalls: z.number().default(10) })
    .default({ command: "claude", args: ["-p", "--output-format", "json"], maxCalls: 10 }),
});
export type AppConfig = z.infer<typeof AppConfig>;
