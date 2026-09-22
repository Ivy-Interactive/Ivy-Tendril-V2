/**
 * Agentic readiness & SEO asset generator for Vite+ build.
 *
 * Generates all machine-readable files required by AI crawlers and search engines:
 * - sitemap.xml (all documentation routes, trust anchors, root)
 * - robots.txt (allowlists ChatGPT-User, ClaudeBot, Google-Extended, DeepSeekBot, ora-agent)
 * - llms.txt & llms-full.txt (agent instructions, "when to use this", full documentation dump)
 * - Trust anchor pages: /about, /contact, /privacy (>500 chars each, semantic HTML)
 * - MCP discovery manifest: /.well-known/mcp & /.well-known/mcp.json
 * - Agent-friendly 404.html (Markdown error body with explanation and links)
 * - Homepage index.html (semantic HTML >500 chars, sequential H1-H3, JSON-LD, OpenGraph)
 */
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { Plugin } from "vite";
import { readContentFiles, routesForContent } from "./emit-route-shells";
import { ROUTE_BASE } from "../lib/slug";
import { buildNavTree, flattenNavRoutes } from "../lib/nav";
import { parsePages } from "../lib/page";

export interface EmitAgenticAssetsOptions {
  contentDir: string;
  base?: string;
  origin?: string;
}

const DEFAULT_ORIGIN = "https://ivy-interactive.github.io";
const REPO_SUBPATH = "/Ivy-Tendril-V2";
const CANONICAL_BASE_URL = `${DEFAULT_ORIGIN}${REPO_SUBPATH}`;

export interface ResolvedUrls {
  siteRootUrl: string;
  docsBaseUrl: string;
  repoSubpath: string;
}

export function resolveSiteUrls(rawSiteUrl: string = CANONICAL_BASE_URL): ResolvedUrls {
  let clean = rawSiteUrl.replace(/\/+$/, "");
  if (!clean.startsWith("http")) {
    clean = `${DEFAULT_ORIGIN}${clean.startsWith("/") ? clean : `/${clean}`}`;
  }
  // If hosted on github.io and missing the repo subpath, ensure it includes /Ivy-Tendril-V2
  if (clean.includes("ivy-interactive.github.io") && !clean.includes(REPO_SUBPATH)) {
    clean = clean.replace("ivy-interactive.github.io", `ivy-interactive.github.io${REPO_SUBPATH}`);
  }
  const siteRootUrl = clean.replace(/\/docs\/?$/, "") || CANONICAL_BASE_URL;
  const docsBaseUrl = `${siteRootUrl}/docs`;
  const urlObj = new URL(siteRootUrl);
  const repoSubpath = urlObj.pathname.replace(/\/+$/, "") || REPO_SUBPATH;
  return { siteRootUrl, docsBaseUrl, repoSubpath };
}

export function generateRobotsTxt(rawSiteUrl: string = CANONICAL_BASE_URL): string {
  const { siteRootUrl } = resolveSiteUrls(rawSiteUrl);
  return [
    "User-agent: *",
    "Allow: /",
    "",
    "User-agent: ChatGPT-User",
    "Allow: /",
    "",
    "User-agent: GPTBot",
    "Allow: /",
    "",
    "User-agent: ClaudeBot",
    "Allow: /",
    "",
    "User-agent: anthropic-ai",
    "Allow: /",
    "",
    "User-agent: Google-Extended",
    "Allow: /",
    "",
    "User-agent: Googlebot",
    "Allow: /",
    "",
    "User-agent: DeepSeekBot",
    "Allow: /",
    "",
    "User-agent: ora-agent",
    "Allow: /",
    "",
    "User-agent: PerplexityBot",
    "Allow: /",
    "",
    "User-agent: Cohere-ai",
    "Allow: /",
    "",
    "User-agent: Applebot-Extended",
    "Allow: /",
    "",
    `Sitemap: ${siteRootUrl}/sitemap.xml`,
    "",
  ].join("\n");
}

export function generateSitemap(routes: string[], rawSiteUrl: string = CANONICAL_BASE_URL): string {
  const { siteRootUrl, docsBaseUrl } = resolveSiteUrls(rawSiteUrl);
  const today = new Date().toISOString().split("T")[0];
  const urls: string[] = [
    `  <url>
    <loc>${siteRootUrl}/</loc>
    <lastmod>${today}</lastmod>
    <changefreq>daily</changefreq>
    <priority>1.0</priority>
  </url>`,
    `  <url>
    <loc>${siteRootUrl}/about</loc>
    <lastmod>${today}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.8</priority>
  </url>`,
    `  <url>
    <loc>${siteRootUrl}/developers</loc>
    <lastmod>${today}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.9</priority>
  </url>`,
    `  <url>
    <loc>${siteRootUrl}/contact</loc>
    <lastmod>${today}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.8</priority>
  </url>`,
    `  <url>
    <loc>${siteRootUrl}/privacy</loc>
    <lastmod>${today}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.8</priority>
  </url>`,
    `  <url>
    <loc>${siteRootUrl}/getting-started</loc>
    <lastmod>${today}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.95</priority>
  </url>`,
    `  <url>
    <loc>${siteRootUrl}/gettingstarted</loc>
    <lastmod>${today}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.95</priority>
  </url>`,
    `  <url>
    <loc>${siteRootUrl}/mcp-server</loc>
    <lastmod>${today}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.95</priority>
  </url>`,
    `  <url>
    <loc>${siteRootUrl}/mcp</loc>
    <lastmod>${today}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.95</priority>
  </url>`,
    `  <url>
    <loc>${siteRootUrl}/setup</loc>
    <lastmod>${today}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.95</priority>
  </url>`,
    `  <url>
    <loc>${siteRootUrl}/install</loc>
    <lastmod>${today}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.95</priority>
  </url>`,
    `  <url>
    <loc>${siteRootUrl}/docs</loc>
    <lastmod>${today}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.95</priority>
  </url>`,
  ];

  for (const route of routes) {
    const cleanSegment = route
      .replace(/^https?:\/\/[^/]+/i, "")
      .replace(/^\/Ivy-Tendril-V2/i, "")
      .replace(/^\/docs\/?/i, "")
      .replace(/^\/+/, "");

    const loc = cleanSegment ? `${docsBaseUrl}/${cleanSegment}` : docsBaseUrl;

    urls.push(`  <url>
    <loc>${loc}</loc>
    <lastmod>${today}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.9</priority>
  </url>`);
  }

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    urls.join("\n"),
    "</urlset>",
    "",
  ].join("\n");
}

export function generateLlmsTxt(rawSiteUrl: string = CANONICAL_BASE_URL): string {
  const { siteRootUrl, docsBaseUrl } = resolveSiteUrls(rawSiteUrl);
  return `# Ivy Tendril

> The Agentic Software Factory for 10x Builders. Tendril replaces traditional IDEs with autonomous coding agents running in parallel git worktrees with verification gates, plan annotations, and multi-model support.

## When to use this

Reach for Ivy Tendril when you need to:
- **Run autonomous coding agents in parallel git worktrees**: Let agents (Claude Code, OpenAI Codex, Copilot, OpenCode, Google Gemini) work concurrently on feature branches without clobbering your working tree or causing branch conflicts.
- **Implement human-in-the-loop plan supervision**: Coordinate plans through structured states (\`Draft\`, \`Approved\`, \`Running\`, \`Completed\`, \`Failed\`, \`Icebox\`) with plan annotations and diff reviews before merging.
- **Enforce automated verification gates**: Run compilers, linters, unit tests, and Playwright visual screenshot tests automatically after agent turns to ensure code correctness before review.
- **Integrate AI agents into developer workflows**: Leverage the first-party Model Context Protocol (MCP) server (\`tendril mcp\`) or Axum REST/WebSocket daemon on port 5010 to steer and monitor agent jobs programmatically.
- **Bring your own model provider (BYO LLM)**: Connect models from Anthropic, OpenAI, Google, OpenRouter, Berget, Evroc, Scaleway, Zai, Opper, Cloudflare, NVIDIA, and Vercel.

## How an agent should call Tendril

- **Via Model Context Protocol (MCP)**:
  Connect to Tendril using the built-in MCP server:
  \`\`\`bash
  tendril mcp
  \`\`\`
  Exposes tools: \`plan_list\`, \`plan_get\`, \`plan_create\`, \`plan_run\`, \`worktree_list\`, \`worktree_create\`, \`verification_run\`.

- **Via Command Line Interface (CLI)**:
  \`\`\`bash
  tendril plan create "Refactor database schema"
  tendril plan run <plan-id>
  tendril run          # Starts background HTTP and WebSocket daemon on 127.0.0.1:5010
  tendril doctor       # Validates local environment, toolchains, and permissions
  \`\`\`

- **Via REST and WebSocket API**:
  Daemon runs on \`http://127.0.0.1:5010\`.
  - \`GET /api/v1/plans\` — List all plans across active projects.
  - \`POST /api/v1/plans\` — Submit a new plan for agent execution.
  - \`GET /api/v1/worktrees\` — Inspect active git worktrees and git status.
  - \`WS /api/v1/events\` — Stream real-time agent output and terminal transcripts.

- **Via Developer Portal & OpenAPI**:
  Explore interactive endpoints, schemas, and typed error models at [Developer Portal](${siteRootUrl}/developers) and [OpenAPI 3.1.0 Spec](${siteRootUrl}/openapi.json).

- **Onboarding & Authentication**:
  - **100% Free & Source-Available**: Licensed under FSL-1.1-ALv2. No credit cards, trial expirations, or sales forms.
  - **Self-Serve API Keys**: Local keyring/vault authentication via \`tendril vault init\` and \`tendril config set-key\`.
  - **Sandbox / Test Environment**: Run \`tendril run --sandbox\` or connect to \`http://127.0.0.1:5010/sandbox\` for mock plans and risk-free testing.

## When NOT to use this

- Do NOT use Tendril for simple single-file quick edits where agent orchestration, isolated git worktrees, and automated verification loops are unnecessary.
- Do NOT confuse Tendril with the legacy Ivy Framework (v1 C#/.NET library); Tendril v2 is a completely redesigned desktop application and daemon built from scratch in Rust and Tauri v2.

## Key Documentation & Links

- [Developer Portal](${siteRootUrl}/developers): Quickstart, API keys, sandbox environment, and API schemas.
- [Introduction](${docsBaseUrl}/gettingstarted/introduction): Overview of Tendril architecture, concepts, and developer workflow.
- [Installation](${docsBaseUrl}/gettingstarted/installation): Installing desktop app (\`.pkg\`, \`.exe\`, \`.AppImage\`), Rust daemon, and CLI prerequisites.
- [Onboarding](${docsBaseUrl}/gettingstarted/onboarding): First-time setup, repository selection, and project initialization.
- [Tutorial](${docsBaseUrl}/gettingstarted/tutorial): Step-by-step walkthrough running your first plan.
- [Plans & Lifecycle](${docsBaseUrl}/concepts/plans): Understanding plan states, annotations, and execution rules.
- [Promptwares](${docsBaseUrl}/concepts/promptwares): Promptware agent definitions, system instructions, and tools.
- [Coding Agents](${docsBaseUrl}/codingagents): Integrating Claude Code, Codex, GitHub Copilot, OpenCode, and Gemini CLI.
- [Model Providers](${docsBaseUrl}/modelproviders): Configuring API keys and custom model endpoints.
- [CLI Reference](${docsBaseUrl}/advanced/cli/overview): Command syntax and options for the \`tendril\` CLI.
- [REST & WebSocket API](${docsBaseUrl}/advanced/rest): Complete REST endpoint documentation and WebSocket event schemas.
- [MCP Server](${docsBaseUrl}/advanced/mcp): Model Context Protocol setup and tool definitions.
- [OpenAPI Specification](${siteRootUrl}/openapi.json): Full OpenAPI 3.1.0 schema with RFC 9457 error models and rate limit headers.

## Full Context Document

- [Full Documentation (llms-full.txt)](${siteRootUrl}/llms-full.txt): Complete concatenated documentation for agent context ingestion.
`;
}

export function generateLlmsFullTxt(contentFiles: Record<string, string>): string {
  const pages = parsePages(contentFiles);
  const nav = buildNavTree(contentFiles);
  const orderedRoutes = flattenNavRoutes(nav);

  const chunks: string[] = [
    "# Ivy Tendril — Complete Documentation",
    "",
    "> Full-text documentation bundle for LLMs and automated coding agents.",
    "",
    "---",
    "",
  ];

  for (const route of orderedRoutes) {
    const page = [...pages.values()].find((p) => p.route === route);
    if (!page) continue;
    chunks.push(`## ${page.title}`);
    chunks.push(`Path: ${page.contentPath} | Route: ${page.route}`);
    if (page.description) chunks.push(`> ${page.description}\n`);
    chunks.push(page.body.trim());
    chunks.push("\n---\n");
  }

  return chunks.join("\n");
}

export function generateMcpManifest(rawSiteUrl: string = CANONICAL_BASE_URL): string {
  const { siteRootUrl, docsBaseUrl } = resolveSiteUrls(rawSiteUrl);
  return JSON.stringify(
    {
      $schema: "https://modelcontextprotocol.io/schema/mcp-server.json",
      name: "tendril-mcp",
      version: "2.0.0",
      description:
        "Ivy Tendril Model Context Protocol server for autonomous agent orchestration, plan lifecycles, and git worktree management",
      vendor: "Ivy Interactive",
      homepage: siteRootUrl,
      documentation: `${docsBaseUrl}/advanced/mcp`,
      transport: {
        type: "streamable-http",
        url: "http://127.0.0.1:5010/mcp",
        command: "tendril",
        args: ["mcp"],
      },
      capabilities: {
        tools: true,
        prompts: true,
        resources: true,
      },
      endpoints: {
        streamable_http: "http://127.0.0.1:5010/mcp",
        sse: "http://127.0.0.1:5010/mcp/events",
      },
      tools: [
        {
          name: "plan_list",
          description: "List all plans in the active workspace filtered by status.",
          inputSchema: {
            type: "object",
            properties: {
              status: {
                type: "string",
                enum: ["Draft", "Approved", "Running", "Completed", "Failed", "Icebox"],
                description: "Filter plans by execution state",
              },
              limit: {
                type: "integer",
                default: 50,
                description: "Maximum number of plans to return",
              },
            },
          },
        },
        {
          name: "plan_get",
          description: "Retrieve complete plan details, annotations, and verification run status.",
          inputSchema: {
            type: "object",
            required: ["id"],
            properties: {
              id: {
                type: "string",
                description: "Unique plan identifier (ULID or slug)",
              },
            },
          },
        },
        {
          name: "plan_create",
          description: "Create a new execution plan for an autonomous coding agent.",
          inputSchema: {
            type: "object",
            required: ["title"],
            properties: {
              title: {
                type: "string",
                description: "Short title of the plan or feature",
              },
              description: {
                type: "string",
                description: "Detailed specification or prompt for the agent",
              },
              agent: {
                type: "string",
                enum: ["claude-code", "codex", "copilot", "opencode", "gemini"],
                description: "Agent engine to execute this plan",
              },
            },
          },
        },
        {
          name: "plan_run",
          description: "Trigger execution of an approved plan in an isolated git worktree.",
          inputSchema: {
            type: "object",
            required: ["id"],
            properties: {
              id: {
                type: "string",
                description: "Plan identifier to execute",
              },
              verification_profile: {
                type: "string",
                description:
                  "Verification profile to enforce upon completion (e.g., standard, strict)",
              },
            },
          },
        },
        {
          name: "worktree_list",
          description: "List all active isolated git worktrees.",
          inputSchema: {
            type: "object",
            properties: {
              clean_only: {
                type: "boolean",
                description: "Only return clean worktrees without unstaged changes",
              },
            },
          },
        },
        {
          name: "verification_run",
          description:
            "Run automated verification gates (compiler, linter, tests, visual screenshots).",
          inputSchema: {
            type: "object",
            required: ["plan_id"],
            properties: {
              plan_id: {
                type: "string",
                description: "Plan identifier associated with the worktree",
              },
              suite: {
                type: "string",
                enum: ["all", "unit", "lint", "visual"],
                default: "all",
                description: "Verification test suite to execute",
              },
            },
          },
        },
      ],
      repository: "https://github.com/Ivy-Interactive/Ivy-Tendril-V2",
    },
    null,
    2,
  );
}

export function generateOpenApiSpec(): string {
  const commonRateLimitHeaders = {
    "RateLimit-Limit": { $ref: "#/components/headers/RateLimit-Limit" },
    "RateLimit-Remaining": { $ref: "#/components/headers/RateLimit-Remaining" },
    "RateLimit-Reset": { $ref: "#/components/headers/RateLimit-Reset" },
  };

  return JSON.stringify(
    {
      openapi: "3.1.0",
      info: {
        title: "Ivy Tendril Daemon REST API",
        version: "2.0.0",
        description: [
          "Local and remote orchestration API for Ivy Tendril agentic software factory.",
          "",
          "### API Versioning and Deprecation Policy",
          "- **Versioning Policy**: Tendril uses URL-based API versioning (`/api/v1`).",
          "- **Deprecation Signaling**: Deprecated endpoints return standard RFC 8594 `Deprecation` and `Sunset` headers.",
          "- **Sunset Timeline**: Deprecated API endpoints are supported for at least 180 days after deprecation notice.",
          "- **Error Responses**: All 4xx and 5xx errors return structured RFC 9457 Problem Details (`application/problem+json`) with machine-readable error codes and resolution hints.",
          "- **Rate Limiting**: Responses include standard RFC rate-limit headers (`RateLimit-Limit`, `RateLimit-Remaining`, `RateLimit-Reset`, and `Retry-After` on 429).",
          "- **Developer Portal**: https://ivy-interactive.github.io/Ivy-Tendril-V2/developers",
        ].join("\n"),
        contact: {
          name: "Ivy Interactive Support",
          email: "support@ivy.app",
          url: "https://ivy.app",
        },
      },
      servers: [
        {
          url: "http://127.0.0.1:5010",
          description: "Local daemon instance",
        },
      ],
      paths: {
        "/api/v1/plans": {
          get: {
            summary: "List plans",
            description:
              "Returns all execution plans in the active workspace with state and branch information.",
            operationId: "listPlans",
            parameters: [
              {
                name: "status",
                in: "query",
                required: false,
                description: "Filter plans by execution state",
                schema: {
                  type: "string",
                  enum: ["Draft", "Approved", "Running", "Completed", "Failed", "Icebox"],
                },
              },
              {
                name: "limit",
                in: "query",
                required: false,
                description: "Maximum number of plans to return",
                schema: { type: "integer", default: 50, minimum: 1, maximum: 200 },
              },
              {
                name: "offset",
                in: "query",
                required: false,
                description: "Pagination offset",
                schema: { type: "integer", default: 0, minimum: 0 },
              },
            ],
            security: [{ OAuth2: ["plans:read"] }],
            responses: {
              "200": {
                description: "List of plans matching query parameters",
                headers: commonRateLimitHeaders,
                content: {
                  "application/json": {
                    schema: {
                      type: "array",
                      items: { $ref: "#/components/schemas/Plan" },
                    },
                  },
                },
              },
              "400": { $ref: "#/components/responses/BadRequest" },
              "401": { $ref: "#/components/responses/Unauthorized" },
              "429": { $ref: "#/components/responses/TooManyRequests" },
              "500": { $ref: "#/components/responses/InternalServerError" },
            },
          },
          post: {
            summary: "Create plan",
            description: "Creates a new execution plan for autonomous agent worktree execution.",
            operationId: "createPlan",
            security: [{ OAuth2: ["plans:write"] }],
            requestBody: {
              required: true,
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/CreatePlanRequest" },
                },
              },
            },
            responses: {
              "201": {
                description: "Plan created successfully",
                headers: commonRateLimitHeaders,
                content: {
                  "application/json": {
                    schema: { $ref: "#/components/schemas/Plan" },
                  },
                },
              },
              "400": { $ref: "#/components/responses/BadRequest" },
              "401": { $ref: "#/components/responses/Unauthorized" },
              "429": { $ref: "#/components/responses/TooManyRequests" },
              "500": { $ref: "#/components/responses/InternalServerError" },
            },
          },
        },
        "/api/v1/plans/{id}": {
          get: {
            summary: "Get plan details",
            description:
              "Returns full plan details including annotations, logs, and verification status.",
            operationId: "getPlan",
            parameters: [
              {
                name: "id",
                in: "path",
                required: true,
                description: "Unique plan ID (slug or ULID)",
                schema: { type: "string" },
              },
            ],
            security: [{ OAuth2: ["plans:read"] }],
            responses: {
              "200": {
                description: "Plan details",
                headers: commonRateLimitHeaders,
                content: {
                  "application/json": {
                    schema: { $ref: "#/components/schemas/Plan" },
                  },
                },
              },
              "401": { $ref: "#/components/responses/Unauthorized" },
              "404": { $ref: "#/components/responses/NotFound" },
              "429": { $ref: "#/components/responses/TooManyRequests" },
              "500": { $ref: "#/components/responses/InternalServerError" },
            },
          },
        },
        "/api/v1/plans/{id}/run": {
          post: {
            summary: "Run plan",
            description:
              "Triggers immediate agent execution of an approved plan in an isolated git worktree.",
            operationId: "runPlan",
            parameters: [
              {
                name: "id",
                in: "path",
                required: true,
                description: "Unique plan ID to execute",
                schema: { type: "string" },
              },
            ],
            security: [{ OAuth2: ["plans:write"] }],
            requestBody: {
              required: false,
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/RunPlanRequest" },
                },
              },
            },
            responses: {
              "200": {
                description: "Plan execution triggered",
                headers: commonRateLimitHeaders,
                content: {
                  "application/json": {
                    schema: { $ref: "#/components/schemas/Plan" },
                  },
                },
              },
              "400": { $ref: "#/components/responses/BadRequest" },
              "401": { $ref: "#/components/responses/Unauthorized" },
              "404": { $ref: "#/components/responses/NotFound" },
              "429": { $ref: "#/components/responses/TooManyRequests" },
              "500": { $ref: "#/components/responses/InternalServerError" },
            },
          },
        },
        "/api/v1/worktrees": {
          get: {
            summary: "List worktrees",
            description: "Inspect active git worktrees and agent isolation environments.",
            operationId: "listWorktrees",
            parameters: [
              {
                name: "clean",
                in: "query",
                required: false,
                description: "Filter only clean worktrees without uncommitted modifications",
                schema: { type: "boolean" },
              },
            ],
            security: [{ OAuth2: ["worktrees:read"] }],
            responses: {
              "200": {
                description: "Active worktrees",
                headers: commonRateLimitHeaders,
                content: {
                  "application/json": {
                    schema: {
                      type: "array",
                      items: { $ref: "#/components/schemas/Worktree" },
                    },
                  },
                },
              },
              "401": { $ref: "#/components/responses/Unauthorized" },
              "429": { $ref: "#/components/responses/TooManyRequests" },
              "500": { $ref: "#/components/responses/InternalServerError" },
            },
          },
          post: {
            summary: "Create worktree",
            description: "Creates an isolated git worktree branch for agent development.",
            operationId: "createWorktree",
            security: [{ OAuth2: ["worktrees:write"] }],
            requestBody: {
              required: true,
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/CreateWorktreeRequest" },
                },
              },
            },
            responses: {
              "201": {
                description: "Worktree created successfully",
                headers: commonRateLimitHeaders,
                content: {
                  "application/json": {
                    schema: { $ref: "#/components/schemas/Worktree" },
                  },
                },
              },
              "400": { $ref: "#/components/responses/BadRequest" },
              "401": { $ref: "#/components/responses/Unauthorized" },
              "429": { $ref: "#/components/responses/TooManyRequests" },
              "500": { $ref: "#/components/responses/InternalServerError" },
            },
          },
        },
        "/api/v1/verification/run": {
          post: {
            summary: "Run verification gates",
            description:
              "Executes automated compiler, linter, unit test, and visual verification suites.",
            operationId: "runVerification",
            security: [{ OAuth2: ["plans:write"] }],
            requestBody: {
              required: true,
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/RunVerificationRequest" },
                },
              },
            },
            responses: {
              "200": {
                description: "Verification results",
                headers: commonRateLimitHeaders,
                content: {
                  "application/json": {
                    schema: { $ref: "#/components/schemas/VerificationResult" },
                  },
                },
              },
              "400": { $ref: "#/components/responses/BadRequest" },
              "401": { $ref: "#/components/responses/Unauthorized" },
              "404": { $ref: "#/components/responses/NotFound" },
              "429": { $ref: "#/components/responses/TooManyRequests" },
              "500": { $ref: "#/components/responses/InternalServerError" },
            },
          },
        },
      },
      components: {
        securitySchemes: {
          OAuth2: {
            type: "oauth2",
            description: "OAuth 2.0 authentication with scoped permissions",
            flows: {
              authorizationCode: {
                authorizationUrl: "http://127.0.0.1:5010/oauth/authorize",
                tokenUrl: "http://127.0.0.1:5010/oauth/token",
                scopes: {
                  "plans:read": "Read-only access to plans and annotations",
                  "plans:write": "Create, approve, and run plans",
                  "worktrees:read": "List and inspect isolated git worktrees",
                  "worktrees:write": "Create and clean up git worktrees",
                },
              },
            },
          },
        },
        headers: {
          "RateLimit-Limit": {
            description: "The maximum number of requests allowed in the current time window.",
            schema: { type: "integer", example: 120 },
          },
          "RateLimit-Remaining": {
            description: "The number of remaining requests allowed in the current time window.",
            schema: { type: "integer", example: 119 },
          },
          "RateLimit-Reset": {
            description: "The number of seconds until the current rate limit window resets.",
            schema: { type: "integer", example: 60 },
          },
          "Retry-After": {
            description:
              "The number of seconds an agent must wait before retrying a throttled request.",
            schema: { type: "integer", example: 30 },
          },
          Deprecation: {
            description: "RFC 8594 date or boolean indicating endpoint deprecation status.",
            schema: { type: "string", example: "@1767225600" },
          },
          Sunset: {
            description:
              "RFC 8594 date indicating when the deprecated API endpoint will be permanently retired.",
            schema: { type: "string", example: "Wed, 31 Dec 2026 23:59:59 GMT" },
          },
        },
        schemas: {
          Plan: {
            type: "object",
            required: ["id", "title", "state"],
            properties: {
              id: { type: "string", description: "Unique plan ID" },
              title: { type: "string", description: "Title of the plan" },
              state: {
                type: "string",
                enum: ["Draft", "Approved", "Running", "Completed", "Failed", "Icebox"],
                description: "Current lifecycle state",
              },
              branch: { type: "string", description: "Associated git worktree branch" },
              annotations: {
                type: "array",
                items: { type: "string" },
                description: "Human and agent annotations",
              },
            },
          },
          CreatePlanRequest: {
            type: "object",
            required: ["title"],
            properties: {
              title: { type: "string", description: "Short title of the plan" },
              description: {
                type: "string",
                description: "Detailed specification or prompt for the agent",
              },
              agent: {
                type: "string",
                enum: ["claude-code", "codex", "copilot", "opencode", "gemini"],
                description: "Agent execution engine",
              },
            },
          },
          RunPlanRequest: {
            type: "object",
            properties: {
              verification_profile: {
                type: "string",
                description: "Verification profile to enforce upon completion",
                example: "standard",
              },
            },
          },
          Worktree: {
            type: "object",
            required: ["path", "branch", "clean"],
            properties: {
              path: { type: "string", description: "Filesystem path to the isolated worktree" },
              branch: { type: "string", description: "Git branch name" },
              clean: {
                type: "boolean",
                description: "Whether the working copy has uncommitted changes",
              },
            },
          },
          CreateWorktreeRequest: {
            type: "object",
            required: ["branch"],
            properties: {
              branch: { type: "string", description: "Git branch name to checkout" },
              base_ref: {
                type: "string",
                description: "Base commit or branch to branch from",
                default: "HEAD",
              },
            },
          },
          RunVerificationRequest: {
            type: "object",
            required: ["plan_id"],
            properties: {
              plan_id: { type: "string", description: "Identifier of the plan to verify" },
              suite: {
                type: "string",
                enum: ["all", "unit", "lint", "visual"],
                default: "all",
                description: "Test suite to execute",
              },
            },
          },
          VerificationResult: {
            type: "object",
            required: ["success", "plan_id"],
            properties: {
              success: { type: "boolean", description: "Whether all verification checks passed" },
              plan_id: { type: "string", description: "Identifier of the verified plan" },
              exit_code: { type: "integer", description: "Process exit code from test runner" },
              summary: {
                type: "string",
                description: "Detailed output or summary of test results",
              },
            },
          },
          ProblemDetails: {
            type: "object",
            description:
              "RFC 9457 Problem Details object with machine-readable codes and remediation hints for agents.",
            required: ["type", "title", "status", "detail", "code"],
            properties: {
              type: {
                type: "string",
                format: "uri",
                description: "URI reference identifying the problem type.",
                example:
                  "https://ivy-interactive.github.io/Ivy-Tendril-V2/docs/advanced/rest#errors",
              },
              title: {
                type: "string",
                description: "Short human-readable summary of the problem type.",
                example: "Resource Not Found",
              },
              status: { type: "integer", description: "HTTP status code.", example: 404 },
              detail: {
                type: "string",
                description: "Explanation specific to this error occurrence.",
                example: "Plan with ID 'plan-xyz' was not found in the active workspace.",
              },
              instance: {
                type: "string",
                format: "uri",
                description: "URI identifying the specific error instance.",
              },
              code: {
                type: "string",
                description: "Machine-readable error code for agent error handling.",
                example: "PLAN_NOT_FOUND",
              },
              hint: {
                type: "string",
                description: "Remediation guidance for autonomous agents.",
                example:
                  "Query GET /api/v1/plans to find valid plan IDs or submit a new plan with POST /api/v1/plans.",
              },
              documentation_url: {
                type: "string",
                format: "uri",
                example: "https://ivy-interactive.github.io/Ivy-Tendril-V2/developers",
              },
            },
          },
          ErrorResponse: {
            type: "object",
            description: "Structured JSON error response model for agents unable to parse HTML.",
            required: ["code", "message"],
            properties: {
              code: {
                type: "string",
                description: "Machine-readable error code.",
                example: "BAD_REQUEST",
              },
              message: {
                type: "string",
                description: "Human-readable error description.",
                example: "The request body is missing the required 'title' field.",
              },
              hint: {
                type: "string",
                description: "Suggested corrective action.",
                example: "Provide a non-empty string in the 'title' property.",
              },
              documentation_url: {
                type: "string",
                format: "uri",
                example: "https://ivy-interactive.github.io/Ivy-Tendril-V2/developers",
              },
            },
          },
        },
        responses: {
          BadRequest: {
            description: "Bad Request - The request parameters or body failed schema validation.",
            headers: commonRateLimitHeaders,
            content: {
              "application/problem+json": {
                schema: { $ref: "#/components/schemas/ProblemDetails" },
              },
              "application/json": {
                schema: { $ref: "#/components/schemas/ErrorResponse" },
              },
            },
          },
          Unauthorized: {
            description: "Unauthorized - Missing or invalid Bearer token / API key.",
            headers: commonRateLimitHeaders,
            content: {
              "application/problem+json": {
                schema: { $ref: "#/components/schemas/ProblemDetails" },
              },
              "application/json": {
                schema: { $ref: "#/components/schemas/ErrorResponse" },
              },
            },
          },
          Forbidden: {
            description: "Forbidden - The credential does not possess the required scope.",
            headers: commonRateLimitHeaders,
            content: {
              "application/problem+json": {
                schema: { $ref: "#/components/schemas/ProblemDetails" },
              },
              "application/json": {
                schema: { $ref: "#/components/schemas/ErrorResponse" },
              },
            },
          },
          NotFound: {
            description:
              "Not Found - The requested resource does not exist in the active workspace.",
            headers: commonRateLimitHeaders,
            content: {
              "application/problem+json": {
                schema: { $ref: "#/components/schemas/ProblemDetails" },
              },
              "application/json": {
                schema: { $ref: "#/components/schemas/ErrorResponse" },
              },
            },
          },
          TooManyRequests: {
            description:
              "Too Many Requests - Rate limit exceeded. Agents should inspect Retry-After and back off.",
            headers: {
              "RateLimit-Limit": { $ref: "#/components/headers/RateLimit-Limit" },
              "RateLimit-Remaining": { $ref: "#/components/headers/RateLimit-Remaining" },
              "RateLimit-Reset": { $ref: "#/components/headers/RateLimit-Reset" },
              "Retry-After": { $ref: "#/components/headers/Retry-After" },
            },
            content: {
              "application/problem+json": {
                schema: { $ref: "#/components/schemas/ProblemDetails" },
              },
              "application/json": {
                schema: { $ref: "#/components/schemas/ErrorResponse" },
              },
            },
          },
          InternalServerError: {
            description: "Internal Server Error - Unexpected server failure in daemon.",
            headers: commonRateLimitHeaders,
            content: {
              "application/problem+json": {
                schema: { $ref: "#/components/schemas/ProblemDetails" },
              },
              "application/json": {
                schema: { $ref: "#/components/schemas/ErrorResponse" },
              },
            },
          },
        },
      },
    },
    null,
    2,
  );
}

export function generateOAuthServerMetadata(): string {
  return JSON.stringify(
    {
      issuer: "https://ivy.app",
      authorization_endpoint: "http://127.0.0.1:5010/oauth/authorize",
      token_endpoint: "http://127.0.0.1:5010/oauth/token",
      scopes_supported: ["plans:read", "plans:write", "worktrees:read", "worktrees:write"],
      response_types_supported: ["code", "token"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      code_challenge_methods_supported: ["S256"],
    },
    null,
    2,
  );
}

export function generateOAuthResourceMetadata(): string {
  return JSON.stringify(
    {
      resource: "http://127.0.0.1:5010",
      authorization_servers: ["https://ivy.app"],
      scopes_supported: ["plans:read", "plans:write", "worktrees:read", "worktrees:write"],
      bearer_methods_supported: ["header"],
    },
    null,
    2,
  );
}

export function generateArdManifest(rawSiteUrl: string = CANONICAL_BASE_URL): string {
  const { siteRootUrl, docsBaseUrl } = resolveSiteUrls(rawSiteUrl);
  return JSON.stringify(
    {
      specVersion: "1.0",
      host: {
        displayName: "Ivy Interactive",
        url: siteRootUrl,
      },
      entries: [
        {
          identifier: "urn:air:ivy-interactive.github.io:mcp:tendril",
          displayName: "Ivy Tendril MCP Server",
          type: "application/mcp-server+json",
          url: "http://127.0.0.1:5010/mcp",
          description:
            "Model Context Protocol server for Tendril autonomous agent orchestration, plan lifecycles, and git worktree management.",
          representativeQueries: [
            "Connect to Tendril MCP server",
            "Run autonomous coding agents in worktrees",
            "Create an execution plan in Tendril",
            "Run automated verification gates",
          ],
        },
        {
          identifier: "urn:air:ivy-interactive.github.io:api:openapi",
          displayName: "Ivy Tendril Daemon OpenAPI Specification",
          type: "application/openapi+json",
          url: `${siteRootUrl}/openapi.json`,
          description:
            "OpenAPI 3.1.0 specification with typed RFC 9457 error models and standard rate-limiting headers.",
          representativeQueries: [
            "Tendril REST API documentation",
            "Submit plan via API",
            "List active worktrees",
            "Inspect daemon endpoints",
          ],
        },
        {
          identifier: "urn:air:ivy-interactive.github.io:portal:developers",
          displayName: "Ivy Tendril Developer Portal",
          type: "text/html",
          url: `${siteRootUrl}/developers`,
          description:
            "Developer quickstart, self-serve keyring vault API keys, local sandbox daemon instructions, and API deprecation policies.",
          representativeQueries: [
            "Tendril developer portal",
            "Tendril API keys",
            "Tendril sandbox testing",
            "Tendril SDK quickstart",
          ],
        },
        {
          identifier: "urn:air:ivy-interactive.github.io:doc:llms-txt",
          displayName: "Ivy Tendril Agent Guidelines (llms.txt)",
          type: "text/markdown",
          url: `${siteRootUrl}/llms.txt`,
          description:
            "Concise machine-readable guide, quickstart, CLI tool usage, and links for LLM agents.",
          representativeQueries: [
            "How to use Ivy Tendril",
            "Tendril CLI commands",
            "Tendril agent instructions",
          ],
        },
        {
          identifier: "urn:air:ivy-interactive.github.io:doc:getting-started",
          displayName: "Ivy Tendril Getting Started & Setup Guide",
          type: "text/html",
          url: `${docsBaseUrl}/gettingstarted/introduction`,
          description:
            "Official documentation covering architecture, installation, onboarding, and first plan walkthrough.",
          representativeQueries: [
            "Install Ivy Tendril",
            "Tendril setup guide",
            "Tendril onboarding tutorial",
          ],
        },
      ],
    },
    null,
    2,
  );
}

export function generateGettingStartedPage(rawSiteUrl: string = CANONICAL_BASE_URL): string {
  const { siteRootUrl, docsBaseUrl } = resolveSiteUrls(rawSiteUrl);
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Getting Started with Ivy Tendril · Quickstart Guide</title>
  <meta name="description" content="Official setup guide for Ivy Tendril. Install the desktop app or CLI, initialize projects, launch local daemons, and run autonomous coding agents in parallel git worktrees.">
  <link rel="canonical" href="${docsBaseUrl}/gettingstarted/introduction">
  <link rel="alternate" type="text/markdown" href="${siteRootUrl}/getting-started/index.md" title="Getting Started Markdown">
  <link rel="ard" type="application/json" href="${siteRootUrl}/.well-known/ard.json">
  <link rel="ai-catalog" type="application/json" href="${siteRootUrl}/.well-known/ai-catalog.json">
  <meta property="og:title" content="Getting Started with Ivy Tendril">
  <meta property="og:description" content="Setup guide, CLI commands, daemon initialization, and first plan walkthrough for Ivy Tendril.">
  <meta property="og:image" content="${siteRootUrl}/og-image.png">
  <meta property="og:type" content="website">
  <meta http-equiv="refresh" content="2;url=${docsBaseUrl}/gettingstarted/introduction">
  <style>
    body { font-family: system-ui, -apple-system, sans-serif; line-height: 1.6; max-width: 850px; margin: 0 auto; padding: 2rem 1rem; color: #1f2937; background: #ffffff; }
    h1, h2, h3 { color: #111827; }
    h1 { font-size: 2.2rem; font-weight: 800; margin-bottom: 0.5rem; }
    h2 { font-size: 1.4rem; font-weight: 700; margin-top: 2rem; border-bottom: 1px solid #e5e7eb; padding-bottom: 0.5rem; }
    h3 { font-size: 1.1rem; font-weight: 600; margin-top: 1.25rem; }
    a { color: #2563eb; text-decoration: underline; text-underline-offset: 3px; }
    nav a { margin-right: 1.25rem; font-weight: 500; }
    header { border-bottom: 1px solid #e5e7eb; padding-bottom: 1.5rem; margin-bottom: 2rem; }
    pre { background: #f3f4f6; padding: 1rem; border-radius: 6px; overflow-x: auto; font-family: monospace; font-size: 0.9rem; border: 1px solid #e5e7eb; }
    code { background: #f3f4f6; padding: 0.15rem 0.35rem; border-radius: 4px; font-family: monospace; font-size: 0.9em; }
    .card { background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 8px; padding: 1.25rem; margin: 1.25rem 0; }
    footer { border-top: 1px solid #e5e7eb; padding-top: 1.5rem; margin-top: 3rem; font-size: 0.875rem; color: #6b7280; }
  </style>
</head>
<body>
  <header>
    <nav aria-label="Main Navigation">
      <a href="${siteRootUrl}/">Home</a>
      <a href="${siteRootUrl}/developers">Developer Portal</a>
      <a href="${docsBaseUrl}/gettingstarted/introduction">Documentation</a>
      <a href="${siteRootUrl}/llms.txt">llms.txt</a>
      <a href="${siteRootUrl}/sitemap.xml">Sitemap</a>
    </nav>
    <h1>Getting Started with Ivy Tendril</h1>
    <p>The Agentic Software Factory for 10x Builders. Run autonomous coding agents in parallel git worktrees with verification gates and human-in-the-loop plan supervision.</p>
  </header>
  <main>
    <section>
      <h2>Quick 5-Step Setup Walkthrough</h2>

      <h3>Step 1: Install Tendril Desktop App or CLI</h3>
      <p>Download the native desktop application for macOS (Apple Silicon / Intel), Linux (.AppImage, .deb), or Windows (.msi) from GitHub Releases, or install the CLI toolchain via Cargo:</p>
      <pre><code># Install CLI toolchain via Cargo:
cargo install tendril-cli

# Run system health check and verify prerequisites:
tendril doctor</code></pre>

      <h3>Step 2: Initialize Your Workspace & Projects</h3>
      <p>Tendril organizes repositories as Projects with isolated git worktrees so agents never modify your primary working tree without permission:</p>
      <pre><code># Interactive onboarding wizard:
tendril onboarding

# Or register an existing git repository directly:
tendril project add /path/to/repository --name my-project</code></pre>

      <h3>Step 3: Launch the Tendril Background Daemon</h3>
      <p>Tendril includes an Axum REST and WebSocket daemon that coordinates agent runs, tool calls, and real-time terminal output on port 5010:</p>
      <pre><code># Launch background daemon:
tendril run

# Or launch in ephemeral sandbox mode for risk-free testing:
tendril run --sandbox</code></pre>

      <h3>Step 4: Create and Execute Your First Plan</h3>
      <p>Tasks are modeled as structured Plans. Once approved, Tendril spins up an isolated worktree branch and starts your selected coding agent (Claude Code, OpenAI Codex, GitHub Copilot, OpenCode, or Google Gemini):</p>
      <pre><code># Create a new plan:
tendril plan create "Implement user authentication with OAuth2 PKCE"

# Execute plan with Claude Code in an isolated worktree:
tendril plan run &lt;plan-id&gt; --agent claude-code

# Check verification gates (compiler, linter, tests, visual screenshots):
tendril verification run --plan &lt;plan-id&gt;</code></pre>

      <h3>Step 5: Connect via Model Context Protocol (MCP)</h3>
      <p>Expose Tendril's plan and worktree tools to Claude Desktop, ChatGPT, or custom agent runners:</p>
      <pre><code># Start standard I/O MCP server:
tendril mcp

# Streamable HTTP endpoint:
http://127.0.0.1:5010/mcp</code></pre>
    </section>

    <section>
      <h2>Detailed Documentation Sections</h2>
      <ul>
        <li><a href="${docsBaseUrl}/gettingstarted/introduction">Introduction & Architecture</a> — Understand the fundamental shift to parallel agentic development.</li>
        <li><a href="${docsBaseUrl}/gettingstarted/installation">Installation Guide</a> — Native packages, dependencies, and shell completion.</li>
        <li><a href="${docsBaseUrl}/gettingstarted/onboarding">Onboarding Wizard</a> — First-time setup, keyring encryption, and workspace paths.</li>
        <li><a href="${docsBaseUrl}/gettingstarted/tutorial">First Plan Walkthrough</a> — Step-by-step tutorial running your first unattended agent plan.</li>
        <li><a href="${docsBaseUrl}/concepts/plans">Plans & Supervision</a> — Plan states (Draft, Approved, Running, Completed, Failed, Icebox) and annotations.</li>
        <li><a href="${docsBaseUrl}/codingagents">Supported Coding Agents</a> — Setting up Claude Code, Codex, Copilot, OpenCode, and Gemini.</li>
        <li><a href="${docsBaseUrl}/advanced/mcp">MCP Server Reference</a> — Tool schemas and integration patterns.</li>
        <li><a href="${siteRootUrl}/developers">Developer Portal</a> — API keys, sandbox daemon, rate limits, and schemas.</li>
      </ul>
    </section>
  </main>
  <footer>
    <p>&copy; ${new Date().getFullYear()} Ivy Interactive AB. All rights reserved.</p>
  </footer>
</body>
</html>`;
}

export function generateGettingStartedMarkdown(rawSiteUrl: string = CANONICAL_BASE_URL): string {
  const { siteRootUrl, docsBaseUrl } = resolveSiteUrls(rawSiteUrl);
  return `# Getting Started with Ivy Tendril

> The Agentic Software Factory for 10x Builders. Tendril runs autonomous coding agents in parallel git worktrees with verification gates, plan annotations, and multi-model support.

## 5-Step Quickstart

### 1. Install Tendril Desktop App or CLI
- Download desktop app for macOS, Linux, or Windows.
- Or install CLI via Cargo:
  \`\`\`bash
  cargo install tendril-cli
  tendril doctor
  \`\`\`

### 2. Register Your Project
\`\`\`bash
tendril onboarding
# or
tendril project add /path/to/repo --name my-project
\`\`\`

### 3. Launch Local Daemon
\`\`\`bash
tendril run             # Runs on http://127.0.0.1:5010
tendril run --sandbox   # Runs mock environment for risk-free agent testing
\`\`\`

### 4. Create and Run an Agent Plan
\`\`\`bash
tendril plan create "Add OAuth2 authentication"
tendril plan run <plan-id> --agent claude-code
tendril verification run --plan <plan-id>
\`\`\`

### 5. Connect AI Agents via Model Context Protocol (MCP)
\`\`\`bash
tendril mcp
\`\`\`
Endpoint: \`http://127.0.0.1:5010/mcp\` | Manifest: [mcp.json](${siteRootUrl}/.well-known/mcp.json)

## Canonical Links

- [Introduction](${docsBaseUrl}/gettingstarted/introduction)
- [Installation](${docsBaseUrl}/gettingstarted/installation)
- [Onboarding](${docsBaseUrl}/gettingstarted/onboarding)
- [Tutorial](${docsBaseUrl}/gettingstarted/tutorial)
- [Developer Portal](${siteRootUrl}/developers)
- [OpenAPI Specification](${siteRootUrl}/openapi.json)
- [LLM Guidance (llms.txt)](${siteRootUrl}/llms.txt)
`;
}

export function generateMcpPage(rawSiteUrl: string = CANONICAL_BASE_URL): string {
  const { siteRootUrl, docsBaseUrl } = resolveSiteUrls(rawSiteUrl);
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Ivy Tendril · Model Context Protocol (MCP) Server</title>
  <meta name="description" content="Connect AI coding agents to Tendril via Model Context Protocol (MCP). Control plans, worktrees, and verification gates programmatically.">
  <link rel="canonical" href="${docsBaseUrl}/advanced/mcp">
  <link rel="alternate" type="text/markdown" href="${siteRootUrl}/mcp/index.md" title="MCP Markdown">
  <link rel="ard" type="application/json" href="${siteRootUrl}/.well-known/ard.json">
  <link rel="ai-catalog" type="application/json" href="${siteRootUrl}/.well-known/ai-catalog.json">
  <meta property="og:title" content="Ivy Tendril MCP Server">
  <meta property="og:description" content="Model Context Protocol tools and configuration for Ivy Tendril autonomous software factory.">
  <meta property="og:image" content="${siteRootUrl}/og-image.png">
  <meta property="og:type" content="website">
  <meta http-equiv="refresh" content="2;url=${docsBaseUrl}/advanced/mcp">
  <style>
    body { font-family: system-ui, -apple-system, sans-serif; line-height: 1.6; max-width: 850px; margin: 0 auto; padding: 2rem 1rem; color: #1f2937; background: #ffffff; }
    h1, h2, h3 { color: #111827; }
    h1 { font-size: 2.2rem; font-weight: 800; margin-bottom: 0.5rem; }
    h2 { font-size: 1.4rem; font-weight: 700; margin-top: 2rem; border-bottom: 1px solid #e5e7eb; padding-bottom: 0.5rem; }
    h3 { font-size: 1.1rem; font-weight: 600; margin-top: 1.25rem; }
    a { color: #2563eb; text-decoration: underline; text-underline-offset: 3px; }
    nav a { margin-right: 1.25rem; font-weight: 500; }
    header { border-bottom: 1px solid #e5e7eb; padding-bottom: 1.5rem; margin-bottom: 2rem; }
    pre { background: #f3f4f6; padding: 1rem; border-radius: 6px; overflow-x: auto; font-family: monospace; font-size: 0.9rem; border: 1px solid #e5e7eb; }
    code { background: #f3f4f6; padding: 0.15rem 0.35rem; border-radius: 4px; font-family: monospace; font-size: 0.9em; }
    .card { background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 8px; padding: 1.25rem; margin: 1.25rem 0; }
    table { width: 100%; border-collapse: collapse; margin: 1.5rem 0; }
    th, td { text-align: left; padding: 0.75rem; border-bottom: 1px solid #e5e7eb; }
    th { background: #f9fafb; font-weight: 600; }
    footer { border-top: 1px solid #e5e7eb; padding-top: 1.5rem; margin-top: 3rem; font-size: 0.875rem; color: #6b7280; }
  </style>
</head>
<body>
  <header>
    <nav aria-label="Main Navigation">
      <a href="${siteRootUrl}/">Home</a>
      <a href="${siteRootUrl}/developers">Developer Portal</a>
      <a href="${docsBaseUrl}/gettingstarted/introduction">Documentation</a>
      <a href="${siteRootUrl}/llms.txt">llms.txt</a>
      <a href="${siteRootUrl}/sitemap.xml">Sitemap</a>
    </nav>
    <h1>Ivy Tendril MCP Server</h1>
    <p>Connect Claude, ChatGPT, and custom orchestrators directly to Tendril's agentic execution engine.</p>
  </header>
  <main>
    <section>
      <h2>Connection Options</h2>
      <div class="card">
        <h3>1. Standard I/O (stdio)</h3>
        <pre><code>tendril mcp</code></pre>
      </div>
      <div class="card">
        <h3>2. Streamable HTTP / Server-Sent Events</h3>
        <p>Endpoint: <code>http://127.0.0.1:5010/mcp</code></p>
        <p>Discovery manifest: <a href="${siteRootUrl}/.well-known/mcp.json">/.well-known/mcp.json</a></p>
      </div>
      <div class="card">
        <h3>Claude Desktop / Claude Code Configuration</h3>
        <pre><code>{
  "mcpServers": {
    "tendril": {
      "command": "tendril",
      "args": ["mcp"]
    }
  }
}</code></pre>
      </div>
    </section>

    <section>
      <h2>Available Tools</h2>
      <table>
        <thead>
          <tr><th>Tool</th><th>Description</th></tr>
        </thead>
        <tbody>
          <tr><td><code>plan_list</code></td><td>List all plans in active workspace filtered by status.</td></tr>
          <tr><td><code>plan_get</code></td><td>Retrieve complete plan details, annotations, and verification status.</td></tr>
          <tr><td><code>plan_create</code></td><td>Create a new execution plan for an autonomous coding agent.</td></tr>
          <tr><td><code>plan_run</code></td><td>Trigger execution of an approved plan in an isolated git worktree.</td></tr>
          <tr><td><code>worktree_list</code></td><td>List all active isolated git worktrees.</td></tr>
          <tr><td><code>verification_run</code></td><td>Run automated compiler, linter, unit test, and visual verification gates.</td></tr>
        </tbody>
      </table>
    </section>

    <section>
      <h2>Documentation & Resources</h2>
      <ul>
        <li><a href="${docsBaseUrl}/advanced/mcp">Complete MCP Documentation</a></li>
        <li><a href="${siteRootUrl}/.well-known/mcp.json">MCP Manifest (JSON Schema)</a></li>
        <li><a href="${siteRootUrl}/developers">Developer Portal</a></li>
        <li><a href="${siteRootUrl}/openapi.json">OpenAPI 3.1.0 Specification</a></li>
      </ul>
    </section>
  </main>
  <footer>
    <p>&copy; ${new Date().getFullYear()} Ivy Interactive AB. All rights reserved.</p>
  </footer>
</body>
</html>`;
}

export function generateMcpMarkdown(rawSiteUrl: string = CANONICAL_BASE_URL): string {
  const { siteRootUrl, docsBaseUrl } = resolveSiteUrls(rawSiteUrl);
  return `# Ivy Tendril Model Context Protocol (MCP) Server

> Connect AI coding agents directly to Tendril's autonomous plan lifecycle and git worktree engine.

## Connection

### Stdio
\`\`\`bash
tendril mcp
\`\`\`

### Streamable HTTP
- Endpoint: \`http://127.0.0.1:5010/mcp\`
- Manifest: [mcp.json](${siteRootUrl}/.well-known/mcp.json)

## Configuration
\`\`\`json
{
  "mcpServers": {
    "tendril": {
      "command": "tendril",
      "args": ["mcp"]
    }
  }
}
\`\`\`

## Available Tools
- \`plan_list\`: List plans in workspace filtered by status
- \`plan_get\`: Retrieve plan details, annotations, and verification status
- \`plan_create\`: Create new plan for autonomous coding agent
- \`plan_run\`: Trigger approved plan in isolated git worktree
- \`worktree_list\`: List active isolated git worktrees
- \`verification_run\`: Run verification test suites (compiler, linter, tests, visual)

## Links
- [Complete MCP Documentation](${docsBaseUrl}/advanced/mcp)
- [Developer Portal](${siteRootUrl}/developers)
- [OpenAPI Specification](${siteRootUrl}/openapi.json)
`;
}

export function generateDocsOverviewPage(rawSiteUrl: string = CANONICAL_BASE_URL): string {
  const { siteRootUrl, docsBaseUrl } = resolveSiteUrls(rawSiteUrl);
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Ivy Tendril Documentation Overview</title>
  <meta name="description" content="Comprehensive documentation for Ivy Tendril: getting started, core concepts, apps, coding agents, model providers, and advanced CLI/REST/MCP reference.">
  <link rel="canonical" href="${docsBaseUrl}/gettingstarted/introduction">
  <link rel="alternate" type="text/markdown" href="${siteRootUrl}/docs/index.md" title="Documentation Markdown">
  <link rel="ard" type="application/json" href="${siteRootUrl}/.well-known/ard.json">
  <link rel="ai-catalog" type="application/json" href="${siteRootUrl}/.well-known/ai-catalog.json">
  <meta property="og:title" content="Ivy Tendril Documentation Overview">
  <meta property="og:description" content="Index and quick reference for all Ivy Tendril documentation sections.">
  <meta property="og:image" content="${siteRootUrl}/og-image.png">
  <meta property="og:type" content="website">
  <meta http-equiv="refresh" content="2;url=${docsBaseUrl}/gettingstarted/introduction">
  <style>
    body { font-family: system-ui, -apple-system, sans-serif; line-height: 1.6; max-width: 850px; margin: 0 auto; padding: 2rem 1rem; color: #1f2937; background: #ffffff; }
    h1, h2, h3 { color: #111827; }
    h1 { font-size: 2.2rem; font-weight: 800; margin-bottom: 0.5rem; }
    h2 { font-size: 1.4rem; font-weight: 700; margin-top: 2rem; border-bottom: 1px solid #e5e7eb; padding-bottom: 0.5rem; }
    h3 { font-size: 1.1rem; font-weight: 600; margin-top: 1.25rem; }
    a { color: #2563eb; text-decoration: underline; text-underline-offset: 3px; }
    nav a { margin-right: 1.25rem; font-weight: 500; }
    header { border-bottom: 1px solid #e5e7eb; padding-bottom: 1.5rem; margin-bottom: 2rem; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 1.25rem; margin: 1.5rem 0; }
    .card { background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 8px; padding: 1.25rem; }
    footer { border-top: 1px solid #e5e7eb; padding-top: 1.5rem; margin-top: 3rem; font-size: 0.875rem; color: #6b7280; }
  </style>
</head>
<body>
  <header>
    <nav aria-label="Main Navigation">
      <a href="${siteRootUrl}/">Home</a>
      <a href="${siteRootUrl}/developers">Developer Portal</a>
      <a href="${docsBaseUrl}/gettingstarted/introduction">Documentation</a>
      <a href="${siteRootUrl}/llms.txt">llms.txt</a>
      <a href="${siteRootUrl}/sitemap.xml">Sitemap</a>
    </nav>
    <h1>Ivy Tendril Documentation</h1>
    <p>Explore the complete documentation for the Ivy Tendril agentic software factory.</p>
  </header>
  <main>
    <div class="grid">
      <div class="card">
        <h3><a href="${docsBaseUrl}/gettingstarted/introduction">1. Getting Started</a></h3>
        <p>Introduction, installation, onboarding wizard, and your first autonomous plan walkthrough.</p>
      </div>
      <div class="card">
        <h3><a href="${docsBaseUrl}/concepts/plans">2. Core Concepts</a></h3>
        <p>Plans lifecycle, promptwares, worktree isolation, and verification gates.</p>
      </div>
      <div class="card">
        <h3><a href="${docsBaseUrl}/configuration/setup">3. Configuration</a></h3>
        <p>Config.yaml schema, projects management, danger zones, and key storage.</p>
      </div>
      <div class="card">
        <h3><a href="${docsBaseUrl}/apps/dashboard">4. Applications</a></h3>
        <p>Dashboard, Review, Plans, Jobs, Icebox, PRs, and Recommendations views.</p>
      </div>
      <div class="card">
        <h3><a href="${docsBaseUrl}/codingagents">5. Coding Agents</a></h3>
        <p>Integrate Claude Code, OpenAI Codex, GitHub Copilot, OpenCode, and Google Gemini.</p>
      </div>
      <div class="card">
        <h3><a href="${docsBaseUrl}/integrations">6. Integrations</a></h3>
        <p>GitHub CLI (gh), JamDev bug recording, and OpenClaw issue capture.</p>
      </div>
      <div class="card">
        <h3><a href="${docsBaseUrl}/modelproviders">7. Model Providers</a></h3>
        <p>Berget, Evroc, Zai, Scaleway, Opper, OpenRouter, Cloudflare, NVIDIA, and Vercel.</p>
      </div>
      <div class="card">
        <h3><a href="${docsBaseUrl}/advanced/cli/overview">8. CLI Reference</a></h3>
        <p>Full command syntax for tendril plan, run, project, doctor, vault, and config.</p>
      </div>
      <div class="card">
        <h3><a href="${docsBaseUrl}/advanced/rest">9. REST & WebSocket API</a></h3>
        <p>Axum HTTP daemon endpoints on port 5010, streaming events, and schemas.</p>
      </div>
      <div class="card">
        <h3><a href="${docsBaseUrl}/advanced/mcp">10. Model Context Protocol</a></h3>
        <p>MCP server configuration, available tools, and AI orchestrator integration.</p>
      </div>
    </div>
  </main>
  <footer>
    <p>&copy; ${new Date().getFullYear()} Ivy Interactive AB. All rights reserved.</p>
  </footer>
</body>
</html>`;
}

export function generateDocsOverviewMarkdown(rawSiteUrl: string = CANONICAL_BASE_URL): string {
  const { siteRootUrl, docsBaseUrl } = resolveSiteUrls(rawSiteUrl);
  return `# Ivy Tendril Documentation Overview

> Explore the complete documentation for the Ivy Tendril agentic software factory.

## Documentation Sections

1. [Getting Started](${docsBaseUrl}/gettingstarted/introduction) — Installation, onboarding wizard, and first plan walkthrough.
2. [Core Concepts](${docsBaseUrl}/concepts/plans) — Plans lifecycle, promptwares, worktree isolation, and verification gates.
3. [Configuration](${docsBaseUrl}/configuration/setup) — Config.yaml schema, projects management, danger zones, and key storage.
4. [Applications](${docsBaseUrl}/apps/dashboard) — Dashboard, Review, Plans, Jobs, Icebox, PRs, and Recommendations views.
5. [Coding Agents](${docsBaseUrl}/codingagents) — Claude Code, OpenAI Codex, GitHub Copilot, OpenCode, and Google Gemini.
6. [Integrations](${docsBaseUrl}/integrations) — GitHub CLI (gh), JamDev bug recording, and OpenClaw issue capture.
7. [Model Providers](${docsBaseUrl}/modelproviders) — Berget, Evroc, Zai, Scaleway, Opper, OpenRouter, Cloudflare, NVIDIA, and Vercel.
8. [CLI Reference](${docsBaseUrl}/advanced/cli/overview) — Full command syntax for tendril plan, run, project, doctor, vault, and config.
9. [REST & WebSocket API](${docsBaseUrl}/advanced/rest) — Axum HTTP daemon endpoints on port 5010, streaming events, and schemas.
10. [Model Context Protocol](${docsBaseUrl}/advanced/mcp) — MCP server configuration, available tools, and AI orchestrator integration.

## Additional Resources
- [Developer Portal](${siteRootUrl}/developers)
- [OpenAPI 3.1.0 Specification](${siteRootUrl}/openapi.json)
- [LLM Agent Guidelines (llms.txt)](${siteRootUrl}/llms.txt)
- [Full Documentation (llms-full.txt)](${siteRootUrl}/llms-full.txt)
`;
}

export function generateDeveloperPortalMarkdown(rawSiteUrl: string = CANONICAL_BASE_URL): string {
  const { siteRootUrl, docsBaseUrl } = resolveSiteUrls(rawSiteUrl);
  return `# Ivy Tendril Developer Portal

> Everything you need to integrate, orchestrate, and build on Ivy Tendril's agentic software factory.

## Quickstart & Local Setup

### 1. Model Context Protocol (MCP)
- Stdio transport: \`tendril mcp\`
- Streamable HTTP: \`http://127.0.0.1:5010/mcp\`
- MCP Manifest: [mcp.json](${siteRootUrl}/.well-known/mcp.json)
- MCP Documentation: [MCP Guide](${docsBaseUrl}/advanced/mcp)

### 2. Tendril CLI
\`\`\`bash
tendril run             # Start background daemon on 127.0.0.1:5010
tendril plan create "Add OAuth2 PKCE flow"
tendril plan run <plan-id> --agent claude-code
tendril doctor          # Check environment health
\`\`\`

## Self-Serve API Keys & Authentication
- 100% Free and Source-Available under FSL-1.1-ALv2.
- Local encrypted vault:
  \`\`\`bash
  tendril vault init
  tendril config set-key anthropic <your-key>
  tendril config set-key openai <your-key>
  \`\`\`
- OAuth 2.0 discovery: [oauth-authorization-server](${siteRootUrl}/.well-known/oauth-authorization-server)

## Sandbox & Test Environment
\`\`\`bash
tendril run --sandbox
curl -s http://127.0.0.1:5010/sandbox/plans
\`\`\`

## Key Endpoints & Specifications
- OpenAPI 3.1.0: [openapi.json](${siteRootUrl}/openapi.json)
- LLM Guidelines: [llms.txt](${siteRootUrl}/llms.txt)
- Full Documentation: [llms-full.txt](${siteRootUrl}/llms-full.txt)
- Sitemap: [sitemap.xml](${siteRootUrl}/sitemap.xml)
- Getting Started: [Setup Guide](${docsBaseUrl}/gettingstarted/introduction)
`;
}

export function generateAboutPage(rawSiteUrl: string = CANONICAL_BASE_URL): string {
  const { siteRootUrl, docsBaseUrl } = resolveSiteUrls(rawSiteUrl);
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>About Ivy Interactive & Tendril</title>
  <meta name="description" content="About Ivy Interactive and Ivy Tendril — The Agentic Software Factory for 10x Builders.">
  <link rel="canonical" href="${siteRootUrl}/about">
  <link rel="ard" type="application/json" href="${siteRootUrl}/.well-known/ard.json">
  <link rel="ai-catalog" type="application/json" href="${siteRootUrl}/.well-known/ai-catalog.json">
  <meta property="og:title" content="About Ivy Interactive & Tendril">
  <meta property="og:description" content="Ivy Interactive builds developer tools for the agentic software era.">
  <meta property="og:image" content="${siteRootUrl}/og-image.png">
  <meta property="og:type" content="website">
  <style>
    body { font-family: system-ui, -apple-system, sans-serif; line-height: 1.6; max-width: 800px; margin: 0 auto; padding: 2rem 1rem; color: #1f2937; background: #ffffff; }
    h1, h2, h3 { color: #111827; }
    a { color: #2563eb; text-decoration: underline; text-underline-offset: 3px; }
    nav a { margin-right: 1rem; font-weight: 500; }
    header { border-bottom: 1px solid #e5e7eb; padding-bottom: 1.5rem; margin-bottom: 2rem; }
    footer { border-top: 1px solid #e5e7eb; padding-top: 1.5rem; margin-top: 3rem; font-size: 0.875rem; color: #6b7280; }
  </style>
</head>
<body>
  <header>
    <nav>
      <a href="${siteRootUrl}/">Home</a>
      <a href="${siteRootUrl}/developers">Developer Portal</a>
      <a href="${docsBaseUrl}/gettingstarted/introduction">Documentation</a>
      <a href="${siteRootUrl}/about">About</a>
      <a href="${siteRootUrl}/contact">Contact</a>
      <a href="${siteRootUrl}/privacy">Privacy Policy</a>
      <a href="${siteRootUrl}/llms.txt">llms.txt</a>
    </nav>
    <h1>About Ivy Interactive & Ivy Tendril</h1>
  </header>
  <main>
    <section>
      <h2>Our Mission</h2>
      <p>
        Ivy Interactive is pioneering software engineering tools designed from the ground up for the agentic era.
        As autonomous AI models (such as Claude Code, OpenAI Codex, GitHub Copilot, OpenCode, and Google Gemini)
        take over the bulk of routine code generation, developer workflows shift from manual typing to orchestrating,
        supervising, verifying, and steering teams of autonomous agents.
      </p>
      <p>
        Ivy Tendril is our flagship desktop application and daemon that replaces traditional IDEs. By executing agent runs
        in isolated git worktrees with strict verification gates, Tendril ensures that developers maintain complete control
        over software quality without ever having their main development branches interrupted or contaminated.
      </p>
    </section>
    <section>
      <h2>Engineering & Architecture</h2>
      <p>
        Tendril v2 represents a total re-architecture from our early prototypes. The core daemon and CLI are built in high-performance
        Rust, leveraging Tokio and Axum for asynchronous HTTP and WebSocket streaming. The desktop frontend is built on Tauri v2
        with React and Vite+, providing native OS integration, lightweight memory usage, and instant startup times across macOS,
        Linux, and Windows.
      </p>
    </section>
    <section>
      <h2>Source-Available & Open Collaboration</h2>
      <p>
        Tendril is licensed under the Functional Source License (FSL-1.1-ALv2), providing full source code access for developers
        and teams while protecting core innovations. All agent skills, promptwares, and client components are published openly
        in our monorepo on GitHub.
      </p>
      <p>
        Learn more about Tendril on our <a href="${docsBaseUrl}/gettingstarted/introduction">Documentation Home</a> or visit the
        <a href="https://github.com/Ivy-Interactive/Ivy-Tendril-V2">GitHub Repository</a>.
      </p>
    </section>
  </main>
  <footer>
    <p>&copy; ${new Date().getFullYear()} Ivy Interactive AB. All rights reserved.</p>
  </footer>
</body>
</html>`;
}

export function generateContactPage(rawSiteUrl: string = CANONICAL_BASE_URL): string {
  const { siteRootUrl, docsBaseUrl } = resolveSiteUrls(rawSiteUrl);
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Contact Ivy Interactive</title>
  <meta name="description" content="Contact details, support channels, and office location for Ivy Interactive and Ivy Tendril.">
  <link rel="canonical" href="${siteRootUrl}/contact">
  <link rel="ard" type="application/json" href="${siteRootUrl}/.well-known/ard.json">
  <link rel="ai-catalog" type="application/json" href="${siteRootUrl}/.well-known/ai-catalog.json">
  <meta property="og:title" content="Contact Ivy Interactive">
  <meta property="og:description" content="Get in touch with the Ivy Tendril engineering and support teams.">
  <meta property="og:image" content="${siteRootUrl}/og-image.png">
  <meta property="og:type" content="website">
  <style>
    body { font-family: system-ui, -apple-system, sans-serif; line-height: 1.6; max-width: 800px; margin: 0 auto; padding: 2rem 1rem; color: #1f2937; background: #ffffff; }
    h1, h2, h3 { color: #111827; }
    a { color: #2563eb; text-decoration: underline; text-underline-offset: 3px; }
    nav a { margin-right: 1rem; font-weight: 500; }
    header { border-bottom: 1px solid #e5e7eb; padding-bottom: 1.5rem; margin-bottom: 2rem; }
    footer { border-top: 1px solid #e5e7eb; padding-top: 1.5rem; margin-top: 3rem; font-size: 0.875rem; color: #6b7280; }
    .card { background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 8px; padding: 1.25rem; margin-bottom: 1.5rem; }
  </style>
</head>
<body>
  <header>
    <nav>
      <a href="${siteRootUrl}/">Home</a>
      <a href="${siteRootUrl}/developers">Developer Portal</a>
      <a href="${docsBaseUrl}/gettingstarted/introduction">Documentation</a>
      <a href="${siteRootUrl}/about">About</a>
      <a href="${siteRootUrl}/contact">Contact</a>
      <a href="${siteRootUrl}/privacy">Privacy Policy</a>
      <a href="${siteRootUrl}/llms.txt">llms.txt</a>
    </nav>
    <h1>Contact Ivy Interactive</h1>
  </header>
  <main>
    <section>
      <h2>Support & Inquiries</h2>
      <p>
        Whether you are building enterprise agent pipelines, evaluating Tendril for your team, or reporting a bug,
        we are here to support you. Reach out through any of our official channels:
      </p>
      <div class="card">
        <h3>Customer & Developer Support</h3>
        <p><strong>Email:</strong> <a href="mailto:support@ivy.app">support@ivy.app</a></p>
        <p>Typical response time is within 1 business day.</p>
      </div>
      <div class="card">
        <h3>Security & Vulnerability Reporting</h3>
        <p><strong>Email:</strong> <a href="mailto:security@ivy.app">security@ivy.app</a></p>
        <p>Please use responsible disclosure protocols when reporting security vulnerabilities.</p>
      </div>
      <div class="card">
        <h3>Community & Discussion</h3>
        <p><strong>Discord Community:</strong> <a href="https://discord.gg/FHgxkDga3y">Join our Discord server</a></p>
        <p><strong>GitHub Issues & Discussions:</strong> <a href="https://github.com/Ivy-Interactive/Ivy-Tendril-V2/issues">GitHub Issues</a></p>
      </div>
    </section>
    <section>
      <h2>Company Address & Registered Office</h2>
      <p>
        <strong>Ivy Interactive AB</strong><br>
        Strandvägen 7A<br>
        114 56 Stockholm<br>
        Sweden
      </p>
    </section>
  </main>
  <footer>
    <p>&copy; ${new Date().getFullYear()} Ivy Interactive AB. Registered in Sweden.</p>
  </footer>
</body>
</html>`;
}

export function generatePrivacyPage(rawSiteUrl: string = CANONICAL_BASE_URL): string {
  const { siteRootUrl, docsBaseUrl } = resolveSiteUrls(rawSiteUrl);
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Privacy Policy · Ivy Tendril</title>
  <meta name="description" content="Privacy policy and data governance practices for Ivy Tendril desktop app and documentation.">
  <link rel="canonical" href="${siteRootUrl}/privacy">
  <link rel="ard" type="application/json" href="${siteRootUrl}/.well-known/ard.json">
  <link rel="ai-catalog" type="application/json" href="${siteRootUrl}/.well-known/ai-catalog.json">
  <meta property="og:title" content="Privacy Policy · Ivy Tendril">
  <meta property="og:description" content="Ivy Tendril local-first architecture and privacy commitments.">
  <meta property="og:image" content="${siteRootUrl}/og-image.png">
  <meta property="og:type" content="website">
  <style>
    body { font-family: system-ui, -apple-system, sans-serif; line-height: 1.6; max-width: 800px; margin: 0 auto; padding: 2rem 1rem; color: #1f2937; background: #ffffff; }
    h1, h2, h3 { color: #111827; }
    a { color: #2563eb; text-decoration: underline; text-underline-offset: 3px; }
    nav a { margin-right: 1rem; font-weight: 500; }
    header { border-bottom: 1px solid #e5e7eb; padding-bottom: 1.5rem; margin-bottom: 2rem; }
    footer { border-top: 1px solid #e5e7eb; padding-top: 1.5rem; margin-top: 3rem; font-size: 0.875rem; color: #6b7280; }
  </style>
</head>
<body>
  <header>
    <nav>
      <a href="${siteRootUrl}/">Home</a>
      <a href="${siteRootUrl}/developers">Developer Portal</a>
      <a href="${docsBaseUrl}/gettingstarted/introduction">Documentation</a>
      <a href="${siteRootUrl}/about">About</a>
      <a href="${siteRootUrl}/contact">Contact</a>
      <a href="${siteRootUrl}/privacy">Privacy Policy</a>
      <a href="${siteRootUrl}/llms.txt">llms.txt</a>
    </nav>
    <h1>Privacy Policy</h1>
    <p>Last updated: September 21, 2026</p>
  </header>
  <main>
    <section>
      <h2>1. Local-First Architecture</h2>
      <p>
        Ivy Tendril is built on a strict local-first privacy model. Your source code, git branches, plans, promptware definitions,
        and agent transcripts reside exclusively on your local machine in your working directory and the <code>~/.tendril/</code> folder.
        Tendril does not upload your repository source files, diffs, or project secrets to external Ivy servers.
      </p>
    </section>
    <section>
      <h2>2. Bring Your Own LLM Keys (BYO Keys)</h2>
      <p>
        When you configure model providers (such as Anthropic Claude, OpenAI, Google Gemini, OpenRouter, or European sovereign providers
        like Berget and Evroc), your API keys and credentials are stored securely in your local operating system keyring and encrypted
        vault. Model API requests are transmitted directly from your local machine to the chosen model provider's API endpoint over HTTPS.
        Ivy Interactive does not proxy, log, or inspect your model API traffic.
      </p>
    </section>
    <section>
      <h2>3. Documentation Website & GitHub Pages</h2>
      <p>
        This documentation website is statically hosted on GitHub Pages. Standard web server logs (IP address, user agent, and requested URLs)
        may be processed by GitHub pursuant to GitHub's Privacy Statement. No third-party behavioral ad trackers or invasive analytics cookies
        are embedded on our documentation pages.
      </p>
    </section>
    <section>
      <h2>4. GDPR and Data Subject Rights</h2>
      <p>
        In accordance with Regulation (EU) 2016/679 (GDPR), you retain full ownership and control over your personal data. Because Tendril
        operates locally on your device, you have complete power to export, modify, or permanently delete your local database and transcripts
        at any time by deleting <code>~/.tendril</code>.
      </p>
      <p>
        For inquiries regarding privacy practices or data subject requests, please contact our Data Protection Officer at
        <a href="mailto:privacy@ivy.app">privacy@ivy.app</a>.
      </p>
    </section>
  </main>
  <footer>
    <p>&copy; ${new Date().getFullYear()} Ivy Interactive AB. Registered in Sweden.</p>
  </footer>
</body>
</html>`;
}

export function generate404Markdown(rawSiteUrl: string = CANONICAL_BASE_URL): string {
  const { siteRootUrl, docsBaseUrl } = resolveSiteUrls(rawSiteUrl);
  return `# 404 Not Found

The requested path was not found on the Ivy Tendril documentation and developer portal service.

Please refer to the following canonical resources to discover valid endpoints, guides, and specifications:

- Documentation: ${docsBaseUrl}/gettingstarted/introduction
- Developer Portal: ${siteRootUrl}/developers
- OpenAPI 3.1.0 Specification: ${siteRootUrl}/openapi.json
- LLM Agent Guidelines: ${siteRootUrl}/llms.txt
- Full Documentation Context: ${siteRootUrl}/llms-full.txt
- XML Sitemap: ${siteRootUrl}/sitemap.xml
- Homepage: ${siteRootUrl}/
`;
}

export function generateStructuredErrorJson(): string {
  return JSON.stringify(
    {
      type: "https://ivy-interactive.github.io/Ivy-Tendril-V2/docs/advanced/rest#errors",
      title: "Not Found",
      status: 404,
      code: "RESOURCE_NOT_FOUND",
      message: "The requested resource could not be found on the Tendril daemon or documentation.",
      detail:
        "The requested path does not match any registered API route, static documentation page, or plan entity.",
      hint: "Query GET /api/v1/plans or inspect the OpenAPI 3.1.0 specification at /openapi.json and the Developer Portal at /developers.",
      documentation_url: "https://ivy-interactive.github.io/Ivy-Tendril-V2/developers",
    },
    null,
    2,
  );
}

export function generateDeveloperPortalPage(rawSiteUrl: string = CANONICAL_BASE_URL): string {
  const { siteRootUrl, docsBaseUrl } = resolveSiteUrls(rawSiteUrl);
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Developer Portal · Ivy Tendril</title>
  <meta name="description" content="Ivy Tendril Developer Portal: Quickstarts, REST & WebSocket APIs, Model Context Protocol (MCP) server, self-serve API keys, and sandbox environment.">
  <link rel="canonical" href="${siteRootUrl}/developers">
  <link rel="alternate" type="text/markdown" href="${siteRootUrl}/developers/index.md" title="Developer Portal Markdown">
  <link rel="ard" type="application/json" href="${siteRootUrl}/.well-known/ard.json">
  <link rel="ai-catalog" type="application/json" href="${siteRootUrl}/.well-known/ai-catalog.json">
  <meta property="og:title" content="Developer Portal · Ivy Tendril">
  <meta property="og:description" content="Quickstart guides, REST API, Model Context Protocol (MCP), self-serve API keys, and sandbox environment for Ivy Tendril.">
  <meta property="og:image" content="${siteRootUrl}/og-image.png">
  <meta property="og:type" content="website">
  <script type="application/ld+json">
  {
    "@context": "https://schema.org",
    "@type": "TechArticle",
    "headline": "Ivy Tendril Developer Portal",
    "description": "Comprehensive developer guide for integrating autonomous coding agents with Ivy Tendril via MCP, REST, CLI, and WebSockets.",
    "author": {
      "@type": "Organization",
      "name": "Ivy Interactive",
      "legalName": "Ivy Interactive AB",
      "url": "https://ivy.app"
    },
    "publisher": {
      "@type": "Organization",
      "name": "Ivy Interactive",
      "legalName": "Ivy Interactive AB",
      "url": "https://ivy.app"
    }
  }
  </script>
  <style>
    body { font-family: system-ui, -apple-system, sans-serif; line-height: 1.6; max-width: 900px; margin: 0 auto; padding: 2rem 1rem; color: #1f2937; background: #ffffff; }
    h1, h2, h3 { color: #111827; }
    h1 { font-size: 2.25rem; font-weight: 800; line-height: 1.2; margin-bottom: 0.5rem; }
    h2 { font-size: 1.5rem; font-weight: 700; margin-top: 2rem; border-bottom: 1px solid #e5e7eb; padding-bottom: 0.5rem; }
    h3 { font-size: 1.15rem; font-weight: 600; margin-top: 1.25rem; }
    a { color: #2563eb; text-decoration: underline; text-underline-offset: 3px; }
    nav a { margin-right: 1.25rem; font-weight: 500; }
    header { border-bottom: 1px solid #e5e7eb; padding-bottom: 1.5rem; margin-bottom: 2rem; }
    pre { background: #f3f4f6; padding: 1rem; border-radius: 6px; overflow-x: auto; font-family: monospace; font-size: 0.9rem; border: 1px solid #e5e7eb; }
    code { background: #f3f4f6; padding: 0.15rem 0.35rem; border-radius: 4px; font-family: monospace; font-size: 0.9em; }
    .card { background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 8px; padding: 1.25rem; margin: 1.25rem 0; }
    footer { border-top: 1px solid #e5e7eb; padding-top: 1.5rem; margin-top: 3rem; font-size: 0.875rem; color: #6b7280; }
  </style>
</head>
<body>
  <header>
    <nav aria-label="Main Navigation">
      <a href="${siteRootUrl}/">Home</a>
      <a href="${siteRootUrl}/developers">Developer Portal</a>
      <a href="${docsBaseUrl}/gettingstarted/introduction">Documentation</a>
      <a href="${siteRootUrl}/about">About</a>
      <a href="${siteRootUrl}/contact">Contact</a>
      <a href="${siteRootUrl}/privacy">Privacy Policy</a>
      <a href="${siteRootUrl}/llms.txt">llms.txt</a>
      <a href="${siteRootUrl}/sitemap.xml">Sitemap</a>
    </nav>
    <h1>Ivy Tendril Developer Portal</h1>
    <p>Everything you need to integrate, orchestrate, and build on Ivy Tendril's agentic software factory.</p>
  </header>
  <main>
    <section>
      <h2>Quickstart & Local Setup</h2>
      <p>
        Ivy Tendril runs a high-performance local daemon and desktop environment written in Rust and Tauri v2.
        Developers and autonomous agents can interface with Tendril through standard protocols:
      </p>
      <div class="card">
        <h3>1. Model Context Protocol (MCP)</h3>
        <p>Connect Claude Desktop, ChatGPT, or custom agent frameworks to the built-in MCP server:</p>
        <pre><code># Stdio transport:
tendril mcp

# Streamable HTTP / SSE transport (via background daemon):
http://127.0.0.1:5010/mcp</code></pre>
        <p>Discovery endpoint: <a href="${siteRootUrl}/.well-known/mcp.json">/.well-known/mcp.json</a> | Documentation: <a href="${docsBaseUrl}/advanced/mcp">MCP Guide</a></p>
      </div>
      <div class="card">
        <h3>2. Tendril Command Line Interface (CLI)</h3>
        <p>Supervise and execute plans directly from your shell:</p>
        <pre><code># Start the background daemon
tendril run

# Submit and run a plan in an isolated git worktree
tendril plan create "Add OAuth2 PKCE flow"
tendril plan run &lt;plan-id&gt;

# Check environment health
tendril doctor</code></pre>
      </div>
    </section>

    <section>
      <h2>Self-Serve API Keys & Authentication</h2>
      <div class="card">
        <h3>Zero Friction, Local-First Key Management</h3>
        <p>
          Ivy Tendril is <strong>100% Free and Source-Available</strong> under the Functional Source License (FSL-1.1-ALv2).
          There are no credit cards, paywalls, or "contact sales" forms.
        </p>
        <p>
          Generate and store API keys directly on your device using Tendril's local encrypted keyring:
        </p>
        <pre><code># Initialize your local vault
tendril vault init

# Set model provider API keys locally (never transmitted to Ivy servers)
tendril config set-key anthropic &lt;your-key&gt;
tendril config set-key openai &lt;your-key&gt;
tendril config set-key openrouter &lt;your-key&gt;</code></pre>
        <p>
          For HTTP daemon authentication, the daemon issues local Bearer tokens scoped to <code>plans:read</code>, <code>plans:write</code>, <code>worktrees:read</code>, and <code>worktrees:write</code>.
          Inspect discovery metadata at <a href="${siteRootUrl}/.well-known/oauth-authorization-server">/.well-known/oauth-authorization-server</a>.
        </p>
      </div>
    </section>

    <section>
      <h2>Interactive Sandbox & Test Environment</h2>
      <div class="card">
        <h3>Safe Agent Testing with Mock Daemon</h3>
        <p>
          Test your agent workflows, MCP integrations, and plan execution loops without touching real repositories or burning LLM tokens:
        </p>
        <pre><code># Start Tendril daemon in sandbox mode:
tendril run --sandbox

# Access sandbox endpoints on port 5010:
curl -s http://127.0.0.1:5010/sandbox/plans</code></pre>
        <p>
          In sandbox mode:
        </p>
        <ul>
          <li>All git worktrees are ephemeral and created in temporary memory directories.</li>
          <li>Verification test runners execute deterministic mock suites (unit, lint, visual).</li>
          <li>Agent responses can be replayed from pre-recorded deterministic fixtures.</li>
        </ul>
      </div>
    </section>

    <section>
      <h2>Machine-Readable APIs & Specifications</h2>
      <p>Agents and automated tools can fetch structured definitions directly:</p>
      <ul>
        <li><a href="${siteRootUrl}/openapi.json">OpenAPI 3.1.0 JSON Specification</a> — Complete REST API schemas and operation IDs.</li>
        <li><a href="${siteRootUrl}/openapi.yaml">OpenAPI 3.1.0 YAML Specification</a> — YAML format for Swagger/Postman tooling.</li>
        <li><a href="${siteRootUrl}/.well-known/mcp.json">MCP Discovery Manifest</a> — Model Context Protocol capabilities and tools.</li>
        <li><a href="${siteRootUrl}/llms.txt">llms.txt Guidance</a> — Curated project instructions and constraints for LLMs.</li>
        <li><a href="${siteRootUrl}/llms-full.txt">llms-full.txt</a> — Complete full-text documentation bundle.</li>
        <li><a href="${siteRootUrl}/api/v1/error.json">Typed RFC 9457 Error Sample</a> — Structured error model with error codes and remediation hints.</li>
      </ul>
    </section>

    <section>
      <h2>REST Rate Limits & Deprecation Policy</h2>
      <h3>Rate Limiting Conventions</h3>
      <p>
        Tendril daemon APIs enforce standard rate limits to protect local system resources.
        Every response includes RFC rate-limit headers:
      </p>
      <ul>
        <li><code>RateLimit-Limit</code>: Allowed requests in window (default: 120 req/min).</li>
        <li><code>RateLimit-Remaining</code>: Remaining capacity in current window.</li>
        <li><code>RateLimit-Reset</code>: Seconds until quota window resets.</li>
        <li><code>Retry-After</code>: Returned on HTTP 429 indicating seconds to wait before retry.</li>
      </ul>

      <h3>API Versioning & Deprecation Policy</h3>
      <p>
        Tendril APIs follow explicit URL versioning (current: <code>/api/v1</code>).
        When an endpoint is deprecated:
      </p>
      <ul>
        <li>Responses return the RFC 8594 <code>Deprecation: @&lt;timestamp&gt;</code> header.</li>
        <li>The retirement date is signaled with the <code>Sunset: &lt;date&gt;</code> header.</li>
        <li>Deprecated endpoints remain functional for a minimum <strong>180-day grace period</strong> before sunset.</li>
      </ul>
    </section>
  </main>
  <footer>
    <p>&copy; ${new Date().getFullYear()} Ivy Interactive AB. Strandvägen 7A, 114 56 Stockholm, Sweden. Contact: <a href="mailto:support@ivy.app">support@ivy.app</a>.</p>
  </footer>
</body>
</html>`;
}

export function generate404Html(rawSiteUrl: string = CANONICAL_BASE_URL): string {
  const { siteRootUrl, docsBaseUrl, repoSubpath } = resolveSiteUrls(rawSiteUrl);
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>404 Not Found · Ivy Tendril</title>
  <meta name="description" content="The requested page could not be found on Ivy Tendril documentation and developer services.">
  <link rel="canonical" href="${siteRootUrl}/404">
  <link rel="alternate" type="text/markdown" href="${siteRootUrl}/404.md" title="404 Markdown">
  <link rel="ard" type="application/json" href="${siteRootUrl}/.well-known/ard.json">
  <link rel="ai-catalog" type="application/json" href="${siteRootUrl}/.well-known/ai-catalog.json">
  <style>
    body { font-family: system-ui, -apple-system, sans-serif; line-height: 1.6; max-width: 800px; margin: 0 auto; padding: 2rem 1rem; color: #1f2937; background: #ffffff; }
    h1 { color: #111827; font-size: 2rem; margin-bottom: 0.5rem; }
    pre { background: #f3f4f6; padding: 1.25rem; border-radius: 8px; font-family: monospace; white-space: pre-wrap; word-break: break-word; font-size: 0.95rem; border: 1px solid #e5e7eb; }
    a { color: #2563eb; text-decoration: underline; text-underline-offset: 3px; }
    nav a { margin-right: 1.25rem; font-weight: 500; }
    header { border-bottom: 1px solid #e5e7eb; padding-bottom: 1rem; margin-bottom: 1.5rem; }
    footer { border-top: 1px solid #e5e7eb; padding-top: 1rem; margin-top: 2rem; font-size: 0.875rem; color: #6b7280; }
  </style>
</head>
<body>
<header>
  <nav aria-label="Main Navigation">
    <a href="${siteRootUrl}/">Home</a>
    <a href="${siteRootUrl}/developers">Developer Portal</a>
    <a href="${docsBaseUrl}/gettingstarted/introduction">Documentation</a>
    <a href="${siteRootUrl}/llms.txt">llms.txt</a>
    <a href="${siteRootUrl}/sitemap.xml">Sitemap</a>
  </nav>
</header>
<main>
  <h1>404 Not Found</h1>
  <p>The requested URL does not exist on this server. If you are an automated agent, parse the machine-readable error body below:</p>
  <pre id="markdown-error-body">
# 404 Not Found

The requested path was not found on the Ivy Tendril documentation and developer portal service.
If you are an automated agent, please refer to the following canonical resources:

- Documentation: ${docsBaseUrl}/gettingstarted/introduction
- Developer Portal: ${siteRootUrl}/developers
- OpenAPI Specification: ${siteRootUrl}/openapi.json
- LLM Agent Guidelines: ${siteRootUrl}/llms.txt
- Full Documentation: ${siteRootUrl}/llms-full.txt
- XML Sitemap: ${siteRootUrl}/sitemap.xml
- Homepage: ${siteRootUrl}/
  </pre>
</main>
<footer>
  <p>&copy; ${new Date().getFullYear()} Ivy Interactive AB. All rights reserved.</p>
</footer>
<script>
  var base = "${repoSubpath}";
  if (window.location.pathname.startsWith(base + "/docs")) {
    window.location.replace(base + "/docs/gettingstarted/introduction");
  }
</script>
</body>
</html>`;
}

export function generateHomepageHtml(rawSiteUrl: string = CANONICAL_BASE_URL): string {
  const { siteRootUrl, docsBaseUrl } = resolveSiteUrls(rawSiteUrl);
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Ivy Tendril — The Agentic Software Factory for 10x Builders</title>
  <meta name="description" content="Tendril replaces your IDE with autonomous coding agents running in parallel git worktrees with verification gates, plan annotations, and multi-model support.">
  <link rel="canonical" href="${siteRootUrl}/">
  <link rel="alternate" type="text/markdown" href="${siteRootUrl}/llms.txt" title="LLM Guidance">
  <link rel="alternate" type="text/markdown" href="${siteRootUrl}/index.md" title="Markdown">
  <link rel="ard" type="application/json" href="${siteRootUrl}/.well-known/ard.json">
  <link rel="ai-catalog" type="application/json" href="${siteRootUrl}/.well-known/ai-catalog.json">
  <meta property="og:title" content="Ivy Tendril — The Agentic Software Factory for 10x Builders">
  <meta property="og:description" content="Tendril replaces your IDE with autonomous coding agents running in parallel git worktrees with verification, annotations, and multi-model support.">
  <meta property="og:image" content="${siteRootUrl}/og-image.png">
  <meta property="og:type" content="website">
  <meta property="og:url" content="${siteRootUrl}/">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="Ivy Tendril — The Agentic Software Factory for 10x Builders">
  <meta name="twitter:description" content="Tendril replaces your IDE with autonomous coding agents running in parallel git worktrees.">
  <meta name="twitter:image" content="${siteRootUrl}/og-image.png">
  <script type="application/ld+json">
  {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "SoftwareApplication",
        "name": "Ivy Tendril",
        "applicationCategory": "DeveloperApplication",
        "operatingSystem": "macOS, Linux, Windows",
        "description": "The Agentic Software Factory for 10x Builders. Run autonomous coding agents in parallel git worktrees with verification gates, plan annotations, and multi-model support.",
        "url": "${siteRootUrl}/",
        "author": {
          "@type": "Organization",
          "name": "Ivy Interactive",
          "url": "https://ivy.app"
        },
        "offers": {
          "@type": "Offer",
          "price": "0",
          "priceCurrency": "USD",
          "availability": "https://schema.org/InStock",
          "description": "100% Free and Source-Available under FSL-1.1-ALv2"
        }
      },
      {
        "@type": "Organization",
        "name": "Ivy Interactive",
        "legalName": "Ivy Interactive AB",
        "url": "https://ivy.app",
        "brand": {
          "@type": "Brand",
          "name": "Ivy Interactive",
          "alternateName": "Ivy"
        },
        "description": "Ivy Interactive builds developer tools and autonomous agent execution infrastructure for modern software engineering.",
        "sameAs": [
          "https://github.com/Ivy-Interactive",
          "https://github.com/Ivy-Interactive/Ivy-Tendril-V2"
        ],
        "contactPoint": {
          "@type": "ContactPoint",
          "email": "support@ivy.app",
          "contactType": "customer support"
        },
        "address": {
          "@type": "PostalAddress",
          "streetAddress": "Strandvägen 7A",
          "addressLocality": "Stockholm",
          "postalCode": "114 56",
          "addressCountry": "SE"
        }
      }
    ]
  }
  </script>
  <style>
    body { font-family: system-ui, -apple-system, sans-serif; line-height: 1.6; max-width: 900px; margin: 0 auto; padding: 2rem 1rem; color: #1f2937; background: #ffffff; }
    h1, h2, h3 { color: #111827; }
    h1 { font-size: 2.25rem; font-weight: 800; line-height: 1.2; margin-bottom: 1rem; }
    h2 { font-size: 1.5rem; font-weight: 700; margin-top: 2rem; border-bottom: 1px solid #e5e7eb; padding-bottom: 0.5rem; }
    h3 { font-size: 1.15rem; font-weight: 600; margin-top: 1.25rem; }
    a { color: #2563eb; text-decoration: underline; text-underline-offset: 3px; }
    nav a { margin-right: 1.25rem; font-weight: 500; }
    header { border-bottom: 1px solid #e5e7eb; padding-bottom: 1.5rem; margin-bottom: 2rem; }
    .hero-btn { display: inline-block; background: #111827; color: #ffffff !important; padding: 0.75rem 1.5rem; border-radius: 6px; text-decoration: none; font-weight: 600; margin-top: 1rem; margin-bottom: 1rem; }
    .hero-btn:hover { background: #374151; }
    ul { padding-left: 1.5rem; }
    li { margin-bottom: 0.5rem; }
    footer { border-top: 1px solid #e5e7eb; padding-top: 1.5rem; margin-top: 3rem; font-size: 0.875rem; color: #6b7280; }
  </style>
</head>
<body>
  <header>
    <nav aria-label="Main Navigation">
      <a href="${siteRootUrl}/">Home</a>
      <a href="${siteRootUrl}/developers">Developer Portal</a>
      <a href="${docsBaseUrl}/gettingstarted/introduction">Documentation</a>
      <a href="${siteRootUrl}/about">About</a>
      <a href="${siteRootUrl}/contact">Contact</a>
      <a href="${siteRootUrl}/privacy">Privacy Policy</a>
      <a href="${siteRootUrl}/llms.txt">llms.txt</a>
      <a href="${siteRootUrl}/sitemap.xml">Sitemap</a>
    </nav>
  </header>
  <main>
    <section>
      <h1>Ivy Tendril — The Agentic Software Factory for 10x Builders</h1>
      <p>
        AI agents can now write 99% of the code. This fundamental shift changes what it means to be a developer.
        Our role shifts to knowing what good looks like, specifying clear goals, and supervising execution.
        Ivy Tendril replaces your traditional IDE with an autonomous coding factory engineered for parallel, unattended agent execution.
      </p>
      <p>
        <a href="${docsBaseUrl}/gettingstarted/introduction" class="hero-btn">Explore Documentation &rarr;</a>
        <a href="${siteRootUrl}/developers" class="hero-btn" style="background:#2563eb;margin-left:0.5rem">Developer Portal &rarr;</a>
      </p>
    </section>

    <section>
      <h2>Developer Portal & Fast Integrations</h2>
      <p>
        Whether configuring coding agents or integrating Tendril into your CI/CD pipelines, start with our developer resources:
      </p>
      <ul>
        <li><a href="${siteRootUrl}/developers">Developer Portal</a> — Quickstart, self-serve keys, sandbox daemon, and rate limits.</li>
        <li><a href="${siteRootUrl}/openapi.json">OpenAPI 3.1.0 Specification</a> — Machine-readable REST API schema with typed RFC 9457 error models.</li>
        <li><a href="${siteRootUrl}/.well-known/mcp.json">Model Context Protocol (MCP) Manifest</a> — Tools and Streamable HTTP endpoints.</li>
        <li><a href="${siteRootUrl}/llms.txt">llms.txt</a> — Machine-readable guidance optimized for LLMs.</li>
      </ul>
    </section>

    <section>
      <h2>Core Architecture & Key Capabilities</h2>
      
      <h3>Parallel Git Worktrees</h3>
      <p>
        Tendril runs coding agents in isolated git worktrees. Keep your main working tree clean while agents implement features,
        fix issues, or explore refactoring in parallel. Changes are only integrated once you review, verify, and approve them.
      </p>

      <h3>Plan Lifecycle & Supervision</h3>
      <p>
        Every task is modeled as a structured Plan with distinct states: Draft, Approved, Running, Completed, Failed, and Icebox.
        Add annotations, inspect real-time agent output, and guide agent reasoning mid-execution.
      </p>

      <h3>Deterministic Verification Gates</h3>
      <p>
        Configure automated verification routines (compiler checks, unit test suites, linters, and Playwright visual screenshot tests)
        that run automatically after agent turns, providing immediate feedback before human sign-off.
      </p>

      <h3>Built-in Model Context Protocol (MCP) Server</h3>
      <p>
        Tendril includes a first-party Model Context Protocol server exposing plan management, worktree control, and agent execution tools
        to Claude, ChatGPT, and custom orchestrators.
      </p>
    </section>

    <section>
      <h2>Documentation Sections</h2>
      <ul>
        <li><a href="${docsBaseUrl}/gettingstarted">Getting Started</a> — Installation, machine preparation, onboarding, and first plan walkthrough.</li>
        <li><a href="${docsBaseUrl}/concepts">Core Concepts</a> — Plans, promptwares, and lifecycle management.</li>
        <li><a href="${docsBaseUrl}/configuration">Configuration</a> — Project setup, danger zone management, and config schemas.</li>
        <li><a href="${docsBaseUrl}/apps">Applications</a> — Dashboard, Review, Plans, Jobs, Icebox, PRs, and Recommendations views.</li>
        <li><a href="${docsBaseUrl}/codingagents">Coding Agents</a> — Claude Code, OpenAI Codex, GitHub Copilot, OpenCode, and Google Gemini CLI integrations.</li>
        <li><a href="${docsBaseUrl}/integrations">Integrations</a> — GitHub CLI, JamDev bug reporting, and OpenClaw capture.</li>
        <li><a href="${docsBaseUrl}/modelproviders">Model Providers</a> — Berget, Evroc, Zai, Scaleway, Opper, OpenRouter, Cloudflare, NVIDIA, and Vercel.</li>
        <li><a href="${docsBaseUrl}/advanced">Advanced Reference</a> — CLI commands, Axum REST & WebSocket APIs, and MCP server configuration.</li>
      </ul>
    </section>
  </main>
  <footer>
    <p>&copy; ${new Date().getFullYear()} Ivy Interactive AB. All rights reserved. Registered office: Strandvägen 7A, 114 56 Stockholm, Sweden.</p>
  </footer>
  <script>
    if (typeof document !== 'undefined') {
      const register = (tool) => {
        try {
          if (document.modelContext && typeof document.modelContext.registerTool === 'function') {
            document.modelContext.registerTool(tool);
          } else if (typeof navigator !== 'undefined' && navigator.modelContext && typeof navigator.modelContext.registerTool === 'function') {
            navigator.modelContext.registerTool(tool);
          }
        } catch (e) {}
      };
      register({
        name: "tendril_mcp_info",
        description: "Retrieve Ivy Tendril agent orchestration tools, MCP manifest, and daemon endpoints.",
        parameters: { type: "object", properties: {} },
        execute: async () => ({
          mcp_endpoint: "http://127.0.0.1:5010/mcp",
          docs_url: "${docsBaseUrl}/gettingstarted/introduction",
          status: "ready"
        })
      });
    }
  </script>
  <form toolname="tendril_search_docs" tooldescription="Search Ivy Tendril documentation and architecture guide" action="${docsBaseUrl}/gettingstarted/introduction" method="get" style="display:none">
    <input name="q" type="text" placeholder="Search Tendril docs..." />
  </form>
</body>
</html>`;
}

export function emitAgenticAssets(options: EmitAgenticAssetsOptions): Plugin {
  const base = options.base ?? `${ROUTE_BASE}/`;
  const siteUrl = `${DEFAULT_ORIGIN}${base.endsWith("/") ? base.slice(0, -1) : base}`;

  return {
    name: "tendril-docs:emit-agentic-assets",

    writeBundle(outputOptions) {
      const outDir = outputOptions.dir;
      if (!outDir) return;

      const files = readContentFiles(options.contentDir);
      const routes = routesForContent(options.contentDir);

      // Copy og-image.png for stable social share cards and crawlers
      const ogSource = path.join(options.contentDir, "assets", "yt-thumbnail-in-two-minutes-2.png");
      if (existsSync(ogSource)) {
        copyFileSync(ogSource, path.join(outDir, "og-image.png"));
        const assetsDir = path.join(outDir, "assets");
        mkdirSync(assetsDir, { recursive: true });
        copyFileSync(ogSource, path.join(assetsDir, "og-image.png"));
      }

      // 1. robots.txt
      writeFileSync(path.join(outDir, "robots.txt"), generateRobotsTxt(siteUrl), "utf8");

      // 2. sitemap.xml
      writeFileSync(path.join(outDir, "sitemap.xml"), generateSitemap(routes, siteUrl), "utf8");

      // 3. llms.txt, llms-full.txt, index.md, and agent-instructions
      const llmsTxtContent = generateLlmsTxt(siteUrl);
      writeFileSync(path.join(outDir, "llms.txt"), llmsTxtContent, "utf8");
      writeFileSync(path.join(outDir, "index.md"), llmsTxtContent, "utf8");
      writeFileSync(path.join(outDir, "agent-instructions.txt"), llmsTxtContent, "utf8");
      writeFileSync(path.join(outDir, "agent-instructions.md"), llmsTxtContent, "utf8");
      writeFileSync(path.join(outDir, "llms-full.txt"), generateLlmsFullTxt(files), "utf8");

      // 4. Trust anchor pages: /about, /contact, /privacy, and /developers
      for (const [subDir, html] of [
        ["about", generateAboutPage(siteUrl)],
        ["contact", generateContactPage(siteUrl)],
        ["privacy", generatePrivacyPage(siteUrl)],
        ["developers", generateDeveloperPortalPage(siteUrl)],
      ] as const) {
        const dirPath = path.join(outDir, subDir);
        mkdirSync(dirPath, { recursive: true });
        writeFileSync(path.join(dirPath, "index.html"), html, "utf8");
        if (subDir === "developers") {
          writeFileSync(
            path.join(dirPath, "index.md"),
            generateDeveloperPortalMarkdown(siteUrl),
            "utf8",
          );
        }
      }

      // 5. MCP Discovery Manifest at /.well-known/mcp, /.well-known/mcp.json, OAuth metadata, and server-card
      const wellKnownDir = path.join(outDir, ".well-known");
      mkdirSync(wellKnownDir, { recursive: true });
      const mcpDir = path.join(wellKnownDir, "mcp");
      mkdirSync(mcpDir, { recursive: true });
      const mcpContent = generateMcpManifest(siteUrl);
      writeFileSync(path.join(wellKnownDir, "mcp.json"), mcpContent, "utf8");
      writeFileSync(path.join(mcpDir, "index.html"), mcpContent, "utf8");
      writeFileSync(path.join(mcpDir, "server-card.json"), mcpContent, "utf8");
      writeFileSync(path.join(wellKnownDir, "agent-instructions"), llmsTxtContent, "utf8");
      writeFileSync(
        path.join(wellKnownDir, "oauth-authorization-server"),
        generateOAuthServerMetadata(),
        "utf8",
      );
      writeFileSync(
        path.join(wellKnownDir, "oauth-protected-resource"),
        generateOAuthResourceMetadata(),
        "utf8",
      );

      // 6. OpenAPI Specifications and Structured Error Responses
      const openApiSpec = generateOpenApiSpec();
      const structuredErrorJson = generateStructuredErrorJson();
      writeFileSync(path.join(outDir, "openapi.json"), openApiSpec, "utf8");
      writeFileSync(path.join(outDir, "openapi.yaml"), openApiSpec, "utf8");

      const apiDir = path.join(outDir, "api");
      mkdirSync(apiDir, { recursive: true });
      writeFileSync(path.join(apiDir, "openapi.json"), openApiSpec, "utf8");
      writeFileSync(path.join(apiDir, "openapi.yaml"), openApiSpec, "utf8");
      writeFileSync(path.join(apiDir, "error.json"), structuredErrorJson, "utf8");

      const apiV1Dir = path.join(apiDir, "v1");
      mkdirSync(apiV1Dir, { recursive: true });
      writeFileSync(path.join(apiV1Dir, "error.json"), structuredErrorJson, "utf8");
      writeFileSync(
        path.join(apiV1Dir, "plans.json"),
        JSON.stringify(
          [
            {
              id: "plan-mock-1",
              title: "Example Autonomous Worktree Plan",
              state: "Draft",
              branch: "feat/mock-plan",
              annotations: ["Generated for agent API discovery"],
            },
          ],
          null,
          2,
        ),
        "utf8",
      );
      writeFileSync(
        path.join(apiV1Dir, "worktrees.json"),
        JSON.stringify(
          [
            {
              path: "/tmp/tendril/worktrees/mock-worktree",
              branch: "feat/mock-plan",
              clean: true,
            },
          ],
          null,
          2,
        ),
        "utf8",
      );

      // 7. Agent-friendly 404.html and 404.md
      writeFileSync(path.join(outDir, "404.html"), generate404Html(siteUrl), "utf8");
      writeFileSync(path.join(outDir, "404.md"), generate404Markdown(siteUrl), "utf8");

      // 8. Rich, agent-ready homepage.html for site root
      writeFileSync(path.join(outDir, "homepage.html"), generateHomepageHtml(siteUrl), "utf8");

      // 9. Agentic Resource Discovery Manifests: /.well-known/ard.json and /.well-known/ai-catalog.json
      const ardManifest = generateArdManifest(siteUrl);
      writeFileSync(path.join(wellKnownDir, "ard.json"), ardManifest, "utf8");
      writeFileSync(path.join(wellKnownDir, "ai-catalog.json"), ardManifest, "utf8");

      // 10. Agent Probing Aliases with rich HTML and Markdown bodies:
      // /getting-started, /gettingstarted, /mcp-server, /mcp, /setup, /install, /docs
      const gettingStartedHtml = generateGettingStartedPage(siteUrl);
      const gettingStartedMd = generateGettingStartedMarkdown(siteUrl);
      const mcpPageHtml = generateMcpPage(siteUrl);
      const mcpPageMd = generateMcpMarkdown(siteUrl);
      const docsOverviewHtml = generateDocsOverviewPage(siteUrl);
      const docsOverviewMd = generateDocsOverviewMarkdown(siteUrl);

      for (const dir of ["getting-started", "gettingstarted", "setup", "install"] as const) {
        const dirPath = path.join(outDir, dir);
        mkdirSync(dirPath, { recursive: true });
        writeFileSync(path.join(dirPath, "index.html"), gettingStartedHtml, "utf8");
        writeFileSync(path.join(dirPath, "index.md"), gettingStartedMd, "utf8");
      }

      for (const dir of ["mcp-server", "mcp"] as const) {
        const dirPath = path.join(outDir, dir);
        mkdirSync(dirPath, { recursive: true });
        writeFileSync(path.join(dirPath, "index.html"), mcpPageHtml, "utf8");
        writeFileSync(path.join(dirPath, "index.md"), mcpPageMd, "utf8");
      }

      const docsDir = path.join(outDir, "docs");
      mkdirSync(docsDir, { recursive: true });
      writeFileSync(path.join(docsDir, "index.html"), docsOverviewHtml, "utf8");
      writeFileSync(path.join(docsDir, "index.md"), docsOverviewMd, "utf8");
    },
  };
}
