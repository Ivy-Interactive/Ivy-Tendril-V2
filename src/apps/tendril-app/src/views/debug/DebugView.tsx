import * as React from "react";
import { Button } from "@ivy-interactive/components/ui";
import { notificationsStore, shouldShowInAppToast } from "../../state/notificationsStore";
// The same runtime gate the notifications store and `api/bridge.ts` use. Imported rather than
// re-derived, and the store's own copy is module-private, so this is the public one.
import { isTauri } from "../../utils/tauri";

/**
 * The debug page: a notifications bench.
 *
 * V1's `Apps/Debug/DialogsApp.cs` was a dialog harness. The dialogs now live in Storybook, where a
 * story is both the thing you look at and the thing CI renders, so this page keeps only the part
 * Storybook cannot do: **firing a real notification through the real routing**.
 *
 * That routing is the reason a bench is worth having. `deliver` picks between an OS notification
 * and an in-app toast using two inputs that are both awkward to reach any other way - whether this
 * is the desktop shell, and whether the operator has desktop notifications on - and then falls back
 * to a toast if the OS refuses. In a browser it is always a toast; in the desktop app with the
 * setting on it is an OS notification, unless permission was denied, in which case it is a toast
 * again. Four paths, one of which only appears after an OS-level refusal.
 *
 * `notifyJobExit` additionally goes through the burst summarizer, so a wave of jobs exiting
 * together is one notification rather than one per job. Firing five at once is the only convenient
 * way to see that happen.
 */
export function DebugView() {
  const [tick, setTick] = React.useState(0);

  const desktopEnabled = notificationsStore.isDesktopNotificationsEnabled();
  const isDesktop = isTauri();
  const routesToToast = shouldShowInAppToast(isDesktop, desktopEnabled);

  // The store holds the setting, and nothing publishes a change - so a read after any action here
  // needs a nudge to re-render. Cheaper than making the store observable for one debug page.
  const refresh = () => setTick((n) => n + 1);

  return (
    <div data-testid="debug-view" className="space-y-6">
      <header className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold text-foreground">Notifications</h2>
        <p className="text-sm text-muted-foreground">
          Fire a notification through the real routing. Dialogs and sheets live in Storybook.
        </p>
      </header>

      <section className="rounded-box border border-border p-4" data-testid="debug-routing">
        <h3 className="mb-2 text-sm font-semibold text-foreground">Where a notification goes</h3>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs">
          <dt className="text-muted-foreground">Shell</dt>
          <dd className="font-mono text-foreground" data-testid="debug-shell">
            {isDesktop ? "desktop" : "browser"}
          </dd>
          <dt className="text-muted-foreground">Desktop notifications</dt>
          <dd className="font-mono text-foreground" data-testid="debug-setting">
            {desktopEnabled ? "on" : "off"}
          </dd>
          <dt className="text-muted-foreground">Routes to</dt>
          <dd className="font-mono text-foreground" data-testid="debug-route">
            {routesToToast ? "in-app toast" : "OS notification (toast if refused)"}
          </dd>
        </dl>
        <p className="mt-3 text-xs text-muted-foreground">
          The setting is read at notification time, so changing it in Settings takes effect without
          a reload. This page reads the same value the router does.
        </p>
      </section>

      <section className="flex flex-col gap-3">
        <h3 className="text-sm font-semibold text-foreground">Fire one</h3>

        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            data-testid="debug-notify-success"
            onClick={() => {
              notificationsStore.notifySuccess("Saved", "Notification settings saved");
              refresh();
            }}
          >
            Success toast
          </Button>

          <Button
            variant="outline"
            data-testid="debug-notify-error"
            onClick={() => {
              notificationsStore.notifyError("Plan 00412 is held by a running job (#1184)");
              refresh();
            }}
          >
            Error toast
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          These two are always in-app and never coalesced: they confirm or refuse an action the
          operator just took, so they belong next to the app rather than in Notification Center.
        </p>

        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            data-testid="debug-notify-job-exit"
            onClick={() => {
              notificationsStore.notifyJobExit({
                title: "ExecutePlan finished",
                message: "00412 Port the dialog stories",
                isSuccess: true,
              });
              refresh();
            }}
          >
            One job exit
          </Button>

          <Button
            variant="outline"
            data-testid="debug-notify-job-failure"
            onClick={() => {
              notificationsStore.notifyJobExit({
                title: "ExecutePlan failed",
                message: "00412 RustClippy denied 2 warnings",
                isSuccess: false,
              });
              refresh();
            }}
          >
            One job failure
          </Button>

          <Button
            variant="outline"
            data-testid="debug-notify-burst"
            onClick={() => {
              for (let i = 1; i <= 5; i += 1) {
                notificationsStore.notifyJobExit({
                  title: "ExecutePlan finished",
                  message: `0041${i} Plan number ${i}`,
                  isSuccess: i !== 3,
                });
              }
              refresh();
            }}
          >
            Burst of five
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Job exits go through the burst summarizer. Five at once should arrive as one summary, not
          five notifications — the window opens at the first, so a quiet shell pays nothing.
        </p>
      </section>

      <span className="hidden" data-testid="debug-tick">
        {tick}
      </span>
    </div>
  );
}
