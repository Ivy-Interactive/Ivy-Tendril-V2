import type { InProgressQuestionAnswers } from "../../types/chat";

/**
 * Everything this store keeps in `localStorage`, and the reads and writes that touch it.
 *
 * One shape six times over, deliberately: each pair answers with an empty map when storage is
 * restricted or the JSON is unreadable, so a browser that refuses `localStorage` costs the store a
 * forgotten draft rather than a page that will not load. The keys are here too, because the store
 * broadcasts changes by key - see `ChatStore.adoptStorageChange`.
 */

export const IN_PROGRESS_ANSWERS_STORAGE_KEY = "tendril:chat:in_progress_answers";
export const DRAFT_OWNERS_STORAGE_KEY = "tendril:chat:draft_session_owners";
/**
 * Unsent composer text, keyed by session id.
 *
 * V1 has no counterpart to port, and the reason is instructive: `ChatWidget` holds its prompt in a
 * plain `useState` (`const [promptText, setPromptText] = useState("")`) and never persists it,
 * because the Ivy shell keeps the widget mounted while you move around the app. V2's Chat page is
 * a `React.lazy` route that `App.renderActiveView` swaps out, so leaving the page unmounts the
 * composer and takes the half-typed prompt with it. The nearest thing V1 *does* have is the
 * per-message question-draft store (`questionDraftsRef` in `ChatWidget.tsx`, contract in
 * `PlanMarkdown/questionsContext.ts`), which exists for exactly this reason - "a drafted but
 * unsubmitted answer survives session switches" - so this follows its shape: a map keyed by what
 * the draft belongs to, never one global slot.
 *
 * Keyed per session and not globally on purpose. One shared draft would put a prompt written for
 * one conversation into the composer of another, which is a worse bug than the one being fixed.
 */
export const COMPOSER_DRAFTS_STORAGE_KEY = "tendril:chat:composer_drafts";
export const PINNED_SESSIONS_STORAGE_KEY = "tendril:chat:pinned_sessions";

export function loadStoredPinnedSessions(): Record<string, string> {
  try {
    const storage =
      typeof localStorage !== "undefined"
        ? localStorage
        : typeof window !== "undefined"
          ? window.localStorage
          : null;
    if (storage) {
      const raw = storage.getItem(PINNED_SESSIONS_STORAGE_KEY);
      if (raw) {
        return JSON.parse(raw);
      }
    }
  } catch {
    // Fallback to empty map if storage is restricted or throws
  }
  return {};
}

export function saveStoredPinnedSessions(data: Record<string, string>): void {
  try {
    const storage =
      typeof localStorage !== "undefined"
        ? localStorage
        : typeof window !== "undefined"
          ? window.localStorage
          : null;
    if (storage) {
      if (Object.keys(data).length === 0) {
        storage.removeItem(PINNED_SESSIONS_STORAGE_KEY);
      } else {
        storage.setItem(PINNED_SESSIONS_STORAGE_KEY, JSON.stringify(data));
      }
    }
  } catch {
    // Ignore storage quota or access errors
  }
}

export function loadStoredInProgressAnswers(): Record<string, InProgressQuestionAnswers> {
  try {
    const storage =
      typeof localStorage !== "undefined"
        ? localStorage
        : typeof window !== "undefined"
          ? window.localStorage
          : null;
    if (storage) {
      const raw = storage.getItem(IN_PROGRESS_ANSWERS_STORAGE_KEY);
      if (raw) {
        return JSON.parse(raw);
      }
    }

    // Backward compatibility: check sessionStorage for legacy draft answers
    const legacyStorage =
      typeof sessionStorage !== "undefined"
        ? sessionStorage
        : typeof window !== "undefined"
          ? window.sessionStorage
          : null;
    if (legacyStorage) {
      const legacyRaw = legacyStorage.getItem(IN_PROGRESS_ANSWERS_STORAGE_KEY);
      if (legacyRaw) {
        const parsed = JSON.parse(legacyRaw);
        if (storage) {
          storage.setItem(IN_PROGRESS_ANSWERS_STORAGE_KEY, legacyRaw);
        }
        legacyStorage.removeItem(IN_PROGRESS_ANSWERS_STORAGE_KEY);
        return parsed;
      }
    }
  } catch {
    // Fallback to in-memory if storage is restricted or throws
  }
  return {};
}

export function saveStoredInProgressAnswers(data: Record<string, InProgressQuestionAnswers>): void {
  try {
    const storage =
      typeof localStorage !== "undefined"
        ? localStorage
        : typeof window !== "undefined"
          ? window.localStorage
          : null;
    if (storage) {
      if (Object.keys(data).length === 0) {
        storage.removeItem(IN_PROGRESS_ANSWERS_STORAGE_KEY);
      } else {
        storage.setItem(IN_PROGRESS_ANSWERS_STORAGE_KEY, JSON.stringify(data));
      }
    }
  } catch {
    // Ignore storage quota or access errors
  }
}

/**
 * The unsent composer text of every session that has some, as of the last write by any window.
 *
 * Same defensive shape as the other stored maps here: storage can be absent (a non-browser test
 * environment), restricted (private browsing), or hold something another version wrote, and none of
 * those is a reason to fail to open a chat.
 */
export function loadStoredComposerDrafts(): Record<string, string> {
  try {
    const storage =
      typeof localStorage !== "undefined"
        ? localStorage
        : typeof window !== "undefined"
          ? window.localStorage
          : null;
    if (storage) {
      const raw = storage.getItem(COMPOSER_DRAFTS_STORAGE_KEY);
      if (raw) {
        return JSON.parse(raw);
      }
    }
  } catch {
    // Fallback to in-memory if storage is restricted or throws
  }
  return {};
}

export function saveStoredComposerDrafts(data: Record<string, string>): void {
  try {
    const storage =
      typeof localStorage !== "undefined"
        ? localStorage
        : typeof window !== "undefined"
          ? window.localStorage
          : null;
    if (storage) {
      if (Object.keys(data).length === 0) {
        storage.removeItem(COMPOSER_DRAFTS_STORAGE_KEY);
      } else {
        storage.setItem(COMPOSER_DRAFTS_STORAGE_KEY, JSON.stringify(data));
      }
    }
  } catch {
    // Ignore storage quota or access errors
  }
}

export function loadStoredDraftOwners(): Record<string, string> {
  try {
    const storage =
      typeof localStorage !== "undefined"
        ? localStorage
        : typeof window !== "undefined"
          ? window.localStorage
          : null;
    if (storage) {
      const raw = storage.getItem(DRAFT_OWNERS_STORAGE_KEY);
      if (raw) {
        return JSON.parse(raw);
      }
    }
  } catch {
    // Fallback to in-memory if storage is restricted or throws
  }
  return {};
}

export function saveStoredDraftOwners(data: Record<string, string>): void {
  try {
    const storage =
      typeof localStorage !== "undefined"
        ? localStorage
        : typeof window !== "undefined"
          ? window.localStorage
          : null;
    if (storage) {
      if (Object.keys(data).length === 0) {
        storage.removeItem(DRAFT_OWNERS_STORAGE_KEY);
      } else {
        storage.setItem(DRAFT_OWNERS_STORAGE_KEY, JSON.stringify(data));
      }
    }
  } catch {
    // Ignore storage quota or access errors
  }
}
