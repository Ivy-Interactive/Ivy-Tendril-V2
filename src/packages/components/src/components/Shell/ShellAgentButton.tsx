import React, { useCallback, useEffect } from "react";
import { Pin, PinOff } from "lucide-react";
import { BrandIcon } from "./brandIcons.tsx";
import { useShell } from "./ShellContext.tsx";
import {
  NEW_CHAT_SHORTCUT_KEY,
  type ShellSectionItemDto,
  type ShellWidgetProps,
  isEditableTarget,
  isModKey,
  modAltKeys,
} from "./types.ts";
import { ShellRailFlyout, type RailFlyoutTrigger } from "./ShellRailFlyout.tsx";
import { ShellTooltip } from "./ShellTooltip.tsx";
import { TuiBadge as Badge } from "../ui/TuiBadge";
import { TuiKbd as Kbd } from "../ui/TuiKbd";
import "./shell.css";

const NEW_CHAT_LABEL = "New Chat";

interface ShellAgentButtonProps extends ShellWidgetProps {
  label?: string;
  icon?: string;
  shortcutKey?: string;
  isActive?: boolean;
  badge?: string;
  items?: ShellSectionItemDto[];
  selectedId?: string;
  listTitle?: string;
}

/**
 * The coding-agent row: clicking it opens the latest agent session, and
 * Cmd+Opt+shortcutKey (macOS) / Ctrl+Alt+shortcutKey (Windows/Linux) starts a
 * new one. The shortcut is ignored while typing. On the collapsed rail, while
 * the chat list is published, hovering the row floats that list beside it (the
 * icon turns into a pin) and clicking pins the list open.
 */
export const ShellAgentButton: React.FC<ShellAgentButtonProps> = ({
  id,
  events = [],
  eventHandler,
  label = "Agent",
  icon,
  shortcutKey = NEW_CHAT_SHORTCUT_KEY,
  isActive = false,
  badge,
  items,
  selectedId,
  listTitle,
}) => {
  const { collapsed } = useShell();

  const fireOpen = useCallback(() => {
    if (events.includes("OnOpen")) eventHandler("OnOpen", id, []);
  }, [events, eventHandler, id]);

  const fireNewChat = useCallback(() => {
    if (events.includes("OnNewChat")) eventHandler("OnNewChat", id, []);
  }, [events, eventHandler, id]);

  const fireSelect = useCallback(
    (itemId: string) => {
      if (events.includes("OnSelectItem")) eventHandler("OnSelectItem", id, [itemId]);
    },
    [events, eventHandler, id],
  );

  const fireRename = events.includes("OnRenameItem")
    ? (itemId: string, title: string) => eventHandler("OnRenameItem", id, [[itemId, title]])
    : undefined;
  const fireDelete = events.includes("OnDeleteItem")
    ? (itemId: string) => eventHandler("OnDeleteItem", id, [itemId])
    : undefined;
  const fireTogglePin = events.includes("OnTogglePinItem")
    ? (itemId: string) => eventHandler("OnTogglePinItem", id, [itemId])
    : undefined;

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      // shortcutKey is a single letter, so the Key prefix composes correctly
      if (
        isModKey(e) &&
        e.altKey &&
        !e.shiftKey &&
        (e.code === `Key${shortcutKey.toUpperCase()}` ||
          e.key.toLowerCase() === shortcutKey.toLowerCase()) &&
        !isEditableTarget(e)
      ) {
        e.preventDefault();
        fireNewChat();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [fireNewChat, shortcutKey]);

  const hintKeys = modAltKeys(shortcutKey);
  const hasList = collapsed && items != null;
  // The pill is the host's badge when it sends one, else the floated list's length. Reading it from
  // the badge is what keeps the count on screen once the chats list is no longer published (#2556).
  const rawCount = badge ?? String(items?.length ?? 0);
  // The rail fits two digits beside the icon; larger counts cap at 99. Expanded there is a whole
  // row to spell the number out in, so the cap is the rail's, exactly as ShellNav gates its own.
  const count = collapsed && rawCount.length > 2 ? "99" : rawCount;
  // Not gated on `collapsed`: Chat carries its count at both widths like every other nav row. The
  // expanded style has been sitting in shell.css unreachable since the pill was added (#195).
  const showCount = rawCount !== "" && rawCount !== "0";

  const renderButton = (trigger?: RailFlyoutTrigger) => (
    <button
      ref={trigger?.ref}
      className="tsh-agent"
      data-active={isActive}
      data-has-list={!!trigger}
      data-open={trigger?.open}
      data-pinned={trigger?.pinned}
      aria-expanded={trigger ? trigger.open : undefined}
      onPointerEnter={trigger?.onPointerEnter}
      onPointerLeave={trigger?.onPointerLeave}
      onClick={trigger ? trigger.onClick : fireOpen}
      aria-label={label}
    >
      <span className="tsh-row">
        <span className="tsh-agent-brand">
          <span className="tsh-agent-icon">
            <BrandIcon name={icon} size={16} />
            {trigger && (
              <span className="tsh-agent-pin" aria-hidden="true">
                {trigger.pinned ? <PinOff size={16} /> : <Pin size={16} />}
              </span>
            )}
          </span>
          <span className="tsh-agent-label">{label}</span>
        </span>
        {/* The count sits inside the row, beside the shortcut hint, exactly where ShellNav puts
            its own. It used to be a sibling of `.tsh-row`, which only ever worked on the rail:
            there the collapsed rule takes it `position: absolute` onto the icon, but expanded it
            stays in flow after a row that is a full content box wide and `flex-shrink: 0`, so it
            started at the row's right edge and `.tsh-agent`'s `overflow: hidden` cut it in half. */}
        <span className="tsh-agent-actions">
          {showCount && (
            <Badge numeric className="tsh-nav-badge tsh-agent-count">
              {count}
            </Badge>
          )}
          <Kbd keys={hintKeys} variant="bare" className="tsh-kbd" />
        </span>
      </span>
    </button>
  );

  return (
    <div className="tsh-agent-wrap">
      {hasList ? (
        <ShellRailFlyout
          title={listTitle}
          items={items}
          selectedId={selectedId}
          emptyText="No chats yet"
          onSelect={fireSelect}
          newLabel="New chat"
          onNew={fireNewChat}
          onRename={fireRename}
          onDelete={fireDelete}
          onTogglePin={fireTogglePin}
        >
          {renderButton}
        </ShellRailFlyout>
      ) : (
        <ShellTooltip content={NEW_CHAT_LABEL} shortcut={hintKeys} side="right">
          {renderButton()}
        </ShellTooltip>
      )}
    </div>
  );
};
