# Porting status

This crate is a port of `Ivy.Tendril.Wireframe` from V1 (`Ivy-Interactive/Ivy-Tendril` PR #2711),
pinned at **`c146947c`**. `PARITY.md` covers how to check the port against the original.

The PR is ~12,700 lines of real change across 106 files, once the 34k lines of vendored TypeScript
definitions are set aside. This file tracks what has landed.

## Done

| Area | Module | V1 source |
|---|---|---|
| Project layout and settings | `project` | `Project/{WireframeProject,WireframeConfig}.cs` |
| Scaffold templates | `project::templates`, `templates/*.template` | `Project/ScaffoldTemplates.cs` |
| `setup` | `project::scaffolder` | `Project/ProjectScaffolder.cs` |
| esbuild provisioning | `build::esbuild` | `Build/EsbuildProvisioner.cs` |
| Bundling and watching | `build::bundler` | `Build/EsbuildBundler.cs` |
| Embedded payload | `assets::catalog` | `Assets/AssetCatalog.cs` |
| Import map / externals | `assets::vendor_manifest` | `Assets/VendorManifest.cs` |
| Payload pipeline | `pipeline/vendor/*.mjs`, `artifacts/` | `pipeline/vendor/*.mjs` |
| Component manifest | `manifest` | `Manifest/{ComponentManifest,FlexibleString*}.cs` |
| Agent reference | `manifest::agent_readme` | `Manifest/AgentReadmeRenderer.cs` |
| Served document | `hosting::index_html` | `Hosting/IndexHtmlBuilder.cs` |
| Browser location | `browser::locator` | `Browser/BrowserLocator.cs` |
| Headless launch | `browser::process` | `Browser/BrowserProcess.cs` |
| CDP client | `browser::cdp` | `Browser/CdpConnection.cs` |
| Capture determinism | `screenshot::determinism` | `Screenshot/DeterminismPayload.cs` |
| Capture | `screenshot::runner` | `Screenshot/ScreenshotRunner.cs` |

## Not started

| Area | V1 source | Notes |
|---|---|---|
| Standalone dev server | `Hosting/{WireframeServer,WireframeEndpoints,LiveReloadClient}.cs` | what `serve` runs |
| Tendril's wireframe host | `Hosting/WireframeHost.cs` | `/__wireframes/{plan}/{name}/`, plan-scoped watchers |
| Tailwind jit mode | `Build/{TailwindProvisioner,TailwindCompiler}.cs` | `--tailwind jit`, downloads the standalone CLI |
| Utility class linter | `Build/{UtilityClassLinter,CssSelectorIndex}.cs` | warns on classes the superset does not contain |
| CLI commands | `Commands/Wireframe/*.cs` | `setup`, `serve`, `screenshot`, `agent-readme` |
| Fence validator | `Services/Plans/WireframeFenceValidator.cs` | rejects a malformed `wireframe` block on write |
| Leak guard | `Services/Wireframes/WireframeLeakGuard.cs` | keeps a wireframe out of a product repo |
| Plan wiring | `Services/Wireframes/PlanWireframes.cs`, job hooks, project settings | `wireframes`, `wireframeGuard` |
| Frontend fence | `Ivy.Tendril.Widgets/frontend/src/PlanMarkdown/WireframeBlock.tsx` | lands in `packages/components` |
| Promptwares | `Prompts/Plans.md`, `Promptwares/*/Program.md` | lands in `src/promptwares` |

## Deliberate deviations from V1

Three, all recorded where they apply:

1. **Newlines.** V1 builds its generated documents with `AppendLine`, so their content is CRLF on
   Windows and LF elsewhere. This crate always emits LF. See `PARITY.md`.
2. **No zip.** V1 embeds the payload as a compressed assembly resource and caches decompressed
   entries; `include_dir!` embeds it uncompressed, so a read is a slice and there is nothing to
   cache. Costs ~3.7 MB of binary.
3. **`.gitattributes`.** V1 keeps the payload byte-stable with a repository-wide
   `* text=auto eol=lf`. V2 has no root attributes file, so the rule is scoped to this crate
   instead of renormalising the repository.

Everything else is intended to match V1's behaviour exactly.
