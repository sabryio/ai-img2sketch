//! A real FFmpeg, a real MP4.
//!
//! These tests are ignored by default because they need an FFmpeg on the machine, which is exactly
//! the thing the product cannot assume. They are the only tests that prove the subprocess path
//! works end to end, so they are run deliberately:
//!
//! ```powershell
//! cargo test -p img2sketch-media -- --ignored
//! ```

#![allow(clippy::unwrap_used, clippy::expect_used)]

use img2sketch_core::application::ports::{FfmpegLocator, VideoWriter};
use img2sketch_core::domain::{Dimensions, EncoderSettings, Frame};
use img2sketch_media::ffmpeg::{FfmpegVideoWriter, SystemFfmpegLocator};

/// The FFmpeg this machine has, or a panic explaining what is missing.
fn usable_ffmpeg() -> std::path::PathBuf {
    let status = SystemFfmpegLocator::from_environment().probe();
    assert!(
        status.can_encode_h264(),
        "these tests need an FFmpeg with libx264: {}",
        status.summary()
    );
    status.executable().unwrap().to_path_buf()
}

/// Asks `ffprobe` what the file actually contains.
///
/// This is the check that catches a silent fallback: an encoder that quietly wrote Motion JPEG
/// instead of H.264 produces a file of the right size that the webview will not play. Note that
/// `ffprobe` comes from the same FFmpeg that wrote the file, so it verifies the container's claims
/// rather than independently decoding them — the parity harness does the independent decode.
fn probe_video_stream(video: &std::path::Path) -> String {
    let ffprobe = usable_ffmpeg().with_file_name(if cfg!(windows) {
        "ffprobe.exe"
    } else {
        "ffprobe"
    });
    let output = std::process::Command::new(ffprobe)
        .args([
            "-v",
            "error",
            "-select_streams",
            "v:0",
            "-show_entries",
            "stream=codec_name,pix_fmt,width,height",
            "-of",
            "default=noprint_wrappers=1",
        ])
        .arg(video)
        .output()
        .unwrap();
    String::from_utf8_lossy(&output.stdout).into_owned()
}

#[test]
#[ignore = "requires an ffmpeg executable; run with `cargo test -p img2sketch-media -- --ignored`"]
fn writes_a_playable_mp4_from_raw_frames() {
    let executable = usable_ffmpeg();
    let directory = tempfile::tempdir().unwrap();
    let output = directory.path().join("sketch.mp4");

    // Odd on purpose: the padding path is part of what has to work.
    let dimensions = Dimensions::new(9, 7).unwrap();
    let mut writer = Box::new(
        FfmpegVideoWriter::open(
            &executable,
            &output,
            dimensions,
            25,
            EncoderSettings::default(),
        )
        .unwrap(),
    );

    let frame = Frame::filled(dimensions, [200, 30, 40]);
    for _ in 0..25 {
        writer.write_frame(&frame).unwrap();
    }
    assert_eq!(writer.frames_written(), 25);

    let path = writer.release().unwrap();
    assert_eq!(path, output);
    let size = std::fs::metadata(&path).unwrap().len();
    assert!(size > 1_000, "expected a real file, got {size} bytes");

    // What the webview will ask of it, and the only two answers it accepts.
    let stream = probe_video_stream(&path);
    assert!(stream.contains("codec_name=h264"), "not H.264:\n{stream}");
    assert!(stream.contains("pix_fmt=yuv420p"), "not yuv420p:\n{stream}");
    // The odd 9x7 canvas was padded, and the declaration has to match the bytes that were sent.
    assert!(stream.contains("width=10"), "unexpected width:\n{stream}");
    assert!(stream.contains("height=8"), "unexpected height:\n{stream}");

    // Nothing but the result is left behind.
    let strays: Vec<String> = std::fs::read_dir(directory.path())
        .unwrap()
        .flatten()
        .map(|entry| entry.file_name().to_string_lossy().into_owned())
        .filter(|name| name.contains(".part-"))
        .collect();
    assert!(
        strays.is_empty(),
        "staged files were left behind: {strays:?}"
    );
}

#[test]
#[ignore = "requires an ffmpeg executable; run with `cargo test -p img2sketch-media -- --ignored`"]
fn a_writer_that_is_dropped_leaves_nothing_behind() {
    let executable = usable_ffmpeg();
    let directory = tempfile::tempdir().unwrap();
    let output = directory.path().join("cancelled.mp4");

    let dimensions = Dimensions::new(64, 64).unwrap();
    {
        let mut writer = Box::new(
            FfmpegVideoWriter::open(
                &executable,
                &output,
                dimensions,
                25,
                EncoderSettings::default(),
            )
            .unwrap(),
        );
        let frame = Frame::filled(dimensions, [10, 10, 10]);
        for _ in 0..3 {
            writer.write_frame(&frame).unwrap();
        }
        // Dropped without releasing — the user cancelled, or the process is going away.
    }

    assert!(
        !output.exists(),
        "a cancelled render must not publish a file"
    );
    let leftovers: Vec<String> = std::fs::read_dir(directory.path())
        .unwrap()
        .flatten()
        .map(|entry| entry.file_name().to_string_lossy().into_owned())
        .collect();
    assert!(
        leftovers.is_empty(),
        "a cancelled render must not leave staged files: {leftovers:?}"
    );
}

#[test]
#[ignore = "requires an ffmpeg executable; run with `cargo test -p img2sketch-media -- --ignored`"]
fn a_bad_frame_size_is_refused_rather_than_encoded() {
    let executable = usable_ffmpeg();
    let directory = tempfile::tempdir().unwrap();
    let output = directory.path().join("mismatch.mp4");

    let mut writer = Box::new(
        FfmpegVideoWriter::open(
            &executable,
            &output,
            Dimensions::new(64, 64).unwrap(),
            25,
            EncoderSettings::default(),
        )
        .unwrap(),
    );

    let wrong = Frame::filled(Dimensions::new(32, 32).unwrap(), [0, 0, 0]);
    let error = writer.write_frame(&wrong).unwrap_err();
    assert!(
        error.to_string().contains("64x64"),
        "the message should name the size the writer was opened with: {error}"
    );
    assert_eq!(writer.frames_written(), 0);
}
