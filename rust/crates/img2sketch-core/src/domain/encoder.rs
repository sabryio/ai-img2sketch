//! How the finished video is encoded — a contract, not a preference.
//!
//! The result has to play where it is watched: the Tauri webview. That rules out the codecs a
//! desktop image library reaches for by default (`mp4v`, Motion JPEG) and makes H.264 in
//! `yuv420p` the only useful answer, because it is the format WebView2, WKWebView and any
//! browser can decode without help.
//!
//! These values are the same ones the Python engine writes with. Changing them changes every
//! golden in the parity harness, so they are named and typed here rather than spelled out in a
//! command line somewhere.

/// The default constant-rate-factor. Lower is better quality and a bigger file.
pub const DEFAULT_CRF: u8 = 18;

/// The pixel format the encoder must be asked for.
///
/// `yuv420p` is what every consumer decoder accepts. It also keeps chroma at half resolution,
/// which is why a canvas with an odd side has to be grown before encoding — see
/// [`Dimensions::even_for_encoder`](crate::domain::Dimensions::even_for_encoder).
pub const PIXEL_FORMAT: &str = "yuv420p";

/// An `libx264` speed/compression preset.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EncoderPreset {
    /// Fastest, largest files.
    UltraFast,
    /// Very fast.
    SuperFast,
    /// The default: fast enough to feel instant on a laptop, good enough to keep.
    VeryFast,
    /// Faster.
    Faster,
    /// Fast.
    Fast,
    /// Balanced.
    Medium,
    /// Slow.
    Slow,
    /// Slower.
    Slower,
    /// Slowest, smallest files.
    VerySlow,
}

impl EncoderPreset {
    /// The name `libx264` knows it by.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::UltraFast => "ultrafast",
            Self::SuperFast => "superfast",
            Self::VeryFast => "veryfast",
            Self::Faster => "faster",
            Self::Fast => "fast",
            Self::Medium => "medium",
            Self::Slow => "slow",
            Self::Slower => "slower",
            Self::VerySlow => "veryslow",
        }
    }
}

/// Everything the encoder is told, in one place.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct EncoderSettings {
    /// Constant rate factor.
    pub crf: u8,
    /// Speed/compression trade-off.
    pub preset: EncoderPreset,
    /// Whether the container should put its index at the front, so a player can start before
    /// the whole file has arrived.
    pub faststart: bool,
}

impl Default for EncoderSettings {
    fn default() -> Self {
        Self {
            crf: DEFAULT_CRF,
            preset: EncoderPreset::VeryFast,
            faststart: true,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{DEFAULT_CRF, EncoderPreset, EncoderSettings, PIXEL_FORMAT};

    #[test]
    fn the_defaults_are_the_shipped_ones() {
        let settings = EncoderSettings::default();
        assert_eq!(settings.crf, 18);
        assert_eq!(settings.crf, DEFAULT_CRF);
        assert_eq!(settings.preset, EncoderPreset::VeryFast);
        assert_eq!(settings.preset.as_str(), "veryfast");
        assert!(settings.faststart);
        assert_eq!(PIXEL_FORMAT, "yuv420p");
    }

    #[test]
    fn every_preset_names_a_real_libx264_preset() {
        let names: Vec<&str> = [
            EncoderPreset::UltraFast,
            EncoderPreset::SuperFast,
            EncoderPreset::VeryFast,
            EncoderPreset::Faster,
            EncoderPreset::Fast,
            EncoderPreset::Medium,
            EncoderPreset::Slow,
            EncoderPreset::Slower,
            EncoderPreset::VerySlow,
        ]
        .iter()
        .map(|preset| preset.as_str())
        .collect();
        assert_eq!(
            names,
            vec![
                "ultrafast",
                "superfast",
                "veryfast",
                "faster",
                "fast",
                "medium",
                "slow",
                "slower",
                "veryslow"
            ]
        );
    }
}
