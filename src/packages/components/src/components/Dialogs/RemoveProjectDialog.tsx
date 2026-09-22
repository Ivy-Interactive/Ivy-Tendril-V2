import { Trans, useTranslation } from "@/i18n/uiDialogs";
import { ConfirmDialog } from "./ConfirmDialog";

export interface RemoveProjectDialogProps {
  isOpen: boolean;
  onClose: () => void;
  /** The project's stored name, which is also the path segment the route is addressed by. */
  projectName: string;
  /** Removes the project. The caller owns the request, its busy state and its failure. */
  onConfirm: () => void | Promise<void>;
  isBusy?: boolean;
  /** A backend rejection, shown where the operator pressed the button. */
  error?: string | null;
}

/**
 * `ProjectDetailView.cs`'s Danger Zone button, whose `WithConfirm` is the only one in V1.
 *
 * This is the **reversible** half of the Danger Zone: removing a project deletes nothing. It drops
 * the `config.yaml` entry and nothing else - the clones under `<TENDRIL_HOME>/Projects/<name>/`
 * survive, the plan folders survive, and the rows in `Plans`, `Jobs` and `Recommendations` keep
 * naming a project the config no longer has. Adding the project back by name is enough to see all
 * of it again.
 *
 * It used to be called Delete Project, which is what V1 calls it too, and both were wrong in the
 * same way: a button labelled *delete* that deletes nothing. The copy below carried the whole
 * correction on its own, and an operator who did not read it had no way to know. So the label is
 * now the verb that happens - Remove - and `DeleteProjectDialog` is the one that means delete.
 *
 * Nothing to type, per point 4 of the contract in `ConfirmDialog`. That is the right weight for an
 * action that destroys nothing, and it is the difference the reader should see between this dialog
 * and its destructive sibling.
 *
 * **Presentational.** The request lives in the app's wrapper, which is what supplies `onConfirm`,
 * `isBusy` and `error` - on rejection the dialog stays open carrying the backend's message, because
 * a project that vanished from the sidebar and then came back is a lie the operator may act on.
 */
export function RemoveProjectDialog({
  isOpen,
  onClose,
  projectName,
  onConfirm,
  isBusy,
  error,
}: RemoveProjectDialogProps) {
  const { t } = useTranslation("uiDialogs");
  return (
    <ConfirmDialog
      isOpen={isOpen}
      onClose={onClose}
      title={t("removeProject.title")}
      testId="remove-project-dialog"
      width="rem40"
      confirmLabel={t("removeProject.confirm")}
      confirmVariant="destructive"
      onConfirm={onConfirm}
      isBusy={isBusy}
      error={error}
      body={
        <>
          <p>
            <Trans
              ns="uiDialogs"
              i18nKey="removeProject.question"
              values={{ name: projectName }}
              components={{ name: <span className="text-foreground" /> }}
            />
          </p>
          <p className="text-muted-foreground">{t("removeProject.consequence")}</p>
        </>
      }
    />
  );
}
