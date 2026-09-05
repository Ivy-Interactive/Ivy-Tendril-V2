use std::collections::HashMap;
use std::path::Path;
use chrono::Utc;
use crate::error::Result;

const FIRMWARE_TEMPLATE: &str = r#"---
{HEADER}
---
You are an agentic application that evolves over time.

This prompt is your Firmware and is never allowed to change.

The header above contains your named parameters for this execution.

Your program folder is: {PROGRAMFOLDER}

## Goal

Your goal is to complete the instructions in the **Program** section below (inlined from {PROGRAMFOLDER}/Program.md) with the following priority:

1. Completeness
2. Speed
3. Token efficiency
4. Improvement over time

**Tools:** 
{TOOLS}

**Memory:**
{MEMORY}

To read memory files (batch multiple files in one call to reduce spin-up overhead):
```bash
tendril promptware read-memory {PROMPTWARE_NAME} <filename1>.md [filename2.md ...]
```

A `[[name]]` cross-reference inside a memory means the file `name.md`. If a read fails, the memory was likely pruned: run `tendril promptware list-memory {PROMPTWARE_NAME}` for the current list instead of guessing filenames.

Complete your task and present the user with a summary.

## Reflection

Every execution needs to end with a reflection step. This is your opportunity to improve over time. What did we learn during this session? Save reflections using the CLI:

```bash
tendril promptware write-memory {PROMPTWARE_NAME} <filename>.md <<'EOF'
<reflection content>
EOF
```

To delete a memory file that is no longer true:
```bash
tendril promptware delete-memory {PROMPTWARE_NAME} <filename>.md
```

## Program

{PROGRAM}
"#;

pub fn compile_firmware(
    program_folder: &Path,
    values: &HashMap<String, String>,
) -> Result<String> {
    let mut header_values = values.clone();
    if !header_values.contains_key("CurrentTime") {
        header_values.insert("CurrentTime".to_string(), Utc::now().to_rfc3339());
    }

    let mut header_lines: Vec<String> = header_values
        .iter()
        .map(|(k, v)| format!("{}: {}", k, v))
        .collect();
    header_lines.sort();
    let header = header_lines.join("\n");

    let tools_dir = program_folder.join("Tools");
    let tools_listing = list_directory_files(&tools_dir, "(no tools yet)");

    let memory_dir = program_folder.join("Memory");
    let memory_listing = list_directory_files(&memory_dir, "(no memory yet)");

    let promptware_name = program_folder
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("Promptware");

    let program_md_path = program_folder.join("Program.md");
    let program_content = if program_md_path.exists() {
        std::fs::read_to_string(&program_md_path)?
    } else {
        "(no Program.md found)".to_string()
    };

    let prompt = FIRMWARE_TEMPLATE
        .replace("{HEADER}", &header)
        .replace("{PROGRAMFOLDER}", &program_folder.to_string_lossy())
        .replace("{TOOLS}", &tools_listing)
        .replace("{MEMORY}", &memory_listing)
        .replace("{PROMPTWARE_NAME}", promptware_name)
        .replace("{PROGRAM}", &program_content);

    Ok(prompt)
}

fn list_directory_files(dir: &Path, empty_placeholder: &str) -> String {
    if !dir.exists() {
        return empty_placeholder.to_string();
    }

    let mut files = Vec::new();
    if let Ok(entries) = std::fs::read_dir(dir) {
        for entry in entries.flatten() {
            if let Ok(ft) = entry.file_type() {
                if ft.is_file() {
                    files.push(entry.file_name().to_string_lossy().to_string());
                }
            }
        }
    }

    if files.is_empty() {
        empty_placeholder.to_string()
    } else {
        files.sort();
        files
            .into_iter()
            .map(|f| format!("- {}", f))
            .collect::<Vec<_>>()
            .join("\n")
    }
}
