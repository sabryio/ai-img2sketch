//! The pure crate stays pure.
//!
//! An architecture rule that is only written down is a rule that decays. These tests read this
//! crate's own manifest and sources and fail the build when the dependency direction is broken —
//! a compile-time fence around the layer that everything else is allowed to trust.
//!
//! They are deliberately crude: a substring scan over `src/`, not a parser. It costs nothing to
//! run and it catches the mistake that actually happens — someone reaching for `std::fs` or
//! `tokio::` "just this once".

#![allow(clippy::unwrap_used, clippy::expect_used)]

use std::fs;
use std::path::{Path, PathBuf};

/// Crates this crate may never depend on.
const FORBIDDEN_DEPENDENCIES: &[&str] = &[
    "axum",
    "clap",
    "ffmpeg-next",
    "image",
    "tokio",
    "tower",
    "which",
    "winreg",
];

/// Calls this crate may never make, because they reach out of the process.
const FORBIDDEN_SOURCE_PATTERNS: &[&str] = &[
    "std::fs",
    "std::net",
    "std::process",
    "std::env",
    "std::thread",
    "std::time::Instant",
    "tokio::",
];

fn manifest() -> String {
    let path = Path::new(env!("CARGO_MANIFEST_DIR")).join("Cargo.toml");
    fs::read_to_string(&path)
        .unwrap_or_else(|error| panic!("cannot read {}: {error}", path.display()))
}

fn source_files(directory: &Path, found: &mut Vec<PathBuf>) {
    for entry in fs::read_dir(directory)
        .unwrap_or_else(|error| panic!("cannot list {}: {error}", directory.display()))
    {
        let path = entry.unwrap().path();
        if path.is_dir() {
            source_files(&path, found);
        } else if path.extension().is_some_and(|extension| extension == "rs") {
            found.push(path);
        }
    }
}

#[test]
fn depends_only_on_the_pure_set() {
    let manifest = manifest();
    // Everything before the first `[dev-dependencies]` or `[features]` table is the real
    // dependency list.
    let dependencies = manifest
        .split("[dev-dependencies]")
        .next()
        .unwrap()
        .split("[features]")
        .next()
        .unwrap();

    for forbidden in FORBIDDEN_DEPENDENCIES {
        assert!(
            !dependencies.contains(forbidden),
            "img2sketch-core must not depend on `{forbidden}`: I/O and presentation belong in \
             img2sketch-media or a presentation crate"
        );
    }
    assert!(dependencies.contains("thiserror"));
    assert!(dependencies.contains("serde"));
}

#[test]
fn sources_do_not_reach_out_of_the_process() {
    let mut files = Vec::new();
    source_files(
        &Path::new(env!("CARGO_MANIFEST_DIR")).join("src"),
        &mut files,
    );
    assert!(!files.is_empty(), "expected to find sources to check");

    for file in files {
        let source = fs::read_to_string(&file).unwrap();
        // The test module of a value object may use `std::time` freely; only non-test code is
        // constrained, and the simplest approximation is to check the whole file but allow the
        // patterns that only tests use.
        for pattern in FORBIDDEN_SOURCE_PATTERNS {
            assert!(
                !source.contains(pattern),
                "{} uses `{pattern}`: that belongs behind a port in img2sketch-core",
                file.display()
            );
        }
    }
}
