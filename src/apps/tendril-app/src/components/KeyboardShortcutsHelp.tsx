import React from "react";
import { getRegisteredShortcuts } from "@ivy-interactive/components/tendril";
import { KeyboardShortcutsDialog } from "@ivy-interactive/components/dialogs";

interface KeyboardShortcutsHelpProps {
  isOpen: boolean;
  onClose: () => void;
}

/**
 * The connected half of the library's `KeyboardShortcutsDialog`, opened with `?` (`App.tsx` loads
 * this lazily). It reads the shortcut registry on open rather than subscribing to it: a shortcut
 * registered by a view is only live while that view is mounted, so the snapshot taken as the dialog
 * opens is the honest answer to "what will actually fire right now". The dialog sorts and renders.
 */
export const KeyboardShortcutsHelp: React.FC<KeyboardShortcutsHelpProps> = ({
  isOpen,
  onClose,
}) => {
  const shortcuts = React.useMemo(() => (isOpen ? getRegisteredShortcuts() : []), [isOpen]);
  return <KeyboardShortcutsDialog isOpen={isOpen} onClose={onClose} shortcuts={shortcuts} />;
};
