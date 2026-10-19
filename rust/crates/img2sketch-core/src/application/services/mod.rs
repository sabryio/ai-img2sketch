//! The rules the drawing is made of, as small and testable units.
//!
//! These land here as ROADMAP Phase 1 progresses, ported from their Python counterparts, one
//! module each:
//!
//! | Service | What it decides |
//! |---|---|
//! | [`dimension_adjuster`] | How a source image is fitted onto the drawing grid |
//! | `grid_calculator` | How the canvas splits into cells |
//! | `drawing_path_calculator` | Which cells a drawing stroke covers |
//! | `drawing_planner` | The order cells are drawn in |
//! | `drawing_speed_calculator` | How many cells to skip to hit a target duration |
//! | `hand_overlay` | Where the hand sits for a given cell |
//!
//! Every one of them is pure arithmetic over value objects, which is why they are worth porting
//! first: they can be tested exhaustively without a file, a codec or a clock.

pub mod dimension_adjuster;

pub use dimension_adjuster::DimensionAdjuster;
