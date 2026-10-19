//! Searching for FFmpeg, in order of trust.
//!
//! The locator is the adapter behind [`FfmpegLocator`]. It owns no knowledge of *where* FFmpeg
//! might be — that belongs to the [`CandidateSource`]s it is given — and no knowledge of *how* to
//! ask the machine — that belongs to the [`LocateEnvironment`]. What is left is the search itself:
//! walk the sources in order, take the first candidate that is an executable, ask it what it is,
//! and report.
//!
//! Both collaborators are injected, so the whole thing can be driven against a fictional machine.

use std::path::PathBuf;

use img2sketch_core::application::ports::FfmpegLocator;
use img2sketch_core::domain::FfmpegStatus;

use super::candidates::{
    BundledSource, CandidateSource, ConfiguredSource, KnownDirectorySource, ManagedSource,
    PathSource, WinGetSource,
};
use super::probe::{LocateEnvironment, SystemEnvironment, has_h264_encoder, parse_version};

/// The environment variable a host sets to say where it shipped its FFmpeg.
pub const BUNDLED_DIRECTORY_VARIABLE: &str = "IMG2SKETCH_FFMPEG_DIR";

/// The environment variable holding a path the user chose.
///
/// A stopgap until the host owns that setting: the desktop app will write it, and the CLI can be
/// pointed at a build with it today.
pub const CONFIGURED_VARIABLE: &str = "IMG2SKETCH_FFMPEG";

/// Finds FFmpeg on the machine it is running on.
#[derive(Debug)]
pub struct SystemFfmpegLocator<E: LocateEnvironment = SystemEnvironment> {
    environment: E,
    sources: Vec<Box<dyn CandidateSource>>,
}

impl SystemFfmpegLocator<SystemEnvironment> {
    /// The real machine, searched in the order the README documents.
    #[must_use]
    pub fn from_environment() -> Self {
        let environment = SystemEnvironment;
        let sources = default_sources(&environment);
        Self {
            environment,
            sources,
        }
    }
}

impl<E: LocateEnvironment> SystemFfmpegLocator<E> {
    /// A locator over an explicit list of places to look.
    ///
    /// The order given is the order searched, and the first usable candidate wins — so this is
    /// also how a test states which copy should be preferred.
    #[must_use]
    pub fn with_sources(environment: E, sources: Vec<Box<dyn CandidateSource>>) -> Self {
        Self {
            environment,
            sources,
        }
    }

    /// The machine this locator asks.
    #[must_use]
    pub fn environment(&self) -> &E {
        &self.environment
    }

    /// The places it looks, in order.
    #[must_use]
    pub fn sources(&self) -> &[Box<dyn CandidateSource>] {
        &self.sources
    }
}

impl<E: LocateEnvironment> FfmpegLocator for SystemFfmpegLocator<E> {
    fn probe(&self) -> FfmpegStatus {
        for source in &self.sources {
            for candidate in source.candidates() {
                if !self.environment.is_executable(&candidate) {
                    continue;
                }
                let version = self
                    .environment
                    .run(&candidate, &["-version"])
                    .ok()
                    .and_then(|output| parse_version(&output));
                let encodes_h264 = self
                    .environment
                    .run(&candidate, &["-hide_banner", "-encoders"])
                    .ok()
                    .map(|output| has_h264_encoder(&output));
                return FfmpegStatus::found(candidate, source.source(), version, encodes_h264);
            }
        }
        FfmpegStatus::missing()
    }
}

/// The places the app looks, most trusted first.
///
/// A bundled copy outranks everything because the app shipped and tested it. A copy the app
/// installed for itself outranks the user's own, because it is the one the app can reason about.
/// Somebody's `PATH` outranks a conventional directory, because an explicit choice is a stronger
/// signal than a guess about layout. The registry comes last: it is the most indirect answer
/// available, and last is where an indirect answer belongs.
#[must_use]
pub fn default_sources<E: LocateEnvironment>(environment: &E) -> Vec<Box<dyn CandidateSource>> {
    let mut sources: Vec<Box<dyn CandidateSource>> = Vec::new();

    if let Some(directory) = environment.env_var(BUNDLED_DIRECTORY_VARIABLE) {
        sources.push(Box::new(BundledSource::new(PathBuf::from(directory))));
    }

    if let Some(project_dirs) = directories::ProjectDirs::from("app", "img2sketch", "Img2Sketch") {
        sources.push(Box::new(ManagedSource::new(
            project_dirs.data_dir().join("ffmpeg"),
        )));
    }

    sources.push(Box::new(ConfiguredSource::new(
        environment.env_var(CONFIGURED_VARIABLE).map(PathBuf::from),
    )));

    sources.push(Box::new(PathSource));

    sources.push(Box::new(KnownDirectorySource::new(known_directories(
        environment,
    ))));

    #[cfg(windows)]
    if let Some(local) = environment.env_var("LOCALAPPDATA") {
        sources.push(Box::new(WinGetSource::new(
            PathBuf::from(local)
                .join("Microsoft")
                .join("WinGet")
                .join("Packages"),
        )));
    }

    #[cfg(windows)]
    sources.push(Box::new(super::candidates::RegistrySource));

    sources
}

/// The conventional install directories for this platform.
fn known_directories<E: LocateEnvironment>(environment: &E) -> Vec<PathBuf> {
    let mut directories = Vec::new();

    #[cfg(windows)]
    {
        if let Some(local) = environment.env_var("LOCALAPPDATA") {
            directories.push(
                PathBuf::from(local)
                    .join("Microsoft")
                    .join("WinGet")
                    .join("Links"),
            );
        }
        if let Some(profile) = environment.env_var("USERPROFILE") {
            directories.push(PathBuf::from(profile).join("scoop").join("shims"));
        }
        directories.push(PathBuf::from(r"C:\ProgramData\chocolatey\bin"));
        directories.push(PathBuf::from(r"C:\ffmpeg\bin"));
        if let Some(program_files) = environment.env_var("ProgramFiles") {
            directories.push(PathBuf::from(program_files).join("ffmpeg").join("bin"));
        }
    }

    #[cfg(not(windows))]
    {
        directories.push(PathBuf::from("/opt/homebrew/bin"));
        directories.push(PathBuf::from("/usr/local/bin"));
        directories.push(PathBuf::from("/opt/local/bin"));
        directories.push(PathBuf::from("/usr/bin"));
        directories.push(PathBuf::from("/snap/bin"));
        if let Some(home) = environment.env_var("HOME") {
            directories.push(PathBuf::from(home).join(".local").join("bin"));
        }
    }

    directories
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;
    use std::path::{Path, PathBuf};

    use img2sketch_core::application::ports::FfmpegLocator;
    use img2sketch_core::domain::FfmpegSource;

    use super::{BUNDLED_DIRECTORY_VARIABLE, SystemFfmpegLocator, default_sources};
    use crate::ffmpeg::candidates::{BundledSource, ManagedSource};
    use crate::ffmpeg::probe::LocateEnvironment;

    const VERSION_LINE: &str = "ffmpeg version 9.0.1-full_build-www.gyan.dev Copyright (c) 2000-2025 the FFmpeg developers";
    const WITH_X264: &str = " V....D libx264              libx264 H.264 / AVC (codec h264)\n";
    const WITHOUT_X264: &str = " V....D mpeg4                MPEG-4 part 2 (codec mpeg4)\n";

    /// A machine with exactly the files, variables and answers it is told to have.
    #[derive(Debug, Default)]
    struct FakeEnvironment {
        executables: Vec<PathBuf>,
        variables: HashMap<String, String>,
        version_output: String,
        encoders_output: String,
    }

    impl FakeEnvironment {
        fn with_executables(paths: &[&str]) -> Self {
            Self {
                executables: paths.iter().map(PathBuf::from).collect(),
                version_output: VERSION_LINE.to_string(),
                encoders_output: WITH_X264.to_string(),
                ..Self::default()
            }
        }

        fn with_variable(mut self, name: &str, value: &str) -> Self {
            self.variables.insert(name.to_string(), value.to_string());
            self
        }

        fn without_h264(mut self) -> Self {
            self.encoders_output = WITHOUT_X264.to_string();
            self
        }
    }

    impl LocateEnvironment for FakeEnvironment {
        fn is_executable(&self, path: &Path) -> bool {
            self.executables.iter().any(|known| known == path)
        }

        fn env_var(&self, name: &str) -> Option<String> {
            self.variables
                .get(name)
                .filter(|value| !value.is_empty())
                .cloned()
        }

        fn run(&self, executable: &Path, args: &[&str]) -> Result<String, String> {
            if !self.is_executable(executable) {
                return Err("not executable".to_string());
            }
            if args.contains(&"-encoders") {
                return Ok(self.encoders_output.clone());
            }
            if args.contains(&"-version") {
                return Ok(self.version_output.clone());
            }
            Err(format!("unexpected arguments: {args:?}"))
        }
    }

    #[test]
    fn a_machine_without_ffmpeg_is_a_missing_answer() {
        let locator = SystemFfmpegLocator::with_sources(FakeEnvironment::default(), Vec::new());
        let status = locator.probe();
        assert!(!status.is_available());
        assert_eq!(status.executable(), None);
        assert_eq!(status.summary(), "FFmpeg was not found.");
    }

    #[test]
    fn reports_what_it_found_and_where_it_came_from() {
        let environment = FakeEnvironment::with_executables(&["C:/tools/ffmpeg.exe"]);
        let locator = SystemFfmpegLocator::with_sources(
            environment,
            vec![Box::new(ManagedSource::new("C:/tools".into()))],
        );

        let status = locator.probe();
        assert!(status.is_available());
        assert!(status.can_encode_h264());
        assert_eq!(status.executable(), Some(Path::new("C:/tools/ffmpeg.exe")));
        assert_eq!(status.source(), Some(FfmpegSource::Managed));
        assert_eq!(status.version(), Some("9.0.1"));

        // Asserted by parts: on Windows the joined path is spelled `C:/tools\ffmpeg.exe`, and a
        // test that pinned the separator would be testing the platform rather than the summary.
        let summary = status.summary();
        assert!(summary.starts_with("FFmpeg 9.0.1 at "), "{summary}");
        assert!(summary.contains("tools"), "{summary}");
        assert!(summary.contains("ffmpeg.exe"), "{summary}");
        assert!(summary.ends_with("installed by the app."), "{summary}");
    }

    #[test]
    fn the_first_source_with_a_usable_candidate_wins() {
        let environment = FakeEnvironment::with_executables(&[
            "C:/app/resources/ffmpeg.exe",
            "C:/app-data/ffmpeg/ffmpeg.exe",
        ]);

        let bundled_first = SystemFfmpegLocator::with_sources(
            environment,
            vec![
                Box::new(BundledSource::new("C:/app/resources".into())),
                Box::new(ManagedSource::new("C:/app-data/ffmpeg".into())),
            ],
        );
        assert_eq!(bundled_first.probe().source(), Some(FfmpegSource::Bundled));

        let managed_first = SystemFfmpegLocator::with_sources(
            FakeEnvironment::with_executables(&[
                "C:/app/resources/ffmpeg.exe",
                "C:/app-data/ffmpeg/ffmpeg.exe",
            ]),
            vec![
                Box::new(ManagedSource::new("C:/app-data/ffmpeg".into())),
                Box::new(BundledSource::new("C:/app/resources".into())),
            ],
        );
        assert_eq!(managed_first.probe().source(), Some(FfmpegSource::Managed));
    }

    #[test]
    fn skips_candidates_that_are_not_runnable() {
        let environment = FakeEnvironment::with_executables(&["C:/second/ffmpeg.exe"]);
        let locator = SystemFfmpegLocator::with_sources(
            environment,
            vec![
                Box::new(ManagedSource::new("C:/first".into())),
                Box::new(ManagedSource::new("C:/second".into())),
            ],
        );
        assert_eq!(
            locator.probe().executable(),
            Some(Path::new("C:/second/ffmpeg.exe"))
        );
    }

    #[test]
    fn an_ffmpeg_without_h264_is_found_but_not_usable() {
        let environment =
            FakeEnvironment::with_executables(&["C:/tools/ffmpeg.exe"]).without_h264();
        let locator = SystemFfmpegLocator::with_sources(
            environment,
            vec![Box::new(ManagedSource::new("C:/tools".into()))],
        );

        let status = locator.probe();
        assert!(status.is_available());
        assert!(!status.can_encode_h264());
        assert!(status.summary().contains("no H.264 encoder"));
    }

    #[test]
    fn the_default_search_order_follows_the_declared_trust_order() {
        let environment = FakeEnvironment::default()
            .with_variable(BUNDLED_DIRECTORY_VARIABLE, "C:/app/resources");
        let sources = default_sources(&environment);

        let order: Vec<FfmpegSource> = sources.iter().map(|source| source.source()).collect();
        assert_eq!(order.first(), Some(&FfmpegSource::Bundled));
        assert!(
            order.windows(2).all(|pair| pair[0] <= pair[1]),
            "the search order must not contradict the trust order: {order:?}"
        );
    }
}
