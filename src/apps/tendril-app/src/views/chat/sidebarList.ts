import type { ShellSidebarList } from "../../state/sidebarListStore";
import type { ChatSession } from "../../types/chat";
import { shortPlanId } from "./samplePrompts";

/**
 * `ChatApp.BuildSidebarList` and the two labels it draws a row from. The shell owns the list; this
 * only describes it, so it is a pure function of the sessions and stays out of the conversation.
 */

/** The chat's own name, falling back to the label a chat carries before it is titled. */
export const displayTitle = (session: ChatSession | null | undefined): string =>
  session && session.title.trim() ? session.title : "New Chat";

/** The plan a session belongs to, shown as its row tag; null for a free-standing chat. */
const planTag = (session: ChatSession): string | null =>
  session.planFolderName ? `#${shortPlanId(session.planFolderName.split("-")[0])}` : null;

/** The row actions the Chats list carries, so the shell can wire its row menu to them. */
export interface ChatSidebarListActions {
  onNew: () => void;
  onSearch: () => void;
  onSelect: (sessionId: string) => void;
  onRename: (sessionId: string, title: string) => void;
  onDelete: (sessionId: string) => void;
  onTogglePin: (sessionId: string) => void;
}

/**
 * `ChatApp.BuildSidebarList`: the Chats list the shell sidebar shows while this app is open.
 *
 * Everything non-default here is V1's, and each flag has a reason:
 * - `collapsedMenu: true` folds the collapsed rail's list into one flyout button instead of the
 *   narrow id chips a plan list shows there - a chat has no id to chip.
 * - `searchLabel: "Search chats"` with its own `onSearch`, because an absent `onSearch` means the
 *   plan search dialog, "which is right for every plan list and wrong for anything else".
 * - `onNew` is the new-chat action, labelled "New chat".
 * - `onRename` / `onDelete` / `onTogglePin` are the row's own actions.
 *
 * A row's `state` is `ChatApp.BuildRowState`: "working" while its own turn is running, "completed"
 * when it finished while the user was reading a different chat. V1 also sets `Icon: "Terminal"` on a
 * terminal session; V2's `ChatSession` has no terminal kind, so no row ever carries that glyph.
 */
export const buildChatSidebarList = (
  sessions: ChatSession[],
  selectedId: string | null,
  rowState: (sessionId: string) => "working" | "completed" | null,
  actions: ChatSidebarListActions,
): ShellSidebarList => ({
  appId: "chat",
  title: "Chats",
  items: sessions.map((session) => ({
    id: session.id,
    title: displayTitle(session),
    tag: planTag(session) ?? undefined,
    state: rowState(session.id) ?? undefined,
    pinned: session.isPinned,
  })),
  selectedId,
  searchable: true,
  onSearch: actions.onSearch,
  searchLabel: "Search chats",
  onNew: actions.onNew,
  newLabel: "New chat",
  collapsedMenu: true,
  onRename: actions.onRename,
  onDelete: actions.onDelete,
  onTogglePin: actions.onTogglePin,
  buildSelectArgs: (sessionId) => {
    /* The shell routes a click as `OpenApp(new NavigateArgs("chat", BuildSelectArgs(id)))` and V1's
       `ChatApp` reads `ChatAppArgs.SessionId` back out. V2 has no arg-carrying navigation yet, so the
       session is selected here too; the returned object is still V1's args, so this drops out once
       the shell can hand args to a view. */
    actions.onSelect(sessionId);
    return { sessionId };
  },
});
