import { useSyncExternalStore } from "react";

/**
 * How many chat sessions exist, for the sidebar Chat button's badge.
 *
 * V1 has no store for this: `TendrilAppShell.Build` calls `chatService.GetSessions().Count` on
 * every build (`AppShell/TendrilAppShell.cs:1085`), so the badge is recomputed whenever anything
 * re-renders the shell, and deleting the last chat clears it on the next frame. V2's shell cannot
 * do that — `chatStore` is a lazy view's dependency and `App.tsx` is the one eager module, so
 * importing it there would pull the whole chat stack into the entry chunk, which is already at 94%
 * of the budget `code-splitting.test.tsx` holds.
 *
 * So the count travels the other way: `chatStore` pushes it here whenever its list moves, and the
 * shell subscribes. The module is a few lines and imports nothing but React, which is what makes it
 * safe for `App.tsx` to hold eagerly. `sidebarListStore` publishes in the same direction for the
 * same reason.
 */
let count = 0;
/** Whether {@link publishChatSessionCount} has been called, i.e. a loaded store owns the number. */
let storeOwnsCount = false;
const listeners = new Set<() => void>();

const set = (next: number): void => {
  if (next === count) return;
  count = next;
  listeners.forEach((listener) => listener());
};

/**
 * Publishes the session count from `chatStore`, which is authoritative from here on.
 *
 * Two callers are excluded, both in `chatStore.notify`: a plan-scoped store, whose list is narrowed
 * to one conversation where V1's badge counts them all, and a store that has not loaded its list
 * yet, whose empty `sessions` is "not known" rather than "none".
 */
export const publishChatSessionCount = (next: number): void => {
  storeOwnsCount = true;
  set(next);
};

/**
 * The startup value, for a shell whose user has not opened Chat yet — nothing has loaded
 * `chatStore` at that point, so without this the badge is missing until the first visit.
 *
 * Ignored once a loaded store has published, because this is an unawaited fetch racing one: a seed
 * landing second would put a pre-delete count back on the badge.
 */
export const seedChatSessionCount = (next: number): void => {
  if (storeOwnsCount) return;
  set(next);
};

export const subscribeToChatSessionCount = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export const getChatSessionCount = (): number => count;

/** Test seam: vitest keeps one module instance per file, and this outlives a render. */
export const resetChatSessionCountForTesting = (): void => {
  count = 0;
  storeOwnsCount = false;
  listeners.clear();
};

/** The shell side. */
export const useChatSessionCount = (): number =>
  useSyncExternalStore(subscribeToChatSessionCount, getChatSessionCount, getChatSessionCount);
