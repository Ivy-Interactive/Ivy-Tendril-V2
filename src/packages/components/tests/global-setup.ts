import { existsSync } from "node:fs";
import { execSync } from "node:child_process";
import { resolve } from "node:path";

export default function setup() {
  const distTendril = resolve(import.meta.dirname, "../dist/tendril.mjs");
  if (!existsSync(distTendril)) {
    const packageRoot = resolve(import.meta.dirname, "..");
    execSync("pnpm build", { cwd: packageRoot, stdio: "inherit" });
  }
}
