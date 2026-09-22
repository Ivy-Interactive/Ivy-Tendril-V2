import React from "react";

import { agentsApi } from "../../api/agentsApi";
import type { AgentSignInHint } from "../../types/agents";
import { BYO_CARDS, CODING_AGENTS } from "./codingAgents";

/**
 * The Coding Agent pane's Help block reads its install and sign-in instructions from the daemon.
 *
 * There is no V1 original for the block itself: `Apps/Settings/CodingAgentSetupView.cs` selects an
 * agent and says nothing about getting one, and the only install guidance anywhere in V1 is the
 * per-agent `SignInHint` the probe returns *after* a failed auth check. That hint arrives too late
 * to be useful - the operator has already picked an agent, saved, and run something - so this block
 * is the same knowledge moved in front of the failure.
 *
 * **It used to be the same knowledge written twice.** This file held its own table of prose, and
 * `agents/probe.rs` held its own `sign_in_hint` sentences, and the two drifted: probe.rs told people
 * to run `claude login`, which is not a subcommand and is swallowed as the prompt positional, while
 * this table said `claude auth login`, which is the real one. Two further hints - `gemini auth` and
 * `copilot login` - named commands that do not exist at all, and were corrected in Rust only,
 * leaving three copies of the truth in two files. Prose in two places is a bug with a schedule.
 *
 * So the daemon now owns the facts and serves them from `GET /api/agents/hints` as structured data -
 * binary, install routes, auth routes, console URL - and both surfaces render the same value: this
 * block, and the Test Agent dialog's authentication row. Correcting a vendor's renamed install
 * script is one edit in `probe.rs`, and everything moves together.
 *
 * What is pinned, and where: that every card has an entry, that no hint recommends npm, and that the
 * `brew` cask/formula split is right all live beside the data in `probe.rs`'s tests. This side pins
 * only what it owns - that the right card's hint reaches the DOM - plus the cross-language parity
 * assertion in `settings-coding-agent-help.test.tsx`, which reads `SIGN_IN_HINT_CARDS` out of
 * `probe.rs` the way `agent-roster-parity.test.ts` reads `catalog.rs`.
 */

/** The card's own label, so the help reads as being about the thing that was clicked. */
export const cardLabel = (card: string): string =>
  CODING_AGENTS.find((agent) => agent.id === card)?.label ??
  BYO_CARDS.find((byo) => byo.key === card)?.label ??
  card;

/**
 * Hints by card key, or `null` until the daemon has answered.
 *
 * Keyed by **card**, not by resolved agent id, which is how the daemon serves them:
 * `resolveFinalAgent` collapses all three bring-your-own cards onto `openaiproxy` (or `ivy`), so an
 * id-keyed table would hand the Anthropic card OpenAI's console link.
 *
 * A failed fetch is `{}` rather than an error state. This is supplementary help beside settings that
 * work without it; a daemon that is down has already been reported at the top of the pane, and a
 * second red box saying the same thing helps nobody.
 */
export function useAgentHints(): Record<string, AgentSignInHint> | null {
  const [hints, setHints] = React.useState<Record<string, AgentSignInHint> | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    agentsApi
      .getHints()
      .then((list) => {
        if (cancelled) return;
        setHints(Object.fromEntries(list.map((hint) => [hint.agent, hint])));
      })
      .catch(() => {
        if (!cancelled) setHints({});
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return hints;
}

/**
 * Undefined for a `codingAgent` value that is not a card at all - `initialCard` passes through
 * whatever normalised id it was given, and an unrecognised one already raises the
 * `unknownAgentMessage` callout at the top of the pane. Help for an agent that does not exist would
 * be invented, so there is none.
 */
export const helpForCard = (
  hints: Record<string, AgentSignInHint> | null,
  card: string,
): AgentSignInHint | undefined => hints?.[card];
