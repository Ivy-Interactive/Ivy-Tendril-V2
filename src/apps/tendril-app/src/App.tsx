import React, { useState, useEffect } from "react";
import { uiStore, type UiState } from "./state/uiStore";
import { plansStore } from "./state/plansStore";
import { jobsStore } from "./state/jobsStore";
import { serviceStore } from "./state/serviceStore";
import { bridge } from "./api/bridge";
import {
  onChangeEvent,
  onChangeStreamStatus,
  onJobEvent,
  onPlanEvent,
  onServiceStatus,
} from "./api/events";
import { applyChangeEvent } from "./api/changes";
import { describeBridgeError, type ProjectSummary, type VersionInfo } from "./types/api";
import { getUpdateCommand } from "./utils/updateCommand";

import { Loader2 } from "lucide-react";
import { ShellLayout } from "./views/ShellLayout";
import { NewPlanModal } from "./views/NewPlanModal";
import { KeyboardShortcutsHelp } from "./components/KeyboardShortcutsHelp";

// Lazy, and by module rather than through the `./views/dialogs` barrel. App.tsx
// is the one eager module in the shell — every view below it is lazy — and the
// dialog family pulls in `@ivy-interactive/components/ui`, a ~190 kB entry point
// nothing else here needs. Loading it eagerly for a dialog that only appears
// when no project is configured put the entry chunk over its size budget.
const NoProjectsDialog = React.lazy(() =>
  import("./views/dialogs/NoProjectsDialog").then((m) => ({ default: m.NoProjectsDialog })),
);

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
  const [newPlanPrefill, setNewPlanPrefill] = useState<{
    title?: string;
    description?: string;
    sourceUrl?: string;
    project?: string;
  }>({});
  const [isShortcutsOpen, setIsShortcutsOpen] = useState(false);
  // Failures from actions the shell itself owns (service restart/repair).
  const [shellError, setShellError] = useState<string | null>(null);
  const [versionInfo, setVersionInfo] = useState<VersionInfo | null>(null);

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

    return () => {
      if (unsubStatus) unsubStatus();
      if (unsubJob) unsubJob();
      if (unsubPlan) unsubPlan();
      if (unsubChange) unsubChange();
      if (unsubChangeStatus) unsubChangeStatus();
    };
  }, []);

  // Global Keyboard Shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isCmdOrCtrl = e.metaKey || e.ctrlKey;

      if (isCmdOrCtrl && e.shiftKey && e.key.toLowerCase() === "c") {
        e.preventDefault();
        uiStore.setActiveNav("chat");
      } else if (isCmdOrCtrl && e.key.toLowerCase() === "b") {
        e.preventDefault();
        uiStore.toggleSidebar();
      } else if (isCmdOrCtrl && e.key.toLowerCase() === "i") {
        e.preventDefault();
        uiStore.setActiveNav("inbox");
      } else if (isCmdOrCtrl && e.key.toLowerCase() === "n") {
        e.preventDefault();
        setNewPlanPrefill({});
        setIsNewPlanOpen(true);
      } else if (isCmdOrCtrl && e.key.toLowerCase() === "k") {
        e.preventDefault();
        uiStore.setActiveNav("plans");
      } else if (
        e.key === "?" &&
        !["INPUT", "TEXTAREA"].includes((e.target as HTMLElement).tagName)
      ) {
        e.preventDefault();
        setIsShortcutsOpen(true);
      } else if (e.key === "Escape") {
        setIsNewPlanOpen(false);
        setIsShortcutsOpen(false);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  // Handle plan selection (fetches plan detail and opens tab)
  const handleSelectPlan = async (planId: string) => {
    uiStore.setSelectedPlanId(planId);
    uiStore.setActiveNav(`plan-${planId}`);
    try {
      await plansStore.fetchPlanDetail(planId);
    } catch {
      // Handled in store
    }
  };

  const handleSelectJob = (jobId: string) => {
    uiStore.openTab(`job-${jobId}`);
    uiStore.setActiveNav(`job-${jobId}`);
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

  const activeNav = uiState.activeNav;

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
            uiStore.closeTab(activeNav);
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

      return (
        <JobSessionView job={job} events={events} onCloseTab={() => uiStore.closeTab(activeNav)} />
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
            onSelectPlan={handleSelectPlan}
            onJobStarted={(res) => handleSelectJob(res.jobId)}
            onPlanChanged={() => {
              plansStore.fetchPlans().catch(() => {});
            }}
          />
        );

      case "jobs":
        return (
          <div className="space-y-4">
            <h1 className="text-2xl font-bold text-foreground">Jobs Activity</h1>
            <div className="grid gap-3">
              {jobsState.jobs.map((j) => (
                <div
                  key={j.id}
                  onClick={() => handleSelectJob(j.id)}
                  className="cursor-pointer rounded-xl border border-border bg-card/60 p-4 transition hover:border-ring"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-xs text-muted-foreground">{j.id}</span>
                    <span className="rounded bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                      {j.status}
                    </span>
                  </div>
                  <h3 className="mt-1 text-sm font-semibold text-foreground">{j.type}</h3>
                  <p className="text-xs text-muted-foreground">{j.planTitle || j.project}</p>
                </div>
              ))}
            </div>
          </div>
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

  return (
    <>
      <ShellLayout
        activeNav={activeNav}
        activeTabs={uiState.activeTabIds}
        serviceInfo={serviceState.info}
        connectionStatus={serviceState.status}
        reconnectCountdown={serviceState.reconnectCountdown}
        onSelectNav={(nav) => uiStore.setActiveNav(nav)}
        onSelectTab={(tab) => uiStore.setActiveNav(tab)}
        onCloseTab={(tab) => uiStore.closeTab(tab)}
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
      >
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
      />

      <KeyboardShortcutsHelp isOpen={isShortcutsOpen} onClose={() => setIsShortcutsOpen(false)} />
    </>
  );
};

export default App;
