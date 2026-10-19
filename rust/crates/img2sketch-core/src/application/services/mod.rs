//! The rules the drawing is made of, as small and testable units.
//!
//! Each module is a port of its Python counterpart — [`application/services`] in
//! `src/ai_img2sketch` — and is a port rather than a reinvention wherever the answer is visible in
//! the output. A different rounding here reshapes every video, and it would do so invisibly.
//!
//! | Service | What it decides |
//! |---|---|
//! | [`dimension_adjuster`] | How a source image is fitted onto the drawing grid |
//! | [`grid_calculator`] | How the canvas splits into cells, and which have ink |
//! | [`drawing_path`] | Which cell is drawn next |
//! | [`drawing_planner`] | The order and speed of the drawing groups |
//! | [`drawing_speed`] | How many cells to skip to hit a target duration |
//! | [`hand_overlay`] | Where the hand sits, and how it is composited |
//! | [`video_path_resolver`] | Where the finished video is written |
//!
//! Every one of them is pure arithmetic over value objects, which is why they were worth porting
//! first: they can be tested exhaustively without a file, a codec or a clock.

pub mod dimension_adjuster;
pub mod drawing_path;
pub mod drawing_planner;
pub mod drawing_speed;
pub mod grid_calculator;
pub mod hand_overlay;
pub mod video_path_resolver;

pub use dimension_adjuster::DimensionAdjuster;
pub use drawing_path::DrawingPathCalculator;
pub use drawing_planner::{BACKGROUND_LABEL, DrawingGroup, DrawingPlanner, IMAGE_LABEL};
pub use drawing_speed::DrawingSpeedCalculator;
pub use grid_calculator::GridCalculator;
pub use hand_overlay::HandOverlay;
pub use video_path_resolver::VideoPathResolver;
