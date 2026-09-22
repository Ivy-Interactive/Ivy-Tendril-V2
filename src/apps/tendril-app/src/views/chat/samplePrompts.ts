import type { Job, PlanSummary } from "../../types/api";
import { i18n, type TFunction } from "../../i18n";

/**
 * `SamplePrompts.ForChat` and `SamplePrompts.ForPlan`: the chips the empty state offers, built from
 * whatever this tendril happens to hold right now. Both are pure functions of the lists they are
 * handed, which is why they sit apart from the view that renders them - the plan panel calls
 * {@link buildPlanSamplePrompts} directly, and the tests drive both without mounting anything.
 *
 * Label and prompt are both the user's: the chip drafts its prompt into the composer, where the user
 * reads it and sends it as their own, so both are written in the language they chose. Each builder
 * takes the `t` of the component that renders the chips (and re-builds them when it changes); called
 * without one it translates into the current language.
 */

const chatT = i18n.getFixedT(null, "chat");

/** One chip of the empty state: the label is the button, the prompt is what it drafts. */
export interface SamplePrompt {
  label: string;
  prompt: string;
}

/**
 * The static tail of the sample prompts, in the order and with the wording of
 * `SamplePrompts.ForChat`'s fallbacks: each is `samplePrompts.chat.<id>`, whose label is the button
 * and whose prompt is what it drafts.
 */
const FALLBACK_PROMPTS = [
  "addProject",
  "editVerifications",
  "teamVault",
  "nextWork",
  "shipped",
] as const;

/**
 * What a fallback prompt names for the agent to look up verbatim - a plan state, here - rather than
 * says: an identifier, not prose, so it goes in as a variable no translation can change.
 */
const FALLBACK_PROMPT_VALUES: Partial<
  Record<(typeof FALLBACK_PROMPTS)[number], Record<string, string>>
> = {
  shipped: { state: "Completed" satisfies PlanSummary["state"] },
};

/** `SamplePrompts.Max`: the empty state never offers more than five. */
const MAX_SAMPLE_PROMPTS = 5;

/** `#21`, not `#00021`, as `PlansView.formatPlanId` explains; inlined to keep the chunks apart. */
export const shortPlanId = (id: string): string => id.replace(/^0+(?=\d)/, "") || id;

const newestByUpdated = (plans: PlanSummary[]): PlanSummary | undefined =>
  [...plans].sort(
    (a, b) => new Date(b.updated ?? 0).getTime() - new Date(a.updated ?? 0).getTime(),
  )[0];

/**
 * Port of `SamplePrompts.ForChat`. The chips are what this tendril happens to need right now, with
 * the five generic prompts as the tail that fills whatever the rules did not: plans waiting for
 * review, the newest failure, the newest block, and jobs in flight, capped at five.
 *
 * V1's fifth rule - the newest plan with `PartialDelivery` - has no counterpart here: `PlanSummary`
 * carries no partial-delivery flag, so that chip is absent rather than guessed at.
 */
export function buildChatSamplePrompts(
  plans: PlanSummary[],
  jobs: Job[],
  t: TFunction<"chat"> = chatT,
): SamplePrompt[] {
  const prompts: SamplePrompt[] = [];
  const labels = new Set<string>();
  const add = (label: string, prompt: string) => {
    if (labels.has(label)) return;
    labels.add(label);
    prompts.push({ label, prompt });
  };

  const reviewPlans = plans.filter((p) => p.state === "Review");
  if (reviewPlans.length > 0) {
    const planList = reviewPlans.map((p) => `#${shortPlanId(p.id)} ${p.title}`).join(", ");
    const count = reviewPlans.length;
    add(
      t("samplePrompts.chat.review.label", { count }),
      t("samplePrompts.chat.review.prompt", { count, plans: planList }),
    );
  }

  const failedPlan = newestByUpdated(plans.filter((p) => p.state === "Failed"));
  if (failedPlan) {
    const plan = { id: shortPlanId(failedPlan.id), title: failedPlan.title };
    add(t("samplePrompts.chat.failed.label", plan), t("samplePrompts.chat.failed.prompt", plan));
  }

  const blockedPlan = newestByUpdated(plans.filter((p) => p.state === "Blocked"));
  if (blockedPlan) {
    const plan = { id: shortPlanId(blockedPlan.id), title: blockedPlan.title };
    add(t("samplePrompts.chat.blocked.label", plan), t("samplePrompts.chat.blocked.prompt", plan));
  }

  const runningJobs = jobs.filter(
    (job) => job.status === "Running" || job.status === "Pending" || job.status === "Queued",
  );
  if (runningJobs.length > 0) {
    add(
      t("samplePrompts.chat.jobs.label"),
      t("samplePrompts.chat.jobs.prompt", { count: runningJobs.length }),
    );
  }

  for (const id of FALLBACK_PROMPTS) {
    add(
      t(`samplePrompts.chat.${id}.label`),
      t(`samplePrompts.chat.${id}.prompt`, FALLBACK_PROMPT_VALUES[id]),
    );
  }

  return prompts.slice(0, MAX_SAMPLE_PROMPTS);
}

/**
 * The plan a chip can be written about: whatever `SamplePrompts.ForPlan` reads off a `PlanFile`.
 * Both `PlanDetail` and `PlanSummary` satisfy it, which is what lets the plan page and the review
 * page share one panel.
 */
export interface SamplePromptPlan {
  state: string;
  verifications?: { name: string; status: string }[];
  prs?: string[];
  dependsOn?: string[];
}

/**
 * Port of `SamplePrompts.ForPlan`, in V1's order — the list is append-only, so source order *is*
 * priority, and `labels.Add(label)` is what suppresses a duplicate. Capped at `SamplePrompts.Max`.
 *
 * The rules, in order: the first failed verification in list order, then the first PR, then the
 * dependencies of a Blocked plan, then a Draft plan's scope, then the two unconditional fallbacks.
 * At most one of Blocked and Draft can fire, so the cap can only ever drop the last fallback.
 *
 * V1's second rule — `plan.PartialDelivery` → "What is missing?" — has no counterpart here, for the
 * same reason `buildChatSamplePrompts` is missing its fifth: neither `PlanDetail` nor `PlanSummary`
 * carries a partial-delivery flag, so that chip is absent rather than guessed at.
 */
export function buildPlanSamplePrompts(
  plan: SamplePromptPlan,
  t: TFunction<"chat"> = chatT,
): SamplePrompt[] {
  const prompts: SamplePrompt[] = [];
  const labels = new Set<string>();
  const add = (label: string, prompt: string) => {
    if (labels.has(label)) return;
    labels.add(label);
    prompts.push({ label, prompt });
  };

  const failed = (plan.verifications ?? []).find((v) => v.status === "Fail");
  if (failed) {
    // The report's path is a file name, not prose: it goes in as a variable so no translation can
    // change it.
    add(
      t("samplePrompts.plan.failedVerification.label", { name: failed.name }),
      t("samplePrompts.plan.failedVerification.prompt", {
        name: failed.name,
        report: `Verification/${failed.name}.md`,
      }),
    );
  }

  const firstPr = (plan.prs ?? [])[0];
  if (firstPr) {
    add(
      t("samplePrompts.plan.prFeedback.label"),
      t("samplePrompts.plan.prFeedback.prompt", { pr: firstPr }),
    );
  }

  if (plan.state === "Blocked") {
    add(
      t("samplePrompts.plan.blocked.label"),
      t("samplePrompts.plan.blocked.prompt", { dependencies: (plan.dependsOn ?? []).join(", ") }),
    );
  }

  if (plan.state === "Draft") {
    add(t("samplePrompts.plan.tightenScope.label"), t("samplePrompts.plan.tightenScope.prompt"));
  }

  // `Solution` is the heading of plan.md's section, which the agent finds by that name.
  add(
    t("samplePrompts.plan.explainSolution.label"),
    t("samplePrompts.plan.explainSolution.prompt", { section: "Solution" }),
  );
  add(t("samplePrompts.plan.risks.label"), t("samplePrompts.plan.risks.prompt"));

  return prompts.slice(0, MAX_SAMPLE_PROMPTS);
}

/** The time-of-day greeting above the empty state's headline: one whole greeting per part of day. */
export function buildGreeting(now: Date, t: TFunction<"chat"> = chatT): string {
  const hour = now.getHours();
  const part =
    hour >= 5 && hour < 12 ? "morning" : hour >= 12 && hour < 17 ? "afternoon" : "evening";
  return t(`greeting.${part}`);
}
