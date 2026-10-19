//! The machine, as far as this module is concerned.
//!
//! Three questions are asked of the outside world while looking for FFmpeg: is this path an
//! executable, what is this environment variable, and what does this executable say when asked.
//! They live behind one trait so the locator can be tested against a fictional machine — one with
//! a bundled FFmpeg, or one with nothing at all — instead of whatever happens to be installed.

use std::path::Path;
use std::process::Command;

/// What the locator needs from the machine.
pub trait LocateEnvironment: std::fmt::Debug + Send + Sync {
    /// Whether the path points at something that can be run.
    fn is_executable(&self, path: &Path) -> bool;

    /// An environment variable, if it is set and not empty.
    fn env_var(&self, name: &str) -> Option<String>;

    /// Runs the executable and returns its standard output.
    ///
    /// # Errors
    ///
    /// Returns the captured standard error, or a description of the spawn failure.
    fn run(&self, executable: &Path, args: &[&str]) -> Result<String, String>;
}

/// The real machine.
#[derive(Debug, Default, Clone, Copy)]
pub struct SystemEnvironment;

impl LocateEnvironment for SystemEnvironment {
    fn is_executable(&self, path: &Path) -> bool {
        path.is_file() && is_executable::is_executable(path)
    }

    fn env_var(&self, name: &str) -> Option<String> {
        std::env::var(name).ok().filter(|value| !value.is_empty())
    }

    fn run(&self, executable: &Path, args: &[&str]) -> Result<String, String> {
        let output = Command::new(executable)
            .args(args)
            .output()
            .map_err(|error| error.to_string())?;
        if output.status.success() {
            Ok(String::from_utf8_lossy(&output.stdout).into_owned())
        } else {
            Err(String::from_utf8_lossy(&output.stderr).into_owned())
        }
    }
}

/// The version reported by `ffmpeg -version`.
///
/// The shapes in the wild are not semver, which is why there is no version crate here:
///
/// | first line | version |
/// |---|---|
/// | `ffmpeg version 9.0.1-full_build-www.gyan.dev` | `9.0.1` |
/// | `ffmpeg version n7.1 Copyright (c) 2000-2024` | `n7.1` |
/// | `ffmpeg version git-2024-05-01-abc1234` | `git-2024-05-01-abc1234` |
///
/// The build suffix is dropped only when what precedes it is a plain number, so a release reads
/// as `9.0.1` while a snapshot keeps its identity.
#[must_use]
pub fn parse_version(output: &str) -> Option<String> {
    let line = output
        .lines()
        .find(|line| line.contains("ffmpeg version"))?;
    let token = line.split_whitespace().nth(2)?;
    let before_suffix = token.split('-').next().unwrap_or(token);
    let looks_like_a_release = !before_suffix.is_empty()
        && before_suffix
            .chars()
            .all(|character| character.is_ascii_digit() || character == '.');
    if looks_like_a_release {
        Some(before_suffix.to_string())
    } else {
        Some(token.to_string())
    }
}

/// Whether an `ffmpeg -encoders` listing offers `libx264`.
///
/// Matched as a whole token: a build may also carry `libx264rgb`, which encodes differently and
/// is not what the drawing output is tuned for.
#[must_use]
pub fn has_h264_encoder(encoders_output: &str) -> bool {
    encoders_output
        .split_whitespace()
        .any(|token| token == "libx264")
}

#[cfg(test)]
mod tests {
    use super::{has_h264_encoder, parse_version};

    #[test]
    fn reads_a_release_version_and_drops_the_build_suffix() {
        let first_line = "ffmpeg version 9.0.1-full_build-www.gyan.dev Copyright (c) 2000-2025";
        assert_eq!(parse_version(first_line).as_deref(), Some("9.0.1"));
    }

    #[test]
    fn keeps_a_branch_version_whole() {
        let first_line = "ffmpeg version n7.1 Copyright (c) 2000-2024 the FFmpeg developers";
        assert_eq!(parse_version(first_line).as_deref(), Some("n7.1"));
    }

    #[test]
    fn keeps_a_snapshot_whole() {
        let first_line = "ffmpeg version git-2024-05-01-abc1234 Copyright (c) 2000-2024";
        assert_eq!(
            parse_version(first_line).as_deref(),
            Some("git-2024-05-01-abc1234")
        );
    }

    #[test]
    fn survives_output_it_does_not_understand() {
        assert_eq!(parse_version(""), None);
        assert_eq!(parse_version("ffmpeg version"), None);
    }

    #[test]
    fn spots_libx264_in_an_encoder_listing() {
        let listing = "\
Encoders:
 V..... = Video
 ------
 V....D libx264              libx264 H.264 / AVC / MPEG-4 AVC / MPEG-4 part 10 (codec h264)
 V....D libx264rgb           libx264 H.264 / AVC / MPEG-4 AVC / MPEG-4 part 10 RGB (codec h264)
 A....D aac                  AAC (Advanced Audio Coding)
";
        assert!(has_h264_encoder(listing));
    }

    #[test]
    fn does_not_mistake_the_rgb_variant_for_the_one_we_ask_for() {
        let listing = " V....D libx264rgb           libx264rgb H.264 / AVC / MPEG-4 part 10 RGB (codec h264)\n";
        assert!(!has_h264_encoder(listing));
    }
}
