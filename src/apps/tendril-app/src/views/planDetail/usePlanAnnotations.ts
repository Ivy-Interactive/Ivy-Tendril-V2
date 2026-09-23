import { useCallback, useEffect, useState } from "react";
import { describeBridgeError, type Annotation, type PlanDetail } from "../../types/api";
import { bridge } from "../../api/bridge";
import { onPlanEvent } from "../../api/events";
import { useTranslation } from "../../i18n";

/**
 * The plan's annotations: loading them, keeping them live, and writing an edit back.
 *
 * One hook rather than four scattered members because the four move together - the list, the read
 * that fills it, the broadcast that re-reads it, and the diffing write that replaces it. The page
 * holds the result in exactly one place, so the only thing it has to know is what came back.
 *
 * `plan` is taken whole rather than as an id: both effects key on a different field of it
 * (`plan.id` and `plan.latestRevisionContent`), and they key on it for different reasons - see
 * each effect's own note.
 */
export function usePlanAnnotations(
  plan: PlanDetail,
  setActionError: (message: string | null) => void,
) {
  const { t } = useTranslation("plans");
  /**
   * The plan's inline annotations, which is what `PlanMarkdown` needs to render its highlights and
   * what the PendingAnnotations execute guard counts.
   *
   * Reloaded when the revision text changes, because V1 does exactly that and says why:
   * "Annotation offsets anchor to the plan text; drop them if the content changed underneath (plan
   * updated, edited, or revised)" (`ContentView.Build`).
   */
  const [annotations, setAnnotations] = useState<Annotation[]>([]);

  const loadAnnotations = useCallback(() => {
    let cancelled = false;
    bridge
      .listAnnotations(plan.id)
      .then((list) => {
        if (!cancelled) setAnnotations(list);
      })
      .catch(() => {
        // An unreadable list is an empty one: the guard degrades to "nothing known", never to a
        // page that will not render.
        if (!cancelled) setAnnotations([]);
      });
    return () => {
      cancelled = true;
    };
  }, [plan.id]);

  useEffect(
    () => loadAnnotations(),
    // `latestRevisionContent` is in here on purpose: see the note above.
    [loadAnnotations, plan.latestRevisionContent],
  );

  /**
   * Another window, or a job, can rewrite this plan's annotations. V1 subscribes to
   * `IPlanAnnotationService.AnnotationsChanged` for the same reason and filters on the folder path
   * (`ContentView.Build`); the daemon's equivalent is the `plan.annotations_changed` broadcast.
   */
  useEffect(() => {
    const signal = { cancelled: false };
    let unlisten: (() => void) | undefined;

    void onPlanEvent((payload) => {
      const event = payload as { type?: string; planId?: string } | null;
      if (event?.type !== "plan.annotations_changed") return;
      // Every plan shares the one channel, so another plan's change is not ours.
      if (event.planId !== plan.id) return;
      loadAnnotations();
    })
      .then((fn) => {
        if (signal.cancelled) {
          fn();
          return;
        }
        unlisten = fn;
      })
      .catch(() => {
        // Without the stream the highlights are merely not live; every write still replaces the list
        // from what the service persisted.
      });

    return () => {
      signal.cancelled = true;
      unlisten?.();
    };
  }, [plan.id, loadAnnotations]);

  /**
   * Persist an annotation edit.
   *
   * `PlanMarkdown` reports the whole array rather than the one thing that changed, exactly as V1's
   * `OnAnnotationsChange` does — V1 can hand that straight to
   * `IPlanAnnotationService.SaveAnnotationsAsync`, which takes a list. The bridge here is
   * per-annotation, so the array is diffed against what we had: anything new or changed is upserted,
   * anything gone is deleted. The persisted list is what lands in state, so a rejected write leaves
   * the highlights showing what is actually on disk.
   */
  const handleAnnotationsChange = (next: Annotation[]) => {
    const previous = annotations;
    setAnnotations(next);

    const byId = new Map(previous.map((a) => [a.id, a]));
    const writes: (() => Promise<Annotation[]>)[] = [];
    for (const annotation of next) {
      const before = byId.get(annotation.id);
      if (!before || JSON.stringify(before) !== JSON.stringify(annotation)) {
        writes.push(() => bridge.upsertAnnotation(plan.id, annotation));
      }
    }
    const keptIds = new Set(next.map((a) => a.id));
    for (const annotation of previous) {
      if (!keptIds.has(annotation.id)) {
        writes.push(() => bridge.deleteAnnotation(plan.id, annotation.id));
      }
    }
    if (writes.length === 0) return;

    // Sequenced as thunks, not fired off together: each call answers with the plan's whole list, so
    // overlapping writes would race to be the one whose snapshot sticks.
    void writes
      .reduce<Promise<Annotation[]>>(
        (chain, write) => chain.then(() => write()),
        Promise.resolve(next),
      )
      .then(setAnnotations)
      .catch((err: unknown) => {
        setAnnotations(previous);
        setActionError(t("detail.errors.saveAnnotation", { error: describeBridgeError(err) }));
      });
  };

  return { annotations, setAnnotations, handleAnnotationsChange };
}
