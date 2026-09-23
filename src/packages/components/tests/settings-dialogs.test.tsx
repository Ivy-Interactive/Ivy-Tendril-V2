import "@testing-library/jest-dom";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vite-plus/test";
import {
  AgentTestDialog,
  DiscardConfigChangesDialog,
  ImportRepoAssetsDialog,
  RemoveSettingsEntryDialog,
  VaultThemesDialog,
  parseThemeJson,
  vaultThemeId,
  type VaultTheme,
} from "../src/components/Dialogs/index.ts";
import { EditProjectMemorySheet } from "../src/components/Sheets/index.ts";

/** The Settings dialogs and sheets (V1 `Apps/Settings/Dialogs`, `Apps/Settings/Sheets`). */

describe("RemoveSettingsEntryDialog", () => {
  it("words a known kind with its own copy and confirms destructively", () => {
    const onConfirm = vi.fn();
    render(
      <RemoveSettingsEntryDialog
        isOpen
        onClose={() => {}}
        onConfirm={onConfirm}
        subject={{ kindId: "memoryFile" }}
        name="stack.md"
        consequence="The file is deleted."
      />,
    );
    const dialog = screen.getByTestId("settings-remove-dialog");
    expect(dialog).toHaveTextContent("Remove Memory file");
    expect(dialog).toHaveTextContent("Remove memory file stack.md from this project?");
    fireEvent.click(within(dialog).getByTestId("dialog-confirm"));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("capitalises a free noun in the title only", () => {
    render(
      <RemoveSettingsEntryDialog
        isOpen
        onClose={() => {}}
        onConfirm={() => {}}
        subject={{ noun: "port" }}
        name="frontend"
      />,
    );
    const dialog = screen.getByTestId("settings-remove-dialog");
    expect(dialog).toHaveTextContent("Remove Port");
    expect(dialog).toHaveTextContent("Remove port frontend from this configuration?");
  });
});

describe("DiscardConfigChangesDialog", () => {
  it("keeps the config editor's test id and copy", () => {
    render(<DiscardConfigChangesDialog isOpen onClose={() => {}} onConfirm={() => {}} />);
    expect(screen.getByTestId("config-editor-reload-dialog")).toHaveTextContent(
      "Discard Unsaved Changes",
    );
  });
});

describe("AgentTestDialog", () => {
  it("offers Cancel while testing and opens a row's raw output", () => {
    const { rerender } = render(
      <AgentTestDialog
        isOpen
        onClose={() => {}}
        isTesting
        rows={[{ label: "Installation", status: "running" }]}
      />,
    );
    expect(screen.getByTestId("agent-test-close")).toHaveTextContent("Cancel");

    rerender(
      <AgentTestDialog
        isOpen
        onClose={() => {}}
        rows={[{ label: "Authentication", status: "failed", rawOutput: "exit 1" }]}
      />,
    );
    expect(screen.getByTestId("agent-test-close")).toHaveTextContent("Close");
    fireEvent.click(screen.getByTestId("agent-test-raw-output"));
    expect(within(screen.getByTestId("agent-test-raw-dialog")).getByText("exit 1")).toBeDefined();
  });
});

describe("EditProjectMemorySheet", () => {
  it("adds with V1's default name and hands back what was typed", () => {
    const onSave = vi.fn();
    render(
      <EditProjectMemorySheet open onClose={() => {}} projectName="Tendril" onSave={onSave} />,
    );
    expect(screen.getByLabelText("Filename")).toHaveValue("stack.md");
    fireEvent.change(screen.getByLabelText("Content (Markdown)"), {
      target: { value: "# Stack" },
    });
    fireEvent.click(screen.getByTestId("edit-project-memory-save"));
    expect(onSave).toHaveBeenCalledWith({ fileName: "stack.md", content: "# Stack" });
  });

  it("will not save a blank name", () => {
    const onSave = vi.fn();
    render(
      <EditProjectMemorySheet
        open
        onClose={() => {}}
        projectName="Tendril"
        existingFileName="stack.md"
        initialContent="x"
        onSave={onSave}
      />,
    );
    fireEvent.change(screen.getByLabelText("Filename"), { target: { value: "  " } });
    expect(screen.getByTestId("edit-project-memory-save")).toBeDisabled();
  });
});

describe("ImportRepoAssetsDialog", () => {
  const items = [
    { name: "release", sourcePath: ".agents/skills/release", detail: "Cuts a release." },
    { name: "review", sourcePath: "skills/review", detail: "Reviews a diff." },
  ];

  it("scans the first project repo on open, ticks everything, and imports the selection", () => {
    const onScan = vi.fn();
    const onImport = vi.fn();
    render(
      <ImportRepoAssetsDialog
        isOpen
        onClose={() => {}}
        kind="skills"
        projectRepos={["/repos/a", "/repos/b"]}
        onScan={onScan}
        items={items}
        onImport={onImport}
      />,
    );
    expect(onScan).toHaveBeenCalledWith("/repos/a");
    const submit = screen.getByTestId("import-repo-assets-submit");
    expect(submit).toHaveTextContent("Import Selected (2)");

    fireEvent.click(within(screen.getByTestId("asset-skills-release")).getByRole("checkbox"));
    expect(submit).toHaveTextContent("Import Selected (1)");
    fireEvent.click(submit);
    expect(onImport).toHaveBeenCalledWith({ source: "/repos/a", names: ["review"] });
  });

  it("starts on a git URL when the project has no repos, and scans only on the button", () => {
    const onScan = vi.fn();
    render(
      <ImportRepoAssetsDialog
        isOpen
        onClose={() => {}}
        kind="mcpServers"
        projectRepos={[]}
        onScan={onScan}
        items={null}
        onImport={() => {}}
      />,
    );
    expect(onScan).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Git Repository URL"), {
      target: { value: "https://github.com/acme/tools.git" },
    });
    fireEvent.click(screen.getByTestId("import-repo-assets-scan"));
    expect(onScan).toHaveBeenCalledWith("https://github.com/acme/tools.git");
    expect(screen.getByTestId("import-repo-assets-submit")).toBeDisabled();
  });
});

describe("vault themes", () => {
  it("reads a V1 manifest, mapping PascalCase colours onto tokens", () => {
    const parsed = parseThemeJson(
      JSON.stringify({
        Id: "ocean",
        Name: "Ocean",
        IsDark: true,
        IvyTheme: {
          FontFamily: "Inter",
          Colors: { Dark: { Primary: "#0ea5e9", PrimaryForeground: "#ffffff", Nope: "#000" } },
        },
      }),
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.theme.name).toBe("Ocean");
    expect(parsed.theme.isDark).toBe(true);
    expect(parsed.theme.fontFamily).toBe("Inter");
    expect(parsed.theme.colors.dark).toEqual({
      primary: "#0ea5e9",
      "primary-foreground": "#ffffff",
    });
  });

  it("refuses text that is not JSON, and JSON with no colours", () => {
    expect(parseThemeJson("{nope")).toEqual({ ok: false, reason: "json" });
    expect(parseThemeJson('{"name":"x"}')).toEqual({ ok: false, reason: "shape" });
  });

  it("derives V1's id from a name", () => {
    expect(vaultThemeId("Team Brand!")).toBe("team-brand");
    expect(vaultThemeId("***", () => "abc123")).toBe("vault-theme-abc123");
  });

  const theme: VaultTheme = {
    id: "team-brand",
    name: "Team Brand",
    description: "",
    isDark: false,
    previewColors: ["#000", "#111", "#222", "#fff"],
    colors: { light: { primary: "#0f766e" } },
  };

  it("shows only the generator for an empty vault, and saves the draft", () => {
    const onSave = vi.fn();
    render(
      <VaultThemesDialog
        open
        onClose={() => {}}
        themes={[]}
        onSave={onSave}
        onApply={() => {}}
        onDelete={() => {}}
      />,
    );
    expect(screen.getByTestId("vault-themes-dialog")).toHaveTextContent("Create Custom Theme");
    expect(screen.queryByTestId("vault-themes-tab-themes")).toBeNull();
    fireEvent.click(screen.getByTestId("vault-theme-mode-dark"));
    fireEvent.click(screen.getByTestId("vault-theme-save"));
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave.mock.calls[0][0]).toMatchObject({ name: "Team Brand", isDark: true });
  });

  it("refuses upload with the host's reason", () => {
    render(
      <VaultThemesDialog
        open
        onClose={() => {}}
        themes={[]}
        onSave={() => {}}
        onApply={() => {}}
        onDelete={() => {}}
        saveDisabledReason="No vault."
      />,
    );
    expect(screen.getByTestId("vault-theme-save")).toBeDisabled();
    expect(screen.getByTestId("vault-theme-save-disabled")).toHaveTextContent("No vault.");
  });

  it("deletes a vault theme only after the confirm", async () => {
    const onDelete = vi.fn();
    render(
      <VaultThemesDialog
        open
        onClose={() => {}}
        themes={[theme]}
        initialTab="themes"
        onSave={() => {}}
        onApply={() => {}}
        onDelete={onDelete}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Delete Team Brand" }));
    expect(onDelete).not.toHaveBeenCalled();
    const confirm = screen.getByTestId("vault-theme-delete-dialog");
    await act(async () => {
      fireEvent.click(within(confirm).getByTestId("dialog-confirm"));
    });
    expect(onDelete).toHaveBeenCalledWith("team-brand");
  });
});
