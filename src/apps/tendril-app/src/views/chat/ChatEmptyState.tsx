import React from "react";
import type { SamplePrompt } from "./samplePrompts";

/**
 * V1's empty thread, `ContentView`'s greeting/headline/prompts block. Rendered once, by the
 * conversation, and holding no state of its own.
 */
export const ChatEmptyState: React.FC<{
  embedded: boolean;
  greeting: string;
  headline: string;
  samplePrompts: SamplePrompt[];
  applyComposerText: (text: string) => void;
  requestComposerFocus: () => void;
}> = ({ embedded, greeting, headline, samplePrompts, applyComposerText, requestComposerFocus }) => (
  /* V1's empty thread: the greeting, the headline, and the prompts it suggests. No
               explanation of what a chat is - the composer below says that.

               `chat-widget.css`'s embedded block gives the same markup the panel's measurements:
               20px/26px instead of 24px, `gap: 0` instead of 4px, `padding: 32px 16px` instead of
               48px, the greeting truncated to one line (it is the plan's title, which is long), and
               the chips flush left in a horizontal scroller rather than centred and wrapped -
               "centering an overflowing nowrap scroller would push leading chips past the scroll
               origin". */
  <div
    /* `max-w-3xl mx-auto` is `.chat-thread`'s `max-width: var(--tch-thread-width)`
                 (775px) with `margin: 0 auto`, which is the element V1's empty state sits inside -
                 and it is the same cap `ChatMessageList` and the composer below already apply, so
                 the chips line up with the thread they are about to start. Without it the row had
                 the whole window to spread across, which is why five chips never wrapped.
                 Embedded there is no cap: `.chat-widget-root[data-embedded="true"]
                 .chat-empty-state` is `width: 100%`, because the plan panel is already the
                 constraint. */
    className={`flex h-full flex-col items-center justify-center px-4 text-center ${
      embedded ? "w-full gap-0 py-8" : "mx-auto w-full max-w-3xl gap-1 py-12"
    }`}
  >
    <div
      className={
        embedded
          ? "w-full truncate text-xl font-light leading-relaxed text-muted-foreground"
          : "text-2xl font-normal leading-tight text-muted-foreground"
      }
      title={embedded ? greeting : undefined}
    >
      {greeting}
    </div>
    <div
      className={
        embedded
          ? "text-xl font-medium leading-relaxed text-foreground"
          : "text-2xl font-semibold leading-tight text-foreground"
      }
    >
      {headline}
    </div>
    {/* `.chat-sample-prompts`: `flex-wrap: wrap` + `justify-content: center`. V1 counts
                  nothing - the "3 above, 2 beneath" the report describes is just what greedy flex
                  wrapping does once the row has a width to wrap at, which the cap above now
                  supplies: the chips that fit take the first line and the remainder centre
                  underneath, so the top row is the longer one. Every other count falls out of the
                  same rule, which is why V1 needs no special case for five.

                  `w-full` is load-bearing: as a shrink-to-fit flex item the row would size to its
                  content and wrap against the window rather than the cap.

                  Embedded, V1 switches to `flex-wrap: nowrap` + `overflow-x: auto`, but we keep
                  wrapping - the panel is only as wide as the plan page leaves it, so a nowrap row
                  put the later chips off the edge with no room for a scrollbar to reach them. */}
    <div
      className={`mt-4 flex w-full flex-wrap gap-2 ${
        embedded ? "justify-start" : "justify-center"
      }`}
      data-testid="sample-prompts"
    >
      {samplePrompts.map((item) => (
        <button
          key={item.label}
          type="button"
          title={item.prompt}
          onClick={() => {
            applyComposerText(item.prompt);
            requestComposerFocus();
          }}
          className="max-w-full rounded-bubble border border-border bg-background px-4 py-2 text-left font-medium text-foreground transition-colors hover:border-muted-foreground hover:bg-secondary/60"
        >
          {item.label}
        </button>
      ))}
    </div>
  </div>
);
