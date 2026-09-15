/**
 * Shared stable references.
 *
 * A frozen empty array used as a default prop value so that `useMemo`/`useEffect`
 * dependency arrays see the same identity across renders instead of a fresh `[]`.
 */
export const EMPTY_ARRAY: never[] = [];
