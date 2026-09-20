import React from "react";
import {
  Button,
  IconButton,
  Spinner,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@ivy-interactive/components/ui";
import { Bug, CircleCheck, CircleDashed, CircleX, Info } from "lucide-react";

import { agentsApi } from "../../api/agentsApi";
import { describeBridgeError } from "../../types/api";
import type { AgentAuthResult, ModelValidation, TestAgentResult } from "../../types/agents";
import { DialogShell } from "../dialogs/DialogShell";

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
 */

/**
 * `enum TestStatus`.
 *
 * Its own union rather than a widened `DoctorCheckStatus`: that one is the three values a daemon
 * doctor check can return, several `Record<DoctorCheckStatus, ...>` maps are exhaustive over it, and
 * "pending" and "running" are states of *this dialog* rather than results a check can have.
 */
export type TestStatus = "pending" | "running" | "passed" | "failed" | "warning";

export interface AgentTestRow {
  label: string;
  status: TestStatus;
  message?: string;
  /** The provider's own text, behind the row's Bug button. Absent when the check said nothing. */
  rawOutput?: string;
}

/** `record TestModelEntry(string? Id, string DisplayName)`. */
export interface TestModelEntry {
  /** The model id to validate. Empty means "whatever this agent defaults to". */
  id: string;
  displayName: string;
}

const STATUS_ICON: Record<TestStatus, React.ReactNode> = {
  passed: <CircleCheck className="size-4 text-success" aria-hidden />,
  failed: <CircleX className="size-4 text-destructive" aria-hidden />,
  warning: <Info className="size-4 text-warning" aria-hidden />,
  // `Icons.LoaderCircle.WithAnimation(AnimationType.Rotate)` is the bundle's one spinner here, so a
  // running row and every other in-flight control in the app rotate identically.
  running: <Spinner size="sm" className="text-muted-foreground" />,
  pending: <CircleDashed className="size-4 text-muted-foreground" aria-hidden />,
};

/** Screen readers get the status as a word; sighted users get the icon. */
const STATUS_LABEL: Record<TestStatus, string> = {
  passed: "Passed",
  failed: "Failed",
  warning: "Warning",
  running: "Running",
  pending: "Pending",
};

/** `results[0]`, from `CheckInstallAsync`. */
function installRow(result: TestAgentResult): AgentTestRow {
  const { install } = result;
  if (install.isInstalled) {
    return {
      label: "Installation",
      status: "passed",
      message: install.version ? `v${install.version}` : "Installed",
    };
  }
  return {
    label: "Installation",
    status: "failed",
    message: install.error ?? "Not installed",
    ...(install.error ? { rawOutput: install.error } : {}),
  };
}

/** `results[1]`, from `CheckAuthAsync`. */
function authRow(auth: AgentAuthResult): AgentTestRow {
  const provider = auth.provider ? ` (${auth.provider})` : "";
  if (auth.status === "authenticated") {
    return { label: "Authentication", status: "passed", message: `Authenticated${provider}` };
  }
  if (auth.status === "notAuthenticated") {
    return {
      label: "Authentication",
      status: "failed",
      // V1 shows the flat "Not authenticated" and keeps the detail behind the Bug button; the hint is
      // the one thing that says what to *do*, so it is appended where there is one.
      message: auth.signInHint ? `Not authenticated - ${auth.signInHint}` : "Not authenticated",
      ...(auth.error ? { rawOutput: auth.error } : {}),
    };
  }
  return {
    label: "Authentication",
    status: "warning",
    message: auth.error ?? "Check inconclusive",
    ...(auth.error ? { rawOutput: auth.error } : {}),
  };
}

/** `results[2 + i]`, from `ValidateModelAsync`. */
function modelRow(entry: TestModelEntry, validation: ModelValidation | undefined): AgentTestRow {
  const label = `Model: ${entry.displayName}`;
  if (!validation) return { label, status: "warning", message: "Not checked" };

  const raw = validation.errorMessage ? { rawOutput: validation.errorMessage } : {};
  switch (validation.status) {
    case "ok":
      return { label, status: "passed", message: "Ok" };
    case "invalidModel":
      return {
        label,
        status: "failed",
        message: validation.errorMessage ?? "Invalid model",
        ...raw,
      };
    case "authError":
      return { label, status: "failed", message: validation.errorMessage ?? "Auth error", ...raw };
    // The model is fine, its quota is not - a failure either way, since nothing run against it will
    // do any work until the quota clears.
    case "rateLimit":
      return {
        label,
        status: "failed",
        message: validation.errorMessage ?? "Quota exhausted or rate limited",
        ...raw,
      };
    default:
      return {
        label,
        status: validation.errorMessage ? "failed" : "warning",
        message: validation.errorMessage ?? "Unknown",
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
export function pendingRows(models: TestModelEntry[]): AgentTestRow[] {
  return [
    { label: "Installation", status: "pending" },
    { label: "Authentication", status: "pending" },
    ...models.map((model) => ({
      label: `Model: ${model.displayName}`,
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
export function rowsFromResult(models: TestModelEntry[], result: TestAgentResult): AgentTestRow[] {
  const rows: AgentTestRow[] = [installRow(result)];
  if (!result.install.isInstalled) {
    return [
      ...rows,
      { label: "Authentication", status: "pending" },
      ...models.map((model) => ({
        label: `Model: ${model.displayName}`,
        status: "pending" as const,
      })),
    ];
  }

  rows.push(
    result.auth
      ? authRow(result.auth)
      : { label: "Authentication", status: "warning", message: "Check inconclusive" },
  );
  models.forEach((model, index) => rows.push(modelRow(model, result.models[index])));
  return rows;
}

/** `catch (OperationCanceledException)`: everything still in flight becomes a Cancelled warning. */
export function cancelRows(rows: AgentTestRow[]): AgentTestRow[] {
  return rows.map((row) =>
    row.status === "running" || row.status === "pending"
      ? { ...row, status: "warning" as const, message: "Cancelled" }
      : row,
  );
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
  const [rows, setRows] = React.useState<AgentTestRow[]>([]);
  const [isTesting, setIsTesting] = React.useState(false);
  const [rawOutput, setRawOutput] = React.useState<string | null>(null);
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

    setRawOutput(null);
    setRows(pendingRows(entries));
    setIsTesting(true);

    agentsApi
      .testAgent(agent, { models: entries.map((entry) => entry.id) })
      .then((result) => {
        if (runId.current !== thisRun) return;
        setRows(rowsFromResult(entries, result));
      })
      .catch((err: unknown) => {
        if (runId.current !== thisRun) return;
        // `catch (Exception ex)`: an extra row rather than a replaced table, so the checks that did
        // get seeded stay visible alongside the reason the run stopped.
        setRows((prev) => [
          ...cancelRows(prev),
          {
            label: "Unexpected error",
            status: "failed",
            message: "Test run failed",
            rawOutput: describeBridgeError(err),
          },
        ]);
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
    setRows([]);
    setRawOutput(null);
    onClose();
  };

  return (
    <>
      <DialogShell
        isOpen={isOpen}
        onClose={close}
        title="Coding Agent Test"
        testId="agent-test-dialog"
        width="rem40"
        footer={
          <Button type="button" variant="outline" data-testid="agent-test-close" onClick={close}>
            {isTesting ? "Cancel" : "Close"}
          </Button>
        }
      >
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-16" />
              <TableHead>Test</TableHead>
              {/* `.ColumnWidth(r => r.Result, Size.Percent(60))`. */}
              <TableHead className="w-[60%]">Result</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.label} data-testid={`agent-test-row-${row.status}`}>
                <TableCell>
                  <div className="flex items-center gap-1">
                    <span title={STATUS_LABEL[row.status]}>
                      <span className="sr-only">{STATUS_LABEL[row.status]}</span>
                      {STATUS_ICON[row.status]}
                    </span>
                    {row.rawOutput !== undefined && (
                      <IconButton
                        label="Show raw output"
                        size="xs"
                        variant="outline"
                        data-testid="agent-test-raw-output"
                        onClick={() =>
                          setRawOutput((current) =>
                            current === row.rawOutput ? null : (row.rawOutput ?? null),
                          )
                        }
                      >
                        <Bug className="size-3" aria-hidden />
                      </IconButton>
                    )}
                  </div>
                </TableCell>
                <TableCell>{row.label}</TableCell>
                <TableCell className="text-muted-foreground">{row.message}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </DialogShell>

      {/* `AgentTestDebugDialog`, a second dialog rather than an expanded row: the raw output is a
          provider's stderr, which is routinely longer than the table it came from. */}
      <DialogShell
        isOpen={rawOutput !== null}
        onClose={() => setRawOutput(null)}
        title="Raw Output"
        testId="agent-test-raw-dialog"
        footer={
          <Button
            type="button"
            variant="outline"
            data-testid="agent-test-raw-close"
            onClick={() => setRawOutput(null)}
          >
            Close
          </Button>
        }
      >
        <pre className="whitespace-pre-wrap break-words rounded-field bg-muted p-3 font-mono text-xs">
          {rawOutput}
        </pre>
      </DialogShell>
    </>
  );
};
