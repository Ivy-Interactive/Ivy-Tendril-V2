import React from "react";
import { ConfirmDialog } from "@ivy-interactive/components/dialogs";
import { Trans, useTranslation } from "../../i18n";

/**
 * The kinds of entry that have removal copy of their own, `settings:removal.title_<kind>` and
 * `settings:removal.body_<kind>`. They are ids, never shown: each language words a whole title and
 * question for each, because one that inflects cannot drop a noun into a fixed sentence.
 */
export type RemovalKind =
  | "level"
  | "repository"
  | "reviewAction"
  | "environmentFile"
  | "mcpServer"
  | "customSkill";

/**
 * The English nouns callers have always passed as `kind`, each routed to its own copy. A caller that
 * still passes one of these (the Project settings rows do) gets the whole per-kind title and question
 * in every language, not the generic template with an English noun dropped into it.
 */
const KIND_BY_NOUN: Readonly<Record<string, RemovalKind>> = {
  level: "level",
  repository: "repository",
  "review action": "reviewAction",
  "environment file": "environmentFile",
  "MCP server": "mcpServer",
  "custom skill": "customSkill",
};

/** What is about to be removed, and what to do once the operator says yes. */
export type RemovalRequest = {
  /** The entry's own name or path, quoted back so the operator can see they picked the right row. */
  name: string;
  /**
   * What is lost beyond the entry itself, when anything is. Nothing here means the entry is the whole
   * story, and the dialog says only that it is removed from the configuration.
   */
  consequence?: React.ReactNode;
  onConfirm: () => void;
} & (
  | {
      /** Which kind of entry this is. The dialog's words are looked up from it. */
      kindId: RemovalKind;
      kind?: never;
    }
  | {
      kindId?: never;
      /**
       * What the thing is, as a noun. One of the English nouns in {@link KIND_BY_NOUN} ("review
       * action", "MCP server", …) is routed to that kind's own copy. Any other noun must already be
       * translated, in lower case because it is used mid-sentence ("Remove {{kind}} <name>…"); only
       * the title, which English capitalises, upper-cases its first letter. Prefer `kindId`.
       */
      kind: string;
    }
);

/** The kind whose own copy the dialog uses, or the caller's free-form noun when it has none. */
function removalKindOf(
  request: RemovalRequest,
): { kindId: RemovalKind; noun?: never } | { kindId?: never; noun: string } {
  if (request.kindId !== undefined) return { kindId: request.kindId };
  return Object.hasOwn(KIND_BY_NOUN, request.kind)
    ? { kindId: KIND_BY_NOUN[request.kind] }
    : { noun: request.kind };
}

/**
 * The confirm every destructive row action in Settings goes through.
 *
 * Framework's rule, from `Ivy-Framework/src/claude-plugin/skills/ivy-create-app/references/
 * DesignGuidelines.md:147`: "Confirm destructive actions: Use `.WithConfirm()` — **never delete on
 * single click**." Every `Delete` row action here used to write `config.yaml` on the click itself,
 * with no way back and no undo.
 *
 * It composes the same `ConfirmDialog` as the plan and job deletes, so the contract is identical:
 * Cancel first and focused, the destructive confirm last, nothing to type, Escape cancels, a click
 * outside does not dismiss.
 *
 * The copy is deliberately lighter than a plan deletion's. These are configuration entries — a level
 * or a skill reference can be added straight back from the same screen — so the body says what is
 * removed and where from, and does not borrow the language of something irreversible. Where removal
 * *does* reach further than the row (a review action's run order, an env file's variables), the
 * caller says so in `consequence`.
 *
 * Deliberately not a dialog *file* per section: `LevelsSection` notes that this area owns no dialog
 * files, and six near-identical ones would be six chances to drift apart.
 */
export function useRemovalConfirm(): {
  /** Opens the confirm. The action runs only if it is confirmed. */
  requestRemoval: (request: RemovalRequest) => void;
  /** Render once, anywhere in the section. */
  removalDialog: React.ReactNode;
} {
  const { t } = useTranslation("settings");
  const [request, setRequest] = React.useState<RemovalRequest | null>(null);

  const close = () => setRequest(null);
  const kind = request ? removalKindOf(request) : null;

  const removalDialog =
    request && kind ? (
      <ConfirmDialog
        isOpen
        onClose={close}
        // Framework's own titles are `Delete {Entity}` (`ProductsApp.cs:176`), capitalised. A known
        // kind's title carries its own casing; only a caller's free-form noun is capitalised here.
        title={
          kind.kindId !== undefined
            ? t("removal.title", { context: kind.kindId })
            : t("removal.title", { kind: kind.noun.replace(/^./, (c) => c.toUpperCase()) })
        }
        testId="settings-remove-dialog"
        confirmLabel={t("removal.confirm")}
        confirmVariant="destructive"
        onConfirm={() => {
          // Closed first: the write is synchronous from here and the dialog has nothing left to report.
          close();
          request.onConfirm();
        }}
        body={
          <>
            <p>
              <Trans
                ns="settings"
                i18nKey="removal.body"
                context={kind.kindId}
                values={
                  kind.kindId !== undefined
                    ? { name: request.name }
                    : { kind: kind.noun, name: request.name }
                }
                components={{ name: <span className="text-foreground" /> }}
              />
            </p>
            {request.consequence !== undefined && (
              <p className="text-muted-foreground">{request.consequence}</p>
            )}
          </>
        }
      />
    ) : null;

  return { requestRemoval: setRequest, removalDialog };
}
