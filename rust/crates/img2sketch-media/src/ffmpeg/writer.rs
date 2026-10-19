//! Driving FFmpeg as a process.
//!
//! The writer owns a child process, feeds it raw frames, and finishes it. Three promises are kept
//! here, and each one is a test in `tests/ffmpeg_render.rs`:
//!
//! 1. **Frames are padded, not truncated.** An odd-sided canvas cannot be encoded, so the last
//!    row and column are replicated before the frame is sent — the same thing the Python writer
//!    does, on purpose, because a black pad would show as a stripe.
//! 2. **The result appears complete, or not at all.** FFmpeg writes to a staged file beside the
//!    output and the file is renamed into place only after FFmpeg has exited successfully. A
//!    half-written MP4 that plays for two seconds is worse than no file, because it looks like a
//!    success.
//! 3. **Dropping the writer leaves nothing behind.** A cancelled render kills the process and
//!    removes the staged file.
//!
//! The only reason the command line can be trusted is that it is built by
//! [`encoder::EncodeRequest`](super::encoder::EncodeRequest), which is pure and asserted in a test.

use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, Command, Stdio};

use img2sketch_core::application::ports::{VideoWriter, VideoWriterError};
use img2sketch_core::domain::{Dimensions, EncoderSettings, Frame};

use super::encoder::encode_request;

/// Writes frames by piping raw RGB into an `ffmpeg` process.
#[derive(Debug)]
pub struct FfmpegVideoWriter {
    child: Child,
    stdin: Option<ChildStdin>,
    stderr: Option<std::thread::JoinHandle<String>>,
    dimensions: Dimensions,
    frame_rate: u32,
    staged: PathBuf,
    output: PathBuf,
    frames_written: u64,
    released: bool,
}

impl FfmpegVideoWriter {
    /// Starts an encoder writing to `output`.
    ///
    /// The parent directory is created if it does not exist, because every caller has already
    /// decided where the file goes and being refused over a missing directory helps nobody.
    ///
    /// # Errors
    ///
    /// Returns [`VideoWriterError::Io`] when the directory cannot be created or the process
    /// cannot be started.
    pub fn open(
        executable: &Path,
        output: &Path,
        dimensions: Dimensions,
        frame_rate: u32,
        settings: EncoderSettings,
    ) -> Result<Self, VideoWriterError> {
        if let Some(parent) = output.parent()
            && !parent.as_os_str().is_empty()
        {
            std::fs::create_dir_all(parent)?;
        }

        let staged = staged_path(output);
        let request = encode_request(executable, &staged, dimensions, frame_rate, settings);

        let mut child = Command::new(&request.executable)
            .args(request.args())
            .stdin(Stdio::piped())
            .stdout(Stdio::null())
            .stderr(Stdio::piped())
            .spawn()?;

        let stdin = child.stdin.take();
        let stderr = child.stderr.take().map(|mut stream| {
            std::thread::spawn(move || {
                let mut complaint = String::new();
                let _ = stream.read_to_string(&mut complaint);
                complaint
            })
        });

        Ok(Self {
            child,
            stdin,
            stderr,
            dimensions,
            frame_rate,
            staged,
            output: output.to_path_buf(),
            frames_written: 0,
            released: false,
        })
    }

    /// How many frames were accepted.
    #[must_use]
    pub fn frames_written(&self) -> u64 {
        self.frames_written
    }

    /// The size the frames must be padded to.
    #[must_use]
    pub const fn encoder_dimensions(&self) -> Dimensions {
        self.dimensions.even_for_encoder()
    }

    /// The frame rate the input was declared at.
    #[must_use]
    pub const fn frame_rate(&self) -> u32 {
        self.frame_rate
    }

    /// Waits for FFmpeg to exit and collects what it said.
    ///
    /// FFmpeg reports its failures on standard error, so the message a user sees is FFmpeg's own
    /// diagnosis rather than "the encoder failed".
    fn finish(&mut self) -> Result<(), VideoWriterError> {
        let status = self.child.wait()?;
        let complaint = self.stop_listening();
        if status.success() {
            return Ok(());
        }
        let _ = std::fs::remove_file(&self.staged);
        if complaint.is_empty() {
            Err(VideoWriterError::Encoding(format!(
                "ffmpeg exited with {status}"
            )))
        } else {
            Err(VideoWriterError::Encoding(complaint))
        }
    }

    /// Stops the child and returns whatever it wrote to standard error.
    fn abandon(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
        let _ = self.stop_listening();
    }

    /// Joins the thread draining FFmpeg's standard error.
    fn stop_listening(&mut self) -> String {
        self.stderr
            .take()
            .and_then(|handle| handle.join().ok())
            .unwrap_or_default()
            .trim()
            .to_string()
    }
}

impl VideoWriter for FfmpegVideoWriter {
    fn write_frame(&mut self, frame: &Frame) -> Result<(), VideoWriterError> {
        let expected = self.encoder_dimensions();
        if frame.width() != self.dimensions.width() || frame.height() != self.dimensions.height() {
            return Err(VideoWriterError::FrameSize {
                expected_width: self.dimensions.width(),
                expected_height: self.dimensions.height(),
                actual_width: frame.width(),
                actual_height: frame.height(),
            });
        }

        let padded = frame.padded_to_even();
        debug_assert_eq!(padded.dimensions(), expected);

        let Some(stdin) = self.stdin.as_mut() else {
            return Err(VideoWriterError::Encoding(
                "the encoder's input was already closed".to_string(),
            ));
        };

        if let Err(error) = stdin.write_all(padded.rgb()) {
            // A broken pipe means FFmpeg refused something and exited. Its standard error is the
            // only useful explanation, so collect it rather than reporting a bare pipe failure.
            self.abandon();
            let complaint = self.stop_listening();
            return Err(if complaint.is_empty() {
                VideoWriterError::Io(error)
            } else {
                VideoWriterError::Encoding(complaint)
            });
        }

        self.frames_written += 1;
        Ok(())
    }

    fn release(mut self: Box<Self>) -> Result<PathBuf, VideoWriterError> {
        // Closing the input is what tells FFmpeg the video is complete.
        drop(self.stdin.take());
        self.finish()?;
        std::fs::rename(&self.staged, &self.output)?;
        self.released = true;
        Ok(self.output.clone())
    }
}

impl Drop for FfmpegVideoWriter {
    fn drop(&mut self) {
        if self.released {
            return;
        }
        drop(self.stdin.take());
        self.abandon();
        let _ = std::fs::remove_file(&self.staged);
    }
}

/// The temporary file FFmpeg writes to before the result is published.
///
/// The extension is kept: FFmpeg chooses its muxer from it, and a name that ends in `.mp4` is the
/// only kind that produces the MP4 the webview can play.
fn staged_path(output: &Path) -> PathBuf {
    let stem = output
        .file_stem()
        .and_then(|stem| stem.to_str())
        .unwrap_or("video");
    let extension = output
        .extension()
        .and_then(|extension| extension.to_str())
        .unwrap_or("mp4");
    let marker = uuid::Uuid::new_v4().simple();
    output.with_file_name(format!("{stem}.part-{marker}.{extension}"))
}

#[cfg(test)]
mod tests {
    use super::staged_path;
    use std::path::{Path, PathBuf};

    #[test]
    fn a_staged_file_sits_beside_the_output_and_keeps_its_extension() {
        let staged = staged_path(Path::new("C:/out/sketch.mp4"));
        assert_eq!(staged.parent(), Some(Path::new("C:/out")));
        assert_eq!(staged.extension().and_then(|e| e.to_str()), Some("mp4"));
        let name = staged.file_name().and_then(|n| n.to_str()).unwrap();
        assert!(name.starts_with("sketch.part-"), "unexpected name: {name}");
    }

    #[test]
    fn a_staged_file_is_never_the_output_itself() {
        let output = PathBuf::from("video.mp4");
        assert_ne!(staged_path(&output), output);
    }

    #[test]
    fn two_renders_of_the_same_output_do_not_collide() {
        let output = Path::new("one.mp4");
        assert_ne!(staged_path(output), staged_path(output));
    }
}
