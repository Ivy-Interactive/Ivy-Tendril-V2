import { whereColumn } from "@ivy-interactive/components/ui";
import { queryJobsPage } from "../../api/tableQuery";
import type { TFunction } from "../../i18n";
import type { JobStatus } from "../../types/api";
import { jobsT } from "./format";

/**
 * The bulk clears the header menu offers: which scopes exist, what the confirm says for one, and how
 * many rows it would take. All three answer the same question - "what exactly is about to be
 * deleted" - which is why the sentence is built here rather than in the dialog.
 */

/** A scope's subtree in the `jobs` catalog: `clear.scopes.<key>`. */
export type JobClearScopeKey = "completed" | "failed" | "timeout" | "stopped" | "all";

/** One entry in the header menu's clear list. */
export interface JobClearScope {
  /** The `status` value `POST /api/jobs/clear` is sent. */
  scope: string;
  /** Where the scope's copy lives in the `jobs` catalog, `clear.scopes.<key>`. */
  key: JobClearScopeKey;
  /** The menu label, and the dialog's title - in the language current when it is read. */
  readonly label: string;
  /**
   * What the English sentence in the dialog calls these rows, e.g. "12 **failed** jobs". Not what is
   * shown: every scope has whole sentences of its own in the catalog, because the adjective agrees
   * with the noun and the count in most languages and cannot be dropped into one shared sentence.
   */
  noun: string;
  /** The statuses removed, so the count and the sentence are read from one place. */
  statuses: JobStatus[];
}

/**
 * One scope. `label` is a getter so the list can stay a constant: it is read when the menu renders,
 * in the language of that moment, rather than frozen in the language the module was loaded in.
 */
function clearScope(
  scope: string,
  key: JobClearScopeKey,
  noun: string,
  statuses: JobStatus[],
): JobClearScope {
  return {
    scope,
    key,
    noun,
    statuses,
    get label() {
      return jobsT(`clear.scopes.${key}.label`);
    },
  };
}

/**
 * The bulk clears the header menu offers.
 *
 * V1's menu holds two (`JobsApp.DataTable.cs:279-289`: Clear Completed, Clear Failed) — but its service
 * is already a *generic predicate clear* (`JobService.cs:676`, `ClearJobsByStatus`) and simply never
 * wires up the rest. So this is not a new mechanism: it is the remaining uses of V1's own primitive,
 * which is what the user asked for ("clear successful, clear timedout, clear cancelled, clear failed").
 *
 * Their wording maps onto V2's `JobStatus` names, and the **labels use V2's names** so a menu entry and
 * the Status badge it will remove read the same: "successful" is `Completed`, "cancelled" is `Stopped`
 * (V2 has no `Cancelled` — a stopped job is one that was cancelled, and its default status message says
 * so), and "timedout" is `Timeout`.
 *
 * `Running`, `Queued`, `Pending` and `Blocked` are absent and cannot be reached from here — nor from
 * anywhere else, because the daemon refuses them (`CLEARABLE_STATUSES` in `jobs/manager.rs`). A clear
 * only ever removes finished work.
 *
 * `all` is last because it is the widest, and it is `clear_all_jobs`' semantics: every terminal status,
 * which V1's service exposes as `ClearAllJobs` without ever putting it in a menu.
 */
export const JOB_CLEAR_SCOPES: readonly JobClearScope[] = [
  clearScope("Completed", "completed", "completed", ["Completed"]),
  clearScope("Failed", "failed", "failed", ["Failed"]),
  clearScope("Timeout", "timeout", "timed-out", ["Timeout"]),
  clearScope("Stopped", "stopped", "stopped", ["Stopped"]),
  clearScope("all", "all", "finished", ["Completed", "Failed", "Timeout", "Stopped"]),
];

/** What the clear confirm says and offers, for one scope and one count. */
export interface JobClearPrompt {
  /** The question, naming both what goes and how many. */
  body: string;
  /** The destructive button's label. */
  confirmLabel: string;
  /** True while there is nothing to confirm — no count yet, or nothing to remove. */
  confirmDisabled: boolean;
}

/**
 * The clear confirm's copy.
 *
 * A function rather than JSX in the dialog because the *sentence* is the safety mechanism: "Delete 412
 * completed jobs?" and "Delete completed jobs?" are different decisions, and V1 asks neither — it fires
 * `ClearCompletedJobs()` straight off the menu item. Three states, and each has to be right:
 *
 * - **not counted yet** (`null`): says so, and arms nothing. Offering a confirm a moment before the
 *   figure lands is how someone removes four hundred rows they thought were four.
 * - **nothing to remove**: says that instead of asking, and stays disarmed. A clear that would delete
 *   nothing is not a question worth answering.
 * - **n rows**: the number, the noun, and what goes with them.
 */
export function describeClearPrompt(
  scope: JobClearScope,
  count: number | null,
  t: TFunction<"jobs"> = jobsT,
): JobClearPrompt {
  if (count === null) {
    return {
      body: t(`clear.scopes.${scope.key}.counting`),
      confirmLabel: t("clear.confirm"),
      confirmDisabled: true,
    };
  }
  if (count === 0) {
    return {
      body: t(`clear.scopes.${scope.key}.empty`),
      confirmLabel: t("clear.confirm"),
      confirmDisabled: true,
    };
  }
  return {
    body: t(`clear.scopes.${scope.key}.confirm`, { count }),
    confirmLabel: t("clear.confirmCount", { count }),
    confirmDisabled: false,
  };
}

/**
 * How many rows a clear would remove, counted **over the whole table** rather than over the loaded
 * window.
 *
 * The window is fifty rows of a job history that can run to tens of thousands, so counting the rows in
 * hand would understate a clear by any margin at all — and "Clear 12 failed jobs" is only worth putting
 * in front of someone if the 12 is true. `POST /api/jobs/query` already answers the *filtered* total for
 * any filter, which is exactly this question; `limit: 1` and one column keep the reply to a row nobody
 * reads.
 */
export async function countJobsByStatus(statuses: readonly JobStatus[]): Promise<number> {
  const page = await queryJobsPage({
    offset: 0,
    limit: 1,
    sort: [],
    filter: whereColumn("status", "inSet", [...statuses]),
    selectColumns: ["Id"],
  });
  return page.totalRows;
}
