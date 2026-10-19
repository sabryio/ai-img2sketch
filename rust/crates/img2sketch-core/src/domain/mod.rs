//! Entities and value objects: the vocabulary of the engine, and the rules that make an invalid
//! instance impossible to construct.

pub mod dimensions;
pub mod encoder;
pub mod ffmpeg;
pub mod frame;
pub mod video_config;

pub use dimensions::{Dimensions, DimensionsError};
pub use encoder::{EncoderPreset, EncoderSettings, PIXEL_FORMAT};
pub use ffmpeg::{FfmpegSource, FfmpegStatus};
pub use frame::{Frame, FrameError};
pub use video_config::{
    DEFAULT_END_DURATION_SEC, DEFAULT_FRAME_RATE, DEFAULT_OBJECT_SKIP_RATE, DEFAULT_SPLIT_LEN,
    VideoConfig, VideoConfigError,
};
