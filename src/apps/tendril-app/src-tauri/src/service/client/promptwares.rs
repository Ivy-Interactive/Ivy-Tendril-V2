//! The prompt a promptware runs (`GET /api/promptwares/:name/program`).

use super::{path_segment, TendrilClient};
use crate::error::BridgeError;

impl TendrilClient {
    /// One promptware's deployed `Program.md`, plus the layer that supplied it.
    ///
    /// The reply is handed back as raw JSON rather than parsed into a DTO: this side neither reads
    /// the program nor decides anything from it, and the shape is the daemon's `PromptwareProgram`,
    /// so a typed mirror here would be a second copy to keep in step for no gain.
    ///
    /// `path_segment` rather than `urlencoding`: the name lands in a path, where form encoding's `+`
    /// is a literal plus and would look up a promptware that does not exist.
    pub async fn get_promptware_program(
        &self,
        name: &str,
    ) -> Result<serde_json::Value, BridgeError> {
        let url = format!(
            "{}/api/promptwares/{}/program",
            self.base_url,
            path_segment(name)
        );
        let resp = self.client.get(&url).headers(self.headers()).send().await?;

        if !resp.status().is_success() {
            let status = resp.status();
            return Err(BridgeError::new(
                "GET_PROMPTWARE_PROGRAM_FAILED",
                Self::service_error(resp).await.unwrap_or_else(|| {
                    format!("Failed to read the program for '{name}' ({status})")
                }),
            ));
        }

        Ok(resp.json().await?)
    }
}
