import * as React from "react";
import { Terminal, WebViewer, type TerminalHandle } from "@ivy-interactive/components/tendril";
import { bridge, type ReviewActionRun } from "../api/bridge";
import { applyCommentEvent, formatChangeRequest, type AppComment } from "../utils/appComments";
import { detectAppUrl } from "../utils/detectAppUrl";
import {
  describeBridgeError,
  type PlanDetail,
  type PlanSummary,
  type StartJobResponse,
} from "../types/api";
import { SuggestChangesDialog } from "./dialogs/SuggestChangesDialog";

/** Which review action is being run, and on whose behalf. */
export interface ReviewActionTarget {
  project: string;
  actionName: string;
  /**
   * Absent for a project-scoped action. That case keeps the terminal: with no plan there is nothing
   * for a change request to land on, so framing the app and collecting comments would collect them
   * for nobody.
   */
  planId?: string;
  worktree?: string;
}

export interface ReviewActionViewProps {
  target: ReviewActionTarget;
  /** The plan a change request would be dispatched against. Absent for a project-scoped action. */
  plan?: PlanDetail | PlanSummary;
  onClose: () => void;
  onJobStarted?: (response: StartJobResponse) => void;
}

const UPDATE_ACTION_ID = "tendril-update-from-comments";

/** The command stream id the viewer listens on. One viewer per view, so one channel is enough. */
const VIEWER_COMMAND_STREAM = "review-action-viewer";

/**
 * The review-action run loop: the command's terminal, then the app it started, then the reviewer's
 * comments on it as a change request.
 *
 * Ported from `Apps/ReviewAction/ReviewActionApp` and `AppPreviewView`, which opened a review action
 * as its own tab and swapped the terminal for the preview in place. This is the same sequence as a
 * full-height view, which is what makes framing a real app usable — a preview boxed into a card
 * inside a scrolling page is not the app the reviewer was asked to review.
 *
 * The pty keeps running underneath the preview: the app has to stay up for as long as it is being
 * looked at, so closing the view stops watching the stream rather than stopping the process.
 */
export function ReviewActionView({ target, plan, onClose, onJobStarted }: ReviewActionViewProps) {
  const [appUrl, setAppUrl] = React.useState<string | null>(null);
  const [device, setDevice] = React.useState("Desktop");
  const [comments, setComments] = React.useState<AppComment[]>([]);
  const [exitMessage, setExitMessage] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [isDialogOpen, setIsDialogOpen] = React.useState(false);
  const [showTerminal, setShowTerminal] = React.useState(false);

  const terminalRef = React.useRef<TerminalHandle | null>(null);
  const runRef = React.useRef<ReviewActionRun | null>(null);
  const transcriptRef = React.useRef("");
  const decoderRef = React.useRef(new TextDecoder("utf-8"));
  /**
   * Output that arrived before the emulator was on screen. The terminal is only mounted once the run
   * has started, and a fast command can have printed its whole banner by then.
   */
  const pendingRef = React.useRef<Uint8Array[]>([]);

  // The detected URL is set once and then left alone. A dev server reprints its banner on every hot
  // restart and prints a second URL for its network address; re-pointing the viewer on either would
  // throw the reviewer out of wherever they had navigated, mid-review.
  const urlSetRef = React.useRef(false);

  const write = React.useCallback((bytes: Uint8Array) => {
    const handle = terminalRef.current;
    if (handle) handle.write(bytes);
    else pendingRef.current.push(bytes);
  }, []);

  const attachTerminal = React.useCallback((handle: TerminalHandle | null) => {
    terminalRef.current = handle;
    if (!handle) return;
    for (const chunk of pendingRef.current) handle.write(chunk);
    pendingRef.current = [];
  }, []);

  /** Only the plan-scoped case previews the app; see [`ReviewActionTarget.planId`]. */
  const canPreview = target.planId !== undefined && plan !== undefined;

  React.useEffect(() => {
    let cancelled = false;

    const onChunk = (bytes: Uint8Array) => {
      write(bytes);
      if (urlSetRef.current) return;
      // `stream: true` so a multi-byte character split across two chunks is not mangled, and so a
      // URL split across them is still one string by the time it is searched for.
      transcriptRef.current += decoderRef.current.decode(bytes, { stream: true });
      const found = detectAppUrl(transcriptRef.current);
      if (found) {
        urlSetRef.current = true;
        setAppUrl(found);
      }
    };

    void (async () => {
      try {
        const run = await bridge.startReviewAction(target.project, target.actionName, {
          planId: target.planId,
          worktree: target.worktree,
          onChunk,
          onEnd: (message) => setExitMessage(message),
          onError: (err) => setError(describeBridgeError(err)),
        });
        if (cancelled) {
          void run.close();
          return;
        }
        runRef.current = run;
        setShowTerminal(true);
      } catch (err) {
        if (!cancelled) setError(describeBridgeError(err));
      }
    })();

    return () => {
      cancelled = true;
      // Stops watching, not the process. See the note on this component.
      void runRef.current?.close();
      runRef.current = null;
    };
  }, [target.project, target.actionName, target.planId, target.worktree, write]);

  // ---- viewer command channel ----------------------------------------------
  // The viewer takes commands off a stream rather than through a prop, so clearing its pins is a
  // write into that channel. Kept in a ref: re-creating the subscriber would re-register the
  // viewer's listener on every render.
  const viewerListenerRef = React.useRef<((data: unknown) => void) | null>(null);
  const subscribeToStream = React.useCallback(
    (_streamId: string, onData: (data: unknown) => void) => {
      viewerListenerRef.current = onData;
      return () => {
        viewerListenerRef.current = null;
      };
    },
    [],
  );

  const handleViewerEvent = React.useCallback(
    (_eventName: string, _id: string, args: unknown[]) => {
      const event = args[0];
      if (typeof event !== "object" || event === null) return;
      const payload = event as { kind?: string; id?: unknown; device?: unknown };

      if (payload.kind === "device" && typeof payload.device === "string") {
        setDevice(payload.device);
        return;
      }
      if (payload.kind === "action") {
        if (payload.id === UPDATE_ACTION_ID) setIsDialogOpen(true);
        return;
      }
      setComments((prev) => applyCommentEvent(prev, payload));
    },
    [],
  );

  const changeRequest = React.useMemo(
    () => (appUrl && comments.length > 0 ? formatChangeRequest(appUrl, comments) : ""),
    [appUrl, comments],
  );

  /** One line per comment, in pin order: `1. <button> "Save" — make this primary`. */
  const summaryItems = React.useMemo(
    () =>
      comments.map((comment) => {
        const tag = comment.tag ? `<${comment.tag.toLowerCase()}>` : "element";
        const quoted = comment.text?.trim() ? ` “${comment.text.trim()}”` : "";
        return `${tag}${quoted} — ${comment.comment.trim()}`;
      }),
    [comments],
  );

  const handleJobStarted = (response: StartJobResponse) => {
    // Clear the pins in the page too, not just the local list: feedback already sent should stop
    // marking up the app, or the next pass re-reports it.
    viewerListenerRef.current?.({ command: "clear-comments" });
    setComments([]);
    onJobStarted?.(response);
  };

  const title = `${target.actionName}${target.planId ? ` — Plan ${target.planId}` : ""}`;

  return (
    <div data-testid="review-action-view" className="flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-2">
        <div className="min-w-0">
          <h1 className="truncate text-sm font-semibold text-foreground">{title}</h1>
          <p className="truncate text-xs text-muted-foreground">
            {appUrl ?? exitMessage ?? "Waiting for the app to report a URL…"}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {appUrl && canPreview && (
            <button
              type="button"
              onClick={() => setAppUrl(null)}
              data-testid="review-action-show-terminal"
              className="rounded-lg border border-border px-3 py-1.5 text-xs text-muted-foreground transition hover:border-ring hover:text-foreground"
            >
              Show terminal
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            data-testid="review-action-close"
            className="rounded-lg border border-border px-3 py-1.5 text-xs text-muted-foreground transition hover:border-ring hover:text-foreground"
          >
            Close
          </button>
        </div>
      </div>

      {error && (
        <div
          role="alert"
          data-testid="review-action-error"
          className="border-b border-border bg-destructive/10 px-4 py-2 text-xs text-destructive"
        >
          {error}
        </div>
      )}

      <div className="min-h-0 flex-1">
        {appUrl && canPreview ? (
          <WebViewer
            id="review-action-preview"
            url={appUrl}
            device={device}
            proxy="auto"
            toolbar
            height="100%"
            commands={{ id: VIEWER_COMMAND_STREAM }}
            subscribeToStream={subscribeToStream}
            events={["OnEvent"]}
            eventHandler={handleViewerEvent}
            actions={
              comments.length > 0
                ? [
                    {
                      id: UPDATE_ACTION_ID,
                      icon: "Send",
                      // Only once there is something to send: an Update button with nothing behind it
                      // invites a change request made of nothing.
                      label: `Send ${comments.length} comment${comments.length === 1 ? "" : "s"} to the agent as a change request`,
                      badge: String(comments.length),
                      primary: true,
                    },
                  ]
                : []
            }
          />
        ) : showTerminal ? (
          <Terminal
            ref={attachTerminal}
            className="h-full"
            onInput={(data) => void runRef.current?.sendInput(data)}
            onResize={(rows, cols) => void runRef.current?.resize(rows, cols)}
          />
        ) : (
          <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
            Starting {target.actionName}…
          </div>
        )}
      </div>

      {plan && (
        <SuggestChangesDialog
          isOpen={isDialogOpen}
          onClose={() => setIsDialogOpen(false)}
          plan={plan}
          initialChangeRequest={changeRequest}
          summaryTitle={`${comments.length} comment${comments.length === 1 ? "" : "s"} on ${appUrl ?? ""}`}
          summaryItems={summaryItems}
          onJobStarted={handleJobStarted}
        />
      )}
    </div>
  );
}
