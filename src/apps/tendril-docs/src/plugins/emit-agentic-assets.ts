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

## When NOT to use this

- Do NOT use Tendril for simple single-file quick edits where agent orchestration, isolated git worktrees, and automated verification loops are unnecessary.
- Do NOT confuse Tendril with the legacy Ivy Framework (v1 C#/.NET library); Tendril v2 is a completely redesigned desktop application and daemon built from scratch in Rust and Tauri v2.

## Key Documentation & Links

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
        type: "stdio",
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
      },
      repository: "https://github.com/Ivy-Interactive/Ivy-Tendril-V2",
    },
    null,
    2,
  );
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

export function generate404Html(rawSiteUrl: string = CANONICAL_BASE_URL): string {
  const { siteRootUrl, docsBaseUrl, repoSubpath } = resolveSiteUrls(rawSiteUrl);
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>404 Not Found · Ivy Tendril</title>
  <meta name="description" content="The requested page could not be found on Ivy Tendril documentation.">
  <link rel="canonical" href="${siteRootUrl}/404">
  <style>
    body { font-family: system-ui, -apple-system, sans-serif; line-height: 1.6; max-width: 800px; margin: 0 auto; padding: 2rem 1rem; color: #1f2937; background: #ffffff; }
    h1 { color: #111827; }
    pre { background: #f3f4f6; padding: 1rem; border-radius: 6px; font-family: monospace; white-space: pre-wrap; word-break: break-word; }
    a { color: #2563eb; text-decoration: underline; }
  </style>
</head>
<body>
<main>
  <h1>404 Not Found</h1>
  <p>The requested page was not found on this server. Please check the URL or use the links below.</p>
  <pre>
# 404 Not Found

The requested page was not found on Ivy Tendril documentation.

- Documentation: ${docsBaseUrl}/gettingstarted/introduction
- Sitemap: ${siteRootUrl}/sitemap.xml
- LLMs Guide: ${siteRootUrl}/llms.txt
- Home: ${siteRootUrl}/
  </pre>
</main>
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
          "priceCurrency": "USD"
        }
      },
      {
        "@type": "Organization",
        "name": "Ivy Interactive",
        "url": "https://ivy.app",
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
      </p>
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

      // 4. Trust anchor pages: /about, /contact, /privacy
      for (const [subDir, html] of [
        ["about", generateAboutPage(siteUrl)],
        ["contact", generateContactPage(siteUrl)],
        ["privacy", generatePrivacyPage(siteUrl)],
      ] as const) {
        const dirPath = path.join(outDir, subDir);
        mkdirSync(dirPath, { recursive: true });
        writeFileSync(path.join(dirPath, "index.html"), html, "utf8");
      }

      // 5. MCP Discovery Manifest at /.well-known/mcp & /.well-known/mcp.json
      const wellKnownDir = path.join(outDir, ".well-known");
      mkdirSync(wellKnownDir, { recursive: true });
      const mcpContent = generateMcpManifest(siteUrl);
      writeFileSync(path.join(wellKnownDir, "mcp"), mcpContent, "utf8");
      writeFileSync(path.join(wellKnownDir, "mcp.json"), mcpContent, "utf8");
      writeFileSync(path.join(wellKnownDir, "agent-instructions"), llmsTxtContent, "utf8");

      // 6. Agent-friendly 404.html
      writeFileSync(path.join(outDir, "404.html"), generate404Html(siteUrl), "utf8");

      // 7. Rich, agent-ready homepage.html for site root
      writeFileSync(path.join(outDir, "homepage.html"), generateHomepageHtml(siteUrl), "utf8");
    },
  };
}
