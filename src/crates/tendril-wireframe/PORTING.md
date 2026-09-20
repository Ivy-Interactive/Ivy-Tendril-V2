# Porting status

This crate is a port of `Ivy.Tendril.Wireframe` from V1 (`Ivy-Interactive/Ivy-Tendril` PR #2711),
pinned at **`c146947c`**. `PARITY.md` covers how to check the port against the original.

The PR is ~12,700 lines of real change across 106 files, once the 34k lines of vendored TypeScript
definitions are set aside. This file tracks what has landed.

## Done

Everything in PR #2711 except the two items under **Not ported** below.

| Area | Where it lives | V1 source |
|---|---|---|
| Project layout and settings | `project` | `Project/{WireframeProject,WireframeConfig}.cs` |
| Scaffold templates | `project::templates`, `templates/*.template` | `Project/ScaffoldTemplates.cs` |
| `setup` | `project::scaffolder` | `Project/ProjectScaffolder.cs` |
| esbuild provisioning | `build::esbuild` | `Build/EsbuildProvisioner.cs` |
| Bundling and watching | `build::bundler` | `Build/EsbuildBundler.cs` |
| Embedded payload | `assets::catalog`, `build.rs` | `Assets/AssetCatalog.cs` |
| Import map / externals | `assets::vendor_manifest` | `Assets/VendorManifest.cs` |
| Payload pipeline | `pipeline/vendor/*.mjs`, `artifacts/` | `pipeline/vendor/*.mjs` |
| Component manifest | `manifest` | `Manifest/{ComponentManifest,FlexibleString*}.cs` |
| Agent reference | `manifest::agent_readme` | `Manifest/AgentReadmeRenderer.cs` |
| Served document | `hosting::index_html` | `Hosting/IndexHtmlBuilder.cs` |
| Route decisions | `hosting::serving` | `Hosting/WireframeEndpoints.cs` |
| Live reload | `hosting::live_reload` | `Hosting/LiveReloadClient.cs` |
| Standalone dev server | `hosting::server` | `Hosting/WireframeServer.cs` |
| Plan preview host | `hosting::host` | `Hosting/WireframeHost.cs` |
| Browser location | `browser::locator` | `Browser/BrowserLocator.cs` |
| Headless launch | `browser::process` | `Browser/BrowserProcess.cs` |
| CDP client | `browser::cdp` | `Browser/CdpConnection.cs` |
| Capture determinism | `screenshot::determinism` | `Screenshot/DeterminismPayload.cs` |
| Capture | `screenshot::runner` | `Screenshot/ScreenshotRunner.cs` |
| CLI | `tendril-cli::commands::wireframe` | `Commands/Wireframe/*.cs` |
| Plan folder rules | `tendril-core::wireframes` | `Services/Wireframes/PlanWireframes.cs` |
| Leak guard | `tendril-core::wireframes::leak_guard` | `Services/Wireframes/WireframeLeakGuard.cs` |
| Guard entry point | `tendril-core::wireframes::plan_guard` | `Services/Wireframes/PlanWireframeGuard.cs` |
| Fence validator | `tendril-core::wireframes::fence` | `Services/Plans/WireframeFenceValidator.cs` |
| Project settings | `ProjectConfig::{wireframes,wireframe_guard}` | `Services/ConfigService.cs` |
| Execution gate | `plans::verification_gate` | `Services/Jobs/JobCompletionHandler.cs` |
| PR launch gate | `jobs::manager` | `Services/Jobs/JobLauncher.cs` |
| Completion gate | `PlanCompletionGuard::wireframe_refusal` | `Services/Plans/PlanCompletionGuard.cs` |
| `plan check-wireframes` | `tendril-cli::commands::plan` | `Commands/PlanCheckWireframesCommand.cs` |
| Daemon routes | `tendril-server::routes::wireframes` | `Hosting/WireframeEndpoints.cs` |
| Fence renderer | `packages/components/.../WireframeBlock.tsx` | same file (fork-forward) |
| Agent guidance | `promptware/plan_reference.md`, `src/promptwares/*` | `Prompts/Plans.md`, `Promptwares/*` |

## Not ported

| Area | V1 source | Why |
|---|---|---|
| Tailwind `jit` mode | `Build/{TailwindProvisioner,TailwindCompiler}.cs` | `--tailwind jit` refuses with a clear message rather than silently falling back to the superset, which would give a project whose arbitrary values quietly do nothing |
| Utility class linter | `Build/{UtilityClassLinter,CssSelectorIndex}.cs` | warns when a class is not in the superset; the agent reference already documents the limitation |

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
