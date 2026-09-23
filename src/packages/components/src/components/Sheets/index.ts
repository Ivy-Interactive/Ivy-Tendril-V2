/**
 * Tendril's sheets — the side panels that slide over a page.
 *
 * Kept apart from `Dialogs/` because they are a different shape, not a different topic. A dialog
 * owns its own modal and answers a question; a sheet is a panel, and two of the three here do not
 * even own their `<Sheet>` — `JobDebugSheet` is a body its host wraps, and `ErrorSheet` subscribes
 * to a store rather than taking props at all. Their stories carry a real trigger button for that
 * reason: a sheet rendered bare shows something the app never displays.
 */
export {
  JobDebugSheet,
  buildJobDebugFields,
  formatJobDebugDetails,
  formatJobDebugDetailsForJob,
  formatJobDebugPrompt,
  type JobDebugSheetProps,
  type JobDebugDetail,
  type JobDebugField,
} from "./JobDebugSheet";
export { ErrorSheet } from "./ErrorSheet";
export {
  VerificationReportSheet,
  type VerificationReportSheetProps,
  type VerificationReportData,
  type VerificationReportStatus,
} from "./VerificationReportSheet";
export { ArtifactFileSheet, type ArtifactFileSheetProps } from "./ArtifactFileSheet";
export { FileSheet, type FileSheetProps } from "./FileSheet";
export {
  FilePreview,
  type FilePreviewProps,
  type FilePreviewContent,
  type FilePreviewRead,
  type FilePreviewImage,
} from "./FilePreview";
export {
  ARTIFACT_RICH_PREVIEW_LIMIT_BYTES,
  artifactFileName,
  artifactPreviewKind,
  artifactCodeLanguage,
  artifactDisplayPath,
  resolveArtifactLink,
  type ArtifactPreviewKind,
} from "./filePaths";
export {
  CommitDetailSheet,
  type CommitDetailSheetProps,
  type CommitDetail,
  type CommitDetailFile,
  type CommitDetailChange,
} from "./CommitDetailSheet";
export {
  InboxIssueSheet,
  type InboxIssueSheetProps,
  type InboxSheetItem,
  type InboxSheetProposal,
} from "./InboxIssueSheet";
export { PlanRevisionSheet, type PlanRevisionSheetProps } from "./PlanRevisionSheet";
export {
  KpiBreakdownSheet,
  buildKpiBlade,
  isKpiBreakdownId,
  KPI_BREAKDOWN_IDS,
  type KpiBreakdownSheetProps,
  type KpiBreakdownData,
  type KpiBreakdownId,
  type KpiActivity,
  type KpiForecast,
  type KpiDailyCost,
  type KpiShippedFeatureDay,
  type KpiMergedPr,
  type KpiPlanCost,
  type KpiAgentCost,
} from "./KpiBreakdownSheet";
export {
  JobCostSheet,
  buildJobCostBuckets,
  type JobCostSheetProps,
  type JobCostFacts,
  type JobCostBucket,
  type JobCostBucketKind,
} from "./JobCostSheet";
export { JobPromptSheet, type JobPromptSheetProps } from "./JobPromptSheet";
export {
  JobOutputSheet,
  JobStatusCallout,
  type JobOutputSheetProps,
  type JobOutputStatus,
  type JobStatusCalloutProps,
} from "./JobOutputSheet";
export {
  EditProjectMemorySheet,
  DEFAULT_MEMORY_FILE_NAME,
  type EditProjectMemorySheetProps,
  type ProjectMemoryDraft,
} from "./EditProjectMemorySheet";
