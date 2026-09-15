import { describe, it, expect, vi, afterEach } from "vitest";
import {
  BURST_WINDOW_MS,
  NotificationBurstSummarizer,
  SUMMARY_TITLE,
  summarize,
  type JobNotification,
} from "../src/state/notificationBurst";
import { shouldShowInAppToast } from "../src/state/notificationsStore";

/** Port of `AppShellNotificationTests.cs`, one case per xunit fact. Fake timers stand in for the
 *  C# `TestScheduler`. */

const finished = (plan: string): JobNotification => ({
  title: "ExecutePlan Completed",
  message: plan,
  isSuccess: true,
});

const failed = (plan: string): JobNotification => ({
  title: "ExecutePlan Failed",
  message: `${plan}: verification failed`,
  isSuccess: false,
});

afterEach(() => {
  vi.useRealTimers();
});

describe("shouldShowInAppToast", () => {
  it("is false on desktop with native notifications enabled", () => {
    // Native notification covers it, so the in-app toast would be a duplicate.
    expect(shouldShowInAppToast(true, true)).toBe(false);
  });

  it("is true on desktop with native notifications disabled", () => {
    // Native path is suppressed by the setting, so the toast is the only notification left.
    expect(shouldShowInAppToast(true, false)).toBe(true);
  });

  it("is true on web with native notifications enabled", () => {
    // Web mode has no native notification path, so it must always toast.
    expect(shouldShowInAppToast(false, true)).toBe(true);
  });

  it("is true on web with native notifications disabled", () => {
    // The setting only governs the native path; it must not disable the web toast.
    expect(shouldShowInAppToast(false, false)).toBe(true);
  });
});

describe("summarize", () => {
  it("shows a few notifications as they arrived", () => {
    const batch = [finished("00001-A"), failed("00002-B"), finished("00003-C")];

    expect(summarize(batch)).toEqual(batch);
  });

  it("collapses a burst of completions to one notification", () => {
    const batch = [1, 2, 3, 4, 5].map((i) => finished(`0000${i}-Plan`));

    const summarized = summarize(batch);

    expect(summarized).toHaveLength(1);
    expect(summarized[0].title).toBe(SUMMARY_TITLE);
    expect(summarized[0].message).toBe("5 jobs finished");
    expect(summarized[0].isSuccess).toBe(true);
  });

  it("keeps a failure inside a burst visible", () => {
    const batch = [1, 2, 3, 4, 5, 6].map((i) => finished(`0000${i}-Plan`));
    batch.push(failed("00007-Broken"));

    const summarized = summarize(batch);

    expect(summarized).toHaveLength(2);
    expect(summarized[0].message).toBe("6 jobs finished, 1 failed");
    // The failure keeps its own notification: which plan failed, and why, is what the user acts on.
    expect(summarized[1].message).toBe("00007-Broken: verification failed");
    expect(summarized[1].isSuccess).toBe(false);
  });

  it("adds no summary to a burst that is all failures", () => {
    const batch = [1, 2, 3, 4].map((i) => failed(`0000${i}-Plan`));

    expect(summarize(batch)).toEqual(batch);
  });

  it("reads a single completion among failures as one job", () => {
    const batch = [failed("00001-A"), failed("00002-B"), failed("00003-C"), finished("00004-D")];

    expect(summarize(batch)[0].message).toBe("1 job finished, 3 failed");
  });
});

describe("NotificationBurstSummarizer", () => {
  it("shows one notification for a burst inside the window", () => {
    vi.useFakeTimers();
    const shown: JobNotification[] = [];
    const summarizer = new NotificationBurstSummarizer((n) => shown.push(n), BURST_WINDOW_MS);

    for (let i = 1; i <= 5; i++) summarizer.add(finished(`0000${i}-Plan`));

    // Nothing until the window closes: the burst is what is being waited for.
    expect(shown).toEqual([]);

    vi.advanceTimersByTime(BURST_WINDOW_MS);

    expect(shown).toHaveLength(1);
    expect(shown[0].message).toBe("5 jobs finished");
    summarizer.dispose();
  });

  it("summarizes a later burst on its own", () => {
    vi.useFakeTimers();
    const shown: JobNotification[] = [];
    const summarizer = new NotificationBurstSummarizer((n) => shown.push(n), BURST_WINDOW_MS);

    for (let i = 1; i <= 4; i++) summarizer.add(finished(`0000${i}-Plan`));
    vi.advanceTimersByTime(BURST_WINDOW_MS);

    for (let i = 5; i <= 9; i++) summarizer.add(finished(`0000${i}-Plan`));
    vi.advanceTimersByTime(BURST_WINDOW_MS);

    expect(shown.map((n) => n.message)).toEqual(["4 jobs finished", "5 jobs finished"]);
    summarizer.dispose();
  });

  it("shows a single notification unchanged", () => {
    vi.useFakeTimers();
    const shown: JobNotification[] = [];
    const summarizer = new NotificationBurstSummarizer((n) => shown.push(n), BURST_WINDOW_MS);

    summarizer.add(failed("00001-Broken"));
    vi.advanceTimersByTime(BURST_WINDOW_MS);

    expect(shown).toHaveLength(1);
    expect(shown[0].message).toBe("00001-Broken: verification failed");
    summarizer.dispose();
  });

  it("drops the pending batch on dispose", () => {
    vi.useFakeTimers();
    const shown: JobNotification[] = [];
    const summarizer = new NotificationBurstSummarizer((n) => shown.push(n), BURST_WINDOW_MS);

    summarizer.add(finished("00001-A"));
    summarizer.dispose();
    vi.advanceTimersByTime(BURST_WINDOW_MS);

    expect(shown).toEqual([]);
  });
});
