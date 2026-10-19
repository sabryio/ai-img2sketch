//! The routes, one module each.
//!
//! Every route module owns its request and response types, so the JSON shape of an endpoint is
//! read in one place. The shapes are the ones `docs/api.md` documents — `serde` field names match
//! the document exactly, with no `rename_all` guessing in between.

pub mod health;

use axum::Router;
use axum::routing::get;

use crate::AppState;

/// The router for the whole API, mounted under the prefix.
pub fn router(state: AppState) -> Router {
    Router::new()
        .route(
            &format!("{}/health", crate::API_PREFIX),
            get(health::health),
        )
        .with_state(state)
}
