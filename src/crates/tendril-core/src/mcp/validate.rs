//! Argument validation against a tool's own `inputSchema`.
//!
//! The schema advertised in `tools/list` is the one enforced, so a client that reads the catalog
//! sees exactly the rules it will be held to. Only the keyword subset the catalog actually uses is
//! implemented — [`SUPPORTED_KEYWORDS`] — and `mcp_tools_test` walks every catalog schema and fails
//! if one grows a keyword this module cannot enforce, so the two cannot drift.

use serde_json::Value;

/// JSON Schema keywords this validator understands. `description` and `title` are annotations that
/// carry no constraint; they are accepted and ignored.
pub const SUPPORTED_KEYWORDS: &[&str] = &[
    "type",
    "properties",
    "required",
    "items",
    "enum",
    "additionalProperties",
    "description",
    "title",
];

/// Validates `arguments` against `schema`. The error string is the `Invalid params: <detail>`
/// detail a client sees.
pub fn validate_arguments(schema: &Value, arguments: &Value) -> Result<(), String> {
    validate_node(schema, arguments, "arguments")
}

/// Every keyword used anywhere in `schema` that [`SUPPORTED_KEYWORDS`] does not cover.
pub fn unsupported_keywords(schema: &Value) -> Vec<String> {
    let mut found = Vec::new();
    collect_unsupported(schema, &mut found);
    found
}

fn collect_unsupported(schema: &Value, found: &mut Vec<String>) {
    let Some(map) = schema.as_object() else {
        return;
    };
    for (key, value) in map {
        if !SUPPORTED_KEYWORDS.contains(&key.as_str()) {
            found.push(key.clone());
        }
        match key.as_str() {
            "properties" => {
                if let Some(props) = value.as_object() {
                    for sub in props.values() {
                        collect_unsupported(sub, found);
                    }
                }
            }
            "items" => collect_unsupported(value, found),
            _ => {}
        }
    }
}

fn validate_node(schema: &Value, value: &Value, path: &str) -> Result<(), String> {
    if let Some(allowed) = schema.get("enum").and_then(|e| e.as_array()) {
        if !allowed.contains(value) {
            let rendered: Vec<String> = allowed
                .iter()
                .map(|v| match v {
                    Value::String(s) => s.clone(),
                    other => other.to_string(),
                })
                .collect();
            return Err(format!(
                "{} must be one of [{}]",
                path,
                rendered.join(", ")
            ));
        }
    }

    match schema.get("type").and_then(|t| t.as_str()) {
        Some("object") => validate_object(schema, value, path),
        Some("array") => validate_array(schema, value, path),
        Some("string") => require(value.is_string(), path, "a string"),
        Some("integer") => require(
            value.as_i64().is_some() || value.as_u64().is_some(),
            path,
            "an integer",
        ),
        Some("number") => require(value.is_number(), path, "a number"),
        Some("boolean") => require(value.is_boolean(), path, "a boolean"),
        _ => Ok(()),
    }
}

fn validate_object(schema: &Value, value: &Value, path: &str) -> Result<(), String> {
    let Some(obj) = value.as_object() else {
        return Err(format!("{} must be an object", path));
    };

    let properties = schema.get("properties").and_then(|p| p.as_object());

    if let Some(required) = schema.get("required").and_then(|r| r.as_array()) {
        for name in required.iter().filter_map(|n| n.as_str()) {
            if !obj.contains_key(name) || obj.get(name) == Some(&Value::Null) {
                return Err(format!("{} is missing required property '{}'", path, name));
            }
        }
    }

    let additional_allowed = schema
        .get("additionalProperties")
        .and_then(|a| a.as_bool())
        .unwrap_or(true);

    for (key, val) in obj {
        match properties.and_then(|p| p.get(key)) {
            Some(sub) => {
                if val.is_null() {
                    // An explicit null for an optional property means "not supplied".
                    continue;
                }
                validate_node(sub, val, &format!("{}.{}", path, key))?;
            }
            None if !additional_allowed => {
                return Err(format!("{} has unknown property '{}'", path, key));
            }
            None => {}
        }
    }

    Ok(())
}

fn validate_array(schema: &Value, value: &Value, path: &str) -> Result<(), String> {
    let Some(items) = value.as_array() else {
        return Err(format!("{} must be an array", path));
    };
    if let Some(item_schema) = schema.get("items") {
        for (index, item) in items.iter().enumerate() {
            validate_node(item_schema, item, &format!("{}[{}]", path, index))?;
        }
    }
    Ok(())
}

fn require(ok: bool, path: &str, expected: &str) -> Result<(), String> {
    if ok {
        Ok(())
    } else {
        Err(format!("{} must be {}", path, expected))
    }
}
