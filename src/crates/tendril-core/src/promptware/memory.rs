use crate::error::Result;
use std::path::Path;

pub fn list_memory(promptwares_dir: &Path, promptware_name: &str) -> Result<Vec<String>> {
    let mem_dir = promptwares_dir.join(promptware_name).join("Memory");
    if !mem_dir.exists() {
        return Ok(Vec::new());
    }

    let mut files = Vec::new();
    for entry in std::fs::read_dir(mem_dir)? {
        let entry = entry?;
        if entry.file_type()?.is_file() {
            files.push(entry.file_name().to_string_lossy().to_string());
        }
    }
    files.sort();
    Ok(files)
}

pub fn read_memory(
    promptwares_dir: &Path,
    promptware_name: &str,
    files: &[String],
) -> Result<String> {
    let mem_dir = promptwares_dir.join(promptware_name).join("Memory");
    let mut combined = String::new();

    for file in files {
        let path = mem_dir.join(file);
        if path.exists() {
            let content = std::fs::read_to_string(&path)?;
            combined.push_str(&format!("## {}\n\n{}\n\n", file, content));
        } else {
            combined.push_str(&format!("## {}\n\n(not found)\n\n", file));
        }
    }

    Ok(combined)
}

pub fn write_memory(
    promptwares_dir: &Path,
    promptware_name: &str,
    filename: &str,
    content: &str,
) -> Result<()> {
    let mem_dir = promptwares_dir.join(promptware_name).join("Memory");
    std::fs::create_dir_all(&mem_dir)?;

    let path = mem_dir.join(filename);
    std::fs::write(path, content)?;
    Ok(())
}

pub fn delete_memory(promptwares_dir: &Path, promptware_name: &str, filename: &str) -> Result<()> {
    let mem_dir = promptwares_dir.join(promptware_name).join("Memory");
    let path = mem_dir.join(filename);
    if path.exists() {
        std::fs::remove_file(path)?;
    }
    Ok(())
}

pub fn write_tool(
    promptwares_dir: &Path,
    promptware_name: &str,
    tool_name: &str,
    content: &str,
) -> Result<()> {
    let tools_dir = promptwares_dir.join(promptware_name).join("Tools");
    std::fs::create_dir_all(&tools_dir)?;

    let path = tools_dir.join(tool_name);
    std::fs::write(path, content)?;
    Ok(())
}
