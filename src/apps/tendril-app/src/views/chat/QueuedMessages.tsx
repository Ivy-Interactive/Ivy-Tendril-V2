import React, { useRef, useState } from "react";
import { ArrowRight, Check, ChevronDown, Paperclip, Pencil, Trash2, X } from "lucide-react";
import { Badge, IconButton, Input } from "@ivy-interactive/components/ui";
import type { ChatStore } from "../../state/chatStore";
import type { ChatQueuedItem } from "../../types/chat";

/**
 * The queue drawer above the composer: the prompts parked behind the turn in flight, and the
 * in-place edit of one. Every piece of state here is the drawer's own - nothing else in the
 * conversation reads it - so it travels with the markup rather than sitting in the view.
 */
export const ChatQueuedMessages: React.FC<{
  queuedItems: ChatQueuedItem[];
  store: ChatStore;
}> = ({ queuedItems, store }) => {
  // V1 opens the queue panel: a prompt that will be sent for you is worth reading without a click.
  const [isQueueExpanded, setIsQueueExpanded] = useState(true);
  const [editingQueuedId, setEditingQueuedId] = useState<string | null>(null);
  const [editingQueuedText, setEditingQueuedText] = useState("");
  const queuedEditFocusedIdRef = useRef<string | null>(null);

  /**
   * Jumps a queued prompt to the front: it leaves the queue and starts a turn right away, even
   * while one is running, which is what V1's force-send does. The store owns the interrupt and the
   * put-it-back-on-failure, so the prompt cannot be lost between the two calls.
   */
  const handleSendQueuedNow = async (item: ChatQueuedItem) => {
    await store.sendQueuedNow(item.id);
  };

  const handleStartEditQueued = (itemId: string, prompt: string) => {
    setEditingQueuedId(itemId);
    setEditingQueuedText(prompt);
  };

  const handleCancelEditQueued = () => {
    setEditingQueuedId(null);
    setEditingQueuedText("");
    queuedEditFocusedIdRef.current = null;
  };

  const handleSaveEditQueued = async (itemId: string) => {
    const next = editingQueuedText;
    setEditingQueuedId(null);
    setEditingQueuedText("");
    queuedEditFocusedIdRef.current = null;
    try {
      // An empty commit drops the item, which is how a queued prompt is cleared.
      await store.updateQueuedMessage(itemId, next);
    } catch {
      // Handled in store
    }
  };

  return (
    <>
      {queuedItems.length > 0 && (
        <div className="rounded-box border border-border bg-muted/60 p-2.5">
          <div className="flex items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-2">
              <span className="font-medium text-foreground">Queued Messages</span>
              <Badge
                variant="outline"
                className="min-w-5 justify-center rounded-full border-transparent bg-background px-1.5 text-xs text-foreground"
              >
                {queuedItems.length}
              </Badge>
              <span className="truncate text-xs text-muted-foreground">
                Sends after agent finishes working
              </span>
            </div>
            <IconButton
              data-testid="chat-queue-collapse"
              label={isQueueExpanded ? "Collapse queued messages" : "Expand queued messages"}
              size="sm"
              tone="muted"
              aria-expanded={isQueueExpanded}
              onClick={() => setIsQueueExpanded(!isQueueExpanded)}
            >
              <ChevronDown
                className={`size-4 transition-transform ${isQueueExpanded ? "" : "-rotate-90"}`}
              />
            </IconButton>
          </div>

          {isQueueExpanded && (
            <div className="mt-2 max-h-40 space-y-1 overflow-y-auto">
              {queuedItems.map((item) => (
                <div
                  key={item.id}
                  data-testid="queued-item"
                  className="flex items-center justify-between gap-2 rounded-selector bg-background px-2 py-1"
                >
                  {editingQueuedId === item.id ? (
                    <>
                      <Input
                        data-testid="queued-item-input"
                        aria-label="Edit queued prompt"
                        value={editingQueuedText}
                        ref={(node) => {
                          // Focus once per edit: re-focusing on every keystroke would fight
                          // the caret the user is moving.
                          if (node && queuedEditFocusedIdRef.current !== item.id) {
                            queuedEditFocusedIdRef.current = item.id;
                            node.focus();
                            node.select();
                          }
                        }}
                        onChange={(e) => setEditingQueuedText(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            void handleSaveEditQueued(item.id);
                          }
                          if (e.key === "Escape") {
                            e.preventDefault();
                            handleCancelEditQueued();
                          }
                        }}
                        className="h-7 flex-1 border-border bg-background px-1.5 py-0.5 text-foreground"
                      />
                      <IconButton
                        data-testid="queued-item-save"
                        label="Save queued prompt"
                        size="sm"
                        tone="muted"
                        onClick={() => void handleSaveEditQueued(item.id)}
                      >
                        <Check className="size-3.5" />
                      </IconButton>
                      <IconButton
                        data-testid="queued-item-cancel"
                        label="Cancel edit"
                        size="sm"
                        variant="danger"
                        tone="muted"
                        onClick={handleCancelEditQueued}
                      >
                        <X className="size-3.5" />
                      </IconButton>
                    </>
                  ) : (
                    <>
                      <span className="flex min-w-0 flex-1 items-center gap-1.5">
                        <span className="truncate text-foreground">
                          {item.prompt ||
                            (item.attachments && item.attachments.length > 0
                              ? `${item.attachments.length} attachment${item.attachments.length > 1 ? "s" : ""}`
                              : "")}
                        </span>
                        {item.attachments && item.attachments.length > 0 && (
                          <Badge
                            variant="outline"
                            className="shrink-0 gap-1 rounded-full border-transparent bg-muted px-1.5 text-xs-tight text-muted-foreground"
                          >
                            <Paperclip className="size-2.5" />
                            {item.attachments.length}
                          </Badge>
                        )}
                      </span>
                      <div className="flex shrink-0 items-center gap-1.5">
                        <IconButton
                          data-testid="queued-item-send-now"
                          label="Send now"
                          size="sm"
                          tone="muted"
                          onClick={() => void handleSendQueuedNow(item)}
                        >
                          <ArrowRight className="size-3.5" />
                        </IconButton>
                        <IconButton
                          data-testid="queued-item-edit"
                          label="Edit queued prompt"
                          size="sm"
                          tone="muted"
                          onClick={() => handleStartEditQueued(item.id, item.prompt)}
                        >
                          <Pencil className="size-3.5" />
                        </IconButton>
                        <IconButton
                          label="Remove from queue"
                          size="sm"
                          variant="danger"
                          tone="muted"
                          onClick={() => store.deleteQueuedMessage(item.id)}
                        >
                          <Trash2 className="size-3.5" />
                        </IconButton>
                      </div>
                    </>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </>
  );
};
