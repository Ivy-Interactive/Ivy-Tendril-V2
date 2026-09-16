import React from "react";
import { Plus } from "lucide-react";
import {
  Badge,
  Button,
  Callout,
  DataTable,
  type DataTableColumn,
} from "@ivy-interactive/components/ui";
import { notificationsStore } from "../../state/notificationsStore";
import { describeBridgeError } from "../../types/api";
import { SaveError, SectionCard, TextField } from "./fields";
import type { LevelEntry } from "./projectConfig";

/**
 * `Apps/Settings/LevelsSetupView.cs`: the priority levels plans are categorised by, in `config.yaml`
 * order rather than sorted, with Add / Edit / Delete.
 *
 * `levels` is a top-level sequence and `merge_config_value` replaces sequences, so unlike `ports` all
 * three verbs work: the whole list is sent every time.
 *
 * Two deliberate departures from V1. `EditLevelDialogContent` is a dialog; this edits in place below
 * the table, because this area owns no dialog files. And V1's colour picker is a select over the Ivy
 * `Colors` enum, which V2's generated palette has no equivalent for, so the colour is edited as the
 * name `config.yaml` stores.
 *
 * The callout is not cosmetic: `levels` is modelled by the daemon and advertised over MCP, but
 * nothing in V2's UI reads it, so an operator editing these would otherwise expect an effect that
 * does not exist.
 */

export interface LevelsSectionProps {
  levels: LevelEntry[];
  onSaveRaw: (key: string, value: unknown) => Promise<void>;
}

type Draft = { index: number | null; name: string; color: string };

const levelToWire = (level: LevelEntry): Record<string, unknown> => ({
  ...level.rest,
  name: level.name,
  color: level.color,
  ...(level.badge === undefined ? {} : { badge: level.badge }),
});

export const LevelsSection: React.FC<LevelsSectionProps> = ({ levels, onSaveRaw }) => {
  const [draft, setDraft] = React.useState<Draft | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [isSaving, setIsSaving] = React.useState(false);

  const write = async (next: LevelEntry[], message: string) => {
    setIsSaving(true);
    setError(null);
    try {
      await onSaveRaw("levels", next.map(levelToWire));
      notificationsStore.notifySuccess("Saved", message);
      setDraft(null);
    } catch (err) {
      setError(`Failed to save level: ${describeBridgeError(err)}`);
    } finally {
      setIsSaving(false);
    }
  };

  const columns: DataTableColumn<LevelEntry>[] = [
    { name: "name", header: "Name", accessor: (row) => row.name },
    {
      name: "color",
      header: "Color",
      accessor: (row) => row.color,
      cell: (_value, row) => <Badge variant="secondary">{row.color || "unset"}</Badge>,
    },
  ];

  const submitDraft = () => {
    if (!draft || draft.name.trim() === "") return;
    const next = [...levels];
    const entry: LevelEntry = {
      name: draft.name.trim(),
      color: draft.color.trim(),
      badge: draft.index === null ? undefined : levels[draft.index]?.badge,
      rest: draft.index === null ? {} : (levels[draft.index]?.rest ?? {}),
    };
    if (draft.index === null) next.push(entry);
    else next[draft.index] = entry;
    void write(next, "Level saved");
  };

  return (
    <SectionCard
      title="Priority Levels"
      hint="Define priority levels used to categorize plans."
      testId="levels-card"
      action={
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setDraft({ index: null, name: "", color: "Gray" })}
        >
          <Plus className="size-4" aria-hidden />
          Add Level
        </Button>
      }
    >
      <div className="max-w-170 space-y-4">
        <DataTable<LevelEntry>
          data-testid="levels-table"
          paginated={false}
          columns={columns}
          rows={levels}
          getRowId={(row) => row.name}
          rowActions={[
            { tag: "edit", label: "Edit" },
            { tag: "delete", label: "Delete", variant: "destructive" },
          ]}
          emptyState={<span className="text-muted-foreground">No levels defined.</span>}
          onRowAction={({ tag, row }) => {
            const index = levels.findIndex((level) => level.name === row.name);
            if (tag === "edit") {
              setDraft({ index, name: row.name, color: row.color });
            } else if (tag === "delete") {
              void write(
                levels.filter((_, i) => i !== index),
                `Level '${row.name}' deleted`,
              );
            }
          }}
        />

        {draft && (
          <form
            className="space-y-3 border-t border-border pt-4"
            data-testid="level-editor"
            onSubmit={(e) => {
              e.preventDefault();
              submitDraft();
            }}
          >
            <h3 className="text-sm font-semibold text-foreground">
              {draft.index === null ? "Add Level" : "Edit Level"}
            </h3>
            <TextField
              id="level-name"
              label="Name"
              value={draft.name}
              placeholder="Level name..."
              onChange={(value) => setDraft((prev) => (prev ? { ...prev, name: value } : prev))}
            />
            <TextField
              id="level-color"
              label="Color"
              value={draft.color}
              placeholder="e.g. Blue"
              hint="An Ivy colour name, as config.yaml stores it (Red, Blue, Purple, Slate, Gray...)."
              onChange={(value) => setDraft((prev) => (prev ? { ...prev, color: value } : prev))}
            />
            <div className="flex flex-wrap items-center gap-2">
              <Button type="submit" disabled={draft.name.trim() === "" || isSaving}>
                {isSaving ? "Saving..." : draft.index === null ? "Add" : "Save"}
              </Button>
              <Button type="button" variant="outline" onClick={() => setDraft(null)}>
                Cancel
              </Button>
            </div>
          </form>
        )}

        <SaveError message={error} />

        <Callout.Warning data-testid="levels-no-effect">
          Levels are stored in config.yaml and advertised over MCP, but nothing in this app reads
          them yet, so editing them here changes no behaviour you can see.
        </Callout.Warning>
      </div>
    </SectionCard>
  );
};
