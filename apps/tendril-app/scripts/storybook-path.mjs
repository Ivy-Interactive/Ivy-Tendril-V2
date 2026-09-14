import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const hasBuiltDist = (candidate) => fs.existsSync(path.join(candidate, "dist", "tendril.mjs"));

export const storybookRootCandidates = () => {
  const candidates = [];
  if (process.env.COMPONENTS_STORYBOOK_PATH) {
    candidates.push(path.resolve(process.env.COMPONENTS_STORYBOOK_PATH));
  }
  candidates.push(path.resolve(repoRoot, "../components-storybook"));

  const linkedPackage = path.join(repoRoot, "node_modules", "@spacecorps", "components-storybook");
  try {
    candidates.push(fs.realpathSync(linkedPackage));
  } catch {
    // dangling or missing link: not a candidate
  }

  candidates.push(path.join(os.homedir(), "git", "components-storybook"));
  return candidates;
};

export const resolveStorybookRoot = () => {
  const candidates = storybookRootCandidates();
  const found = candidates.find(hasBuiltDist);
  if (found) return found;

  throw new Error(
    "Could not resolve a built components-storybook checkout. Tried:\n" +
      candidates.map((c) => `  - ${c}`).join("\n") +
      "\nSet COMPONENTS_STORYBOOK_PATH, or build dist/ in one of the checkouts above (pnpm install && pnpm build).",
  );
};
