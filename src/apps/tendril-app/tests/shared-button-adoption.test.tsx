import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { OfflineBanner } from "../src/components/OfflineBanner";
import { UpdateNotice } from "../src/components/UpdateNotice";
import { RecommendationCard } from "../src/components/RecommendationCard";
import { ServiceStatusBanner } from "../src/components/service/ServiceStatusBanner";
import { ComposerAttachment } from "../src/components/chat/ComposerAttachment";
import type { ServiceInfo } from "../src/types/api";

/**
 * These controls used to be hand-rolled `<button>`s carrying their own `rounded … px-3 py-1 …`
 * strings, which is the thing the design system exists to stop: every one of them drifted a little
 * from the next, and a change to the shared shape reached none of them. They are `Button` and
 * `IconButton` from `@ivy-interactive/components/ui` now.
 *
 * The check is for the shared classes those components emit rather than for a screenshot, because
 * that is the part a future hand-rolled replacement would silently lose. `buttonVariant`'s base
 * string starts `inline-flex items-center justify-center gap-1 whitespace-nowrap rounded-field`,
 * and `IconButton` renders `.tui-icon-btn` with its size on `data-size` — see
 * `src/packages/components/src/components/ui/button/variant.ts` and `.../ui/IconButton.tsx`.
 *
 * The accessible-name assertions matter just as much: `IconButton` deliberately renders no native
 * `title` (it uses a Radix tooltip), so an icon control that loses its `label` becomes unreachable
 * by name, and the app's own tests used to find these by `getByTitle`.
 */

const sharedButton = (el: HTMLElement) => {
  expect(el).toHaveClass("inline-flex");
  expect(el).toHaveClass("rounded-field");
  expect(el).toHaveClass("whitespace-nowrap");
};

describe("shared Button adoption", () => {
  it("draws the offline banner's reconnect with the shared button, keeping the warning tint", () => {
    const onReconnect = vi.fn();
    render(<OfflineBanner status="offline" countdown={0} onReconnect={onReconnect} />);

    const button = screen.getByRole("button", { name: "Reconnect Now" });
    sharedButton(button);
    // The banner is one warning surface; the button keeps that colour rather than taking the solid
    // `warning` variant, which would paint a filled block inside an already tinted strip.
    expect(button).toHaveClass("text-warning");

    fireEvent.click(button);
    expect(onReconnect).toHaveBeenCalledTimes(1);
  });

  it("draws both update-notice actions with the shared button", () => {
    const onDismiss = vi.fn();
    const onCopyCommand = vi.fn();
    render(
      <UpdateNotice
        info={{
          currentVersion: "1.0.0",
          latestVersion: "1.1.0",
          hasUpdate: true,
          lastChecked: null,
        }}
        dismissedVersion={null}
        onDismiss={onDismiss}
        onCopyCommand={onCopyCommand}
      />,
    );

    const copy = screen.getByRole("button", { name: "Copy Command" });
    const dismiss = screen.getByRole("button", { name: "Dismiss" });
    sharedButton(copy);
    sharedButton(dismiss);

    fireEvent.click(copy);
    expect(onCopyCommand).toHaveBeenCalledTimes(1);
    fireEvent.click(dismiss);
    // Dismissing is per-version, so the version it dismissed has to travel with the call.
    expect(onDismiss).toHaveBeenCalledWith("1.1.0");
  });

  it("draws the recommendation card's accept and decline with the shared button", () => {
    const onAccept = vi.fn();
    const onDecline = vi.fn();
    render(
      <RecommendationCard
        recommendation={{
          title: "Support Dark Mode",
          description: "Implement dark theme palette.",
          impact: "High",
          state: "Pending",
        }}
        onAccept={onAccept}
        onDecline={onDecline}
      />,
    );

    sharedButton(screen.getByRole("button", { name: "Accept" }));
    sharedButton(screen.getByRole("button", { name: "Decline" }));

    fireEvent.click(screen.getByRole("button", { name: "Accept" }));
    expect(onAccept).toHaveBeenCalledWith("Support Dark Mode");
  });

  it("draws the service banner's three recovery actions with the shared button", () => {
    const serviceInfo: ServiceInfo = {
      state: "NotRunning",
      tendrilHome: "/Users/me/.tendril",
      capabilities: [],
      message: "The daemon is not running.",
    };
    render(
      <ServiceStatusBanner
        serviceInfo={serviceInfo}
        onRestart={() => {}}
        onRepair={() => {}}
        onViewDiagnostics={() => {}}
      />,
    );

    for (const name of ["Restart Service", "Repair Service", "Diagnostics"]) {
      sharedButton(screen.getByRole("button", { name }));
    }
    // Repair is the one that changes something on the machine, so it keeps its warning tint.
    expect(screen.getByRole("button", { name: "Repair Service" })).toHaveClass("text-warning");
  });
});

describe("shared IconButton adoption", () => {
  it("names the composer attachment's remove by file, and draws it as the shared icon button", () => {
    const onRemove = vi.fn();
    render(
      <ComposerAttachment
        attachment={{ name: "notes.md", path: "/Users/me/notes.md" }}
        onRemove={onRemove}
      />,
    );

    // Not "Remove file": two chips in a row would then offer the same name and there would be no
    // way to say which one to press.
    const remove = screen.getByRole("button", { name: "Remove notes.md" });
    expect(remove).toHaveClass("tui-icon-btn");
    expect(remove).toHaveAttribute("data-size", "xs");
    // IconButton routes its text through a Radix tooltip, so there is no native `title` to find.
    expect(remove).not.toHaveAttribute("title");

    fireEvent.click(remove);
    expect(onRemove).toHaveBeenCalledTimes(1);
  });
});
