//! Reading a source image, preparing it, and finding the images in a folder.
//!
//! Everything in here is an adapter for an `img2sketch-core` port, with two exceptions that are
//! plain arithmetic on an engine value: [`resize`] and [`threshold`]. They are here rather than in
//! the core crate because they are the parts whose answers are defined by a *library* the Python
//! engine uses — OpenCV's resampling and its Gaussian local mean — and a pure crate that carried
//! them would be claiming an authority it does not have.

pub mod hand;
pub mod loader;
pub mod preprocessor;
pub mod resize;
pub mod scanner;
pub mod threshold;

pub use hand::{BUNDLED_HAND_IMAGE, BUNDLED_HAND_MASK, HandAsset, HandSource, decode_hand};
pub use loader::{FileSystemImageLoader, ImageError, load_frame};
pub use preprocessor::GaussianAdaptivePreprocessor;
pub use resize::resize_area;
pub use scanner::{FileSystemImageScanner, SUPPORTED_IMAGE_EXTENSIONS, is_supported_image};
pub use threshold::{
    DEFAULT_BLOCK_SIZE, DEFAULT_CONSTANT, gaussian_adaptive_threshold, gaussian_blur,
    gaussian_kernel, to_grayscale,
};
