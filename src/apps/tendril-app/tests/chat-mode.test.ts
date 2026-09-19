import { describe, it, expect } from "vitest";
import {
  APPEARANCE_DEFAULTS,
  asChatMode,
  readAppearance,
  type ChatMode,
} from "../src/state/appearance";
import type { TendrilConfig } from "../src/types/api";

/**
 * `chatMode`, the setting behind V1's `ChatLauncher.TargetFor`: whether the Chat button opens the chat
 * view or the agent's own terminal.
 *
 * The rule that matters is the fallback. `ConfigService` runs every load through
 * `ChatModes.Normalize`, so only the exact `terminal` opt-in counts — a value hand-edited into
 * `config.yaml` must not strand someone in a pane they may not know how to leave.
 * `chat_mode_is_terminal` in `crates/tendril-core/src/config.rs` is the same rule daemon-side.
 */
describe("chat mode setting", () => {
  const config = (raw: Record<string, unknown>): TendrilConfig =>
    ({ raw }) as unknown as TendrilConfig;

  it("defaults to the chat view", () => {
    expect(APPEARANCE_DEFAULTS.chatMode).toBe("chat");
    expect(readAppearance(null).chatMode).toBe("chat");
    expect(readAppearance(config({})).chatMode).toBe("chat");
  });

  it("takes only the exact terminal opt-in", () => {
    const cases: [unknown, ChatMode][] = [
      ["terminal", "terminal"],
      ["Terminal", "terminal"],
      ["  TERMINAL  ", "terminal"],
      ["chat", "chat"],
      // Anything unrecognised is the chat view, not an error and not the terminal.
      ["pty", "chat"],
      ["terminals", "chat"],
      ["", "chat"],
      [null, "chat"],
      [undefined, "chat"],
      [42, "chat"],
      [true, "chat"],
      [{ mode: "terminal" }, "chat"],
    ];
    for (const [value, expected] of cases) {
      expect(asChatMode(value), `value: ${JSON.stringify(value)}`).toBe(expected);
      expect(readAppearance(config({ chatMode: value })).chatMode).toBe(expected);
    }
  });

  it("is read from the same config as the rest of the appearance pane", () => {
    const settings = readAppearance(
      config({ themeMode: "dark", theme: "dracula", sidebarOpen: false, chatMode: "terminal" }),
    );
    expect(settings).toEqual({
      themeMode: "dark",
      theme: "dracula",
      sidebarOpen: false,
      chatMode: "terminal",
    });
  });
});
