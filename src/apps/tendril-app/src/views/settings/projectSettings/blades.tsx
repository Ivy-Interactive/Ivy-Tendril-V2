import React from "react";
import { Check, X } from "lucide-react";
import { Button, Input, Spinner, Switch, useBlades } from "@ivy-interactive/components/ui";
import { bridge } from "../../../api/bridge";
import { useTranslation } from "../../../i18n";
import { notificationsStore } from "../../../state/notificationsStore";
import { describeBridgeError } from "../../../types/api";
import { LinesField, TextField } from "../fields";
import { formatEnvLines, parseEnvLines } from "../configValues";
import {
  type ProjectEnvFileConfigEntry,
  type ProjectMcpServerRefEntry,
  type ProjectPortConfigEntry,
  type ProjectSkillRefEntry,
  type ReviewActionConfigEntry,
} from "../projectConfig";
import { describeProjectNameError } from "../../onboarding/validation";

/**
 * Neither rename nor delete can go through this screen's usual `PUT /api/config` write: that route
 * merges `projects` by name, so a renamed entry matches nothing and is appended beside the original,
 * and its own documentation says omission is not deletion. Both take their own daemon route -
 * `PUT /api/projects/:name` with `newName`, and `DELETE /api/projects/:name` - which the bridge
 * reaches directly as `renameProject` and `removeProject`.
 */

/** The Cancel/confirm pair every V1 `*BladeView` ends with. */
const BladeFooter: React.FC<{
  confirmLabel: string;
  disabled?: boolean;
  onConfirm: () => void;
}> = ({ confirmLabel, disabled, onConfirm }) => {
  const { t } = useTranslation("settingsProjects");
  const { pop } = useBlades();
  return (
    <div className="flex flex-wrap items-center gap-2 pt-2">
      <Button type="button" variant="outline" onClick={() => pop(1)}>
        {t("common:actions.cancel")}
      </Button>
      <Button type="button" disabled={disabled} onClick={onConfirm}>
        {confirmLabel}
      </Button>
    </div>
  );
};

/* ------------------------------------------------------------------------- blades */

/** `Blades/EditReviewActionBladeView.cs`: name and command are required, condition optional. */
export const ReviewActionBlade: React.FC<{
  existing: ReviewActionConfigEntry | null;
  onSubmit: (action: ReviewActionConfigEntry) => void;
}> = ({ existing, onSubmit }) => {
  const { t } = useTranslation("settingsProjects");
  const [name, setName] = React.useState(existing?.name ?? "");
  const [command, setCommand] = React.useState(existing?.command ?? "");
  const [condition, setCondition] = React.useState(existing?.condition ?? "");

  const invalid = name.trim() === "" || command.trim() === "";

  return (
    <div className="max-w-170 space-y-4">
      <TextField
        id="review-action-name"
        label={t("reviewActionBlade.name.label")}
        value={name}
        placeholder={t("reviewActionBlade.name.placeholder")}
        onChange={setName}
      />
      <TextField
        id="review-action-command"
        label={t("reviewActionBlade.command.label")}
        value={command}
        placeholder={t("reviewActionBlade.command.placeholder")}
        onChange={setCommand}
      />
      <TextField
        id="review-action-condition"
        label={t("reviewActionBlade.condition.label")}
        value={condition}
        placeholder={t("reviewActionBlade.condition.placeholder", { example: "${hasChanges}" })}
        onChange={setCondition}
      />
      <BladeFooter
        confirmLabel={existing ? t("common:actions.save") : t("bladeFooter.add")}
        disabled={invalid}
        onConfirm={() =>
          onSubmit({
            ...(existing ?? { paths: [], rest: {} }),
            name: name.trim(),
            command,
            condition,
          })
        }
      />
    </div>
  );
};

/**
 * `Blades/EditVerificationBladeView.cs`: it appends to the **global** `verifications` registry and
 * then enables the new entry on the project, which is why it takes both writes.
 */
export const VerificationBlade: React.FC<{
  onSubmit: (name: string, prompt: string) => void;
  existingNames: string[];
}> = ({ onSubmit, existingNames }) => {
  const { t } = useTranslation("settingsProjects");
  const [name, setName] = React.useState("");
  const [prompt, setPrompt] = React.useState("");

  const trimmed = name.trim();
  const duplicate =
    trimmed !== "" && existingNames.some((n) => n.toLowerCase() === trimmed.toLowerCase());

  return (
    <div className="max-w-170 space-y-4">
      <TextField
        id="verification-name"
        label={t("verificationBlade.name.label")}
        value={name}
        placeholder={t("verificationBlade.name.placeholder")}
        error={duplicate ? t("verificationBlade.name.duplicate", { name: trimmed }) : null}
        onChange={setName}
      />
      <LinesField
        id="verification-prompt"
        label={t("verificationBlade.prompt.label")}
        value={prompt}
        rows="tall"
        placeholder={t("verificationBlade.prompt.placeholder")}
        onChange={setPrompt}
      />
      <BladeFooter
        confirmLabel={t("bladeFooter.add")}
        disabled={trimmed === "" || duplicate}
        onConfirm={() => onSubmit(trimmed, prompt)}
      />
    </div>
  );
};

/** `Blades/EditMcpServerBladeView.cs`, including its whitespace-split arguments. */
export const McpServerBlade: React.FC<{
  existing: ProjectMcpServerRefEntry | null;
  onSubmit: (server: ProjectMcpServerRefEntry) => void;
}> = ({ existing, onSubmit }) => {
  const [name, setName] = React.useState(existing?.name ?? "");
  const [command, setCommand] = React.useState(existing?.command ?? "");
  const { t } = useTranslation("settingsProjects");
  const [args, setArgs] = React.useState((existing?.arguments ?? []).join(" "));
  const [env, setEnv] = React.useState(formatEnvLines(existing?.environment ?? {}));
  const [disabled, setDisabled] = React.useState(existing?.disabled ?? false);

  const invalid = name.trim() === "" || command.trim() === "";

  return (
    <div className="max-w-170 space-y-4">
      <TextField
        id="mcp-name"
        label={t("mcpServerBlade.name.label")}
        value={name}
        placeholder={t("mcpServerBlade.name.placeholder")}
        onChange={setName}
      />
      <TextField
        id="mcp-command"
        label={t("mcpServerBlade.command.label")}
        value={command}
        placeholder={t("mcpServerBlade.command.placeholder")}
        onChange={setCommand}
      />
      <TextField
        id="mcp-arguments"
        label={t("mcpServerBlade.arguments.label")}
        value={args}
        placeholder={t("mcpServerBlade.arguments.placeholder")}
        hint={t("mcpServerBlade.arguments.hint")}
        onChange={setArgs}
      />
      <LinesField
        id="mcp-environment"
        label={t("mcpServerBlade.environment.label")}
        value={env}
        placeholder={"KEY=VALUE"}
        hint={t("mcpServerBlade.environment.hint")}
        onChange={setEnv}
      />
      <div className="flex items-center gap-3">
        <Switch
          id="mcp-disabled"
          aria-labelledby="mcp-disabled-label"
          checked={disabled}
          onCheckedChange={setDisabled}
        />
        <label
          id="mcp-disabled-label"
          htmlFor="mcp-disabled"
          className="text-xs font-medium text-foreground"
        >
          {t("mcpServerBlade.disabled")}
        </label>
      </div>
      <BladeFooter
        confirmLabel={existing ? t("common:actions.save") : t("bladeFooter.add")}
        disabled={invalid}
        onConfirm={() =>
          onSubmit({
            ...(existing ?? { rest: {} }),
            name: name.trim(),
            command: command.trim(),
            arguments: args.split(/\s+/).filter((arg) => arg !== ""),
            environment: parseEnvLines(env),
            disabled,
          })
        }
      />
    </div>
  );
};

/** `Blades/EditSkillBladeView.cs`. */
export const SkillBlade: React.FC<{
  existing: ProjectSkillRefEntry | null;
  onSubmit: (skill: ProjectSkillRefEntry) => void;
}> = ({ existing, onSubmit }) => {
  const [name, setName] = React.useState(existing?.name ?? "");
  const [description, setDescription] = React.useState(existing?.description ?? "");
  const { t } = useTranslation("settingsProjects");
  const [instructions, setInstructions] = React.useState(existing?.instructions ?? "");
  const [path, setPath] = React.useState(existing?.path ?? "");
  const [disabled, setDisabled] = React.useState(existing?.disabled ?? false);

  return (
    <div className="max-w-170 space-y-4">
      <TextField
        id="skill-name"
        label={t("skillBlade.name.label")}
        value={name}
        placeholder={t("skillBlade.name.placeholder")}
        onChange={setName}
      />
      <TextField
        id="skill-description"
        label={t("skillBlade.description.label")}
        value={description}
        placeholder={t("skillBlade.description.placeholder")}
        onChange={setDescription}
      />
      <LinesField
        id="skill-instructions"
        label={t("skillBlade.instructions.label")}
        value={instructions}
        rows="tall"
        placeholder={t("skillBlade.instructions.placeholder")}
        onChange={setInstructions}
      />
      <TextField
        id="skill-path"
        label={t("skillBlade.path.label")}
        value={path}
        placeholder={t("skillBlade.path.placeholder")}
        onChange={setPath}
      />
      <div className="flex items-center gap-3">
        <Switch
          id="skill-disabled"
          aria-labelledby="skill-disabled-label"
          checked={disabled}
          onCheckedChange={setDisabled}
        />
        <label
          id="skill-disabled-label"
          htmlFor="skill-disabled"
          className="text-xs font-medium text-foreground"
        >
          {t("skillBlade.disabled")}
        </label>
      </div>
      <BladeFooter
        confirmLabel={existing ? t("common:actions.save") : t("bladeFooter.add")}
        disabled={name.trim() === ""}
        onConfirm={() =>
          onSubmit({
            ...(existing ?? { rest: {} }),
            name: name.trim(),
            description: description.trim(),
            instructions,
            path,
            disabled,
          })
        }
      />
    </div>
  );
};

/** `Dialogs/EditProjectPortDialog.cs`, as a blade so every project editor opens the same way. */
export const PortBlade: React.FC<{
  existing: ProjectPortConfigEntry | null;
  onSubmit: (port: ProjectPortConfigEntry) => void;
}> = ({ existing, onSubmit }) => {
  const [name, setName] = React.useState(existing?.name ?? "");
  const { t } = useTranslation("settingsProjects");
  const [port, setPort] = React.useState(String(existing?.defaultPort ?? 3000));
  const [description, setDescription] = React.useState(existing?.description ?? "");

  const parsed = Number.parseInt(port, 10);
  const portInvalid = !Number.isInteger(parsed) || parsed < 1 || parsed > 65535;
  // A rename would leave the old key behind, because the merge cannot remove one.
  const renaming = existing !== null && name.trim() !== existing.name;

  return (
    <div className="max-w-170 space-y-4">
      <TextField
        id="port-name"
        label={t("portBlade.name.label")}
        value={name}
        placeholder={t("portBlade.name.placeholder")}
        error={renaming ? t("ports.mergeLimitation") : null}
        hint={t("portBlade.name.hint", { placeholder: "${ports.<name>}" })}
        onChange={setName}
      />
      <TextField
        id="port-default"
        label={t("portBlade.defaultPort.label")}
        value={port}
        placeholder="3000"
        error={portInvalid ? t("portBlade.defaultPort.invalid") : null}
        hint={t("portBlade.defaultPort.hint")}
        onChange={setPort}
      />
      <TextField
        id="port-description"
        label={t("portBlade.description.label")}
        value={description}
        placeholder={t("portBlade.description.placeholder")}
        onChange={setDescription}
      />
      <BladeFooter
        confirmLabel={existing ? t("common:actions.save") : t("bladeFooter.add")}
        disabled={name.trim() === "" || portInvalid || renaming}
        onConfirm={() =>
          onSubmit({
            ...(existing ?? { rest: {} }),
            name: name.trim(),
            defaultPort: parsed,
            description,
          })
        }
      />
    </div>
  );
};

/** `Dialogs/EditProjectEnvFileDialog.cs`, with its `KEY=VALUE` override lines. */
export const EnvFileBlade: React.FC<{
  existing: ProjectEnvFileConfigEntry | null;
  onSubmit: (file: ProjectEnvFileConfigEntry) => void;
}> = ({ existing, onSubmit }) => {
  const [path, setPath] = React.useState(existing?.path ?? "");
  const { t } = useTranslation("settingsProjects");
  const [template, setTemplate] = React.useState(existing?.template ?? "");
  const [overrides, setOverrides] = React.useState(formatEnvLines(existing?.overrides ?? {}));

  return (
    <div className="max-w-170 space-y-4">
      <TextField
        id="env-file-path"
        label={t("envFileBlade.path.label")}
        value={path}
        placeholder={t("envFileBlade.path.placeholder")}
        hint={t("envFileBlade.path.hint")}
        onChange={setPath}
      />
      <TextField
        id="env-file-template"
        label={t("envFileBlade.template.label")}
        value={template}
        placeholder={t("envFileBlade.template.placeholder")}
        hint={t("envFileBlade.template.hint")}
        onChange={setTemplate}
      />
      <LinesField
        id="env-file-overrides"
        label={t("envFileBlade.overrides.label")}
        value={overrides}
        rows="tall"
        placeholder={"PORT=${ports.backend}"}
        hint={t("envFileBlade.overrides.hint", {
          ports: "${ports.<name>}",
          env: "${env.<VAR>}",
          variable: "%VAR%",
        })}
        onChange={setOverrides}
      />
      <BladeFooter
        confirmLabel={existing ? t("common:actions.save") : t("bladeFooter.add")}
        disabled={path.trim() === ""}
        onConfirm={() =>
          onSubmit({
            ...(existing ?? { rest: {} }),
            path: path.trim(),
            template: template.trim(),
            overrides: parseEnvLines(overrides),
          })
        }
      />
    </div>
  );
};

/**
 * `ProjectDetailView`'s `nameHeader`: the H2 becomes a text input with a confirm and a cancel beside
 * it, and reverts once either is pressed. V1's confirm is synchronous - it edits the in-memory
 * project and calls `SaveSettings()` - so it has nowhere to put a failure and never needs a busy
 * state; this one is a daemon round trip that can be refused, so it has both, and the input stays
 * open carrying the message rather than closing on a rename that did not happen.
 *
 * The check is `EditProjectBladeView`'s, in its order: `DescribeProjectNameError` first, then V1's
 * case-insensitive duplicate scan over every *other* project. It is a message under the field rather
 * than a failed round trip; the daemon answers 409 on a collision either way.
 *
 * V1 also moves the project directory (`ProjectPathHelper.MoveProjectDirectory`) before it saves.
 * `update_project` does not - it renames the config entry and re-points the plan rows that name it -
 * so the clones stay where they are and no copy of this can promise otherwise.
 */
export const ProjectNameEditor: React.FC<{
  name: string;
  siblingNames: string[];
  onReloadConfig: () => Promise<void>;
  onDone: () => void;
}> = ({ name, siblingNames, onReloadConfig, onDone }) => {
  const { t } = useTranslation("settingsProjects");
  const [draft, setDraft] = React.useState(name);
  const [isSaving, setIsSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const trimmed = draft.trim();
  /**
   * Skipped while the draft still *is* the stored name, so a project already named something
   * `InputSanitizer` would refuse - V1 wrote plenty, its inline rename never validated - does not
   * open its own editor showing an error about a name nobody typed. Everything else is
   * `EditProjectBladeView`'s check in its order: the character set, then V1's case-insensitive scan
   * over `siblingNames`, which already excludes this project the way V1's
   * `projectsList.Where((_, i) => i != editIndex)` does.
   */
  const validationError =
    trimmed === name
      ? null
      : (describeProjectNameError(draft) ??
        (siblingNames.some((sibling) => sibling.toLowerCase() === trimmed.toLowerCase())
          ? t("nameEditor.duplicate", { name: trimmed })
          : null));

  const commit = async () => {
    // V1's no-op arm: the same name, case included, closes the editor without a write. A case-only
    // change is not one - `update_project` accepts it and rewrites config.yaml with the new casing.
    if (trimmed === name) {
      onDone();
      return;
    }
    if (validationError) return;

    setIsSaving(true);
    setError(null);
    try {
      // The daemon's echo, not `trimmed`: the route trims before it stores, so this is the name that
      // will match on the next read.
      const stored = await bridge.renameProject(name, trimmed);
      await onReloadConfig();
      notificationsStore.notifySuccess(
        t("notifications.renamed"),
        t("nameEditor.renamed", { name: stored }),
      );
      // Nothing re-points the selection: `update_project` renames the entry in place, so the
      // `project:<index>` tag still resolves, and the screen is keyed on the project's name, so the
      // reload above remounts it under the new one. That remount is also what unmounts this editor -
      // `onDone` is here for the case where the reload silently failed and the key did not change.
      onDone();
    } catch (err) {
      setError(describeBridgeError(err));
      setIsSaving(false);
    }
  };

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-1">
        <Input
          aria-label={t("nameEditor.ariaLabel")}
          data-testid="project-name-input"
          value={draft}
          disabled={isSaving}
          autoFocus
          className="h-8 w-60"
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") void commit();
            // Escape reverts. It does not go through `onDone` alone because the draft is this
            // component's state and it is remounted, not reset, the next time the pencil is pressed.
            if (event.key === "Escape") onDone();
          }}
        />
        <Button
          type="button"
          variant="ghost"
          size="icon"
          disabled={isSaving || validationError !== null}
          title={t("nameEditor.confirm")}
          aria-label={t("nameEditor.confirm")}
          data-testid="confirm-rename"
          onClick={() => void commit()}
        >
          {isSaving ? <Spinner size="md" aria-hidden /> : <Check className="size-4" aria-hidden />}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          disabled={isSaving}
          title={t("nameEditor.cancel")}
          aria-label={t("nameEditor.cancel")}
          onClick={onDone}
        >
          <X className="size-4" aria-hidden />
        </Button>
      </div>
      {(validationError ?? error) && (
        <p className="text-xs text-destructive" data-testid="project-name-error">
          {validationError ?? error}
        </p>
      )}
    </div>
  );
};
