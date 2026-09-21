import {
  NoProjectsDialog,
  PlanSearchDialog,
  ShareTunnelDialog,
  AutoAcceptSettingsDialog,
  type ShareTunnelSnapshot,
} from "../../dialogs";
import { defineSurface } from "./types";
import { summary } from "./models";

const noop = () => {};

/** A share tunnel in a fixed state. The dialog polls `getStatus`, so a scenario is a snapshot. */
function tunnel(overrides: Partial<ShareTunnelSnapshot> = {}): ShareTunnelSnapshot {
  return {
    kind: "share",
    status: "disabled",
    installed: true,
    sharePort: 5010,
    ...overrides,
  } as ShareTunnelSnapshot;
}

/** A frozen `ShareTunnelApi`: start and stop return the same snapshot the dialog opened on. */
function tunnelApiFor(snapshot: ShareTunnelSnapshot) {
  return {
    getStatus: () => Promise.resolve(snapshot),
    start: () => Promise.resolve(snapshot),
    stop: () => Promise.resolve(snapshot),
  };
}

/**
 * The dialogs the shell owns rather than a plan view.
 *
 * Two of these reach the daemon as they open, and both already take an injection seam for it -
 * `PlanSearchDialog.search` and `ShareTunnelDialog.api`. The scenarios use those seams rather than
 * a module mock, which is what lets the same catalog drive the harness in the *running app*: a
 * mocked module would be a test-only construct, while a supplied `api` is just a prop.
 *
 * `AutoAcceptSettingsDialog` has no such seam - it calls `bridge.getConfig` directly on open - so
 * its scenarios cover only what renders before that resolves, and the contract runner stubs the
 * bridge. Giving it a seam would be a change to a dialog this task does not own.
 */

export const noProjectsSurface = defineSurface("NoProjectsDialog", "dialog", NoProjectsDialog, [
  {
    title: "No project configured",
    hint: "The empty state for the new-plan flow. There is no `projects` nav id, so it points at Settings and the copy names the Projects section within it.",
    props: { onOpenSettings: noop },
    expectText: ["Settings"],
  },
  {
    title: "Opened from the plans list",
    hint: "Same dialog, reached from the sidebar's new-plan button rather than the modal. Identical by design — worth seeing that it is.",
    props: { onOpenSettings: noop },
    expectText: ["Settings"],
  },
  {
    title: "Settings navigation wired",
    hint: "The one action it offers. The harness proves the button is reachable and focusable before anything is wired behind it.",
    props: { onOpenSettings: noop },
    expectText: ["Settings"],
  },
]);

export const planSearchSurface = defineSurface("PlanSearchDialog", "dialog", PlanSearchDialog, [
  {
    title: "Empty query",
    hint: "The state the dialog opens in, before anything is typed.",
    props: {
      onSelectPlan: noop,
      search: () => Promise.resolve([]),
    },
  },
  {
    title: "No results",
    hint: "A query that matches nothing. The empty state must read as 'nothing matched', not as 'still loading'.",
    props: {
      onSelectPlan: noop,
      search: () => Promise.resolve([]),
    },
  },
  {
    title: "A few results",
    hint: "Three rows: the ordinary case, and where the row layout is judged.",
    props: {
      onSelectPlan: noop,
      search: () =>
        Promise.resolve([
          summary({ id: "00412", title: "Port the dialog debug harness" }),
          summary({ id: "00413", title: "Scenario catalogs for every dialog", state: "Executing" }),
          summary({ id: "00414", title: "Contract runner", state: "Review" }),
        ]),
    },
  },
  {
    title: "Many results",
    hint: "Twenty rows against the result cap, so the list scrolls and the cap is visible.",
    props: {
      onSelectPlan: noop,
      search: () =>
        Promise.resolve(
          Array.from({ length: 20 }, (_, i) =>
            summary({
              id: String(400 + i).padStart(5, "0"),
              title: `Plan number ${i + 1} in a long result set`,
            }),
          ),
        ),
    },
  },
  {
    title: "Search rejects",
    hint: "The FTS5 index is unavailable or the daemon is down. A rejected search must not leave a spinner running forever.",
    props: {
      onSelectPlan: noop,
      search: () => Promise.reject(new Error("search index unavailable")),
    },
  },
  {
    title: "Search never settles",
    hint: "A pending promise: the loading state on its own, which no other scenario holds still long enough to look at.",
    props: {
      onSelectPlan: noop,
      search: () => new Promise<never>(() => {}),
    },
  },
]);

export const shareTunnelSurface = defineSurface("ShareTunnelDialog", "dialog", ShareTunnelDialog, [
  {
    title: "Disabled",
    hint: "No tunnel yet. The dialog offers to start one, and `shareUrlForPlan` returns the relative path so a link can still be rendered.",
    props: {
      planId: "00412",
      api: tunnelApiFor(tunnel({ status: "disabled" })),
    },
  },
  {
    title: "Connecting",
    hint: "Cloudflared is starting. V1 gets pushed `StatusChanged`; V2 polls every 2s, so this state is held rather than passed through.",
    props: {
      planId: "00412",
      api: tunnelApiFor(tunnel({ status: "connecting" })),
    },
  },
  {
    title: "Connected · plan link",
    hint: "The whole point: a full URL carrying `?share=1` and the capability token, because an anonymous visitor has no bearer credential.",
    props: {
      planId: "00412",
      api: tunnelApiFor(
        tunnel({
          status: "connected",
          url: "https://mellow-bird-1234.trycloudflare.com",
          shareToken: "3f9a2c",
        }),
      ),
    },
  },
  {
    title: "Connected · review link",
    hint: "`isReview` switches the path from /plans to /review. Same tunnel, different destination.",
    props: {
      planId: "00412",
      isReview: true,
      api: tunnelApiFor(
        tunnel({
          status: "connected",
          url: "https://mellow-bird-1234.trycloudflare.com",
          shareToken: "3f9a2c",
        }),
      ),
    },
  },
  {
    title: "Connected · no plan",
    hint: "Without a `planId` the dialog shares the tunnel root rather than deep-linking.",
    props: {
      api: tunnelApiFor(
        tunnel({
          status: "connected",
          url: "https://mellow-bird-1234.trycloudflare.com",
          shareToken: "3f9a2c",
        }),
      ),
    },
  },
  {
    title: "Cloudflared not installed",
    hint: "`installed: false` is the one state the operator has to act on outside Tendril.",
    props: {
      planId: "00412",
      api: tunnelApiFor(tunnel({ status: "disabled", installed: false })),
    },
  },
  {
    title: "Start failed",
    hint: "An error carried on the snapshot rather than thrown, which is how the daemon reports a tunnel that would not come up.",
    props: {
      planId: "00412",
      api: tunnelApiFor(
        tunnel({ status: "disabled", error: "cloudflared exited with code 1: no route to host" }),
      ),
    },
  },
]);

export const autoAcceptSurface = defineSurface(
  "AutoAcceptSettingsDialog",
  "dialog",
  AutoAcceptSettingsDialog,
  [
    {
      title: "Default interval",
      hint: "What `Inbox.CheckIntervalMinutes` falls back to when the config has never carried one: 15.",
      props: { onSaved: noop, onChecked: noop },
    },
    {
      title: "Saved callback wired",
      hint: "V1's `refreshToken.Refresh()` — the Auto-Accept badge reads the setting this dialog writes, so the caller has to be told.",
      props: { onSaved: noop },
    },
    {
      title: "Checked callback wired",
      hint: "V1's `onRefresh`: a manual check imports issues, so the list behind the dialog is now stale.",
      props: { onChecked: noop },
    },
    {
      title: "No callbacks",
      hint: "Both are optional. A caller that wants neither must not break the dialog.",
      props: {},
    },
    {
      title: "Saved only",
      hint: "The asymmetric case, where the setting is written but no manual check is offered.",
      props: { onSaved: noop },
    },
    {
      title: "Checked only",
      hint: "The other asymmetric case.",
      props: { onChecked: noop },
    },
  ],
);
