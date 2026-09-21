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
  generateOpenApiSpec,
  generateOAuthServerMetadata,
  generateOAuthResourceMetadata,
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
    expect(robots).toContain(
      "Sitemap: https://ivy-interactive.github.io/Ivy-Tendril-V2/sitemap.xml",
    );
  });
});

describe("sitemap.xml", () => {
  const sitemap = generateSitemap(routes);

  it("is valid XML with urlset schema", () => {
    expect(sitemap).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(sitemap).toContain('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">');
  });

  it("indexes root, trust pages, and documentation routes", () => {
    expect(sitemap).toContain("<loc>https://ivy-interactive.github.io/Ivy-Tendril-V2/</loc>");
    expect(sitemap).toContain("<loc>https://ivy-interactive.github.io/Ivy-Tendril-V2/about</loc>");
    expect(sitemap).toContain(
      "<loc>https://ivy-interactive.github.io/Ivy-Tendril-V2/contact</loc>",
    );
    expect(sitemap).toContain(
      "<loc>https://ivy-interactive.github.io/Ivy-Tendril-V2/privacy</loc>",
    );
    expect(sitemap).toContain(
      "<loc>https://ivy-interactive.github.io/Ivy-Tendril-V2/docs/gettingstarted/introduction</loc>",
    );
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

describe("agent-friendly 404", () => {
  const page404 = generate404Html();

  it("includes a markdown error body with at least 20 characters and links", () => {
    expect(page404).toContain("# 404 Not Found");
    expect(page404).toContain("The requested page was not found");
    expect(page404).toContain(
      "Documentation: https://ivy-interactive.github.io/Ivy-Tendril-V2/docs",
    );
    expect(page404).toContain(
      "Sitemap: https://ivy-interactive.github.io/Ivy-Tendril-V2/sitemap.xml",
    );
    expect(page404).toContain(
      "LLMs Guide: https://ivy-interactive.github.io/Ivy-Tendril-V2/llms.txt",
    );
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
