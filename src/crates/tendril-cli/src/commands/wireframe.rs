//! `tendril wireframe setup | serve | screenshot | agent-readme`.
//!
//! Ported from V1's `Commands/Wireframe/*.cs`. A wireframe is the hand-drawn React sketch a planning
//! agent makes for a plan that involves UX; these are the commands an agent and a reviewer drive it
//! with.

use std::path::PathBuf;
use std::time::Duration;

use anyhow::{bail, Result};
use clap::Subcommand;
use tendril_wireframe::assets::{catalog, VendorManifest};
use tendril_wireframe::build::{bundler, esbuild, EsbuildWatcher, WatchEvent};
use tendril_wireframe::hosting::live_reload::ReloadMessage;
use tendril_wireframe::hosting::{server, WireframeServer, WireframeSite};
use tendril_wireframe::manifest::{agent_readme::AgentReadmeRenderer, ComponentManifest};
use tendril_wireframe::project::{scaffolder, WireframeConfig, WireframeProject};
use tendril_wireframe::screenshot::{self, ScreenshotOptions};
use tendril_wireframe::TailwindMode;

#[derive(Subcommand)]
pub enum WireframeCommands {
    #[command(about = "Scaffold a wireframe project (fast, offline)")]
    Setup {
        #[arg(value_name = "PATH", default_value = ".")]
        path: PathBuf,

        #[arg(
            long,
            default_value = "superset",
            help = "'superset' (default, embedded, offline) or 'jit' (downloads the ~107 MB Tailwind standalone CLI for full fidelity)"
        )]
        tailwind: String,

        #[arg(long, help = "Rewrite scaffold files that already exist")]
        force: bool,

        #[arg(long, help = "Print nothing on success")]
        quiet: bool,
    },

    #[command(about = "Serve a wireframe with hot reload")]
    Serve {
        #[arg(value_name = "PATH", default_value = ".")]
        path: PathBuf,

        #[arg(
            long,
            default_value_t = 0,
            help = "Port to listen on (0 picks a free one)"
        )]
        port: u16,
    },

    #[command(about = "Render a wireframe to screenshots/<width>x<height>.png")]
    Screenshot {
        #[arg(value_name = "PATH", default_value = ".")]
        path: PathBuf,

        #[arg(
            short,
            long,
            default_value_t = 1440,
            help = "Viewport width in CSS pixels"
        )]
        width: i64,

        #[arg(long, default_value_t = 900, help = "Viewport height in CSS pixels")]
        height: i64,

        #[arg(
            short,
            long,
            default_value_t = 2.0,
            help = "Device scale factor, so the default PNG is 2880x1800"
        )]
        scale: f64,

        #[arg(long, help = "Capture the whole page height rather than the viewport")]
        full: bool,

        #[arg(long, help = "Leave the background transparent")]
        transparent: bool,

        #[arg(long, value_name = "PATH", help = "Chromium-family browser to drive")]
        browser: Option<PathBuf>,

        #[arg(long, value_name = "PATH", help = "Write the PNG here instead")]
        out: Option<PathBuf>,
    },

    #[command(
        name = "agent-readme",
        about = "Print the component and prop reference for an agent"
    )]
    AgentReadme {
        #[arg(long, value_name = "NAME", help = "Full detail for one component")]
        component: Option<String>,
    },
}

pub async fn handle_wireframe(command: WireframeCommands) -> Result<()> {
    match command {
        WireframeCommands::Setup {
            path,
            tailwind,
            force,
            quiet,
        } => setup(path, &tailwind, force, quiet).await,
        WireframeCommands::Serve { path, port } => serve(path, port).await,
        WireframeCommands::Screenshot {
            path,
            width,
            height,
            scale,
            full,
            transparent,
            browser,
            out,
        } => screenshot_command(path, width, height, scale, full, transparent, browser, out).await,
        WireframeCommands::AgentReadme { component } => agent_readme(component),
    }
}

async fn setup(path: PathBuf, tailwind: &str, force: bool, quiet: bool) -> Result<()> {
    let Some(mode) = TailwindMode::parse(tailwind) else {
        bail!("Unknown --tailwind mode '{tailwind}'. Use 'superset' or 'jit'.");
    };
    if mode == TailwindMode::Jit {
        // The provisioner is not ported yet, and silently falling back to the superset would give
        // the user a project whose arbitrary values quietly do nothing.
        bail!("--tailwind jit is not available yet; the standalone CLI provisioner is still being ported.");
    }

    let project = WireframeProject::at(&path);

    // `--force` deletes the scaffold files so the scaffolder writes them again: it never overwrites
    // in place, which is what keeps a re-run from clobbering the agent's work by default.
    if force && project.source_dir().is_dir() {
        for name in ["main.tsx", "App.tsx", "wireframe-ready.ts"] {
            let _ = std::fs::remove_file(project.source_dir().join(name));
        }
        let _ = std::fs::remove_file(project.index_html());
        let _ = std::fs::remove_file(project.ts_config());
    }

    let result = scaffolder::scaffold(&project)?;
    WireframeConfig { tailwind: mode }.save(&project)?;

    if quiet {
        return Ok(());
    }

    let vendor = VendorManifest::parse(catalog::read_text("vendor.manifest.json")?)?;
    println!();
    println!("  wireframe project ready at {}", project.root.display());
    println!();
    for created in &result.created {
        println!("    + {created}");
    }
    for skipped in &result.skipped {
        println!("    . {skipped} (exists, kept)");
    }
    println!("    . .wireframe/ ({} type files)", result.type_files);
    println!();
    println!(
        "  tendril-wireframes {}  ·  react {}  ·  no node required",
        vendor.tendril_version(),
        vendor.react_version()
    );
    println!();
    println!("  next:");
    println!(
        "    tendril wireframe serve {}        live preview with hot reload",
        relative(&project)
    );
    println!(
        "    tendril wireframe screenshot {}   render to screenshots/",
        relative(&project)
    );
    println!("    tendril wireframe agent-readme          component and prop reference");
    println!();
    Ok(())
}

async fn serve(path: PathBuf, port: u16) -> Result<()> {
    let project = WireframeProject::at(&path);
    if !project.exists() {
        bail!(
            "There is no wireframe at {}. Run `tendril wireframe setup {}` first.",
            project.root.display(),
            path.display()
        );
    }
    if scaffolder::needs_refresh(&project) {
        scaffolder::materialize_workspace(&project)?;
    }

    let esbuild_path = esbuild::resolve().await?;
    let vendor = VendorManifest::parse(catalog::read_text("vendor.manifest.json")?)?;
    let out_dir = project.out_dir("serve");

    println!("  building {}...", project.name());
    let (watcher, first) =
        EsbuildWatcher::start(&esbuild_path, &project, &vendor, &out_dir).await?;
    report_build(&first);

    let mut site = WireframeSite::new(project.clone());
    site.live_reload = true;
    let server = WireframeServer::start(server::ServerOptions {
        site,
        out_dir,
        port,
    })
    .await?;

    println!();
    println!("  {}", server.url);
    println!("  watching src/ - press Ctrl+C to stop");
    println!();

    // Relay esbuild's watch output to the attached pages, so an edit reloads the browser and a
    // failure shows esbuild's own diagnostic rather than a blank frame.
    let hub = server.hub.clone();
    let mut events = watcher.subscribe();
    let relay = tokio::spawn(async move {
        while let Ok(event) = events.recv().await {
            match event {
                WatchEvent::Started => hub.broadcast(ReloadMessage::BuildStarted),
                WatchEvent::Completed(result) => {
                    report_build(&result);
                    if result.success {
                        hub.broadcast(ReloadMessage::Reload);
                    } else {
                        hub.broadcast(ReloadMessage::BuildFailed {
                            location: result.first_location(),
                            output: result.output.clone(),
                        });
                    }
                }
                WatchEvent::Line(_) => {}
            }
        }
    });

    tokio::signal::ctrl_c().await?;
    println!("\n  stopping...");
    relay.abort();
    watcher.shutdown().await;
    server.stop().await;
    Ok(())
}

#[allow(clippy::too_many_arguments)]
async fn screenshot_command(
    path: PathBuf,
    width: i64,
    height: i64,
    scale: f64,
    full: bool,
    transparent: bool,
    browser: Option<PathBuf>,
    out: Option<PathBuf>,
) -> Result<()> {
    let project = WireframeProject::at(&path);
    if !project.exists() {
        bail!(
            "There is no wireframe at {}. Run `tendril wireframe setup {}` first.",
            project.root.display(),
            path.display()
        );
    }
    if scaffolder::needs_refresh(&project) {
        scaffolder::materialize_workspace(&project)?;
    }

    let esbuild_path = esbuild::resolve().await?;
    let vendor = VendorManifest::parse(catalog::read_text("vendor.manifest.json")?)?;

    // A separate out directory from `serve`, so a capture can never observe a half-written bundle
    // from a dev server running against the same project.
    let out_dir = project.out_dir("screenshot");
    let build = bundler::EsbuildBundler::new(&esbuild_path, &project, &vendor)
        .build_once(&out_dir)
        .await?;
    if !build.success {
        eprintln!("{}", build.output);
        bail!("The wireframe did not build.");
    }

    // It serves itself: `screenshot` does not need `serve` running.
    let site = WireframeSite::new(project.clone());
    let server = WireframeServer::start(server::ServerOptions {
        site,
        out_dir,
        port: 0,
    })
    .await?;

    let output_path = out.unwrap_or_else(|| {
        screenshot::runner::default_output_path(&project.screenshots_dir(), width, height)
    });

    let result = screenshot::capture(&ScreenshotOptions {
        url: format!("{}/", server.url),
        output_path,
        width,
        height,
        scale,
        full_page: full,
        transparent,
        timeout: Duration::from_secs(30),
        browser_path: browser,
    })
    .await;

    server.stop().await;
    let result = result?;

    if let Some(warning) = &result.warning {
        eprintln!("  warning: {warning}");
    }
    println!(
        "  {}  {}x{}  {:.1} KB",
        result.path.display(),
        result.pixel_width,
        result.pixel_height,
        result.bytes as f64 / 1024.0
    );
    Ok(())
}

fn agent_readme(component: Option<String>) -> Result<()> {
    let manifest = ComponentManifest::load()?;
    let vendor = VendorManifest::parse(catalog::read_text("vendor.manifest.json")?)?;
    let renderer = AgentReadmeRenderer::new(&manifest, &vendor);

    let text = match component {
        Some(name) => {
            let Some(found) = manifest.find(&name) else {
                bail!("No component named '{name}'. Run `tendril wireframe agent-readme` for the list.");
            };
            renderer.render_component(found)
        }
        None => renderer.render(),
    };

    print!("{text}");
    Ok(())
}

fn report_build(result: &bundler::BuildResult) {
    if result.success {
        if !result.output.trim().is_empty() {
            println!("{}", result.output);
        }
    } else {
        eprintln!("{}", result.output);
    }
}

fn relative(project: &WireframeProject) -> String {
    let Ok(cwd) = std::env::current_dir() else {
        return project.root.display().to_string();
    };
    match project.root.strip_prefix(&cwd) {
        Ok(rel) if rel.as_os_str().is_empty() => ".".to_string(),
        Ok(rel) => rel.to_string_lossy().replace('\\', "/"),
        Err(_) => project.root.display().to_string(),
    }
}
