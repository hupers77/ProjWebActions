// 빌드 후 웹 UI 정적 파일을 dist로 복사 (OS 무관, 외부 도구 없이)
import { cpSync, chmodSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
cpSync(join(root, "src/ui/public"), join(root, "dist/ui/public"), { recursive: true });
const bin = join(root, "dist/cli/index.js");
if (existsSync(bin) && process.platform !== "win32") chmodSync(bin, 0o755);
console.log("assets copied");
