import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";
import { CodeEditor } from "@/components/CodeEditor";

/**
 * `CodeEditor` loads CodeMirror behind a dynamic `import()` (see `codemirror.lazy.ts` — the eager
 * bundle budget in `tendril-app` is the reason), so between mount and that import resolving the story
 * shows a plain-text fallback. Left alone, the visual-regression runner would race that and baseline
 * the fallback instead of the editor.
 *
 * `waitForSelector` is the tight gate for exactly this: the component sets `data-editor-ready="true"`
 * on its host once the editor has mounted, and `.storybook/test-runner.ts` waits on the selector
 * before freezing the page and taking the shot (15 s timeout, `WAIT_FOR_SELECTOR_TIMEOUT_MS`). The
 * settle delay is raised from the 100 ms default to cover the frame CodeMirror spends measuring and
 * painting its gutter after it mounts — the marker says "mounted", not "painted", the same one-frame
 * gap the chart stories allow for.
 */
const meta: Meta<typeof CodeEditor> = {
  title: "UI/CodeEditor",
  component: CodeEditor,
  parameters: {
    visual: {
      waitForSelector: '[data-editor-ready="true"]',
      settleDelay: 1000,
    },
  },
  argTypes: {
    readOnly: { control: "boolean" },
    language: { control: "select", options: ["yaml"] },
  },
};

export default meta;
type Story = StoryObj<typeof CodeEditor>;

/** A short config.yaml, shaped like the real one: comments and key order the editor must preserve. */
const SAMPLE_YAML = `# Tendril configuration
projectsRoot: ~/git/ivy

llm:
  provider: anthropic
  model: claude-opus-4
  maxTokens: 8192

server:
  port: 8765
  host: 127.0.0.1
`;

/**
 * The same document with its secret masked the way the daemon serves it: the literal eight-character
 * sentinel, quoted. The quoting is not cosmetic — an unquoted `[REDACTED]`-style placeholder parses
 * as a YAML flow sequence and fails validation against a `String` field.
 */
const MASKED_YAML = `# Tendril configuration
llm:
  provider: anthropic
  apiKey: "********"

codingAgents:
  - name: claude
    environmentVariables:
      ANTHROPIC_API_KEY: "********"
      ANTHROPIC_BASE_URL: "********"
`;

/** Indentation YAML cannot accept: \`model\` sits under a scalar, and the list item is misaligned. */
const INVALID_YAML = `llm:
  provider: anthropic
    model: claude-opus-4

codingAgents:
 - name: claude
     enabled: true
`;

/**
 * Every story drives the editor from local state rather than a static `value`, because the component
 * is controlled: a fixed `value` prop with a no-op `onChange` would let the user type and then snap
 * the document back on the next render, which is not how the app uses it.
 */
function EditorHarness({
  initialValue,
  readOnly = false,
  error,
}: {
  initialValue: string;
  readOnly?: boolean;
  /** Rendered in the destructive line above the editor, as `ConfigEditorView` does. */
  error?: string;
}) {
  const [value, setValue] = useState(initialValue);

  return (
    <div className="flex w-[640px] flex-col gap-2">
      {error && <p className="text-sm text-destructive">{error}</p>}
      <CodeEditor
        value={value}
        onChange={setValue}
        readOnly={readOnly}
        className="h-[320px]"
        data-testid="config-editor"
      />
    </div>
  );
}

export const Default: Story = {
  render: () => <EditorHarness initialValue={SAMPLE_YAML} />,
};

/**
 * What the editor actually receives from `GET /api/config/text`. The secrets never left the daemon:
 * what is on screen is the sentinel, and an untouched sentinel writes the stored value back on save.
 */
export const WithMaskedSecrets: Story = {
  render: () => <EditorHarness initialValue={MASKED_YAML} />,
};

export const ReadOnly: Story = {
  render: () => <EditorHarness initialValue={SAMPLE_YAML} readOnly />,
};

/**
 * The state V1 could not show: `RawConfigEditorView.cs` wrote unvalidated YAML and toasted success
 * even when the reload failed to parse. V2 validates server-side before writing and surfaces the
 * parse error here, so the failure path is reviewable without running the app.
 */
export const Invalid: Story = {
  render: () => (
    <EditorHarness
      initialValue={INVALID_YAML}
      error="mapping values are not allowed in this context at line 3, column 10"
    />
  ),
};
