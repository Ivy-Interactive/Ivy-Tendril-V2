import React, { useState, useEffect } from "react";
import { uiStore, type UiState } from "./state/uiStore";
import { plansStore } from "./state/plansStore";
import { jobsStore } from "./state/jobsStore";
import { serviceStore } from "./state/serviceStore";
import { bridge } from "./api/bridge";
import { onJobEvent, onPlanEvent, onServiceStatus } from "./api/events";
import { describeBridgeError, type ProjectSummary } from "./types/api";

import { ShellLayout } from "./views/ShellLayout";
import { DashboardView } from "./views/DashboardView";
import { PlansView } from "./views/PlansView";
import { PlanDetailView } from "./views/PlanDetailView";
import { JobSessionView } from "./views/JobSessionView";
import { ReviewView } from "./views/ReviewView";
import { SettingsView } from "./views/SettingsView";
import { ChatView } from "./views/ChatView";
import { InboxView } from "./views/InboxView";
import { NewPlanModal } from "./views/NewPlanModal";
import { KeyboardShortcutsHelp } from "./components/KeyboardShortcutsHelp";

export const App: React.FC = () => {
  const [uiState, setUiState] = useState<UiState>(uiStore.getState());
  const [plansState, setPlansState] = useState(plansStore.getState());
  const [jobsState, setJobsState] = useState(jobsStore.getState());
  const [serviceState, setServiceState] = useState(serviceStore.getState());

  const [projects, setProjects] = useState<ProjectSummary[]>([]);
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

  // Subscribe to stores
  useEffect(() => {
    const unsubUi = uiStore.subscribe(() => setUiState({ ...uiStore.getState() }));
    const unsubPlans = plansStore.subscribe(() => setPlansState({ ...plansStore.getState() }));
    const unsubJobs = jobsStore.subscribe(() => setJobsState({ ...jobsStore.getState() }));
    const unsubService = serviceStore.subscribe(() => setServiceState({ ...serviceStore.getState() }));

    uiStore.init();
    serviceStore.refreshInfo().catch(() => {});
    plansStore.fetchPlans().catch(() => {});
    jobsStore.fetchJobs().catch(() => {});

    bridge.listProjects().then(setProjects).catch(() => {});

    return () => {
      unsubUi();
      unsubPlans();
      unsubJobs();
      unsubService();
    };
  }, []);

  // Subscribe to realtime daemon events
  useEffect(() => {
    let unsubStatus: (() => void) | undefined;
    let unsubJob: (() => void) | undefined;
    let unsubPlan: (() => void) | undefined;

    onServiceStatus((st) => {
      serviceStore.setStatus(st === "connected" ? "online" : st === "reconnecting" ? "reconnecting" : "offline");
    }).then((unsub) => (unsubStatus = unsub)).catch(() => {});

    onJobEvent((payload) => {
      const item = payload as Record<string, unknown>;
      const jobId = (item.jobId as string) || (item.id as string) || "live-job";
      jobsStore.addStreamEvent(jobId, payload);
    }).then((unsub) => (unsubJob = unsub)).catch(() => {});

    onPlanEvent((_payload) => {
      plansStore.fetchPlans().catch(() => {});
    }).then((unsub) => (unsubPlan = unsub)).catch(() => {});

    return () => {
      if (unsubStatus) unsubStatus();
      if (unsubJob) unsubJob();
      if (unsubPlan) unsubPlan();
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
      } else if (e.key === "?" && !["INPUT", "TEXTAREA"].includes((e.target as HTMLElement).tagName)) {
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
  const startJobAndOpenSession = async (
    args: Parameters<typeof bridge.startJob>[0]
  ) => {
    const res = await bridge.startJob(args);
    handleSelectJob(res.jobId);
  };

  const activeNav = uiState.activeNav;

  // Render view depending on navigation/tab
  const renderActiveView = () => {
    if (activeNav.startsWith("plan-")) {
      const planId = activeNav.replace("plan-", "");
      const detail =
        plansState.selectedPlan?.id === planId
          ? plansState.selectedPlan
          : null;

      if (!detail) {
        return (
          <div className="flex h-64 items-center justify-center text-sm text-slate-400">
            Loading plan {planId}...
          </div>
        );
      }

      return (
        <PlanDetailView
          plan={detail}
          allPlans={plansState.plans}
          onExecute={(id) =>
            startJobAndOpenSession({ type: "ExecutePlan", folderPath: id })
          }
          onRetry={(id) =>
            startJobAndOpenSession({
              type: "RetryPlan",
              folderPath: id,
              changeRequest: "Please resolve failing issues.",
            })
          }
          onCreatePr={(id) =>
            startJobAndOpenSession({ type: "CreatePr", folderPath: id })
          }
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
        <JobSessionView
          job={job}
          events={events}
          onCloseTab={() => uiStore.closeTab(activeNav)}
        />
      );
    }

    switch (activeNav) {
      case "dashboard":
        return (
          <DashboardView
            plans={plansState.plans}
            jobs={jobsState.jobs}
            onSelectPlan={handleSelectPlan}
            onSelectJob={handleSelectJob}
          />
        );

      case "chat":
        return (
          <ChatView
            onCreatePlan={(initialDesc) => {
              setNewPlanPrefill({ description: initialDesc });
              setIsNewPlanOpen(true);
            }}
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
            onCreatePr={(id) =>
              startJobAndOpenSession({ type: "CreatePr", folderPath: id })
            }
            onRetry={(id, feedback) =>
              startJobAndOpenSession({
                type: "RetryPlan",
                folderPath: id,
                changeRequest: feedback,
              })
            }
          />
        );

      case "jobs":
        return (
          <div className="space-y-4">
            <h1 className="text-2xl font-bold text-slate-100">Jobs Activity</h1>
            <div className="grid gap-3">
              {jobsState.jobs.map((j) => (
                <div
                  key={j.id}
                  onClick={() => handleSelectJob(j.id)}
                  className="cursor-pointer rounded-xl border border-slate-800 bg-slate-900/60 p-4 transition hover:border-slate-700"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-xs text-slate-400">{j.id}</span>
                    <span className="rounded bg-slate-800 px-2 py-0.5 text-xs text-slate-300">
                      {j.status}
                    </span>
                  </div>
                  <h3 className="mt-1 text-sm font-semibold text-slate-100">{j.type}</h3>
                  <p className="text-xs text-slate-400">{j.planTitle || j.project}</p>
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
            onSelectPlan={handleSelectPlan}
            onSelectJob={handleSelectJob}
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
            .catch((err) =>
              setShellError(
                `Restart service failed: ${describeBridgeError(err)}`
              )
            );
        }}
        onRepairService={() => {
          setShellError(null);
          bridge
            .repairService()
            .then(() => serviceStore.checkHealth())
            .catch((err) =>
              setShellError(`Repair service failed: ${describeBridgeError(err)}`)
            );
        }}
        onViewDiagnostics={() => {
          uiStore.setActiveNav("settings");
        }}
      >
        {shellError && (
          <div
            role="alert"
            data-testid="shell-error"
            className="mb-4 flex items-start justify-between gap-3 rounded-lg border border-red-800 bg-red-950/40 p-3 text-xs text-red-300"
          >
            <span>{shellError}</span>
            <button
              type="button"
              onClick={() => setShellError(null)}
              aria-label="Dismiss error"
              className="text-red-400 hover:text-red-200"
            >
              ✕
            </button>
          </div>
        )}
        {renderActiveView()}
      </ShellLayout>

      <NewPlanModal
        isOpen={isNewPlanOpen}
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

      <KeyboardShortcutsHelp
        isOpen={isShortcutsOpen}
        onClose={() => setIsShortcutsOpen(false)}
      />
    </>
  );
};

export default App;
