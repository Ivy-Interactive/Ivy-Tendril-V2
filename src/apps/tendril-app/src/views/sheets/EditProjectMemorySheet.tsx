import React from "react";
import { EditProjectMemorySheet as EditProjectMemorySheetView } from "@ivy-interactive/components/dialogs";
import { bridge } from "../../api/bridge";
import { describeBridgeError } from "../../types/api";

export interface EditProjectMemorySheetProps {
  open: boolean;
  onClose: () => void;
  projectName: string;
  /** The file to edit, or `null` to add one. */
  fileName: string | null;
  /** Called with the stored file name once the write lands, so the table can re-read. */
  onSaved: (fileName: string) => void;
}

/**
 * The connected half of the library's `EditProjectMemorySheet` (V1
 * `Apps/Settings/Sheets/EditProjectMemorySheet.cs`): reads the file when the sheet opens on one, and
 * writes it through `PUT /api/projects/:name/memory/:file` — passing the old name along, so editing
 * the name renames the file rather than leaving a copy behind. A refused write keeps the sheet open
 * with the typed content and the daemon's message.
 */
export function EditProjectMemorySheet({
  open,
  onClose,
  projectName,
  fileName,
  onSaved,
}: EditProjectMemorySheetProps) {
  const [content, setContent] = React.useState("");
  const [isLoading, setIsLoading] = React.useState(false);
  const [isSaving, setIsSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    setError(null);
    setIsSaving(false);
    setContent("");
    if (!fileName) {
      setIsLoading(false);
      return;
    }
    let cancelled = false;
    setIsLoading(true);
    bridge
      .getProjectMemory(projectName, fileName)
      .then((file) => {
        if (!cancelled) setContent(file.content);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(describeBridgeError(err));
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, projectName, fileName]);

  return (
    <EditProjectMemorySheetView
      open={open}
      onClose={onClose}
      projectName={projectName}
      existingFileName={fileName}
      initialContent={content}
      isLoading={isLoading}
      isSaving={isSaving}
      error={error}
      onSave={async (draft) => {
        setIsSaving(true);
        setError(null);
        try {
          const saved = await bridge.saveProjectMemory(
            projectName,
            draft.fileName,
            draft.content,
            fileName ?? undefined,
          );
          onSaved(saved.fileName);
          onClose();
        } catch (err) {
          setError(describeBridgeError(err));
        } finally {
          setIsSaving(false);
        }
      }}
    />
  );
}
