import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { AutoAcceptSettingsDialog } from "../AutoAcceptSettingsDialog";
import { DirtyRepoDialog } from "@ivy-interactive/components/tendril";
import { NoProjectsDialog } from "@ivy-interactive/components/tendril";
import { PendingAnnotationsDialog } from "@ivy-interactive/components/tendril";
import { ShareTunnelDialog, type ShareTunnelApi } from "../ShareTunnelDialog";
import { bridge } from "../../../api/bridge";
import type { RepoStatus, TendrilConfig } from "../../../types/api";

/**
 * The visible half of `DialogShell`'s `shortcut`, and the dialogs that had no chord to make visible.
 *
 * `ConfirmShape.test.tsx` covers the twelve confirms, since they all funnel through `ConfirmDialog`.
 * This file covers the rest: the dialogs that compose `DialogShell` directly and nominate their own
 * primary, plus the two that are excluded on purpose and must stay excluded.
 *
 * Every assertion here is about the pairing rather than the key cap on its own. A cap with no chord
 * behind it names a key that does nothing, and a chord with no cap is the bug this change fixes —
 * the operator could not tell Ctrl+Enter existed. So each dialog is asserted both ways: the chord
 * fires the primary, and the cap sits inside the button the chord fires.
 *
 * `DialogShell` reads `event.ctrlKey || event.metaKey`, so Cmd and Ctrl are the same chord on both
 * platforms and there is nothing platform-specific to stub. The keydown goes to the dialog element
 * because that is where `onKeyDown` lives and where a real press inside the focus trap bubbles from.
 */
function hintIn(testId: string): HTMLElement | null {
  return screen.getByTestId(testId).querySelector(".tui-kbd");
}

function chord(init: KeyboardEventInit = { metaKey: true }): void {
  fireEvent.keyDown(screen.getByRole("dialog"), { key: "Enter", ...init });
}

const DIRTY: RepoStatus[] = [
  { path: "/repos/Tendril-App", isDirty: true, changes: [" M src/App.tsx"], changeCount: 1 },
];

function config(overrides: Partial<TendrilConfig> = {}): TendrilConfig {
  return { codingAgent: "claude", ...overrides };
}

afterEach(() => {
  vi.restoreAllMocks();
});

/**
 * The third of the three execute guards. The other two already bound the chord, so a user who
 * learned it on `UnansweredQuestionsDialog` found it dead here — the inconsistency this closes.
 */
describe("DirtyRepoDialog", () => {
  it("proceeds on the chord", () => {
    const onProceed = vi.fn();
    render(<DirtyRepoDialog isOpen onClose={vi.fn()} dirtyRepos={DIRTY} onProceed={onProceed} />);

    chord();

    expect(onProceed).toHaveBeenCalledTimes(1);
  });

  it("proceeds on Ctrl+Enter as well as Cmd+Enter", () => {
    const onProceed = vi.fn();
    render(<DirtyRepoDialog isOpen onClose={vi.fn()} dirtyRepos={DIRTY} onProceed={onProceed} />);

    chord({ ctrlKey: true });

    expect(onProceed).toHaveBeenCalledTimes(1);
  });

  it("advertises the chord on the proceed button, and nowhere else", () => {
    render(<DirtyRepoDialog isOpen onClose={vi.fn()} dirtyRepos={DIRTY} onProceed={vi.fn()} />);

    expect(hintIn("guard-proceed")).not.toBeNull();
    expect(hintIn("dialog-cancel")).toBeNull();
  });

  /** The chord must not become a second way to decline: a bare Enter is still nothing here. */
  it("ignores a bare Enter", () => {
    const onProceed = vi.fn();
    const onClose = vi.fn();
    render(<DirtyRepoDialog isOpen onClose={onClose} dirtyRepos={DIRTY} onProceed={onProceed} />);

    chord({});

    expect(onProceed).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  /** The cap names the label's chord, not a different one, and stays out of the accessible name. */
  it("keeps the proceed button's accessible name to its label", () => {
    render(<DirtyRepoDialog isOpen onClose={vi.fn()} dirtyRepos={DIRTY} onProceed={vi.fn()} />);

    expect(hintIn("guard-proceed")).toHaveAttribute("aria-hidden", "true");
    expect(screen.getByRole("button", { name: "Execute Anyway" })).toBe(
      screen.getByTestId("guard-proceed"),
    );
  });
});

/**
 * The one dialog whose chord appears and disappears with a prop: `onUpdateAndExecute` is what
 * nominates a primary at all, so the cap has to be inside the same conditional as the spread.
 */
describe("PendingAnnotationsDialog", () => {
  it("fires Update Plan & Execute on the chord", () => {
    const onUpdateAndExecute = vi.fn();
    render(
      <PendingAnnotationsDialog
        isOpen
        onClose={vi.fn()}
        annotationCount={2}
        onUpdatePlan={vi.fn()}
        onProceed={vi.fn()}
        onUpdateAndExecute={onUpdateAndExecute}
      />,
    );

    chord();

    expect(onUpdateAndExecute).toHaveBeenCalledTimes(1);
  });

  it("puts the cap on the button the chord fires rather than on the decline", () => {
    render(
      <PendingAnnotationsDialog
        isOpen
        onClose={vi.fn()}
        annotationCount={2}
        onUpdatePlan={vi.fn()}
        onProceed={vi.fn()}
        onUpdateAndExecute={vi.fn()}
      />,
    );

    expect(hintIn("guard-update-and-execute")).not.toBeNull();
    expect(hintIn("guard-proceed")).toBeNull();
    expect(hintIn("guard-update-plan")).toBeNull();
  });

  /**
   * Without `onUpdateAndExecute` the shell is given no chord at all, so a cap anywhere in this
   * footer would name a key that does nothing. `guard-proceed` is a decline and must not inherit it.
   */
  it("advertises nothing when no primary was supplied", () => {
    const onProceed = vi.fn();
    render(
      <PendingAnnotationsDialog
        isOpen
        onClose={vi.fn()}
        annotationCount={2}
        onUpdatePlan={vi.fn()}
        onProceed={onProceed}
      />,
    );

    expect(screen.getByTestId("pending-annotations-dialog").querySelector(".tui-kbd")).toBeNull();
    chord();
    expect(onProceed).not.toHaveBeenCalled();
  });
});

describe("AutoAcceptSettingsDialog", () => {
  it("saves on the chord once the config has loaded", async () => {
    vi.spyOn(bridge, "getConfig").mockResolvedValue(
      config({ inbox: { autoAcceptAssignedIssues: true, checkIntervalMinutes: 30 } }),
    );
    const putConfig = vi.spyOn(bridge, "putConfig").mockResolvedValue(undefined);

    render(<AutoAcceptSettingsDialog isOpen onClose={vi.fn()} />);
    await screen.findByLabelText("Auto-Accept Assigned Issues");

    chord();

    await waitFor(() =>
      expect(putConfig).toHaveBeenCalledWith("inbox", {
        autoAcceptAssignedIssues: true,
        checkIntervalMinutes: 30,
      }),
    );
  });

  it("advertises the chord on Save and not on Check Now", async () => {
    vi.spyOn(bridge, "getConfig").mockResolvedValue(config());

    render(<AutoAcceptSettingsDialog isOpen onClose={vi.fn()} />);
    await screen.findByLabelText("Auto-Accept Assigned Issues");

    expect(hintIn("dialog-confirm")).not.toBeNull();
    expect(hintIn("auto-accept-check-now")).toBeNull();
  });

  /**
   * The load gate is not cosmetic here. Until `getConfig` resolves the two controls hold their
   * defaults rather than the saved settings, so a chord that fired through it would write
   * `false`/15 over whatever the operator had — which is why the cap is withheld too.
   */
  it("neither fires nor advertises the chord while the config is still loading", async () => {
    let resolveConfig: (value: TendrilConfig) => void = () => {};
    vi.spyOn(bridge, "getConfig").mockReturnValue(
      new Promise<TendrilConfig>((resolve) => {
        resolveConfig = resolve;
      }),
    );
    const putConfig = vi.spyOn(bridge, "putConfig").mockResolvedValue(undefined);

    render(<AutoAcceptSettingsDialog isOpen onClose={vi.fn()} />);
    await screen.findByRole("dialog");

    expect(screen.getByTestId("dialog-confirm")).toBeDisabled();
    expect(hintIn("dialog-confirm")).toBeNull();
    chord();
    expect(putConfig).not.toHaveBeenCalled();

    resolveConfig(config());
    await waitFor(() => expect(hintIn("dialog-confirm")).not.toBeNull());
  });
});

describe("NoProjectsDialog", () => {
  it("opens settings on the chord", () => {
    const onOpenSettings = vi.fn();
    render(<NoProjectsDialog isOpen onClose={vi.fn()} onOpenSettings={onOpenSettings} />);

    chord();

    expect(onOpenSettings).toHaveBeenCalledTimes(1);
  });

  it("advertises the chord on Go to Projects", () => {
    render(<NoProjectsDialog isOpen onClose={vi.fn()} onOpenSettings={vi.fn()} />);

    expect(hintIn("open-settings")).not.toBeNull();
    expect(screen.getByRole("button", { name: "Go to Projects" })).toBe(
      screen.getByTestId("open-settings"),
    );
  });
});

/**
 * The deliberate exclusion, asserted so a later audit cannot "fix" it into existence.
 *
 * This dialog's footer is a lone Close — a decline, which Escape already owns — and its real actions
 * are status-dependent body buttons. A single chord over that pair would start a tunnel in one state
 * and tear it down in another.
 */
describe("ShareTunnelDialog stays out of the chord contract", () => {
  const disabledApi = (): ShareTunnelApi => ({
    getStatus: vi.fn().mockResolvedValue({ status: "disabled", installed: true, sharePort: 0 }),
    start: vi.fn(),
    stop: vi.fn(),
  });

  it("advertises no chord anywhere, including on the body's start button", async () => {
    render(<ShareTunnelDialog isOpen onClose={vi.fn()} api={disabledApi()} />);

    await screen.findByTestId("share-start");
    expect(screen.getByTestId("share-tunnel-dialog").querySelector(".tui-kbd")).toBeNull();
  });

  it("does not start a tunnel on the chord", async () => {
    const api = disabledApi();
    render(<ShareTunnelDialog isOpen onClose={vi.fn()} api={api} />);
    await screen.findByTestId("share-start");

    chord();

    expect(api.start).not.toHaveBeenCalled();
  });
});
