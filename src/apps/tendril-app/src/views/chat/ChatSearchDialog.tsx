import React from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  Input,
} from "@ivy-interactive/components/ui";
import type { ChatStore } from "../../state/chatStore";
import type { ChatSession } from "../../types/chat";
import { displayTitle } from "./sidebarList";

/**
 * `Apps/Chat/Dialogs/ChatSearchDialog`, which is its own view in V1 too. The query and the results
 * stay with the conversation, because the Chats list's search icon is what clears and opens this.
 */
export const ChatSearchDialog: React.FC<{
  isSearchOpen: boolean;
  setIsSearchOpen: React.Dispatch<React.SetStateAction<boolean>>;
  searchQuery: string;
  setSearchQuery: React.Dispatch<React.SetStateAction<string>>;
  searchResults: ChatSession[];
  store: ChatStore;
}> = ({ isSearchOpen, setIsSearchOpen, searchQuery, setSearchQuery, searchResults, store }) => (
  <Dialog open={isSearchOpen} onOpenChange={setIsSearchOpen}>
    <DialogContent data-testid="chat-search-dialog" className="max-w-[560px]">
      <DialogHeader>
        <DialogTitle>Search Chats</DialogTitle>
      </DialogHeader>
      <div className="flex flex-col gap-2">
        <Input
          autoFocus
          type="search"
          aria-label="Search chats"
          placeholder="Search chats"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
        {searchResults.length === 0 ? (
          <p className="text-sm text-muted-foreground">No chats found.</p>
        ) : (
          <div className="flex max-h-80 flex-col overflow-y-auto">
            {searchResults.map((session) => (
              <button
                key={session.id}
                type="button"
                data-testid="chat-search-result"
                onClick={() => {
                  setIsSearchOpen(false);
                  void store.selectSession(session.id);
                }}
                className="flex items-center justify-between gap-2 rounded-selector px-2.5 py-2 text-left text-sm text-foreground hover:bg-secondary/60"
              >
                <span className="truncate">{displayTitle(session)}</span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {new Date(session.updatedAt).toLocaleDateString(undefined, {
                    month: "short",
                    day: "numeric",
                  })}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </DialogContent>
  </Dialog>
);
