import { i18n, type TFunction } from "../i18n";
import { jobStatusLabel, jobTypeLabel } from "../i18n/enumLabels";

export type SystemEventKind = "completed" | "failed" | "started" | "info";

/** How a finished job ended, as its sentence names it: one catalog key per outcome. */
export type SystemEventOutcome = "completed" | "failed" | "timeout" | "cancelled" | "unknown";

/** What a finished job was, as its sentence names it; `other` names it by its (labelled) type. */
export type SystemEventSubject = "plan" | "pullRequest" | "other";

/**
 * The parts a finished job's sentence is built from, for the row that renders it around a clickable
 * plan: `chat:systemEvent.linked.<outcome>` with the subject as its context.
 */
export interface SystemEventSentence {
  outcome: SystemEventOutcome;
  subject: SystemEventSubject;
  /** The job's status, labelled: only the `unknown` outcome's sentence shows it. */
  status: string;
  /** The job's type, labelled: only the `other` subject's sentence shows it. */
  type: string;
}

export interface SystemEventPlanRef {
  /** The plan id as the job reported it, e.g. "00059"; what the open-plan handler receives. */
  id: string;
  /** Short display form, e.g. "#59 Add dark mode toggle". */
  label: string;
}

export interface SystemEventView {
  kind: SystemEventKind;
  /** The sentence up to the plan reference, when there is one. */
  text: string;
  plan?: SystemEventPlanRef;
  /** A trailing detail, such as the failure summary. */
  detail?: string;
  /** The job id extracted from the message, if present. */
  jobId?: string;
  /** Set with `plan`: what the sentence around the plan reference is made of. */
  sentence?: SystemEventSentence;
}

const PREFIX = /^\s*\[System Event\]\s*/i;
const FINISHED =
  /^Job\s+(\S+)\s+\(([^)]+)\)\s+for\s+'(.+?)'\s+has finished with status:\s*(\w+)(?:\s*\((.*?)\))?/i;
const APPROVED =
  /^Manual approval granted and execution started for plan '(.+?)'\s*\(Job\s+(\S+)\)/i;
const PLAN_INFO = /^(\d+)\s*:\s*(.+)$/;

const planRef = (info: string): SystemEventPlanRef | undefined => {
  const match = PLAN_INFO.exec(info.trim());
  if (!match) return undefined;
  return { id: match[1], label: `#${parseInt(match[1], 10)} ${match[2].trim()}` };
};

const jobNoun = (type: string): SystemEventSubject => {
  const lower = type.toLowerCase();
  // `CreatePr` exactly, not "contains pr": `AddProject` and `SetupProject` both contain that substring,
  // and announced themselves as pull requests. Those two only ever reached here once a job with no plan
  // could be reported to a chat at all, which is why the loose match went unnoticed.
  if (lower === "createpr" || lower.includes("pullrequest")) return "pullRequest";
  if (lower.includes("plan")) return "plan";
  return "other";
};

const statusOutcome = (status: string): { outcome: SystemEventOutcome; kind: SystemEventKind } => {
  switch (status.toLowerCase()) {
    case "completed":
      return { outcome: "completed", kind: "completed" };
    case "failed":
      return { outcome: "failed", kind: "failed" };
    case "timeout":
      return { outcome: "timeout", kind: "failed" };
    case "cancelled":
    case "canceled":
      return { outcome: "cancelled", kind: "info" };
    default:
      return { outcome: "unknown", kind: "info" };
  }
};

/** The context that picks a sentence's subject; `other` is the key's own, type-naming form. */
export const systemEventContext = (subject: SystemEventSubject): string | undefined =>
  subject === "other" ? undefined : subject;

const chatT = i18n.getFixedT(null, "chat");

/** Stands in for the plan while the sentence is read up to it; no catalog string contains it. */
const PLAN_MARK = "\u0000";

/**
 * The plain `text` of a sentence with a plan in it: the rendered `linked` sentence up to where the
 * plan goes, tags dropped. It comes from the same key the row renders, so there is one sentence to
 * translate; a language that puts the plan first leaves it empty.
 */
const textBeforePlan = (linked: string): string => {
  const at = linked.indexOf(PLAN_MARK);
  return (at < 0 ? linked : linked.slice(0, at)).replace(/<\/?plan>/g, "").trimEnd();
};

/**
 * Condenses the system events the backend posts into a conversation (job completions, manual
 * approvals) into the one line the timeline shows. The trailing instructions those messages carry
 * are addressed to the agent, not the reader, and are dropped.
 *
 * The patterns above read the daemon's English and stay English; only what this returns for display
 * is translated, into the language `t` is bound to (the current one by default). An event nothing
 * here recognises is the daemon's own text and passes through as it is.
 */
export function formatSystemEvent(content: string, t: TFunction<"chat"> = chatT): SystemEventView {
  const body = content.replace(PREFIX, "").trim();

  const finished = FINISHED.exec(body);
  if (finished) {
    const [, jobId, type, info, status, summary] = finished;
    const { outcome, kind } = statusOutcome(status);
    const subject = jobNoun(type);
    const plan = planRef(info);
    const sentence: SystemEventSentence = {
      outcome,
      subject,
      status: jobStatusLabel(status),
      type: jobTypeLabel(type),
    };
    const vars = {
      context: systemEventContext(subject),
      status: sentence.status,
      type: sentence.type,
    };
    const detail =
      kind === "failed" && summary && summary.toLowerCase() !== status.toLowerCase()
        ? summary
        : undefined;
    return plan
      ? {
          kind,
          text: textBeforePlan(t(`systemEvent.linked.${outcome}`, { ...vars, plan: PLAN_MARK })),
          plan,
          detail,
          jobId,
          sentence,
        }
      : {
          kind,
          text: t(`systemEvent.quoted.${outcome}`, { ...vars, subject: info }),
          detail,
          jobId,
        };
  }

  const approved = APPROVED.exec(body);
  if (approved) {
    return {
      kind: "started",
      text: t("systemEvent.started", { plan: approved[1] }),
      jobId: approved[2],
    };
  }

  return { kind: "info", text: body };
}
