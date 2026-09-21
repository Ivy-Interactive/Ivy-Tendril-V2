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
/**
 * The agent, model and effort each session was last set to run with, keyed by session id.
 *
 * This is V2's stand-in for the durable record V1 keeps on the session itself.
 * `ChatHistoryService.AddMessage` rewrites `AgentId` / `ModelId` / `Effort` onto the session record
 * on every single message, so in V1 a session always described what it last ran with, and reopening
 * it restored that. V2's daemon does not: `create_session` stamps `agent_id` / `model_id` once, and
 * `turn.rs` reads them for the turn but never writes the turn's own choice back. A session record
 * therefore preserves whatever the composer happened to hold when "New Chat" was clicked - and since
 * people open a chat *first* and choose a provider *second*, that is usually the provider picked for
 * the previous chat. Restoring it on switch is what transposed the two chats' providers.
 *
 * Keyed per session for the same reason {@link COMPOSER_DRAFTS_STORAGE_KEY} is, and it is the same
 * bug in a different field: one global slot hands a choice made for one conversation to another.
 */
export const SESSION_SELECTIONS_STORAGE_KEY = "tendril:chat:session_selections";

/** What one session runs with. All three are recorded together, as V1's `AddMessage` writes them. */
export interface StoredSessionSelection {
  agentId: string;
  modelId: string;
  effort: string;
}

export function loadStoredSessionSelections(): Record<string, StoredSessionSelection> {
  try {
    const storage =
      typeof localStorage !== "undefined"
        ? localStorage
        : typeof window !== "undefined"
          ? window.localStorage
          : null;
    if (storage) {
      const raw = storage.getItem(SESSION_SELECTIONS_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          return parsed as Record<string, StoredSessionSelection>;
        }
      }
    }
  } catch {
    // Fallback to in-memory if storage is restricted or throws
  }
  return {};
}

export function saveStoredSessionSelections(data: Record<string, StoredSessionSelection>): void {
  try {
    const storage =
      typeof localStorage !== "undefined"
        ? localStorage
        : typeof window !== "undefined"
          ? window.localStorage
          : null;
    if (storage) {
      if (Object.keys(data).length === 0) {
        storage.removeItem(SESSION_SELECTIONS_STORAGE_KEY);
      } else {
        storage.setItem(SESSION_SELECTIONS_STORAGE_KEY, JSON.stringify(data));
      }
    }
  } catch {
    // Ignore storage quota or access errors
  }
}

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
