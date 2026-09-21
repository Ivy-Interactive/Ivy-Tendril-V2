import React, { useState, useEffect, useLayoutEffect, useMemo, useRef, useCallback } from "react";
import { ChatInput, ChatMessageList } from "@ivy-interactive/components/renderers";
import {
  VoiceRecorder,
  clipboardFiles,
  type VoiceStatus,
} from "@ivy-interactive/components/tendril";
import { IconButton, Spinner, TooltipScope } from "@ivy-interactive/components/ui";
import { usePublishSidebarList } from "../state/sidebarListStore";
import { chatStore, type ChatState, type ChatStore } from "../state/chatStore";
import { chatLauncher } from "../state/chatLauncher";
import type { ChatMode } from "../state/appearance";
import { jobsStore } from "../state/jobsStore";
import { plansStore } from "../state/plansStore";
import type { Job, PlanSummary } from "../types/api";
import { PIN_TOP_PADDING, useChatAutoScroll } from "../hooks/useChatAutoScroll";
import {
  useChatMessageWindow,
  CHAT_VIRTUALIZATION_MIN_MESSAGES,
  estimateChatMessageHeight,
} from "../hooks/useChatMessageWindow";
import { ConfirmDialog } from "./dialogs/ConfirmDialog";
import { ChatMessageRow } from "./ChatMessageRow";
import { ChatHeader, JobsMenu } from "./ChatHeader";
import { AgentPicker } from "../components/chat/AgentPicker";
import { ImageLightbox, type LightboxImage } from "../components/chat/ImageLightbox";
import { ComposerAttachment } from "../components/chat/ComposerAttachment";
import { ErrorBanner } from "../components/ErrorBanner";
import { resolveJobState } from "../utils/jobStatus";
import {
  ArrowDown,
  HelpCircle,
  ListPlus,
  Mic,
  Paperclip,
  SendHorizontal,
  Square,
  Upload,
} from "lucide-react";
import { usePendingChatQuestions } from "../hooks/usePendingChatQuestions";
import { useWireframeBaseUrl } from "../api/proxyOrigin";
import { ChatEmptyState } from "./chat/ChatEmptyState";
import { ChatSearchDialog } from "./chat/ChatSearchDialog";
import { ChatQueuedMessages } from "./chat/QueuedMessages";
import { needsMultipleLines } from "./chat/composerMetrics";
import { buildChatSamplePrompts, buildGreeting, type SamplePrompt } from "./chat/samplePrompts";
import { buildChatSidebarList, displayTitle } from "./chat/sidebarList";
import { useChatAttachments } from "./chat/useChatAttachments";

/**
 * The conversation's own pieces, split out of this file and re-exported so every caller keeps the
 * one import it already had: `PlanChatPanel` takes the plan prompts, `ConfigEditorView` the chip
 * type, and `chat-composer-multiline.test.ts` the measurement.
 */
export {
  buildChatSamplePrompts,
  buildPlanSamplePrompts,
  type SamplePrompt,
  type SamplePromptPlan,
} from "./chat/samplePrompts";
export { buildChatSidebarList, type ChatSidebarListActions } from "./chat/sidebarList";
export { needsMultipleLines } from "./chat/composerMetrics";

interface ChatViewProps {
  /** Opens the plan a system event or a spawned job refers to. */
  onOpenPlan?: (planId: string) => void;
  /**
   * The store this conversation is read from and written through. Defaults to the app-wide one the
   * Chat page owns; the chat beside a plan passes a plan-scoped instance, which is what V1's
   * `PlanChatView` does by holding its own `activeSessionId` over the one shared history service.
   */
  store?: ChatStore;
  /**
   * `Chat.ContentView(embedded: true)`: this chat is hosted inside another page rather than being
   * the page. The table above {@link ChatView} says exactly what that turns off.
   */
  embedded?: boolean;
  /**
   * `ContentView`'s `greeting`. The Chat page passes the time-of-day line; the plan panel passes
   * `$"#{plan.Id} {plan.Title}"`, which is where the plan's name is shown — V1's embedded chat has
   * no title bar to put it in.
   */
  greeting?: string;
  /** `ContentView`'s `headline`: `PlanChatView.Headline` embedded, V1's chat headline otherwise. */
  headline?: string;
  /** `ContentView`'s `samplePrompts`. Absent means `SamplePrompts.ForChat` off the live plan list. */
  samplePrompts?: SamplePrompt[];
  /**
   * A line the host wants drafted into the composer, not sent — "Discuss with agent" on a plan page
   * is the one thing that asks for it. The token is what makes a repeat request work: an unchanged
   * string compares equal and nothing would move.
   */
  draftPrompt?: { text: string; token: number };
}

/** `ChatSearchDialog.MaxResults`: the search dialog never lists more than fifteen chats. */
const MAX_CHAT_SEARCH_RESULTS = 15;

/** The transcription socket the shared composer defaults to; the mic here speaks to the same one. */
const TRANSCRIPTION_URL = "wss://tendril-api.ivy.app/transcribe/ws";

/** The composer's headline prompt, and the placeholder it writes under. */
const COMPOSER_PLACEHOLDER = "Ask Tendril anything...";
const EMPTY_STATE_HEADLINE = "What Are We Producing Today?";

/**
 * The conversation, which is `Apps/Chat/ContentView` — the *same* view whether it is the Chat page or
 * the panel beside a plan. V1 has exactly one chat view and two callers; `embedded` is the whole of
 * the difference, and `Apps/Views/PlanChatView` is the second caller.
 *
 * Every effect here that reaches outside this subtree, and what an embedded instance does with it.
 * Written out in full rather than gated where noticed: a sidebar publish or a webview listener
 * leaking out of the panel beside a plan is a bug nobody would think to look for in this file.
 *
 * | effect | embedded |
 * | --- | --- |
 * | `store.subscribe` / `store.init()` | **kept** — it is the conversation. The panel's store is its own, so `init()` opens a second `chat-event` listener; unmount `destroy()`s it, so a visit leaks nothing. |
 * | `store.pruneEmptySessions()` on unmount | **off**. V1 prunes in `ChatApp`, not in `ContentView`, and an embedded prune would reach chats the panel does not own. |
 * | `usePublishSidebarList` | **off**, and the list is not even built. `PlanChatView` publishes none, which is exactly why V1's embedded chat shows no session list. |
 * | the Chats search dialog | **off**. Only the published list's `onSearch` opens it, so it is already unreachable; not rendering it keeps a second `Dialog` off the plan page. |
 * | `useWebviewFileDrop` | **off**. It listens on the *webview*, not on this subtree, so a second registration would answer drops made anywhere in the app. The React drag handlers stay — those are scoped — and the paperclip still opens the file dialog. |
 * | `ChatHeader` | **off**: V1 swaps the whole header for a right-aligned `JobsMenu` that appears only once the conversation has jobs. So no rename, no delete menu, and no new-chat button — `PlanChatView` passes `startNewChat: () => { }`. |
 * | composer keys, voice recorder, autoscroll, lightbox, `ResizeObserver` | **kept**: all of them are this instance's own DOM. |
 * | `jobsStore` / `plansStore` subscriptions | **kept**. Read-only, and `PlanChatView` subscribes to `JobsChanged` for the same reason — the jobs pill follows the live list. |
 *
 * There is no keyboard shortcut to gate: the composer's Enter handling is a `keydown` on its own
 * textarea, and every registered `useShortcut` in the app belongs to `App.tsx` or `PlanWorkspace`.
 */
export const ChatView: React.FC<ChatViewProps> = ({
  onOpenPlan,
  store = chatStore,
  embedded = false,
  greeting: greetingOverride,
  headline = EMPTY_STATE_HEADLINE,
  samplePrompts: samplePromptsOverride,
  draftPrompt,
}) => {
  const [storeState, setStoreState] = useState<ChatState>(() => store.getState());
  const [inputPrompt, setInputPrompt] = useState("");
  /** `ChatApp`'s own search trigger, opened from the Chats section's search icon. */
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  // The chat beside a plan resolves `wireframe` fences against that plan; the general chat page
  // has no plan, so a fence there renders a placeholder. The base names the daemon's origin, not
  // the app's -- see `useWireframeBaseUrl`.
  const wireframeBaseUrl = useWireframeBaseUrl(store.planId);

  const [activeLightboxImage, setActiveLightboxImage] = useState<LightboxImage | null>(null);
  const [deletingSessionId, setDeletingSessionId] = useState<string | null>(null);
  const [deleteSessionError, setDeleteSessionError] = useState<string | null>(null);
  const [isDeletingSession, setIsDeletingSession] = useState(false);
  const [jobs, setJobs] = useState<Job[]>(jobsStore.getState().jobs);
  const [plans, setPlans] = useState<PlanSummary[]>(plansStore.getState().plans);
  const [multiline, setMultiline] = useState(false);
  const [voiceStatus, setVoiceStatus] = useState<VoiceStatus>("idle");
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const inputRowRef = useRef<HTMLDivElement>(null);
  const recorderRef = useRef<VoiceRecorder | null>(null);
  const pinnedMessageRef = useRef<{ id: string; content: string } | null>(null);
  /**
   * What the composer holds right now, so callers that *append* to the prompt (the transcriber) do
   * not need the functional form of `setInputPrompt` - a functional updater cannot also write the
   * draft through to the store, because React may run it twice.
   */
  const composerTextRef = useRef("");
  /**
   * Which session {@link composerTextRef} belongs to. Compared before seeding so a re-render that
   * did not change the conversation leaves a prompt being typed alone, and so the text of the chat
   * being left is never written against the id of the chat being opened.
   */
  const composerSessionRef = useRef<string | null>(null);

  const requestComposerFocus = useCallback(() => {
    textareaRef.current?.focus();
  }, []);

  const syncMultiline = useCallback(() => {
    const el = textareaRef.current;
    if (el) setMultiline(needsMultipleLines(el, inputRowRef.current));
  }, []);

  /** Grows the field with its content up to the ten-line ceiling the stylesheet caps it at. */
  const adjustTextareaHeight = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    syncMultiline();
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [syncMultiline]);

  // The toolbar moving above or back beside the text changes the textarea's width, so its height
  // follows; on mount the textarea keeps its stylesheet height.
  const shownMultilineRef = useRef(multiline);
  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el || shownMultilineRef.current === multiline) return;
    shownMultilineRef.current = multiline;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [multiline]);

  useEffect(() => {
    const row = inputRowRef.current;
    if (!row || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => syncMultiline());
    observer.observe(row);
    return () => observer.disconnect();
  }, [syncMultiline]);

  useEffect(() => () => recorderRef.current?.stop(), []);

  useEffect(() => {
    setStoreState({ ...store.getState() });
    const unsub = store.subscribe(() => {
      setStoreState({ ...store.getState() });
    });
    store.init().catch(() => {});
    return () => {
      unsub();
      if (embedded) {
        // The panel owns this store, so it takes the `chat-event` subscription down with it rather
        // than leaving one behind per visit to a plan page. And it prunes nothing: V1 prunes in
        // `ChatApp`, not in the `ContentView` the panel is, and a prune here would reach chats the
        // panel never showed.
        store.destroy();
      } else {
        void store.pruneEmptySessions();
      }
    };
  }, [store, embedded]);

  // The spawned jobs pill reads its statuses from the live job list.
  useEffect(() => {
    const unsub = jobsStore.subscribe(() => {
      setJobs([...jobsStore.getState().jobs]);
    });
    return unsub;
  }, []);

  // The empty state's chips are drawn from the plans that need attention, so they follow the plan
  // list rather than a snapshot taken when the view mounted.
  useEffect(() => {
    const unsub = plansStore.subscribe(() => {
      setPlans([...plansStore.getState().plans]);
    });
    return unsub;
  }, []);

  const {
    sessions,
    activeSessionId,
    activeSession,
    queuedItems,
    isGenerating,
    isCancelling,
    error,
    agents,
    selectedAgentId,
    selectedModelId,
    selectedEffort,
  } = storeState;

  /**
   * The single way the composer's text changes, so the store's per-session draft cannot drift from
   * what is on screen.
   *
   * It writes through `composerSessionRef` rather than `activeSessionId` so the callback identity
   * stays stable and a write can never land against a session the composer has already left.
   */
  const applyComposerText = useCallback(
    (text: string) => {
      composerTextRef.current = text;
      setInputPrompt(text);
      store.setComposerDraft(composerSessionRef.current, text);
    },
    [store],
  );

  /**
   * Seeds the composer from the session's saved draft whenever the conversation on screen changes,
   * mount included.
   *
   * This is what makes a half-typed prompt survive leaving the Chat page: it is a `React.lazy`
   * route, so navigating away unmounts this component and everything in `useState` with it. V1 has
   * no equivalent because its `ChatWidget` stays mounted and keeps the prompt in plain component
   * state (`const [promptText, setPromptText] = useState("")`); the store is standing in for that
   * continuity, per session so one chat's prompt never appears in another's box.
   */
  useEffect(() => {
    const previous = composerSessionRef.current;
    if (previous === activeSessionId) return;
    composerSessionRef.current = activeSessionId;

    // A session that appeared *under* a prompt already being typed adopts it: the empty state has
    // no session until the first send creates one, and wiping the box at that moment would throw
    // away the very prompt that caused it.
    if (previous === null && composerTextRef.current) {
      store.setComposerDraft(activeSessionId, composerTextRef.current);
      return;
    }

    const draft = store.composerDraft(activeSessionId);
    composerTextRef.current = draft;
    setInputPrompt(draft);
    // The field's height is styled from its content, and the content arrived after this render.
    if (typeof requestAnimationFrame !== "undefined") {
      requestAnimationFrame(adjustTextareaHeight);
    }
  }, [store, activeSessionId, adjustTextareaHeight]);

  // Keyed on the token, not the text, so asking twice re-drafts the same line over an edited one.
  const draftToken = draftPrompt?.token ?? 0;
  const draftText = draftPrompt?.text ?? "";
  useEffect(() => {
    if (draftToken > 0) applyComposerText(draftText);
  }, [draftToken, draftText, applyComposerText]);

  /**
   * The jobs this conversation started. A job that has aged out of the live list keeps its place,
   * with the outcome recovered from the transcript — a conversation's own jobs disappearing from
   * the header is worse than showing one with a thinner label.
   */
  const spawnedJobs = useMemo(() => {
    const sessionId = activeSession?.id;
    // Two sources for the same fact, unioned as V1's `ToSessionDto` unions them. The job's own
    // `chatSessionId` is the durable one — the daemon recorded it when the job was submitted — and it
    // is what makes the header right after a reload, or when the `chat.job_spawned` announcing a job
    // arrived while another conversation was on screen. The session's `spawnedJobIds` then adds back
    // the jobs that have aged out of the live list, whose outcome the transcript still holds.
    const ids = [
      ...(sessionId ? jobs.filter((job) => job.chatSessionId === sessionId).map((j) => j.id) : []),
      ...(activeSession?.spawnedJobIds ?? []),
    ].filter((id, index, all) => all.indexOf(id) === index);
    if (ids.length === 0) return [];
    const history = activeSession?.messages ?? [];

    return ids
      .map((id): Job | undefined => {
        const live = jobs.find((job) => job.id === id);
        if (live) return live;

        const state = resolveJobState(id, jobs, history);
        if (state === "unknown") return undefined;
        return {
          id,
          type: "Job",
          project: "",
          status: state === "completed" ? "Completed" : "Failed",
        };
      })
      .filter((job): job is Job => job !== undefined);
    // `messages.length` rather than `messages`: the store appends to that array in place, so its identity
    // does not change when a message arrives and a memo keyed on it alone keeps its previous value
    // however many times the component re-renders. A job whose outcome is only knowable from a
    // just-arrived `[System Event]` would never appear.
  }, [
    activeSession?.id,
    activeSession?.spawnedJobIds,
    activeSession?.messages,
    activeSession?.messages.length,
    jobs,
  ]);

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

  const {
    attachments,
    setAttachments,
    isDraggingOver,
    stagingPaths,
    stagingRef,
    fileInputRef,
    processFiles,
    handleFileInputChange,
    handleAttachClick,
    handleRemoveAttachment,
    handleDragOver,
    handleDragEnter,
    handleDragLeave,
    handleDrop,
  } = useChatAttachments({ activeSessionId: activeSession?.id, embedded });

  /**
   * The bug this page was the centre of: this used to call `store.createSession` directly, so the
   * `chatMode` setting was ignored by the header button, the Chats-list "+", and -- through
   * `ShellLayout`'s `(source?.onNew ?? onNewChat)` -- the collapsed rail's flyout and its
   * Cmd/Ctrl+Alt+N chord too. All four now go through V1's single `ChatLauncher`.
   */
  const handleCreateSession = async (override?: ChatMode) => {
    try {
      const target = await chatLauncher.startNew(override);
      // Only when the user stayed here: focusing this composer after being sent to a terminal pane
      // would pull the caret out of the pane the press just opened.
      if (target === "chat") requestComposerFocus();
    } catch {
      // Handled in store
    }
  };

  /** Deleting a conversation is confirmed first: V1 puts a dialog in front of it. */
  /**
   * Deletes the session the dialog is asking about, keeping the dialog open on failure so the
   * rejection can be read where the button was pressed — the whole reason this went through
   * `ConfirmDialog` rather than a bare `AlertDialog`, which had nowhere to report one.
   */
  const confirmDeleteSession = async () => {
    const id = deletingSessionId;
    if (!id) return;
    setDeleteSessionError(null);
    setIsDeletingSession(true);
    try {
      await store.deleteSession(id);
      setDeletingSessionId(null);
    } catch (err) {
      setDeleteSessionError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsDeletingSession(false);
    }
  };

  /**
   * Clears the composer after a send or a queue, and lets the field collapse to one line. The
   * saved draft goes with it: the prompt is in the transcript now, so restoring it on the way back
   * would put a message the user already sent back in their box.
   */
  const resetComposer = () => {
    applyComposerText("");
    setAttachments([]);
    // The next message attaching the same file gets its own copy: this one has been sent, and a second
    // chip pointing at the first message's file would be re-using something the user cannot see.
    stagingRef.current.clear();
    setMultiline(false);
    if (textareaRef.current) textareaRef.current.style.height = "auto";
  };

  /**
   * Sends, or queues while the agent is still working: V1's composer never refuses a prompt, it
   * parks it behind the turn in flight and sends it when the agent finishes.
   */
  const handleSendMessage = async (overrideText?: string) => {
    const text = (overrideText ?? inputPrompt).trim();
    if (!text && attachments.length === 0) return;
    const currentAttachments = attachments.length > 0 ? [...attachments] : undefined;

    if (isGenerating) {
      resetComposer();
      try {
        await store.sendMessage(text, { enqueue: true, attachments: currentAttachments });
      } catch {
        // Handled in store
      }
      return;
    }

    resetComposer();
    resetToTail();
    try {
      // The store appends its optimistic user message synchronously, so the row to pin exists by
      // the time this returns to us — pin it so the question sits at the top while the reply grows.
      const pending = store.sendMessage(text, {
        attachments: currentAttachments,
      });
      const optimistic = store.getState().activeSession?.messages.at(-1);
      if (optimistic?.role === "user") {
        pinnedMessageRef.current = { id: optimistic.id, content: optimistic.content };
        pinMessage(optimistic.id);
      }
      await pending;
    } catch {
      // Handled in store
    }
  };

  /** Enter sends, ⌘/Ctrl+Enter sends, Shift+Enter is a newline. */
  const handleComposerKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key !== "Enter" || e.shiftKey || e.altKey) return;
    e.preventDefault();
    void handleSendMessage();
  };

  const handleComposerChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    applyComposerText(e.target.value);
    adjustTextareaHeight();
  };

  /**
   * Files pasted into the prompt become attachments, as they do on a drop.
   *
   * Read through `clipboardFiles`, which consults `clipboardData.items` before `.files`. This handler
   * used to read `.files` alone, which is what made a pasted screenshot look like nothing happened:
   * HTML derives `files` from the item list, so an image put on the clipboard by a screenshot tool
   * rather than copied from a file arrives as an item of kind `"file"` that `.files` need not expose.
   */
  const handleComposerPaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const pasted = clipboardFiles(e.clipboardData);
    if (pasted.length === 0) return;
    e.preventDefault();
    processFiles(pasted);
  };

  /**
   * Dictation, transcribed by the same endpoint the shared composer uses. The transcript is
   * appended to whatever is already typed rather than replacing it.
   */
  const toggleVoiceRecording = async () => {
    if (voiceStatus !== "idle") {
      recorderRef.current?.stop();
      return;
    }
    setVoiceError(null);
    const recorder = new VoiceRecorder({
      endpoint: TRANSCRIPTION_URL,
      onStatusChange: setVoiceStatus,
      onResult: (transcription: string) => {
        const trimmed = transcription.trim();
        if (!trimmed) {
          setVoiceError("Nothing was transcribed. Please try again.");
          return;
        }
        const previous = composerTextRef.current;
        applyComposerText(previous ? `${previous} ${trimmed}` : trimmed);
        requestComposerFocus();
        requestAnimationFrame(adjustTextareaHeight);
      },
      onError: (message: string) => setVoiceError(message),
    });
    recorderRef.current = recorder;
    await recorder.start();
  };

  /**
   * Drafts the follow-up rather than sending it: the outcomes are the agent's to summarise, but
   * what to ask about them is still the user's call, so the prompt lands in the composer.
   */
  const handleReviewJobs = () => {
    const summary = spawnedJobs
      .map((job) => `- ${job.type} ${job.id}${job.planTitle ? ` (${job.planTitle})` : ""}`)
      .join("\n");
    applyComposerText(
      `Review the outcomes of the jobs this conversation started and tell me what changed:\n${summary}`,
    );
    requestComposerFocus();
  };

  const messages = activeSession?.messages ?? [];

  // The optimistic user message is superseded by the server's copy, which arrives under a
  // different id, so the pin has to follow the content across the swap or it loses its target.
  useEffect(() => {
    const pinned = pinnedMessageRef.current;
    if (!pinned) return;
    if (messages.some((m) => m.id === pinned.id)) return;
    // Prefix, not equality: the daemon's copy of the prompt carries the `[Attached Files]:` block
    // the composer never showed, which is why V1 matches with `startsWith` too.
    const replacement = messages.find(
      (m) => m.role === "user" && m.content.startsWith(pinned.content),
    );
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

  /**
   * The composer's agent pill. `compact` is icon-only, and V1 turns it on for exactly one case —
   * `compact={embedded}` in `ChatWidget.tsx` — because the panel beside a plan has no room for the
   * agent's name beside the mic and the send button.
   */
  const renderAgentPicker = (compact: boolean) => (
    <AgentPicker
      instanceId={compact ? "agent-picker-compact" : "agent-picker"}
      compact={compact}
      agents={agents}
      selectedAgentId={selectedAgentId}
      selectedModelId={selectedModelId}
      selectedEffort={selectedEffort}
      onAgentChange={(agentId) => store.setAgent(agentId)}
      onModelChange={(agentId, modelId) => store.setModelForAgent(agentId, modelId)}
      onEffortChange={(agentId, effort) => store.setEffortForAgent(agentId, effort)}
      rememberedFor={(agentId) => store.getAgentPreference(agentId)}
    />
  );

  const timeOfDayGreeting = useMemo(() => buildGreeting(new Date()), []);
  const greeting = greetingOverride ?? timeOfDayGreeting;
  const chatSamplePrompts = useMemo(() => buildChatSamplePrompts(plans, jobs), [plans, jobs]);
  const samplePrompts = samplePromptsOverride ?? chatSamplePrompts;
  const hasComposerContent = inputPrompt.trim().length > 0 || attachments.length > 0;

  /**
   * The composer's embedded measurements, from `chat-widget.css`'s embedded block: "the composer
   * takes the prototype's tighter measurements (16px icons, 28px buttons)", a 12px radius rather than
   * 16px, the paperclip flush rather than hung at -6px, 6px between the tools rather than 12px, and
   * 0.9 opacity on the two ghost buttons rather than 0.6.
   *
   * The textarea's own metrics are deliberately left alone. V1 also shrinks it to 28px/14px there,
   * but `needsMultipleLines` measures the live element against its own padding and line height, and
   * that measurement is what decides whether the toolbar sits beside the prompt or above it. Four
   * pixels of field height is not worth putting a second set of numbers under that.
   */
  /* The composer's controls are {@link IconButton}s, as V1's are
     (`Ivy-Tendril/src/Ivy.Tendril.Widgets/frontend/src/ChatWidget/ChatWidget.tsx`), so `buttonSize`
     names an IconButton step rather than a Tailwind box: "md" is its 28px square and "lg" its 32px
     one, which is exactly what the two hand-rolled `size-7`/`size-8` targets used to be. The resting
     dim and the hover surface come from `.tui-icon-btn` too, so there is no `ghost` entry left to
     carry — only the embedded composer's tighter corner, which the base radius does not cover. */
  const composerStyle = embedded
    ? {
        box: "rounded-xl",
        buttonSize: "md" as const,
        buttonRadius: "rounded-field",
        icon: "size-4",
        iconSpinnerSize: "md" as const,
        attachOffset: "",
        tools: "gap-1.5",
      }
    : {
        box: "rounded-bubble",
        buttonSize: "lg" as const,
        buttonRadius: "",
        icon: "size-5",
        iconSpinnerSize: "lg" as const,
        attachOffset: "-ml-1.5",
        tools: "gap-3",
      };

  const sessionPendingDeletion = sessions.find((s) => s.id === deletingSessionId);
  const sessionPendingDeletionLabel = sessionPendingDeletion?.title.trim()
    ? `"${sessionPendingDeletion.title}"`
    : "this chat session";

  /**
   * The Chats list goes to the shell sidebar, not into this page: `ChatApp.Build` renders no list of
   * its own, it sends one and returns a `ContentView` that is the conversation. Published on every
   * render, as `ShellSidebarListSignal` documents ("The active app publishes this on every build") -
   * V1 additionally guards the send behind a fingerprint, which is an optimisation over the same
   * contract rather than a different one.
   */
  const sidebarList = useMemo(
    () =>
      embedded
        ? null
        : buildChatSidebarList(
            sessions,
            activeSessionId ?? null,
            (id) => store.sessionRowState(id),
            {
              onNew: () => void handleCreateSession(),
              onSearch: () => {
                setSearchQuery("");
                setIsSearchOpen(true);
              },
              onSelect: (id) => void store.selectSession(id),
              onRename: (id, title) => void store.renameSession(id, title),
              onDelete: (id) => setDeletingSessionId(id),
              onTogglePin: (id) => store.togglePinSession(id),
            },
          ),
    // The row states are read through the store on each build, so a re-render caused by a
    // generating-state event rebuilds the list even though `sessions` is the same array.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sessions, activeSessionId, storeState, embedded],
  );

  usePublishSidebarList(sidebarList);

  /** `ChatSearchDialog`: a case-insensitive match on the chat's display title, capped at fifteen. */
  const searchResults = useMemo(() => {
    const term = searchQuery.trim().toLowerCase();
    return sessions
      .filter((session) => term.length === 0 || displayTitle(session).toLowerCase().includes(term))
      .slice(0, MAX_CHAT_SEARCH_RESULTS);
  }, [sessions, searchQuery]);

  return (
    /* One tooltip Provider for the whole composer, the way V1 registers the chat widget:
       `const ChatWidget = withTooltipScope(ChatWidgetBase)` in
       `Ivy-Tendril/src/Ivy.Tendril.Widgets/frontend/src/index.ts`. Radix arbitrates the hover
       hand-off inside a Provider, so without one shared scope every icon button in the toolbar
       would wait out the full open delay again instead of handing over instantly. Nesting is free:
       a scope inside another one reuses the outer Provider, so the plan panel's embedded chat and
       the standalone page both work. */
    <TooltipScope>
      <div
        className="flex h-full w-full overflow-hidden bg-background text-foreground"
        data-embedded={embedded}
        data-testid={embedded ? "embedded-chat-view" : "chat-view"}
      >
        {/* Main Chat Thread Area. A file may be dropped anywhere in it, not only on the composer. */}
        <main
          className="relative flex flex-1 flex-col overflow-hidden"
          onDragOver={handleDragOver}
          onDragEnter={handleDragEnter}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          {isDraggingOver && (
            <div className="absolute inset-2 z-50 flex items-center justify-center rounded-box border-2 border-dashed border-foreground bg-background/90 backdrop-blur-xs pointer-events-none">
              <div className="flex flex-col items-center gap-2.5 text-center text-foreground">
                <Upload className="size-9 opacity-80" />
                <span className="font-medium">Drop files here to attach to message</span>
              </div>
            </div>
          )}
          {/* Error Banner */}
          {error && (
            <div
              data-testid="chat-error"
              className="flex items-center justify-between border-b border-destructive/40 bg-destructive/10 px-4 py-2 text-xs text-destructive"
            >
              <span>{error}</span>
            </div>
          )}

          {/*
          Header Toolbar. Embedded there is none: `ChatWidget` renders
          `activeSession && headerJobs.length > 0 && <div className="chat-header--embedded"><JobsMenu/></div>`
          in its place, right-aligned with no border, because the page hosting the panel already
          carries the plan's name and its actions. That is also where the new-chat button goes — the
          plan's chat is the plan's, and `PlanChatView` passes `startNewChat: () => { }`.
        */}
          {embedded ? (
            activeSession &&
            spawnedJobs.length > 0 && (
              <div
                data-testid="embedded-chat-jobs"
                className="flex shrink-0 items-center justify-end px-4 pb-2"
              >
                <JobsMenu
                  jobs={spawnedJobs}
                  spawned
                  onOpenPlan={onOpenPlan}
                  onReviewJobs={handleReviewJobs}
                />
              </div>
            )
          ) : (
            <ChatHeader
              key={activeSessionId ?? "none"}
              title={activeSession ? displayTitle(activeSession) : "No Active Chat"}
              editable={Boolean(activeSession)}
              autoScrollEnabled={autoScrollEnabled}
              onToggleAutoScroll={toggleAutoScroll}
              jobs={spawnedJobs}
              onOpenPlan={onOpenPlan}
              onReviewJobs={handleReviewJobs}
              onNewChat={(override) => void handleCreateSession(override)}
              onRename={(next) => {
                if (activeSession) void store.renameSession(activeSession.id, next);
              }}
              onDelete={() => activeSession && setDeletingSessionId(activeSession.id)}
            />
          )}

          {/* Message Thread List */}
          <div className="flex-1 overflow-hidden relative">
            {!activeSession || activeSession.messages.length === 0 ? (
              <ChatEmptyState
                embedded={embedded}
                greeting={greeting}
                headline={headline}
                samplePrompts={samplePrompts}
                applyComposerText={applyComposerText}
                requestComposerFocus={requestComposerFocus}
              />
            ) : (
              <ChatMessageList
                ref={scrollContainerRef}
                /* `.chat-thread` embedded is `padding: 10px var(--tch-embedded-inset) 0` — the rows
                 inset themselves 16px because `.pws-chat` adds no horizontal padding, so the list
                 scrolls at the panel's full width and the scrollbar sits clear of the text. */
                className={embedded ? "h-full px-4" : "h-full"}
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
                            inProgressAnswers={storeState.inProgressAnswers[msg.id]}
                            isSubmittingAnswer={store.isSubmittingAnswer(msg.id)}
                            onOpenPlan={onOpenPlan}
                            onOpenImage={setActiveLightboxImage}
                            wireframeBaseUrl={wireframeBaseUrl}
                            jobs={jobs}
                            threadMessages={messages}
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
                        inProgressAnswers={storeState.inProgressAnswers[msg.id]}
                        isSubmittingAnswer={store.isSubmittingAnswer(msg.id)}
                        onOpenPlan={onOpenPlan}
                        onOpenImage={setActiveLightboxImage}
                        wireframeBaseUrl={wireframeBaseUrl}
                        jobs={jobs}
                        threadMessages={messages}
                      />
                    </div>
                  ))
                )}

                {/* The live turn's own status line, as V1 renders it: muted, in the thread, at the
                  leading edge where the reply will appear. */}
                {isGenerating && (
                  <div className="flex min-h-6 w-full items-center gap-2 text-muted-foreground">
                    <Spinner size="md" />
                    <span>Working...</span>
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
                  className="pointer-events-auto flex cursor-pointer items-center gap-2 rounded-full border border-warning/40 bg-warning/10 px-3.5 py-1.5 text-xs font-medium text-warning shadow-lg backdrop-blur transition-colors hover:bg-warning/20"
                >
                  <HelpCircle className="size-3.5 text-warning" />
                  <span>
                    Jump to pending question{" "}
                    {targetPendingQuestion.direction === "down" ? "↓" : "↑"}
                  </span>
                </button>
              )}

              {!isAtBottom && (
                <button
                  type="button"
                  data-testid="chat-scroll-tail-button"
                  onClick={() => scrollToTail(true)}
                  className="pointer-events-auto flex cursor-pointer items-center gap-2 rounded-full border border-border bg-popover/90 px-3.5 py-1.5 text-xs font-medium text-foreground shadow-lg backdrop-blur transition-colors hover:bg-secondary/60"
                >
                  <ArrowDown className="size-3.5 text-muted-foreground" />
                  {isGenerating ? (
                    <>
                      <span>Scroll to streaming tail</span>
                      <span className="flex size-1.5 animate-pulse rounded-full bg-current" />
                    </>
                  ) : (
                    <span>Scroll to bottom</span>
                  )}
                </button>
              )}
            </div>
          </div>

          {/*
          The composer, as V1 builds it: one rounded surface holding the attachment affordance, the
          prompt, and the agent picker, mic and send button, with the queue that feeds it directly
          above and the whole thing capped to the thread's width.
        */}
          {/* No divider above the composer: its own surface separates it from the thread.
            `.chat-footer` embedded is `padding: 12px var(--tch-embedded-inset) 0` — no bottom
            padding, because `.pws-chat` already ends in `padding: 0 0 14px`. */}
          <div
            data-testid="chat-composer-area"
            className={embedded ? "shrink-0 px-4 pt-3" : "shrink-0 px-3 py-4"}
          >
            <div className="mx-auto flex w-full max-w-3xl flex-col gap-2.5">
              <ChatQueuedMessages queuedItems={queuedItems} store={store} />

              <div
                className={`flex flex-col gap-2 ${composerStyle.box} border bg-muted py-2 pl-3.5 pr-2 transition-colors ${
                  isDraggingOver
                    ? "border-dashed border-foreground"
                    : "border-transparent focus-within:border-input"
                }`}
              >
                {voiceError && (
                  <ErrorBanner
                    data-testid="chat-voice-error"
                    onDismiss={() => setVoiceError(null)}
                    dismissLabel="Dismiss voice input error"
                  >
                    {voiceError}
                  </ErrorBanner>
                )}

                {attachments.length > 0 && (
                  <div
                    data-testid="composer-attachment-chips"
                    className="flex flex-wrap items-center gap-1.5"
                  >
                    {attachments.map((att, index) => (
                      <ComposerAttachment
                        key={`${att.path}-${index}`}
                        attachment={att}
                        isStaging={stagingPaths.includes(att.path)}
                        onRemove={() => handleRemoveAttachment(index)}
                      />
                    ))}
                    {attachments.length > 1 && (
                      <button
                        type="button"
                        onClick={() => setAttachments([])}
                        className="rounded-selector px-1.5 py-0.5 text-xs-tight text-muted-foreground transition-colors hover:text-destructive"
                      >
                        Clear all
                      </button>
                    )}
                  </div>
                )}

                {/* One line: buttons sit beside the text. More than one: the buttons line up as a
                  toolbar above it and the text takes the whole width. */}
                <div
                  ref={inputRowRef}
                  data-multiline={multiline}
                  className={`flex min-h-8 items-end gap-3 ${multiline ? "flex-wrap" : ""}`}
                >
                  <input
                    ref={fileInputRef}
                    type="file"
                    multiple
                    className="hidden"
                    data-testid="file-upload-input"
                    onChange={handleFileInputChange}
                  />
                  <IconButton
                    data-testid="composer-attach-button"
                    label="Attach file"
                    size={composerStyle.buttonSize}
                    onClick={handleAttachClick}
                    className={`${composerStyle.attachOffset} ${composerStyle.buttonRadius} ${
                      multiline ? "order-0" : ""
                    }`}
                  >
                    <Paperclip className={composerStyle.icon} />
                  </IconButton>

                  <ChatInput
                    ref={textareaRef}
                    id="chat-composer"
                    aria-label="Chat prompt"
                    placeholder={COMPOSER_PLACEHOLDER}
                    value={inputPrompt}
                    onChange={handleComposerChange}
                    onKeyDown={handleComposerKeyDown}
                    onPaste={handleComposerPaste}
                    className={multiline ? "order-2 basis-full" : ""}
                  />

                  <div
                    className={`flex shrink-0 items-center ${composerStyle.tools} ${multiline ? "order-1 ml-auto" : ""}`}
                  >
                    {/* `compact={embedded}` in `ChatWidget.tsx`: icon-only beside a plan. */}
                    {renderAgentPicker(embedded)}

                    {/* Idle is the shared resting dim; the other two states pin it fully opaque,
                      recording in the destructive colour. `.tui-icon-btn` sets `opacity` and
                      `color` in `@layer components`, so these utilities win without `!important`. */}
                    <IconButton
                      data-testid="composer-voice-button"
                      label="Voice input"
                      size={composerStyle.buttonSize}
                      onClick={() => void toggleVoiceRecording()}
                      className={`${composerStyle.buttonRadius} ${
                        voiceStatus === "recording"
                          ? "animate-pulse text-destructive opacity-100"
                          : voiceStatus === "idle"
                            ? ""
                            : "opacity-100"
                      }`}
                    >
                      {voiceStatus === "connecting" || voiceStatus === "processing" ? (
                        <Spinner size={composerStyle.iconSpinnerSize} />
                      ) : voiceStatus === "recording" ? (
                        <Square className={composerStyle.icon} />
                      ) : (
                        <Mic className={composerStyle.icon} />
                      )}
                    </IconButton>

                    {isGenerating ? (
                      <>
                        {hasComposerContent && (
                          <IconButton
                            data-testid="composer-queue-button"
                            label="Queue message"
                            size={composerStyle.buttonSize}
                            variant="solid"
                            onClick={() => void handleSendMessage()}
                            className={composerStyle.buttonRadius}
                          >
                            <ListPlus className="size-4" />
                          </IconButton>
                        )}
                        {/* Stopping is a round trip: `cancel_session` signals the cancellation
                          token and the agent process then takes its own time to die, so between
                          the press and the turn ending there is a window in which nothing had
                          changed on screen and people pressed again. The store marks the session
                          cancelling before it awaits anything, and the button spends itself here -
                          spinner, "Stopping agent", disabled - until the turn actually ends. A
                          failed stop puts it back, because then pressing again is the right move.
                          V1 needs none of this: `ChatWidget.handleCancelStream` clears its own
                          `optimisticStreaming` synchronously and the button is gone that tick. */}
                        <IconButton
                          data-testid="composer-stop-button"
                          label={isCancelling ? "Stopping agent" : "Stop agent"}
                          tooltip={isCancelling ? "Stopping agent..." : "Stop agent"}
                          size={composerStyle.buttonSize}
                          variant="outline"
                          disabled={isCancelling}
                          onClick={() => void store.cancelGeneration()}
                          className={composerStyle.buttonRadius}
                        >
                          {isCancelling ? (
                            <Spinner
                              data-testid="composer-stop-spinner"
                              size={composerStyle.iconSpinnerSize}
                            />
                          ) : (
                            <Square className="size-3 fill-current" />
                          )}
                        </IconButton>
                      </>
                    ) : (
                      <IconButton
                        label="Send message"
                        size={composerStyle.buttonSize}
                        variant="solid"
                        disabled={!hasComposerContent}
                        onClick={() => void handleSendMessage()}
                        className={composerStyle.buttonRadius}
                      >
                        <SendHorizontal className="size-4" />
                      </IconButton>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>

          <ImageLightbox image={activeLightboxImage} onClose={() => setActiveLightboxImage(null)} />

          {/* The app's confirmation contract, rather than a bare `AlertDialog`: `AlertDialogAction`
            renders the *primary* treatment, so deleting a chat looked like the safe choice, and a
            rejected delete had nowhere to report itself. `ConfirmDialog` carries the destructive
            variant, the inline error surface, and the Escape/outside-click rules from `DialogShell`. */}
          <ConfirmDialog
            isOpen={deletingSessionId !== null}
            onClose={() => {
              setDeletingSessionId(null);
              setDeleteSessionError(null);
            }}
            title="Delete Session"
            body={`Are you sure you want to delete ${sessionPendingDeletionLabel}? This action cannot be undone.`}
            confirmLabel="Delete"
            confirmVariant="destructive"
            onConfirm={() => void confirmDeleteSession()}
            isBusy={isDeletingSession}
            error={deleteSessionError}
            testId="chat-delete-session-dialog"
          />

          {/* `Apps/Chat/Dialogs/ChatSearchDialog`: search over chat titles, opened from the Chats
            section's search icon, and picking a row selects that chat. It belongs to the chat app,
            not the shell - the shell's own search icon opens the *plan* search dialog, which is why
            the published list carries its own `onSearch`.

            Embedded there is no published list, so nothing can open this; it is also the wrong
            offer, since the panel follows the plan's session and cannot be pointed at another. */}
          {!embedded && (
            <ChatSearchDialog
              isSearchOpen={isSearchOpen}
              setIsSearchOpen={setIsSearchOpen}
              searchQuery={searchQuery}
              setSearchQuery={setSearchQuery}
              searchResults={searchResults}
              store={store}
            />
          )}
        </main>
      </div>
    </TooltipScope>
  );
};
