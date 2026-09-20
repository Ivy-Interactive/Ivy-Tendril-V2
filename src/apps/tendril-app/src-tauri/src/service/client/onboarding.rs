//! First-run onboarding state and the newsletter opt-in it offers.

use super::TendrilClient;
use crate::error::BridgeError;
use crate::models::{OnboardingStatusDto, SubscribeOutcomeDto};
use serde_json::json;

impl TendrilClient {
    pub async fn get_onboarding_status(&self) -> Result<OnboardingStatusDto, BridgeError> {
        let url = format!("{}/api/onboarding", self.base_url);
        let resp = self.client.get(&url).headers(self.headers()).send().await?;

        if !resp.status().is_success() {
            let status = resp.status();
            let text = resp.text().await.unwrap_or_default();
            return Err(BridgeError::new(
                "GET_ONBOARDING_STATUS_FAILED",
                format!("Failed to get onboarding status ({status}): {text}"),
            ));
        }

        Ok(resp.json().await?)
    }

    pub async fn complete_onboarding(&self) -> Result<(), BridgeError> {
        self.post_onboarding("complete", "COMPLETE_ONBOARDING_FAILED")
            .await
    }

    pub async fn dismiss_onboarding(&self) -> Result<(), BridgeError> {
        self.post_onboarding("dismiss", "DISMISS_ONBOARDING_FAILED")
            .await
    }

    async fn post_onboarding(&self, action: &str, code: &str) -> Result<(), BridgeError> {
        let url = format!("{}/api/onboarding/{}", self.base_url, action);
        let resp = self
            .client
            .post(&url)
            .headers(self.headers())
            .json(&json!({}))
            .send()
            .await?;

        if !resp.status().is_success() {
            let status = resp.status();
            let text = resp.text().await.unwrap_or_default();
            return Err(BridgeError::new(
                code,
                format!("Failed to {action} onboarding ({status}): {text}"),
            ));
        }

        Ok(())
    }

    pub async fn subscribe_newsletter(
        &self,
        email: &str,
    ) -> Result<SubscribeOutcomeDto, BridgeError> {
        let url = format!("{}/api/newsletter/subscribe", self.base_url);
        let resp = self
            .client
            .post(&url)
            .headers(self.headers())
            .json(&json!({ "email": email }))
            .send()
            .await?;

        if !resp.status().is_success() {
            let status = resp.status();
            let text = resp.text().await.unwrap_or_default();
            return Err(BridgeError::new(
                "SUBSCRIBE_NEWSLETTER_FAILED",
                format!("Failed to subscribe to newsletter ({status}): {text}"),
            ));
        }

        Ok(resp.json().await?)
    }
}
