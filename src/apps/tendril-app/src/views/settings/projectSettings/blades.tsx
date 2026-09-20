import React from "react";
import { Check, Loader2, X } from "lucide-react";
import { Button, Input, Switch, useBlades } from "@ivy-interactive/components/ui";
import { bridge } from "../../../api/bridge";
import { notificationsStore } from "../../../state/notificationsStore";
import { describeBridgeError } from "../../../types/api";
import { LinesField, TextField } from "../fields";
import { formatEnvLines, parseEnvLines } from "../configValues";
import {
  PORTS_ARE_MERGED,
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
 * reaches directly as `renameProject` and `deleteProject`.
 */

/** The Cancel/confirm pair every V1 `*BladeView` ends with. */
const BladeFooter: React.FC<{
  confirmLabel: string;
  disabled?: boolean;
  onConfirm: () => void;
}> = ({ confirmLabel, disabled, onConfirm }) => {
  const { pop } = useBlades();
  return (
    <div className="flex flex-wrap items-center gap-2 pt-2">
      <Button type="button" variant="outline" onClick={() => pop(1)}>
        Cancel
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
  const [name, setName] = React.useState(existing?.name ?? "");
  const [command, setCommand] = React.useState(existing?.command ?? "");
  const [condition, setCondition] = React.useState(existing?.condition ?? "");

  const invalid = name.trim() === "" || command.trim() === "";

  return (
    <div className="max-w-170 space-y-4">
      <TextField
        id="review-action-name"
        label="Name"
        value={name}
        placeholder="Action name..."
        onChange={setName}
      />
      <TextField
        id="review-action-command"
        label="Command"
        value={command}
        placeholder="e.g. dotnet test"
        onChange={setCommand}
      />
      <TextField
        id="review-action-condition"
        label="Condition"
        value={condition}
        placeholder="e.g. ${hasChanges}"
        onChange={setCondition}
      />
      <BladeFooter
        confirmLabel={existing ? "Save" : "Add"}
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
  const [name, setName] = React.useState("");
  const [prompt, setPrompt] = React.useState("");

  const trimmed = name.trim();
  const duplicate =
    trimmed !== "" && existingNames.some((n) => n.toLowerCase() === trimmed.toLowerCase());

  return (
    <div className="max-w-170 space-y-4">
      <TextField
        id="verification-name"
        label="Name"
        value={name}
        placeholder="Verification name..."
        error={duplicate ? `A verification named '${trimmed}' already exists.` : null}
        onChange={setName}
      />
      <LinesField
        id="verification-prompt"
        label="Prompt"
        value={prompt}
        rows="tall"
        placeholder="Verification prompt..."
        onChange={setPrompt}
      />
      <BladeFooter
        confirmLabel="Add"
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
  const [args, setArgs] = React.useState((existing?.arguments ?? []).join(" "));
  const [env, setEnv] = React.useState(formatEnvLines(existing?.environment ?? {}));
  const [disabled, setDisabled] = React.useState(existing?.disabled ?? false);

  const invalid = name.trim() === "" || command.trim() === "";

  return (
    <div className="max-w-170 space-y-4">
      <TextField
        id="mcp-name"
        label="Name"
        value={name}
        placeholder="Server name (e.g. sqlite)..."
        onChange={setName}
      />
      <TextField
        id="mcp-command"
        label="Command"
        value={command}
        placeholder="Command executable (e.g. npx)..."
        onChange={setCommand}
      />
      <TextField
        id="mcp-arguments"
        label="Arguments"
        value={args}
        placeholder="Arguments (e.g. -y @modelcontextprotocol/server-sqlite)..."
        hint="Split on whitespace, the way EditMcpServerBladeView splits them."
        onChange={setArgs}
      />
      <LinesField
        id="mcp-environment"
        label="Environment Variables"
        value={env}
        placeholder={"KEY=VALUE"}
        hint="One KEY=VALUE per line."
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
          Disabled
        </label>
      </div>
      <BladeFooter
        confirmLabel={existing ? "Save" : "Add"}
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
  const [instructions, setInstructions] = React.useState(existing?.instructions ?? "");
  const [path, setPath] = React.useState(existing?.path ?? "");
  const [disabled, setDisabled] = React.useState(existing?.disabled ?? false);

  return (
    <div className="max-w-170 space-y-4">
      <TextField
        id="skill-name"
        label="Name"
        value={name}
        placeholder="Skill name (e.g. code-review)..."
        onChange={setName}
      />
      <TextField
        id="skill-description"
        label="Description"
        value={description}
        placeholder="Short description..."
        onChange={setDescription}
      />
      <LinesField
        id="skill-instructions"
        label="Instructions"
        value={instructions}
        rows="tall"
        placeholder="Markdown instructions for the agent..."
        onChange={setInstructions}
      />
      <TextField
        id="skill-path"
        label="File/Folder Path"
        value={path}
        placeholder="Path to skill folder/file (e.g. %TENDRIL_HOME%/Skills/my-skill)..."
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
          Disabled
        </label>
      </div>
      <BladeFooter
        confirmLabel={existing ? "Save" : "Add"}
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
        label="Name"
        value={name}
        placeholder="e.g. backend"
        error={renaming ? PORTS_ARE_MERGED : null}
        hint="Port identifier referenced in environment overrides via ${ports.<name>} placeholders."
        onChange={setName}
      />
      <TextField
        id="port-default"
        label="Default Port"
        value={port}
        placeholder="3000"
        error={portInvalid ? "Default Port must be between 1 and 65535." : null}
        hint="Preferred port. If it is already taken, Tendril allocates a free one instead."
        onChange={setPort}
      />
      <TextField
        id="port-description"
        label="Description"
        value={description}
        placeholder="What listens here..."
        onChange={setDescription}
      />
      <BladeFooter
        confirmLabel={existing ? "Save" : "Add"}
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
  const [template, setTemplate] = React.useState(existing?.template ?? "");
  const [overrides, setOverrides] = React.useState(formatEnvLines(existing?.overrides ?? {}));

  return (
    <div className="max-w-170 space-y-4">
      <TextField
        id="env-file-path"
        label="Path"
        value={path}
        placeholder="e.g. apps/web/.env"
        hint="Relative path to the environment file recreated inside the plan worktree."
        onChange={setPath}
      />
      <TextField
        id="env-file-template"
        label="Template"
        value={template}
        placeholder="e.g. .env.example"
        hint="Optional base template copied into the worktree before overrides are applied."
        onChange={setTemplate}
      />
      <LinesField
        id="env-file-overrides"
        label="Overrides"
        value={overrides}
        rows="tall"
        placeholder={"PORT=${ports.backend}"}
        hint="KEY=VALUE lines supporting ${ports.<name>}, ${env.<VAR>} and %VAR% placeholders."
        onChange={setOverrides}
      />
      <BladeFooter
        confirmLabel={existing ? "Save" : "Add"}
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
          ? `A project named '${trimmed}' already exists.`
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
      notificationsStore.notifySuccess("Renamed", `Renamed project to '${stored}'`);
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
          aria-label="Project name"
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
          title="Confirm rename"
          aria-label="Confirm rename"
          data-testid="confirm-rename"
          onClick={() => void commit()}
        >
          {isSaving ? (
            <Loader2 className="size-4 animate-spin" aria-hidden />
          ) : (
            <Check className="size-4" aria-hidden />
          )}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          disabled={isSaving}
          title="Cancel rename"
          aria-label="Cancel rename"
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
