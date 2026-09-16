import React, { useState, useEffect, useMemo } from "react";
import { useShortcut } from "@ivy-interactive/components/tendril";
import { uiStore, type UiState } from "./state/uiStore";
import { sidebarListStore, usePublishedSidebarList } from "./state/sidebarListStore";
import { toAddressArgs } from "./state/navigation";
import { plansStore } from "./state/plansStore";
import { jobsStore } from "./state/jobsStore";
import { notificationsStore } from "./state/notificationsStore";
import { serviceStore } from "./state/serviceStore";
import { bridge } from "./api/bridge";
import { chatApi } from "./api/chatApi";
import {
  onChangeEvent,
  onChangeStreamStatus,
  onJobEvent,
  onPlanEvent,
  onServiceStatus,
} from "./api/events";
import { applyChangeEvent } from "./api/changes";
import {
  describeBridgeError,
  type OnboardingStatus,
  type ProjectSummary,
  type VersionInfo,
} from "./types/api";
import { getUpdateCommand } from "./utils/updateCommand";

import { Loader2 } from "lucide-react";
import { ShellLayout } from "./views/ShellLayout";
import { OnboardingWizard } from "./views/onboarding/OnboardingWizard";
import { NewPlanModal } from "./views/NewPlanModal";
import { KeyboardShortcutsHelp } from "./components/KeyboardShortcutsHelp";
// Type only, so this does not pull the view (and xterm.js with it) into the entry chunk.
import type { ReviewActionTarget } from "./views/ReviewActionView";

// Lazy, and by module rather than through the `./views/dialogs` barrel. App.tsx
// is the one eager module in the shell — every view below it is lazy — and the
// dialog family pulls in `@ivy-interactive/components/ui`, a ~190 kB entry point
// nothing else here needs. Loading it eagerly for a dialog that only appears
// when no project is configured put the entry chunk over its size budget.
const NoProjectsDialog = React.lazy(() =>
  import("./views/dialogs/NoProjectsDialog").then((m) => ({ default: m.NoProjectsDialog })),
);

// Same reasoning, by module rather than the barrel: the two job sweeps are the only confirms the
// shell itself owns, and both are rare.
const ConfirmDialog = React.lazy(() =>
  import("./views/dialogs/ConfirmDialog").then((m) => ({ default: m.ConfirmDialog })),
);

// Lazy for the same reason, and it is the whole point of `notificationsStore` reaching `toast`
// through a dynamic import too: the toast viewport is mounted from the start of the session, but
// the chunk it lives in is fetched alongside the first view rather than blocking the entry chunk.
const Toaster = React.lazy(() =>
  import("@ivy-interactive/components/ui").then((m) => ({ default: m.Toaster })),
);

/** How often the job list is re-read to spot exits. Short enough that a finished job is announced
 *  while the operator still has it in mind, long enough to be a rounding error on the daemon. */
const JOB_POLL_INTERVAL_MS = 5000;

const DashboardView = React.lazy(() =>
  import("./views/DashboardView").then((m) => ({ default: m.DashboardView })),
);
const PlansView = React.lazy(() =>
  import("./views/PlansView").then((m) => ({ default: m.PlansView })),
);
const PlanDetailView = React.lazy(() =>
  import("./views/PlanDetailView").then((m) => ({ default: m.PlanDetailView })),
);
const JobSessionView = React.lazy(() =>
  import("./views/JobSessionView").then((m) => ({ default: m.JobSessionView })),
);
const ReviewView = React.lazy(() =>
  import("./views/ReviewView").then((m) => ({ default: m.ReviewView })),
);
const SettingsView = React.lazy(() =>
  import("./views/SettingsView").then((m) => ({ default: m.SettingsView })),
);
const ChatView = React.lazy(() =>
  import("./views/ChatView").then((m) => ({ default: m.ChatView })),
);
const InboxView = React.lazy(() =>
  import("./views/InboxView").then((m) => ({ default: m.InboxView })),
);
const PullRequestsView = React.lazy(() =>
  import("./views/PullRequestsView").then((m) => ({ default: m.PullRequestsView })),
);
const RecommendationsView = React.lazy(() =>
  import("./views/RecommendationsView").then((m) => ({ default: m.RecommendationsView })),
);
const IceboxView = React.lazy(() =>
  import("./views/IceboxView").then((m) => ({ default: m.IceboxView })),
);
const JobsView = React.lazy(() =>
  import("./views/JobsView").then((m) => ({ default: m.JobsView })),
);
// Lazy for the same reason as the rest, with more at stake: this is the only
// view that pulls in xterm.js, which nothing else in the shell needs.
const ReviewActionView = React.lazy(() =>
  import("./views/ReviewActionView").then((m) => ({ default: m.ReviewActionView })),
);

/**
 * V1's `ReviewActionApp` id. It is `[App(..., isVisible: false, allowDuplicateTabs: true)]`, so the
 * router opens it as a session tab rather than a page, and a second action can run beside the first.
 */
const REVIEW_ACTION_APP_ID = "review-action";

/**
 * The session a review action's pane is keyed by. Router rule 3 keys a pane by its session id, so
 * reopening the same action reveals the terminal already running it instead of spawning a second
 * run - V1 keys an agent pane by its chat session id for exactly that reason. Two *different*
 * actions get different ids and therefore their own panes, which is what `allowDuplicateTabs: true`
 * buys and what V2's previous single `review-action` nav could not express.
 */
const reviewActionSessionId = (target: ReviewActionTarget): string =>
  `${REVIEW_ACTION_APP_ID}:${target.project}:${target.planId ?? ""}:${target.actionName}`;

/** V1 `ResolveArgsTabTitle`: a review-action tab reads "#74 Run Tests", or "[Project] Run Tests". */
const reviewActionTabTitle = (target: ReviewActionTarget): string =>
  target.planId
    ? `#${Number.parseInt(target.planId, 10) || target.planId} ${target.actionName}`
    : `[${target.project}] ${target.actionName}`;

/** Reads one string field out of a sidebar row's `buildSelectArgs` result. */
const selectArgField = (args: unknown, field: string): string | undefined => {
  if (typeof args !== "object" || args === null) return undefined;
  const value = (args as Record<string, unknown>)[field];
  return typeof value === "string" && value.length > 0 ? value : undefined;
};

export const App: React.FC = () => {
  const [uiState, setUiState] = useState<UiState>(uiStore.getState());
  const [plansState, setPlansState] = useState(plansStore.getState());
  const [jobsState, setJobsState] = useState(jobsStore.getState());
  const [serviceState, setServiceState] = useState(serviceStore.getState());

  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  // Distinguishes "no projects configured" from "the list has not arrived yet",
  // so the new-plan flow does not flash the empty state on startup.
  const [projectsLoaded, setProjectsLoaded] = useState(false);
  const [isNewPlanOpen, setIsNewPlanOpen] = useState(false);
  // The two bulk job sweeps. Confirmed because both kill work in flight.
  const [stopQueuedOpen, setStopQueuedOpen] = useState(false);
  const [stopAllOpen, setStopAllOpen] = useState(false);
  const [stopBusy, setStopBusy] = useState(false);
  const [stopError, setStopError] = useState<string | null>(null);
  const [newPlanPrefill, setNewPlanPrefill] = useState<{
    title?: string;
    description?: string;
    sourceUrl?: string;
    project?: string;
  }>({});
  const [isShortcutsOpen, setIsShortcutsOpen] = useState(false);
  // Which review action the review-action view is running. Held here rather than encoded into the nav
  // id: it is three values, and it is deliberately not persisted — a restored nav pointing at a
  // process that died with the last session has nothing to show.
  const [reviewActionTargets, setReviewActionTargets] = useState<
    Record<string, ReviewActionTarget>
  >({});
  // Null means "no wizard": either it is not needed, or the status call failed. An unreachable
  // daemon must never produce a first-run wizard, and must never block the shell.
  const [onboarding, setOnboarding] = useState<OnboardingStatus | null>(null);
  // Failures from actions the shell itself owns (service restart/repair).
  const [shellError, setShellError] = useState<string | null>(null);
  const [versionInfo, setVersionInfo] = useState<VersionInfo | null>(null);
  const [recommendationsCount, setRecommendationsCount] = useState<number>(0);
  const [chatSessionsCount, setChatSessionsCount] = useState<number>(0);
  // The list the active sidebar-section app published into the shell (V1's ShellSidebarListSignal).
  const sidebarList = usePublishedSidebarList();

  // Subscribe to stores
  useEffect(() => {
    const unsubUi = uiStore.subscribe(() => setUiState({ ...uiStore.getState() }));
    const unsubPlans = plansStore.subscribe(() => setPlansState({ ...plansStore.getState() }));
    const unsubJobs = jobsStore.subscribe(() => setJobsState({ ...jobsStore.getState() }));
    const unsubService = serviceStore.subscribe(() =>
      setServiceState({ ...serviceStore.getState() }),
    );

    void uiStore.init();
    serviceStore.refreshInfo().catch(() => {});
    plansStore.fetchPlans().catch(() => {});
    jobsStore.fetchJobs().catch(() => {});

    bridge
      .listProjects()
      .then((list) => {
        setProjects(list);
        setProjectsLoaded(true);
      })
      .catch(() => {});

    bridge
      .getOnboardingStatus()
      .then(setOnboarding)
      .catch(() => setOnboarding(null));

    bridge
      .listCrossPlanRecommendations(undefined, "Pending")
      .then((recs) => setRecommendationsCount(recs.length))
      .catch(() => {});

    chatApi
      .listSessions()
      .then((sessions) => setChatSessionsCount(sessions.length))
      .catch(() => {});

    // The app only ever reads the daemon's cached release-check result, never the release feed
    // itself — a 6-hour poll matches the daemon's own success-path interval.
    bridge
      .getVersionInfo()
      .then(setVersionInfo)
      .catch(() => {});
    const versionInterval = setInterval(
      () => {
        bridge
          .getVersionInfo()
          .then(setVersionInfo)
          .catch(() => {});
      },
      6 * 60 * 60 * 1000,
    );

    return () => {
      unsubUi();
      unsubPlans();
      unsubJobs();
      unsubService();
      clearInterval(versionInterval);
    };
  }, []);

  // Subscribe to realtime daemon events
  useEffect(() => {
    let unsubStatus: (() => void) | undefined;
    let unsubJob: (() => void) | undefined;
    let unsubPlan: (() => void) | undefined;
    let unsubChange: (() => void) | undefined;
    let unsubChangeStatus: (() => void) | undefined;

    onServiceStatus((st) => {
      serviceStore.setStatus(
        st === "connected" ? "online" : st === "reconnecting" ? "reconnecting" : "offline",
      );
    })
      .then((unsub) => (unsubStatus = unsub))
      .catch(() => {});

    onJobEvent((payload) => {
      const item = payload as Record<string, unknown>;
      const type = item.type as string | undefined;

      // The daemon now emits job lifecycle over this channel — `job.status_changed` on every status
      // move and `job.completed`/`job.failed` on top of it at the end. Before, it emitted nothing
      // job-shaped at all and this handler only ever appended agent output, which is why the 5s poll
      // below was the only thing that moved a badge. The poll stays as the backstop.
      if (type?.startsWith("job.")) {
        jobsStore.fetchJobs().catch(() => {});
        if (type === "job.completed" || type === "job.failed") {
          // A terminal job moves its plan's state too, and the plan list is a separate projection.
          plansStore.fetchPlans().catch(() => {});
        }
        return;
      }

      // A client the daemon's broadcast outran is told how much it missed rather than left silently
      // deaf. There is nothing to replay into a log from that, so the answer is to re-read.
      if (type === "resync") {
        jobsStore.fetchJobs().catch(() => {});
        plansStore.fetchPlans().catch(() => {});
        return;
      }

      const jobId = (item.jobId as string) || (item.id as string) || "live-job";
      jobsStore.addStreamEvent(jobId, payload);
    })
      .then((unsub) => (unsubJob = unsub))
      .catch(() => {});

    onPlanEvent((_payload) => {
      plansStore.fetchPlans().catch(() => {});
      // Job-driven Dashboard counts (retry loop, PR label) go stale otherwise:
      // onJobEvent only appends stream events, it never refreshes the list.
      jobsStore.fetchJobs().catch(() => {});
    })
      .then((unsub) => (unsubPlan = unsub))
      .catch(() => {});

    // Filesystem changes: a plan edited by the CLI, a promptware run or an editor reaches the UI
    // through here, which is the only route for changes no in-app action caused.
    onChangeEvent((event) => {
      // Read the selection at delivery time rather than closing over it: this effect runs once, so a
      // captured value would be whatever was selected at mount.
      const selected = plansStore.getState().selectedPlan;
      applyChangeEvent(event, {
        refreshPlans: () => void plansStore.fetchPlans().catch(() => {}),
        refreshPlanDetail: (folder) =>
          void plansStore.fetchPlanDetail(selected?.id ?? folder).catch(() => {}),
        refreshJobs: () => void jobsStore.fetchJobs().catch(() => {}),
        refreshProjects: () =>
          void bridge
            .listProjects()
            .then(setProjects)
            .catch(() => {}),
        selectedPlanFolder: selected?.folderPath ?? selected?.id ?? null,
      });
    })
      .then((unsub) => (unsubChange = unsub))
      .catch(() => {});

    onChangeStreamStatus((status) => {
      serviceStore.setChangeStreamConnected(status === "connected");
    })
      .then((unsub) => (unsubChangeStatus = unsub))
      .catch(() => {});

    // Notifications: read the setting, ask for OS permission if it is on, then announce every job
    // that exits. The daemon's WebSocket carries chat and PR events but not job lifecycle ones, so
    // the exits have to be noticed by polling the list — `jobsStore` diffs each snapshot and only
    // reports transitions, so the tick costs one request and raises nothing when nothing changed.
    notificationsStore.init().catch(() => {});
    const unsubExit = jobsStore.onJobExit((notification) =>
      notificationsStore.notifyJobExit(notification),
    );
    const pollTimer = window.setInterval(() => {
      if (serviceStore.getState().status !== "online") return;
      jobsStore.fetchJobs().catch(() => {});
    }, JOB_POLL_INTERVAL_MS);

    return () => {
      if (unsubStatus) unsubStatus();
      if (unsubJob) unsubJob();
      if (unsubPlan) unsubPlan();
      if (unsubChange) unsubChange();
      if (unsubChangeStatus) unsubChangeStatus();
      unsubExit();
      window.clearInterval(pollTimer);
    };
  }, []);

  // Global Keyboard Shortcuts. Each one registers with the components package's shortcut registry,
  // which owns the single window listener, debounces duplicate fires and — because the registry is
  // enumerable — is what KeyboardShortcutsHelp renders instead of a hardcoded list.
  useShortcut("app:toggle-sidebar", "Ctrl+B", () => uiStore.toggleSidebar(), {
    description: "Toggle sidebar collapse",
  });
  useShortcut("app:goto-chat", "Ctrl+Shift+C", () => uiStore.setActiveNav("chat"), {
    description: "Switch to Chat",
  });
  useShortcut("app:goto-inbox", "Ctrl+I", () => uiStore.setActiveNav("inbox"), {
    description: "Open GitHub issue inbox",
  });
  useShortcut(
    "app:new-plan",
    "Ctrl+N",
    () => {
      setNewPlanPrefill({});
      setIsNewPlanOpen(true);
    },
    { description: "Open new plan intake modal" },
  );
  // The handler navigates; it does not focus a search field, and the description now says so.
  useShortcut("app:goto-plans", "Ctrl+K", () => uiStore.setActiveNav("plans"), {
    description: "Go to Plans",
  });
  useShortcut("app:show-shortcuts", "?", () => setIsShortcutsOpen(true), {
    description: "Show keyboard shortcuts",
  });

  // Escape stays on its own listener: it dismisses two overlays rather than invoking one action, it
  // is not a discoverable shortcut worth a row in the help panel, and the registry's preventDefault
  // on every match would fight Radix's own Escape handling.
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setIsNewPlanOpen(false);
      setIsShortcutsOpen(false);
    };

    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, []);

  // Handle plan selection (fetches plan detail and opens tab)
  const handleSelectPlan = async (planId: string) => {
    uiStore.setSelectedPlanId(planId);
    // The plan travels as `appArgs`, which is V1's `PlansAppArgs(planId)` reaching the page it opens
    // rather than being smuggled in through the nav id alone.
    uiStore.navigate({ appId: `plan-${planId}`, args: { planId } });
    try {
      await plansStore.fetchPlanDetail(planId);
    } catch {
      // Handled in store
    }
  };

  /**
   * Opens the review action's own view, which is what runs it: the command is spawned by the view, not
   * before it, so its output has somewhere to go from the first byte.
   */
  const handleOpenReviewAction = (target: ReviewActionTarget) => {
    const sessionId = reviewActionSessionId(target);
    setReviewActionTargets((current) => ({ ...current, [sessionId]: target }));
    // The router decides this is a session, not a page, and reveals the existing pane when this
    // action is already running (`AppShellRouter` rules 3 and 4).
    uiStore.navigate({
      appId: REVIEW_ACTION_APP_ID,
      args: toAddressArgs({ sessionId, ...target }),
    });
  };

  const handleCloseReviewAction = (sessionId: string) => {
    setReviewActionTargets(({ [sessionId]: _closed, ...rest }) => rest);
    uiStore.closeTab(sessionId);
  };

  /**
   * Opens a job's output. V1 shows it in a sheet (`Apps/Jobs/Sheets/OutputSheet.cs`), not a tab, so
   * this navigates a page and creates no tab; the sheet itself is the Jobs area's to build.
   */
  const handleSelectJob = (jobId: string) => {
    uiStore.navigate({ appId: `job-${jobId}`, args: { jobId } });
    // The list endpoint omits reportedFailureReason, so pull the detail.
    jobsStore.fetchJobDetail(jobId).catch(() => {
      // Detail is supplementary; the session view falls back to the list entry.
    });
  };

  /**
   * Start a promptware job and open its session tab.
   *
   * Rejections deliberately propagate to the calling view, which renders them
   * next to the button the operator pressed. Swallowing them here made a
   * refused Execute/Retry/CreatePR look like a no-op.
   */
  const startJobAndOpenSession = async (args: Parameters<typeof bridge.startJob>[0]) => {
    const res = await jobsStore.startJob(args);
    handleSelectJob(res.jobId);
  };

  const draftCount = useMemo(
    () => plansState.plans.filter((p) => p.state === "Draft").length,
    [plansState.plans],
  );
  const reviewCount = useMemo(
    () => plansState.plans.filter((p) => p.state === "Review" || p.state === "Failed").length,
    [plansState.plans],
  );
  const jobCount = useMemo(
    () =>
      jobsState.jobs.filter(
        (j) =>
          j.status === "Running" ||
          j.status === "Queued" ||
          j.status === "Pending" ||
          j.status === "Blocked",
      ).length,
    [jobsState.jobs],
  );

  const handleCheckForUpdates = async () => {
    try {
      const info = await bridge.checkVersionNow();
      setVersionInfo(info);
      const { toast } = await import("@ivy-interactive/components");
      if (info.hasUpdate) {
        toast({
          title: "Update Available",
          description: `Version ${info.latestVersion} is available.`,
        });
      } else {
        toast({
          title: "Up to date",
          description: `You're on the latest version (v${info.currentVersion}).`,
        });
      }
    } catch (err) {
      const { toast } = await import("@ivy-interactive/components");
      toast({
        title: "Update check failed",
        description: describeBridgeError(err),
        variant: "destructive",
      });
    }
  };

  const activeNav = uiState.activeNav;

  // V1 `TendrilAppShell.HandleOpenPage`: the sidebar section belongs to the page app, so it is
  // dropped when the page moves to an app with no list of its own, and retained between apps that
  // both show sidebar sections so the header and search button do not flicker. Without this the
  // list would only be hidden, and coming back to Plans would flash a stale one.
  useEffect(() => {
    sidebarListStore.retainFor(activeNav);
  }, [activeNav]);

  /**
   * V1's section click handler: `OpenApp(new NavigateArgs(list.AppId, list.BuildSelectArgs(itemId)))`.
   *
   * V2 has no arg-carrying navigation, so the args are resolved to the nav that stands in for the
   * V1 app-plus-args pair: `{ planId }` opens that plan (V2 renders V1's `PlansApp` with a `PlanId`
   * under its own `plan-<id>` nav), `{ sessionId }` selects that chat session, and anything else is
   * a plain navigation to the publishing app. `chatStore` is imported dynamically because App.tsx
   * is the shell's only eager module and the chat store is a lazy view's dependency.
   */
  const handleSelectSidebarItem = (appId: string, itemId: string, args: unknown) => {
    const planId = selectArgField(args, "planId");
    if (planId) {
      void handleSelectPlan(planId);
      return;
    }

    const sessionId = selectArgField(args, "sessionId");
    if (sessionId) {
      uiStore.navigate({ appId, args: toAddressArgs(args) });
      void import("./state/chatStore").then((m) => m.chatStore.selectSession(sessionId));
      return;
    }

    // Anything else is V1's plain "navigate to the list's app with these args": the args reach the
    // page as `pageArgs`, and the row id is only what produced them.
    void itemId;
    uiStore.navigate({ appId, args: toAddressArgs(args) });
  };

  // A session pane whose target this render does not have is a pane with nothing to show, so it is
  // retired rather than left as an empty tab. `uiStore` persists no session tabs, so the only way to
  // get here is a target cleared without its tab, which this keeps in step.
  useEffect(() => {
    for (const session of uiState.sessionTabs) {
      if (!reviewActionTargets[session.id]) uiStore.closeTab(session.id);
    }
  }, [uiState.sessionTabs, reviewActionTargets]);

  /**
   * V1's `sessionContents`: one pane per session tab, all mounted, only the active one visible. A
   * review action's terminal therefore keeps running while the reviewer reads the plan behind it,
   * which is the behaviour V1 calls out on `ShowPage` and which V2 lost by rendering the review
   * action as the page.
   */
  const sessionPanes = uiState.sessionTabs.map((session) => {
    const target = reviewActionTargets[session.id];
    if (!target) return <div key={session.id} />;
    return (
      <React.Suspense
        key={session.id}
        fallback={
          <div className="flex h-full items-center justify-center text-muted-foreground">
            <Loader2 className="h-6 w-6 animate-spin text-success" />
          </div>
        }
      >
        <ReviewActionView
          target={target}
          plan={
            target.planId
              ? // Detail where it is the plan already loaded, the summary otherwise: RetryPlan's
                // gate reads `state`, which both carry.
                ((plansState.selectedPlan?.id === target.planId
                  ? plansState.selectedPlan
                  : undefined) ?? plansState.plans.find((p) => p.id === target.planId))
              : undefined
          }
          jobs={jobsState.jobs}
          onClose={() => handleCloseReviewAction(session.id)}
          onJobStarted={(res) => handleSelectJob(res.jobId)}
        />
      </React.Suspense>
    );
  });

  // Render view depending on navigation/tab
  const renderActiveView = () => {
    if (activeNav.startsWith("plan-")) {
      const planId = activeNav.replace("plan-", "");
      const detail = plansState.selectedPlan?.id === planId ? plansState.selectedPlan : null;

      if (!detail) {
        return (
          <div className="flex h-64 items-center justify-center text-sm text-muted-foreground">
            Loading plan {planId}...
          </div>
        );
      }

      return (
        <PlanDetailView
          plan={detail}
          allPlans={plansState.plans}
          projectRepos={projects.find((p) => p.name === detail.project)?.repos ?? []}
          jobs={jobsState.jobs}
          onExecute={(id) => startJobAndOpenSession({ type: "ExecutePlan", folderPath: id })}
          // The dialogs dispatch their own jobs, so the shell's part is opening
          // the session tab for whatever they started.
          onJobStarted={(res) => handleSelectJob(res.jobId)}
          onPlanChanged={(id) => {
            plansStore.fetchPlans().catch(() => {});
            plansStore.fetchPlanDetail(id).catch(() => {});
          }}
          onPlanDeleted={() => {
            plansStore.fetchPlans().catch(() => {});
            // A plan is a page, not a tab, so there is nothing to close - just go back to Plans.
            uiStore.setActiveNav("plans");
          }}
          onBack={() => uiStore.setActiveNav("plans")}
        />
      );
    }

    if (activeNav.startsWith("job-")) {
      const jobId = activeNav.replace("job-", "");
      const summary = jobsState.jobs.find((j) => j.id === jobId);
      const detail = jobsState.jobDetails[jobId];
      // Detail wins where it exists: it is the only source of
      // reportedFailureReason, which the session view renders.
      const job = detail ??
        summary ?? {
          id: jobId,
          type: "Promptware Job",
          project: "Tendril",
          status: "Running" as const,
        };
      const events = jobsStore.getSessionEvents(jobId);

      // A job's output is a page here and a sheet in V1, so "close" goes back to the Jobs list
      // rather than removing a strip tab that no longer exists.
      return (
        <JobSessionView job={job} events={events} onCloseTab={() => uiStore.setActiveNav("jobs")} />
      );
    }

    switch (activeNav) {
      case "dashboard":
        return (
          <DashboardView
            plans={plansState.plans}
            jobs={jobsState.jobs}
            onSelectJob={handleSelectJob}
            onNavigate={(nav) => uiStore.setActiveNav(nav)}
            onNewPlan={() => {
              setNewPlanPrefill({});
              setIsNewPlanOpen(true);
            }}
          />
        );

      case "chat":
        return (
          <ChatView
            onCreatePlan={(initialDesc) => {
              setNewPlanPrefill({ description: initialDesc });
              setIsNewPlanOpen(true);
            }}
            onOpenPlan={handleSelectPlan}
          />
        );

      case "inbox":
        return (
          <InboxView
            projects={projects}
            onCreatePlan={(issue, project) => {
              setNewPlanPrefill({
                title: issue.title,
                description: `Task from GitHub Issue #${issue.number} (${issue.url}):\n\n${issue.body}`,
                sourceUrl: issue.url,
                project,
              });
              setIsNewPlanOpen(true);
            }}
            onOpenNewPlanModal={(prefill) => {
              setNewPlanPrefill(prefill);
              setIsNewPlanOpen(true);
            }}
          />
        );

      case "plans":
        return (
          <PlansView
            plans={plansState.plans}
            // `PlansApp.Build`'s `activePlanFolders`: a plan a job already holds is not offered for
            // action. Without the list the exclusion is dead wiring, as it was for Review.
            jobs={jobsState.jobs}
            // V1's `PlansAppArgs.PlanId`, now that a navigation carries args: the page reads its
            // selection from them instead of the publisher having to apply it as a side effect.
            selectedPlanId={uiState.pageArgs.planId ?? uiState.selectedPlanId}
            onSelectPlan={handleSelectPlan}
            onNewPlan={() => {
              setNewPlanPrefill({});
              setIsNewPlanOpen(true);
            }}
          />
        );

      case "review":
        return (
          <ReviewView
            plans={plansState.plans}
            // The review queue excludes plans a job still holds, as V1's `activePlanFolders` does.
            // Without the list the exclusion is dead wiring, and the page offers Complete Plan and
            // Create PR on work an agent has not finished — a retry that is only Queued or Blocked
            // still leaves its plan recorded in Review.
            jobs={jobsState.jobs}
            onSelectPlan={handleSelectPlan}
            onOpenReviewAction={handleOpenReviewAction}
            onJobStarted={(res) => handleSelectJob(res.jobId)}
            onPlanChanged={() => {
              plansStore.fetchPlans().catch(() => {});
            }}
          />
        );

      case "pull-requests":
        return (
          <PullRequestsView
            onSelectPlan={handleSelectPlan}
            onOpenNewPlanModal={(prefill) => {
              setNewPlanPrefill(prefill);
              setIsNewPlanOpen(true);
            }}
          />
        );

      case "recommendations":
        return (
          <RecommendationsView
            onSelectPlan={handleSelectPlan}
            onJobStarted={(res) => handleSelectJob(res.jobId)}
          />
        );

      case "icebox":
        return (
          <IceboxView
            plans={plansState.plans}
            onSelectPlan={handleSelectPlan}
            onNewPlan={() => {
              setNewPlanPrefill({});
              setIsNewPlanOpen(true);
            }}
          />
        );

      case "jobs":
        // V1's Jobs app composes exactly one thing, the `DataTable` from `JobsApp.DataTable.cs`, and
        // that table owns its own header actions (`Stop All Queued (n)`, `Stop All (n)`, the two
        // Clears and the status progress bar), its row menu and the output sheet it opens over
        // itself. So there is no page header here and no card grid: the view is the table.
        return (
          <JobsView
            jobs={jobsState.jobs}
            // For the `detached` flag, which only `GET /api/jobs/:id` reports.
            jobDetails={jobsState.jobDetails}
            isLoading={jobsState.isLoading}
            onSelectPlan={handleSelectPlan}
            // The two sweeps' confirms stay here: they are the only ones the shell itself owns, and
            // both dialogs are already mounted below.
            onStopAllQueued={() => setStopQueuedOpen(true)}
            onStopAll={() => setStopAllOpen(true)}
          />
        );

      case "settings":
        return (
          <SettingsView
            serviceInfo={serviceState.info}
            onRefreshHealth={async () => {
              await serviceStore.checkHealth();
            }}
          />
        );

      default:
        return (
          <DashboardView
            plans={plansState.plans}
            jobs={jobsState.jobs}
            onSelectJob={handleSelectJob}
            onNavigate={(nav) => uiStore.setActiveNav(nav)}
            onNewPlan={() => {
              setNewPlanPrefill({});
              setIsNewPlanOpen(true);
            }}
          />
        );
    }
  };

  // The wizard replaces the shell rather than overlaying it: on a fresh install there is nothing
  // behind it to look at, and the stores it would refetch have nothing to show yet.
  if (onboarding?.needed) {
    return (
      <OnboardingWizard
        status={onboarding}
        onFinished={() => {
          setOnboarding(null);
          bridge
            .listProjects()
            .then((list) => {
              setProjects(list);
              setProjectsLoaded(true);
            })
            .catch(() => {});
          plansStore.fetchPlans().catch(() => {});
          jobsStore.fetchJobs().catch(() => {});
        }}
      />
    );
  }

  return (
    <>
      <ShellLayout
        activeNav={activeNav}
        sessionTabs={uiState.sessionTabs.map((session) => ({
          ...session,
          // V1 `ResolveArgsTabTitle`: the tab names the action, not the app.
          title: reviewActionTargets[session.id]
            ? reviewActionTabTitle(reviewActionTargets[session.id])
            : session.title,
        }))}
        activeSessionId={uiState.activeSessionId}
        sessionContents={sessionPanes}
        pageNav={uiState.pageNav}
        serviceInfo={serviceState.info}
        connectionStatus={serviceState.status}
        reconnectCountdown={serviceState.reconnectCountdown}
        onSelectNav={(nav) => uiStore.setActiveNav(nav)}
        onSelectTab={(tab) => uiStore.setActiveNav(tab)}
        onCloseTab={(tab) => uiStore.closeTab(tab)}
        onShowPage={() => uiStore.showPage()}
        onNewPlan={() => {
          setNewPlanPrefill({});
          setIsNewPlanOpen(true);
        }}
        onOpenShortcuts={() => setIsShortcutsOpen(true)}
        onReconnect={() => serviceStore.checkHealth()}
        onRestartService={() => {
          setShellError(null);
          bridge
            .restartService()
            .then(() => serviceStore.checkHealth())
            .catch((err) => setShellError(`Restart service failed: ${describeBridgeError(err)}`));
        }}
        onRepairService={() => {
          setShellError(null);
          bridge
            .repairService()
            .then(() => serviceStore.checkHealth())
            .catch((err) => setShellError(`Repair service failed: ${describeBridgeError(err)}`));
        }}
        onViewDiagnostics={() => {
          uiStore.setActiveNav("settings");
        }}
        versionInfo={versionInfo}
        dismissedUpdateVersion={uiState.dismissedUpdateVersion}
        onDismissUpdate={(version) => uiStore.setDismissedUpdateVersion(version)}
        onCopyUpdateCommand={() => void navigator.clipboard.writeText(getUpdateCommand())}
        draftCount={draftCount}
        reviewCount={reviewCount}
        recommendationsCount={recommendationsCount}
        jobCount={jobCount}
        chatCount={chatSessionsCount}
        onCheckForUpdates={handleCheckForUpdates}
        sidebarList={sidebarList}
        onSelectSidebarItem={handleSelectSidebarItem}
        // V1's `showPlanSearchDialog`, which V2 does not have yet. Until it does, the section's
        // search goes to the Plans page, which is where plan search lives in V2 - the same place
        // Ctrl+K already went.
        onPlanSearch={() => uiStore.setActiveNav("plans")}
      >
        {/* V1's `RouteAction.Error` reaches `client.Error(...)`; here it shares the shell's own
            error banner, which is the only place the shell reports its own failures. */}
        {uiState.navError && (
          <div
            role="alert"
            data-testid="nav-error"
            className="mb-4 flex items-start justify-between gap-3 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive"
          >
            <span>{uiState.navError}</span>
            <button
              type="button"
              onClick={() => uiStore.clearNavError()}
              aria-label="Dismiss navigation error"
              className="text-destructive hover:text-destructive/80"
            >
              ✕
            </button>
          </div>
        )}
        {shellError && (
          <div
            role="alert"
            data-testid="shell-error"
            className="mb-4 flex items-start justify-between gap-3 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive"
          >
            <span>{shellError}</span>
            <button
              type="button"
              onClick={() => setShellError(null)}
              aria-label="Dismiss error"
              className="text-destructive hover:text-destructive/80"
            >
              ✕
            </button>
          </div>
        )}
        <React.Suspense
          fallback={
            <div
              className="flex h-64 items-center justify-center text-muted-foreground"
              data-testid="view-fallback-spinner"
            >
              <Loader2 className="h-6 w-6 animate-spin text-success" />
            </div>
          }
        >
          {renderActiveView()}
        </React.Suspense>
      </ShellLayout>

      {/* A plan needs a project. With none configured the new-plan flow explains
          that instead of offering an empty picker. Mounted only while it applies,
          so the lazy chunk is fetched at that moment and not before. */}
      {isNewPlanOpen && projectsLoaded && projects.length === 0 && (
        <React.Suspense fallback={null}>
          <NoProjectsDialog
            isOpen
            onClose={() => setIsNewPlanOpen(false)}
            onOpenSettings={() => {
              setIsNewPlanOpen(false);
              uiStore.setActiveNav("settings");
            }}
          />
        </React.Suspense>
      )}

      <NewPlanModal
        isOpen={isNewPlanOpen && !(projectsLoaded && projects.length === 0)}
        onClose={() => {
          setIsNewPlanOpen(false);
          setNewPlanPrefill({});
        }}
        projects={projects}
        initialTitle={newPlanPrefill.title}
        initialDescription={newPlanPrefill.description}
        initialSourceUrl={newPlanPrefill.sourceUrl}
        initialProject={newPlanPrefill.project}
        onJobStarted={(res) => {
          handleSelectJob(res.jobId);
        }}
        // V1's project picker always ends with "+ Add New Project", which navigates to Settings.
        // Without the handler the entry never renders, so a project the operator has not created yet
        // is a dead end in the one flow that needs one. Same route as the no-projects dialog above.
        onAddProject={() => {
          setIsNewPlanOpen(false);
          uiStore.setActiveNav("settings");
        }}
      />

      {/* The two job sweeps, with V1's copy verbatim (`JobsApp.DataTable`). Mounted only while open,
          so the dialog chunk is fetched at that moment. Both report how many they actually stopped:
          the count is re-snapshotted as jobs are cancelled, so it can differ from the label. */}
      {stopQueuedOpen && (
        <React.Suspense fallback={null}>
          <ConfirmDialog
            isOpen
            onClose={() => {
              setStopQueuedOpen(false);
              setStopError(null);
            }}
            title="Stop Queued Jobs"
            body={`Stop all ${jobsStore.queuedJobCount()} queued jobs? Running jobs are not affected.`}
            confirmLabel="Stop All"
            confirmVariant="destructive"
            isBusy={stopBusy}
            error={stopError}
            testId="stop-queued-dialog"
            onConfirm={async () => {
              setStopBusy(true);
              setStopError(null);
              try {
                const stopped = await jobsStore.stopQueuedJobs();
                const { toast } = await import("@ivy-interactive/components");
                toast({ title: "Jobs", description: `Stopped ${stopped} queued job(s).` });
                setStopQueuedOpen(false);
              } catch (err) {
                setStopError(describeBridgeError(err));
              } finally {
                setStopBusy(false);
              }
            }}
          />
        </React.Suspense>
      )}

      {stopAllOpen && (
        <React.Suspense fallback={null}>
          <ConfirmDialog
            isOpen
            onClose={() => {
              setStopAllOpen(false);
              setStopError(null);
            }}
            title="Stop All Jobs"
            body={`Stop all ${jobsStore.activeJobCount()} active job(s)? Running agents are killed and their plans revert to their previous state. This cannot be undone.`}
            confirmLabel="Stop All"
            confirmVariant="destructive"
            isBusy={stopBusy}
            error={stopError}
            testId="stop-all-dialog"
            onConfirm={async () => {
              setStopBusy(true);
              setStopError(null);
              try {
                const stopped = await jobsStore.stopAllJobs();
                const { toast } = await import("@ivy-interactive/components");
                toast({
                  title: "Jobs Stopped",
                  description: `Stopped ${stopped} job${stopped === 1 ? "" : "s"}`,
                });
                setStopAllOpen(false);
              } catch (err) {
                setStopError(describeBridgeError(err));
              } finally {
                setStopBusy(false);
              }
            }}
          />
        </React.Suspense>
      )}

      <KeyboardShortcutsHelp isOpen={isShortcutsOpen} onClose={() => setIsShortcutsOpen(false)} />

      <React.Suspense fallback={null}>
        <Toaster />
      </React.Suspense>
    </>
  );
};

export default App;
