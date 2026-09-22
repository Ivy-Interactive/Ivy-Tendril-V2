"use client";

import { useErrorSheet } from "@/hooks/use-error-sheet";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { ErrorDisplay } from "@/components/ErrorDisplay";
import { useTranslation } from "@/i18n/uiCommon";

export function ErrorSheet() {
  const { t } = useTranslation("uiCommon");
  const { errors, hideError, clearError } = useErrorSheet();

  return (
    <>
      {errors.map(({ id, title, message, stackTrace, open }) => (
        <Sheet
          key={id}
          open={open}
          onOpenChange={(isOpen) => {
            if (!isOpen) {
              hideError(id);
              setTimeout(() => clearError(id), 300);
            }
          }}
        >
          <SheetContent
            side="right"
            className="w-full sm:max-w-lg flex flex-col h-full overflow-hidden"
          >
            <SheetHeader>
              <SheetTitle>{t("errorSheet.title")}</SheetTitle>
              <SheetDescription>{t("errorSheet.description")}</SheetDescription>
            </SheetHeader>
            <div className="flex-1 min-h-0 flex flex-col">
              <ErrorDisplay title={title} message={message} stackTrace={stackTrace} />
            </div>
          </SheetContent>
        </Sheet>
      ))}
    </>
  );
}
