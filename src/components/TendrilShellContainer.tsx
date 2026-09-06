import React, { useState, useEffect, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import { QueryClientProvider, useQuery } from "@tanstack/react-query";
import {
  TendrilShell,
  ShellSidebarHeader,
  ShellNav,
  type ShellNavItemDto,
} from "components-storybook/tendril";
import "components-storybook/style.css";
import type { DaemonStatusResponse } from "@/api/dtos";
import { TendrilApiClient } from "@/api/client";
import { TendrilRealtimeClient, type ConnectionState } from "@/api/realtime";
import {
  createTendrilQueryClient,
  bindRealtimeToQueryClient,
  getPollingInterval,
} from "@/api/queryClient";

export interface TendrilAppProps {
  initialStatus?: DaemonStatusResponse;
}

export const TendrilApp: React.FC<TendrilAppProps> = ({ initialStatus }) => {
  const [daemonStatus, setDaemonStatus] = useState<DaemonStatusResponse | null>(
    initialStatus || null
  );
  const [loading, setLoading] = useState(!initialStatus);
  const [wsState, setWsState] = useState<ConnectionState>("disconnected");
  const [activeTab, setActiveTab] = useState<string>("plans");

  const queryClient = useMemo(() => createTendrilQueryClient(), []);

  // Fetch daemon status from Tauri command or fallback
  useEffect(() => {
    if (initialStatus) return;

    let isMounted = true;
    async function checkDaemon() {
      try {
        const res = await invoke<DaemonStatusResponse>("get_daemon_status");
        if (isMounted) {
          setDaemonStatus(res);
          setLoading(false);
        }
      } catch (err) {
        if (isMounted) {
          setDaemonStatus({
            state: "NotRunning",
            tendrilHome: "~/.tendril",
            capabilities: [],
            message: `Daemon check error: ${err instanceof Error ? err.message : String(err)}`,
          });
          setLoading(false);
        }
      }
    }

    checkDaemon();
    return () => {
      isMounted = false;
    };
  }, [initialStatus]);

  // Realtime client lifecycle
  const realtimeClient = useMemo(() => {
    if (daemonStatus?.state !== "Connected" || !daemonStatus.port) {
      return null;
    }
    return new TendrilRealtimeClient({
      host: daemonStatus.host || "127.0.0.1",
      port: daemonStatus.port,
      scheme: daemonStatus.scheme || "http",
      secret: daemonStatus.secret,
      autoConnect: true,
    });
  }, [daemonStatus]);

  // REST API client
  const apiClient = useMemo(() => {
    if (daemonStatus?.state !== "Connected" || !daemonStatus.port) {
      return null;
    }
    const scheme = daemonStatus.scheme || "http";
    const host = daemonStatus.host || "127.0.0.1";
    return new TendrilApiClient({
      baseUrl: `${scheme}://${host}:${daemonStatus.port}`,
      secret: daemonStatus.secret,
    });
  }, [daemonStatus]);

  useEffect(() => {
    if (!realtimeClient) return;

    const unsubState = realtimeClient.onStateChange(setWsState);
    const unbindQuery = bindRealtimeToQueryClient(queryClient, realtimeClient);

    return () => {
      unsubState();
      unbindQuery();
      realtimeClient.disconnect();
    };
  }, [realtimeClient, queryClient]);

  // 1. Discovering / Loading state
  if (loading) {
    return (
      <div
        data-testid="discovering-state"
        className="flex h-screen w-screen flex-col items-center justify-center bg-slate-950 text-slate-100"
      >
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-emerald-500 border-t-transparent" />
        <p className="mt-4 text-sm text-slate-400">Discovering Tendril daemon...</p>
      </div>
    );
  }

  // 2. Auth error state
  if (daemonStatus?.state === "Unauthenticated") {
    return (
      <div
        data-testid="auth-error-state"
        className="flex h-screen w-screen flex-col items-center justify-center bg-slate-950 p-6 text-slate-100"
      >
        <div className="max-w-md rounded-xl border border-red-800 bg-red-950/40 p-6 text-center">
          <h2 className="text-lg font-semibold text-red-400">Authentication Failed</h2>
          <p className="mt-2 text-sm text-slate-300">
            The daemon rejected the security token in your local master configuration.
          </p>
          <div className="mt-4 rounded bg-slate-900 p-3 font-mono text-xs text-slate-400 text-left">
            Path: {daemonStatus.tendrilHome}/.master
          </div>
          <button
            onClick={() => window.location.reload()}
            className="mt-5 rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-500"
          >
            Retry Connection
          </button>
        </div>
      </div>
    );
  }

  // 3. DaemonNotFound / Onboarding state
  if (daemonStatus?.state === "NotRunning" || daemonStatus?.state === "Disconnected") {
    return (
      <div
        data-testid="onboarding-state"
        className="flex h-screen w-screen flex-col items-center justify-center bg-slate-950 p-6 text-slate-100"
      >
        <div className="max-w-lg rounded-xl border border-slate-800 bg-slate-900/60 p-8 shadow-2xl backdrop-blur">
          <div className="flex items-center space-x-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-950 text-emerald-400 border border-emerald-800">
              ⚡
            </div>
            <div>
              <h2 className="text-lg font-semibold text-slate-100">Tendril Service Not Detected</h2>
              <p className="text-xs text-slate-400">Desktop daemon connection required</p>
            </div>
          </div>

          <p className="mt-4 text-sm leading-relaxed text-slate-300">
            Tendril Desktop requires the background engine to be running. No active daemon metadata
            was found at:
          </p>
          <pre className="mt-2 overflow-x-auto rounded bg-slate-950 p-3 font-mono text-xs text-emerald-400">
            {daemonStatus?.tendrilHome}
          </pre>

          <div className="mt-5 space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">Quick Start:</p>
            <div className="rounded bg-slate-950/80 p-3 font-mono text-xs text-slate-300 border border-slate-800">
              tendril serve
            </div>
          </div>

          <p className="mt-3 text-xs text-slate-500">{daemonStatus?.message}</p>

          <div className="mt-6 flex justify-end space-x-3">
            <button
              onClick={() => window.location.reload()}
              className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-emerald-500"
            >
              Check Again
            </button>
          </div>
        </div>
      </div>
    );
  }

  const noopEventHandler = () => {};

  // 4. Connected State with TendrilShell
  const navItems: ShellNavItemDto[] = [
    { id: "plans", label: "Plans", icon: "Feather", isActive: activeTab === "plans" },
    { id: "review", label: "Review", icon: "ThumbsUp", isActive: activeTab === "review" },
    { id: "jobs", label: "Jobs", icon: "Activity", isActive: activeTab === "jobs" },
    { id: "insights", label: "Insights", icon: "ChartBar", isActive: activeTab === "insights" },
  ];

  return (
    <QueryClientProvider client={queryClient}>
      <div data-testid="connected-state" className="h-screen w-screen flex flex-col overflow-hidden bg-slate-950">
        {/* Reconnection status banner */}
        {wsState === "reconnecting" && (
          <div
            data-testid="reconnecting-banner"
            className="flex items-center justify-between bg-amber-500/20 px-4 py-1.5 text-xs text-amber-200 border-b border-amber-500/30"
          >
            <span>Connecting to realtime daemon stream... (falling back to auto-polling)</span>
            <span className="font-mono text-amber-300 animate-pulse">● reconnecting</span>
          </div>
        )}

        <div className="flex-1 overflow-hidden">
          <TendrilShell
            id="tendril-shell"
            eventHandler={noopEventHandler}
            slots={{
              SidebarHeader: (
                <ShellSidebarHeader
                  id="sidebar-header"
                  eventHandler={noopEventHandler}
                  title="Tendril Desktop"
                  version={daemonStatus?.apiVersion ? `v${daemonStatus.apiVersion}` : "0.1.0"}
                />
              ),
              SidebarBody: (
                <ShellNav
                  id="sidebar-nav"
                  items={navItems}
                  events={["OnSelect"]}
                  eventHandler={(_evt, _id, args) => {
                    if (args && args[0]) {
                      setActiveTab(String(args[0]));
                    }
                  }}
                />
              ),
              Content: (
                <div className="p-6 h-full overflow-y-auto">
                  <DashboardView
                    activeTab={activeTab}
                    apiClient={apiClient}
                    isWsConnected={wsState === "connected"}
                  />
                </div>
              ),
            }}
          />
        </div>
      </div>
    </QueryClientProvider>
  );
};

interface DashboardViewProps {
  activeTab: string;
  apiClient: TendrilApiClient | null;
  isWsConnected: boolean;
}

const DashboardView: React.FC<DashboardViewProps> = ({
  activeTab,
  apiClient,
  isWsConnected,
}) => {
  const pollingInterval = getPollingInterval(isWsConnected, "plans");

  const { data: plans, isLoading } = useQuery({
    queryKey: ["plans"],
    queryFn: () => (apiClient ? apiClient.listPlans() : Promise.resolve([])),
    enabled: !!apiClient,
    refetchInterval: pollingInterval,
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight text-slate-100 capitalize">
          {activeTab}
        </h1>
        <div className="flex items-center space-x-2 text-xs text-slate-400">
          <span
            className={`inline-block h-2 w-2 rounded-full ${
              isWsConnected ? "bg-emerald-400" : "bg-amber-400 animate-pulse"
            }`}
          />
          <span>{isWsConnected ? "Realtime WS active" : "Auto-polling fallback active"}</span>
        </div>
      </div>

      {isLoading ? (
        <div className="py-8 text-center text-sm text-slate-500">Loading {activeTab}...</div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {plans && plans.length > 0 ? (
            plans.map((p) => (
              <div
                key={p.id}
                className="rounded-lg border border-slate-800 bg-slate-900/50 p-4 transition hover:border-slate-700"
              >
                <div className="flex items-center justify-between">
                  <span className="font-mono text-xs text-slate-400">{p.id}</span>
                  <span className="rounded bg-slate-800 px-2 py-0.5 text-xs text-slate-300">
                    {p.state}
                  </span>
                </div>
                <h3 className="mt-2 font-medium text-slate-100 line-clamp-1">{p.title}</h3>
                <p className="mt-1 text-xs text-slate-400">{p.project}</p>
              </div>
            ))
          ) : (
            <div className="col-span-full rounded-lg border border-dashed border-slate-800 p-8 text-center text-sm text-slate-500">
              No items in {activeTab}.
            </div>
          )}
        </div>
      )}
    </div>
  );
};
