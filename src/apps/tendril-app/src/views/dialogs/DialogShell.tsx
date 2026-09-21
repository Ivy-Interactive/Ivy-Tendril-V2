import * as React from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  TuiKbd,
} from "@ivy-interactive/components/ui";
import { DIALOG_WIDTH, type DialogWidth } from "./fieldStyles";

/**
 * The chords a dialog is allowed to nominate. Shared by `DialogShellProps.shortcut` and
 * {@link DialogShortcutHint} so a rendered cap can never name a chord the shell does not listen
 * for — `handleKeyDown` below rejects a `Ctrl+Enter` outright when the dialog declared bare
 * `Enter`, and `SuggestChangesDialog` renders one shell of each.
 */
export type DialogShortcut = "Enter" | "Ctrl+Enter";

export interface DialogShellProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  description?: React.ReactNode;
  testId: string;
  /** Focused when the dialog opens. Never the destructive confirm. */
  initialFocusRef?: React.RefObject<HTMLElement | null>;
  footer: React.ReactNode;
  children?: React.ReactNode;
  /** Overrides the accessible name Radix would otherwise derive from `title` via `aria-labelledby`. */
  ariaLabel?: string;
  /** V1's `.Width(Size.Rem(n))` on the `Dialog`; `default` is Ivy's own width. */
  width?: DialogWidth;
  /**
   * V1's `.ShortcutKey(...)` on the primary footer button, and `onShortcut` is that button's click.
   *
   * `Ctrl+Enter` is honoured everywhere in the dialog, a multi-line field included — that modifier is
   * why V1 puts it on the dialogs that have one. Bare `Enter` is ignored while a `textarea` or a
   * button holds focus: a newline is what Enter means in the first, and the second already fires its
   * own click, which would submit twice.
   *
   * Declaring it only binds the key. The *visible* half is {@link DialogShortcutHint}, which the
   * nominated button renders — see that component for why the shell cannot inject it itself.
   */
  shortcut?: DialogShortcut;
  onShortcut?: () => void;
  /**
   * Extra classes on the footer row. `flex-wrap` is the port of V1's `Layout.Wrap()`, which the
   * dialogs carrying three or four choices use so the last one does not fall off a narrow window.
   */
  footerClassName?: string;
}

/**
 * The key cap for the chord a dialog declared, rendered *inside* the button that chord fires.
 *
 * The shell binds `shortcut` and the footer renders the button, and until now those were the two
 * halves of V1's `.ShortcutKey(...)` with only one of them visible: ten dialogs listened for
 * Ctrl+Enter and not one showed a cap, so the only way to discover the chord was to read this file.
 *
 * Three decisions worth keeping:
 *
 * - **`TuiKbd`, not `ShortcutKeys`/`Kbd`.** `TuiKbd` is `aria-hidden` (`TuiKbd.tsx`: "a button
 *   labelled 'Execute Plan' carrying an `X` hint announces itself as 'Execute Plan X'"), so the cap
 *   decorates the button without joining its accessible name — which is what lets every existing
 *   `getByRole("button", { name })` in the suite keep working, and what keeps `ConfirmDialog`'s
 *   contract point 3 ("the label is the verb") true of the name a screen reader reads.
 * - **`platform`, not `getPlatformShortcut`.** The prop defaults to `false`, and without it the cap
 *   reads a literal "Ctrl+Enter" on a Mac. `getPlatformShortcut` is right for
 *   `KeyboardShortcutsHelp`, which formats arbitrary registry `displayKey` strings, but it
 *   uppercases the key word into "⌘+ENTER"; `TuiKbd`'s own mapping gives ⌘/Ctrl *and* glyphs Enter
 *   as ↵.
 * - **`outline`.** The documented variant for "hints on a colored surface ... where the cap must
 *   ride the parent's own text color" (`ui.css`), which is exactly a filled or destructive button.
 *
 * Typed against the same union as `DialogShellProps.shortcut`, so a cap that names a chord the
 * shell would reject is a type error rather than a wrong label. The shell cannot render this into
 * `footer` itself: `footer` is an opaque `ReactNode` and there is no reliable way to pick the
 * primary button out of it, so the nominated button opts in by rendering the hint as its last
 * child. `ContentInput`'s submit button is the precedent this copies.
 */
export function DialogShortcutHint({ shortcut }: { shortcut: DialogShortcut }) {
  return <TuiKbd keys={shortcut} platform variant="outline" />;
}

/**
 * The wrapper every lifecycle dialog composes, so the accessibility contract is
 * implemented once instead of per dialog:
 *
 * 1. Focus moves into the dialog on open, onto `initialFocusRef` — which every
 *    confirm dialog points at *Cancel*. Radix's default is "first tabbable
 *    node", which would land on the header close button, or in a body-less
 *    dialog could reach the confirm. A focused destructive button turns a stray
 *    Enter into a deletion.
 * 2. Focus returns to whatever opened the dialog on close. Radix restores to a
 *    `DialogTrigger`, but these dialogs open from controlled state, so the
 *    invoker is captured and restored explicitly.
 * 3. Escape cancels, via Radix's `onOpenChange(false)`. It must never confirm.
 * 4. A click on the overlay does **not** dismiss, which is Framework's rule for
 *    every dialog it renders (`DialogWidget.tsx`: `onInteractOutside={(e) =>
 *    e.preventDefault()}`). A dialog that asks a question has to be answered by
 *    Cancel, Escape or the header close button, so a misplaced click can neither
 *    lose typed input nor be mistaken for having declined.
 * 5. `role="dialog"`/`aria-modal` come from Radix; a `DialogTitle` is always
 *    rendered, since Radix warns without one.
 * 6. `shortcut` is the keyboard half of V1's primary footer button, gated so it
 *    can only ever fire the *non*-destructive action a dialog nominates. The
 *    button it fires renders {@link DialogShortcutHint}, so the chord is
 *    advertised where it is pressed rather than only in this file.
 */
export function DialogShell({
  isOpen,
  onClose,
  title,
  description,
  testId,
  initialFocusRef,
  footer,
  children,
  ariaLabel,
  width = "default",
  shortcut,
  onShortcut,
  footerClassName,
}: DialogShellProps) {
  const invokerRef = React.useRef<HTMLElement | null>(null);

  React.useEffect(() => {
    if (isOpen) {
      invokerRef.current = document.activeElement as HTMLElement | null;
    }
  }, [isOpen]);

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Enter" || onShortcut === undefined) return;
    // The registry's rule for every other shortcut in the app (`shortcutRegistry.handleKeyDown`: "an
    // auto-repeat ... is not a fresh shortcut press"). It matters more here than there: a held
    // Ctrl+Enter repeats faster than React re-renders the busy state, so without this a leaned-on key
    // can dispatch the same delete several times before `isBusy` has closed the door.
    if (event.repeat) return;

    const wantsModifier = shortcut === "Ctrl+Enter";
    const hasModifier = event.ctrlKey || event.metaKey;
    if (wantsModifier !== hasModifier) return;

    if (!wantsModifier) {
      const tag = (event.target as HTMLElement | null)?.tagName;
      if (tag === "TEXTAREA" || tag === "BUTTON") return;
    }

    event.preventDefault();
    onShortcut();
  };

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        data-testid={testId}
        className={DIALOG_WIDTH[width]}
        onKeyDown={handleKeyDown}
        // Framework's own dialog host does exactly this, for every dialog: a click on the overlay is
        // not an answer to the question the dialog is asking.
        onInteractOutside={(event) => event.preventDefault()}
        // Radix gives `role="dialog"` and hides the rest of the tree with
        // `aria-hidden`, but this version emits no `aria-modal`, so it is set
        // here. A dialog with only one of the two reads as inert markup to some
        // screen readers.
        aria-modal="true"
        // Radix points `aria-describedby` at a `DialogDescription` it assumes is
        // there, and warns when it is not. A dialog with no `description` has
        // nothing to describe it, so the attribute is dropped deliberately —
        // which is also how Radix asks to be told the omission is intended.
        {...(description === undefined ? { "aria-describedby": undefined } : {})}
        {...(ariaLabel !== undefined ? { "aria-label": ariaLabel } : {})}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          const target = initialFocusRef?.current ?? (event.currentTarget as HTMLElement | null);
          target?.focus();
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          invokerRef.current?.focus();
        }}
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description !== undefined && (
            <DialogDescription className="mt-1">{description}</DialogDescription>
          )}
        </DialogHeader>
        {children !== undefined && (
          <div className="flex-1 overflow-y-auto px-6 pb-2 text-sm text-foreground">{children}</div>
        )}
        <DialogFooter className={footerClassName}>{footer}</DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
