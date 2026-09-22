import { memo } from "react";
import { renderGraphviz } from "@/lib/diagram";
import { useDiagramRender } from "@/hooks/use-diagram-render";
import { useTranslation } from "@/i18n/uiPlanWorkspace";

interface GraphvizRendererProps {
  content: string;
}

export const GraphvizRenderer = memo(({ content }: GraphvizRendererProps) => {
  const { t } = useTranslation("uiPlanWorkspace");
  const { elementRef, isLoading, error } = useDiagramRender(content, renderGraphviz);

  if (error) {
    return (
      <div className="pmv-diagram-error">
        <span>{t("diagram.invalidGraphviz")}</span>
      </div>
    );
  }

  return (
    <div className="pmv-diagram-container">
      {isLoading && (
        <div className="pmv-diagram-loading">
          <span>{t("diagram.loading")}</span>
        </div>
      )}
      <div ref={elementRef} style={{ minHeight: isLoading ? "100px" : "auto" }} />
    </div>
  );
});

GraphvizRenderer.displayName = "GraphvizRenderer";
