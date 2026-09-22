import React from "react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  BladeContainer,
} from "@ivy-interactive/components/ui";
import type { BladeDescriptor } from "@ivy-interactive/components/ui";
import { useTranslation } from "../i18n";

/**
 * The Dashboard's KPI drill-down, on the shared `ui/sheet.tsx` — same side, header and close
 * behaviour as `JobCostSheet`/`JobDebugSheet`'s sheets in JobsView. It used to be a hand-rolled
 * `fixed inset-0` overlay with a literal `max-w-[72rem]`, which had no responsive breakpoints and
 * clipped a blade's content on anything narrower.
 */
export interface DashboardKpiSheetProps {
  /** The selected KPI's blade, or `null` to keep the sheet closed. */
  blade: BladeDescriptor | null;
  onClose: () => void;
}

export const DashboardKpiSheet: React.FC<DashboardKpiSheetProps> = ({ blade, onClose }) => {
  const { t } = useTranslation("dashboard");
  return (
    <Sheet
      open={blade !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <SheetContent
        data-testid="kpi-breakdown"
        className="inset-y-0 flex w-full flex-col overflow-hidden p-0 sm:w-3/4 sm:max-w-none lg:w-3/4 xl:w-3/5"
      >
        <SheetHeader className="sr-only">
          <SheetTitle>{blade?.title ?? t("kpiSheet.title")}</SheetTitle>
        </SheetHeader>
        {blade && (
          <BladeContainer
            root={{
              ...blade,
              // The descriptor's own width hint is what it gets when something pushes it deeper
              // in a stack; as the root of this sheet it fills the panel instead.
              width: "flex",
            }}
            className="min-h-0 flex-1"
          />
        )}
      </SheetContent>
    </Sheet>
  );
};
