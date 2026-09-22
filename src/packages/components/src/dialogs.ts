/**
 * Dialogs entrypoint — a leaf, deliberately.
 *
 * The dialogs are also re-exported from `./tendril`, which is convenient but not lazy-loadable:
 * `App.tsx` imports that entry statically (for `useShortcut`), so anything reachable from it lands
 * in the shell's eager chunk. Re-exporting the dialog family there took eager JS from 93.8% to
 * 97.0% of its budget — the lazy boundaries around `NoProjectsDialog`, `ConfirmDialog` and
 * `JobDebugSheet` were deferring nothing, because their module was already loaded.
 *
 * This entry exists so those `React.lazy` calls have something to point at that pulls only the
 * dialogs. Import from here when the import is lazy; `./tendril` is fine for anything already in
 * the eager graph.
 */
export * from "./components/Dialogs";
