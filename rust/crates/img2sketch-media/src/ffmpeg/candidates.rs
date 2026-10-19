//! Where an FFmpeg might be.
//!
//! One type per kind of place, each knowing only its own corner of the machine and each declaring
//! how much it should be trusted if it wins. Adding a place to look means adding a type, not
//! editing a search function — which is the point, because this list will keep growing.

use std::path::{Path, PathBuf};

use img2sketch_core::domain::FfmpegSource;
use walkdir::WalkDir;

/// The executable's file name on this platform.
#[cfg(windows)]
pub const EXECUTABLE_NAME: &str = "ffmpeg.exe";
/// The executable's file name on this platform.
#[cfg(not(windows))]
pub const EXECUTABLE_NAME: &str = "ffmpeg";

/// A place FFmpeg might be.
pub trait CandidateSource: std::fmt::Debug + Send + Sync {
    /// How much this place is trusted, if a candidate from it is the one that works.
    fn source(&self) -> FfmpegSource;

    /// The paths to try, most likely first. They are not checked here — the locator does that,
    /// so this stays a question about layout rather than about the filesystem.
    fn candidates(&self) -> Vec<PathBuf>;
}

/// The copy shipped inside the app.
#[derive(Debug, Clone)]
pub struct BundledSource {
    directory: PathBuf,
}

impl BundledSource {
    /// Looks inside `directory`, which the host reports for its own resources.
    #[must_use]
    pub fn new(directory: PathBuf) -> Self {
        Self { directory }
    }
}

impl CandidateSource for BundledSource {
    fn source(&self) -> FfmpegSource {
        FfmpegSource::Bundled
    }

    fn candidates(&self) -> Vec<PathBuf> {
        vec![
            self.directory.join(EXECUTABLE_NAME),
            self.directory.join("bin").join(EXECUTABLE_NAME),
        ]
    }
}

/// A copy the app installed for itself, in its own data directory.
#[derive(Debug, Clone)]
pub struct ManagedSource {
    directory: PathBuf,
}

impl ManagedSource {
    /// Looks inside the app's private FFmpeg directory.
    #[must_use]
    pub fn new(directory: PathBuf) -> Self {
        Self { directory }
    }
}

impl CandidateSource for ManagedSource {
    fn source(&self) -> FfmpegSource {
        FfmpegSource::Managed
    }

    fn candidates(&self) -> Vec<PathBuf> {
        vec![
            self.directory.join(EXECUTABLE_NAME),
            self.directory.join("bin").join(EXECUTABLE_NAME),
        ]
    }
}

/// A path the user chose.
///
/// The value may be the executable itself or the directory holding it; both are offered and the
/// locator decides. Source and storage of that setting belong to the host, not here.
#[derive(Debug, Clone, Default)]
pub struct ConfiguredSource {
    configured: Option<PathBuf>,
}

impl ConfiguredSource {
    /// Uses the path the user chose, if there is one.
    #[must_use]
    pub fn new(configured: Option<PathBuf>) -> Self {
        Self { configured }
    }
}

impl CandidateSource for ConfiguredSource {
    fn source(&self) -> FfmpegSource {
        FfmpegSource::Configured
    }

    fn candidates(&self) -> Vec<PathBuf> {
        match &self.configured {
            None => Vec::new(),
            Some(path) => vec![path.clone(), path.join(EXECUTABLE_NAME)],
        }
    }
}

/// Whatever the user's `PATH` resolves to.
#[derive(Debug, Clone, Copy, Default)]
pub struct PathSource;

impl CandidateSource for PathSource {
    fn source(&self) -> FfmpegSource {
        FfmpegSource::Path
    }

    fn candidates(&self) -> Vec<PathBuf> {
        which::which(EXECUTABLE_NAME).into_iter().collect()
    }
}

/// A set of conventional install directories.
#[derive(Debug, Clone, Default)]
pub struct KnownDirectorySource {
    directories: Vec<PathBuf>,
}

impl KnownDirectorySource {
    /// Looks in each directory in turn.
    #[must_use]
    pub fn new(directories: Vec<PathBuf>) -> Self {
        Self { directories }
    }
}

impl CandidateSource for KnownDirectorySource {
    fn source(&self) -> FfmpegSource {
        FfmpegSource::KnownLocation
    }

    fn candidates(&self) -> Vec<PathBuf> {
        self.directories
            .iter()
            .map(|directory| directory.join(EXECUTABLE_NAME))
            .collect()
    }
}

/// The build a package manager downloaded, wherever it decided to put it.
///
/// winget keeps packages under a private directory whose middle segment is a hash, so the only way
/// to find one is to walk it. The walk is bounded and filtered, because that directory holds every
/// package the user has ever installed.
#[derive(Debug, Clone)]
pub struct WinGetSource {
    packages_directory: PathBuf,
}

impl WinGetSource {
    /// Walks `packages_directory`, looking for an FFmpeg package.
    #[must_use]
    pub fn new(packages_directory: PathBuf) -> Self {
        Self { packages_directory }
    }
}

impl CandidateSource for WinGetSource {
    fn source(&self) -> FfmpegSource {
        FfmpegSource::KnownLocation
    }

    fn candidates(&self) -> Vec<PathBuf> {
        if !self.packages_directory.is_dir() {
            return Vec::new();
        }

        let packages = match std::fs::read_dir(&self.packages_directory) {
            Ok(entries) => entries,
            Err(_) => return Vec::new(),
        };

        let mut candidates = Vec::new();
        for package in packages.flatten() {
            let name = package.file_name().to_string_lossy().to_lowercase();
            if !name.contains("ffmpeg") {
                continue;
            }
            for entry in WalkDir::new(package.path())
                .max_depth(3)
                .into_iter()
                .flatten()
            {
                if entry.file_name() == EXECUTABLE_NAME {
                    candidates.push(entry.path().to_path_buf());
                }
            }
        }
        candidates
    }
}

/// The executable Windows itself knows about.
#[cfg(windows)]
#[derive(Debug, Clone, Copy, Default)]
pub struct RegistrySource;

#[cfg(windows)]
impl CandidateSource for RegistrySource {
    fn source(&self) -> FfmpegSource {
        FfmpegSource::Registry
    }

    fn candidates(&self) -> Vec<PathBuf> {
        use winreg::RegKey;
        use winreg::enums::{HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE};

        const APP_PATHS: &str = r"SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\ffmpeg.exe";

        let hives = [
            RegKey::predef(HKEY_CURRENT_USER),
            RegKey::predef(HKEY_LOCAL_MACHINE),
        ];
        for hive in hives {
            let Ok(key) = hive.open_subkey(APP_PATHS) else {
                continue;
            };
            let Ok(path) = key.get_value::<String, _>("") else {
                continue;
            };
            let path = PathBuf::from(path);
            if !path.as_os_str().is_empty() {
                return vec![path];
            }
        }
        Vec::new()
    }
}

/// Convenience for building a source list from paths.
#[must_use]
pub fn known_directories(paths: impl IntoIterator<Item = PathBuf>) -> KnownDirectorySource {
    KnownDirectorySource::new(paths.into_iter().collect())
}

/// The path a source reported, for diagnostics.
#[must_use]
pub fn describe(path: &Path) -> String {
    path.display().to_string()
}

#[cfg(test)]
mod tests {
    use super::{
        BundledSource, CandidateSource, ConfiguredSource, KnownDirectorySource, ManagedSource,
    };

    #[test]
    fn a_configured_directory_offers_the_executable_inside_it() {
        let source = ConfiguredSource::new(Some("C:/tools".into()));
        let candidates = source.candidates();
        assert_eq!(candidates.len(), 2);
        assert!(candidates[0].ends_with("tools"));
        assert!(candidates[1].ends_with(super::EXECUTABLE_NAME));
    }

    #[test]
    fn nothing_configured_offers_nothing() {
        assert!(ConfiguredSource::new(None).candidates().is_empty());
    }

    #[test]
    fn the_bundled_copy_is_looked_for_directly_and_under_bin() {
        let candidates = BundledSource::new("C:/app/resources".into()).candidates();
        assert_eq!(candidates.len(), 2);
        assert!(candidates[0].ends_with(super::EXECUTABLE_NAME));
        assert!(candidates[1].to_string_lossy().contains("bin"));
    }

    #[test]
    fn each_source_declares_its_own_trust_level() {
        use img2sketch_core::domain::FfmpegSource;
        assert_eq!(
            BundledSource::new("x".into()).source(),
            FfmpegSource::Bundled
        );
        assert_eq!(
            ManagedSource::new("x".into()).source(),
            FfmpegSource::Managed
        );
        assert_eq!(
            KnownDirectorySource::new(vec!["x".into()]).source(),
            FfmpegSource::KnownLocation
        );
    }
}
