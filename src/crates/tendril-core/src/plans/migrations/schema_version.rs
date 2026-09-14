use regex::Regex;

pub struct PlanSchemaVersion;

impl PlanSchemaVersion {
    /// Reads the schemaVersion from raw YAML text. Returns 0 for legacy files lacking the field.
    pub fn read(yaml: &str) -> i32 {
        let re = Regex::new(r"(?m)^schemaVersion:\s*(\d+)").unwrap();
        if let Some(caps) = re.captures(yaml) {
            if let Some(m) = caps.get(1) {
                return m.as_str().parse::<i32>().unwrap_or(0);
            }
        }
        0
    }

    /// Replaces an existing schemaVersion line or prepends one.
    pub fn stamp(yaml: &str, version: i32) -> String {
        let re = Regex::new(r"(?m)^schemaVersion:\s*.*$").unwrap();
        if re.is_match(yaml) {
            re.replace(yaml, format!("schemaVersion: {}", version))
                .to_string()
        } else {
            let newline = if yaml.contains("\r\n") { "\r\n" } else { "\n" };
            format!("schemaVersion: {}{}{}", version, newline, yaml)
        }
    }
}
