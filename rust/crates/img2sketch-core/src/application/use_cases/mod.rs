//! One thing a caller can ask the engine to do.
//!
//! A use case owns the sequence and nothing else: it reads the settings, asks the services what
//! the plan is, drives the ports, and reports progress — but it never touches a file, a socket or
//! a library. That is what lets the same use case serve the CLI, the HTTP server and (later) the
//! desktop host, and what lets every one of them be tested with fakes.
//!
//! These land here in ROADMAP Phase 3:
//!
//! - `generate_sketch_video` — one image, one video.
//! - `generate_batch_videos` — a folder of images, one video each, with per-item results.
//!
//! Each keeps the contract the Python use cases already have: progress is reported through the
//! port, monotonic, throttled; a run that skips every cell still writes one frame, so a success
//! never hands back no file.
