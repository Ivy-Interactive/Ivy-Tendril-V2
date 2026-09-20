import type { Job, PlanSummary } from "../../types/api";

/**
 * `SamplePrompts.ForChat` and `SamplePrompts.ForPlan`: the chips the empty state offers, built from
 * whatever this tendril happens to hold right now. Both are pure functions of the lists they are
 * handed, which is why they sit apart from the view that renders them - the plan panel calls
 * {@link buildPlanSamplePrompts} directly, and the tests drive both without mounting anything.
 */

/** One chip of the empty state: the label is the button, the prompt is what it drafts. */
export interface SamplePrompt {
  label: string;
  prompt: string;
}

/**
 * The static tail of the sample prompts, in the order and with the wording of
 * `SamplePrompts.ForChat`'s fallbacks: the label is the button, the prompt is what it drafts.
 */
const SAMPLE_PROMPTS = [
  { label: "Add a new project", prompt: "Add a new project to my tendril" },
  { label: "Edit verifications", prompt: "Edit verifications for my projects" },
  { label: "Create a team vault", prompt: "Create a shared team vault" },
  {
    label: "What should I work on next?",
    prompt:
      "Look at my draft plans across all projects and recommend which two to execute next, with reasons.",
  },
  {
    label: "What shipped this week?",
    prompt:
      "Summarize the plans that reached Completed in the last seven days, grouped by project.",
  },
];

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
export function buildChatSamplePrompts(plans: PlanSummary[], jobs: Job[]): SamplePrompt[] {
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
    add(
      `Review the ${reviewPlans.length} plans waiting`,
      `${reviewPlans.length} plans are waiting for review: ${planList}. Summarize what each delivers and tell me which to merge first.`,
    );
  }

  const failedPlan = newestByUpdated(plans.filter((p) => p.state === "Failed"));
  if (failedPlan) {
    add(
      `Why did #${shortPlanId(failedPlan.id)} fail?`,
      `Plan #${shortPlanId(failedPlan.id)} ${failedPlan.title} failed. Read its logs and verification reports and explain what went wrong.`,
    );
  }

  const blockedPlan = newestByUpdated(plans.filter((p) => p.state === "Blocked"));
  if (blockedPlan) {
    add(
      `What is blocking #${shortPlanId(blockedPlan.id)}?`,
      `Plan #${shortPlanId(blockedPlan.id)} ${blockedPlan.title} is blocked. List the plans it depends on and what each one still needs.`,
    );
  }

  const runningJobs = jobs.filter(
    (job) => job.status === "Running" || job.status === "Pending" || job.status === "Queued",
  );
  if (runningJobs.length > 0) {
    add(
      "What are my jobs doing?",
      `${runningJobs.length} jobs are running. Summarize what each one is working on.`,
    );
  }

  for (const fallback of SAMPLE_PROMPTS) {
    add(fallback.label, fallback.prompt);
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
export function buildPlanSamplePrompts(plan: SamplePromptPlan): SamplePrompt[] {
  const prompts: SamplePrompt[] = [];
  const labels = new Set<string>();
  const add = (label: string, prompt: string) => {
    if (labels.has(label)) return;
    labels.add(label);
    prompts.push({ label, prompt });
  };

  const failed = (plan.verifications ?? []).find((v) => v.status === "Fail");
  if (failed) {
    add(
      `Why did ${failed.name} fail?`,
      `The ${failed.name} verification failed for this plan. Read its report in Verification/${failed.name}.md and explain the failure and how to fix it.`,
    );
  }

  const firstPr = (plan.prs ?? [])[0];
  if (firstPr) {
    add(
      "Summarize the PR feedback",
      `Read the review comments on ${firstPr} and list the changes they ask for.`,
    );
  }

  if (plan.state === "Blocked") {
    add(
      "What is blocking this?",
      `This plan is blocked on ${(plan.dependsOn ?? []).join(", ")}. Tell me what each dependency still needs.`,
    );
  }

  if (plan.state === "Draft") {
    add(
      "Tighten the scope",
      "Read the latest revision of this plan and point out anything out of scope or under specified.",
    );
  }

  add(
    "Explain the solution",
    "Explain the Solution section of this plan in plain terms, and list every file it will touch.",
  );
  add(
    "What could go wrong?",
    "What are the riskiest parts of this plan, and what should I check in review?",
  );

  return prompts.slice(0, MAX_SAMPLE_PROMPTS);
}

/** The time-of-day greeting above the empty state's headline. */
export function buildGreeting(now: Date): string {
  const hour = now.getHours();
  const word =
    hour >= 5 && hour < 12 ? "Morning" : hour >= 12 && hour < 17 ? "Afternoon" : "Evening";
  return `Good ${word}!`;
}
