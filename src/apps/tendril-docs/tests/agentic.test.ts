import { describe, expect, it } from "vitest";
import {
  generateRobotsTxt,
  generateSitemap,
  generateLlmsTxt,
  generateLlmsFullTxt,
  generateMcpManifest,
  generateAboutPage,
  generateContactPage,
  generatePrivacyPage,
  generateHomepageHtml,
  generate404Html,
  generate404Markdown,
  generateStructuredErrorJson,
  generateDeveloperPortalPage,
  generateDeveloperPortalMarkdown,
  generateOpenApiSpec,
  generateOAuthServerMetadata,
  generateOAuthResourceMetadata,
  generateArdManifest,
  generateGettingStartedPage,
  generateGettingStartedMarkdown,
  generateMcpPage,
  generateMcpMarkdown,
  generateDocsOverviewPage,
  generateDocsOverviewMarkdown,
} from "../src/plugins/emit-agentic-assets";
import { readContent } from "./helpers";
import { routesForContent } from "../src/plugins/emit-route-shells";
import { CONTENT_DIR } from "./helpers";

const routes = routesForContent(CONTENT_DIR);
const contentFiles = readContent();

describe("robots.txt", () => {
  const robots = generateRobotsTxt();

  it("explicitly allowlists major AI agent user agents", () => {
    expect(robots).toContain("User-agent: ChatGPT-User\nAllow: /");
    expect(robots).toContain("User-agent: ClaudeBot\nAllow: /");
    expect(robots).toContain("User-agent: Google-Extended\nAllow: /");
    expect(robots).toContain("User-agent: DeepSeekBot\nAllow: /");
    expect(robots).toContain("User-agent: ora-agent\nAllow: /");
  });

  it("includes sitemap reference", () => {
    expect(robots).toContain("Sitemap: https://docs.ivy.app/sitemap.xml");
  });
});

describe("sitemap.xml", () => {
  const sitemap = generateSitemap(routes);

  it("is valid XML with urlset schema", () => {
    expect(sitemap).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(sitemap).toContain('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">');
  });

  it("indexes root, trust pages, and documentation routes", () => {
    expect(sitemap).toContain("<loc>https://docs.ivy.app/</loc>");
    expect(sitemap).toContain("<loc>https://docs.ivy.app/about</loc>");
    expect(sitemap).toContain("<loc>https://docs.ivy.app/contact</loc>");
    expect(sitemap).toContain("<loc>https://docs.ivy.app/privacy</loc>");
    expect(sitemap).toContain("<loc>https://docs.ivy.app/docs/gettingstarted/introduction</loc>");
    expect(sitemap.match(/<url>/g)?.length).toBeGreaterThanOrEqual(routes.length + 4);
  });
});

describe("llms.txt and llms-full.txt", () => {
  const llms = generateLlmsTxt();
  const full = generateLlmsFullTxt(contentFiles);

  it("includes clear project title and summary", () => {
    expect(llms).toContain("# Ivy Tendril");
    expect(llms).toContain("> The Agentic Software Factory for 10x Builders.");
  });

  it("provides specific 'When to use this' guidance", () => {
    expect(llms).toContain("## When to use this");
    expect(llms).toContain("parallel git worktrees");
    expect(llms).toContain("verification gates");
  });

  it("describes how an agent should call Tendril", () => {
    expect(llms).toContain("## How an agent should call Tendril");
    expect(llms).toContain("tendril mcp");
    expect(llms).toContain("tendril plan create");
    expect(llms).toContain("http://127.0.0.1:5010");
  });

  it("specifies when NOT to use this", () => {
    expect(llms).toContain("## When NOT to use this");
    expect(llms).toContain("legacy Ivy Framework");
  });

  it("generates complete documentation context in llms-full.txt", () => {
    expect(full.length).toBeGreaterThan(50000);
    expect(full).toContain("Ivy Tendril — Complete Documentation");
    expect(full).toContain("Introduction");
    expect(full).toContain("Plans");
  });
});

describe("trust anchor pages (/about, /contact, /privacy)", () => {
  const about = generateAboutPage();
  const contact = generateContactPage();
  const privacy = generatePrivacyPage();

  it("each contains at least 500 characters of meaningful content", () => {
    expect(about.length).toBeGreaterThan(1000);
    expect(contact.length).toBeGreaterThan(1000);
    expect(privacy.length).toBeGreaterThan(1500);
  });

  it("each page includes complete metadata signals", () => {
    for (const page of [about, contact, privacy]) {
      expect(page).toContain('<html lang="en">');
      expect(page).toContain('<link rel="canonical"');
      expect(page).toContain('<meta property="og:image"');
      expect(page).toContain('<meta property="og:type" content="website">');
    }
  });

  it("contact page includes verified email and postal address", () => {
    expect(contact).toContain("support@ivy.app");
    expect(contact).toContain("Strandvägen 7A");
    expect(contact).toContain("Stockholm");
  });
});

describe("homepage HTML and JSON-LD structured data", () => {
  const home = generateHomepageHtml();

  it("contains at least 500 characters of raw HTML prose", () => {
    expect(home.length).toBeGreaterThan(2000);
  });

  it("has clear sequential heading levels (H1, H2, H3)", () => {
    expect(home).toContain("<h1>Ivy Tendril — The Agentic Software Factory for 10x Builders</h1>");
    expect(home).toContain("<h2>Core Architecture & Key Capabilities</h2>");
    expect(home).toContain("<h3>Parallel Git Worktrees</h3>");
  });

  it("includes all 4 metadata signals", () => {
    expect(home).toContain('<html lang="en">');
    expect(home).toContain('<link rel="canonical"');
    expect(home).toContain('<meta property="og:image"');
    expect(home).toContain('<meta property="og:type" content="website">');
  });

  it("includes complete JSON-LD for SoftwareApplication and Organization", () => {
    expect(home).toContain('"@type": "SoftwareApplication"');
    expect(home).toContain('"@type": "Organization"');
    expect(home).toContain('"contactPoint"');
    expect(home).toContain('"PostalAddress"');
    expect(home).toContain('"Strandvägen 7A"');
  });
});

describe("developer portal (/developers)", () => {
  const devPortal = generateDeveloperPortalPage();

  it("contains rich semantic HTML with over 1500 characters", () => {
    expect(devPortal.length).toBeGreaterThan(1500);
  });

  it("has clear sequential headings and key sections", () => {
    expect(devPortal).toContain("<h1>Ivy Tendril Developer Portal</h1>");
    expect(devPortal).toContain("<h2>Quickstart & Local Setup</h2>");
    expect(devPortal).toContain("<h2>Self-Serve API Keys & Authentication</h2>");
    expect(devPortal).toContain("<h2>Interactive Sandbox & Test Environment</h2>");
    expect(devPortal).toContain("<h2>REST Rate Limits & Deprecation Policy</h2>");
  });

  it("highlights zero-friction onboarding, free tier, and sandbox mode", () => {
    expect(devPortal).toContain("100% Free and Source-Available");
    expect(devPortal).toContain("tendril vault init");
    expect(devPortal).toContain("tendril run --sandbox");
  });
});

describe("agent-friendly 404 and structured JSON errors", () => {
  const page404 = generate404Html();
  const md404 = generate404Markdown();
  const errorJson = JSON.parse(generateStructuredErrorJson());

  it("includes a markdown error body with at least 20 characters and links", () => {
    expect(page404).toContain("# 404 Not Found");
    expect(page404).toContain("The requested path was not found");
    expect(page404).toContain("Documentation: https://docs.ivy.app/docs");
    expect(page404).toContain("Developer Portal: https://docs.ivy.app/developers");
    expect(page404).toContain("Sitemap: https://docs.ivy.app/sitemap.xml");
    expect(page404).toContain("LLM Agent Guidelines: https://docs.ivy.app/llms.txt");
  });

  it("provides clean standalone 404 markdown file", () => {
    expect(md404).toContain("# 404 Not Found");
    expect(md404.length).toBeGreaterThan(100);
  });

  it("generates structured JSON error responses with codes and hints", () => {
    expect(errorJson.code).toBe("RESOURCE_NOT_FOUND");
    expect(errorJson.message).toBeDefined();
    expect(errorJson.hint).toBeDefined();
    expect(errorJson.status).toBe(404);
  });
});

describe("MCP server discovery manifest", () => {
  const mcp = JSON.parse(generateMcpManifest());

  it("validates MCP server schema and capabilities", () => {
    expect(mcp.name).toBe("tendril-mcp");
    expect(mcp.version).toBe("2.0.0");
    expect(mcp.capabilities.tools).toBe(true);
    expect(mcp.transport.command).toBe("tendril");
    expect(mcp.transport.args).toContain("mcp");
    expect(mcp.endpoints.streamable_http).toBe("http://127.0.0.1:5010/mcp");
  });

  it("includes full tools array with inputSchemas for function calling", () => {
    expect(Array.isArray(mcp.tools)).toBe(true);
    expect(mcp.tools.length).toBeGreaterThanOrEqual(5);
    const planList = mcp.tools.find((t: { name: string }) => t.name === "plan_list");
    expect(planList).toBeDefined();
    expect(planList.inputSchema.type).toBe("object");
  });
});

describe("OpenAPI specification", () => {
  const spec = JSON.parse(generateOpenApiSpec());

  it("validates OpenAPI 3.1.0 structure", () => {
    expect(spec.openapi).toBe("3.1.0");
    expect(spec.info.title).toContain("Tendril");
    expect(spec.paths["/api/v1/plans"]).toBeDefined();
    expect(spec.paths["/api/v1/plans"].get).toBeDefined();
    expect(spec.paths["/api/v1/plans"].post).toBeDefined();
    expect(spec.paths["/api/v1/worktrees"]).toBeDefined();
    expect(spec.paths["/api/v1/verification/run"]).toBeDefined();
  });

  it("declares RFC 9457 ProblemDetails and ErrorResponse typed error models", () => {
    expect(spec.components.schemas.ProblemDetails).toBeDefined();
    expect(spec.components.schemas.ProblemDetails.required).toContain("type");
    expect(spec.components.schemas.ProblemDetails.required).toContain("code");
    expect(spec.components.schemas.ErrorResponse).toBeDefined();
    expect(spec.components.schemas.ErrorResponse.required).toContain("code");
  });

  it("documents standard rate-limit and deprecation headers", () => {
    expect(spec.components.headers["RateLimit-Limit"]).toBeDefined();
    expect(spec.components.headers["RateLimit-Remaining"]).toBeDefined();
    expect(spec.components.headers["RateLimit-Reset"]).toBeDefined();
    expect(spec.components.headers["Retry-After"]).toBeDefined();
    expect(spec.components.headers.Deprecation).toBeDefined();
    expect(spec.components.headers.Sunset).toBeDefined();
  });

  it("declares OAuth2 security scheme with scoped permissions", () => {
    const oauth = spec.components.securitySchemes.OAuth2;
    expect(oauth.type).toBe("oauth2");
    const scopes = oauth.flows.authorizationCode.scopes;
    expect(scopes["plans:read"]).toBeDefined();
    expect(scopes["plans:write"]).toBeDefined();
  });
});

describe("OAuth metadata", () => {
  it("generates valid authorization server metadata", () => {
    const authServer = JSON.parse(generateOAuthServerMetadata());
    expect(authServer.issuer).toBe("https://ivy.app");
    expect(authServer.scopes_supported).toContain("plans:read");
    expect(authServer.code_challenge_methods_supported).toContain("S256");
  });

  it("generates valid protected resource metadata (RFC 9728)", () => {
    const resource = JSON.parse(generateOAuthResourceMetadata());
    expect(resource.resource).toBe("http://127.0.0.1:5010");
    expect(resource.scopes_supported).toContain("plans:read");
  });
});

describe("Agentic Resource Discovery (ARD) Manifest", () => {
  const ard = JSON.parse(generateArdManifest());

  it("conforms to ARD specification with valid specVersion and host", () => {
    expect(ard.specVersion).toBe("1.0");
    expect(ard.host).toBeDefined();
    expect(ard.host.displayName).toBe("Ivy Interactive");
    expect(ard.host.url).toBe("https://docs.ivy.app");
  });

  it("includes entries with domain-anchored urn:air identifiers", () => {
    expect(Array.isArray(ard.entries)).toBe(true);
    expect(ard.entries.length).toBeGreaterThanOrEqual(4);

    for (const entry of ard.entries) {
      expect(entry.identifier).toMatch(/^urn:air:/);
      expect(entry.displayName).toBeDefined();
      expect(entry.type).toBeDefined();
      expect(entry.url).toBeDefined();
      expect(entry.description).toBeDefined();
      expect(Array.isArray(entry.representativeQueries)).toBe(true);
      expect(entry.representativeQueries.length).toBeGreaterThan(0);
    }

    const mcpEntry = ard.entries.find(
      (e: { type: string }) => e.type === "application/mcp-server+json",
    );
    expect(mcpEntry).toBeDefined();
    expect(mcpEntry.identifier).toBe("urn:air:docs.ivy.app:mcp:tendril");

    const apiEntry = ard.entries.find(
      (e: { type: string }) => e.type === "application/openapi+json",
    );
    expect(apiEntry).toBeDefined();
    expect(apiEntry.identifier).toBe("urn:air:docs.ivy.app:api:openapi");
  });
});

describe("Agent Probing Aliases (/getting-started, /mcp-server, /docs)", () => {
  const gsHtml = generateGettingStartedPage();
  const gsMd = generateGettingStartedMarkdown();
  const mcpHtml = generateMcpPage();
  const mcpMd = generateMcpMarkdown();
  const docsHtml = generateDocsOverviewPage();
  const docsMd = generateDocsOverviewMarkdown();
  const devMd = generateDeveloperPortalMarkdown();

  it("each HTML alias page contains at least 1500 chars of meaningful semantic HTML", () => {
    expect(gsHtml.length).toBeGreaterThan(2000);
    expect(mcpHtml.length).toBeGreaterThan(1500);
    expect(docsHtml.length).toBeGreaterThan(2000);
  });

  it("includes ARD links and canonical links in HTML alias pages", () => {
    for (const page of [gsHtml, mcpHtml, docsHtml]) {
      expect(page).toContain('rel="ard"');
      expect(page).toContain('rel="ai-catalog"');
      expect(page).toContain('rel="canonical"');
    }
  });

  it("getting-started page provides clear CLI quickstarts and commands", () => {
    expect(gsHtml).toContain("tendril doctor");
    expect(gsHtml).toContain("tendril onboarding");
    expect(gsHtml).toContain("tendril run");
    expect(gsHtml).toContain("tendril plan create");
    expect(gsMd).toContain("tendril doctor");
  });

  it("mcp page provides config snippet and tools table", () => {
    expect(mcpHtml).toContain("plan_list");
    expect(mcpHtml).toContain("worktree_list");
    expect(mcpHtml).toContain("verification_run");
    expect(mcpMd).toContain("tendril mcp");
  });

  it("developer portal and docs overview markdown provide structured guides and commands", () => {
    expect(devMd).toContain("# Ivy Tendril Developer Portal");
    expect(devMd).toContain("tendril vault init");
    expect(devMd).toContain("tendril run --sandbox");
    expect(docsMd).toContain("# Ivy Tendril Documentation Overview");
  });
});
