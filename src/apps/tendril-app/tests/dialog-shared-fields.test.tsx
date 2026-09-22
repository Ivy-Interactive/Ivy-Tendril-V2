import { describe, it, expect, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { ConfirmDialog } from "@ivy-interactive/components/dialogs";
import { CreateIssueDialog } from "../src/views/dialogs/CreateIssueDialog";
import { planDetail } from "./fixtures/plan.fixture";

/**
 * Audit item B6: the lifecycle dialogs hand-rolled their fields and their error banner in
 * `fieldStyles.ts` - a `FIELD_CLASS` that is the shared `Input`'s classes retyped, and an
 * `ALERT_CLASS` div that is a `Callout.Error` retyped. Both now use the shared component.
 *
 * The visual weight is the point of the change, so it is what these pin. Two things could regress
 * silently: the error banner reverting to the heavier hand-rolled box (`border-destructive/50`,
 * where the shared `Callout` is `/20`), and the accessibility contract of `role="alert"` being lost
 * on the way - a dozen existing tests query `getByRole("alert")`, and a `Callout` only emits it for
 * the `error` and `warning` variants.
 */
afterEach(() => cleanup());

describe("dialog errors render as the shared Callout", () => {
  it("keeps role=alert so the failure is announced", () => {
    render(
      <ConfirmDialog
        isOpen
        onClose={() => {}}
        title="Delete Plan"
        body="This cannot be undone."
        confirmLabel="Delete"
        onConfirm={() => {}}
        error="The daemon refused: plan is running."
      />,
    );

    expect(screen.getByRole("alert")).toHaveTextContent(/plan is running/);
  });

  it("draws the Callout's lighter destructive border, not the hand-rolled /50 one", () => {
    render(
      <ConfirmDialog
        isOpen
        onClose={() => {}}
        title="Delete Plan"
        body="This cannot be undone."
        confirmLabel="Delete"
        onConfirm={() => {}}
        error="The daemon refused."
      />,
    );

    const alert = screen.getByRole("alert");
    expect(alert.className).toContain("border-destructive/20");
    expect(alert.className).not.toContain("border-destructive/50");
  });
});

describe("dialog fields are the shared Input and Textarea", () => {
  const issueDialog = (
    <CreateIssueDialog
      isOpen
      onClose={() => {}}
      plan={planDetail({ id: "00021", repos: ["/repos/Ivy-Tendril-V2"] })}
    />
  );

  it("gives a text field the shared Input's shadow and fixed height", () => {
    render(issueDialog);

    // `inputVariant`: `shadow-sm` and `h-9` at Medium density. The hand-rolled `FIELD_CLASS` had
    // neither, so its height came from padding alone and it sat flat against the dialog.
    const assignee = screen.getByLabelText("Assignee");
    expect(assignee.className).toContain("shadow-sm");
    expect(assignee.className).toContain("h-9");
  });

  it("keeps a multiline field free of the single-line height", () => {
    render(issueDialog);

    // The shared `Textarea` sets `min-h-[60px]` and no fixed height, so `rows` still decides the
    // size. A `Textarea` that inherited `h-9` from the Input variant would be one line tall.
    const comment = screen.getByLabelText("Comment");
    expect(comment.tagName).toBe("TEXTAREA");
    expect(comment.className).toContain("min-h-[60px]");
    expect(comment.className).not.toContain("h-9");
    // `FIELD_CLASS` carried `text-sm`; `Textarea` sets no text size, so it must be passed.
    expect(comment.className).toContain("text-sm");
  });

  it("styles the native select from the shared Input's own variant", () => {
    render(issueDialog);

    // A native select, because the shared `Select` is Radix and `fireEvent.change` cannot drive
    // it - but styled from `inputVariant` itself rather than a retyped copy.
    const repo = screen.getByLabelText("Repository");
    expect(repo.tagName).toBe("SELECT");
    expect(repo.className).toContain("shadow-sm");
    expect(repo.className).toContain("border-input");
  });
});
