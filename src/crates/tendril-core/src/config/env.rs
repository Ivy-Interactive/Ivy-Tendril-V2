//! The environment-variable seam every path resolver reads through.
//!
//! [`EnvSource`] is what lets `*_with_env` twins exist all over this module: production passes
//! [`SystemEnv`], tests pass a closure or a map, and nothing has to mutate the real process
//! environment to be tested.

use std::path::PathBuf;

pub trait EnvSource {
    fn get_var(&self, key: &str) -> Option<String>;
}

pub struct SystemEnv;

impl EnvSource for SystemEnv {
    fn get_var(&self, key: &str) -> Option<String> {
        std::env::var(key).ok()
    }
}

impl<F> EnvSource for F
where
    F: Fn(&str) -> Option<String>,
{
    fn get_var(&self, key: &str) -> Option<String> {
        self(key)
    }
}

impl EnvSource for std::collections::HashMap<String, String> {
    fn get_var(&self, key: &str) -> Option<String> {
        self.get(key).cloned()
    }
}

impl EnvSource for std::collections::HashMap<&str, &str> {
    fn get_var(&self, key: &str) -> Option<String> {
        self.get(key).map(|v| (*v).to_string())
    }
}

impl EnvSource for std::collections::HashMap<&str, String> {
    fn get_var(&self, key: &str) -> Option<String> {
        self.get(key).cloned()
    }
}

impl EnvSource for std::collections::HashMap<String, &str> {
    fn get_var(&self, key: &str) -> Option<String> {
        self.get(key).map(|v| (*v).to_string())
    }
}

pub fn dirs_home_with_env(env: &impl EnvSource) -> Option<PathBuf> {
    if let Some(val) = env.get_var("USERPROFILE") {
        let trimmed = val.trim().trim_matches('"');
        if !trimmed.is_empty() {
            return Some(PathBuf::from(trimmed));
        }
    }
    if let Some(val) = env.get_var("HOME") {
        let trimmed = val.trim().trim_matches('"');
        if !trimmed.is_empty() {
            return Some(PathBuf::from(trimmed));
        }
    }
    None
}

pub fn dirs_home() -> Option<PathBuf> {
    dirs_home_with_env(&SystemEnv)
}
