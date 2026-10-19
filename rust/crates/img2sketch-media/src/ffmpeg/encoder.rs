//! The exact command line the encoder is given.
//!
//! This is the parity surface. The Python engine writes H.264 with `crf 18`, the `veryfast`
//! preset, `yuv420p` and a fast-start index; if the arguments here drift, every golden in the
//! parity harness drifts with them. So the arguments are *built* by a pure function and asserted
//! in a test, rather than assembled at the call site where nothing would notice.
//!
//! Frames arrive on standard input as raw `bgr24` — no temporary files, no intermediate PNG — and
//! the output is the only thing the process writes.

use std::path::{Path, PathBuf};

use img2sketch_core::domain::{Dimensions, EncoderSettings, Frame, PIXEL_FORMAT};

/// The pixel format frames arrive in, and the demuxer that reads them.
///
/// RGB rather than YUV because the engine draws in RGB and asking FFmpeg to convert once, in the
/// encoder where it is fast and threaded, beats converting per frame in the drawing loop.
///
/// BGR rather than RGB, and that one letter is load-bearing. FFmpeg converts `rgb24` and `bgr24`
/// to `yuv420p` *differently*: a white of 255 survives the `rgb24` round trip at 255, and comes
/// back at 250 through `bgr24`. Neither stream is tagged with a colour range — `ffprobe` reports
/// `color_range=unknown` for both — so the decoder cannot tell them apart and the difference
/// lands in the picture, five steps across every pixel of the paper. It is not the drawing: the
/// drawn frames agree cell for cell. It is the conversion. The Python engine's PyAV writer hands
/// libx264 `bgr24` frames, so this does too, and the two videos then differ by a rate-control
/// decision on a few hundred pixels instead of by a level on all of them.
pub const RAW_INPUT: (&str, &str) = ("rawvideo", "bgr24");

/// One frame's bytes in [`RAW_INPUT`]'s channel order.
///
/// The engine draws in RGB and the encoder expects BGR, so this is a channel swap and nothing
/// more — see [`RAW_INPUT`] for why the swap is worth making rather than asking FFmpeg to accept
/// the RGB bytes directly.
#[must_use]
pub fn interleaved(frame: &Frame) -> Vec<u8> {
    let mut bytes = frame.rgb().to_vec();
    for pixel in bytes.as_chunks_mut::<3>().0 {
        pixel.swap(0, 2);
    }
    bytes
}

/// Everything one encode needs to know.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EncodeRequest {
    /// The `ffmpeg` executable.
    pub executable: PathBuf,
    /// Where the finished video goes.
    pub output: PathBuf,
    /// The size the frames will be padded to.
    pub dimensions: Dimensions,
    /// The frame rate the input is declared at.
    pub frame_rate: u32,
    /// The output settings.
    pub settings: EncoderSettings,
}

impl EncodeRequest {
    /// The arguments, in order, without the executable.
    ///
    /// The size is the *even* size: the writer pads frames before sending them, so declaring the
    /// padded size here is what makes an odd-sided canvas work at all.
    #[must_use]
    pub fn args(&self) -> Vec<String> {
        let even = self.dimensions.even_for_encoder();
        let mut args = vec![
            "-hide_banner".to_string(),
            "-loglevel".to_string(),
            "error".to_string(),
            "-f".to_string(),
            RAW_INPUT.0.to_string(),
            "-pixel_format".to_string(),
            RAW_INPUT.1.to_string(),
            "-video_size".to_string(),
            format!("{}x{}", even.width(), even.height()),
            "-framerate".to_string(),
            self.frame_rate.to_string(),
            "-i".to_string(),
            "pipe:0".to_string(),
            "-an".to_string(),
            "-c:v".to_string(),
            "libx264".to_string(),
            "-preset".to_string(),
            self.settings.preset.as_str().to_string(),
            "-crf".to_string(),
            self.settings.crf.to_string(),
            "-pix_fmt".to_string(),
            PIXEL_FORMAT.to_string(),
        ];

        if self.settings.faststart {
            args.push("-movflags".to_string());
            args.push("+faststart".to_string());
        }

        args.push("-y".to_string());
        args.push(self.output.display().to_string());
        args
    }

    /// The command as a string, for a log line a person can read.
    #[must_use]
    pub fn command_line(&self) -> String {
        let executable = self.executable.display();
        let args = self.args().join(" ");
        format!("{executable} {args}")
    }
}

/// Builds a request for one output file.
#[must_use]
pub fn encode_request(
    executable: &Path,
    output: &Path,
    dimensions: Dimensions,
    frame_rate: u32,
    settings: EncoderSettings,
) -> EncodeRequest {
    EncodeRequest {
        executable: executable.to_path_buf(),
        output: output.to_path_buf(),
        dimensions,
        frame_rate,
        settings,
    }
}

#[cfg(test)]
mod tests {
    use img2sketch_core::domain::{Dimensions, EncoderPreset, EncoderSettings};

    use super::{RAW_INPUT, encode_request};

    fn default_settings() -> EncoderSettings {
        EncoderSettings::default()
    }

    #[test]
    fn the_arguments_are_the_ones_the_python_engine_writes_with() {
        let request = encode_request(
            "C:/ffmpeg/bin/ffmpeg.exe".as_ref(),
            "C:/out/sketch.mp4".as_ref(),
            Dimensions::new(360, 490).unwrap(),
            25,
            default_settings(),
        );

        assert_eq!(
            request.args(),
            vec![
                "-hide_banner",
                "-loglevel",
                "error",
                "-f",
                "rawvideo",
                "-pixel_format",
                "bgr24",
                "-video_size",
                "360x490",
                "-framerate",
                "25",
                "-i",
                "pipe:0",
                "-an",
                "-c:v",
                "libx264",
                "-preset",
                "veryfast",
                "-crf",
                "18",
                "-pix_fmt",
                "yuv420p",
                "-movflags",
                "+faststart",
                "-y",
                "C:/out/sketch.mp4",
            ]
        );
    }

    #[test]
    fn an_odd_canvas_is_declared_at_its_padded_size() {
        let request = encode_request(
            "ffmpeg".as_ref(),
            "out.mp4".as_ref(),
            Dimensions::new(9, 7).unwrap(),
            25,
            default_settings(),
        );
        let args = request.args();
        let size = args.iter().position(|arg| arg == "-video_size").unwrap();
        assert_eq!(args[size + 1], "10x8");
    }

    #[test]
    fn faststart_is_asked_for_by_default_and_can_be_turned_off() {
        let with = encode_request(
            "ffmpeg".as_ref(),
            "out.mp4".as_ref(),
            Dimensions::new(4, 4).unwrap(),
            25,
            default_settings(),
        );
        assert!(with.args().contains(&"+faststart".to_string()));

        let without = encode_request(
            "ffmpeg".as_ref(),
            "out.mp4".as_ref(),
            Dimensions::new(4, 4).unwrap(),
            25,
            EncoderSettings {
                faststart: false,
                ..default_settings()
            },
        );
        assert!(!without.args().contains(&"+faststart".to_string()));
        assert!(!without.args().contains(&"-movflags".to_string()));
    }

    #[test]
    fn the_settings_reach_the_command_line() {
        let request = encode_request(
            "ffmpeg".as_ref(),
            "out.mp4".as_ref(),
            Dimensions::new(4, 4).unwrap(),
            30,
            EncoderSettings {
                crf: 23,
                preset: EncoderPreset::Medium,
                faststart: true,
            },
        );
        let args = request.args();
        let value_after = |flag: &str| {
            let index = args.iter().position(|arg| arg == flag).unwrap();
            args[index + 1].clone()
        };
        assert_eq!(value_after("-crf"), "23");
        assert_eq!(value_after("-preset"), "medium");
        assert_eq!(value_after("-framerate"), "30");
    }

    #[test]
    fn raw_frames_are_what_the_encoder_is_told_to_expect() {
        assert_eq!(RAW_INPUT, ("rawvideo", "bgr24"));
        let request = encode_request(
            "ffmpeg".as_ref(),
            "out.mp4".as_ref(),
            Dimensions::new(4, 4).unwrap(),
            25,
            default_settings(),
        );
        let args = request.args();
        assert!(args.contains(&"pipe:0".to_string()));
        assert!(args.contains(&"-an".to_string()), "the video has no audio");
    }

    #[test]
    fn a_frame_is_handed_over_in_the_channel_order_the_encoder_was_told() {
        use img2sketch_core::domain::Frame;

        let frame =
            Frame::new(Dimensions::new(2, 1).unwrap(), vec![10, 20, 30, 40, 50, 60]).unwrap();
        // Red and blue exchange; green stays where it was.
        assert_eq!(super::interleaved(&frame), vec![30, 20, 10, 60, 50, 40]);
    }
}
