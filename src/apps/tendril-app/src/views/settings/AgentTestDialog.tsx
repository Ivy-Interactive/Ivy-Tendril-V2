import React from "react";
import {
  AgentTestDialog as AgentTestDialogView,
  type AgentTestRow,
  type AgentTestStatus,
} from "@ivy-interactive/components/dialogs";

import { agentsApi } from "../../api/agentsApi";
import { i18n, useTranslation, type TFunction } from "../../i18n";
import { describeBridgeError } from "../../types/api";
import type {
  AgentAuthResult,
  AgentSignInHint,
  ModelValidation,
  TestAgentResult,
} from "../../types/agents";

/**
 * `Apps/Settings/Dialogs/AgentTestDialog.cs`.
 *
 * V1 runs three checks from the UI thread, one row at a time, against the agent's
 * `IAgentHealthCheck`: is the CLI here, is it signed in, and will each configured model answer a
 * one-off prompt. V2 has no health check in the renderer - the probes shell out to a CLI and read
 * `~/.claude/.credentials.json`, neither of which a webview can do - so the whole run is one
 * `POST /api/agents/:agent/test` and the daemon sequences it.
 *
 * That difference is visible in exactly one place: V1 fills the table row by row as each check
 * returns, and this fills it once. The rows are still seeded Pending and the run still shows as
 * running, so the shape is V1's; what it cannot do is say *which* check it is on. Streaming it would
 * mean an SSE channel for a dialog that is open for a few seconds, and the daemon has to run the
 * checks sequentially anyway - three real prompts fired at once at an account near its rate limit is
 * the thing that exhausts the quota.
 *
 * This file is the connected half. The table and the raw-output dialog behind each row's Bug button
 * (`AgentTestDebugDialog.cs`) are `AgentTestDialog` in the component library, which renders the rows
 * it is handed; running the checks, wording every verdict and abandoning a cancelled run stay here.
 */

/** `enum TestStatus`; the union is the library dialog's, so the rows built here are its rows. */
export type TestStatus = AgentTestStatus;
export type { AgentTestRow };

/** `record TestModelEntry(string? Id, string DisplayName)`. */
export interface TestModelEntry {
  /** The model id to validate. Empty means "whatever this agent defaults to". */
  id: string;
  /** The model's name in the row. Ignored for the empty id, which the row names at render time. */
  displayName: string;
}

/**
 * The name a model row shows. The agent-default entry is worded here, at render, rather than by
 * whoever built the entry: a run keeps its entries, so a name translated up front would stay in the
 * language the run started in.
 */
function modelName(entry: TestModelEntry, t: TFunction<"settingsAgents">): string {
  return entry.id === "" ? t("test.defaultModel") : entry.displayName;
}

/**
 * The row builders' `t` when the caller passes none - the unit tests, which call them directly.
 * Follows the language at every call, so it is safe to create here. The dialog passes its own, and
 * builds the rows at render time from the run's data, so an open table follows a language change.
 */
const defaultT: TFunction<"settingsAgents"> = i18n.getFixedT(null, "settingsAgents");

/** `results[0]`, from `CheckInstallAsync`. */
function installRow(result: TestAgentResult, t: TFunction<"settingsAgents">): AgentTestRow {
  const { install } = result;
  if (install.isInstalled) {
    return {
      label: t("test.rows.install"),
      status: "passed",
      message: install.version
        ? t("test.install.version", { version: install.version })
        : t("test.install.installed"),
    };
  }
  return {
    label: t("test.rows.install"),
    status: "failed",
    message: install.error ?? t("test.install.notInstalled"),
    ...(install.error ? { rawOutput: install.error } : {}),
  };
}

/**
 * The shortest honest rendering of a structured sign-in hint: the first documented route.
 *
 * The daemon lists every route, best first, and the Help section under the pane renders all of them
 * with their alternatives and console links. This is one row in a results table, so it takes the
 * best one only. `then` is a slash command typed at the prompt the shell line opens, so it is joined
 * with "then" rather than concatenated - `copilot /login` would be a prompt, not a login. A hint
 * with no command at all is a bring-your-own provider, whose answer is a console to open.
 *
 * Each shape is one whole sentence, "Not authenticated" included, rather than a hint appended to a
 * prefix, so a translation can order it however its language needs to.
 */
function notAuthenticatedMessage(
  hint: AgentSignInHint | undefined,
  t: TFunction<"settingsAgents">,
): string {
  const route = hint?.auth.commands[0];
  if (route) {
    return route.then
      ? t("test.auth.notAuthenticatedRunThen", { command: route.command, prompt: route.then })
      : t("test.auth.notAuthenticatedRun", { command: route.command });
  }
  return hint?.auth.url
    ? t("test.auth.notAuthenticatedCreateKey", { url: hint.auth.url })
    : t("test.auth.notAuthenticated");
}

/** `results[1]`, from `CheckAuthAsync`. */
function authRow(auth: AgentAuthResult, t: TFunction<"settingsAgents">): AgentTestRow {
  if (auth.status === "authenticated") {
    return {
      label: t("test.rows.auth"),
      status: "passed",
      message: auth.provider
        ? t("test.auth.authenticatedWith", { provider: auth.provider })
        : t("test.auth.authenticated"),
    };
  }
  if (auth.status === "notAuthenticated") {
    return {
      label: t("test.rows.auth"),
      status: "failed",
      // V1 shows the flat "Not authenticated" and keeps the detail behind the Bug button; the hint is
      // the one thing that says what to *do*, so it is appended where there is one. The hint is the
      // daemon's structured value, rendered here as one line - the Help section under the pane
      // renders the same value in full, which is the point of it being data rather than a sentence.
      message: notAuthenticatedMessage(auth.signInHint ?? undefined, t),
      ...(auth.error ? { rawOutput: auth.error } : {}),
    };
  }
  return {
    label: t("test.rows.auth"),
    status: "warning",
    message: auth.error ?? t("test.auth.inconclusive"),
    ...(auth.error ? { rawOutput: auth.error } : {}),
  };
}

/** `results[2 + i]`, from `ValidateModelAsync`. */
function modelRow(
  entry: TestModelEntry,
  validation: ModelValidation | undefined,
  t: TFunction<"settingsAgents">,
): AgentTestRow {
  const label = t("test.rows.model", { name: modelName(entry, t) });
  if (!validation) return { label, status: "warning", message: t("test.model.notChecked") };

  const raw = validation.errorMessage ? { rawOutput: validation.errorMessage } : {};
  switch (validation.status) {
    case "ok":
      return { label, status: "passed", message: t("test.model.ok") };
    case "invalidModel":
      return {
        label,
        status: "failed",
        message: validation.errorMessage ?? t("test.model.invalidModel"),
        ...raw,
      };
    case "authError":
      return {
        label,
        status: "failed",
        message: validation.errorMessage ?? t("test.model.authError"),
        ...raw,
      };
    // The model is fine, its quota is not - a failure either way, since nothing run against it will
    // do any work until the quota clears.
    case "rateLimit":
      return {
        label,
        status: "failed",
        message: validation.errorMessage ?? t("test.model.rateLimit"),
        ...raw,
      };
    default:
      return {
        label,
        status: validation.errorMessage ? "failed" : "warning",
        message: validation.errorMessage ?? t("common:status.unknown"),
        ...raw,
      };
  }
}

/**
 * The seeded table: Installation, Authentication, then one row per model, all Pending.
 *
 * Seeded before the request rather than built from its reply, so the dialog opens on the list of
 * checks it is about to run instead of on an empty box.
 */
export function pendingRows(
  models: TestModelEntry[],
  t: TFunction<"settingsAgents"> = defaultT,
): AgentTestRow[] {
  return [
    { label: t("test.rows.install"), status: "pending" },
    { label: t("test.rows.auth"), status: "pending" },
    ...models.map((model) => ({
      label: t("test.rows.model", { name: modelName(model, t) }),
      status: "pending" as const,
    })),
  ];
}

/**
 * The reply, as rows.
 *
 * A missing CLI short-circuits: the daemon returns no auth and no models in that case, and V1 stops
 * the run there for the same reason - an auth probe against a binary that is not there reports a
 * spawn failure and teaches nobody anything. The remaining rows stay Pending rather than being
 * reported as failures they were never given the chance to be.
 */
export function rowsFromResult(
  models: TestModelEntry[],
  result: TestAgentResult,
  t: TFunction<"settingsAgents"> = defaultT,
): AgentTestRow[] {
  const rows: AgentTestRow[] = [installRow(result, t)];
  if (!result.install.isInstalled) {
    return [
      ...rows,
      { label: t("test.rows.auth"), status: "pending" },
      ...models.map((model) => ({
        label: t("test.rows.model", { name: modelName(model, t) }),
        status: "pending" as const,
      })),
    ];
  }

  rows.push(
    result.auth
      ? authRow(result.auth, t)
      : { label: t("test.rows.auth"), status: "warning", message: t("test.auth.inconclusive") },
  );
  models.forEach((model, index) => rows.push(modelRow(model, result.models[index], t)));
  return rows;
}

/** `catch (OperationCanceledException)`: everything still in flight becomes a Cancelled warning. */
export function cancelRows(
  rows: AgentTestRow[],
  t: TFunction<"settingsAgents"> = defaultT,
): AgentTestRow[] {
  return rows.map((row) =>
    row.status === "running" || row.status === "pending"
      ? { ...row, status: "warning" as const, message: t("test.cancelled") }
      : row,
  );
}

/**
 * Where the dialog's current run has got to, kept as data rather than as rows so the table is worded
 * at render time. `entries` are the models the run was started with: the pane rebuilds its list on
 * every render, and the table describes the checks this run asked for.
 */
type TestRun =
  | { phase: "pending"; entries: TestModelEntry[] }
  | { phase: "done"; entries: TestModelEntry[]; result: TestAgentResult }
  | { phase: "failed"; entries: TestModelEntry[]; error: string };

/**
 * `catch (Exception ex)`: an extra row rather than a replaced table, so the checks that did get
 * seeded stay visible alongside the reason the run stopped.
 */
function failedRows(
  entries: TestModelEntry[],
  error: string,
  t: TFunction<"settingsAgents">,
): AgentTestRow[] {
  return [
    ...cancelRows(pendingRows(entries, t), t),
    {
      label: t("test.rows.unexpectedError"),
      status: "failed",
      message: t("test.runFailed"),
      rawOutput: error,
    },
  ];
}

function runRows(run: TestRun | null, t: TFunction<"settingsAgents">): AgentTestRow[] {
  if (run === null) return [];
  switch (run.phase) {
    case "pending":
      return pendingRows(run.entries, t);
    case "done":
      // A reply the builders cannot read fails the run, as it did when the rows were built in the
      // request's own `then` and a throw there landed in its `catch`.
      try {
        return rowsFromResult(run.entries, run.result, t);
      } catch (err) {
        return failedRows(run.entries, describeBridgeError(err), t);
      }
    case "failed":
      return failedRows(run.entries, run.error, t);
  }
}

export interface AgentTestDialogProps {
  isOpen: boolean;
  onClose: () => void;
  /** The resolved agent id to test - `resolveFinalAgent`'s answer, not the card key. */
  agent: string;
  /** `getModels()`: the deduplicated tier models, in Deep / Balanced / Quick order. */
  models: TestModelEntry[];
}

export const AgentTestDialog: React.FC<AgentTestDialogProps> = ({
  isOpen,
  onClose,
  agent,
  models,
}) => {
  const { t } = useTranslation("settingsAgents");
  const [run, setRun] = React.useState<TestRun | null>(null);
  const rows = React.useMemo(() => runRows(run, t), [run, t]);
  const [isTesting, setIsTesting] = React.useState(false);
  /**
   * Bumped by close and by an agent change, and captured by each run. There is no cancel token to
   * hand the daemon - the request is already in flight and the probes it started are running on the
   * daemon's side - so cancelling here means this dialog stops listening, which is what V1's
   * `OperationCanceledException` branch amounts to for the operator.
   */
  const runId = React.useRef(0);

  const modelsRef = React.useRef(models);
  modelsRef.current = models;

  React.useEffect(() => {
    if (!isOpen) return;
    const thisRun = ++runId.current;
    const entries = modelsRef.current;

    setRun({ phase: "pending", entries });
    setIsTesting(true);

    agentsApi
      .testAgent(agent, { models: entries.map((entry) => entry.id) })
      .then((result) => {
        if (runId.current !== thisRun) return;
        setRun({ phase: "done", entries, result });
      })
      .catch((err: unknown) => {
        if (runId.current !== thisRun) return;
        setRun({ phase: "failed", entries, error: describeBridgeError(err) });
      })
      .finally(() => {
        if (runId.current !== thisRun) return;
        setIsTesting(false);
      });
    // `models` is deliberately absent: it is rebuilt on every render of the pane behind this dialog,
    // and depending on it would restart the run on each keystroke there. The run is keyed on the
    // dialog opening and on the agent changing, which is when V1 re-runs it too.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, agent]);

  const close = () => {
    // Abandons whatever is in flight, so a reopen starts clean rather than being overwritten by the
    // previous run's reply.
    runId.current += 1;
    setIsTesting(false);
    setRun(null);
    onClose();
  };

  return <AgentTestDialogView isOpen={isOpen} onClose={close} rows={rows} isTesting={isTesting} />;
};
