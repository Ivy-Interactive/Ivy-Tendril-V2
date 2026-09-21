import type { Meta, StoryObj } from "@storybook/react";
import * as React from "react";
import { PlanWorkspace } from "@/components/PlanWorkspace";
import type { PlanActionDto } from "@/components/PlanWorkspace";
import { PlanMarkdown } from "@/components/PlanMarkdown";
import { TendrilQuestions } from "@/components/TendrilQuestions";
import { SortableVerificationList } from "@/components/SortableVerificationList";
import { TuiBadge } from "@/components/ui/TuiBadge";
import { AppFrame, fullBleedDecorator, planSectionItems } from "./app-layout-harness";

/**
 * A plan open in the workspace, in the states it actually passes through: a draft still asking its
 * verification questions, a plan whose revision is waiting to be accepted, one executing with a
 * live agent session in the strip, and one back from review with everything green.
 *
 * `PlanWorkspace` is slot-driven, so each state is the same widget with different slots filled -
 * which is exactly how `PlanDetailView` drives it in the app.
 */
const meta: Meta = {
  title: "App/Plan Layout",
  parameters: {
    layout: "fullscreen",
    // PlanMarkdown lazily imports its renderers and the workspace measures its own width to decide
    // whether the chat panel sits beside or under the plan, so neither settles at a fixed instant.
    visual: { disable: true },
  },
  decorators: [fullBleedDecorator],
};

export default meta;
type Story = StoryObj;

const noop = () => {};

const PLAN_MARKDOWN = `# Storybook stories for full app layout states

## Problem

Storybook covers every widget on its own, but nothing shows the *app*. A reviewer cannot tell from
\`ChatMessageList\` alone what the chat page looks like while the agent is still answering, and a
designer has no way to see a draft that is blocked on questions without running Tendril against a
seeded home directory.

## Solution

Add an \`App/*\` story group that composes the real widgets inside the real shell, one story per
state. The states are reached with props only:

| Story | State it shows |
| --- | --- |
| Chat Layout / Conversation | A thread partway through |
| Chat Layout / Awaiting Answers | The agent blocked on a questions block |
| Plan Layout / Draft | Verification questions still unanswered |
| Plan Layout / Edits Pending | A revision waiting to be accepted |

## Constraints

- Stories live in \`src/packages/components\`; the dependency runs app to package, never back.
- No \`a11y\` opt-outs: \`storybook-a11y-optouts.test.ts\` pins the count at exactly one.
`;

const REVISION_MARKDOWN = `# Storybook stories for full app layout states

## Problem

Storybook covers every widget on its own, but nothing shows the *app*.

~~The states are reached with props only.~~
**Revised:** the states are reached with props only, and a shared \`app-layout-harness\` module
holds the sample data so the four story files cannot drift apart.

## Solution

Add an \`App/*\` story group that composes the real widgets inside the real shell, one story per
state.

> [!NOTE]
> This revision adds the harness module and the Review layout story that the first draft omitted.
`;

const VERIFICATION_QUESTIONS = `- id: grouping
  title: How should the layout stories be grouped in the sidebar?
  description: Storybook sorts by the meta title, so the prefix decides the tree.
  multiple: false
  optional: false
  options:
    - title: A new "App" top-level group
      value: app
      description: Sits beside Components and UI; reads as "the whole app".
      recommended: true
    - title: Under the existing "Shell" group
      value: shell
      description: Keeps shell work together, but buries the chat and plan states.
- id: baselines
  title: Should the layout stories take visual baselines?
  description: Baselines are generated on Linux only and would need regenerating for every copy edit.
  multiple: false
  optional: false
  options:
    - title: No - opt out with parameters.visual.disable
      value: opt-out
      recommended: true
    - title: Yes - commit PNG baselines for each state
      value: baselines
`;

const VERIFICATIONS = JSON.stringify([
  { name: "pnpm --filter @ivy-interactive/components typecheck", enabled: true, required: true },
  { name: "pnpm --filter @ivy-interactive/components test", enabled: true, required: true },
  { name: "pnpm --filter @ivy-interactive/components check", enabled: true, required: true },
  {
    name: "pnpm --filter @ivy-interactive/components build-storybook",
    enabled: true,
    required: false,
  },
  { name: "pnpm --filter @ivy-interactive/tendril-app test", enabled: false, required: false },
]);

const projectBadges = [
  <TuiBadge key="project" kind="project">
    components
  </TuiBadge>,
];

/** The draft's action bar: nothing has been accepted yet, so Accept leads. */
const draftActions: PlanActionDto[] = [
  { tag: "questions", label: "Questions", icon: "FileQuestion", badge: "2" },
  { tag: "verifications", label: "Verifications", icon: "FileCheck2" },
];

const PlanChat: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="flex h-full flex-col gap-2.5 p-3 text-small-body">{children}</div>
);

const ChatTurn: React.FC<{ from: "you" | "tendril"; children: React.ReactNode }> = ({
  from,
  children,
}) => (
  <div className="flex flex-col gap-1">
    <span className="text-xs font-medium">{from === "you" ? "You" : "Tendril"}</span>
    <p className="text-sm leading-relaxed">{children}</p>
  </div>
);

/**
 * A draft that cannot proceed: two verification questions are unanswered, and the Questions icon
 * carries the count that tells the user so.
 */
export const DraftWithQuestions: Story = {
  render: () => (
    <AppFrame
      activeNav="plans"
      sectionTitle="Plans"
      sectionItems={planSectionItems}
      selectedItemId="00074"
      navBadges={{ plans: 4, review: 1 }}
      fullBleed
    >
      <PlanWorkspace
        id="plan-workspace"
        planId="00074"
        title="Storybook stories for full app layout states"
        meta="Draft · updated 4 minutes ago"
        persona="Tendril"
        personaInitials="TE"
        unansweredQuestions={2}
        questionsLabel="Questions"
        verificationsLabel="Verifications"
        actions={draftActions}
        primary={{ tag: "accept", label: "Accept", icon: "Check", shortcut: "Ctrl+Enter" }}
        secondary={[{ tag: "update", label: "Update", icon: "Pencil", focusChat: true }]}
        events={["OnAction"]}
        eventHandler={noop}
        slots={{
          ProjectBadges: projectBadges,
          Content: [<PlanMarkdown key="plan" id="plan-md" content={PLAN_MARKDOWN} />],
          Questions: [
            <TendrilQuestions
              key="questions"
              id="plan-questions"
              content={VERIFICATION_QUESTIONS}
              showSubmit
              submitLabel="Submit answers"
              events={["OnAnswer", "OnSubmit"]}
              eventHandler={noop}
            />,
          ],
          Verifications: [
            <SortableVerificationList
              key="verifications"
              id="plan-verifications"
              itemsJson={VERIFICATIONS}
              events={["OnChange"]}
              eventHandler={noop}
            />,
          ],
          Chat: [
            <PlanChat key="chat">
              <ChatTurn from="tendril">
                I drafted the plan from the repository's existing story conventions. Two decisions
                are yours - they are in the Questions panel.
              </ChatTurn>
              <ChatTurn from="you">Group them under App, and skip the baselines.</ChatTurn>
              <ChatTurn from="tendril">
                Noted. Answer them in the panel and I will write the revision.
              </ChatTurn>
            </PlanChat>,
          ],
        }}
      />
    </AppFrame>
  ),
};

/**
 * A revision has been written and is waiting on the reviewer: the plan body shows the edit, and the
 * action bar leads with Accept over Reject.
 */
export const EditsPending: Story = {
  render: () => (
    <AppFrame
      activeNav="plans"
      sectionTitle="Plans"
      sectionItems={planSectionItems}
      selectedItemId="00074"
      navBadges={{ plans: 4, review: 1 }}
      fullBleed
    >
      <PlanWorkspace
        id="plan-workspace"
        planId="00074"
        title="Storybook stories for full app layout states"
        meta="Revision 2 · awaiting review"
        persona="Tendril"
        personaInitials="TE"
        tabs={[
          { id: "plan", label: "Plan" },
          { id: "changes", label: "Changes", badge: "3" },
          { id: "git", label: "Git" },
        ]}
        selectedTab="plan"
        actions={[
          { tag: "questions", label: "Questions", icon: "FileQuestion" },
          { tag: "verifications", label: "Verifications", icon: "FileCheck2" },
        ]}
        primary={{ tag: "accept", label: "Accept revision", icon: "Check", shortcut: "Ctrl+Enter" }}
        secondary={[
          { tag: "reject", label: "Reject", icon: "X", danger: true },
          { tag: "update", label: "Update", icon: "Pencil", focusChat: true },
        ]}
        events={["OnAction", "OnSelectTab"]}
        eventHandler={noop}
        slots={{
          ProjectBadges: projectBadges,
          Content: [<PlanMarkdown key="plan" id="plan-md" content={REVISION_MARKDOWN} />],
          Verifications: [
            <SortableVerificationList
              key="verifications"
              id="plan-verifications"
              itemsJson={VERIFICATIONS}
              events={["OnChange"]}
              eventHandler={noop}
            />,
          ],
          Chat: [
            <PlanChat key="chat">
              <ChatTurn from="you">
                Add the harness module so the story files cannot drift, and cover the Review layout
                too.
              </ChatTurn>
              <ChatTurn from="tendril">
                Revision 2 is ready: it adds `app-layout-harness.tsx` and a Review story. Accept it
                to write it to the plan.
              </ChatTurn>
            </PlanChat>,
          ],
        }}
      />
    </AppFrame>
  ),
};

/**
 * The plan is executing: an agent session owns the strip, so the page tab sits behind a live pane
 * and the primary action becomes Stop.
 */
export const ExecutingWithSession: Story = {
  render: () => (
    <AppFrame
      activeNav="plans"
      sectionTitle="Plans"
      sectionItems={planSectionItems}
      selectedItemId="00074"
      navBadges={{ plans: 4, review: 1, jobs: 1 }}
      sessionTabs={[{ id: "session-00074", title: "00074-ExecutePlan" }]}
      selectedTabId="session-00074"
      activeSessionIndex={0}
      sessionContents={[
        <div
          key="session"
          className="h-full overflow-auto bg-[#18181b] p-4 font-mono text-xs leading-relaxed text-[#e4e4e7]"
        >
          <p className="text-[#a1a1aa]">$ pnpm --filter @ivy-interactive/components typecheck</p>
          <p>vite-plus build · 64 files, total: 3.99 MB</p>
          <p>tsc --noEmit</p>
          <p className="text-[#4ade80]">✔ typecheck passed in 3.1s</p>
          <p className="mt-2 text-[#a1a1aa]">$ pnpm --filter @ivy-interactive/components test</p>
          <p>RUN v3.2.4 src/packages/components</p>
          <p className="text-[#4ade80]">✔ tests/storybook-a11y-optouts.test.ts (2)</p>
          <p className="text-[#4ade80]">✔ tests/hover-token-audit.test.ts (3)</p>
          <p className="text-[#fbbf24]">❯ tests/exports.test.ts (12) · running…</p>
        </div>,
      ]}
      fullBleed
    >
      <PlanWorkspace
        id="plan-workspace"
        planId="00074"
        title="Storybook stories for full app layout states"
        meta="Executing · started 2 minutes ago"
        persona="Tendril"
        personaInitials="TE"
        actions={[{ tag: "verifications", label: "Verifications", icon: "FileCheck2" }]}
        primary={{ tag: "stop", label: "Stop", icon: "Square", danger: true }}
        events={["OnAction"]}
        eventHandler={noop}
        slots={{
          ProjectBadges: projectBadges,
          Content: [<PlanMarkdown key="plan" id="plan-md" content={REVISION_MARKDOWN} />],
          Verifications: [
            <SortableVerificationList
              key="verifications"
              id="plan-verifications"
              itemsJson={VERIFICATIONS}
              events={["OnChange"]}
              eventHandler={noop}
            />,
          ],
        }}
      />
    </AppFrame>
  ),
};

/**
 * Back from review with every verification green: the action bar has collapsed to the one thing
 * left to do, and the sidebar row carries the pass badge.
 */
export const ReviewPassed: Story = {
  render: () => (
    <AppFrame
      activeNav="review"
      sectionTitle="Review"
      sectionItems={planSectionItems.map((item) =>
        item.id === "00074"
          ? {
              ...item,
              badges: [
                { label: "components", kind: "project" as const },
                { label: "pass", kind: "success" as const },
              ],
            }
          : item,
      )}
      selectedItemId="00074"
      navBadges={{ plans: 3, review: 1 }}
      fullBleed
    >
      <PlanWorkspace
        id="plan-workspace"
        planId="00074"
        title="Storybook stories for full app layout states"
        meta="Verified · 4 of 4 checks passed"
        persona="Tendril"
        personaInitials="TE"
        sourceUrl="https://github.com/Ivy-Interactive/Ivy-Tendril-V2/pull/234"
        sourceLabel="#234"
        tabs={[
          { id: "plan", label: "Plan" },
          { id: "changes", label: "Changes", badge: "5" },
          { id: "git", label: "Git" },
        ]}
        selectedTab="changes"
        actions={[{ tag: "verifications", label: "Verifications", icon: "FileCheck2" }]}
        primary={{ tag: "create-pr", label: "Create pull request", icon: "GitPullRequest" }}
        secondary={[{ tag: "reset", label: "Reset to draft", icon: "RotateCcw" }]}
        events={["OnAction", "OnSelectTab"]}
        eventHandler={noop}
        slots={{
          ProjectBadges: projectBadges,
          Content: [
            <div key="changes" className="flex flex-col gap-2.5 p-4">
              <h2 className="text-sm font-medium">5 files changed</h2>
              <ul className="flex flex-col gap-1 font-mono text-xs">
                {[
                  ["src/stories/app-layout-harness.tsx", "+238", "-0"],
                  ["src/stories/app-chat-layout.stories.tsx", "+264", "-0"],
                  ["src/stories/app-plan-layout.stories.tsx", "+331", "-0"],
                  ["src/stories/app-dashboard-layout.stories.tsx", "+142", "-0"],
                  ["tests/storybook-app-layouts.test.ts", "+48", "-0"],
                ].map(([file, added, removed]) => (
                  <li key={file} className="flex items-center gap-2.5">
                    <span className="min-w-0 flex-1 truncate text-foreground">{file}</span>
                    {/* The diff counts go through the badges rather than a bare coloured span:
                        `--success` is #86d26f, which is a fill colour and far below AA as text. */}
                    <TuiBadge kind="success" mono>
                      {added}
                    </TuiBadge>
                    <TuiBadge kind="danger" mono>
                      {removed}
                    </TuiBadge>
                  </li>
                ))}
              </ul>
            </div>,
          ],
          Verifications: [
            <SortableVerificationList
              key="verifications"
              id="plan-verifications"
              itemsJson={VERIFICATIONS}
              events={["OnChange"]}
              eventHandler={noop}
            />,
          ],
        }}
      />
    </AppFrame>
  ),
};
