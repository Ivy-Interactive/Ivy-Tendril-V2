import React, { useState, useEffect, useRef } from "react";
import {
  ChatBubble,
  ChatBubbleMessage,
  ChatBubbleAction,
  ChatBubbleActionWrapper,
  ChatInput,
  ChatMessageList,
} from "components-storybook/renderers";
import { PlanMarkdown } from "components-storybook/tendril";
import { chatStore, type ChatState } from "../state/chatStore";
import type { ChatMessage, ChatSession, ChatAttachment } from "../types/chat";
import {
  Plus,
  Edit2,
  Check,
  Trash2,
  Send,
  Square,
  Copy,
  ChevronDown,
  ChevronUp,
  FilePlus,
  Loader2,
  Paperclip,
  X,
} from "lucide-react";

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

  const processFiles = (fileList: FileList | File[]) => {
    const incoming = Array.from(fileList).map((file) => ({
      name: file.name,
      path: (file as unknown as { path?: string }).path || file.name,
      mimeType: file.type || undefined,
    }));
    setAttachments((prev) => {
      const existingPaths = new Set(prev.map((a) => a.path));
      const filtered = incoming.filter((a) => !existingPaths.has(a.path));
      return [...prev, ...filtered];
    });
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      processFiles(e.target.files);
      e.target.value = "";
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

  const handleCopyMessage = (msg: ChatMessage) => {
    navigator.clipboard.writeText(msg.content);
    setCopiedMessageId(msg.id);
    setTimeout(() => {
      setCopiedMessageId(null);
    }, 2000);
  };

  const handleCreatePlanFromMessage = (content: string) => {
    if (onCreatePlan) {
      onCreatePlan(content);
    }
  };

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
            <ChatMessageList className="h-full">
              {activeSession.messages.map((msg) => {
                const isUser = msg.role === "user";

                return (
                  <ChatBubble
                    key={msg.id}
                    variant={isUser ? "sent" : "received"}
                    layout={isUser ? "default" : "ai"}
                  >
                    <div className="flex flex-col max-w-3xl">
                      <ChatBubbleMessage
                        variant={isUser ? "sent" : "received"}
                        className={isUser ? "bg-emerald-600 text-white" : "bg-slate-900 border border-slate-800 text-slate-100"}
                      >
                        {isUser ? (
                          <div className="whitespace-pre-wrap text-sm leading-relaxed">{msg.content}</div>
                        ) : (
                          <div className="text-sm">
                            <PlanMarkdown
                              id={`chat-msg-${msg.id}`}
                              content={msg.content}
                              events={["OnAnswersChange"]}
                              eventHandler={(eventName, _widgetId, args) => {
                                if (eventName === "OnAnswersChange") {
                                  const payload = args[0] as
                                    | Array<{ questionId: string; answer: string[] | null }>
                                    | { questionId: string; answer: string[] | null };
                                  const items = Array.isArray(payload) ? payload : [payload];
                                  for (const item of items) {
                                    chatStore.submitAnswer(msg.id, item.questionId, item.answer);
                                  }
                                }
                              }}
                            />
                          </div>
                        )}

                        {msg.attachments && msg.attachments.length > 0 && (
                          <div
                            data-testid="message-attachments"
                            className={`mt-2 flex flex-wrap gap-1.5 pt-1.5 border-t ${
                              isUser ? "border-emerald-500/40" : "border-slate-800"
                            }`}
                          >
                            {msg.attachments.map((att, idx) => (
                              <div
                                key={`${att.path}-${idx}`}
                                className={`flex items-center gap-1 rounded px-2 py-0.5 text-xs ${
                                  isUser ? "bg-black/20 text-white/95" : "bg-slate-800 text-slate-300"
                                }`}
                                title={att.path}
                              >
                                <Paperclip className="size-3 opacity-75 shrink-0" />
                                <span className="max-w-[140px] truncate">{att.name}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </ChatBubbleMessage>

                      {/* Action bar on message */}
                      <ChatBubbleActionWrapper className={isUser ? "justify-end" : "justify-start"}>
                        <ChatBubbleAction
                          icon={<Copy className="size-3.5" />}
                          onClick={() => handleCopyMessage(msg)}
                          className={copiedMessageId === msg.id ? "text-emerald-400" : "text-slate-400"}
                        />
                        <button
                          type="button"
                          onClick={() => handleCreatePlanFromMessage(msg.content)}
                          className="flex items-center gap-1 text-xs text-slate-400 hover:text-emerald-400 px-2 py-1 rounded transition-colors"
                          title="Create Plan from message"
                        >
                          <FilePlus className="size-3.5" />
                          <span>Create Plan</span>
                        </button>
                      </ChatBubbleActionWrapper>
                    </div>
                  </ChatBubble>
                );
              })}

              {isGenerating && (
                <div className="flex items-center gap-2 text-xs text-slate-400 px-4 py-2">
                  <Loader2 className="size-4 animate-spin text-emerald-500" />
                  <span>Generating response...</span>
                </div>
              )}
            </ChatMessageList>
          )}
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
                onClick={() => fileInputRef.current?.click()}
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
                  onChange={(e) => setInputPrompt(e.target.value)}
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
