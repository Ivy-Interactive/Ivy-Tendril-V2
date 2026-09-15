/**
 * Collapses a burst of job notifications into one toast. A wave of jobs exiting together raised a
 * notification each, and every one is a card the user has to read past — at the moment the workspace
 * is already busy syncing those same exits. Failures keep their own notification: which plan failed,
 * and why, is the part worth reading.
 *
 * Port of `AppShell/NotificationBurstSummarizer.cs`, same constants and same message strings.
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

  const jobs = finished === 1 ? "job" : "jobs";
  const message =
    failures.length === 0
      ? `${finished} ${jobs} finished`
      : `${finished} ${jobs} finished, ${failures.length} failed`;

  return [{ title: SUMMARY_TITLE, message, isSuccess: true }, ...failures];
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
