use std::path::Path;
use crate::error::Result;

pub const STANDARD_PROMPTWARES: &[&str] = &[
    "CreatePlan",
    "ExecutePlan",
    "UpdatePlan",
    "SplitPlan",
    "ExpandPlan",
    "RetryPlan",
    "CreatePr",
    "CreateIssue",
    "SetupProject",
    "AddProject",
    "SyncRepo",
    "UpdateProject",
];

pub fn deploy_standard_promptwares(target_dir: &Path) -> Result<()> {
    std::fs::create_dir_all(target_dir)?;

    // Check if source promptwares dir exists in common repo locations
    let possible_sources = [
        Path::new("promptwares"),
        Path::new("../promptwares"),
        Path::new("../../promptwares"),
        Path::new(r"D:\git\SpaceCorps\Tendril-Service\promptwares"),
    ];

    let mut source_dir = None;
    for s in possible_sources {
        if s.exists() && s.is_dir() {
            source_dir = Some(s);
            break;
        }
    }

    for name in STANDARD_PROMPTWARES {
        let p_target = target_dir.join(name);
        std::fs::create_dir_all(p_target.join("Tools"))?;
        std::fs::create_dir_all(p_target.join("Memory"))?;

        if let Some(src) = source_dir {
            let p_src = src.join(name);
            if p_src.exists() {
                copy_dir_recursive(&p_src, &p_target)?;
                continue;
            }
        }

        let prog_file = p_target.join("Program.md");
        if !prog_file.exists() {
            let stub = format!("# {}\n\nInstructions for promptware {}.\n", name, name);
            std::fs::write(prog_file, stub)?;
        }
    }

    Ok(())
}

fn copy_dir_recursive(src: &Path, dst: &Path) -> Result<()> {
    std::fs::create_dir_all(dst)?;
    for entry in std::fs::read_dir(src)? {
        let entry = entry?;
        let ft = entry.file_type()?;
        let src_path = entry.path();
        let dst_path = dst.join(entry.file_name());

        if ft.is_dir() {
            copy_dir_recursive(&src_path, &dst_path)?;
        } else if ft.is_file() {
            std::fs::copy(&src_path, &dst_path)?;
        }
    }
    Ok(())
}
