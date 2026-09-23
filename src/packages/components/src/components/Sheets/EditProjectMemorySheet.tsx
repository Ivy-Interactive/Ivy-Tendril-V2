import * as React from "react";
import { useTranslation } from "@/i18n/uiSettings";
import { Button } from "../ui/button";
import { Callout } from "../ui/callout";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { SheetPanel } from "../ui/sheet-panel";
import { Spinner } from "../ui/spinner";
import { Textarea } from "../ui/textarea";

/** What the sheet saves: the file name as typed (the daemon appends `.md`) and its markdown. */
export interface ProjectMemoryDraft {
  fileName: string;
  content: string;
}

export interface EditProjectMemorySheetProps {
  open: boolean;
  onClose: () => void;
  projectName: string;
  /** The file being edited, or `null` to add a new one — V1's `existingFileName`. */
  existingFileName?: string | null;
  /** The file's current markdown, once the host has read it. */
  initialContent?: string;
  /** The host is still reading {@link initialContent}; the form is held back until it lands. */
  isLoading?: boolean;
  onSave: (draft: ProjectMemoryDraft) => void;
  isSaving?: boolean;
  /** A failed read or write, shown in the sheet so the typed content is not lost. */
  error?: string | null;
}

/** V1's default for a new memory (`UseState(existingFileName ?? "stack.md")`). */
export const DEFAULT_MEMORY_FILE_NAME = "stack.md";

/**
 * `Apps/Settings/Sheets/EditProjectMemorySheet.cs` (and its blade twin
 * `Blades/EditProjectMemoryBladeView.cs`): a file name and its markdown, written to
 * `<TENDRIL_HOME>/Projects/<Project>/Memory/`.
 *
 * **Presentational.** Reading the existing file and writing the new one are the app's
 * (`PUT /api/projects/:name/memory/:file`); this owns only the two fields. Renaming an existing
 * file is allowed — the host passes the old name along so the daemon can move it — and a missing
 * `.md` is appended by the daemon, as V1 does on save.
 *
 * The content field is a monospace textarea rather than V1's markdown `CodeInput`: the only code
 * editor in the library is CodeMirror with a YAML grammar, and a memory file is prose.
 */
export function EditProjectMemorySheet({
  open,
  onClose,
  projectName,
  existingFileName,
  initialContent = "",
  isLoading = false,
  onSave,
  isSaving = false,
  error,
}: EditProjectMemorySheetProps) {
  const { t } = useTranslation("uiSettings");
  const isNew = !existingFileName;
  const [fileName, setFileName] = React.useState(existingFileName ?? DEFAULT_MEMORY_FILE_NAME);
  const [content, setContent] = React.useState(initialContent);

  // Re-seeded whenever the sheet is (re)opened on a file, and when the host's read lands.
  React.useEffect(() => {
    if (!open) return;
    setFileName(existingFileName ?? DEFAULT_MEMORY_FILE_NAME);
    setContent(initialContent);
  }, [open, existingFileName, initialContent]);

  const canSave = fileName.trim() !== "" && !isSaving && !isLoading;

  return (
    <SheetPanel
      open={open}
      onClose={onClose}
      title={
        isNew
          ? t("projectMemory.addTitle")
          : t("projectMemory.editTitle", { fileName: existingFileName ?? "" })
      }
      description={t("projectMemory.description", { project: projectName })}
      data-testid="edit-project-memory-sheet"
    >
      {isLoading ? (
        <div
          className="flex items-center gap-2 text-sm text-muted-foreground"
          data-testid="edit-project-memory-loading"
        >
          <Spinner size="sm" />
          {t("projectMemory.loading")}
        </div>
      ) : (
        <form
          className="flex h-full min-h-0 flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (canSave) onSave({ fileName: fileName.trim(), content });
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="project-memory-file-name">{t("projectMemory.fileName.label")}</Label>
            <Input
              id="project-memory-file-name"
              value={fileName}
              required
              aria-required="true"
              placeholder={t("projectMemory.fileName.placeholder")}
              onChange={(event) => setFileName(event.target.value)}
            />
          </div>

          {/* `.Height(Size.Units(80))` in V1: the field takes what the sheet has left. */}
          <div className="flex min-h-0 flex-1 flex-col space-y-1.5">
            <Label htmlFor="project-memory-content">{t("projectMemory.content.label")}</Label>
            <Textarea
              id="project-memory-content"
              value={content}
              placeholder={t("projectMemory.content.placeholder")}
              className="min-h-80 flex-1 font-mono text-xs"
              onChange={(event) => setContent(event.target.value)}
            />
          </div>

          {error && <Callout.Error data-testid="edit-project-memory-error">{error}</Callout.Error>}

          <div className="flex shrink-0 justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose}>
              {t("projectMemory.cancel")}
            </Button>
            <Button type="submit" disabled={!canSave} data-testid="edit-project-memory-save">
              {isSaving ? <Spinner size="sm" /> : null}
              {isNew ? t("projectMemory.add") : t("projectMemory.save")}
            </Button>
          </div>
        </form>
      )}
    </SheetPanel>
  );
}
