import { memo } from "react";
import { renderMermaid } from "@/lib/diagram";
import { useDiagramRender } from "@/hooks/use-diagram-render";

interface MermaidRendererProps {
  content: string;
}

export const MermaidRenderer = memo(({ content }: MermaidRendererProps) => {
  const { elementRef, isLoading, error } = useDiagramRender(content, renderMermaid);

  if (error) {
    return (
      <div className="pmv-diagram-error">
        <span>Invalid Mermaid diagram syntax</span>
      </div>
    );
  }

  return (
    <div className="pmv-diagram-container">
      {isLoading && (
        <div className="pmv-diagram-loading">
          <span>Loading diagram...</span>
        </div>
      )}
      <div ref={elementRef} style={{ minHeight: isLoading ? "100px" : "auto" }} />
    </div>
  );
});

MermaidRenderer.displayName = "MermaidRenderer";
