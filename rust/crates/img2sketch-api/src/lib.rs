//! The HTTP surface over the sketch engine.
//!
//! The contract is specified in [`docs/api.md`](../../../../docs/api.md) — route paths, JSON field
//! names, status codes and the SSE frame format are all frozen there, because the frontend and the
//! Playwright suite already depend on them. This crate implements that document and is allowed to
//! contain nothing else: no business rule, no image maths, no encoder decision. A handler turns a
//! request into a use-case call and a result into a response, full stop.
//!
//! Only the liveness route exists so far. The rest arrive with the use cases in ROADMAP Phase 4.

#![cfg_attr(test, allow(clippy::unwrap_used, clippy::expect_used))]

pub mod config;
pub mod routes;

use std::sync::Arc;

use axum::Router;
use axum::http::HeaderValue;
use img2sketch_core::application::ports::FfmpegLocator;
use tower_http::cors::{Any, CorsLayer};

/// Every route lives under this prefix.
///
/// Frozen by `docs/api.md`: the Vite dev proxy, the Playwright suite and the packaged desktop app
/// all assume it, so it is a constant here rather than a literal in each route.
pub const API_PREFIX: &str = "/api/v1";

/// What a handler is allowed to reach.
///
/// Deliberately narrow. A handler that needs the engine gets a use case injected through this
/// state; a handler that reaches past it for a library has broken the layering.
#[derive(Debug, Clone)]
pub struct AppState {
    /// Answers whether this machine can encode the video the product exists to make.
    pub ffmpeg: Arc<dyn FfmpegLocator>,
}

/// Builds the router, with the state and the CORS policy applied.
///
/// Origins that do not parse are dropped rather than rejected: an unparseable origin cannot match
/// a browser's `Origin` header anyway, so dropping it and keeping the rest is the behaviour that
/// leaves the app usable.
pub fn create_router(state: AppState, cors_origins: &[String]) -> Router {
    let origins: Vec<HeaderValue> = cors_origins
        .iter()
        .filter_map(|origin| origin.parse::<HeaderValue>().ok())
        .collect();

    let cors = CorsLayer::new()
        .allow_origin(origins)
        .allow_methods(Any)
        .allow_headers(Any);

    routes::router(state).layer(cors)
}
