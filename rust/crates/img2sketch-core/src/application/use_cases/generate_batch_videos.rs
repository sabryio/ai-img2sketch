//! Drawing a folder of images into a folder of videos.
//!
//! A batch is not a bigger single run: it is many independent ones whose failures are *per image*.
//! One unreadable file in a folder of two hundred should cost one video, not the run — so a
//! failure is recorded against the image that caused it and the loop carries on. The summary at
//! the end is what tells the caller whether the run was clean, and the exit code is built from it.

use std::path::{Path, PathBuf};

use crate::application::ports::{ImageLoader, ImageScanner, ProgressReporter, ScanError};
use crate::application::services::VideoPathResolver;
use crate::domain::{ObjectMask, VideoConfig};

use super::SketchRenderer;

/// What happened to one image.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BatchItem {
    image_path: PathBuf,
    output_path: Option<PathBuf>,
    error: Option<String>,
}

impl BatchItem {
    /// An image that produced a video.
    #[must_use]
    pub fn succeeded(image_path: PathBuf, output_path: PathBuf) -> Self {
        Self {
            image_path,
            output_path: Some(output_path),
            error: None,
        }
    }

    /// An image that did not, and why.
    #[must_use]
    pub fn failed(image_path: PathBuf, error: impl Into<String>) -> Self {
        Self {
            image_path,
            output_path: None,
            error: Some(error.into()),
        }
    }

    /// The image this item is about.
    #[must_use]
    pub fn image_path(&self) -> &Path {
        &self.image_path
    }

    /// The video that was written, when one was.
    #[must_use]
    pub fn output_path(&self) -> Option<&Path> {
        self.output_path.as_deref()
    }

    /// Why the image failed, when it did.
    #[must_use]
    pub fn error(&self) -> Option<&str> {
        self.error.as_deref()
    }

    /// Whether this image produced a video.
    #[must_use]
    pub const fn is_success(&self) -> bool {
        self.error.is_none()
    }
}

/// The outcome of a folder run, in the order the images were found.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BatchSummary {
    items: Vec<BatchItem>,
}

impl BatchSummary {
    /// Every image's outcome.
    #[must_use]
    pub fn items(&self) -> &[BatchItem] {
        &self.items
    }

    /// How many images produced a video.
    #[must_use]
    pub fn succeeded(&self) -> usize {
        self.items.iter().filter(|item| item.is_success()).count()
    }

    /// How many did not.
    #[must_use]
    pub fn failed(&self) -> usize {
        self.items.iter().filter(|item| !item.is_success()).count()
    }

    /// How many images the run found.
    #[must_use]
    pub fn total(&self) -> usize {
        self.items.len()
    }
}

/// Draws every image in a folder, one video each.
#[derive(Debug)]
pub struct GenerateBatchVideos {
    loader: Box<dyn ImageLoader>,
    scanner: Box<dyn ImageScanner>,
    renderer: Box<dyn SketchRenderer>,
}

impl GenerateBatchVideos {
    /// Builds the use case from the three things it cannot decide for itself.
    #[must_use]
    pub fn new(
        loader: Box<dyn ImageLoader>,
        scanner: Box<dyn ImageScanner>,
        renderer: Box<dyn SketchRenderer>,
    ) -> Self {
        Self {
            loader,
            scanner,
            renderer,
        }
    }

    /// Draws one video per image found directly inside `directory`.
    ///
    /// # Errors
    ///
    /// Returns [`ScanError`] only when the directory itself cannot be read. Everything after that
    /// is recorded per image, because one bad file is not a reason to abandon the rest.
    pub fn execute(
        &self,
        directory: &Path,
        config: &VideoConfig,
        output_directory: Option<&Path>,
        object_masks: &[ObjectMask],
        progress: Option<&dyn ProgressReporter>,
    ) -> Result<BatchSummary, ScanError> {
        let images = self.scanner.find_images(directory)?;

        let mut items = Vec::with_capacity(images.len());
        for image_path in images {
            let output = VideoPathResolver::resolve(&image_path, output_directory);
            let item = match self.loader.load(&image_path) {
                Ok(image) => {
                    match self
                        .renderer
                        .render(&image, config, &output, object_masks, progress)
                    {
                        Ok(produced) => BatchItem::succeeded(image_path, produced),
                        Err(error) => BatchItem::failed(image_path, error.to_string()),
                    }
                }
                Err(error) => BatchItem::failed(image_path, error.to_string()),
            };
            items.push(item);
        }

        Ok(BatchSummary { items })
    }
}

#[cfg(test)]
mod tests {
    use std::path::{Path, PathBuf};
    use std::sync::{Arc, Mutex};

    use super::{BatchSummary, GenerateBatchVideos};
    use crate::application::ports::{
        ImageLoadError, ImageLoader, ImageScanner, ProgressReporter, ScanError,
    };
    use crate::application::use_cases::{GenerateError, SketchRenderer};
    use crate::domain::{Dimensions, Frame, GridError, ObjectMask, VideoConfig};

    #[derive(Debug)]
    struct FixedScanner(Vec<PathBuf>);

    impl ImageScanner for FixedScanner {
        fn find_images(&self, _directory: &Path) -> Result<Vec<PathBuf>, ScanError> {
            Ok(self.0.clone())
        }
    }

    #[derive(Debug)]
    struct FixedLoader {
        unreadable: Vec<PathBuf>,
    }

    impl ImageLoader for FixedLoader {
        fn load(&self, path: &Path) -> Result<Frame, ImageLoadError> {
            if self.unreadable.contains(&path.to_path_buf()) {
                return Err(ImageLoadError::Unreadable {
                    path: path.to_path_buf(),
                    message: "the file is not an image".to_string(),
                });
            }
            Ok(Frame::filled(Dimensions::new(2, 2).unwrap(), [0, 0, 0]))
        }
    }

    #[derive(Debug, Default, Clone)]
    struct RecordingRenderer {
        rendered: Arc<Mutex<Vec<PathBuf>>>,
        fails: Vec<PathBuf>,
    }

    impl SketchRenderer for RecordingRenderer {
        fn render(
            &self,
            _image: &Frame,
            _config: &VideoConfig,
            output: &Path,
            _object_masks: &[ObjectMask],
            _progress: Option<&dyn ProgressReporter>,
        ) -> Result<PathBuf, GenerateError> {
            self.rendered.lock().unwrap().push(output.to_path_buf());
            if self.fails.contains(&output.to_path_buf()) {
                return Err(GenerateError::Grid(GridError::Empty));
            }
            Ok(output.to_path_buf())
        }
    }

    fn config() -> VideoConfig {
        VideoConfig::default()
    }

    fn run(
        images: Vec<PathBuf>,
        unreadable: Vec<PathBuf>,
        fails: Vec<PathBuf>,
        output_directory: Option<&Path>,
    ) -> (BatchSummary, Vec<PathBuf>) {
        let renderer = RecordingRenderer {
            fails,
            ..RecordingRenderer::default()
        };
        let rendered = Arc::clone(&renderer.rendered);
        let use_case = GenerateBatchVideos::new(
            Box::new(FixedLoader { unreadable }),
            Box::new(FixedScanner(images)),
            Box::new(renderer),
        );
        let summary = use_case
            .execute(
                Path::new("C:/photos"),
                &config(),
                output_directory,
                &[],
                None,
            )
            .unwrap();

        let log = rendered.lock().unwrap().clone();
        (summary, log)
    }

    #[test]
    fn a_folder_becomes_one_video_per_image() {
        let (summary, rendered) = run(
            vec![
                PathBuf::from("C:/photos/one.jpg"),
                PathBuf::from("C:/photos/two.png"),
            ],
            Vec::new(),
            Vec::new(),
            None,
        );

        assert_eq!(summary.total(), 2);
        assert_eq!(summary.succeeded(), 2);
        assert_eq!(summary.failed(), 0);
        assert!(summary.items().iter().all(|item| item.is_success()));
        assert_eq!(
            rendered,
            vec![
                PathBuf::from("C:/photos/one.mp4"),
                PathBuf::from("C:/photos/two.mp4")
            ]
        );
    }

    #[test]
    fn one_bad_image_does_not_end_the_run() {
        let (summary, _) = run(
            vec![
                PathBuf::from("C:/photos/one.jpg"),
                PathBuf::from("C:/photos/broken.jpg"),
                PathBuf::from("C:/photos/three.jpg"),
            ],
            vec![PathBuf::from("C:/photos/broken.jpg")],
            Vec::new(),
            None,
        );

        assert_eq!(summary.total(), 3);
        assert_eq!(summary.succeeded(), 2);
        assert_eq!(summary.failed(), 1);
        let failure = &summary.items()[1];
        assert_eq!(failure.image_path(), Path::new("C:/photos/broken.jpg"));
        assert!(
            failure.error().unwrap().contains("not an image"),
            "got: {:?}",
            failure.error()
        );
        assert_eq!(failure.output_path(), None);
    }

    #[test]
    fn a_render_failure_is_recorded_against_the_image_that_caused_it() {
        let (summary, _) = run(
            vec![
                PathBuf::from("C:/photos/one.jpg"),
                PathBuf::from("C:/photos/two.jpg"),
            ],
            Vec::new(),
            vec![PathBuf::from("C:/photos/two.mp4")],
            None,
        );

        assert_eq!(summary.succeeded(), 1);
        assert_eq!(summary.failed(), 1);
        assert_eq!(
            summary.items()[0].output_path(),
            Some(Path::new("C:/photos/one.mp4"))
        );
        assert!(summary.items()[1].error().is_some());
    }

    #[test]
    fn an_output_directory_redirects_every_video() {
        let (_, rendered) = run(
            vec![PathBuf::from("C:/photos/one.jpg")],
            Vec::new(),
            Vec::new(),
            Some(Path::new("C:/exports")),
        );
        assert_eq!(rendered, vec![PathBuf::from("C:/exports/one.mp4")]);
    }

    #[test]
    fn an_empty_folder_is_a_clean_run_with_nothing_in_it() {
        let (summary, rendered) = run(Vec::new(), Vec::new(), Vec::new(), None);
        assert_eq!(summary.total(), 0);
        assert_eq!(summary.succeeded(), 0);
        assert_eq!(summary.failed(), 0);
        assert!(rendered.is_empty());
    }
}
