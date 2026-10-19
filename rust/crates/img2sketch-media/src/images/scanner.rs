//! Finding the images in a folder.
//!
//! One level deep, on purpose: the folder someone points the tool at holds the photos they want
//! drawn, and the folders inside it hold thumbnails, exports and editor sidecars they do not. The
//! filter is by extension, so a `.txt` with a photo's name is not a photo, and the list is sorted
//! so two runs over the same folder produce the same videos in the same order.

use std::path::{Path, PathBuf};

use img2sketch_core::application::ports::{ImageScanner, ScanError};

/// The extensions the app treats as an image, matching the Python scanner.
pub const SUPPORTED_IMAGE_EXTENSIONS: [&str; 7] =
    ["png", "jpg", "jpeg", "bmp", "webp", "tif", "tiff"];

/// Lists image files off the filesystem.
#[derive(Debug, Clone, Copy, Default)]
pub struct FileSystemImageScanner;

impl ImageScanner for FileSystemImageScanner {
    fn find_images(&self, directory: &Path) -> Result<Vec<PathBuf>, ScanError> {
        if !directory.is_dir() {
            return Err(ScanError::NotADirectory(directory.to_path_buf()));
        }

        let entries = std::fs::read_dir(directory).map_err(|error| ScanError::Unreadable {
            path: directory.to_path_buf(),
            message: error.to_string(),
        })?;

        let mut images = Vec::new();
        for entry in entries {
            let entry = entry.map_err(|error| ScanError::Unreadable {
                path: directory.to_path_buf(),
                message: error.to_string(),
            })?;
            let path = entry.path();
            if !path.is_file() || !is_supported_image(&path) {
                continue;
            }
            images.push(path);
        }
        images.sort();

        Ok(images)
    }
}

/// Whether a path has one of the extensions the app draws.
#[must_use]
pub fn is_supported_image(path: &Path) -> bool {
    path.extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| {
            SUPPORTED_IMAGE_EXTENSIONS
                .iter()
                .any(|supported| extension.eq_ignore_ascii_case(supported))
        })
}

#[cfg(test)]
mod tests {
    use super::{FileSystemImageScanner, is_supported_image};
    use img2sketch_core::application::ports::{ImageScanner, ScanError};
    use std::path::Path;

    #[test]
    fn recognises_the_extension_case_insensitively() {
        assert!(is_supported_image(Path::new("a.JPG")));
        assert!(is_supported_image(Path::new("a.tiff")));
        assert!(is_supported_image(Path::new("holiday.2024.png")));
        assert!(!is_supported_image(Path::new("notes.txt")));
        assert!(!is_supported_image(Path::new("no-extension")));
    }

    #[test]
    fn lists_only_images_at_the_top_level_in_name_order() {
        let directory = tempfile::tempdir().unwrap();
        let root = directory.path();
        std::fs::write(root.join("b.png"), b"x").unwrap();
        std::fs::write(root.join("a.jpg"), b"x").unwrap();
        std::fs::write(root.join("notes.txt"), b"x").unwrap();
        std::fs::create_dir(root.join("nested")).unwrap();
        std::fs::write(root.join("nested").join("c.png"), b"x").unwrap();

        let images = FileSystemImageScanner.find_images(root).unwrap();
        let names: Vec<String> = images
            .iter()
            .map(|path| path.file_name().unwrap().to_string_lossy().into_owned())
            .collect();

        assert_eq!(
            names,
            vec!["a.jpg", "b.png"],
            "sorted, images only, one level"
        );
    }

    #[test]
    fn a_path_that_is_not_a_directory_is_refused() {
        let directory = tempfile::tempdir().unwrap();
        let file = directory.path().join("photo.png");
        std::fs::write(&file, b"x").unwrap();

        let error = FileSystemImageScanner.find_images(&file).unwrap_err();
        assert!(matches!(error, ScanError::NotADirectory(_)));
        assert!(error.to_string().contains("photo.png"));
    }

    #[test]
    fn a_missing_directory_is_refused_rather_than_read_as_empty() {
        let error = FileSystemImageScanner
            .find_images(Path::new("definitely/not/here"))
            .unwrap_err();
        assert!(matches!(error, ScanError::NotADirectory(_)));
    }
}
