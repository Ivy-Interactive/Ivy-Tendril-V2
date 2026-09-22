import { i18n } from "../i18n";

/**
 * Collapses a burst of job notifications into one toast. A wave of jobs exiting together raised a
 * notification each, and every one is a card the user has to read past — at the moment the workspace
 * is already busy syncing those same exits. Failures keep their own notification: which plan failed,
 * and why, is the part worth reading.
 *
 * Port of `AppShell/NotificationBurstSummarizer.cs`, same constants and same message strings - in
 * English; the strings are `jobs:notifications.summary.*`, translated when a burst is summarized.
 */

export interface JobNotification {
  title: string;
  message: string;
  isSuccess: boolean;
}

/**
 * How long notifications are collected before they are shown. The window opens at the first
 * notification, so a shell with nothing happening pays nothing.
 */
export const BURST_WINDOW_MS = 300;

/** Up to this many notifications in one window are shown exactly as they arrived. */
export const MAX_INDIVIDUAL = 3;

/**
 * The summary's English title, which is what the tests hold it to. What is shown is
 * `jobs:notifications.summary.title`, in the language current when the burst is summarized; this
 * constant is never displayed.
 */
export const SUMMARY_TITLE = "Jobs Finished";

/**
 * What one window's worth of notifications should be shown as: everything, when there are few
 * enough to read, else one summary of the wave followed by each failure in it.
 */
export function summarize(batch: readonly JobNotification[]): JobNotification[] {
  if (batch.length <= MAX_INDIVIDUAL) return [...batch];

  const failures = batch.filter((n) => !n.isSuccess);
  const finished = batch.length - failures.length;

  // A burst that is nothing but failures has nothing to collapse: the failures are all detail, and a
  // summary on top of them would only be one more card.
  if (finished === 0) return failures;

  const message =
    failures.length === 0
      ? i18n.t("jobs:notifications.summary.finished", { count: finished })
      : i18n.t("jobs:notifications.summary.finishedWithFailures", {
          count: finished,
          // Its own plural, so a language whose verb agrees with the number of failures can say so.
          failures: i18n.t("jobs:notifications.summary.failedCount", { count: failures.length }),
        });

  return [
    { title: i18n.t("jobs:notifications.summary.title"), message, isSuccess: true },
    ...failures,
  ];
}

export class NotificationBurstSummarizer {
  private pending: JobNotification[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly show: (notification: JobNotification) => void,
    private readonly windowMs: number = BURST_WINDOW_MS,
  ) {}

  public add(notification: JobNotification): void {
    this.pending.push(notification);

    // The window is opened by the *first* notification in the batch and closed `windowMs` later,
    // rather than a repeating interval, which would tick for the life of the shell. This is what
    // upstream's `Buffer(() => _notifications.Delay(burst).Take(1))` does.
    if (this.timer === null) {
      this.timer = setTimeout(() => this.flush(), this.windowMs);
    }
  }

  private flush(): void {
    this.timer = null;
    const batch = this.pending;
    this.pending = [];
    if (batch.length === 0) return;

    for (const notification of summarize(batch)) {
      this.show(notification);
    }
  }

  public dispose(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.pending = [];
  }
}
