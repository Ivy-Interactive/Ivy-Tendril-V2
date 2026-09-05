import React, { useState } from "react";
import { PlanDiffView } from "./PlanDiffView";

export default {
  title: "Components/PlanDiffView",
  component: PlanDiffView,
};

const SAMPLE_DIFF = `--- a/src/services/PlanService.ts
+++ b/src/services/PlanService.ts
@@ -10,6 +10,8 @@ export class PlanService {
   private readonly id: string;
+  private isExecuting: boolean = false;
+  private activeWorktree: string | null = null;

   constructor(id: string) {
     this.id = id;
@@ -25,7 +27,7 @@ export class PlanService {
   public async execute(): Promise<boolean> {
-    console.log("Executing plan...");
+    this.isExecuting = true;
+    console.log("Executing plan with worktree isolation...");
     return true;
   }
 }`;

export const UnifiedView = {
  render: () => (
    <div style={{ maxWidth: 1000, margin: "0 auto", padding: "1.5rem" }}>
      <PlanDiffView
        id="diff-unified"
        diff={SAMPLE_DIFF}
        filePath="src/services/PlanService.ts"
        viewType="Unified"
        collapsible={true}
        defaultCollapsed={false}
      />
    </div>
  ),
};

export const SplitView = {
  render: () => (
    <div style={{ maxWidth: 1200, margin: "0 auto", padding: "1.5rem" }}>
      <PlanDiffView
        id="diff-split"
        diff={SAMPLE_DIFF}
        filePath="src/services/PlanService.ts"
        viewType="Split"
        collapsible={true}
      />
    </div>
  ),
};

export const WithComments = {
  render: () => {
    const [comments] = useState([
      {
        filePath: "src/services/PlanService.ts",
        changeKey: "N12",
        lineNumber: 12,
        author: "Pavel",
        content: "Make sure activeWorktree is cleaned up in a finally block.",
        isResolved: false,
      },
    ]);

    return (
      <div style={{ maxWidth: 1000, margin: "0 auto", padding: "1.5rem" }}>
        <PlanDiffView
          id="diff-comments"
          diff={SAMPLE_DIFF}
          filePath="src/services/PlanService.ts"
          viewType="Unified"
          comments={comments}
          currentAuthor="Reviewer"
          eventHandler={(name, widgetId, args) => {
            console.log("PlanDiffView event:", name, widgetId, args);
          }}
        />
      </div>
    );
  },
};
