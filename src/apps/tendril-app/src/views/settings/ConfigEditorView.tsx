import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button, CodeEditor } from "@ivy-interactive/components/ui";
import { PlanWorkspace } from "@ivy-interactive/components/tendril";
import { configTextApi } from "../../api/configTextApi";
import { ChatStore, type ChatStorePlanScope } from "../../state/chatStore";
import { notificationsStore } from "../../state/notificationsStore";
import { bridgeErrorCode, describeBridgeError } from "../../types/api";
import { ChatView, type SamplePrompt } from "../ChatView";
import { PLAN_CHAT_HEADLINE } from "../../components/chat/PlanChatPanel";
import { ConfirmDialog } from "@ivy-interactive/components/tendril";

/**
 * The in-app `config.yaml` editor, which is V1's `ConfigEditorApp` -> `RawConfigEditorView.cs`.
 *
 * V1 reaches it from `ConfigYamlUiHelper.OpenOrNavigate`, whose two arms are "open the file in the
 * operator's editor" (desktop shell or loopback) and "navigate to `ConfigEditorApp`" (anything else).
 * V2 took only the first arm, on the reasoning that it is always the desktop shell — which shipped
 * the whole feature as a shell-out and left the second arm with nothing to navigate to. This is that
 * second arm, and `SettingsView.openConfigYaml` now points at it: editing the daemon's configuration
 * inside the app is the point of the app, and handing the file to TextEdit is not an editor.
 *
 * Two deliberate DIVERGENCES from `RawConfigEditorView.cs`. Both are fixes for bugs the V1 survey
 * found, not drift, and neither is a behaviour to port back:
 *
 * 1. **V1 saves unvalidated YAML and toasts success regardless.** `RawConfigEditorView.cs:60-63`
 *    writes the text with `FileHelper.WriteAllText`, calls `config.ReloadSettings()` and then toasts
 *    "config.yaml saved and reloaded" — but `ReloadSettings` swallows a parse failure, so the
 *    operator is told their edit loaded when the daemon is in fact still running the previous
 *    settings, or none. V2 validates server-side *before* the bytes are written
 *    (`routes/config.rs`: `serde_yaml::from_str::<TendrilSettings>` under the same lock as the
 *    write), so a document that will not parse is rejected and its reason lands in the error line
 *    below rather than behind a success toast.
 *
 * 2. **V1 shows every secret in cleartext.** Its editor is `File.ReadAllText(config.ConfigPath)`, so
 *    `llm.apiKey`, `auth.hashSecret` and every agent's `environmentVariables` are on screen, in a
 *    screenshot and in a screen share. V2 is served the file with those values already replaced by
 *    the mask sentinel — the masking happens daemon-side and no credential is ever sent to the
 *    webview. A sentinel left untouched writes the stored value back through; one that is overtyped
 *    writes through as a new secret. Nothing in this file has a secret to leak, and nothing here may
 *    build a message out of the document: see the comment on {@link ConfigEditorView.save}.
 *
 * The chat beside the editor has no V1 counterpart at all — V1's config editor is a bare page. It is
 * here because "change this setting for me" is the request this screen exists to serve and the
 * operator should not have to leave it to ask.
 */

/** The mask sentinel, as `config_text.rs` emits it. Shown to the operator, never resolved here. */
const SECRET_MASK = "********";

/**
 * The workspace id, which is also what the split's persisted width is keyed by
 * (`PlanWorkspace/chatWidth.ts`). It must not be `plan-workspace`: that key already holds the width
 * the operator dragged the *plan* chat to, and sharing it would make each pane resize the other.
 */
const WORKSPACE_ID = "config-editor-workspace";

/**
 * The conversation's durable identity, in the one field a chat session records an owner in.
 *
 * `ChatStore`'s scope is nominally a plan's, and this is not a plan — but what the scope actually
 * does is (a) narrow the session list to the conversations recorded against this owner and (b) stamp
 * new sessions with it, which is exactly the isolation this panel needs: the editor's chat is not the
 * Chat page's chat, and it has to be findable again on the next visit. A plan folder is always
 * `<5 digits>-<slug>`, so this name cannot collide with one, and `sessionBelongsToPlan` is a string
 * comparison rather than a lookup, so nothing downstream tries to resolve it to a plan.
 *
 * An app-wide `new ChatStore()` was the alternative and is wrong twice over: it would list every
 * conversation in the app in a panel scoped to one file, and `ChatView`'s embedded unmount
 * `destroy()`s the store it was given, which on the shared singleton would take the Chat page's
 * event subscription down with it.
 */
const CONFIG_CHAT_SCOPE: ChatStorePlanScope = {
  planId: "config-yaml",
  folderName: "config-yaml",
  sessionTitle: "config.yaml",
};

/** `SamplePrompts.ForChat`'s role for this page: the three things an operator opens the file to do. */
const CONFIG_SAMPLE_PROMPTS: SamplePrompt[] = [
  {
    label: "Explain a setting",
    prompt: "Explain what each top-level key in my config.yaml controls.",
  },
  {
    label: "Add a project",
    prompt: "Add a new project to config.yaml and tell me which fields I still have to fill in.",
  },
  {
    label: "Check my config",
    prompt: "Review my config.yaml for settings that look wrong or are missing a sensible default.",
  },
];

/** `config.ConfigPath`: the file the daemon actually reads, shown so the operator knows which one. */
const configPathOf = (tendrilHome?: string | null): string =>
  tendrilHome ? `${tendrilHome.replace(/[/\\]+$/, "")}/config.yaml` : "config.yaml";

/**
 * Whether a rejection is the daemon refusing to clobber a file that moved underneath the editor.
 *
 * Matched on the `CONFLICT` code the Tauri client maps `409` onto (`service/client.rs`), with the
 * daemon's own wording as the fallback arm — outside the shell the same 409 arrives over `fetch` as a
 * plain `Error` carrying the body's `error` string and no code at all.
 */
const CONFLICT_MESSAGE = "config.yaml changed on disk since it was opened";

const isConflict = (err: unknown): boolean =>
  bridgeErrorCode(err) === "CONFLICT" || describeBridgeError(err).includes(CONFLICT_MESSAGE);

export interface ConfigEditorViewProps {
  /** `serviceInfo.tendrilHome`, which is what the shown path is built from. */
  tendrilHome?: string | null;
  /** Opens the plan a job started from this conversation reports, as every other chat host does. */
  onOpenPlan?: (planId: string) => void;
}

export const ConfigEditorView: React.FC<ConfigEditorViewProps> = ({ tendrilHome, onOpenPlan }) => {
  /**
   * `loadedYaml` / `yamlText` from `RawConfigEditorView.cs:17-21`, and for the reason its comment
   * gives: `loaded` is the text as the daemon last served it, so `dirty` means "edited since then"
   * rather than "differs from whatever a re-read would return right now".
   */
  const [loaded, setLoaded] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [maskedPaths, setMaskedPaths] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  /** A stale-write refusal, which is the one error that has an answer the operator can press. */
  const [conflicted, setConflicted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmingReload, setConfirmingReload] = useState(false);

  const configPath = configPathOf(tendrilHome);
  const dirty = loaded !== null && text !== loaded;

  /**
   * The panel's own store, built once and taken down on unmount — `PlanChatPanel`'s arrangement,
   * which that file explains at length. Held in a ref rather than state because it is an identity,
   * not a value: re-creating it on a re-render would restart the conversation.
   */
  const storeRef = useRef<ChatStore | null>(null);
  if (storeRef.current === null) storeRef.current = new ChatStore(CONFIG_CHAT_SCOPE);
  const store = storeRef.current;
  useEffect(() => () => store.destroy(), [store]);

  /**
   * Reads the file, discarding whatever is in the editor. Both callers mean that: the mount has
   * nothing to discard, and Reload has already been through the dirty guard below.
   */
  const load = useCallback(async (): Promise<void> => {
    setBusy(true);
    try {
      const masked = await configTextApi.read();
      setLoaded(masked.text);
      setText(masked.text);
      setMaskedPaths(masked.maskedPaths);
      setError(null);
      setConflicted(false);
    } catch (err) {
      // The daemon's own reason — it fails this route closed rather than serving a half-masked file,
      // and *why* it could not mask confidently (a block scalar under a secret key, say) is the only
      // thing that tells the operator what to go and fix.
      setError(describeBridgeError(err));
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  /**
   * `RawConfigEditorView.cs:55-69`, with divergence 1 above: the write is validated daemon-side
   * before any bytes land, so this either succeeded or has a reason, and the toast follows the
   * former only.
   *
   * The failure arm is where the secret rule bites. `describeBridgeError(err)` is the daemon's
   * message, which is masked by construction — `routes/config.rs` re-runs a failed validation against
   * the still-masked submission precisely so the message it returns carries placeholders. What must
   * never appear here is `text`: mid-edit it holds any credential the operator has typed and not yet
   * saved, and an error line is the easiest place in the app for one to reach a screenshot.
   */
  const save = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    setConflicted(false);
    try {
      await configTextApi.write(text);
      setLoaded(text);
      notificationsStore.notifySuccess("Saved", "config.yaml saved and reloaded");
    } catch (err) {
      setError(describeBridgeError(err));
      setConflicted(isConflict(err));
    } finally {
      setBusy(false);
    }
  };

  /**
   * The contract's guard: Reload asks first when there are unsaved edits.
   *
   * Note that V1 does **not** do this — its Reload button (`RawConfigEditorView.cs:70-77`) overwrites
   * the editor on the click, and the guard at `:23-37` that the contract cites is a different one:
   * it is the `SettingsReloaded` handler declining to pull an *external* write in over unsaved edits.
   * Guarding the button is the better behaviour and the contract asks for it, so it is what ships;
   * the external-write half has no V2 counterpart yet because the file watcher has no
   * `ChangeTarget::File` variant (the contract puts that out of scope, and the 409 on save is what
   * stands in for it).
   */
  const requestReload = () => {
    if (dirty) {
      setConfirmingReload(true);
      return;
    }
    void load();
  };

  const maskedNote = useMemo(() => {
    if (maskedPaths.length === 0) return null;
    const count = maskedPaths.length;
    return `${count} secret ${count === 1 ? "value is" : "values are"} shown as ${SECRET_MASK}. Leave a placeholder as it is to keep the stored value; overtype it to set a new one.`;
  }, [maskedPaths]);

  const editorPane = (
    <div
      key="editor"
      className="flex h-full min-h-0 flex-col gap-2 p-4"
      data-testid="config-editor-view"
    >
      {/* `Text.Muted(config.ConfigPath).Small()`. */}
      <p className="text-xs text-muted-foreground" data-testid="config-editor-path">
        {configPath}
      </p>

      {maskedNote && (
        // No V1 counterpart, because V1 has nothing to explain: it shows the real values. The write-
        // through rule is invisible otherwise, and an operator who cannot see it will retype a key
        // they did not need to.
        <p className="text-xs text-muted-foreground" data-testid="config-editor-masked-note">
          {maskedNote}
        </p>
      )}

      {/* `errorMessage.Value != null ? Text.Block(...).Color(Colors.Destructive) : null` — the line
          exists only when there is something to say. */}
      {error && (
        <div
          role="alert"
          className="flex flex-wrap items-center gap-2 text-sm text-destructive"
          data-testid="config-editor-error"
        >
          <span>{error}</span>
          {conflicted && (
            // The answer to a stale write, offered where the refusal is read. Deliberately not an
            // automatic reload: the operator's unsaved edits are the thing at stake.
            <Button
              variant="outline"
              size="sm"
              onClick={requestReload}
              data-testid="config-editor-conflict-reload"
            >
              Reload from disk
            </Button>
          )}
        </div>
      )}

      {/* `.Height(Size.Full()).Width(Size.Full())`: the editor takes the pane, and the button row
          below is `Size.Fit()`. `min-h-0` is what lets it shrink inside the flex column rather than
          pushing the buttons off the bottom. */}
      <CodeEditor
        value={text}
        onChange={setText}
        language="yaml"
        readOnly={busy}
        className="min-h-0 flex-1"
        data-testid="config-editor-input"
      />

      {/* `Layout.Horizontal().Gap(2).Height(Size.Fit())`, in V1's order: Save then Reload. */}
      <div className="flex shrink-0 items-center gap-2">
        <Button
          onClick={() => void save()}
          disabled={!dirty || busy}
          data-testid="config-editor-save"
        >
          Save
        </Button>
        <Button
          variant="outline"
          onClick={requestReload}
          disabled={busy}
          data-testid="config-editor-reload"
        >
          Reload from disk
        </Button>
      </div>

      <ConfirmDialog
        isOpen={confirmingReload}
        onClose={() => setConfirmingReload(false)}
        title="Discard Unsaved Changes"
        testId="config-editor-reload-dialog"
        confirmLabel="Discard and reload"
        confirmVariant="destructive"
        onConfirm={() => {
          setConfirmingReload(false);
          void load();
        }}
        body={
          <p>
            Reloading replaces the editor with the file on disk. The edits you have not saved are
            lost.
          </p>
        }
      />
    </div>
  );

  const chatPane = (
    <div key="chat" className="flex h-full min-h-0 flex-col" data-testid="config-editor-chat">
      <ChatView
        store={store}
        embedded
        greeting={CONFIG_CHAT_SCOPE.sessionTitle}
        // The same headline the plan panel uses, and the same promise: this chat can make the change
        // for you. One string rather than two so the two embedded chats cannot drift apart.
        headline={PLAN_CHAT_HEADLINE}
        samplePrompts={CONFIG_SAMPLE_PROMPTS}
        onOpenPlan={onOpenPlan}
      />
    </div>
  );

  return (
    <PlanWorkspace
      id={WORKSPACE_ID}
      title="config.yaml"
      slots={{ Content: [editorPane], Chat: [chatPane] }}
    />
  );
};
