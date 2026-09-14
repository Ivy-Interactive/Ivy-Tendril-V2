import React, { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { useResizableSidebar } from "@ivy-interactive/components";
import { ChatMessageList } from "@ivy-interactive/components/renderers";
import { ContentInput } from "@ivy-interactive/components/tendril";
import { Input } from "@ivy-interactive/components/ui";
import { chatStore, type ChatState } from "../state/chatStore";
import { jobsStore } from "../state/jobsStore";
import type { ChatMessage, ChatSession, ChatAttachment } from "../types/chat";
import type { Job } from "../types/api";
import { PIN_TOP_PADDING, useChatAutoScroll } from "../hooks/useChatAutoScroll";
import {
  useChatMessageWindow,
  CHAT_VIRTUALIZATION_MIN_MESSAGES,
  estimateChatMessageHeight,
} from "../hooks/useChatMessageWindow";
import { ChatMessageRow } from "./ChatMessageRow";
import { ChatHeader } from "./ChatHeader";
import { AgentPicker } from "../components/chat/AgentPicker";
import { ImageLightbox, type LightboxImage } from "../components/chat/ImageLightbox";
import { useWebviewFileDrop } from "../hooks/useWebviewFileDrop";
import { firstStringArg, submitValueArg } from "../utils/eventArgs";
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
  Pin,
  PinOff,
} from "lucide-react";
import { usePendingChatQuestions } from "../hooks/usePendingChatQuestions";

interface ChatViewProps {
  onCreatePlan?: (initialDescription: string) => void;
  /** Opens the plan a system event or a spawned job refers to. */
  onOpenPlan?: (planId: string) => void;
}

const CHAT_SIDEBAR_WIDTH_STORAGE_KEY = "tendril:chat:sidebar_width";
const DEFAULT_CHAT_SIDEBAR_WIDTH = 256;
const MIN_CHAT_SIDEBAR_WIDTH = 180;
const MAX_CHAT_SIDEBAR_WIDTH = 480;

const SAMPLE_PROMPTS = [
  { label: "Add a new project", prompt: "Add a new project to my tendril" },
  { label: "Edit verifications", prompt: "Edit verifications for my projects" },
  { label: "Create a team vault", prompt: "Create a shared team vault" },
  { label: "What should I work on next?", prompt: "What should I work on next?" },
  { label: "What shipped this week?", prompt: "What shipped this week?" },
];

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

export const ChatView: React.FC<ChatViewProps> = ({ onCreatePlan, onOpenPlan }) => {
  const [storeState, setStoreState] = useState<ChatState>(chatStore.getState());
  const [inputPrompt, setInputPrompt] = useState("");
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [isQueueExpanded, setIsQueueExpanded] = useState(false);
  const [editingQueuedId, setEditingQueuedId] = useState<string | null>(null);
  const [editingQueuedText, setEditingQueuedText] = useState("");
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const [activeLightboxImage, setActiveLightboxImage] = useState<LightboxImage | null>(null);
  const [jobs, setJobs] = useState<Job[]>(jobsStore.getState().jobs);
  const composerRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const queuedEditFocusedIdRef = useRef<string | null>(null);
  const pinnedMessageRef = useRef<{ id: string; content: string } | null>(null);

  const [focusRequest, setFocusRequest] = useState(0);

  /**
   * Focus is requested rather than taken: ContentInput refuses to adopt a new `value` while its
   * textarea has focus, so prefilling the composer has to land before the focus does.
   */
  const requestComposerFocus = useCallback(() => {
    setFocusRequest((n) => n + 1);
  }, []);

  useEffect(() => {
    if (focusRequest === 0) return;
    composerRef.current?.querySelector("textarea")?.focus();
  }, [focusRequest]);

  const {
    width: sidebarWidth,
    isDragging: isResizingSidebar,
    separatorProps,
  } = useResizableSidebar({
    storageKey: CHAT_SIDEBAR_WIDTH_STORAGE_KEY,
    defaultWidth: DEFAULT_CHAT_SIDEBAR_WIDTH,
    minWidth: MIN_CHAT_SIDEBAR_WIDTH,
    maxWidth: MAX_CHAT_SIDEBAR_WIDTH,
  });

  useEffect(() => {
    const unsub = chatStore.subscribe(() => {
      setStoreState({ ...chatStore.getState() });
    });
    chatStore.init().catch(() => {});
    return () => {
      unsub();
      void chatStore.pruneEmptySessions();
    };
  }, []);

  // The spawned jobs pill reads its statuses from the live job list.
  useEffect(() => {
    const unsub = jobsStore.subscribe(() => {
      setJobs([...jobsStore.getState().jobs]);
    });
    return unsub;
  }, []);

  const {
    sessions,
    activeSessionId,
    activeSession,
    queuedItems,
    isGenerating,
    error,
    agents,
    selectedAgentId,
    selectedModelId,
    selectedEffort,
  } = storeState;

  const spawnedJobs = useMemo(() => {
    const ids = activeSession?.spawnedJobIds ?? [];
    if (ids.length === 0) return [];
    return ids
      .map((id) => jobs.find((job) => job.id === id))
      .filter((job): job is Job => job !== undefined);
  }, [activeSession?.spawnedJobIds, jobs]);

  const latestMessage = activeSession?.messages[activeSession.messages.length - 1];
  const streamContentKey = `${activeSession?.id ?? ""}-${activeSession?.messages.length ?? 0}-${latestMessage?.id ?? ""}-${latestMessage?.content.length ?? 0}-${isGenerating}`;

  const {
    scrollContainerRef,
    anchorRef,
    spacerRef,
    autoScrollEnabled,
    isAtBottom,
    toggleAutoScroll,
    scrollToTail,
    resetToTail,
    pinMessage,
    retargetPin,
    clearPin,
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
      requestComposerFocus();
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

  const handleSendMessage = async (overrideText?: string) => {
    const text = (overrideText ?? inputPrompt).trim();
    if ((!text && attachments.length === 0) || isGenerating) return;
    const currentAttachments = attachments.length > 0 ? [...attachments] : undefined;
    setInputPrompt("");
    setAttachments([]);
    resetToTail();
    try {
      // The store appends its optimistic user message synchronously, so the row to pin exists by
      // the time this returns to us — pin it so the question sits at the top while the reply grows.
      const pending = chatStore.sendMessage(text, {
        attachments: currentAttachments,
      });
      const optimistic = chatStore.getState().activeSession?.messages.at(-1);
      if (optimistic?.role === "user") {
        pinnedMessageRef.current = { id: optimistic.id, content: optimistic.content };
        pinMessage(optimistic.id);
      }
      await pending;
    } catch {
      // Handled in store
    }
  };

  /**
   * Plain Enter sends. ContentInput submits on ⌘/Ctrl+Enter itself, so this handler deliberately
   * ignores the modifier combination rather than sending the same prompt twice.
   */
  const handleComposerKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "Enter" || e.shiftKey || e.metaKey || e.ctrlKey || e.altKey) return;
    e.preventDefault();
    void handleSendMessage();
  };

  const handleComposerEvent = (eventName: string, _id: string, args: unknown[]) => {
    if (eventName === "OnChange") {
      setInputPrompt(firstStringArg(args) ?? "");
      return;
    }
    if (eventName === "OnSubmit") {
      // ⌘/Ctrl+Enter: the payload is the authority on what was typed, because the last OnChange
      // may not have been applied to our state yet.
      void handleSendMessage(submitValueArg(args));
    }
  };

  /**
   * Drafts the follow-up rather than sending it: the outcomes are the agent's to summarise, but
   * what to ask about them is still the user's call, so the prompt lands in the composer.
   */
  const handleReviewJobs = () => {
    const summary = spawnedJobs
      .map((job) => `- ${job.type} ${job.id}${job.planTitle ? ` (${job.planTitle})` : ""}`)
      .join("\n");
    setInputPrompt(
      `Review the outcomes of the jobs this conversation started and tell me what changed:\n${summary}`,
    );
    requestComposerFocus();
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
      await chatStore.updateQueuedMessage(itemId, next);
    } catch {
      // Handled in store
    }
  };

  const handleCopyMessage = useCallback((msg: ChatMessage) => {
    void navigator.clipboard.writeText(msg.content);
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
    [onCreatePlan],
  );

  const messages = activeSession?.messages ?? [];

  // The optimistic user message is superseded by the server's copy, which arrives under a
  // different id, so the pin has to follow the content across the swap or it loses its target.
  useEffect(() => {
    const pinned = pinnedMessageRef.current;
    if (!pinned) return;
    if (messages.some((m) => m.id === pinned.id)) return;
    const replacement = messages.find((m) => m.role === "user" && m.content === pinned.content);
    if (replacement) {
      retargetPin(pinned.id, replacement.id);
      pinnedMessageRef.current = { ...pinned, id: replacement.id };
    } else {
      pinnedMessageRef.current = null;
      clearPin();
    }
  }, [messages, retargetPin, clearPin]);

  // A different conversation has nothing pinned, and a stale spacer would leave dead space.
  useEffect(() => {
    pinnedMessageRef.current = null;
    clearPin();
  }, [activeSessionId, clearPin]);

  const getMessageKey = useCallback((index: number) => messages[index].id, [messages]);

  const estimateMessageSize = useCallback(
    (index: number, clientWidth?: number) => {
      const msg = messages[index];
      if (!msg) return 160;
      return estimateChatMessageHeight(msg.content, {
        role: msg.role,
        hasAttachments: Boolean(msg.attachments && msg.attachments.length > 0),
        containerWidth: clientWidth,
      });
    },
    [messages],
  );

  const { isVirtualized, totalSize, items, scrollToIndex, visibleRange } = useChatMessageWindow({
    count: messages.length,
    scrollContainerRef,
    getItemKey: getMessageKey,
    enabled: messages.length >= CHAT_VIRTUALIZATION_MIN_MESSAGES,
    estimateSize: estimateMessageSize,
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
    [scrollToIndex],
  );

  /** The picker appears twice — icon-only in the header, labelled in the composer. */
  const renderAgentPicker = (compact: boolean) => (
    <AgentPicker
      instanceId={compact ? "agent-picker-header" : "agent-picker"}
      compact={compact}
      agents={agents}
      selectedAgentId={selectedAgentId}
      selectedModelId={selectedModelId}
      selectedEffort={selectedEffort}
      onAgentChange={(agentId) => chatStore.setAgent(agentId)}
      onModelChange={(agentId, modelId) => chatStore.setModelForAgent(agentId, modelId)}
      onEffortChange={(agentId, effort) => chatStore.setEffortForAgent(agentId, effort)}
      rememberedFor={(agentId) => chatStore.getAgentPreference(agentId)}
    />
  );

  const pinnedSessionsList = sessions.filter((s) => s.isPinned);
  const unpinnedSessionsList = sessions.filter((s) => !s.isPinned);

  const renderSessionItem = (session: ChatSession) => {
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
                  if (e.key === "Enter") void handleSaveRename(session.id);
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
              <div className="flex items-center gap-1.5 min-w-0">
                {session.isPinned && (
                  <Pin className="size-3 text-amber-400 shrink-0" data-testid="pin-indicator" />
                )}
                <span className="truncate text-xs font-medium">{session.title}</span>
              </div>
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
              onClick={(e) => {
                e.stopPropagation();
                chatStore.togglePinSession(session.id);
              }}
              className={`rounded p-1 ${
                session.isPinned
                  ? "text-amber-400 hover:bg-slate-700 hover:text-amber-300"
                  : "text-slate-400 hover:bg-slate-700 hover:text-slate-200"
              }`}
              title={session.isPinned ? "Unpin chat" : "Pin chat"}
            >
              {session.isPinned ? <PinOff className="size-3" /> : <Pin className="size-3" />}
            </button>
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
  };

  return (
    <div className="flex h-full w-full overflow-hidden bg-slate-950 text-slate-100">
      {/* Session Sidebar */}
      <aside
        style={{ width: `${sidebarWidth}px` }}
        className="relative flex flex-shrink-0 flex-col border-r border-slate-800 bg-slate-900/60"
      >
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
          ) : pinnedSessionsList.length > 0 ? (
            <>
              <div className="px-2.5 py-1 text-[10px] font-semibold text-slate-400 uppercase tracking-wider">
                Pinned
              </div>
              {pinnedSessionsList.map((session) => renderSessionItem(session))}
              {unpinnedSessionsList.length > 0 && (
                <>
                  <div className="pt-2 px-2.5 py-1 text-[10px] font-semibold text-slate-400 uppercase tracking-wider">
                    Recent
                  </div>
                  {unpinnedSessionsList.map((session) => renderSessionItem(session))}
                </>
              )}
            </>
          ) : (
            sessions.map((session) => renderSessionItem(session))
          )}
        </div>

        {/* Resizer Handle */}
        <div
          {...separatorProps}
          className={`absolute right-0 top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-emerald-500/50 transition-colors z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-1 focus-visible:ring-offset-slate-950 focus-visible:bg-emerald-500/50 ${
            isResizingSidebar ? "bg-emerald-500 w-2" : "bg-transparent"
          }`}
          title="Drag to resize chat sidebar, double-click to reset"
        />
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
        <ChatHeader
          title={activeSession ? activeSession.title : "No Active Chat"}
          messageCount={activeSession ? activeSession.messages.length : undefined}
          isGenerating={isGenerating}
          autoScrollEnabled={autoScrollEnabled}
          onToggleAutoScroll={toggleAutoScroll}
          jobs={spawnedJobs}
          onOpenPlan={onOpenPlan}
          onReviewJobs={handleReviewJobs}
          agentPicker={renderAgentPicker(true)}
        />

        {/* Message Thread List */}
        <div className="flex-1 overflow-hidden relative">
          {!activeSession || activeSession.messages.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center text-center p-6 text-slate-400">
              <div className="max-w-md space-y-4">
                <div className="space-y-2">
                  <h3 className="text-lg font-semibold text-slate-200">
                    Tendril Conversational Agent
                  </h3>
                  <p className="text-sm text-slate-400">
                    Ask questions, research codebase architecture, or plan new features. Interactive
                    question blocks and live streaming will appear here.
                  </p>
                </div>

                <div className="pt-2">
                  <div className="text-xs font-medium text-slate-500 mb-2.5 uppercase tracking-wider">
                    Suggested Prompts
                  </div>
                  <div className="flex flex-wrap justify-center gap-2" data-testid="sample-prompts">
                    {SAMPLE_PROMPTS.map((item) => (
                      <button
                        key={item.label}
                        type="button"
                        onClick={() => {
                          setInputPrompt(item.prompt);
                          requestComposerFocus();
                        }}
                        className="rounded-lg border border-slate-800 bg-slate-900/80 px-3 py-1.5 text-xs text-slate-300 hover:border-emerald-600 hover:bg-slate-800 hover:text-white transition-colors shadow-xs"
                      >
                        {item.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <ChatMessageList
              ref={scrollContainerRef}
              className="h-full"
              style={{ paddingTop: PIN_TOP_PADDING }}
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
                          inProgressAnswers={storeState.inProgressAnswers[msg.id]}
                          isSubmittingAnswer={chatStore.isSubmittingAnswer(msg.id)}
                          onOpenPlan={onOpenPlan}
                          onOpenImage={setActiveLightboxImage}
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
                      inProgressAnswers={storeState.inProgressAnswers[msg.id]}
                      isSubmittingAnswer={chatStore.isSubmittingAnswer(msg.id)}
                      onOpenPlan={onOpenPlan}
                      onOpenImage={setActiveLightboxImage}
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

              {/* Sized by the pin so the pinned row can sit at the top of the viewport. */}
              <div
                ref={spacerRef}
                data-testid="chat-pin-spacer"
                aria-hidden="true"
                className="w-full shrink-0 pointer-events-none"
                style={{ height: 0 }}
              />

              <div
                ref={anchorRef}
                data-testid="chat-scroll-anchor"
                className="h-px w-full pointer-events-none"
              />
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
              {isQueueExpanded ? (
                <ChevronDown className="size-3.5" />
              ) : (
                <ChevronUp className="size-3.5" />
              )}
            </div>

            {isQueueExpanded && (
              <div className="mt-2 max-h-32 overflow-y-auto space-y-1">
                {queuedItems.map((item) => (
                  <div
                    key={item.id}
                    data-testid="queued-item"
                    className="flex items-center justify-between gap-2 rounded bg-slate-950 px-2 py-1 text-xs border border-slate-800"
                  >
                    {editingQueuedId === item.id ? (
                      <>
                        <Input
                          data-testid="queued-item-input"
                          aria-label="Edit queued prompt"
                          value={editingQueuedText}
                          ref={(node) => {
                            // Focus once per edit: re-focusing on every keystroke would fight the
                            // caret the user is moving.
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
                          className="h-6 flex-1 border-slate-700 bg-slate-900 px-1.5 py-0.5 text-xs text-slate-100"
                        />
                        <button
                          type="button"
                          data-testid="queued-item-save"
                          onClick={() => void handleSaveEditQueued(item.id)}
                          className="text-slate-500 hover:text-emerald-400"
                          title="Save queued prompt"
                        >
                          <Check className="size-3" />
                        </button>
                        <button
                          type="button"
                          data-testid="queued-item-cancel"
                          onClick={handleCancelEditQueued}
                          className="text-slate-500 hover:text-slate-200"
                          title="Cancel edit"
                        >
                          <X className="size-3" />
                        </button>
                      </>
                    ) : (
                      <>
                        <span className="truncate pr-2 text-slate-300">{item.prompt}</span>
                        <div className="flex shrink-0 items-center gap-1.5">
                          <button
                            type="button"
                            data-testid="queued-item-edit"
                            onClick={() => handleStartEditQueued(item.id, item.prompt)}
                            className="text-slate-500 hover:text-emerald-400"
                            title="Edit queued prompt"
                          >
                            <Edit2 className="size-3" />
                          </button>
                          <button
                            type="button"
                            onClick={() => chatStore.deleteQueuedMessage(item.id)}
                            className="text-slate-500 hover:text-rose-400"
                            title="Remove from queue"
                          >
                            <Trash2 className="size-3" />
                          </button>
                        </div>
                      </>
                    )}
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
                data-testid="composer-attach-button"
                onClick={handleAttachClick}
                disabled={isGenerating}
                className="flex items-center justify-center rounded-lg border border-slate-700 bg-slate-800 p-3 text-slate-300 shadow hover:bg-slate-700 hover:text-white disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                title="Attach files from disk"
              >
                <Paperclip className="size-5" />
              </button>

              {/* ContentInput sends on ⌘/Ctrl+Enter itself; plain Enter is handled here. */}
              <div ref={composerRef} onKeyDown={handleComposerKeyDown} className="flex-1 relative">
                <ContentInput
                  id="chat-composer"
                  value={inputPrompt}
                  placeholder="Ask Tendril or discuss plans (Enter or ⌘/Ctrl+Enter to send, Shift+Enter for newline)..."
                  events={["OnChange", "OnSubmit"]}
                  eventHandler={handleComposerEvent}
                  slots={{ LeftActions: renderAgentPicker(false) }}
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
                  onClick={() => void handleSendMessage()}
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

        <ImageLightbox image={activeLightboxImage} onClose={() => setActiveLightboxImage(null)} />
      </main>
    </div>
  );
};

export default ChatView;
