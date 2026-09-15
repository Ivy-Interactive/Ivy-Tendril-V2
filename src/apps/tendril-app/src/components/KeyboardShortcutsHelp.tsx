import React from "react";
import { formatShortcut, getRegisteredShortcuts } from "@ivy-interactive/components/tendril";

interface KeyboardShortcutsHelpProps {
  isOpen: boolean;
  onClose: () => void;
}

export const KeyboardShortcutsHelp: React.FC<KeyboardShortcutsHelpProps> = ({
  isOpen,
  onClose,
}) => {
  if (!isOpen) return null;

  // Read from the registry on open rather than subscribed to: a shortcut registered by a view is only
  // live while that view is mounted, so this is the honest answer to "what will actually fire right
  // now". Sorted by description for a deterministic order the registry's insertion order won't give.
  const shortcuts = [...getRegisteredShortcuts()].sort((a, b) =>
    a.description.localeCompare(b.description),
  );

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="shortcuts-dialog-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border pb-4">
          <h2 id="shortcuts-dialog-title" className="text-lg font-bold text-foreground">
            Keyboard Shortcuts
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close dialog"
            className="rounded p-1 text-muted-foreground hover:text-foreground"
          >
            ✕
          </button>
        </div>

        <div className="mt-4 space-y-3">
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
                <kbd className="rounded bg-muted px-2.5 py-1 font-mono text-xs text-foreground border border-border">
                  {formatShortcut(s.displayKey)}
                </kbd>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};
