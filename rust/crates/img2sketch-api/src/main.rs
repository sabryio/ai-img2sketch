//! `img2sketch-api` — the server binary.
//!
//! This is the composition root: it reads the configuration, builds the adapters, and hands them
//! to the router. It decides nothing itself, which is what makes every decision above it testable
//! without starting a process.

use std::sync::Arc;

use anyhow::Context;
use img2sketch_api::config::ServerConfig;
use img2sketch_api::{AppState, create_router};
use img2sketch_core::application::ports::FfmpegLocator;
use img2sketch_media::ffmpeg::SystemFfmpegLocator;
use tracing_subscriber::EnvFilter;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let config = ServerConfig::from_environment().context("the environment is not usable")?;

    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::try_new(&config.log_level).unwrap_or_else(|_| EnvFilter::new("info")),
        )
        .init();

    let ffmpeg = Arc::new(SystemFfmpegLocator::from_environment());
    report_ffmpeg(ffmpeg.as_ref());

    let address = config.socket_address()?;
    let listener = tokio::net::TcpListener::bind(address)
        .await
        .with_context(|| format!("cannot bind {address}"))?;

    tracing::info!("listening on http://{address}");
    axum::serve(
        listener,
        create_router(AppState { ffmpeg }, &config.cors_origins),
    )
    .with_graceful_shutdown(interrupt())
    .await
    .context("the server stopped")?;

    Ok(())
}

/// Says once, at startup, whether this machine can encode the video the product makes.
///
/// A machine with no FFmpeg — or with a build that has no H.264 encoder — would otherwise fail at
/// the user's first render, which is the worst possible moment to find out.
fn report_ffmpeg(locator: &dyn FfmpegLocator) {
    let status = locator.probe();
    if status.can_encode_h264() {
        tracing::info!("{}", status.summary());
    } else {
        tracing::warn!("{}", status.summary());
    }
}

/// Resolves when the operator asks the process to stop.
async fn interrupt() {
    let _ = tokio::signal::ctrl_c().await;
}
