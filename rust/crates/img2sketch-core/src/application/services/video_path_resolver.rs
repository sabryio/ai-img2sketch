//! Where a generated video goes.
//!
//! A video is always named after the image it came from — `photo.jpg` becomes `photo.mp4` — and by
//! default it is written beside that image, which is what someone running the tool over a folder
//! expects. An explicit output directory redirects every video while keeping the name, so a single
//! image and a folder behave the same way.

use std::path::{Path, PathBuf};

/// Decides the output path for a generated video.
#[derive(Debug, Clone, Copy, Default)]
pub struct VideoPathResolver;

impl VideoPathResolver {
    /// The `<name>.mp4` path for an image.
    #[must_use]
    pub fn resolve(image: &Path, output_directory: Option<&Path>) -> PathBuf {
        let directory = output_directory
            .map(Path::to_path_buf)
            .or_else(|| image.parent().map(Path::to_path_buf))
            .unwrap_or_else(|| PathBuf::from("."));
        let stem = image
            .file_stem()
            .and_then(|stem| stem.to_str())
            .unwrap_or("video");
        directory.join(format!("{stem}.mp4"))
    }
}

#[cfg(test)]
mod tests {
    use super::VideoPathResolver;
    use std::path::{Path, PathBuf};

    #[test]
    fn a_video_is_named_after_its_image_and_written_beside_it() {
        assert_eq!(
            VideoPathResolver::resolve(Path::new("C:/photos/portrait.jpg"), None),
            PathBuf::from("C:/photos/portrait.mp4")
        );
    }

    #[test]
    fn an_output_directory_redirects_everything_and_changes_nothing_else() {
        assert_eq!(
            VideoPathResolver::resolve(
                Path::new("C:/photos/portrait.jpg"),
                Some(Path::new("C:/out"))
            ),
            PathBuf::from("C:/out/portrait.mp4")
        );
    }

    #[test]
    fn a_relative_image_stays_relative() {
        assert_eq!(
            VideoPathResolver::resolve(Path::new("portrait.jpg"), None),
            PathBuf::from("portrait.mp4")
        );
    }

    #[test]
    fn a_name_with_several_dots_keeps_only_the_last_part_as_its_extension() {
        assert_eq!(
            VideoPathResolver::resolve(Path::new("C:/photos/holiday.2024.jpg"), None),
            PathBuf::from("C:/photos/holiday.2024.mp4")
        );
    }
}
