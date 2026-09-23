import { openUrl } from "@tauri-apps/plugin-opener";
import { resolveArtifactLink } from "@ivy-interactive/components/dialogs";
import { plansStore } from "../../state/plansStore";
import { uiStore } from "../../state/uiStore";

/** Where a link in a plan's markdown goes. */
export type PlanLinkTarget =
  | { kind: "file"; path: string }
  | { kind: "plan"; planId: string }
  | { kind: "external"; url: string }
  | { kind: "anchor"; id: string };

/**
 * V1's `FileSheet.CreateLinkClickHandler` (`Apps/Views/Sheets/FileSheet.cs`), as a pure decision:
 *
 * - a `file://` URL or an absolute path is a local file, for the `FileSheet`;
 * - `plan://21` is another plan, by number (`int.TryParse` in V1; V2's ids are the zero-padded
 *   folder prefix, `00021`);
 * - `http(s)://` and `mailto:` go to the system browser;
 * - and a relative path, which V1 drops, is resolved against the plan's folder — the plan's own
 *   `Artifacts/…` links are written that way.
 *
 * `#anchor` is kept as an anchor so the caller can scroll to it rather than let the webview follow
 * it, which would rewrite the app's route.
 */
export function planLinkTarget(href: string, planFolder?: string | null): PlanLinkTarget | null {
  const plan = /^plan:\/\/(\d+)\/?$/i.exec(href);
  if (plan) return { kind: "plan", planId: plan[1].padStart(5, "0") };
  if (/^(https?|mailto):/i.test(href)) return { kind: "external", url: href };
  if (href.startsWith("#")) return href.length > 1 ? { kind: "anchor", id: href.slice(1) } : null;

  const isAbsolute =
    href.startsWith("file:") ||
    /^[a-zA-Z]:[\\/]/.test(href) ||
    href.startsWith("/") ||
    href.startsWith("\\");
  if (!isAbsolute && !planFolder) return null;
  const folder = planFolder?.replace(/[/\\]+$/, "") ?? "";
  // `resolveArtifactLink` resolves against the *file* it is given, so name one inside the folder.
  const separator = folder.includes("\\") && !folder.includes("/") ? "\\" : "/";
  const path = resolveArtifactLink(`${folder}${separator}plan.md`, href);
  return path ? { kind: "file", path } : null;
}

/**
 * Opens a plan's page, as the shell's own `handleSelectPlan` does: select it, navigate to
 * `plan-<id>` with V1's `PlansAppArgs(planId)`, and read its detail.
 */
export function openPlanPage(planId: string): void {
  uiStore.setSelectedPlanId(planId);
  uiStore.navigate({ appId: `plan-${planId}`, args: { planId } });
  plansStore.fetchPlanDetail(planId).catch(() => {
    // Reported by the store.
  });
}

export interface PlanLinkHandlerOptions {
  planFolder?: string | null;
  /** Opens a local file in the `FileSheet`. */
  onOpenFile: (path: string) => void;
  /** Opens another plan. Defaults to {@link openPlanPage}. */
  onOpenPlan?: (planId: string) => void;
}

/**
 * `PlanMarkdown`'s two link callbacks for a plan document, wired as V1 wires `.OnLinkClick(...)`.
 * `PlanMarkdown` hands local links to `onFileClick` and everything else to `onLinkClick`, and stops
 * the default for both, so nothing here can navigate the webview away from the app.
 */
export function planLinkHandlers({ planFolder, onOpenFile, onOpenPlan }: PlanLinkHandlerOptions): {
  onFileClick: (href: string) => void;
  onLinkClick: (href: string) => void;
} {
  const follow = (href: string) => {
    const target = planLinkTarget(href, planFolder);
    if (!target) return;
    switch (target.kind) {
      case "file":
        onOpenFile(target.path);
        return;
      case "plan":
        (onOpenPlan ?? openPlanPage)(target.planId);
        return;
      case "external":
        openUrl(target.url).catch(() => {
          // The opener refusing a web link leaves the plan where it was, which is all a click on a
          // link can promise; there is no sheet here to say more in.
        });
        return;
      case "anchor": {
        let id = target.id;
        try {
          id = decodeURIComponent(id);
        } catch {
          // Not an escape sequence; the id is what was written.
        }
        document.getElementById(id)?.scrollIntoView({ block: "start" });
        return;
      }
    }
  };
  return { onFileClick: follow, onLinkClick: follow };
}
