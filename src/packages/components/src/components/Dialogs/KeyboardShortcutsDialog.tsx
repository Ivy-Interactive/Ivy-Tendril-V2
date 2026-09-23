import * as React from "react";
import { Button } from "../ui/button";
import { TuiKbd } from "../ui/TuiKbd";
import { getPlatformShortcut } from "../../lib/shortcut";
import { useLocale, useTranslation } from "@/i18n/uiPanels";
import { DialogShell } from "./DialogShell";

/**
 * A shortcut as the help lists it: the shape `getRegisteredShortcuts()` returns, narrowed to what is
 * rendered, so the app can hand the registry's answer straight through.
 */
export interface KeyboardShortcutEntry {
  id: string;
  /** The raw chord (`Ctrl+K`), mapped to the platform's keys when it renders. */
  displayKey: string;
  /** Already in the UI language: each view registers its shortcuts with translated descriptions. */
  description: string;
  /** Registered but not firing right now - its view is mounted but not in front. Rendered dimmed. */
  isActive: boolean;
}

export interface KeyboardShortcutsDialogProps {
  isOpen: boolean;
  onClose: () => void;
  /** What is registered now. The dialog sorts it; the caller only reads the registry. */
  shortcuts: readonly KeyboardShortcutEntry[];
}

/**
 * The keyboard shortcut help, opened with `?`. V2 only: V1 has no such dialog.
 *
 * It lists what the shortcut registry holds at the moment it opens rather than a hardcoded table: a
 * shortcut registered by a view is only live while that view is mounted, so this is the honest
 * answer to "what will actually fire right now". Sorted by description in the UI language's
 * collation for a deterministic order the registry's insertion order would not give.
 *
 * Presentational: the app's wrapper reads `getRegisteredShortcuts()` on open and passes the result.
 */
export function KeyboardShortcutsDialog({
  isOpen,
  onClose,
  shortcuts,
}: KeyboardShortcutsDialogProps) {
  const { t } = useTranslation("uiPanels");
  const { language } = useLocale();
  const closeRef = React.useRef<HTMLButtonElement>(null);

  const sorted = React.useMemo(
    () => [...shortcuts].sort((a, b) => a.description.localeCompare(b.description, language)),
    [shortcuts, language],
  );

  return (
    <DialogShell
      isOpen={isOpen}
      onClose={onClose}
      title={t("shortcutsHelp.title")}
      testId="shortcuts-dialog"
      initialFocusRef={closeRef}
      footer={
        <Button ref={closeRef} variant="outline" onClick={onClose} data-testid="dialog-close">
          {t("shortcutsHelp.close")}
        </Button>
      }
    >
      <div className="space-y-3">
        {sorted.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("shortcutsHelp.empty")}</p>
        ) : (
          sorted.map((s) => (
            <div
              key={s.id}
              data-testid="shortcut-row"
              aria-disabled={s.isActive ? undefined : true}
              className={`flex items-center justify-between text-sm ${s.isActive ? "" : "opacity-50"}`}
            >
              <span className="text-muted-foreground">{s.description}</span>
              {/* Platform mapping first, then the key cap: the registry resolves a `Ctrl+` binding
                  to Command on Mac, so labelling it "Ctrl" there would name a key that does not fire
                  it. `TuiKbd` glues single-character keys the way every other hint in the app does. */}
              <TuiKbd keys={getPlatformShortcut(s.displayKey)} />
            </div>
          ))
        )}
      </div>
    </DialogShell>
  );
}
