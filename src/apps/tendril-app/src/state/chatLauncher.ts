import { useSyncExternalStore } from "react";
import { bridge } from "../api/bridge";
import { APPEARANCE_DEFAULTS, readAppearance, initAppearance, type ChatMode } from "./appearance";
import { uiStore } from "./uiStore";

/**
 * V1's `ChatLauncher`: the one place that decides what a new chat opens, and the one place that
 * knows what `chatMode` currently is.
 *
 * It exists because V2 grew three new-chat entry points and only one of them consulted the setting.
 * `App.tsx`'s `handleNewChat` branched on `chatMode` correctly, but `ChatView.handleCreateSession`
 * called `chatStore.createSession` directly - and that handler is what the chat header's button, the
 * Chats-list "+" and (through `ShellLayout`'s `(source?.onNew ?? onNewChat)`) the collapsed rail's
 * flyout and its Cmd/Ctrl+Alt+N chord all reach. So whether the setting was honoured depended on
 * which of four buttons the user pressed. V1 has no such split: every caller goes through
 * `ChatLauncher.TargetFor`, which is the shape restored here.
 *
 * The mode is held here rather than in `App.tsx`'s `useState` for the second half of the same bug:
 * that state was seeded once at mount and never written again, so changing the setting in Appearance
 * did nothing at all until the app was restarted. {@link ChatLauncher.refresh} is what the config
 * change event and the Appearance pane call to put that right.
 *
 * `chatStore` is reached by dynamic import, never a static one: `App.tsx` is eager and the entry
 * chunk is at 93.8% of the budget `code-splitting.test.tsx` holds, which is the same reason
 * `chatSessionCount` exists as its own leaf module.
 */

/**
 * The title every new-chat entry point gives a session, V1's `ChatLauncher.StartNew`.
 *
 * Stored, not shown: the daemon treats this exact title as "not named yet" and replaces it with one
 * it generates, so it stays English in every language. What the UI shows for it is the translated
 * `chat:sidebar.untitled` (`displayTitle`).
 */
export const NEW_CHAT_TITLE = "New Chat";

/**
 * Opens a chat session as a terminal pane. Registered by the shell rather than implemented here
 * because the pane registry is `App.tsx`'s own state (`terminalPanes`), keyed by session id so that
 * reopening a conversation reveals the agent already running in it rather than starting another.
 */
export type TerminalOpener = (sessionId: string, prompt?: string) => void;

class ChatLauncher {
  private mode: ChatMode = APPEARANCE_DEFAULTS.chatMode;
  private openTerminal: TerminalOpener | null = null;
  private openTerminals = new Set<string>();
  private listeners = new Set<() => void>();

  private notify(): void {
    this.listeners.forEach((listener) => listener());
  }

  public subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  public getMode = (): ChatMode => this.mode;

  /**
   * Publishes a mode the caller already knows, so a click in Appearance takes effect on the next
   * press rather than on the next filesystem event. The watcher's round trip still arrives and is
   * idempotent; this only removes the window in between.
   */
  public setMode(mode: ChatMode): void {
    if (this.mode === mode) return;
    this.mode = mode;
    this.notify();
  }

  public registerTerminalOpener(open: TerminalOpener): void {
    this.openTerminal = open;
  }

  /**
   * The conversations currently running as terminal panes, republished by the shell whenever its
   * pane registry changes. Held here for the same reason the opener is: the registry is `App.tsx`'s
   * own state, but the decision that reads it - "is this row a terminal?" - belongs beside the one
   * that decides where a *new* chat opens.
   */
  public registerOpenTerminals(sessionIds: string[]): void {
    this.openTerminals = new Set(sessionIds);
  }

  /**
   * V1's `ChatApp.SelectSession`: "Terminal sessions belong to the AgentApp pane, never here."
   * Reveals the pane a conversation is already running in and reports that it did, so the caller
   * does not also make it the chat view's selection - a terminal session has no messages, so the
   * chat view would show it as an empty conversation.
   */
  public revealTerminal(sessionId: string): boolean {
    if (!this.openTerminals.has(sessionId)) return false;
    this.openTerminal?.(sessionId);
    return true;
  }

  /**
   * The start-up read. Also applies the saved theme and theme mode, which is what `App.tsx` used this
   * call for before the launcher owned it: V1's shell applies both on every session start
   * (`TendrilThemes.ApplyTheme` / `ApplyThemeMode`).
   */
  public async init(): Promise<ChatMode> {
    this.setMode((await initAppearance()).chatMode);
    return this.mode;
  }

  /**
   * Re-reads `chatMode` from disk, for a config that changed after start-up.
   *
   * Deliberately not `initAppearance`: that applies the theme too, and a config event fired while the
   * operator is previewing a preset in Appearance would snap the app back to what is on disk.
   */
  public async refresh(): Promise<ChatMode> {
    try {
      this.setMode(readAppearance(await bridge.getConfig()).chatMode);
    } catch {
      // An unreachable daemon leaves the last known mode in place, which is a better answer than
      // silently reverting a user's choice to the default.
    }
    return this.mode;
  }

  /**
   * V1's `ChatLauncher.TargetFor`: where a chat should open. An explicit `override` is the direct
   * pick made at the button, which beats the configured default by design - that is what the mode
   * buttons beside "New chat" are for.
   */
  public targetFor(override?: ChatMode): ChatMode {
    if (override) return override;
    // No pane registry means no terminal to open into (a host that renders the chat view alone), and
    // a session created with nowhere to go would be a chat the user cannot reach.
    if (this.mode === "terminal" && !this.openTerminal) return "chat";
    return this.mode;
  }

  /**
   * V1's `ChatLauncher.StartNew`: a new session, opened in whichever mode {@link targetFor} names.
   *
   * Both branches create the session first. V1 defers creation to the page in chat mode and to the
   * shell in terminal mode, but the terminal route needs a session to exist before it can resolve an
   * agent for it, so creating it here covers both. The resolved mode is returned because a caller
   * that focuses the composer afterwards (`ChatView`) must not do so when the user was sent to a
   * terminal instead.
   */
  public async startNew(override?: ChatMode): Promise<ChatMode> {
    const target = this.targetFor(override);
    const { chatStore } = await import("./chatStore");

    if (target === "terminal") {
      const session = await chatStore.createSession(NEW_CHAT_TITLE);
      this.openTerminal?.(session.id);
      return target;
    }

    uiStore.navigate({ appId: "chat" });
    await chatStore.createSession(NEW_CHAT_TITLE);
    return target;
  }

  /** Test seam: vitest keeps one module instance per file, and this store outlives a render. */
  public resetForTesting(): void {
    this.mode = APPEARANCE_DEFAULTS.chatMode;
    this.openTerminal = null;
    this.openTerminals = new Set();
    this.listeners.clear();
  }
}

export const chatLauncher = new ChatLauncher();

/** The live `chatMode`, for the shell rows whose behaviour depends on it (V1's `OpenChat`). */
export const useChatMode = (): ChatMode =>
  useSyncExternalStore(chatLauncher.subscribe, chatLauncher.getMode, chatLauncher.getMode);
