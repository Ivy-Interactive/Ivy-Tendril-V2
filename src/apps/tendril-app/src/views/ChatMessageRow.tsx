import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ChatBubble,
  ChatBubbleMessage,
  ChatBubbleAction,
  ChatBubbleActionWrapper,
} from "@ivy-interactive/components/renderers";
import { PlanMarkdown } from "@ivy-interactive/components/tendril";
import { convertFileSrc } from "@tauri-apps/api/core";
import {
  CheckCircle2,
  Copy,
  FilePlus,
  Info,
  Loader2,
  Paperclip,
  PlayCircle,
  XCircle,
} from "lucide-react";
import { chatStore } from "../state/chatStore";
import type { ChatAttachment, ChatMessage, InProgressQuestionAnswers } from "../types/chat";
import { isWriteInAnswer, patchQuestionsMarkdown } from "../utils/questionMarkdown";
import { formatSystemEvent, type SystemEventKind } from "../utils/systemEvents";
import type { LightboxImage } from "../components/chat/ImageLightbox";

export interface ChatMessageRowProps {
  message: ChatMessage;
  isCopied: boolean;
  onCopy: (message: ChatMessage) => void;
  onCreatePlan: (content: string) => void;
  inProgressAnswers?: InProgressQuestionAnswers;
  isSubmittingAnswer?: boolean;
  /** Opens the plan a system event refers to. */
  onOpenPlan?: (planId: string) => void;
  /** Opens an image attachment in the lightbox. */
  onOpenImage?: (image: LightboxImage) => void;
}

const IMAGE_EXTENSIONS = /\.(png|jpe?g|gif|webp|svg)$/i;

/** An attachment worth showing as a thumbnail rather than as a paperclip chip. */
export const isImageAttachment = (attachment: ChatAttachment): boolean =>
  attachment.mimeType?.startsWith("image/") === true || IMAGE_EXTENSIONS.test(attachment.path);

/** The webview cannot load a bare filesystem path; Tauri's asset protocol can. */
const imageSrc = (path: string): string => {
  try {
    return convertFileSrc(path);
  } catch {
    return path;
  }
};

const SYSTEM_EVENT_ICONS: Record<SystemEventKind, React.ReactNode> = {
  completed: <CheckCircle2 className="size-3.5 text-emerald-400" aria-hidden="true" />,
  failed: <XCircle className="size-3.5 text-rose-400" aria-hidden="true" />,
  started: <PlayCircle className="size-3.5 text-sky-400" aria-hidden="true" />,
  info: <Info className="size-3.5 text-slate-400" aria-hidden="true" />,
};

export const ChatMessageRow: React.FC<ChatMessageRowProps> = React.memo(function ChatMessageRow({
  message,
  isCopied,
  onCopy,
  onCreatePlan,
  inProgressAnswers: propInProgressAnswers,
  isSubmittingAnswer: propIsSubmittingAnswer,
  onOpenPlan,
  onOpenImage,
}) {
  const isUser = message.role === "user";
  const isSystem = message.role === "system";

  const [, setTick] = useState(0);
  useEffect(() => {
    // If not controlled by parent props, subscribe to chatStore for this message
    if (propInProgressAnswers === undefined || propIsSubmittingAnswer === undefined) {
      return chatStore.subscribe(() => {
        setTick((t) => t + 1);
      });
    }
  }, [propInProgressAnswers, propIsSubmittingAnswer, message.id]);

  const pendingDebounceTimersRef = useRef<
    Map<string, { timer: ReturnType<typeof setTimeout>; commit: () => void }>
  >(new Map());

  // Flush all pending debounced commits immediately before unmounting so typed text is never lost
  useEffect(() => {
    return () => {
      const pending = Array.from(pendingDebounceTimersRef.current.values());
      pendingDebounceTimersRef.current.clear();
      for (const { timer, commit } of pending) {
        clearTimeout(timer);
        commit();
      }
    };
  }, []);

  const handleAnswersChange = useCallback(
    (eventName: string, _widgetId: string, args: unknown[]) => {
      if (eventName !== "OnAnswersChange") return;
      const payload = args[0] as
        | Array<{ questionId: string; answer: string[] | null }>
        | { questionId: string; answer: string[] | null };
      const items = Array.isArray(payload) ? payload : [payload];
      for (const item of items) {
        const hasPending = pendingDebounceTimersRef.current.has(item.questionId);
        const writeIn = isWriteInAnswer(message.content, item.questionId, item.answer, hasPending);

        if (writeIn) {
          const existing = pendingDebounceTimersRef.current.get(item.questionId);
          if (existing) {
            clearTimeout(existing.timer);
          }

          const commit = () => {
            pendingDebounceTimersRef.current.delete(item.questionId);
            chatStore.setInProgressAnswer(message.id, item.questionId, item.answer);
            void chatStore.submitAnswer(message.id, item.questionId, item.answer);
          };

          const timer = setTimeout(commit, 300);
          pendingDebounceTimersRef.current.set(item.questionId, { timer, commit });
        } else {
          const existing = pendingDebounceTimersRef.current.get(item.questionId);
          if (existing) {
            clearTimeout(existing.timer);
            pendingDebounceTimersRef.current.delete(item.questionId);
          }
          chatStore.setInProgressAnswer(message.id, item.questionId, item.answer);
          void chatStore.submitAnswer(message.id, item.questionId, item.answer);
        }
      }
    },
    [message.id, message.content],
  );

  const currentMessage =
    chatStore.getState().activeSession?.messages.find((m) => m.id === message.id) ?? message;
  const inProgressAnswers = isUser
    ? undefined
    : (propInProgressAnswers ?? chatStore.getInProgressAnswers(message.id));
  const isSubmitting = isUser
    ? false
    : (propIsSubmittingAnswer ?? chatStore.isSubmittingAnswer(message.id));
  const content = useMemo(() => {
    if (isUser || !inProgressAnswers) return currentMessage.content;
    return patchQuestionsMarkdown(currentMessage.content, inProgressAnswers);
  }, [isUser, currentMessage.content, inProgressAnswers]);

  const systemEvent = useMemo(
    () => (isSystem ? formatSystemEvent(currentMessage.content) : null),
    [isSystem, currentMessage.content],
  );

  // A system event is a one-line timeline note, not a turn in the conversation: no bubble, no
  // copy/create-plan actions, and the instructions the backend addressed to the agent are dropped.
  if (systemEvent) {
    return (
      <div
        data-message-id={message.id}
        data-testid="chat-system-event"
        data-kind={systemEvent.kind}
        className="flex justify-center px-4 py-1.5"
      >
        <div className="flex max-w-3xl flex-wrap items-center gap-1.5 rounded-full border border-slate-800 bg-slate-900/70 px-3 py-1 text-xs text-slate-300">
          {SYSTEM_EVENT_ICONS[systemEvent.kind]}
          <span>{systemEvent.text}</span>
          {systemEvent.plan &&
            (onOpenPlan ? (
              <button
                type="button"
                data-testid="chat-system-event-plan"
                onClick={() => onOpenPlan(systemEvent.plan!.id)}
                title="Open plan"
                className="rounded px-1 font-medium text-emerald-400 underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
              >
                {systemEvent.plan.label}
              </button>
            ) : (
              <span className="font-medium text-slate-200">{systemEvent.plan.label}</span>
            ))}
          {systemEvent.detail && (
            <span className="text-slate-500" title={systemEvent.detail}>
              — {systemEvent.detail}
            </span>
          )}
        </div>
      </div>
    );
  }

  return (
    <ChatBubble variant={isUser ? "sent" : "received"} layout={isUser ? "default" : "ai"}>
      <div data-message-id={message.id} className="flex flex-col max-w-3xl">
        <ChatBubbleMessage
          variant={isUser ? "sent" : "received"}
          className={
            isUser
              ? "bg-emerald-600 text-white"
              : "bg-slate-900 border border-slate-800 text-slate-100"
          }
        >
          {isUser ? (
            <div className="whitespace-pre-wrap text-sm leading-relaxed">{message.content}</div>
          ) : (
            <div className="text-sm">
              <PlanMarkdown
                id={`chat-msg-${message.id}`}
                content={content}
                events={["OnAnswersChange"]}
                eventHandler={handleAnswersChange}
              />
              {isSubmitting && (
                <div
                  data-testid="submitting-answer-indicator"
                  className="flex items-center gap-1.5 text-xs text-emerald-400 mt-2 font-medium"
                >
                  <Loader2 className="size-3.5 animate-spin" />
                  <span>Submitting answer...</span>
                </div>
              )}
            </div>
          )}

          {message.attachments && message.attachments.length > 0 && (
            <div
              data-testid="message-attachments"
              className={`mt-2 flex flex-wrap gap-1.5 pt-1.5 border-t ${
                isUser ? "border-emerald-500/40" : "border-slate-800"
              }`}
            >
              {message.attachments.map((att, idx) =>
                onOpenImage && isImageAttachment(att) ? (
                  <button
                    key={`${att.path}-${idx}`}
                    type="button"
                    data-testid="attachment-thumbnail"
                    onClick={() => onOpenImage({ url: imageSrc(att.path), title: att.name })}
                    title={`Open ${att.name}`}
                    aria-label={`Open ${att.name}`}
                    className="overflow-hidden rounded border border-slate-700 hover:border-emerald-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
                  >
                    <img
                      src={imageSrc(att.path)}
                      alt={att.name}
                      className="size-16 object-cover"
                      loading="lazy"
                    />
                  </button>
                ) : (
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
                ),
              )}
            </div>
          )}
        </ChatBubbleMessage>

        {/* Action bar on message */}
        <ChatBubbleActionWrapper className={isUser ? "justify-end" : "justify-start"}>
          <ChatBubbleAction
            icon={<Copy className="size-3.5" />}
            onClick={() => onCopy(message)}
            className={isCopied ? "text-emerald-400" : "text-slate-400"}
          />
          <button
            type="button"
            onClick={() => onCreatePlan(message.content)}
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
});

export default ChatMessageRow;
