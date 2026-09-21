/**
 * The chat panel's persisted width, keyed by the workspace it belongs to.
 *
 * It was one global key, and that was only correct while exactly one `PlanWorkspace` existed. The
 * width is a property of the pane the operator dragged, not of the app: the plan page, the review
 * page and the config editor each mount a workspace of their own, and under a single key the last
 * one dragged silently resized the others the next time they opened.
 *
 * `plan-workspace` keeps the original key verbatim rather than taking a derived one, so the width an
 * operator has already dragged the plan chat to survives this change. A rename would read as a reset
 * for every existing user, which is not worth asking of them over a pane width.
 */
export const CHAT_WIDTH_STORAGE_KEY = "tendril.plan.chatWidth";

/** The one id that predates the parameterisation, and therefore owns {@link CHAT_WIDTH_STORAGE_KEY}. */
const LEGACY_WIDTH_ID = "plan-workspace";

/**
 * Where a workspace's width is stored. Deliberately not a hash or an index: the key is read straight
 * out of `localStorage` when diagnosing a layout complaint, so it names the workspace it belongs to.
 */
export const chatWidthStorageKey = (id: string): string =>
  id === LEGACY_WIDTH_ID ? CHAT_WIDTH_STORAGE_KEY : `tendril.chatWidth.${id}`;

export const MIN_CHAT_WIDTH = 320;
/** The chat never takes more than this share of the workspace; the plan stays readable beside it. */
export const MAX_CHAT_SHARE = 0.6;

export const readStoredChatWidth = (id: string): number | null => {
  try {
    const raw = window.localStorage.getItem(chatWidthStorageKey(id));
    if (raw == null) return null;
    const value = Number(raw);
    return Number.isFinite(value) && value >= MIN_CHAT_WIDTH ? Math.round(value) : null;
  } catch {
    return null;
  }
};

export const writeStoredChatWidth = (id: string, width: number | null) => {
  try {
    const key = chatWidthStorageKey(id);
    if (width == null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, String(Math.round(width)));
  } catch {
    /* storage unavailable: the width just does not persist */
  }
};

export const clampChatWidth = (width: number, rootWidth: number): number => {
  const max = Math.max(MIN_CHAT_WIDTH, Math.floor(rootWidth * MAX_CHAT_SHARE));
  return Math.min(Math.max(Math.round(width), MIN_CHAT_WIDTH), max);
};
