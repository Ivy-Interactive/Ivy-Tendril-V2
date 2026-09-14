import React from "react";

interface KeyboardShortcutsHelpProps {
  isOpen: boolean;
  onClose: () => void;
}

export const KeyboardShortcutsHelp: React.FC<KeyboardShortcutsHelpProps> = ({
  isOpen,
  onClose,
}) => {
  if (!isOpen) return null;

  const shortcuts = [
    { key: "Cmd/Ctrl + B", desc: "Toggle sidebar collapse" },
    { key: "Cmd/Ctrl + Shift + C", desc: "Switch to Chat" },
    { key: "Cmd/Ctrl + I", desc: "Open GitHub issue inbox" },
    { key: "Cmd/Ctrl + K", desc: "Focus quick search across plans" },
    { key: "Cmd/Ctrl + N", desc: "Open new plan intake modal" },
    { key: "/", desc: "Focus search bar in plans explorer" },
    { key: "Up / Down", desc: "Navigate through plan items" },
    { key: "Enter", desc: "Open selected plan" },
    { key: "Escape", desc: "Close modals or overlays" },
  ];

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
          {shortcuts.map((s, idx) => (
            <div key={idx} className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">{s.desc}</span>
              <kbd className="rounded bg-muted px-2.5 py-1 font-mono text-xs text-foreground border border-border">
                {s.key}
              </kbd>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
