import { UnansweredQuestionsDialog, PendingAnnotationsDialog } from "../../dialogs";
import { defineSurface } from "./types";
import { question } from "./models";

const noop = () => {};

/**
 * The two execute guards that ask about plan content, alongside `DirtyRepoDialog` which asks about
 * the repo. All three are the last thing between the operator and a dispatch, and until this
 * catalog `UnansweredQuestionsDialog` had no test of any kind and `PendingAnnotationsDialog` had a
 * single mention inside `ExecuteGuardChain`.
 *
 * Both are count-driven: every string they show is assembled from a number, and the singular and
 * plural halves are written separately. That is the whole reason these need scenarios rather than
 * one smoke test - the copy is a branch, and a branch nobody renders is a branch nobody checks.
 */

export const unansweredQuestionsSurface = defineSurface(
  "UnansweredQuestionsDialog",
  "dialog",
  UnansweredQuestionsDialog,
  [
    {
      title: "One question",
      hint: "The singular copy: `1 unanswered question`, and `leaves it to the agent`.",
      props: {
        questions: [question()],
        onUpdatePlan: noop,
        onProceed: noop,
      },
      expectText: ["1 unanswered question", "leaves it"],
    },
    {
      title: "Several questions",
      hint: "The plural copy: `3 unanswered questions`, and `leaves them to the agent`.",
      props: {
        questions: [
          question({ id: "q1", title: "Should the harness ship in release builds?" }),
          question({ id: "q2", title: "Does the registry include sheets?" }),
          question({ id: "q3", title: "Which dialogs get scenarios first?" }),
        ],
        onUpdatePlan: noop,
        onProceed: noop,
      },
      expectText: ["3 unanswered questions", "leaves them"],
    },
    {
      title: "Many questions",
      hint: "Ten: whether the list scrolls inside the dialog or grows it past the viewport.",
      props: {
        questions: Array.from({ length: 10 }, (_, i) =>
          question({ id: `q${i + 1}`, title: `Open decision number ${i + 1}` }),
        ),
        onUpdatePlan: noop,
        onProceed: noop,
      },
      expectText: ["10 unanswered questions", "Open decision number 10"],
    },
    {
      title: "A question with a long title",
      hint: "Wrapping: a title long enough to run past the `rem32` width the dialog declares.",
      props: {
        questions: [
          question({
            title:
              "Should the debug harness be gated behind import.meta.env.DEV, given the eager-bundle budget sits at 93.8% and a registry importing every dialog is a large graph?",
          }),
        ],
        onUpdatePlan: noop,
        onProceed: noop,
      },
      expectText: ["eager-bundle budget"],
    },
    {
      title: "A question carrying options",
      hint: "Options are what the agent picks from when it answers for itself, so a question with a recommended option is the ordinary case rather than an edge one.",
      props: {
        questions: [
          question({
            title: "Where should the scenario catalogs live?",
            options: [
              { title: "Beside the dialogs", value: "dialogs" },
              { title: "Under views/debug", value: "debug", recommended: true },
            ],
          }),
        ],
        onUpdatePlan: noop,
        onProceed: noop,
      },
      expectText: ["Where should the scenario catalogs live?"],
    },
    {
      title: "An optional question",
      hint: "`optional` means the plan is complete without an answer. The dialog still counts it, which is worth seeing rather than assuming.",
      props: {
        questions: [question({ title: "Any preference on file naming?", optional: true })],
        onUpdatePlan: noop,
        onProceed: noop,
      },
      expectText: ["1 unanswered question"],
    },
  ],
);

export const pendingAnnotationsSurface = defineSurface(
  "PendingAnnotationsDialog",
  "dialog",
  PendingAnnotationsDialog,
  [
    {
      title: "Annotations only · summed",
      hint: "Today's caller passes the sum and omits the breakdown, so the copy names neither kind.",
      props: { annotationCount: 4, onUpdatePlan: noop, onProceed: noop },
      expectText: ["4"],
    },
    {
      title: "One annotation",
      hint: "The singular branch of the count.",
      props: { annotationCount: 1, onUpdatePlan: noop, onProceed: noop },
      expectText: ["1"],
    },
    {
      title: "Annotations and answers, named separately",
      hint: "V1's two-count message. Supplying `answeredQuestionCount` restores the naming, because the two are not discarded alike: annotations live only in the UI, answers are already in the revision file.",
      props: {
        annotationCount: 3,
        answeredQuestionCount: 2,
        onUpdatePlan: noop,
        onProceed: noop,
      },
      expectText: ["3", "2"],
    },
    {
      title: "Answers only",
      hint: "Zero annotations with answers pending: the half of V1's message that names answers alone.",
      props: {
        annotationCount: 0,
        answeredQuestionCount: 5,
        onUpdatePlan: noop,
        onProceed: noop,
      },
      expectText: ["5"],
    },
    {
      title: "One of each",
      hint: "Both counts at 1, which is where two independently-written singular branches meet.",
      props: {
        annotationCount: 1,
        answeredQuestionCount: 1,
        onUpdatePlan: noop,
        onProceed: noop,
      },
      expectText: ["1"],
    },
    {
      title: "With Update and Execute",
      hint: "`onUpdateAndExecute` is V1's primary — fold the pending items in, then execute. Optional, so its absence is the other scenarios and its presence is this one.",
      props: {
        annotationCount: 2,
        onUpdatePlan: noop,
        onProceed: noop,
        onUpdateAndExecute: noop,
      },
      expectText: ["2"],
    },
  ],
);
