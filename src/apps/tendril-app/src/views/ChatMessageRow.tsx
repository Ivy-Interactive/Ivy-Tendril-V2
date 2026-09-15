import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ChatBubble,
  ChatBubbleMessage,
  ChatBubbleAction,
  ChatBubbleActionWrapper,
} from "@ivy-interactive/components/renderers";
import { PlanMarkdown } from "@ivy-interactive/components/tendril";
import { convertFileSrc } from "@tauri-apps/api/core";
import { CheckCheck, Copy, FilePlus, Loader2, Paperclip, Sparkles, XCircle } from "lucide-react";
import { chatStore } from "../state/chatStore";
import type { ChatAttachment, ChatMessage, InProgressQuestionAnswers } from "../types/chat";
import type { Job } from "../types/api";
import { isWriteInAnswer, patchQuestionsMarkdown } from "../utils/questionMarkdown";
import { formatSystemEvent } from "../utils/systemEvents";
import { resolveJobState, type JobDisplayState } from "../utils/jobStatus";
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
  /**
   * The conversation's jobs and transcript, used to resolve what a "job started" event turned
   * into: the row's icon reports the outcome rather than freezing on "started".
   */
  jobs?: Job[];
  threadMessages?: ChatMessage[];
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

/**
 * The event's icon colour. A resolved job outcome outranks the event's own kind, so a "started"
 * note whose job has since finished reads green (or red) rather than staying muted; a plain
 * completion inherits the body colour, as it is not a status in its own right.
 */
const systemEventIconTone = (kind: string, jobState: JobDisplayState): string => {
  if (jobState === "completed") return "text-success";
  if (jobState === "failed") return "text-destructive";
  if (kind === "failed") return "text-destructive";
  if (kind === "started" || kind === "info") return "text-muted-foreground";
  return "";
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
  jobs = [],
  threadMessages = [],
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

  const jobState = useMemo(
    () => (systemEvent ? resolveJobState(systemEvent.jobId, jobs, threadMessages) : "unknown"),
    [systemEvent, jobs, threadMessages],
  );

  // A system event is a one-line timeline note, not a turn in the conversation: it sits at the
  // leading edge of the thread as a sentence with a status icon, with no bubble and no
  // copy/create-plan actions, and the instructions the backend addressed to the agent are dropped.
  if (systemEvent) {
    const tone = systemEventIconTone(systemEvent.kind, jobState);
    const icon =
      systemEvent.kind === "started" ? (
        jobState === "completed" ? (
          <CheckCheck className={`size-4 shrink-0 ${tone}`} aria-hidden="true" />
        ) : jobState === "failed" ? (
          <XCircle className={`size-4 shrink-0 ${tone}`} aria-hidden="true" />
        ) : jobState === "running" ? (
          <Loader2 className={`size-4 shrink-0 animate-spin ${tone}`} aria-hidden="true" />
        ) : (
          <span
            className="mt-1.5 inline-block size-1.5 shrink-0 rounded-full bg-muted-foreground"
            aria-hidden="true"
          />
        )
      ) : systemEvent.kind === "completed" ? (
        <CheckCheck className={`size-4 shrink-0 ${tone}`} aria-hidden="true" />
      ) : systemEvent.kind === "failed" ? (
        <XCircle className={`size-4 shrink-0 ${tone}`} aria-hidden="true" />
      ) : (
        <Sparkles className={`size-4 shrink-0 ${tone}`} aria-hidden="true" />
      );

    return (
      <div
        data-message-id={message.id}
        data-testid="chat-system-event"
        data-kind={systemEvent.kind}
        data-job-state={jobState}
        title={message.timestamp}
        className="flex w-full items-start gap-1.5 text-foreground"
      >
        {icon}
        <span className="min-w-0 leading-tight wrap-anywhere">
          {systemEvent.text}
          {systemEvent.plan && (
            <>
              {" "}
              {onOpenPlan ? (
                <button
                  type="button"
                  data-testid="chat-system-event-plan"
                  onClick={() => onOpenPlan(systemEvent.plan!.id)}
                  title="Open plan"
                  className="cursor-pointer border-0 bg-transparent p-0 text-inherit underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {systemEvent.plan.label}
                </button>
              ) : (
                <span className="underline">{systemEvent.plan.label}</span>
              )}
            </>
          )}
          {systemEvent.plan || systemEvent.kind !== "info" ? "." : ""}
          {systemEvent.detail && (
            <span className="mt-0.5 block text-xs text-muted-foreground" title={systemEvent.detail}>
              {systemEvent.detail}
            </span>
          )}
        </span>
      </div>
    );
  }

  return (
    <ChatBubble variant={isUser ? "sent" : "received"} layout={isUser ? "default" : "ai"}>
      <div
        data-message-id={message.id}
        className={`flex min-w-0 flex-col ${isUser ? "max-w-[80%] items-end" : "w-full"}`}
      >
        <ChatBubbleMessage
          variant={isUser ? "sent" : "received"}
          className={isUser ? "max-w-full" : undefined}
          title={isUser ? message.timestamp : undefined}
        >
          {isUser ? (
            <div className="self-stretch whitespace-pre-wrap">{message.content}</div>
          ) : (
            <div>
              <PlanMarkdown
                id={`chat-msg-${message.id}`}
                content={content}
                events={["OnAnswersChange"]}
                eventHandler={handleAnswersChange}
              />
              {isSubmitting && (
                <div
                  data-testid="submitting-answer-indicator"
                  className="mt-2 flex min-h-6 items-center gap-1.5 text-xs text-muted-foreground"
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
              className={`flex max-w-full flex-wrap gap-1.5 ${
                isUser ? "justify-end" : "mt-2 justify-start"
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
                    className={`overflow-hidden rounded-md transition-[filter] hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 ${
                      isUser ? "focus-visible:ring-primary-foreground" : "focus-visible:ring-ring"
                    }`}
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
                    className={`flex max-w-full items-center gap-1.5 rounded-md px-1.5 py-1 ${
                      isUser
                        ? "bg-primary-foreground/20 text-primary-foreground"
                        : "bg-muted text-muted-foreground"
                    }`}
                    title={att.path}
                  >
                    <Paperclip className="size-4 shrink-0 opacity-85" />
                    <span className="max-w-[220px] truncate">{att.name}</span>
                  </div>
                ),
              )}
            </div>
          )}
        </ChatBubbleMessage>

        {/* The row's meta line. V1 shows the finished turn's metrics here; V2 has no per-turn
            metrics yet, so the slot carries the two actions the desktop app adds. */}
        <ChatBubbleActionWrapper className={isUser ? "justify-end" : "justify-start"}>
          <ChatBubbleAction
            icon={<Copy className="size-3.5" />}
            title="Copy message"
            onClick={() => onCopy(message)}
            className={isCopied ? "text-foreground" : "text-muted-foreground"}
          />
          <button
            type="button"
            onClick={() => onCreatePlan(message.content)}
            className="inline-flex items-center gap-1.5 whitespace-nowrap rounded px-1 py-0.5 text-muted-foreground transition-colors hover:text-foreground"
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
