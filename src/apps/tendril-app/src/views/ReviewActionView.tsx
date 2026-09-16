import * as React from "react";
import { Terminal, WebViewer, type TerminalHandle } from "@ivy-interactive/components/tendril";
import { bridge, type ReviewActionRun } from "../api/bridge";
import {
  applyCommentEvent,
  formatChangeRequest,
  type AppComment,
  type ViewerEvent,
} from "../utils/appComments";
import { detectAppUrl } from "../utils/detectAppUrl";
import {
  describeBridgeError,
  type Job,
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
  /** The live job list, filtered to this plan for the update dialog's two `AppPreview` gates. */
  jobs?: Job[];
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
 * `ReviewActionApp`'s `Context.UseInterval(..., TimeSpan.FromMilliseconds(500))`, which is how often
 * V1 asks the captured transcript whether the app has announced itself yet.
 *
 * A sample rather than a search per chunk, for both of V1's reasons. A build prints thousands of
 * chunks and the transcript runs to `MAX_TRANSCRIPT`, so re-scanning all of it on each one is
 * quadratic in the length of the boot log. And `detectAppUrl` prefers a loopback host over a LAN one
 * *wherever either appears*, which only means anything once both lines have had a chance to arrive: a
 * server that prints `Network:` before `Local:` would otherwise be pinned to its LAN address by the
 * scan that saw only the first line.
 */
const URL_DETECT_INTERVAL_MS = 500;

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
export function ReviewActionView({ target, plan, jobs = [], onJobStarted }: ReviewActionViewProps) {
  const [appUrl, setAppUrl] = React.useState<string | null>(null);
  const [device, setDevice] = React.useState("Desktop");
  const [comments, setComments] = React.useState<AppComment[]>([]);
  /** `PtyHandle.Closed`: the process is gone, so the terminal stops taking keystrokes. */
  const [closed, setClosed] = React.useState(false);
  /** Only set when the action never started, which is the case V1 answers with muted text. */
  const [error, setError] = React.useState<string | null>(null);
  const [isDialogOpen, setIsDialogOpen] = React.useState(false);

  const terminalRef = React.useRef<TerminalHandle | null>(null);
  const runRef = React.useRef<ReviewActionRun | null>(null);
  const transcriptRef = React.useRef("");
  const decoderRef = React.useRef(new TextDecoder("utf-8"));
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
  }, []);

  /** Only the plan-scoped case previews the app; see [`ReviewActionTarget.planId`]. */
  const canPreview = target.planId !== undefined && plan !== undefined;

  React.useEffect(() => {
    let cancelled = false;

    // Accumulate only; the transcript is *searched* on the interval below, as V1 does. Once the URL
    // is found the transcript stops growing: nothing reads it again, and a command that keeps
    // printing for the length of the review would otherwise keep a megabyte of it alive.
    const onChunk = (bytes: Uint8Array) => {
      write(bytes);
      if (urlSetRef.current) return;
      // `stream: true` so a multi-byte character split across two chunks is not mangled, and so a
      // URL split across them is still one string by the time it is searched for.
      transcriptRef.current = (
        transcriptRef.current + decoderRef.current.decode(bytes, { stream: true })
      ).slice(-MAX_TRANSCRIPT);
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

  /**
   * `ReviewActionApp`'s URL poll, kept running until it finds one and then stopped.
   *
   * Unconditional, exactly as V1 leaves it: it runs for a project-scoped action too, where nothing
   * reads the result, because making the hook conditional on which kind of action this is costs more
   * than the sample does. The interval reads the ref rather than state so it never needs to be
   * re-created as the transcript grows.
   */
  React.useEffect(() => {
    if (appUrl !== null) return;
    const timer = window.setInterval(() => {
      if (urlSetRef.current) return;
      const found = detectAppUrl(transcriptRef.current);
      if (found === null) return;
      urlSetRef.current = true;
      setAppUrl(found);
    }, URL_DETECT_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [appUrl]);

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

  /**
   * `AppPreviewView`'s `WithOnEvent` switch, case for case.
   *
   * A switch and not a fall-through, because the cases V1 has no arm for are the loud ones: the
   * viewer reports every console line, network entry and capture the app produces on this same
   * channel, and "what the widget reports beyond comments, navigation and its own toolbar is dropped
   * on the floor". Handing those to the comment reducer instead re-rendered this view once per line
   * the app under review happened to log.
   *
   * `navigated` is V1's `NavigateEvent`, and is deliberately dropped rather than ported: V1 wrote it
   * back into the state feeding `.Url()`, whereas this viewer owns its own history and address bar,
   * so there is nothing here to write it into. The change request still quotes `appUrl` — the URL the
   * command announced — which is what V1's `UpdateFromCommentsDialog` was handed too, so a comment
   * left on a page the reviewer navigated to carries that page in its own `url` field.
   */
  const handleViewerEvent = React.useCallback(
    (_eventName: string, _id: string, args: unknown[]) => {
      const event = args[0];
      if (typeof event !== "object" || event === null) return;
      const payload = event as ViewerEvent & { id?: unknown; device?: unknown };

      switch (payload.kind) {
        case "device":
          // `DeviceChangedEvent`: the viewport menu is the viewer's, so the label it reports is
          // written back to stay the one it is told to render at.
          if (typeof payload.device === "string") setDevice(payload.device);
          return;

        case "action":
          if (payload.id === UPDATE_ACTION_ID) setIsDialogOpen(true);
          return;

        // `CommentEvent`, `CommentUpdatedEvent`, `CommentDeletedEvent`. The reducer owns the
        // renumbering a delete forces, which mirrors what the pins in the page do.
        case "comment":
        case "comment-edit":
        case "comment-delete":
          setComments((prev) => applyCommentEvent(prev, payload));
          return;

        default:
          return;
      }
    },
    [],
  );

  /**
   * `UpdateFromCommentsDialog.Build`'s `if (pending.IsEmpty) { dialogOpen.Set(false); return null; }`.
   *
   * A confirmation of nothing is not worth showing, and here it would be worse than empty: the shared
   * dialog reads an empty `appComments` as "not the app-preview dialog" and falls back to the
   * diff-side Request Changes, which is a different dialog with a free-text field.
   */
  React.useEffect(() => {
    if (isDialogOpen && comments.length === 0) setIsDialogOpen(false);
  }, [isDialogOpen, comments.length]);

  const changeRequest = React.useMemo(
    () => (appUrl && comments.length > 0 ? formatChangeRequest(appUrl, comments) : ""),
    [appUrl, comments],
  );

  /**
   * The jobs already running on this plan. `UpdateFromCommentsDialog` reads them twice: to queue the
   * new request behind them (`JobsToWaitFor`) instead of letting two agents rewrite one worktree, and
   * for the `CanRequestChanges` gate that decides whether the request can be sent at all.
   */
  const planJobs = React.useMemo(
    () => (plan ? jobs.filter((job) => job.planId === plan.id) : []),
    [jobs, plan],
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
        /*
         * `.Closed(ptyHandle.Closed).AllowClipboard().Loading($"Starting {action.Name}...")`, which is
         * the whole of what `ReviewActionApp` configures on the terminal besides its three streams.
         *
         * `closed` rather than `readOnly`: both refuse keystrokes and hide the cursor, but only
         * `closed` also takes the starting indicator down, which is the honest answer for a command
         * that exited before printing anything. `allowClipboard` and `autoFocus` are the component's
         * defaults, so V1's `.AllowClipboard()` and the emulator taking focus on mount need no props.
         * The overlay is the component's own, which waits for *visible* output: a command whose first
         * write is a cursor-hide or a title sequence has not started printing yet.
         */
        <Terminal
          ref={attachTerminal}
          className="h-full"
          closed={closed}
          loading
          loadingText={`Starting ${target.actionName}…`}
          onInput={(data) => void runRef.current?.sendInput(data)}
          onResize={(rows, cols) => void runRef.current?.resize(rows, cols)}
        />
      )}

      {plan && (
        <SuggestChangesDialog
          isOpen={isDialogOpen}
          onClose={() => setIsDialogOpen(false)}
          plan={plan}
          initialChangeRequest={changeRequest}
          /* Present means the dialog is V1's `UpdateFromCommentsDialog`: the comments listed
             read-only and grouped by the page each was left on, not a flat list above a field. */
          appComments={comments}
          appUrl={appUrl ?? undefined}
          planJobs={planJobs}
          onJobStarted={handleJobStarted}
        />
      )}
    </div>
  );
}
