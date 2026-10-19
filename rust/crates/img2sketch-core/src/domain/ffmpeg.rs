//! What the app knows about FFmpeg on the user's machine.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

/// Where an executable was found, ordered by how much the app trusts it.
///
/// The order matters twice: it is the order the locator searches in, and it is the order a user
/// should be told about, because "the copy inside the app" and "whatever happened to be on
/// `PATH`" are different answers to "which FFmpeg will draw my video?".
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FfmpegSource {
    /// Shipped inside the app.
    Bundled,
    /// Installed into the app's own data directory.
    Managed,
    /// Chosen by the user in settings.
    Configured,
    /// Found on the user's `PATH`.
    Path,
    /// Found in a conventional install location.
    KnownLocation,
    /// Found through the Windows registry.
    Registry,
}

impl FfmpegSource {
    /// A phrase for the interface, lower-case, no leading capital.
    #[must_use]
    pub const fn label(self) -> &'static str {
        match self {
            Self::Bundled => "bundled with the app",
            Self::Managed => "installed by the app",
            Self::Configured => "chosen in settings",
            Self::Path => "on your PATH",
            Self::KnownLocation => "in a standard install location",
            Self::Registry => "listed in the Windows registry",
        }
    }
}

/// What the app found when it went looking for FFmpeg.
///
/// Not being installed is an answer, not an error: the user has to be told what is missing and
/// where the app looked, which is a state to display rather than a failure to hide.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct FfmpegStatus {
    available: bool,
    executable: Option<PathBuf>,
    source: Option<FfmpegSource>,
    version: Option<String>,
    /// Whether the executable reports a `libx264` encoder. `None` means it was never asked.
    encodes_h264: Option<bool>,
}

impl FfmpegStatus {
    /// Nothing was found.
    #[must_use]
    pub const fn missing() -> Self {
        Self {
            available: false,
            executable: None,
            source: None,
            version: None,
            encodes_h264: None,
        }
    }

    /// An executable was found, with whatever the app learned about it.
    #[must_use]
    pub fn found(
        executable: PathBuf,
        source: FfmpegSource,
        version: Option<String>,
        encodes_h264: Option<bool>,
    ) -> Self {
        Self {
            available: true,
            executable: Some(executable),
            source: Some(source),
            version,
            encodes_h264,
        }
    }

    /// Whether an executable was found at all.
    #[must_use]
    pub const fn is_available(&self) -> bool {
        self.available
    }

    /// Whether it can actually do the job.
    ///
    /// Finding an FFmpeg is not the same as finding a usable one: a minimal build without
    /// `libx264` cannot write the video this product exists to write, and saying so is more
    /// useful than failing at the first frame.
    #[must_use]
    pub const fn can_encode_h264(&self) -> bool {
        self.available && matches!(self.encodes_h264, Some(true))
    }

    /// The executable's path, if one was found.
    #[must_use]
    pub fn executable(&self) -> Option<&Path> {
        self.executable.as_deref()
    }

    /// Where it came from, if one was found.
    #[must_use]
    pub const fn source(&self) -> Option<FfmpegSource> {
        self.source
    }

    /// The version it reported, if it was asked.
    #[must_use]
    pub fn version(&self) -> Option<&str> {
        self.version.as_deref()
    }

    /// One line stating what is true, for a log line, a toast or the CLI.
    #[must_use]
    pub fn summary(&self) -> String {
        match (
            self.executable(),
            self.source(),
            self.version(),
            self.encodes_h264,
        ) {
            (None, ..) => "FFmpeg was not found.".to_string(),
            (Some(path), source, version, encodes_h264) => {
                let version = version
                    .map_or_else(|| "version unknown".to_string(), |v| format!("FFmpeg {v}"));
                let source = source.map_or_else(String::new, |s| format!(", {}", s.label()));
                let encoder = match encodes_h264 {
                    Some(true) => "",
                    Some(false) => " — but it has no H.264 encoder (libx264)",
                    None => "",
                };
                format!("{version} at {}{source}{encoder}.", path.display())
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{FfmpegSource, FfmpegStatus};

    #[test]
    fn missing_is_an_answer_not_an_error() {
        let status = FfmpegStatus::missing();
        assert!(!status.is_available());
        assert!(!status.can_encode_h264());
        assert_eq!(status.executable(), None);
        assert_eq!(status.summary(), "FFmpeg was not found.");
    }

    #[test]
    fn a_found_executable_is_usable_only_once_it_can_encode_h264() {
        let unknown = FfmpegStatus::found(
            "C:/ffmpeg/bin/ffmpeg.exe".into(),
            FfmpegSource::Path,
            None,
            None,
        );
        assert!(unknown.is_available());
        assert!(!unknown.can_encode_h264());

        let without_x264 = FfmpegStatus::found(
            "C:/ffmpeg/bin/ffmpeg.exe".into(),
            FfmpegSource::Path,
            Some("6.0".into()),
            Some(false),
        );
        assert!(without_x264.is_available());
        assert!(!without_x264.can_encode_h264());
        assert!(without_x264.summary().contains("no H.264 encoder"));

        let usable = FfmpegStatus::found(
            r"C:\Users\me\AppData\Local\Microsoft\WinGet\Packages\Gyan.FFmpeg\ffmpeg.exe".into(),
            FfmpegSource::KnownLocation,
            Some("9.0.1".into()),
            Some(true),
        );
        assert!(usable.can_encode_h264());
        assert_eq!(usable.version(), Some("9.0.1"));
        assert_eq!(usable.source(), Some(FfmpegSource::KnownLocation));
        assert!(usable.summary().starts_with("FFmpeg 9.0.1 at "));
        assert!(usable.summary().contains("in a standard install location"));
    }

    #[test]
    fn the_shipped_copy_outranks_whatever_is_on_path() {
        assert!(FfmpegSource::Bundled < FfmpegSource::Managed);
        assert!(FfmpegSource::Managed < FfmpegSource::Configured);
        assert!(FfmpegSource::Configured < FfmpegSource::Path);
        assert!(FfmpegSource::Path < FfmpegSource::KnownLocation);
    }

    #[test]
    fn serialises_for_a_status_payload() {
        let json = serde_json::to_string(&FfmpegStatus::missing()).unwrap();
        assert_eq!(
            json,
            r#"{"available":false,"executable":null,"source":null,"version":null,"encodes_h264":null}"#
        );
    }
}
