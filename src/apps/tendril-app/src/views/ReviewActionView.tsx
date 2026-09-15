import * as React from "react";
import { Terminal, WebViewer, type TerminalHandle } from "@ivy-interactive/components/tendril";
import { bridge, type ReviewActionRun } from "../api/bridge";
import {
  applyCommentEvent,
  formatChangeRequest,
  readSource,
  type AppComment,
} from "../utils/appComments";
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
  /**
   * Not called from inside the view: closing a review action is the shell tab's X, as in V1, where
   * `ReviewActionApp` renders the runner and nothing else and the session tab carries the close.
   * Kept so the host can clear the target it opened this with when that X is pressed.
   */
  onClose: () => void;
  onJobStarted?: (response: StartJobResponse) => void;
}

/** `AppPreviewView.UpdateActionId`. */
const UPDATE_ACTION_ID = "update";

/** The command stream id the viewer listens on. One viewer per view, so one channel is enough. */
const VIEWER_COMMAND_STREAM = "review-action-viewer";

/**
 * `PtyOptions.MaxCaptureLength`. The transcript is only accumulated until a URL is found in it, but
 * a command that never prints one would otherwise grow it for the length of the review.
 */
const MAX_TRANSCRIPT = 1_000_000;

/**
 * Whether a chunk put anything on the screen, as V1's terminal widget decides it: OSC strings, CSI
 * sequences, any other escape and the C0 controls are all stripped before asking. This is what
 * dismisses the starting indicator, so a command whose first write is a cursor-hide or a title
 * sequence must not count as having started printing.
 */
function hasVisibleText(text: string): boolean {
  return (
    text
      // eslint-disable-next-line no-control-regex
      .replace(/\x1b\][\s\S]*?(\x07|\x1b\\|$)/g, "")
      // eslint-disable-next-line no-control-regex
      .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, "")
      // eslint-disable-next-line no-control-regex
      .replace(/\x1b[\s\S]/g, "")
      // eslint-disable-next-line no-control-regex
      .replace(/[\x00-\x1f\x7f]/g, "")
      .trim().length > 0
  );
}

/**
 * The review-action run loop: the command's terminal, then the app it started, then the reviewer's
 * comments on it as a change request.
 *
 * Ported from `Apps/ReviewAction/ReviewActionApp` and `AppPreviewView`, which opened a review action
 * as its own tab holding nothing but the runner — `.WithLayout().Full().RemoveParentPadding()`, no
 * header, no status line, no controls of its own. The identity of the run lives in the tab title and
 * the app's own URL in the viewer's address bar, which is what makes framing a real app usable: a
 * preview boxed into a card inside a scrolling page is not the app the reviewer was asked to review.
 *
 * The swap is one-way, as in `ReviewActionApp`: "the terminal is the start of a review action, not
 * the point of one", so once the process says where it is serving, the tab becomes that app and the
 * terminal's job is done. The pty keeps running underneath the preview — the app has to stay up for
 * as long as it is being looked at — so closing the view stops watching the stream rather than
 * stopping the process.
 */
export function ReviewActionView({ target, plan, onJobStarted }: ReviewActionViewProps) {
  const [appUrl, setAppUrl] = React.useState<string | null>(null);
  const [device, setDevice] = React.useState("Desktop");
  const [comments, setComments] = React.useState<AppComment[]>([]);
  /** Whether the command has printed anything yet; dismisses the starting indicator. */
  const [hasOutput, setHasOutput] = React.useState(false);
  /** `PtyHandle.Closed`: the process is gone, so the terminal stops taking keystrokes. */
  const [closed, setClosed] = React.useState(false);
  /** Only set when the action never started, which is the case V1 answers with muted text. */
  const [error, setError] = React.useState<string | null>(null);
  const [isDialogOpen, setIsDialogOpen] = React.useState(false);

  const terminalRef = React.useRef<TerminalHandle | null>(null);
  const runRef = React.useRef<ReviewActionRun | null>(null);
  const transcriptRef = React.useRef("");
  const decoderRef = React.useRef(new TextDecoder("utf-8"));
  const visibleRef = React.useRef(false);
  /**
   * Output that arrived before the emulator was on screen, and after it left it. The first is a fast
   * command that printed its whole banner before the ref was attached; the second is dropped,
   * because the terminal does not come back.
   */
  const pendingRef = React.useRef<Uint8Array[]>([]);
  const retiredRef = React.useRef(false);

  // The detected URL is set once and then left alone. A dev server reprints its banner on every hot
  // restart and prints a second URL for its network address; re-pointing the viewer on either would
  // throw the reviewer out of wherever they had navigated, mid-review.
  const urlSetRef = React.useRef(false);

  const write = React.useCallback((bytes: Uint8Array) => {
    const handle = terminalRef.current;
    if (handle) handle.write(bytes);
    else if (!retiredRef.current) pendingRef.current.push(bytes);
  }, []);

  /**
   * Host-side news, printed into the transcript rather than into chrome above it. V1 runs the
   * command under `pwsh -NoExit`, so the shell itself reports how it went and `ReviewActionApp` adds
   * nothing but `.Closed(...)` for it; V2's host reports it out of band, so this is where it goes.
   */
  const notice = React.useCallback(
    (message: string) => {
      write(new TextEncoder().encode(`\r\n\x1b[2m${message}\x1b[0m\r\n`));
    },
    [write],
  );

  const attachTerminal = React.useCallback((handle: TerminalHandle | null) => {
    terminalRef.current = handle;
    if (!handle) {
      // The terminal is never swapped back in, so anything arriving once it is gone has nowhere to
      // land; buffering it would grow for the length of the review.
      pendingRef.current = [];
      retiredRef.current = true;
      return;
    }
    for (const chunk of pendingRef.current) handle.write(chunk);
    pendingRef.current = [];
    // `Terminal.AutoFocus`, which V1 leaves at its default: a review action's command is
    // interactive, and one that has to be clicked before it can be typed into is a stuck one.
    handle.focus();
  }, []);

  /** Only the plan-scoped case previews the app; see [`ReviewActionTarget.planId`]. */
  const canPreview = target.planId !== undefined && plan !== undefined;

  React.useEffect(() => {
    let cancelled = false;

    const onChunk = (bytes: Uint8Array) => {
      write(bytes);
      if (visibleRef.current && urlSetRef.current) return;
      // `stream: true` so a multi-byte character split across two chunks is not mangled, and so a
      // URL split across them is still one string by the time it is searched for.
      const text = decoderRef.current.decode(bytes, { stream: true });

      if (!visibleRef.current && hasVisibleText(text)) {
        visibleRef.current = true;
        setHasOutput(true);
      }

      if (urlSetRef.current) return;
      transcriptRef.current = (transcriptRef.current + text).slice(-MAX_TRANSCRIPT);
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
          onEnd: (message) => {
            setClosed(true);
            if (message) notice(message);
          },
          onError: (err) => notice(describeBridgeError(err)),
        });
        if (cancelled) {
          void run.close();
          return;
        }
        runRef.current = run;
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
  }, [target.project, target.actionName, target.planId, target.worktree, write, notice]);

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

  /**
   * One line per comment, in pin order, as `UpdateFromCommentsDialog` lists them: what the reviewer
   * said first, then where it points — the source location the widget resolved, or the selector when
   * it resolved nothing. The page comes along for a comment left somewhere other than the app's own
   * entry URL, which is the fact V1's grouping carries: a comment left three screens back is not
   * feedback on the screen the reviewer happens to be looking at.
   */
  const summaryItems = React.useMemo(
    () =>
      comments.map((comment) => {
        const tag = comment.tag || "element";
        const where = readSource(comment.debugJson).label ?? comment.selector;
        const page = comment.url && comment.url !== appUrl ? ` · ${comment.url}` : "";
        return `${comment.comment.trim()} — ${where ? `${tag} · ${where}` : tag}${page}`;
      }),
    [appUrl, comments],
  );

  const handleJobStarted = (response: StartJobResponse) => {
    // Clear the pins in the page too, not just the local list: feedback already sent should stop
    // marking up the app, or the next pass re-reports it.
    viewerListenerRef.current?.({ command: "clear-comments" });
    setComments([]);
    onJobStarted?.(response);
  };

  // A review action that could not be started at all, which is where `ReviewActionApp` early-returns
  // `Text.Muted("Plan not found.")` and its siblings: an explanation in place of the runner, since
  // there is no runner to put chrome around.
  if (error !== null) {
    return (
      <p role="alert" data-testid="review-action-error" className="text-sm text-muted-foreground">
        {error}
      </p>
    );
  }

  return (
    <div data-testid="review-action-view" className="relative h-full min-h-0">
      {appUrl && canPreview ? (
        <WebViewer
          id="review-action-preview"
          url={appUrl}
          device={device}
          proxy="auto"
          toolbar
          width="100%"
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
                    icon: "MessageSquare",
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
      ) : (
        <>
          <Terminal
            ref={attachTerminal}
            className="h-full"
            readOnly={closed}
            onInput={(data) => void runRef.current?.sendInput(data)}
            onResize={(rows, cols) => void runRef.current?.resize(rows, cols)}
          />
          {/* `Terminal.Loading("Starting <action>...")`: the emulator is mounted from the first
              render and this sits over it until the command prints, so nothing is lost waiting for
              it. White on the terminal's own dark ground, which it keeps in either app theme. */}
          {!hasOutput && !closed && (
            <div
              role="status"
              className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-3"
            >
              <span className="h-6 w-6 animate-spin rounded-full border-2 border-white/30 border-t-white" />
              <span className="font-mono text-xs text-white">Starting {target.actionName}…</span>
            </div>
          )}
        </>
      )}

      {plan && (
        <SuggestChangesDialog
          isOpen={isDialogOpen}
          onClose={() => setIsDialogOpen(false)}
          plan={plan}
          initialChangeRequest={changeRequest}
          summaryTitle={`${comments.length} comment${comments.length === 1 ? "" : "s"} from the running app`}
          summaryItems={summaryItems}
          onJobStarted={handleJobStarted}
        />
      )}
    </div>
  );
}
