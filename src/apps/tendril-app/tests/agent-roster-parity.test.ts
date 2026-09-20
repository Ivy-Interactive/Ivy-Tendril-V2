import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { brandIcons } from "@ivy-interactive/components/tendril";

import { CODING_AGENTS } from "../src/views/settings/codingAgents";
import { ONBOARDING_AGENTS } from "../src/views/onboarding/CodingAgentStep";

/**
 * The agent catalog lives in Rust and the three places the operator picks an agent live in
 * TypeScript, so nothing but this file connects them.
 *
 * The bug: `apple` was added to `catalog.rs`, the daemon served it, `tendril models` priced it -- and
 * the composer's picker and the Coding Agent pane did not list it, because each keeps its own
 * hardcoded roster. Every Rust-side test passed. The agent was simply unreachable from the UI, and
 * the only way to notice was to open the app and look.
 *
 * Reading `catalog.rs` from a vitest run is unusual, and cheaper than the alternative: the honest
 * source of truth is `GET /api/agents`, which needs a running daemon. `app-icons.test.ts` reads
 * `tauri.conf.json` and `settings-coding-agent.test.tsx` reads a fixture out of `crates/`, so
 * crossing the language boundary for a fact that only exists on the other side is the established
 * shape here. The parse is deliberately narrow -- `id: "..."` inside the `AGENTS` slice -- so it
 * fails loudly if that table is ever restructured rather than silently matching nothing.
 */
const CATALOG_PATH = path.resolve(__dirname, "../../../crates/tendril-core/src/agents/catalog.rs");

function catalogAgentIds(): string[] {
  const source = fs.readFileSync(CATALOG_PATH, "utf8");
  const table = /static AGENTS: &\[AgentDef\] = &\[([\s\S]*?)\n\];/.exec(source);
  if (!table) {
    throw new Error(
      `Could not find the AGENTS table in ${CATALOG_PATH}. If it was renamed or restructured, ` +
        `update this test -- do not delete it.`,
    );
  }
  return Array.from(table[1].matchAll(/^\s*id: "([^"]+)",/gm)).map((m) => m[1]);
}

/**
 * `openaiproxy` is in the catalog but is deliberately not a card in either roster: it is one agent
 * id whose label, icon and models all follow the base URL it is pointed at, so the UI offers it as
 * the three `BYO_CARDS` instead. `ivy` is the same id under a different base URL.
 */
const NOT_A_CARD = new Set(["openaiproxy", "ivy"]);

describe("agent roster parity", () => {
  it("parses a plausible catalog rather than silently matching nothing", () => {
    const ids = catalogAgentIds();
    expect(ids.length).toBeGreaterThanOrEqual(6);
    expect(ids).toContain("claude");
    expect(new Set(ids).size).toBe(ids.length);
  });

  // This is the assertion the Apple regression needed. A new row in `catalog.rs` that nobody adds
  // to the settings pane is an agent the daemon will happily launch and the operator cannot choose.
  it("offers every catalog agent in the Coding Agent pane", () => {
    const expected = catalogAgentIds().filter((id) => !NOT_A_CARD.has(id));
    expect(CODING_AGENTS.map((a) => a.id).sort()).toEqual([...expected].sort());
  });

  // Same failure one screen earlier: the wizard is where a fresh install picks its agent, so an
  // agent missing here is one a new operator never sees at all.
  it("offers every catalog agent in the onboarding wizard", () => {
    const expected = catalogAgentIds().filter((id) => !NOT_A_CARD.has(id));
    expect(ONBOARDING_AGENTS.map((a) => a.id).sort()).toEqual([...expected].sort());
  });

  // The two rosters are separate arrays that must agree on how each agent is spelled, or the
  // wizard and the settings pane disagree about which card is selected.
  it("agrees with itself about labels", () => {
    const settings = new Map(CODING_AGENTS.map((a) => [a.id, a.label]));
    for (const agent of ONBOARDING_AGENTS) {
      expect(settings.get(agent.id)).toBe(agent.label);
    }
  });

  // `BrandIcon` falls back to a generic terminal glyph for an unknown name, so a typo'd icon key is
  // invisible in review and shows up as the wrong mark in the product.
  it("names an icon that the registry actually has", () => {
    for (const agent of CODING_AGENTS) {
      expect(Object.keys(brandIcons)).toContain(agent.icon);
    }
  });
});
