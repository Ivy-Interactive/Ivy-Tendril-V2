import type { BridgeError, RecommendationItem } from "../../src/types/api";

export function recommendation(
  overrides: Partial<RecommendationItem> = {}
): RecommendationItem {
  return {
    title: "Tauri WebDriver E2E Automation",
    description:
      "Drive the packaged app with tauri-driver so the operator flows are covered end to end.",
    impact: "Medium",
    state: "Pending",
    ...overrides,
  };
}

/** A structured rejection as Tauri delivers it: the `Err` payload verbatim. */
export function bridgeError(overrides: Partial<BridgeError> = {}): BridgeError {
  return {
    code: "RECOMMENDATION_UPDATE_FAILED",
    message: "Failed to set recommendation 'Tauri WebDriver E2E Automation' to Accepted (404 Not Found)",
    details: "no route for PUT /api/plans/00021/recommendations/...",
    ...overrides,
  };
}
