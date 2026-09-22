import { memo } from "react";
import { renderMermaid } from "@/lib/diagram";
import { useDiagramRender } from "@/hooks/use-diagram-render";
import { useTranslation } from "@/i18n/uiPlanWorkspace";

interface MermaidRendererProps {
  content: string;
}

export const MermaidRenderer = memo(({ content }: MermaidRendererProps) => {
  const { t } = useTranslation("uiPlanWorkspace");
  const { elementRef, isLoading, error } = useDiagramRender(content, renderMermaid);

  if (error) {
    return (
      <div className="pmv-diagram-error">
        <span>{t("diagram.invalidMermaid")}</span>
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

MermaidRenderer.displayName = "MermaidRenderer";
