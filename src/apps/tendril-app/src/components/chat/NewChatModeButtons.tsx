import React from "react";
import { IconButton, type IconButtonSize } from "@ivy-interactive/components/ui";
import { MessageCircle, MessageSquarePlus, Terminal } from "lucide-react";
import { useChatMode } from "../../state/chatLauncher";
import type { ChatMode } from "../../state/appearance";
import { useTranslation } from "../../i18n";

/**
 * "New chat", plus a same-size button that picks the other mode directly.
 *
 * Requested as "another small button (same size) next to it so you can always just choose directly".
 * A sibling button rather than a dialog: there is no new-chat dialog to put two buttons in - every
 * entry point creates the session on the click (V1's `ChatLauncher.StartNew` does the same), and
 * adding a modal in front of the most-pressed button in the app would cost every user a click to
 * spare the occasional override.
 *
 * The plain button still obeys the configured default, so the setting keeps deciding what a press
 * with no opinion does; the second button is the override, and it only ever offers the mode the
 * default is *not*. Showing both modes as explicit buttons would be the arrangement that makes the
 * setting pointless -- there would then be no button whose behaviour the default governs.
 *
 * The icons are the Appearance pane's own (`MessageCircle` for the chat view, `Terminal` for the
 * agent's terminal, `views/settings/AppearanceSection.tsx`), so the two buttons read as the same two
 * choices the setting offers rather than as a third concept.
 */
export interface NewChatModeButtonsProps {
  /**
   * Starts a chat. `undefined` is the plain button and means "whatever `chatMode` says"; a mode is
   * the override. Kept as a prop rather than calling `chatLauncher.startNew` directly because each
   * host has its own follow-up -- `ChatView` focuses the composer afterwards, the shell does not.
   */
  onNewChat: (override?: ChatMode) => void;
  /** Matches the host's other header buttons; `ChatHeader` is `lg`, the flyout bar is `sm`. */
  size?: IconButtonSize;
  /** Tooltip side, for a host whose buttons sit against an edge. */
  tooltipSide?: "top" | "right" | "bottom" | "left";
  className?: string;
}

/** The mode a press with no override resolves to, and therefore the one the second button offers. */
const otherMode = (mode: ChatMode): ChatMode => (mode === "terminal" ? "chat" : "terminal");

export const NewChatModeButtons: React.FC<NewChatModeButtonsProps> = ({
  onNewChat,
  size = "lg",
  tooltipSide = "top",
  className = "",
}) => {
  const { t } = useTranslation("chat");
  const mode = useChatMode();
  const override = otherMode(mode);

  return (
    <span className={`flex items-center ${className}`.trim()}>
      <IconButton
        label={t("newChatButtons.label")}
        tooltip={t("newChatButtons.tooltip", { context: mode })}
        size={size}
        tooltipSide={tooltipSide}
        data-testid="new-chat-default"
        data-mode={mode}
        onClick={() => onNewChat()}
      >
        <MessageSquarePlus className="size-4" aria-hidden="true" />
      </IconButton>
      <IconButton
        label={t("newChatButtons.override", { context: override })}
        size={size}
        tooltipSide={tooltipSide}
        data-testid="new-chat-override"
        data-mode={override}
        onClick={() => onNewChat(override)}
      >
        {override === "terminal" ? (
          <Terminal className="size-4" aria-hidden="true" />
        ) : (
          <MessageCircle className="size-4" aria-hidden="true" />
        )}
      </IconButton>
    </span>
  );
};
