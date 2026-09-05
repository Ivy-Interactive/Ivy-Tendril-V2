use std::collections::HashMap;
use std::path::PathBuf;

#[derive(Debug, Clone)]
pub struct AgentLaunchConfig {
    pub prompt: String,
    pub working_directory: PathBuf,
    pub model: Option<String>,
    pub effort: Option<String>,
    pub allowed_tools: Vec<String>,
    pub extra_args: Vec<String>,
}

#[derive(Debug, Clone)]
pub struct AgentProcessSpec {
    pub command: String,
    pub args: Vec<String>,
    pub environment: HashMap<String, String>,
    pub working_directory: PathBuf,
}

pub fn build_agent_spec(
    provider: &str,
    config: &AgentLaunchConfig,
) -> AgentProcessSpec {
    let mut args = Vec::new();
    let env = HashMap::new();

    let cmd = match provider.to_ascii_lowercase().as_str() {
        "antigravity" | "agy" => {
            args.push("--prompt".to_string());
            args.push(config.prompt.clone());
            if let Some(m) = &config.model {
                args.push("--model".to_string());
                args.push(m.clone());
            }
            "agy".to_string()
        }
        "gemini" => {
            args.push("-p".to_string());
            args.push(config.prompt.clone());
            if let Some(m) = &config.model {
                args.push("-m".to_string());
                args.push(m.clone());
            }
            "gemini".to_string()
        }
        "opencode" => {
            args.push("run".to_string());
            args.push(config.prompt.clone());
            if let Some(m) = &config.model {
                args.push("--model".to_string());
                args.push(m.clone());
            }
            "opencode".to_string()
        }
        _ => {
            // Default: claude
            args.push("-p".to_string());
            args.push(config.prompt.clone());
            args.push("--dangerously-skip-permissions".to_string());
            if let Some(m) = &config.model {
                args.push("--model".to_string());
                args.push(m.clone());
            }
            if let Some(eff) = &config.effort {
                args.push(format!("--thinking-budget={}", eff));
            }
            "claude".to_string()
        }
    };

    args.extend(config.extra_args.clone());

    AgentProcessSpec {
        command: cmd,
        args,
        environment: env,
        working_directory: config.working_directory.clone(),
    }
}
