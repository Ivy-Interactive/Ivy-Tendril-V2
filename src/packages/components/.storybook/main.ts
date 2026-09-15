import type { StorybookConfig } from "@storybook/react-vite";
import { srcDir } from "../config/alias.ts";

/** Rolldown group sizes are byte counts over unminified modules, so they only approximate the kB
 * figures Vite prints. 500_000 aims each vendor group at the reported 500 kB threshold. */
const CHUNK_MAX_SIZE = 500_000;
const CHUNK_MIN_SIZE = 40_000;
const CHUNK_SIZE_WARNING_LIMIT = 1200;

const isPlanMarkdownShared = (id: string) =>
  /src[/\\]components[/\\]PlanMarkdown[/\\]/.test(id) && !/(?:Mermaid|Graphviz)Renderer/.test(id);

const codeSplitting = {
  minSize: CHUNK_MIN_SIZE,
  maxSize: CHUNK_MAX_SIZE,
  groups: [
    // Highest priority: the lazily-imported heavyweights. A dedicated group removes them from the
    // `vendor` catch-all, which would otherwise merge them into an eagerly-loaded chunk and undo
    // the React.lazy boundary in BlockHandler.tsx.
    {
      name: "vendor-diagrams",
      priority: 70,
      test: /node_modules[/\\](mermaid|@hpcc-js|cytoscape[^/\\]*|d3-[^/\\]+|dagre[^/\\]*|khroma|dompurify)[/\\]/,
    },
    // echarts and its zrender canvas layer are around a megabyte together, and only the chart
    // stories touch them. Their own group keeps them out of the `vendor` chunk every story loads.
    {
      name: "vendor-charts",
      priority: 68,
      test: /node_modules[/\\](echarts|echarts-for-react|zrender)[/\\]/,
    },
    { name: "vendor-pdfjs", priority: 65, test: /node_modules[/\\]pdfjs-dist[/\\]/ },
    {
      name: "vendor-react",
      priority: 60,
      test: /node_modules[/\\](react|react-dom|react-is|scheduler)[/\\]/,
    },
    {
      name: "vendor-syntax",
      priority: 55,
      test: /node_modules[/\\](refractor|prismjs|react-syntax-highlighter|lowlight|highlight\.js)[/\\]/,
    },
    {
      name: "vendor-markdown",
      priority: 50,
      test: /node_modules[/\\](react-markdown|remark-[^/\\]+|rehype-[^/\\]+|micromark[^/\\]*|mdast-[^/\\]+|hast-[^/\\]+|unified|unist-[^/\\]+|vfile[^/\\]*|katex|property-information)[/\\]/,
    },
    { name: "vendor-radix", priority: 45, test: /node_modules[/\\]@radix-ui[/\\]/ },
    {
      name: "vendor-icons",
      priority: 40,
      test: /node_modules[/\\](lucide-react|react-icons)[/\\]/,
    },
    {
      name: "vendor-storybook",
      priority: 35,
      test: /node_modules[/\\](@storybook|storybook|@mdx-js)[/\\]/,
    },
    { name: "vendor", priority: 10, test: /node_modules[/\\]/ },
    // Gives the shared PlanMarkdown chunk a stable name instead of `annotationUtils`. The renderer
    // exclusion matters: pulling MermaidRenderer.tsx in here would make its static `mermaid` import
    // eager for every story that touches PlanMarkdown.
    { name: "plan-markdown", priority: 5, test: isPlanMarkdownShared },
  ],
};

const config: StorybookConfig = {
  // No `*.mdx` glob: there are no MDX docs pages yet, and an unmatched glob makes Storybook
  // print `WARN No story files found for the specified pattern`. Re-adding it also requires
  // switching `test-storybook` to `--index-json` — the runner's default mode collects `.mdx`
  // into jest's `testMatch` but has no transform for it. See tests/storybook-mdx.test.ts.
  stories: ["../src/**/*.stories.@(js|jsx|mjs|ts|tsx)"],
  addons: ["@storybook/addon-essentials", "@storybook/addon-a11y", "@storybook/addon-interactions"],
  framework: {
    name: "@storybook/react-vite",
    options: {},
  },
  staticDirs: ["./public"],
  core: {
    disableTelemetry: true,
  },
  viteFinal(viteConfig) {
    const existingAlias = viteConfig.resolve?.alias;
    let alias;
    if (Array.isArray(existingAlias)) {
      alias = [...existingAlias, { find: "@", replacement: srcDir }];
    } else if (existingAlias) {
      alias = { ...(existingAlias as Record<string, string>), "@": srcDir };
    } else {
      alias = { "@": srcDir };
    }

    const build = viteConfig.build ?? {};
    const bundlerOptions = build.rollupOptions ?? {};
    const withCodeSplitting = (output: any) => ({ ...output, codeSplitting });

    return {
      ...viteConfig,
      resolve: {
        ...viteConfig.resolve,
        alias,
      },
      build: {
        ...build,
        chunkSizeWarningLimit: CHUNK_SIZE_WARNING_LIMIT,
        rollupOptions: {
          ...bundlerOptions,
          output: Array.isArray(bundlerOptions.output)
            ? bundlerOptions.output.map(withCodeSplitting)
            : withCodeSplitting(bundlerOptions.output ?? {}),
        },
      },
    };
  },
};

export default config;
