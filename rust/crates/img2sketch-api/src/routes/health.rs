//! `GET /api/v1/health`
//!
//! The liveness probe the container's health check, the desktop host and the e2e suite all use.
//! The body is exactly `{"status":"ok"}` — `docs/api.md` specifies it, and the Playwright suite
//! asserts it, so it is built from a type rather than a string.

use axum::Json;
use serde::{Deserialize, Serialize};

/// The health body.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct HealthResponse {
    /// Always `ok` — a response that is not `ok` is not sent.
    pub status: String,
}

impl HealthResponse {
    /// The only state a healthy server reports.
    #[must_use]
    pub fn ok() -> Self {
        Self {
            status: "ok".to_string(),
        }
    }
}

/// Answers the probe.
pub async fn health() -> Json<HealthResponse> {
    Json(HealthResponse::ok())
}
