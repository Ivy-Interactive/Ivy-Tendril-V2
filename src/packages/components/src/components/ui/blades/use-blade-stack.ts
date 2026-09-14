import * as React from "react";

import type { BladeDescriptor, BladeStackActions, ResolvedBlade } from "./types";

/** What should receive focus once the next stack change has been committed. */
export type PendingBladeFocus =
  /** The blade with this id — used after a push or a replace. */
  | { kind: "blade"; id: string }
  /** The control that opened the blade with this id, falling back to the new deepest blade. */
  | { kind: "invoker"; id: string };

interface BladeStackState {
  blades: ResolvedBlade[];
  /** Popped blades kept mounted (inert, aria-hidden) until their exit animation finishes. */
  exiting: ResolvedBlade[];
  /** Bumped on every change so effects can key on actions rather than on array identity. */
  seq: number;
}

type BladeStackAction =
  | { type: "push"; blade: ResolvedBlade; animate: boolean }
  | { type: "unwind"; depth: number; animate: boolean }
  | { type: "replace"; blade: ResolvedBlade }
  | { type: "settle"; id: string };

function unwind(state: BladeStackState, depth: number, animate: boolean): BladeStackState {
  const keep = Math.max(1, Math.min(depth, state.blades.length));
  if (keep === state.blades.length) return state;

  const removed = state.blades.slice(keep);
  return {
    blades: state.blades.slice(0, keep),
    exiting: animate ? [...state.exiting, ...removed] : state.exiting,
    seq: state.seq + 1,
  };
}

function reducer(state: BladeStackState, action: BladeStackAction): BladeStackState {
  switch (action.type) {
    case "push":
      return {
        blades: [...state.blades, action.blade],
        // A re-pushed id must not linger in the exit list, or it would render twice.
        exiting: state.exiting.filter((blade) => blade.id !== action.blade.id),
        seq: state.seq + 1,
      };
    case "unwind":
      return unwind(state, action.depth, action.animate);
    case "replace": {
      if (state.blades.length < 2) return state;
      const blades = state.blades.slice(0, -1);
      return { blades: [...blades, action.blade], exiting: state.exiting, seq: state.seq + 1 };
    }
    case "settle": {
      if (!state.exiting.some((blade) => blade.id === action.id)) return state;
      return {
        blades: state.blades,
        exiting: state.exiting.filter((blade) => blade.id !== action.id),
        seq: state.seq,
      };
    }
  }
}

export interface UseBladeStackOptions {
  /** The always-present blade at depth 1. */
  root: BladeDescriptor;
  /** Extra blades opened on mount (uncontrolled initial state). */
  initialBlades?: BladeDescriptor[];
  /** When false, popped blades are dropped synchronously instead of animating out. */
  animate: boolean;
}

export interface UseBladeStackResult extends BladeStackActions {
  blades: readonly ResolvedBlade[];
  exiting: readonly ResolvedBlade[];
  depth: number;
  /** Change counter — effects that must run once per stack change key on this. */
  seq: number;
  /** Drops an exiting blade once its animation has finished. */
  settle: (id: string) => void;
  /** Controls that opened each blade, keyed by blade id, so focus can be restored on pop. */
  invokersRef: React.RefObject<Map<string, HTMLElement>>;
  pendingFocusRef: React.RefObject<PendingBladeFocus | null>;
}

/**
 * Owns the ordered blade stack. Index 0 is the root blade and can never be popped; every other
 * entry is a pushed blade, deepest last.
 */
export function useBladeStack({
  root,
  initialBlades,
  animate,
}: UseBladeStackOptions): UseBladeStackResult {
  const idBase = React.useId();
  const counterRef = React.useRef(0);
  const nextId = React.useCallback(() => `${idBase}blade-${++counterRef.current}`, [idBase]);

  const resolve = React.useCallback(
    (blade: BladeDescriptor): ResolvedBlade => ({ ...blade, id: blade.id ?? nextId() }),
    [nextId],
  );

  const [state, dispatch] = React.useReducer(reducer, undefined, (): BladeStackState => {
    const blades = [resolve(root), ...(initialBlades ?? []).map(resolve)];
    return { blades, exiting: [], seq: 0 };
  });

  // Mirrored so the action creators can read the current stack without re-creating themselves on
  // every change (and so they can fire `onClose` for the blades they are about to remove).
  const stateRef = React.useRef(state);
  stateRef.current = state;

  const animateRef = React.useRef(animate);
  animateRef.current = animate;

  const invokersRef = React.useRef(new Map<string, HTMLElement>());
  const pendingFocusRef = React.useRef<PendingBladeFocus | null>(null);

  const unwindTo = React.useCallback((depth: number) => {
    const current = stateRef.current.blades;
    const keep = Math.max(1, Math.min(depth, current.length));
    if (keep === current.length) return;

    const removed = current.slice(keep);
    pendingFocusRef.current = { kind: "invoker", id: removed[0].id };
    dispatch({ type: "unwind", depth: keep, animate: animateRef.current });
    // Deepest first, so a parent's handler observes its children as already closed.
    for (const blade of [...removed].reverse()) blade.onClose?.();
    // The shallowest removed blade's invoker is kept until focus has been restored to it.
    for (const blade of removed.slice(1)) invokersRef.current.delete(blade.id);
  }, []);

  const push = React.useCallback(
    (blade: BladeDescriptor) => {
      const resolved = resolve(blade);
      const invoker = typeof document === "undefined" ? null : document.activeElement;
      // `document.body` is what jsdom and browsers report when nothing is focused — restoring focus
      // to it on pop would move focus out of the stack, so it does not count as an invoker.
      if (
        invoker instanceof HTMLElement &&
        invoker !== document.body &&
        invoker !== document.documentElement
      ) {
        invokersRef.current.set(resolved.id, invoker);
      }
      pendingFocusRef.current = { kind: "blade", id: resolved.id };
      dispatch({ type: "push", blade: resolved, animate: animateRef.current });
      return resolved.id;
    },
    [resolve],
  );

  const pop = React.useCallback(
    (count = 1) => {
      unwindTo(stateRef.current.blades.length - Math.max(1, count));
    },
    [unwindTo],
  );

  const popTo = React.useCallback((depth: number) => unwindTo(depth), [unwindTo]);

  const popToId = React.useCallback(
    (id: string) => {
      const index = stateRef.current.blades.findIndex((blade) => blade.id === id);
      if (index < 0) return;
      unwindTo(index + 1);
    },
    [unwindTo],
  );

  const reset = React.useCallback(() => unwindTo(1), [unwindTo]);

  const replace = React.useCallback(
    (blade: BladeDescriptor) => {
      const current = stateRef.current.blades;
      if (current.length < 2) return;
      // Keep the outgoing blade's identity so its recorded invoker still restores focus on pop.
      const resolved = resolve({ ...blade, id: blade.id ?? current[current.length - 1].id });
      pendingFocusRef.current = { kind: "blade", id: resolved.id };
      dispatch({ type: "replace", blade: resolved });
    },
    [resolve],
  );

  const settle = React.useCallback((id: string) => dispatch({ type: "settle", id }), []);

  return {
    blades: state.blades,
    exiting: state.exiting,
    depth: state.blades.length,
    seq: state.seq,
    push,
    pop,
    popTo,
    popToId,
    replace,
    reset,
    settle,
    invokersRef,
    pendingFocusRef,
  };
}
