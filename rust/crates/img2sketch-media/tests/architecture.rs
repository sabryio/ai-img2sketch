//! Adapters stay adapters.
//!
//! The other half of the rule that `img2sketch-core`'s test enforces: if the pure crate may not
//! know about the outside world, then the crate that does know about it may not know about the
//! surfaces above it. An adapter that imports `axum` has started making HTTP decisions, and an
//! adapter that imports `clap` has started making product decisions.

#![allow(clippy::unwrap_used, clippy::expect_used)]

use std::fs;
use std::path::Path;

/// Crates this crate may never depend on, because they are surfaces, not edges.
const FORBIDDEN_DEPENDENCIES: &[&str] = &["axum", "clap", "tower", "tower-http", "tokio"];

#[test]
fn does_not_depend_on_a_presentation_crate() {
    let path = Path::new(env!("CARGO_MANIFEST_DIR")).join("Cargo.toml");
    let manifest = fs::read_to_string(&path).unwrap();
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
            "img2sketch-media must not depend on `{forbidden}`: it is an adapter, and adapters do \
             not know which surface is calling them"
        );
    }

    assert!(
        dependencies.contains("img2sketch-core"),
        "the adapter crate exists to implement img2sketch-core's ports"
    );
}
