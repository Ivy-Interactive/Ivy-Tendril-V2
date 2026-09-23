import * as React from "react";
import { Terminal } from "lucide-react";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { useFormatters, useTranslation } from "@/i18n/uiPanels";
import { DialogShell } from "./DialogShell";

/** V1 `ChatSearchDialog.MaxResults`: `.Take(15)`. */
export const MAX_CHAT_SEARCH_RESULTS = 15;

/**
 * A chat as the search lists it.
 *
 * Declared here rather than borrowed from the app's `ChatSession`: the component that renders a
 * shape owns it. `title` is the *display* title - the app's `displayTitle`, which gives an untitled
 * chat its fallback - because that is also what V1 matches the query against.
 */
export interface ChatSearchSession {
  id: string;
  title: string;
  /** An ISO timestamp; rendered as V1's `MMM d`, in the app's language. */
  updatedAt: string;
  /** A terminal session. V1 marks its row with the `Terminal` icon. */
  isTerminal?: boolean;
}

export interface ChatSearchDialogProps {
  isOpen: boolean;
  onClose: () => void;
  /** Every chat, newest first as the Chats list orders them. The dialog filters and caps. */
  sessions: readonly ChatSearchSession[];
  /** A picked result. The dialog has already closed when this runs, as V1 closes it first. */
  onSelectSession: (sessionId: string) => void;
}

/**
 * The case-insensitive title match V1 runs: an empty query matches everything, and the result is
 * capped at {@link MAX_CHAT_SEARCH_RESULTS}. Exported so the rule can be tested without a render.
 */
export function filterChatSessions<T extends ChatSearchSession>(
  sessions: readonly T[],
  query: string,
): T[] {
  const term = query.trim().toLowerCase();
  return sessions
    .filter((session) => term.length === 0 || session.title.toLowerCase().includes(term))
    .slice(0, MAX_CHAT_SEARCH_RESULTS);
}

/**
 * Search over chat titles, opened from the Chats sidebar section's search icon. Port of V1
 * `Apps/Chat/Dialogs/ChatSearchDialog.cs`.
 *
 * V1's decisions kept: the query runs synchronously over every chat (it is a title match on a list
 * the app already holds, not a database search, so there is nothing to debounce); an empty box lists
 * the most recent fifteen rather than nothing; a query with nothing behind it reads "No chats
 * found."; each row carries the chat's last-updated date and a terminal icon for a terminal
 * session; picking one closes the dialog first and then selects the chat.
 *
 * Changed, and why: the rows are plain buttons rather than V1's `ShellSidebarSection`. The section
 * would bring its row actions (rename, pin, delete) into a dialog whose only question is "which
 * chat", and the dialog is where a row's testable identity (`chat-search-result`) has always lived.
 * The query also restarts empty on every open, as V1's fresh `UseState("")` does.
 */
export function ChatSearchDialog({
  isOpen,
  onClose,
  sessions,
  onSelectSession,
}: ChatSearchDialogProps) {
  const { t } = useTranslation("uiPanels");
  const format = useFormatters();
  const [query, setQuery] = React.useState("");
  const inputRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    if (isOpen) setQuery("");
  }, [isOpen]);

  const results = React.useMemo(() => filterChatSessions(sessions, query), [sessions, query]);

  const handlePick = (sessionId: string) => {
    // V1: `dialogOpen.Set(false)` first, then `selectSession(sessionId)`.
    onClose();
    onSelectSession(sessionId);
  };

  return (
    <DialogShell
      isOpen={isOpen}
      onClose={onClose}
      // V1's `new DialogHeader("Search Chats")` and `.Width(Size.Px(560))`.
      title={t("chatSearch.title")}
      width="px560"
      testId="chat-search-dialog"
      initialFocusRef={inputRef}
      footer={
        <Button variant="outline" onClick={onClose} data-testid="dialog-close">
          {t("chatSearch.close")}
        </Button>
      }
    >
      {/* V1's `query.ToSearchInput().Placeholder("Search chats").Width(Size.Full())`. */}
      <Input
        ref={inputRef}
        type="search"
        aria-label={t("chatSearch.inputLabel")}
        data-testid="chat-search-input"
        placeholder={t("chatSearch.placeholder")}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
      <div className="mt-2">
        {results.length === 0 ? (
          /* V1: `body |= Text.Muted("No chats found.")`. */
          <p className="text-sm text-muted-foreground" data-testid="chat-search-empty">
            {t("chatSearch.empty")}
          </p>
        ) : (
          <div className="flex max-h-80 flex-col overflow-y-auto">
            {results.map((session) => (
              <button
                key={session.id}
                type="button"
                data-testid="chat-search-result"
                onClick={() => handlePick(session.id)}
                className="flex items-center justify-between gap-2 rounded-selector px-2.5 py-2 text-left text-sm text-foreground hover:bg-secondary/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span className="flex min-w-0 items-center gap-2">
                  {/* V1: `Icon: s.IsTerminal() ? "Terminal" : null`. */}
                  {session.isTerminal && (
                    <Terminal className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                  )}
                  <span className="truncate">{session.title}</span>
                </span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {/* V1's `ToString("MMM d")`, in the app's language rather than the machine's. */}
                  {format.date(session.updatedAt, { month: "short", day: "numeric" })}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </DialogShell>
  );
}
