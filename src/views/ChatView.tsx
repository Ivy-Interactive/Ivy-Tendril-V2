import React, { useState, useEffect, useRef, useCallback } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { ChatInput, ChatMessageList } from "@spacecorps/components-storybook/renderers";
import { chatStore, type ChatState } from "../state/chatStore";
import type { ChatMessage, ChatSession, ChatAttachment } from "../types/chat";
import { useChatAutoScroll } from "../hooks/useChatAutoScroll";
import { useChatMessageWindow, CHAT_VIRTUALIZATION_MIN_MESSAGES } from "../hooks/useChatMessageWindow";
import { ChatMessageRow } from "./ChatMessageRow";
import { useWebviewFileDrop } from "../hooks/useWebviewFileDrop";
import {
  Plus,
  Edit2,
  Check,
  Trash2,
  Send,
  Square,
  ChevronDown,
  ChevronUp,
  Loader2,
  Paperclip,
  X,
  ArrowDown,
  HelpCircle,
} from "lucide-react";
import { usePendingChatQuestions } from "../hooks/usePendingChatQuestions";

interface ChatViewProps {
  onCreatePlan?: (initialDescription: string) => void;
}

function formatRelativeTime(dateString: string): string {
  if (!dateString) return "";
  const date = new Date(dateString);
  const now = new Date();
  const diffSec = Math.floor((now.getTime() - date.getTime()) / 1000);
  if (isNaN(diffSec) || diffSec < 60) return "Just now";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d ago`;
}

export const ChatView: React.FC<ChatViewProps> = ({ onCreatePlan }) => {
  const [storeState, setStoreState] = useState<ChatState>(chatStore.getState());
  const [inputPrompt, setInputPrompt] = useState("");
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [isQueueExpanded, setIsQueueExpanded] = useState(false);
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const unsub = chatStore.subscribe(() => {
      setStoreState({ ...chatStore.getState() });
    });
    chatStore.init().catch(() => {});
    return () => unsub();
  }, []);

  const { sessions, activeSessionId, activeSession, queuedItems, isGenerating, error } =
    storeState;

  const latestMessage = activeSession?.messages[activeSession.messages.length - 1];
  const streamContentKey = `${activeSession?.id ?? ""}-${activeSession?.messages.length ?? 0}-${latestMessage?.id ?? ""}-${latestMessage?.content.length ?? 0}-${isGenerating}`;

  const {
    scrollContainerRef,
    anchorRef,
    autoScrollEnabled,
    isAtBottom,
    toggleAutoScroll,
    scrollToTail,
    resetToTail,
  } = useChatAutoScroll({
    content: streamContentKey,
    isGenerating,
  });

  const addAttachments = (incoming: ChatAttachment[]) => {
    setAttachments((prev) => {
      const existingPaths = new Set(prev.map((a) => a.path));
      return [...prev, ...incoming.filter((a) => !existingPaths.has(a.path))];
    });
  };

  const addAttachmentPaths = (paths: string[]) => {
    addAttachments(paths.map((path) => ({ name: path.split(/[/\\]/).pop() || path, path })));
  };

  const processFiles = (fileList: FileList | File[]) => {
    const incoming = Array.from(fileList).map((file) => ({
      name: file.name,
      path: (file as unknown as { path?: string }).path || file.name,
      mimeType: file.type || undefined,
    }));
    addAttachments(incoming);
  };

  const nativeDropActive = useWebviewFileDrop({
    onPaths: addAttachmentPaths,
    onDragStateChange: setIsDraggingOver,
  });

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      processFiles(e.target.files);
      e.target.value = "";
    }
  };

  const handleAttachClick = async () => {
    try {
      const selected = await open({
        multiple: true,
        title: "Select Files to Attach",
      });
      if (selected === null) {
        return;
      }
      const paths = Array.isArray(selected) ? selected : [selected];
      addAttachmentPaths(paths);
    } catch {
      fileInputRef.current?.click();
    }
  };

  const handleRemoveAttachment = (index: number) => {
    setAttachments((prev) => prev.filter((_, i) => i !== index));
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.currentTarget.contains(e.relatedTarget as Node)) return;
    setIsDraggingOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingOver(false);
    if (nativeDropActive) return;
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      processFiles(e.dataTransfer.files);
    }
  };

  const handleCreateSession = async () => {
    try {
      await chatStore.createSession("New Chat");
      if (textareaRef.current) {
        textareaRef.current.focus();
      }
    } catch {
      // Handled in store
    }
  };

  const handleStartRename = (session: ChatSession, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingSessionId(session.id);
    setEditTitle(session.title);
  };

  const handleSaveRename = async (id: string, e?: React.MouseEvent | React.FormEvent) => {
    if (e) e.stopPropagation();
    if (!editTitle.trim()) {
      setEditingSessionId(null);
      return;
    }
    try {
      await chatStore.renameSession(id, editTitle.trim());
    } finally {
      setEditingSessionId(null);
    }
  };

  const handleDeleteSession = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await chatStore.deleteSession(id);
    } catch {
      // Handled in store
    }
  };

    const handleSendMessage = async () => {
    const text = inputPrompt.trim();
    if ((!text && attachments.length === 0) || isGenerating) return;
    const currentAttachments = attachments.length > 0 ? [...attachments] : undefined;
    setInputPrompt("");
    setAttachments([]);
    resetToTail();
    try {
      await chatStore.sendMessage(text, {
        attachments: currentAttachments,
      });
    } catch {
      // Handled in store
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  const handleCopyMessage = useCallback((msg: ChatMessage) => {
    navigator.clipboard.writeText(msg.content);
    setCopiedMessageId(msg.id);
    setTimeout(() => {
      setCopiedMessageId(null);
    }, 2000);
  }, []);

  const handleCreatePlanFromMessage = useCallback(
    (content: string) => {
      if (onCreatePlan) {
        onCreatePlan(content);
      }
    },
    [onCreatePlan]
  );

  const messages = activeSession?.messages ?? [];

  const getMessageKey = useCallback((index: number) => messages[index].id, [messages]);

  const { isVirtualized, totalSize, items, scrollToIndex, visibleRange } = useChatMessageWindow({
    count: messages.length,
    scrollContainerRef,
    getItemKey: getMessageKey,
    enabled: messages.length >= CHAT_VIRTUALIZATION_MIN_MESSAGES,
    pinnedIndex: messages.length - 1,
  });

  const pendingQuestions = usePendingChatQuestions({
    messages,
    visibleRange,
  });

  const targetPendingQuestion = pendingQuestions.find((q) => q.isScrolledOutOfView);

  const handleJumpToQuestion = useCallback(
    (index: number) => {
      scrollToIndex(index, { smooth: true, align: "center" });
    },
    [scrollToIndex]
  );

  return (
    <div className="flex h-full w-full overflow-hidden bg-slate-950 text-slate-100">
      {/* Session Sidebar */}
      <aside className="flex w-64 flex-col border-r border-slate-800 bg-slate-900/60">
        <div className="p-3 border-b border-slate-800">
          <button
            type="button"
            onClick={handleCreateSession}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-medium text-white shadow hover:bg-emerald-500 transition-colors"
          >
            <Plus className="size-4" />
            <span>New Chat</span>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {sessions.length === 0 ? (
            <div className="p-4 text-center text-xs text-slate-400">
              No chat sessions yet. Click "New Chat" to start.
            </div>
          ) : (
            sessions.map((session) => {
              const isActive = session.id === activeSessionId;
              const isEditing = session.id === editingSessionId;

              return (
                <div
                  key={session.id}
                  onClick={() => chatStore.selectSession(session.id)}
                  className={`group flex items-center justify-between rounded-lg px-3 py-2 text-sm cursor-pointer transition-colors ${
                    isActive
                      ? "bg-slate-800 text-white font-medium shadow-sm"
                      : "text-slate-300 hover:bg-slate-800/50 hover:text-slate-100"
                  }`}
                >
                  <div className="flex-1 min-w-0 pr-2">
                    {isEditing ? (
                      <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                        <input
                          type="text"
                          value={editTitle}
                          onChange={(e) => setEditTitle(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") handleSaveRename(session.id);
                            if (e.key === "Escape") setEditingSessionId(null);
                          }}
                          autoFocus
                          className="w-full rounded bg-slate-950 px-1.5 py-0.5 text-xs text-white border border-slate-700 focus:outline-none focus:border-emerald-500"
                        />
                        <button
                          type="button"
                          onClick={(e) => handleSaveRename(session.id, e)}
                          className="text-slate-400 hover:text-emerald-400 p-0.5"
                          title="Save"
                        >
                          <Check className="size-3.5" />
                        </button>
                      </div>
                    ) : (
                      <>
                        <div className="truncate text-xs font-medium">{session.title}</div>
                        <div className="text-[10px] text-slate-500">
                          {formatRelativeTime(session.updatedAt || session.createdAt)}
                        </div>
                      </>
                    )}
                  </div>

                  {!isEditing && (
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        type="button"
                        onClick={(e) => handleStartRename(session, e)}
                        className="rounded p-1 text-slate-400 hover:bg-slate-700 hover:text-slate-200"
                        title="Rename"
                      >
                        <Edit2 className="size-3" />
                      </button>
                      <button
                        type="button"
                        onClick={(e) => handleDeleteSession(session.id, e)}
                        className="rounded p-1 text-slate-400 hover:bg-rose-900/50 hover:text-rose-300"
                        title="Delete"
                      >
                        <Trash2 className="size-3" />
                      </button>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </aside>

      {/* Main Chat Thread Area */}
      <main className="flex flex-1 flex-col overflow-hidden">
        {/* Error Banner */}
        {error && (
          <div className="border-b border-rose-800/50 bg-rose-950/40 px-4 py-2 text-xs text-rose-300 flex items-center justify-between">
            <span>{error}</span>
          </div>
        )}

        {/* Header Toolbar */}
        <div className="flex items-center justify-between border-b border-slate-800 bg-slate-900/40 px-4 py-2.5">
          <div className="flex items-center gap-3 min-w-0">
            <h2 className="text-sm font-medium text-slate-200 truncate">
              {activeSession ? activeSession.title : "No Active Chat"}
            </h2>
            {activeSession && (
              <span className="text-xs text-slate-500">
                {activeSession.messages.length} message{activeSession.messages.length === 1 ? "" : "s"}
              </span>
            )}
            {isGenerating && (
              <div className="flex items-center gap-1.5 rounded-full bg-emerald-950/60 border border-emerald-800/60 px-2 py-0.5 text-[11px] font-medium text-emerald-400">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                </span>
                <span>Streaming...</span>
              </div>
            )}
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              data-testid="chat-autoscroll-toggle"
              onClick={toggleAutoScroll}
              className={`rounded px-2 py-1 text-xs font-medium transition ${
                autoScrollEnabled
                  ? "bg-slate-800 text-emerald-400 border border-slate-700"
                  : "bg-slate-900 text-slate-400 border border-slate-800"
              }`}
              title="Toggle auto-scrolling to streaming deltas"
            >
              Auto-scroll: {autoScrollEnabled ? "ON" : "OFF"}
            </button>
          </div>
        </div>

        {/* Message Thread List */}
        <div className="flex-1 overflow-hidden relative">
          {!activeSession || activeSession.messages.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center text-center p-6 text-slate-400">
              <div className="max-w-md space-y-2">
                <h3 className="text-lg font-semibold text-slate-200">Tendril Conversational Agent</h3>
                <p className="text-sm text-slate-400">
                  Ask questions, research codebase architecture, or plan new features. Interactive question blocks and live streaming will appear here.
                </p>
              </div>
            </div>
          ) : (
            <ChatMessageList
              ref={scrollContainerRef}
              className="h-full"
              enableAutoScroll={false}
              showScrollButton={false}
            >
              {isVirtualized ? (
                <div
                  style={{ height: totalSize, position: "relative" }}
                  data-testid="chat-virtual-container"
                >
                  {items.map((item) => {
                    const msg = messages[item.index];
                    return (
                      <div
                        key={item.key}
                        ref={item.measureRef}
                        data-index={item.index}
                        data-testid="chat-virtual-row"
                        style={{
                          position: "absolute",
                          top: item.start,
                          left: 0,
                          width: "100%",
                          paddingBottom: 24,
                        }}
                      >
                        <ChatMessageRow
                          message={msg}
                          isCopied={copiedMessageId === msg.id}
                          onCopy={handleCopyMessage}
                          onCreatePlan={handleCreatePlanFromMessage}
                        />
                      </div>
                    );
                  })}
                </div>
              ) : (
                messages.map((msg, index) => (
                  <div key={msg.id} data-index={index}>
                    <ChatMessageRow
                      message={msg}
                      isCopied={copiedMessageId === msg.id}
                      onCopy={handleCopyMessage}
                      onCreatePlan={handleCreatePlanFromMessage}
                    />
                  </div>
                ))
              )}

              {isGenerating && (
                <div className="flex items-center gap-2 text-xs text-slate-400 px-4 py-2">
                  <Loader2 className="size-4 animate-spin text-emerald-500" />
                  <span>Generating response...</span>
                </div>
              )}

              <div ref={anchorRef} data-testid="chat-scroll-anchor" className="h-px w-full pointer-events-none" />
            </ChatMessageList>
          )}

          {/* Floating Actions: Jump to Pending Question & Scroll to Tail */}
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-10 flex flex-col items-center gap-2 pointer-events-none">
            {targetPendingQuestion && (
              <button
                type="button"
                data-testid="chat-jump-to-question-button"
                onClick={() => handleJumpToQuestion(targetPendingQuestion.messageIndex)}
                className="pointer-events-auto flex items-center gap-2 rounded-full bg-amber-950/90 border border-amber-700/80 px-3.5 py-1.5 text-xs font-medium text-amber-200 shadow-lg backdrop-blur hover:bg-amber-900 hover:text-amber-100 transition-all cursor-pointer"
              >
                <HelpCircle className="size-3.5 text-amber-400" />
                <span>
                  Jump to pending question {targetPendingQuestion.direction === "down" ? "↓" : "↑"}
                </span>
              </button>
            )}

            {!isAtBottom && (
              <button
                type="button"
                data-testid="chat-scroll-tail-button"
                onClick={() => scrollToTail(true)}
                className="pointer-events-auto flex items-center gap-2 rounded-full bg-slate-900/90 border border-slate-700 px-3.5 py-1.5 text-xs font-medium text-slate-200 shadow-lg backdrop-blur hover:bg-slate-800 hover:text-white transition-all cursor-pointer"
              >
                <ArrowDown className="size-3.5 text-emerald-400" />
                {isGenerating ? (
                  <>
                    <span>Scroll to streaming tail</span>
                    <span className="flex h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
                  </>
                ) : (
                  <span>Scroll to bottom</span>
                )}
              </button>
            )}
          </div>
        </div>

        {/* Queued Items Drawer */}
        {queuedItems.length > 0 && (
          <div className="border-t border-slate-800 bg-slate-900/80 px-4 py-2">
            <div
              className="flex items-center justify-between cursor-pointer text-xs font-semibold text-slate-300 select-none"
              onClick={() => setIsQueueExpanded(!isQueueExpanded)}
            >
              <div className="flex items-center gap-2">
                <span>Queued Prompts ({queuedItems.length})</span>
              </div>
              {isQueueExpanded ? <ChevronDown className="size-3.5" /> : <ChevronUp className="size-3.5" />}
            </div>

            {isQueueExpanded && (
              <div className="mt-2 max-h-32 overflow-y-auto space-y-1">
                {queuedItems.map((item) => (
                  <div
                    key={item.id}
                    className="flex items-center justify-between rounded bg-slate-950 px-2 py-1 text-xs border border-slate-800"
                  >
                    <span className="truncate pr-2 text-slate-300">{item.prompt}</span>
                    <button
                      type="button"
                      onClick={() => chatStore.deleteQueuedMessage(item.id)}
                      className="text-slate-500 hover:text-rose-400"
                      title="Remove from queue"
                    >
                      <Trash2 className="size-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Composer Input Area */}
        <div
          onDragOver={handleDragOver}
          onDragEnter={handleDragEnter}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          className={`relative border-t p-4 transition-colors ${
            isDraggingOver
              ? "border-emerald-500 bg-emerald-950/20 ring-2 ring-emerald-500/50 ring-dashed"
              : "border-slate-800 bg-slate-900"
          }`}
        >
          {isDraggingOver && (
            <div className="absolute inset-0 z-10 flex items-center justify-center bg-slate-950/80 backdrop-blur-xs border-2 border-dashed border-emerald-500 pointer-events-none">
              <div className="flex items-center gap-2 text-emerald-400 font-medium text-sm">
                <Paperclip className="size-5 animate-bounce" />
                <span>Drop files here to attach</span>
              </div>
            </div>
          )}

          <div className="max-w-4xl mx-auto space-y-2">
            {/* Attachment chip list */}
            {attachments.length > 0 && (
              <div
                data-testid="composer-attachment-chips"
                className="flex flex-wrap items-center gap-1.5 pb-1"
              >
                {attachments.map((att, index) => (
                  <div
                    key={`${att.path}-${index}`}
                    className="flex items-center gap-1 rounded-md bg-slate-800 border border-slate-700 px-2 py-1 text-xs text-slate-200 shadow-sm"
                    title={att.path}
                  >
                    <Paperclip className="size-3 text-slate-400 shrink-0" />
                    <span className="max-w-[140px] truncate">{att.name}</span>
                    <button
                      type="button"
                      onClick={() => handleRemoveAttachment(index)}
                      className="ml-0.5 rounded p-0.5 text-slate-400 hover:bg-slate-700 hover:text-slate-100"
                      title={`Remove ${att.name}`}
                    >
                      <X className="size-3" />
                    </button>
                  </div>
                ))}
                {attachments.length > 1 && (
                  <button
                    type="button"
                    onClick={() => setAttachments([])}
                    className="text-[11px] text-slate-400 hover:text-rose-400 px-1.5 py-0.5 rounded transition-colors"
                  >
                    Clear all
                  </button>
                )}
              </div>
            )}

            <div className="flex items-end gap-2">
              <input
                ref={fileInputRef}
                type="file"
                multiple
                className="hidden"
                data-testid="file-upload-input"
                onChange={handleFileInputChange}
              />
              <button
                type="button"
                onClick={handleAttachClick}
                disabled={isGenerating}
                className="flex items-center justify-center rounded-lg border border-slate-700 bg-slate-800 p-3 text-slate-300 shadow hover:bg-slate-700 hover:text-white disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                title="Attach files"
              >
                <Paperclip className="size-5" />
              </button>

              <div className="flex-1 relative">
                <ChatInput
                  ref={textareaRef}
                  value={inputPrompt}
                  onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setInputPrompt(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Ask Tendril or discuss plans (Enter to send, Shift+Enter for newline)..."
                  disabled={isGenerating}
                  className="w-full min-h-[48px] max-h-32 bg-slate-950 text-slate-100 border-slate-800 focus-visible:ring-emerald-500"
                />
              </div>

              {isGenerating ? (
                <button
                  type="button"
                  onClick={() => chatStore.cancelGeneration()}
                  className="flex items-center justify-center rounded-lg bg-rose-600 p-3 text-white shadow hover:bg-rose-500 transition-colors"
                  title="Stop generation"
                >
                  <Square className="size-5" />
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handleSendMessage}
                  disabled={!inputPrompt.trim() && attachments.length === 0}
                  className="flex items-center justify-center rounded-lg bg-emerald-600 p-3 text-white shadow hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  title="Send message"
                >
                  <Send className="size-5" />
                </button>
              )}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
};

export default ChatView;
