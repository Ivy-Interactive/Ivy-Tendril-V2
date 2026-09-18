import React from "react";
import { Button, TuiKbd } from "@ivy-interactive/components/ui";
import {
  getPlatformShortcut,
  getRegisteredShortcuts,
} from "@ivy-interactive/components/tendril";
import { DialogShell } from "../views/dialogs/DialogShell";

interface KeyboardShortcutsHelpProps {
  isOpen: boolean;
  onClose: () => void;
}

export const KeyboardShortcutsHelp: React.FC<KeyboardShortcutsHelpProps> = ({
  isOpen,
  onClose,
}) => {
  const closeRef = React.useRef<HTMLButtonElement>(null);

  // Read from the registry on open rather than subscribed to: a shortcut registered by a view is only
  // live while that view is mounted, so this is the honest answer to "what will actually fire right
  // now". Sorted by description for a deterministic order the registry's insertion order won't give.
  const shortcuts = React.useMemo(
    () =>
      isOpen
        ? [...getRegisteredShortcuts()].sort((a, b) => a.description.localeCompare(b.description))
        : [],
    [isOpen],
  );

  return (
    <DialogShell
      isOpen={isOpen}
      onClose={onClose}
      title="Keyboard Shortcuts"
      testId="shortcuts-dialog"
      initialFocusRef={closeRef}
      footer={
        <Button ref={closeRef} variant="outline" onClick={onClose} data-testid="dialog-close">
          Close
        </Button>
      }
    >
      <div className="space-y-3">
        {shortcuts.length === 0 ? (
          <p className="text-sm text-muted-foreground">No keyboard shortcuts are active.</p>
        ) : (
          shortcuts.map((s) => (
            <div
              key={s.id}
              aria-disabled={s.isActive ? undefined : true}
              className={`flex items-center justify-between text-sm ${
                s.isActive ? "" : "opacity-50"
              }`}
            >
              <span className="text-muted-foreground">{s.description}</span>
              {/* Platform mapping first, then the library's key cap: the registry resolves a
                  `Ctrl+` binding to Command on Mac, so labelling it "Ctrl" there would name a key
                  that does not fire it. getPlatformShortcut answers ⌘/⌥/⇧ per platform and `TuiKbd`
                  glues single-character keys the way every other hint in the app does. */}
              <TuiKbd keys={getPlatformShortcut(s.displayKey)} />
            </div>
          ))
        )}
      </div>
    </DialogShell>
  );
};
