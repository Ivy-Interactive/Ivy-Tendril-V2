import * as React from "react";
import { Trans, useTranslation } from "@/i18n/uiSettings";
import { ConfirmDialog } from "./ConfirmDialog";

/**
 * The kinds of Settings entry that have removal copy of their own (`uiSettings:removal.title_<kind>`
 * and `removal.body_<kind>`). They are ids, never shown: each language words a whole title and
 * question per kind, because one that inflects cannot drop a noun into a fixed sentence.
 */
export type SettingsRemovalKind =
  | "level"
  | "repository"
  | "reviewAction"
  | "environmentFile"
  | "mcpServer"
  | "customSkill"
  | "memoryFile";

/** A known kind, worded by its own copy — or a caller's already-translated lower-case noun. */
export type SettingsRemovalSubject = { kindId: SettingsRemovalKind } | { noun: string };

export interface RemoveSettingsEntryDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  subject: SettingsRemovalSubject;
  /** The entry's own name or path, quoted back so the operator can see they picked the right row. */
  name: string;
  /**
   * What is lost beyond the entry itself, when anything is. Nothing here means the entry is the whole
   * story, and the dialog says only that it is removed from the configuration.
   */
  consequence?: React.ReactNode;
}

/**
 * The confirm every destructive row action in Settings goes through — `useRemovalConfirm` in the
 * app renders it, and every table's `Delete` (levels, repos, review actions, env files, MCP servers,
 * custom skills, project memories) opens it.
 *
 * Framework's rule, from `Ivy-Framework/src/claude-plugin/skills/ivy-create-app/references/
 * DesignGuidelines.md:147`: "Confirm destructive actions: Use `.WithConfirm()` — **never delete on
 * single click**." V1 wrote `config.yaml` on the click itself for all of these.
 *
 * It composes `ConfirmDialog`, so the contract is the plan and job deletes': Cancel first and
 * focused, the destructive confirm last, nothing to type, Escape cancels, a click outside does not
 * dismiss. The copy is deliberately lighter than a plan deletion's — these are configuration
 * entries that can be added straight back from the same screen — so the body says what is removed
 * and where from, and leaves anything further to `consequence`.
 */
export function RemoveSettingsEntryDialog({
  isOpen,
  onClose,
  onConfirm,
  subject,
  name,
  consequence,
}: RemoveSettingsEntryDialogProps) {
  const { t } = useTranslation("uiSettings");
  const kindId = "kindId" in subject ? subject.kindId : undefined;
  const noun = "noun" in subject ? subject.noun : undefined;

  return (
    <ConfirmDialog
      isOpen={isOpen}
      onClose={onClose}
      // Framework's own titles are `Delete {Entity}` (`ProductsApp.cs:176`), capitalised. A known
      // kind's title carries its own casing; only a caller's free-form noun is capitalised here.
      title={
        kindId !== undefined
          ? t("removal.title", { context: kindId })
          : t("removal.title", { kind: (noun ?? "").replace(/^./, (c) => c.toUpperCase()) })
      }
      testId="settings-remove-dialog"
      confirmLabel={t("removal.confirm")}
      confirmVariant="destructive"
      onConfirm={onConfirm}
      body={
        <>
          <p>
            <Trans
              ns="uiSettings"
              i18nKey="removal.body"
              context={kindId}
              values={kindId !== undefined ? { name } : { kind: noun ?? "", name }}
              components={{ name: <span className="text-foreground" /> }}
            />
          </p>
          {consequence !== undefined && <p className="text-muted-foreground">{consequence}</p>}
        </>
      }
    />
  );
}
