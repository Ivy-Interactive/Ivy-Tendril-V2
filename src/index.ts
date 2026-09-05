export function fn() {
  return "Hello, tsdown!";
}

// Plan Markdown components and sub-components
export {
  PlanMarkdown,
  DraftMarkdown,
  AlertBlockquote,
  AnnotationPopover,
  AddAnnotationPopover,
  EditAnnotationPopover,
  SelectionToolbar,
  QuestionsCallout,
  SearchOverlay,
  BlockHandler,
  CodeBlock,
  GraphvizRenderer,
  MermaidRenderer,
  ImageRenderer,
} from "./components/PlanMarkdown";

export type {
  MarkdownAnnotation,
  AnswerCallback,
  QuestionsAnswerContextType,
  PlanQuestion,
  QuestionOption,
  QuestionsBlock,
  ParsedQuestions,
} from "./components/PlanMarkdown";

export {
  parseQuestions,
  tagQuestionBlocks,
  getMarkdownPlugins,
  hasMath,
  prismTheme,
  normalizeLanguage,
  codeBlockPreStyle,
  rawHtmlSchema,
  hasRawHtml,
  getWidth,
  getHeight,
} from "./components/PlanMarkdown";

// Plan Diff components
export {
  PlanDiffView,
  getLanguageFromFilePath,
  useIsNarrow,
  NARROW_BREAKPOINT,
} from "./components/PlanDiffView";

export type { PlanDiffViewProps, DraftComment } from "./components/PlanDiffView";
