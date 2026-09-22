import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ChatBubble, ChatBubbleMessage } from "@ivy-interactive/components/renderers";
import {
  PlanMarkdown,
  QuestionsDraftContext,
  QuestionsSubmitContext,
} from "@ivy-interactive/components/tendril";
import { Spinner } from "@ivy-interactive/components/ui";
import { CheckCheck, Paperclip, Sparkles, XCircle } from "lucide-react";
import {
  isImageAttachment,
  resetAttachmentPreviewsForTesting,
  useAttachmentPreview,
} from "../hooks/useAttachmentPreview";
import { chatStore } from "../state/chatStore";
import type { ChatAttachment, ChatMessage, InProgressQuestionAnswers } from "../types/chat";
import type { Job } from "../types/api";
import { patchQuestionsMarkdown } from "../utils/questionMarkdown";
import { formatSystemEvent } from "../utils/systemEvents";
import { resolveJobState, type JobDisplayState } from "../utils/jobStatus";
import type { LightboxImage } from "../components/chat/ImageLightbox";
import { TurnActivity, buildTurnSegments, parseTurnStream } from "../components/chat/TurnActivity";

export interface ChatMessageRowProps {
  message: ChatMessage;
  inProgressAnswers?: InProgressQuestionAnswers;
  isSubmittingAnswer?: boolean;
  /** Opens the plan a system event refers to. */
  onOpenPlan?: (planId: string) => void;
  /**
   * Where this conversation's plan serves its wireframes. Set for the chat beside a plan; undefined
   * on the general chat page, where a `wireframe` fence has no plan to resolve a name against and
   * renders a placeholder instead.
   */
  wireframeBaseUrl?: string;
  /** Opens an image attachment in the lightbox. */
  onOpenImage?: (image: LightboxImage) => void;
  /**
   * The conversation's jobs and transcript, used to resolve what a "job started" event turned
   * into: the row's icon reports the outcome rather than freezing on "started".
   */
  jobs?: Job[];
  threadMessages?: ChatMessage[];
}

/**
 * Re-exported because the preview machinery moved to `hooks/useAttachmentPreview` when the composer
 * came to need it too; the thread's own callers still reach it through this module.
 */
export { isImageAttachment, resetAttachmentPreviewsForTesting };

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
  wireframeBaseUrl,
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

  /**
   * A block's answers, applied in one go and followed by the summary as the next user turn. This
   * is V1's `OnAnswerQuestion`, and the reason chat has no live answer callback: `ChatWidget`
   * supplies only `QuestionsSubmitContext`, so `QuestionsCallout` takes its `!onAnswer && onSubmit`
   * branch and drafts locally until Submit. Reporting every keystroke instead means a round trip
   * per character, which is what the debounce this replaced existed to paper over.
   */
  const handleQuestionSubmit = useCallback(
    (answers: Record<string, string[]>, summaryText: string) => {
      void chatStore.submitAnswers(message.id, answers, summaryText);
    },
    [message.id],
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

  /**
   * One markdown segment. `body` keeps the bare `chat-msg-<id>` the single-body turn has always
   * used; an interleaved turn suffixes its stream key, so each segment is its own renderer instance
   * with its own stable identity across appends.
   */
  const renderMarkdown = useCallback(
    (segment: string, key: string) => (
      <PlanMarkdown
        id={key === "body" ? `chat-msg-${message.id}` : `chat-msg-${message.id}-${key}`}
        content={segment}
        wireframeBaseUrl={wireframeBaseUrl}
        flow
      />
    ),
    [message.id, wireframeBaseUrl],
  );

  /* One parse per stream, shared by the body's segments and anything else that reads the turn's
     events. A turn appends a line per event and re-parses its whole stream each time, so parsing
     once here rather than in each consumer keeps that cost to a single pass. Keyed on `rawStream`
     alone, so an arriving `content` delta re-reconciles without re-parsing. */
  const parsedTurn = useMemo(
    () => (isUser ? null : parseTurnStream(currentMessage.rawStream)),
    [isUser, currentMessage.rawStream],
  );
  const turnSegments = useMemo(() => buildTurnSegments(parsedTurn, content), [parsedTurn, content]);

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
          <Spinner size="md" className={`shrink-0 ${tone}`} aria-hidden="true" />
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
              {/* `flow` drops the plan *page* off the renderer. V1 renders `BlockMarkdown` here
                  (react-markdown, no shell) inside a plain `.chat-markdown-body`; only V1's plan
                  tab gets `PlanMarkdown`'s `Cap()`, gutter and own scroll. Sharing one component
                  between the two surfaces means the thread inherits all three unless it says
                  otherwise - a 1.5rem inset on every turn, a second width cap inside the column's
                  own, and a scroller nested in the thread's. A code block is where that reads as
                  broken, being bordered, full-bleed and the widest thing in a turn. */}
              {/* Draft outside, submit inside, as `ChatWidget` nests them. No `events` and no
                  `eventHandler`: `PlanMarkdown` passes `undefined` as its answer callback unless
                  it sees `OnAnswersChange`, and that `undefined` alongside a submit callback is
                  exactly what selects the batched chat block. The plan surface keeps the live
                  path — see `PlanDetailView`. */}
              <QuestionsDraftContext.Provider value={chatStore.questionDraftStore(message.id)}>
                <QuestionsSubmitContext.Provider value={handleQuestionSubmit}>
                  <TurnActivity segments={turnSegments} renderText={renderMarkdown} />
                  {turnSegments.length === 0 && renderMarkdown(content, "body")}
                </QuestionsSubmitContext.Provider>
              </QuestionsDraftContext.Provider>
              {isSubmitting && (
                <div
                  data-testid="submitting-answer-indicator"
                  className="mt-2 flex min-h-6 items-center gap-1.5 text-xs text-muted-foreground"
                >
                  <Spinner size="sm" />
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
