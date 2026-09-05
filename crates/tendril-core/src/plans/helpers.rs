use std::path::{Path, PathBuf};
use regex::Regex;
use crate::error::{Result, TendrilError};

pub fn to_safe_title(title: &str) -> String {
    let re = Regex::new(r"[^a-zA-Z0-9\s-]").unwrap();
    let cleaned = re.replace_all(title, "");
    cleaned
        .split_whitespace()
        .map(|word| {
            let mut c = word.chars();
            match c.next() {
                None => String::new(),
                Some(first) => first.to_uppercase().collect::<String>() + c.as_str(),
            }
        })
        .collect::<String>()
}

pub fn allocate_plan_id(plans_dir: &Path) -> Result<String> {
    let mut max_id = 0;

    if plans_dir.exists() {
        for entry in std::fs::read_dir(plans_dir)? {
            let entry = entry?;
            if entry.file_type()?.is_dir() {
                let name = entry.file_name();
                let name_str = name.to_string_lossy();
                if name_str.len() >= 5 {
                    if let Ok(id) = name_str[..5].parse::<i32>() {
                        if id > max_id {
                            max_id = id;
                        }
                    }
                }
            }
        }
    }

    Ok(format!("{:05}", max_id + 1))
}

pub fn resolve_plan_folder(plan_id_or_path: &str, plans_dir: &Path) -> Result<PathBuf> {
    let input_path = PathBuf::from(plan_id_or_path);
    if input_path.is_absolute() && input_path.exists() {
        return Ok(input_path);
    }

    if plans_dir.join(plan_id_or_path).exists() {
        return Ok(plans_dir.join(plan_id_or_path));
    }

    // Try finding by prefix / numeric ID
    let search_id = if let Ok(num) = plan_id_or_path.parse::<i32>() {
        format!("{:05}", num)
    } else {
        plan_id_or_path.to_string()
    };

    if plans_dir.exists() {
        for entry in std::fs::read_dir(plans_dir)? {
            let entry = entry?;
            if entry.file_type()?.is_dir() {
                let name = entry.file_name();
                let name_str = name.to_string_lossy();
                if name_str.starts_with(&search_id) {
                    return Ok(entry.path());
                }
            }
        }
    }

    Err(TendrilError::PlanNotFound(format!(
        "Could not resolve plan folder for '{}' in {}",
        plan_id_or_path,
        plans_dir.display()
    )))
}
