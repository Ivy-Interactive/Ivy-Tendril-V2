import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChatBubble, ChatBubbleMessage } from "@ivy-interactive/components/renderers";
import { PlanMarkdown } from "@ivy-interactive/components/tendril";
import { CheckCheck, Loader2, Paperclip, Sparkles, XCircle } from "lucide-react";
import { bridge } from "../api/bridge";
import { chatStore } from "../state/chatStore";
import type { ChatAttachment, ChatMessage, InProgressQuestionAnswers } from "../types/chat";
import type { Job } from "../types/api";
import { isWriteInAnswer, patchQuestionsMarkdown } from "../utils/questionMarkdown";
import { formatSystemEvent } from "../utils/systemEvents";
import { resolveJobState, type JobDisplayState } from "../utils/jobStatus";
import type { LightboxImage } from "../components/chat/ImageLightbox";
import { TurnActivity } from "../components/chat/TurnActivity";

export interface ChatMessageRowProps {
  message: ChatMessage;
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

const ATTACHED_FILES_HEADING = "[Attached Files]:";

/**
 * Splits the `[Attached Files]:` block back out of a user message. The prompt that reaches the
 * agent carries the attachment paths appended under that heading (`ChatExecutionService`'s
 * `promptWithAttachments`), and the daemon does not persist attachments as structured data, so a
 * prompt re-read from disk would otherwise show its paths as prose. V1's `parseUserMessageContent`
 * does the same split for the same reason.
 */
export function parseUserMessageContent(content: string): {
  prompt: string;
  attachments: ChatAttachment[];
} {
  const index = content.indexOf(ATTACHED_FILES_HEADING);
  if (index < 0) return { prompt: content, attachments: [] };
  const prompt = content.slice(0, index).trimEnd();
  const attachments = content
    .slice(index + ATTACHED_FILES_HEADING.length)
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("- "))
    .map((line) => line.slice(2).trim())
    .filter((path) => path.length > 0)
    .map((path) => ({ name: path.split(/[/\\]/).pop() || path, path }));
  return { prompt, attachments };
}

/** An attachment worth showing as a thumbnail rather than as a paperclip chip. */
export const isImageAttachment = (attachment: ChatAttachment): boolean =>
  attachment.mimeType?.startsWith("image/") === true || IMAGE_EXTENSIONS.test(attachment.path);

/**
 * Previews already resolved, keyed by path, so a thumbnail survives the re-render a streaming turn
 * causes and two rows showing the same file read it once.
 *
 * A rejection is remembered as well: the daemon's answer for a given path — outside the local-file
 * roots, or not an allow-listed image — does not change while the app is running, and retrying it on
 * every re-render would be a request per frame for a file that is never coming.
 */
const previewCache = new Map<string, Promise<string>>();

const loadPreview = (path: string): Promise<string> => {
  const cached = previewCache.get(path);
  if (cached) return cached;
  const pending = bridge.getLocalFilePreview(path);
  previewCache.set(path, pending);
  return pending;
};

/** Forgets the resolved previews. Tests use it so one case's stub cannot answer the next one's. */
export function resetAttachmentPreviewsForTesting(): void {
  previewCache.clear();
}

/**
 * The `data:` URL for an image attachment, or `failed` when the daemon will not serve it.
 *
 * The webview cannot load a bare filesystem path — `file://` is blocked from the app's own origin — so
 * the bytes come from the daemon's guarded `GET /ivy/local-file`, which is the endpoint V1 points its
 * attachment `<img>` tags at. It is fetched natively rather than linked because that route takes its
 * credential in the query string and the app's only credential is the bearer secret the webview never
 * holds; see `src-tauri/src/commands/local_file.rs`.
 */
function useAttachmentPreview(
  path: string,
  enabled: boolean,
): { url: string | null; failed: boolean } {
  const [state, setState] = useState<{ url: string | null; failed: boolean }>({
    url: null,
    failed: false,
  });

  useEffect(() => {
    if (!enabled) return;
    let active = true;
    setState({ url: null, failed: false });
    loadPreview(path).then(
      (url) => {
        if (active) setState({ url, failed: false });
      },
      () => {
        if (active) setState({ url: null, failed: true });
      },
    );
    return () => {
      active = false;
    };
  }, [path, enabled]);

  return state;
}

/** The paperclip form: a document, or an image the daemon would not serve. */
const AttachmentChip: React.FC<{ attachment: ChatAttachment; isUser: boolean }> = ({
  attachment,
  isUser,
}) => (
  <div
    className={`flex max-w-full items-center gap-1.5 rounded-selector px-1.5 py-1 ${
      isUser ? "bg-primary-foreground/20 text-primary-foreground" : "bg-muted text-muted-foreground"
    }`}
    title={attachment.path}
  >
    <Paperclip className="size-4 shrink-0 opacity-85" />
    <span className="max-w-[220px] truncate">{attachment.name}</span>
  </div>
);

/**
 * One attachment inside a bubble: a thumbnail that opens the lightbox for an image the daemon serves,
 * a chip for everything else.
 *
 * A refused image falls back to the chip rather than to a broken-image icon — the file is still part of
 * the message, and the daemon deliberately does not say whether it was outside the allowed roots or
 * simply gone, so there is nothing more honest to show.
 */
const MessageAttachment: React.FC<{
  attachment: ChatAttachment;
  isUser: boolean;
  onOpenImage?: (image: LightboxImage) => void;
}> = ({ attachment, isUser, onOpenImage }) => {
  const isImage = Boolean(onOpenImage) && isImageAttachment(attachment);
  const { url, failed } = useAttachmentPreview(attachment.path, isImage);

  if (!isImage || failed) {
    return <AttachmentChip attachment={attachment} isUser={isUser} />;
  }

  if (!url) {
    return (
      <div
        data-testid="attachment-thumbnail-pending"
        className="size-16 animate-pulse rounded-selector bg-muted"
        title={attachment.name}
      />
    );
  }

  return (
    <button
      type="button"
      data-testid="attachment-thumbnail"
      onClick={() => onOpenImage?.({ url, title: attachment.name })}
      title={`Open ${attachment.name}`}
      aria-label={`Open ${attachment.name}`}
      className={`overflow-hidden rounded-selector transition-[filter] hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 ${
        isUser ? "focus-visible:ring-primary-foreground" : "focus-visible:ring-ring"
      }`}
    >
      <img src={url} alt={attachment.name} className="size-16 object-cover" loading="lazy" />
    </button>
  );
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
  const userContent = useMemo(
    () => (isUser ? parseUserMessageContent(currentMessage.content) : null),
    [isUser, currentMessage.content],
  );
  const content = useMemo(() => {
    if (isUser) return userContent?.prompt ?? currentMessage.content;
    if (!inProgressAnswers) return currentMessage.content;
    return patchQuestionsMarkdown(currentMessage.content, inProgressAnswers);
  }, [isUser, userContent, currentMessage.content, inProgressAnswers]);
  const attachments =
    message.attachments && message.attachments.length > 0
      ? message.attachments
      : (userContent?.attachments ?? []);

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
            <div className="self-stretch whitespace-pre-wrap">{content}</div>
          ) : (
            <div>
              {/* What the turn did, ahead of what it said, as `AssistantTurn` orders it. */}
              <TurnActivity rawStream={currentMessage.rawStream} />
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

          {attachments.length > 0 && (
            <div
              data-testid="message-attachments"
              className={`flex max-w-full flex-wrap gap-1.5 ${
                isUser ? "justify-end" : "mt-2 justify-start"
              }`}
            >
              {attachments.map((att, idx) => (
                <MessageAttachment
                  key={`${att.path}-${idx}`}
                  attachment={att}
                  isUser={isUser}
                  onOpenImage={onOpenImage}
                />
              ))}
            </div>
          )}
        </ChatBubbleMessage>
      </div>
    </ChatBubble>
  );
});

export default ChatMessageRow;
