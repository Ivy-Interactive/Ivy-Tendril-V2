use crate::error::{Result, TendrilError};
use std::path::Path;

pub fn get_revision(plan_folder: &Path, number: Option<i32>) -> Result<String> {
    let rev_dir = plan_folder.join("Revisions");
    if !rev_dir.exists() {
        return Ok(String::new());
    }

    if let Some(n) = number {
        let file_path = rev_dir.join(format!("{:03}.md", n));
        if file_path.exists() {
            return Ok(std::fs::read_to_string(file_path)?);
        }
        return Err(TendrilError::Plan(format!(
            "Revision {:03} not found in {}",
            n,
            plan_folder.display()
        )));
    }

    // Get latest revision
    let mut highest = 0;
    let mut latest_path = None;

    for entry in std::fs::read_dir(&rev_dir)? {
        let entry = entry?;
        let name = entry.file_name();
        let name_str = name.to_string_lossy();
        if name_str.ends_with(".md") {
            if let Ok(num) = name_str.trim_end_matches(".md").parse::<i32>() {
                if num > highest {
                    highest = num;
                    latest_path = Some(entry.path());
                }
            }
        }
    }

    if let Some(path) = latest_path {
        Ok(std::fs::read_to_string(path)?)
    } else {
        Ok(String::new())
    }
}

pub fn write_revision(plan_folder: &Path, content: &str) -> Result<i32> {
    let rev_dir = plan_folder.join("Revisions");
    std::fs::create_dir_all(&rev_dir)?;

    let mut highest = 0;
    for entry in std::fs::read_dir(&rev_dir)? {
        let entry = entry?;
        let name = entry.file_name();
        let name_str = name.to_string_lossy();
        if name_str.ends_with(".md") {
            if let Ok(num) = name_str.trim_end_matches(".md").parse::<i32>() {
                if num > highest {
                    highest = num;
                }
            }
        }
    }

    let next = highest + 1;
    let new_rev_file = rev_dir.join(format!("{:03}.md", next));
    std::fs::write(&new_rev_file, content)?;

    Ok(next)
}
