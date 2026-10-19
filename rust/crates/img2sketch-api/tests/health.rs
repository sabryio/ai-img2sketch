//! The health route, asserted against the document rather than against itself.
//!
//! `docs/api.md` fixes the path, the body and the CORS policy, and the e2e suite already depends on
//! them. These tests state that contract in code so a change to it fails here first.

#![allow(clippy::unwrap_used, clippy::expect_used)]

use std::sync::Arc;

use axum::Router;
use axum::body::Body;
use axum::http::{Request, StatusCode, header};
use img2sketch_api::config::DEFAULT_CORS_ORIGINS;
use img2sketch_api::{AppState, create_router};
use img2sketch_core::application::ports::FfmpegLocator;
use img2sketch_core::domain::FfmpegStatus;
use tower::ServiceExt;

/// A machine with no FFmpeg: the health route must not depend on one.
#[derive(Debug)]
struct NoFfmpeg;

impl FfmpegLocator for NoFfmpeg {
    fn probe(&self) -> FfmpegStatus {
        FfmpegStatus::missing()
    }
}

fn app() -> Router {
    let origins: Vec<String> = DEFAULT_CORS_ORIGINS
        .iter()
        .map(|origin| (*origin).to_string())
        .collect();
    let state = AppState {
        ffmpeg: Arc::new(NoFfmpeg),
    };
    create_router(state, &origins)
}

async fn get(uri: &str) -> axum::response::Response {
    app()
        .oneshot(Request::builder().uri(uri).body(Body::empty()).unwrap())
        .await
        .unwrap()
}

#[tokio::test]
async fn health_answers_with_exactly_the_documented_body() {
    let response = get("/api/v1/health").await;
    assert_eq!(response.status(), StatusCode::OK);

    let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
        .await
        .unwrap();
    assert_eq!(&bytes[..], br#"{"status":"ok"}"#);
}

#[tokio::test]
async fn the_path_is_the_prefixed_one() {
    // The unprefixed path is not an alias: the frontend, the proxy and the packaged app all use
    // the prefix, and a second path would be a second thing to keep working.
    assert_eq!(get("/health").await.status(), StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn an_unknown_route_is_a_404() {
    assert_eq!(
        get("/api/v1/nothing-here").await.status(),
        StatusCode::NOT_FOUND
    );
}

#[tokio::test]
async fn the_tauri_webview_may_call_the_api() {
    let response = app()
        .oneshot(
            Request::builder()
                .uri("/api/v1/health")
                .header(header::ORIGIN, "tauri://localhost")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(
        response
            .headers()
            .get(header::ACCESS_CONTROL_ALLOW_ORIGIN)
            .unwrap(),
        "tauri://localhost"
    );
}

#[tokio::test]
async fn a_page_from_anywhere_else_may_not() {
    let response = app()
        .oneshot(
            Request::builder()
                .uri("/api/v1/health")
                .header(header::ORIGIN, "https://example.com")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert!(
        response
            .headers()
            .get(header::ACCESS_CONTROL_ALLOW_ORIGIN)
            .is_none(),
        "a desktop app on the loopback interface must not answer arbitrary origins"
    );
}
