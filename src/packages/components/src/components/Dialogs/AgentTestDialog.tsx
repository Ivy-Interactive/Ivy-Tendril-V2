import * as React from "react";
import { Bug, CircleCheck, CircleDashed, CircleX, Info } from "lucide-react";
import { useTranslation } from "@/i18n/uiSettings";
import { Button } from "../ui/button";
import { IconButton } from "../ui/IconButton";
import { Spinner } from "../ui/spinner";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../ui/table";
import { DialogShell } from "./DialogShell";

/**
 * `enum TestStatus` (`Apps/Settings/Dialogs/AgentTestDialog.cs`).
 *
 * Its own union rather than a widened doctor-check status: "pending" and "running" are states of
 * *this dialog* rather than results a check can have.
 */
export type AgentTestStatus = "pending" | "running" | "passed" | "failed" | "warning";

/** One row of the results table: `record TestResult(string Test, TestStatus Status, ...)`. */
export interface AgentTestRow {
  label: string;
  status: AgentTestStatus;
  message?: string;
  /** The provider's own text, behind the row's Bug button. Absent when the check said nothing. */
  rawOutput?: string;
}

export interface AgentTestDialogProps {
  isOpen: boolean;
  /** Close — or, while {@link isTesting}, cancel; the footer button is labelled accordingly. */
  onClose: () => void;
  /** Already worded by the host: the check names and verdicts are the host's to translate. */
  rows: AgentTestRow[];
  /** A run is in flight, so the footer offers Cancel rather than Close. */
  isTesting?: boolean;
}

const STATUS_ICON: Record<AgentTestStatus, React.ReactNode> = {
  passed: <CircleCheck className="size-4 text-success" aria-hidden />,
  failed: <CircleX className="size-4 text-destructive" aria-hidden />,
  warning: <Info className="size-4 text-warning" aria-hidden />,
  // `Icons.LoaderCircle.WithAnimation(AnimationType.Rotate)` is the bundle's one spinner here, so a
  // running row and every other in-flight control in the app rotate identically.
  running: <Spinner size="sm" className="text-muted-foreground" />,
  pending: <CircleDashed className="size-4 text-muted-foreground" aria-hidden />,
};

export interface AgentTestDebugDialogProps {
  isOpen: boolean;
  onClose: () => void;
  output: string;
}

/**
 * `Apps/Settings/Dialogs/AgentTestDebugDialog.cs`: one check's raw provider output.
 *
 * A second dialog rather than an expanded row: the raw output is a provider's stderr, which is
 * routinely longer than the table it came from.
 */
export function AgentTestDebugDialog({ isOpen, onClose, output }: AgentTestDebugDialogProps) {
  const { t } = useTranslation("uiSettings");
  return (
    <DialogShell
      isOpen={isOpen}
      onClose={onClose}
      title={t("agentTest.rawOutputTitle")}
      testId="agent-test-raw-dialog"
      footer={
        <Button
          type="button"
          variant="outline"
          data-testid="agent-test-raw-close"
          onClick={onClose}
        >
          {t("agentTest.close")}
        </Button>
      }
    >
      <pre className="whitespace-pre-wrap break-words rounded-field bg-muted p-3 font-mono text-xs">
        {output}
      </pre>
    </DialogShell>
  );
}

/**
 * `Apps/Settings/Dialogs/AgentTestDialog.cs`: the Installation / Authentication / per-model checks
 * for one coding agent, as a status table.
 *
 * **Presentational.** It renders the rows it is given; running the checks (one
 * `POST /api/agents/:agent/test`), wording each verdict and cancelling a run are the app's
 * `views/settings/AgentTestDialog.tsx`. The one piece of state kept here is which row's raw output
 * is open, since that is purely a matter of what is on screen.
 */
export function AgentTestDialog({
  isOpen,
  onClose,
  rows,
  isTesting = false,
}: AgentTestDialogProps) {
  const { t } = useTranslation("uiSettings");
  const [rawOutput, setRawOutput] = React.useState<string | null>(null);

  // A reopened dialog starts without the previous run's raw output on top of it.
  React.useEffect(() => {
    if (!isOpen) setRawOutput(null);
  }, [isOpen]);

  return (
    <>
      <DialogShell
        isOpen={isOpen}
        onClose={onClose}
        title={t("agentTest.title")}
        testId="agent-test-dialog"
        width="rem40"
        footer={
          <Button type="button" variant="outline" data-testid="agent-test-close" onClick={onClose}>
            {isTesting ? t("agentTest.cancel") : t("agentTest.close")}
          </Button>
        }
      >
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-16" />
              <TableHead>{t("agentTest.columns.test")}</TableHead>
              {/* `.ColumnWidth(r => r.Result, Size.Percent(60))`. */}
              <TableHead className="w-[60%]">{t("agentTest.columns.result")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.label} data-testid={`agent-test-row-${row.status}`}>
                <TableCell>
                  <div className="flex items-center gap-1">
                    {/* Screen readers get the status as a word; sighted users get the icon. */}
                    <span title={t(`agentTest.status.${row.status}`)}>
                      <span className="sr-only">{t(`agentTest.status.${row.status}`)}</span>
                      {STATUS_ICON[row.status]}
                    </span>
                    {row.rawOutput !== undefined && (
                      <IconButton
                        label={t("agentTest.showRawOutput")}
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

      <AgentTestDebugDialog
        isOpen={rawOutput !== null}
        onClose={() => setRawOutput(null)}
        output={rawOutput ?? ""}
      />
    </>
  );
}
