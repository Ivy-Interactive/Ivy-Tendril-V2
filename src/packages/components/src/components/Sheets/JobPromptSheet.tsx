import React from "react";
import { Spinner } from "../ui/spinner";
import { SheetPanel } from "../ui/sheet-panel";
import { useTranslation } from "@/i18n/uiJobs";

/**
 * Lazy because `CodeBlock` is the door to the syntax-highlighter chunk, which has no business
 * loading with the dialogs entry every sheet and confirm is fetched from.
 */
const CodeBlock = React.lazy(() =>
  import("../PlanMarkdown/CodeBlock").then((m) => ({ default: m.CodeBlock })),
);

export interface JobPromptSheetProps {
  isOpen: boolean;
  onClose: () => void;
  /**
   * The untruncated text behind the Prompt cell. Absent or blank for a job type that carries no
   * prose of its own (`ExpandPlan`, `SplitPlan`), which the sheet says rather than showing an
   * empty box.
   */
  prompt?: string;
  /** Overrides V1's "Full Prompt" title. */
  title?: string;
}

/**
 * V1's Full Prompt sheet (`Apps/Jobs/Sheets/PromptSheet.cs`), opened by the Jobs table's Prompt cell
 * (`JobsApp.cs:51` `showPrompt`). V1's entire body is
 * `new CodeBlock(promptText, Languages.Text).WrapLines()`, and so is this one's: a prompt is prose,
 * so it wraps rather than scrolling sideways.
 *
 * It owns its panel — the shared `SheetPanel` at V1's `UxHelper.SheetWidth` — like every sheet here.
 */
export const JobPromptSheet: React.FC<JobPromptSheetProps> = ({
  isOpen,
  onClose,
  prompt,
  title,
}) => {
  const { t } = useTranslation("uiJobs");
  const text = prompt?.trim() ? prompt : undefined;
  return (
    <SheetPanel
      open={isOpen}
      onClose={onClose}
      title={title ?? t("promptSheet.title")}
      data-testid="job-prompt-sheet"
    >
      {text ? (
        <React.Suspense
          fallback={
            <div className="flex h-32 items-center justify-center text-muted-foreground">
              <Spinner size="lg" className="text-success" aria-hidden="true" />
            </div>
          }
        >
          <div data-testid="job-prompt-text">
            <CodeBlock content={text} wrapLines />
          </div>
        </React.Suspense>
      ) : (
        <span className="text-xs text-muted-foreground" data-testid="job-prompt-empty">
          {t("promptSheet.empty")}
        </span>
      )}
    </SheetPanel>
  );
};
