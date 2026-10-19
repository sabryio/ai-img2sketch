//! The CLI surface, as a user experiences it.
//!
//! These run the real binary, because the thing worth testing here is the interface: the flags
//! exist under the names the Python CLI documents, they carry the same defaults, they refuse the
//! same values, and a failure says something a person can act on.

#![allow(clippy::unwrap_used, clippy::expect_used)]

use assert_cmd::Command;
use predicates::prelude::*;

fn img2sketch() -> Command {
    Command::cargo_bin("img2sketch").unwrap()
}

#[test]
fn reports_the_version_of_the_crate() {
    img2sketch()
        .arg("--version")
        .assert()
        .success()
        .stdout(predicate::str::contains(env!("CARGO_PKG_VERSION")));
}

#[test]
fn the_generate_flags_are_the_ones_the_python_cli_documents() {
    let assertion = img2sketch().args(["generate", "--help"]).assert().success();
    let output = String::from_utf8_lossy(&assertion.get_output().stdout).into_owned();

    for flag in [
        "--output",
        "--split-len",
        "--frame-rate",
        "--object-skip-rate",
        "--draw-duration",
        "--end-duration",
        "--hand-image",
        "--hand-mask",
        "--object-masks",
    ] {
        assert!(
            output.contains(flag),
            "the help does not list {flag}:\n{output}"
        );
    }

    // The defaults are printed by clap, and they are the engine's defaults, not a second copy.
    assert!(
        output.contains("[default: 10]"),
        "split length default drifted:\n{output}"
    );
    assert!(
        output.contains("[default: 25]"),
        "frame rate default drifted:\n{output}"
    );
    assert!(
        output.contains("[default: 8]"),
        "skip rate default drifted:\n{output}"
    );
    assert!(
        output.contains("[default: 2]"),
        "end duration default drifted:\n{output}"
    );
}

#[test]
fn a_split_length_outside_the_accepted_range_is_refused() {
    img2sketch()
        .args(["generate", "photo.jpg", "--split-len", "3"])
        .assert()
        .failure()
        .stderr(predicate::str::contains("3"));
}

#[test]
fn a_draw_duration_of_zero_is_refused_by_the_engine() {
    // clap accepts the number; the engine's own range is what refuses it, so the ranges cannot
    // drift apart between surfaces.
    img2sketch()
        .args(["generate", "photo.jpg", "--draw-duration", "0"])
        .assert()
        .failure()
        .stderr(predicate::str::contains("draw duration"));
}

#[test]
fn info_names_the_file_it_cannot_read() {
    img2sketch()
        .args(["info", "definitely-not-here.png"])
        .assert()
        .failure()
        .stderr(predicate::str::contains("definitely-not-here.png"));
}

#[test]
fn doctor_reports_what_this_machine_has() {
    // The answer depends on the machine, so only the shape is asserted: a report that always says
    // whether H.264 is available is the point of the command.
    img2sketch()
        .arg("doctor")
        .assert()
        .stdout(predicate::str::contains("H.264:"));
}
