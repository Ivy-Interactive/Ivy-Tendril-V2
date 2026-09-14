import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { storybookRootCandidates } from "./storybook-path.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const linkedPackage = path.join(repoRoot, "node_modules", "@spacecorps", "components-storybook");

const isLinkHealthy = () => {
  try {
    return fs.existsSync(path.join(fs.realpathSync(linkedPackage), "dist", "tendril.mjs"));
  } catch {
    return false;
  }
};

if (isLinkHealthy()) {
  process.exit(0);
}

const target = storybookRootCandidates().find((candidate) =>
  fs.existsSync(path.join(candidate, "dist", "tendril.mjs")),
);

if (!target) {
  console.warn(
    "[link-storybook] No resolvable components-storybook checkout with a built dist/ found. " +
      "Set COMPONENTS_STORYBOOK_PATH or build dist/ in ../components-storybook or ~/git/components-storybook.",
  );
  process.exit(0);
}

try {
  fs.rmSync(linkedPackage, { force: true });
  fs.mkdirSync(path.dirname(linkedPackage), { recursive: true });
  fs.symlinkSync(target, linkedPackage, "dir");
  console.log(`[link-storybook] Linked @spacecorps/components-storybook -> ${target}`);
} catch (error) {
  console.warn(`[link-storybook] Failed to repair the components-storybook link: ${error.message}`);
}
