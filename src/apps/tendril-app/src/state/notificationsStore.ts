import { bridge } from "../api/bridge";
import {
  NotificationBurstSummarizer,
  type JobNotification,
} from "./notificationBurst";

/**
 * Whether the in-app toast should be shown for a job notification. In desktop mode the native OS
 * notification covers it, so the toast would be a duplicate. When desktop notifications are switched
 * off the native path does not fire, so the toast is the only notification left and must stay.
 *
 * Port of `TendrilAppShell.ShouldShowInAppToast`.
 */
export function shouldShowInAppToast(
  isDesktop: boolean,
  desktopNotificationsEnabled: boolean,
): boolean {
  return !isDesktop || !desktopNotificationsEnabled;
}

/** The same runtime gate `api/bridge.ts` uses to decide whether it is talking to Tauri at all. */
function isDesktopShell(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

/**
 * `toast` is reached through a dynamic import on purpose. This store is imported eagerly by
 * `App.tsx`, and a static import would pull `@ivy-interactive/components` into the entry chunk —
 * the same ~190 kB cost that made `NoProjectsDialog` lazy, measured against the byte budget in
 * `tests/code-splitting.test.tsx`.
 */
async function showToast(notification: JobNotification): Promise<void> {
  const { toast } = await import("@ivy-interactive/components");
  toast({
    title: notification.title,
    description: notification.message,
    ...(notification.isSuccess ? {} : { variant: "destructive" as const }),
  });
}

/** Same reasoning as `showToast`: the plugin is only loaded when a notification is actually sent. */
async function sendOsNotification(notification: JobNotification): Promise<void> {
  const { sendNotification } = await import("@tauri-apps/plugin-notification");
  sendNotification({ title: notification.title, body: notification.message });
}

async function requestOsPermission(): Promise<boolean> {
  const { isPermissionGranted, requestPermission } = await import(
    "@tauri-apps/plugin-notification"
  );
  if (await isPermissionGranted()) return true;
  return (await requestPermission()) === "granted";
}

class NotificationsStore {
  /** Default true, matching `Program.cs`'s `DesktopNotifications != false`. */
  private desktopNotifications = true;
  private permissionGranted = false;
  private summarizer: NotificationBurstSummarizer | null = null;
  private initialized = false;

  /**
   * Reads the setting once and asks for OS permission when it is on. Safe to call more than once —
   * the second call is a no-op, so a remount does not re-prompt.
   */
  public async init(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;

    this.ensureSummarizer();

    try {
      const config = await bridge.getConfig();
      this.desktopNotifications = config.desktopNotifications ?? true;
    } catch {
      // An unreachable daemon must not silence notifications: keep the default.
    }

    if (this.desktopNotifications && isDesktopShell()) {
      try {
        this.permissionGranted = await requestOsPermission();
      } catch {
        this.permissionGranted = false;
      }
    }
  }

  /** The coalesced path: a wave of jobs exiting together is one notification, not one per job. */
  public notifyJobExit(notification: JobNotification): void {
    this.ensureSummarizer().add(notification);
  }

  /**
   * Failures of an operator action — a refused Execute, a failed refresh — are never coalesced and
   * always in-app: they belong next to the app, not in Notification Center, and they are not part of
   * a job-exit wave.
   */
  public notifyError(message: string, title = "Error"): void {
    void showToast({ title, message, isSuccess: false });
  }

  /** The success sibling of `notifyError`, for confirmations of an action the operator just took. */
  public notifySuccess(title: string, message: string): void {
    void showToast({ title, message, isSuccess: true });
  }

  /**
   * Called by the Settings toggle, so routing changes without a reload. Upstream reads the setting at
   * notification time for the same reason.
   */
  public setDesktopNotifications(enabled: boolean): void {
    this.desktopNotifications = enabled;
    if (enabled && isDesktopShell() && !this.permissionGranted) {
      void requestOsPermission()
        .then((granted) => (this.permissionGranted = granted))
        .catch(() => (this.permissionGranted = false));
    }
  }

  public isDesktopNotificationsEnabled(): boolean {
    return this.desktopNotifications;
  }

  /** Drops the pending burst and the cached setting. Test seam; also used on shell teardown. */
  public dispose(): void {
    this.summarizer?.dispose();
    this.summarizer = null;
    this.initialized = false;
    this.desktopNotifications = true;
    this.permissionGranted = false;
  }

  private ensureSummarizer(): NotificationBurstSummarizer {
    this.summarizer ??= new NotificationBurstSummarizer((n) => void this.deliver(n));
    return this.summarizer;
  }

  /**
   * Routes one notification to the OS or to the in-app Toaster. Falls back to a toast when the OS
   * refuses — upstream had no such fallback, and a denied permission there meant silence.
   */
  private async deliver(notification: JobNotification): Promise<void> {
    if (shouldShowInAppToast(isDesktopShell(), this.desktopNotifications)) {
      await showToast(notification);
      return;
    }

    if (!this.permissionGranted) {
      await showToast(notification);
      return;
    }

    try {
      await sendOsNotification(notification);
    } catch {
      await showToast(notification);
    }
  }
}

export const notificationsStore = new NotificationsStore();
