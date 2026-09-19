import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ConfigEditorView } from "../ConfigEditorView";
import {
  resetConfigTextTransports,
  setConfigTextTransports,
  type ConfigTextTransport,
  type ConfigTextWriteTransport,
} from "../../../api/configTextApi";
import { notificationsStore } from "../../../state/notificationsStore";
import { chatApi } from "../../../api/chatApi";
import type { BridgeError } from "../../../types/api";

/**
 * The editor half of `ConfigEditorView`, against the transport seam `configTextApi` exposes for
 * exactly this. Nothing here stubs `fetch` or `invoke`: the seam is the contract the view codes to,
 * and driving it means a change to either transport cannot make these tests lie.
 *
 * The chat half is deliberately not re-tested — it is `ChatView` with `embedded`, which
 * `plan-chat-embedded.test.tsx` covers in full. What is asserted here is the one thing this view is
 * responsible for: that the chat it mounts is scoped to its own conversation rather than sharing the
 * Chat page's, which is what would leak one page's session list into the other.
 */

vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));

/**
 * The real `CodeEditor` is CodeMirror behind a dynamic `import()`, and neither half survives this
 * suite: jsdom cannot drive a contenteditable, and the `@codemirror/*` packages are the component
 * package's own dependencies rather than the app's, so the import would not even resolve here. Its
 * own behaviour — the controlled round trip, the compartment, the teardown — is pinned in
 * `packages/components/src/components/CodeEditor/CodeEditor.test.tsx` against the real thing. What
 * this view owes the editor is a value, an `onChange` and a `readOnly`, so the stand-in is the
 * smallest control that carries all three. Same idiom as `plan-diff.test.tsx`'s `PlanDiffView`.
 */
vi.mock("@ivy-interactive/components/ui", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    CodeEditor: ({
      value,
      onChange,
      readOnly,
      "data-testid": testId,
    }: {
      value: string;
      onChange: (next: string) => void;
      readOnly?: boolean;
      "data-testid"?: string;
    }) => (
      <textarea
        data-testid={testId}
        value={value}
        readOnly={readOnly}
        onChange={(e) => onChange(e.target.value)}
      />
    ),
  };
});

vi.mock("@tauri-apps/api/webview", () => ({
  getCurrentWebview: () => ({
    onDragDropEvent: () => Promise.resolve(() => {}),
  }),
}));

vi.mock("../../../api/events", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../api/events")>();
  return { ...actual, onChatEvent: () => Promise.resolve(() => {}) };
});

const YAML = "llm:\n  provider: anthropic\n  apiKey: '********'\n";

/** A structured rejection as the Tauri client builds one; `client.rs` maps a 409 onto this code. */
const bridgeError = (code: string, message: string): BridgeError => ({ code, message });

let read: Mock<ConfigTextTransport>;
let write: Mock<ConfigTextWriteTransport>;

const renderEditor = async (home = "/home/user/.tendril") => {
  await act(async () => {
    render(<ConfigEditorView tendrilHome={home} />);
  });
};

const editTo = async (next: string) => {
  await act(async () => {
    fireEvent.change(screen.getByTestId("config-editor-input"), { target: { value: next } });
  });
};

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(chatApi, "listSessions").mockResolvedValue([]);
  vi.spyOn(chatApi, "getQueue").mockResolvedValue([]);
  read = vi.fn<ConfigTextTransport>(async () => ({ text: YAML, maskedPaths: ["llm.apiKey"] }));
  write = vi.fn<ConfigTextWriteTransport>(async () => {});
  setConfigTextTransports({ read, write });
});

afterEach(() => {
  resetConfigTextTransports();
  window.localStorage.clear();
});

describe("ConfigEditorView", () => {
  it("shows the config path and the file the daemon served", async () => {
    await renderEditor();

    expect(screen.getByTestId("config-editor-path")).toHaveTextContent(
      "/home/user/.tendril/config.yaml",
    );
    expect(read).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("config-editor-input")).toHaveValue(YAML);
  });

  /** V1's `hasChanges` gate on `new Button("Save").Primary().Disabled(!hasChanges)`. */
  it("enables Save only once the document differs from what was loaded", async () => {
    await renderEditor();

    expect(screen.getByTestId("config-editor-save")).toBeDisabled();

    await editTo(`${YAML}debug: true\n`);
    expect(screen.getByTestId("config-editor-save")).toBeEnabled();

    // Typed back to what was loaded: not dirty, whatever route it took to get there.
    await editTo(YAML);
    expect(screen.getByTestId("config-editor-save")).toBeDisabled();
  });

  it("writes the edited text through and reports success", async () => {
    await renderEditor();
    const success = vi.spyOn(notificationsStore, "notifySuccess").mockImplementation(() => {});

    await editTo(`${YAML}debug: true\n`);
    await act(async () => {
      fireEvent.click(screen.getByTestId("config-editor-save"));
    });

    expect(write).toHaveBeenCalledWith(`${YAML}debug: true\n`);
    expect(success).toHaveBeenCalledWith("Saved", "config.yaml saved and reloaded");
    // A completed save is the new baseline, so the button falls back to disabled.
    expect(screen.getByTestId("config-editor-save")).toBeDisabled();
  });

  /**
   * Divergence 1 from `RawConfigEditorView.cs`, pinned: V1 toasts "saved and reloaded" even when the
   * reload it just did threw. A rejected write here toasts nothing and says why instead.
   */
  it("shows a rejected write in the error line and does not claim success", async () => {
    write.mockRejectedValue(new Error("config.yaml is not valid: missing field `provider`"));
    await renderEditor();
    const success = vi.spyOn(notificationsStore, "notifySuccess").mockImplementation(() => {});

    await editTo("llm: {}\n");
    await act(async () => {
      fireEvent.click(screen.getByTestId("config-editor-save"));
    });

    expect(screen.getByTestId("config-editor-error")).toHaveTextContent(
      "config.yaml is not valid: missing field `provider`",
    );
    expect(success).not.toHaveBeenCalled();
    // The edit is still the operator's to fix and re-submit, so the document is untouched and Save
    // is still armed.
    expect(screen.getByTestId("config-editor-save")).toBeEnabled();
  });

  /**
   * The secret rule. The submitted document is the one thing that can hold a credential the operator
   * typed and has not saved, so it may never be interpolated into what is rendered.
   */
  it("never echoes the submitted document into the error line", async () => {
    write.mockRejectedValue(new Error("config.yaml is not valid: mapping values are not allowed"));
    await renderEditor();
    const notifyError = vi.spyOn(notificationsStore, "notifyError").mockImplementation(() => {});

    await editTo("llm:\n  apiKey: sk-ant-super-secret\n");
    await act(async () => {
      fireEvent.click(screen.getByTestId("config-editor-save"));
    });

    const error = screen.getByTestId("config-editor-error");
    expect(error).toBeInTheDocument();
    expect(error.textContent ?? "").not.toContain("sk-ant-super-secret");
    // Nowhere else either. The editor is the one place the operator's own draft belongs; a toast is
    // the other easy route off this screen and into a screenshot, so it is checked too.
    const leaked = [...document.querySelectorAll("*")].filter(
      (node) =>
        node.getAttribute("data-testid") !== "config-editor-input" &&
        [...node.childNodes].some(
          (child) => child.nodeType === Node.TEXT_NODE && child.textContent?.includes("sk-ant-"),
        ),
    );
    expect(leaked).toEqual([]);
    expect(notifyError).not.toHaveBeenCalled();
  });

  it("re-reads the file when Reload is pressed with nothing unsaved", async () => {
    await renderEditor();
    read.mockResolvedValue({ text: "llm:\n  provider: openai\n", maskedPaths: [] });

    await act(async () => {
      fireEvent.click(screen.getByTestId("config-editor-reload"));
    });

    expect(read).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId("config-editor-input")).toHaveValue("llm:\n  provider: openai\n");
    expect(screen.queryByTestId("config-editor-reload-dialog")).not.toBeInTheDocument();
  });

  /** The contract's guard on Reload. V1 has none: its button overwrites the editor on the click. */
  it("asks before discarding unsaved edits, and keeps them when the answer is no", async () => {
    await renderEditor();

    await editTo("llm:\n  provider: openai\n");
    await act(async () => {
      fireEvent.click(screen.getByTestId("config-editor-reload"));
    });

    expect(screen.getByTestId("config-editor-reload-dialog")).toBeInTheDocument();
    expect(read).toHaveBeenCalledTimes(1);

    await act(async () => {
      fireEvent.click(screen.getByTestId("dialog-cancel"));
    });

    await waitFor(() =>
      expect(screen.queryByTestId("config-editor-reload-dialog")).not.toBeInTheDocument(),
    );
    expect(read).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("config-editor-input")).toHaveValue("llm:\n  provider: openai\n");
  });

  it("discards the edits and re-reads when the guard is confirmed", async () => {
    await renderEditor();

    await editTo("llm:\n  provider: openai\n");
    await act(async () => {
      fireEvent.click(screen.getByTestId("config-editor-reload"));
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId("dialog-confirm"));
    });

    expect(read).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId("config-editor-input")).toHaveValue(YAML);
    expect(screen.getByTestId("config-editor-save")).toBeDisabled();
  });

  /**
   * The 409: the daemon refuses to clobber a file that moved under the editor. Its message is the
   * whole of what the operator is told, and Reload is offered beside it because it is the answer.
   */
  it("surfaces a stale-write conflict with a reload beside it", async () => {
    write.mockRejectedValue(
      bridgeError("CONFLICT", "config.yaml changed on disk since it was opened"),
    );
    await renderEditor();

    await editTo("llm:\n  provider: openai\n");
    await act(async () => {
      fireEvent.click(screen.getByTestId("config-editor-save"));
    });

    expect(screen.getByTestId("config-editor-error")).toHaveTextContent(
      "config.yaml changed on disk since it was opened",
    );
    // Not an automatic reload: the unsaved edits are what is at stake, so the guard still runs.
    await act(async () => {
      fireEvent.click(screen.getByTestId("config-editor-conflict-reload"));
    });
    expect(screen.getByTestId("config-editor-reload-dialog")).toBeInTheDocument();
  });

  /** Outside the shell the same 409 arrives as a plain `Error` with no bridge code on it. */
  it("recognises the conflict when it arrives without a bridge code", async () => {
    write.mockRejectedValue(new Error("config.yaml changed on disk since it was opened"));
    await renderEditor();

    await editTo("llm:\n  provider: openai\n");
    await act(async () => {
      fireEvent.click(screen.getByTestId("config-editor-save"));
    });

    expect(screen.getByTestId("config-editor-conflict-reload")).toBeInTheDocument();
  });

  /** A failed read fails the whole route closed daemon-side, and its reason is all there is to show. */
  it("shows why the file could not be read", async () => {
    read.mockRejectedValue(new Error("cannot mask llm.apiKey: value is a block scalar"));
    await renderEditor();

    expect(screen.getByTestId("config-editor-error")).toHaveTextContent(
      "cannot mask llm.apiKey: value is a block scalar",
    );
    expect(screen.getByTestId("config-editor-save")).toBeDisabled();
  });

  /** No error, no line. V1: `errorMessage.Value != null ? Text.Block(...) : null`. */
  it("renders no error line when there is no error", async () => {
    await renderEditor();

    expect(screen.queryByTestId("config-editor-error")).not.toBeInTheDocument();
  });

  it("explains the mask sentinels only while there are secrets to explain", async () => {
    await renderEditor();

    expect(screen.getByTestId("config-editor-masked-note")).toHaveTextContent("********");

    read.mockResolvedValue({ text: "llm:\n  provider: ollama\n", maskedPaths: [] });
    await act(async () => {
      fireEvent.click(screen.getByTestId("config-editor-reload"));
    });

    expect(screen.queryByTestId("config-editor-masked-note")).not.toBeInTheDocument();
  });

  it("mounts an embedded chat beside the editor", async () => {
    await renderEditor();

    expect(screen.getByTestId("config-editor-chat")).toBeInTheDocument();
    expect(screen.getByTestId("embedded-chat-view")).toBeInTheDocument();
  });

  /**
   * The persisted split width must not be the plan workspace's.
   *
   * `PlanWorkspace` used to key it globally, which was only correct while one workspace existed: with
   * two, a drag here silently resized the plan page the next time it opened. The key is now derived
   * from the workspace id, and `tendril.plan.chatWidth` stays the plan page's alone. Asserted through
   * the read path — a width already stored under each key, and which of the two this pane adopts —
   * because jsdom here has no `PointerEvent` to drag the resizer with; the write half is pinned in
   * `PlanWorkspace.test.tsx`, next to the drag it belongs to.
   */
  it("takes its pane width from its own key rather than the plan workspace's", async () => {
    window.localStorage.setItem("tendril.plan.chatWidth", "700");
    window.localStorage.setItem("tendril.chatWidth.config-editor-workspace", "500");

    await renderEditor();

    const root = document.querySelector(".pws-root") as HTMLElement;
    expect(root.style.getPropertyValue("--pws-chat-width")).toBe("500px");
  });

  /** `toHaveTextContent` is a substring match, so the leading-slash case needs the exact string. */
  it("falls back to a bare filename when the daemon has not reported its home", async () => {
    await renderEditor("");

    expect(screen.getByTestId("config-editor-path").textContent).toBe("config.yaml");
  });
});
