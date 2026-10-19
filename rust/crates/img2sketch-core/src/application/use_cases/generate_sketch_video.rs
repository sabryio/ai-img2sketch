//! Drawing one image into one video.
//!
//! The sequence is the Python engine's, step for step, because the video it produces is the thing
//! being ported:
//!
//! 1. Round the canvas up to the grid, load the hand, preprocess the image.
//! 2. Split the thresholded image into cells and keep the ones with ink.
//! 3. Group the cells (one group when nothing is masked) and decide the skip rate.
//! 4. Walk each group nearest-cell-first, painting one cell at a time, compositing the hand over a
//!    copy, and writing a frame every `skip_rate` cells.
//! 5. Hold the finished colour image for the requested number of frames.
//!
//! Two promises about the end of a run are made by the shape of this code rather than by a check
//! somewhere: a run that succeeds always leaves a playable file (a canvas with nothing to draw
//! still writes a frame), and a run that fails leaves nothing at all — the writer is dropped
//! without being released, which is what tells the encoder to throw its work away.

use std::path::{Path, PathBuf};

use crate::application::ports::{
    GenerationProgress, HandLoadError, HandProvider, ImagePreprocessor, PreprocessError,
    PreprocessedImage, ProgressReporter, VideoWriter, VideoWriterError, VideoWriterFactory,
};
use crate::application::services::{
    DimensionAdjuster, DrawingGroup, DrawingPathCalculator, DrawingPlanner, DrawingSpeedCalculator,
    GridCalculator, HandOverlay,
};
use crate::domain::{
    Cell, DimensionsError, Frame, Grid, GridError, Hand, ObjectMask, VideoConfig, VideoConfigError,
};

/// How much of the bar must move before a report is worth sending.
///
/// One report per frame would flood the event stream without telling the user anything new; a step
/// of the bar is the unit of "the progress moved".
pub const PROGRESS_STEP_PERCENT: u32 = 5;

/// The label the finishing frames are reported under.
const FINAL_LABEL: &str = "final image";

/// Draws an animated sketch from one image.
///
/// The use case owns the sequence and nothing else: which hand, which preprocessor and which
/// encoder are all injected, so the same loop serves the CLI, the HTTP server and a desktop host,
/// and so every step of it can be tested without a file.
#[derive(Debug)]
pub struct GenerateSketchVideo {
    hand: Box<dyn HandProvider>,
    preprocessor: Box<dyn ImagePreprocessor>,
    writers: Box<dyn VideoWriterFactory>,
}

impl GenerateSketchVideo {
    /// Builds the use case from the three things it cannot decide for itself.
    #[must_use]
    pub fn new(
        hand: Box<dyn HandProvider>,
        preprocessor: Box<dyn ImagePreprocessor>,
        writers: Box<dyn VideoWriterFactory>,
    ) -> Self {
        Self {
            hand,
            preprocessor,
            writers,
        }
    }

    /// Writes the sketch video for `image` to `output`.
    ///
    /// The returned path is the file that is on disk when this returns successfully.
    ///
    /// # Errors
    ///
    /// Returns [`GenerateError`] when the configuration is out of range, the hand or the image
    /// cannot be read, or the encoder fails. A failure leaves no output file behind.
    pub fn execute(
        &self,
        image: &Frame,
        config: &VideoConfig,
        output: &Path,
        object_masks: &[ObjectMask],
        progress: Option<&dyn ProgressReporter>,
    ) -> Result<PathBuf, GenerateError> {
        config.validate()?;
        let target = DimensionAdjuster::adjust_to_multiple(image.dimensions(), config.split_len)?;
        let hand = self.hand.load()?;
        let preprocessed = self.preprocessor.preprocess(image, target)?;

        let mut writer = self.writers.open(output, target, config.frame_rate)?;

        let (rows, columns) = GridCalculator::grid_dimensions(target, config.split_len);
        let grid = GridCalculator::split_into_grid(preprocessed.thresholded(), rows, columns)?;
        let black_cells = GridCalculator::find_black_cells(&grid, threshold_of(config));

        // Nothing to draw is not a special case: an empty cell list produces an empty group and
        // the same arithmetic, and the finishing frames still hold the whole image.
        //
        // A target drawing duration decides the skip rate for the whole run, which is what the
        // Python engine does; a per-object speed then overrides it for that group alone. The two
        // are not reconciled, and a run that asks for both gets the per-object speeds.
        let skip_rate = config
            .draw_duration_sec
            .map_or(config.object_skip_rate, |duration| {
                DrawingSpeedCalculator::skip_rate_for_duration(
                    black_cells.len() as u32,
                    duration,
                    config.frame_rate,
                )
            });
        let groups = DrawingPlanner::plan(
            &black_cells,
            object_masks,
            target,
            config.split_len,
            skip_rate,
        );

        let drawing_frames: u64 = groups
            .iter()
            .map(|group| (group.cells().len() as u64) / u64::from(group.skip_rate()))
            .sum();
        let mut counter = progress.map(|reporter| {
            DrawProgress::new(reporter, drawing_frames + final_frame_count(config))
        });

        let mut drawn_frame = Frame::filled(target, [255, 255, 255]);
        let mut drawn_frames = 0u64;
        for group in &groups {
            if group.cells().is_empty() {
                continue;
            }
            drawn_frames += draw_group(
                &mut *writer,
                &mut drawn_frame,
                &hand,
                &grid,
                group,
                config.split_len,
                &mut counter,
            )?;
        }

        add_final_frames(
            &mut *writer,
            &preprocessed,
            config,
            &mut counter,
            drawn_frames == 0,
        )?;

        Ok(writer.release()?)
    }
}

/// Why a sketch video could not be written.
#[derive(Debug, thiserror::Error)]
pub enum GenerateError {
    /// The settings were out of range.
    #[error(transparent)]
    Config(#[from] VideoConfigError),
    /// The canvas could not be rounded onto the grid.
    #[error(transparent)]
    Dimensions(#[from] DimensionsError),
    /// The drawing hand could not be loaded.
    #[error(transparent)]
    Hand(#[from] HandLoadError),
    /// The image could not be prepared for drawing.
    #[error(transparent)]
    Preprocess(#[from] PreprocessError),
    /// The thresholded image does not divide into the cells it was asked for.
    #[error(transparent)]
    Grid(#[from] GridError),
    /// The encoder failed.
    #[error(transparent)]
    Writer(#[from] VideoWriterError),
}

/// How many frames show the finished image, after the drawing.
fn final_frame_count(config: &VideoConfig) -> u64 {
    u64::from(config.frame_rate) * u64::from(config.end_duration_sec)
}

/// The darkness below which a pixel counts as ink.
///
/// The configuration is validated to `0..=255` before it gets here; the clamp keeps this total
/// rather than letting an out-of-range number truncate into a different threshold.
fn threshold_of(config: &VideoConfig) -> u8 {
    config.black_pixel_threshold.min(255) as u8
}

/// Draws every cell of one group, returning how many frames were written.
fn draw_group(
    writer: &mut dyn VideoWriter,
    drawn_frame: &mut Frame,
    hand: &Hand,
    grid: &Grid,
    group: &DrawingGroup,
    split_len: u32,
    progress: &mut Option<DrawProgress<'_>>,
) -> Result<u64, VideoWriterError> {
    let mut cells: Vec<Cell> = group.cells().to_vec();
    let mut selected = 0usize;
    let mut cells_drawn = 0u64;
    let mut frames_written = 0u64;

    while !cells.is_empty() {
        let current = cells[selected];

        render_cell(drawn_frame, grid, current, split_len);

        let (hand_x, hand_y) =
            HandOverlay::position(current.left(split_len), current.top(split_len), split_len);
        let mut frame_with_hand = drawn_frame.clone();
        HandOverlay::overlay(&mut frame_with_hand, hand, hand_x, hand_y);

        // The current cell is done with: swap it out with the last one, so removing it is O(1)
        // and the visit order stays nearest-first over what is left.
        let last = cells.len() - 1;
        cells[selected] = cells[last];
        cells.truncate(last);

        cells_drawn += 1;
        if cells_drawn.is_multiple_of(u64::from(group.skip_rate())) {
            writer.write_frame(&frame_with_hand)?;
            frames_written += 1;
            if let Some(counter) = progress {
                counter.frame_written(group.label());
            }
        }

        if !cells.is_empty()
            && let Some(index) = DrawingPathCalculator::nearest_index(&cells, current)
        {
            selected = index;
        }
    }

    Ok(frames_written)
}

/// Copies one cell of the thresholded image into the drawn frame, in all three channels.
fn render_cell(frame: &mut Frame, grid: &Grid, cell: Cell, split_len: u32) {
    let width = frame.dimensions().width() as usize;
    let top = cell.top(split_len) as usize;
    let left = cell.left(split_len) as usize;
    let pixels = frame.rgb_mut();

    for (offset, row) in grid.cell_rows(cell).enumerate() {
        let y = top + offset;
        for (step, value) in row.iter().enumerate() {
            let x = left + step;
            let index = (y * width + x) * 3;
            if index + 2 < pixels.len() {
                pixels[index] = *value;
                pixels[index + 1] = *value;
                pixels[index + 2] = *value;
            }
        }
    }
}

/// Writes the frames that hold the finished colour image.
fn add_final_frames(
    writer: &mut dyn VideoWriter,
    preprocessed: &PreprocessedImage,
    config: &VideoConfig,
    progress: &mut Option<DrawProgress<'_>>,
    at_least_one: bool,
) -> Result<(), VideoWriterError> {
    // A video holds at least one frame. When every group was smaller than its skip rate and no
    // final frames were asked for, the drawing wrote nothing, and a run that reports success with
    // no frame in it is not a result.
    let mut frames = final_frame_count(config);
    if at_least_one && frames == 0 {
        frames = 1;
    }

    for _ in 0..frames {
        writer.write_frame(preprocessed.original())?;
        if let Some(counter) = progress {
            counter.frame_written(FINAL_LABEL);
        }
    }
    Ok(())
}

/// Turns written frames into throttled, monotonic percentages.
#[derive(Debug)]
struct DrawProgress<'a> {
    reporter: &'a dyn ProgressReporter,
    total: u64,
    frame: u64,
    reported: u32,
}

impl<'a> DrawProgress<'a> {
    fn new(reporter: &'a dyn ProgressReporter, total: u64) -> Self {
        Self {
            reporter,
            total: total.max(1),
            frame: 0,
            reported: 0,
        }
    }

    /// Counts one written frame, reporting it once a whole step has passed — and always at the end.
    fn frame_written(&mut self, label: &str) {
        self.frame += 1;
        let percent = (self.frame * 100 / self.total) as u32;
        let at_end = self.frame >= self.total;
        if !at_end && percent.saturating_sub(self.reported) < PROGRESS_STEP_PERCENT {
            return;
        }

        self.reported = percent;
        self.reporter.report(&GenerationProgress {
            percent,
            frame: self.frame,
            total_frames: self.total,
            label: label.to_string(),
            preview_path: None,
        });
    }
}

#[cfg(test)]
mod tests {
    use std::path::{Path, PathBuf};
    use std::sync::{Arc, Mutex};

    use super::{GenerateError, GenerateSketchVideo};
    use crate::application::ports::{
        GenerationProgress, HandLoadError, HandProvider, ImagePreprocessor, PreprocessError,
        PreprocessedImage, ProgressReporter, VideoWriter, VideoWriterError, VideoWriterFactory,
    };
    use crate::domain::{Dimensions, Frame, GrayImage, Hand, VideoConfig};

    // --- the three collaborators, each a recording fake ------------------------------------

    #[derive(Debug)]
    struct FixedHand(Hand);

    impl HandProvider for FixedHand {
        fn load(&self) -> Result<Hand, HandLoadError> {
            Ok(self.0.clone())
        }
    }

    #[derive(Debug)]
    struct FixedPreprocessor {
        finished: [u8; 3],
        ink: Vec<(u32, u32)>,
        seen_target: Arc<Mutex<Option<Dimensions>>>,
    }

    impl ImagePreprocessor for FixedPreprocessor {
        fn preprocess(
            &self,
            _image: &Frame,
            target: Dimensions,
        ) -> Result<PreprocessedImage, PreprocessError> {
            *self.seen_target.lock().unwrap() = Some(target);
            Ok(PreprocessedImage::new(
                Frame::filled(target, self.finished),
                GrayImage::filled(target, 0),
                thresholded(target, &self.ink),
                target,
            ))
        }
    }

    #[derive(Debug, Default)]
    struct RecordingState {
        opened: Mutex<Vec<(PathBuf, Dimensions, u32)>>,
        frames: Mutex<Vec<Frame>>,
        released: Mutex<Vec<PathBuf>>,
    }

    #[derive(Debug, Clone, Default)]
    struct RecordingFactory {
        state: Arc<RecordingState>,
    }

    #[derive(Debug)]
    struct RecordingWriter {
        state: Arc<RecordingState>,
        output: PathBuf,
        dimensions: Dimensions,
    }

    impl VideoWriter for RecordingWriter {
        fn write_frame(&mut self, frame: &Frame) -> Result<(), VideoWriterError> {
            if frame.dimensions() != self.dimensions {
                return Err(VideoWriterError::FrameSize {
                    expected_width: self.dimensions.width(),
                    expected_height: self.dimensions.height(),
                    actual_width: frame.width(),
                    actual_height: frame.height(),
                });
            }
            self.state.frames.lock().unwrap().push(frame.clone());
            Ok(())
        }

        fn release(self: Box<Self>) -> Result<PathBuf, VideoWriterError> {
            self.state
                .released
                .lock()
                .unwrap()
                .push(self.output.clone());
            Ok(self.output)
        }
    }

    impl VideoWriterFactory for RecordingFactory {
        fn open(
            &self,
            output: &Path,
            dimensions: Dimensions,
            frame_rate: u32,
        ) -> Result<Box<dyn VideoWriter>, VideoWriterError> {
            self.state
                .opened
                .lock()
                .unwrap()
                .push((output.to_path_buf(), dimensions, frame_rate));
            Ok(Box::new(RecordingWriter {
                state: Arc::clone(&self.state),
                output: output.to_path_buf(),
                dimensions,
            }))
        }
    }

    #[derive(Debug, Default)]
    struct CollectingProgress {
        reports: Mutex<Vec<GenerationProgress>>,
    }

    impl ProgressReporter for CollectingProgress {
        fn report(&self, progress: &GenerationProgress) {
            self.reports.lock().unwrap().push(progress.clone());
        }
    }

    // --- fixtures --------------------------------------------------------------------------

    fn canvas(width: u32, height: u32) -> Dimensions {
        Dimensions::new(width, height).unwrap()
    }

    /// A one-pixel hand; `mask` of 1.0 is fully transparent, 0.0 fully opaque.
    fn hand(mask: f64) -> Hand {
        Hand::new(Frame::filled(canvas(1, 1), [9, 9, 9]), vec![mask]).unwrap()
    }

    /// A white canvas with black pixels at the given coordinates.
    fn thresholded(dimensions: Dimensions, ink: &[(u32, u32)]) -> GrayImage {
        let mut image = GrayImage::filled(dimensions, 255);
        let width = dimensions.width();
        for (x, y) in ink {
            image.pixels_mut()[(*y * width + *x) as usize] = 0;
        }
        image
    }

    fn config(
        split_len: u32,
        frame_rate: u32,
        object_skip_rate: u32,
        end_duration_sec: u32,
    ) -> VideoConfig {
        VideoConfig {
            split_len,
            frame_rate,
            object_skip_rate,
            end_duration_sec,
            ..VideoConfig::default()
        }
    }

    struct Rig {
        use_case: GenerateSketchVideo,
        state: Arc<RecordingState>,
        target: Arc<Mutex<Option<Dimensions>>>,
    }

    /// A run over a canvas whose adjusted size is `width` × `height`, with ink at `ink` (in canvas
    /// coordinates) and a finished image of solid `finished`, drawn with a one-pixel hand.
    fn rig(
        _width: u32,
        _height: u32,
        ink: &[(u32, u32)],
        finished: [u8; 3],
        hand_mask: f64,
    ) -> Rig {
        let state = Arc::new(RecordingState::default());
        let target = Arc::new(Mutex::new(None));
        let use_case = GenerateSketchVideo::new(
            Box::new(FixedHand(hand(hand_mask))),
            Box::new(FixedPreprocessor {
                finished,
                ink: ink.to_vec(),
                seen_target: Arc::clone(&target),
            }),
            Box::new(RecordingFactory {
                state: Arc::clone(&state),
            }),
        );
        Rig {
            use_case,
            state,
            target,
        }
    }

    fn frames(rig: &Rig) -> Vec<Frame> {
        rig.state.frames.lock().unwrap().clone()
    }

    #[test]
    fn paints_the_inked_cells_and_then_holds_the_finished_image() {
        let rig = rig(10, 10, &[(0, 0)], [1, 2, 3], 1.0);
        let config = config(10, 10, 1, 1);
        let output = Path::new("out/sketch.mp4");

        let produced = rig
            .use_case
            .execute(
                &Frame::filled(canvas(10, 10), [0, 0, 0]),
                &config,
                output,
                &[],
                None,
            )
            .unwrap();

        assert_eq!(produced, output);
        assert_eq!(*rig.state.released.lock().unwrap(), vec![output]);
        assert_eq!(
            *rig.state.opened.lock().unwrap(),
            vec![(output.to_path_buf(), canvas(10, 10), 10)]
        );
        assert_eq!(
            *rig.target.lock().unwrap(),
            Some(canvas(10, 10)),
            "the preprocessor is given the adjusted canvas"
        );

        let frames = frames(&rig);
        assert_eq!(
            frames.len(),
            1 + 10,
            "one drawn frame, then a second of final"
        );
        // The drawn frame is the thresholded cell: white except the inked pixel.
        assert_eq!(&frames[0].rgb()[..3], &[0, 0, 0]);
        assert_eq!(&frames[0].rgb()[3..6], &[255, 255, 255]);
        assert!(
            frames[1..]
                .iter()
                .all(|frame| frame.rgb() == [1, 2, 3].repeat(100).as_slice())
        );
    }

    #[test]
    fn rounds_the_canvas_on_the_grid_before_drawing() {
        let rig = rig(25, 25, &[(0, 0)], [0, 0, 0], 1.0);
        rig.use_case
            .execute(
                &Frame::filled(canvas(25, 25), [0, 0, 0]),
                &config(10, 25, 8, 0),
                Path::new("out.mp4"),
                &[],
                None,
            )
            .unwrap();

        assert_eq!(*rig.target.lock().unwrap(), Some(canvas(20, 20)));
        assert_eq!(rig.state.opened.lock().unwrap()[0].1, canvas(20, 20));
    }

    #[test]
    fn the_hand_is_composited_over_the_drawn_cell() {
        // A transparent hand leaves the drawn frame untouched; an opaque one replaces the pixel
        // its 1×1 body covers, which for one cell is the cell's centre.
        let rig = rig(10, 10, &[(0, 0)], [0, 0, 0], 0.0);
        rig.use_case
            .execute(
                &Frame::filled(canvas(10, 10), [0, 0, 0]),
                &config(10, 10, 1, 0),
                Path::new("out.mp4"),
                &[],
                None,
            )
            .unwrap();

        let frames = frames(&rig);
        let centre = (5 * 10 + 5) * 3;
        assert_eq!(&frames[0].rgb()[centre..centre + 3], &[9, 9, 9]);
        assert_eq!(&frames[0].rgb()[..3], &[0, 0, 0], "the ink is still there");
    }

    #[test]
    fn a_blank_canvas_still_produces_one_playable_frame() {
        let rig = rig(10, 10, &[], [4, 5, 6], 1.0);
        rig.use_case
            .execute(
                &Frame::filled(canvas(10, 10), [0, 0, 0]),
                &config(10, 10, 1, 0),
                Path::new("out.mp4"),
                &[],
                None,
            )
            .unwrap();

        let frames = frames(&rig);
        assert_eq!(frames.len(), 1);
        assert_eq!(frames[0].rgb(), [4, 5, 6].repeat(100).as_slice());
    }

    #[test]
    fn a_cell_smaller_than_its_skip_rate_still_produces_a_frame() {
        let rig = rig(10, 10, &[(0, 0)], [7, 7, 7], 1.0);
        // One cell, a skip rate of five: the drawing writes nothing at all.
        rig.use_case
            .execute(
                &Frame::filled(canvas(10, 10), [0, 0, 0]),
                &config(10, 10, 5, 0),
                Path::new("out.mp4"),
                &[],
                None,
            )
            .unwrap();

        let frames = frames(&rig);
        assert_eq!(frames.len(), 1);
        assert_eq!(frames[0].rgb(), [7, 7, 7].repeat(100).as_slice());
    }

    #[test]
    fn progress_moves_in_steps_and_reaches_a_hundred() {
        // A 10x10 grid of cells, every one inked, drawn one cell per frame: 100 frames, so one
        // percent per frame and the five-percent throttle is exercised.
        let ink: Vec<(u32, u32)> = (0..10)
            .flat_map(|y| (0..10).map(move |x| (x * 10, y * 10)))
            .collect();
        let rig = rig(100, 100, &ink, [0, 0, 0], 1.0);
        let progress = CollectingProgress::default();

        rig.use_case
            .execute(
                &Frame::filled(canvas(100, 100), [0, 0, 0]),
                &config(10, 10, 1, 0),
                Path::new("out.mp4"),
                &[],
                Some(&progress),
            )
            .unwrap();

        let reports = progress.reports.lock().unwrap();
        let percents: Vec<u32> = reports.iter().map(|report| report.percent).collect();
        assert_eq!(
            percents,
            (1..=20).map(|step| step * 5).collect::<Vec<u32>>()
        );
        assert_eq!(reports.last().unwrap().percent, 100);
        assert_eq!(reports.last().unwrap().total_frames, 100);
        assert_eq!(reports.last().unwrap().frame, 100);
        assert!(
            reports.iter().all(|report| report.label == "image"),
            "one group, one label"
        );
        assert!(
            percents.windows(2).all(|pair| pair[0] < pair[1]),
            "progress never goes backwards"
        );
    }

    #[test]
    fn the_finishing_frames_are_reported_under_their_own_label() {
        let rig = rig(10, 10, &[(0, 0)], [0, 0, 0], 1.0);
        let progress = CollectingProgress::default();
        // Two drawn cells would be one frame each, but one cell at a skip of one is one frame;
        // the two final frames then push the total to three and the run to 100%.
        rig.use_case
            .execute(
                &Frame::filled(canvas(10, 10), [0, 0, 0]),
                &config(10, 10, 1, 1),
                Path::new("out.mp4"),
                &[],
                Some(&progress),
            )
            .unwrap();

        let reports = progress.reports.lock().unwrap();
        assert_eq!(reports.last().unwrap().label, "final image");
        assert_eq!(reports.last().unwrap().percent, 100);
    }

    #[test]
    fn an_out_of_range_setting_is_refused_before_the_encoder_opens() {
        let rig = rig(10, 10, &[(0, 0)], [0, 0, 0], 1.0);
        let error = rig
            .use_case
            .execute(
                &Frame::filled(canvas(10, 10), [0, 0, 0]),
                &config(4, 25, 8, 0),
                Path::new("out.mp4"),
                &[],
                None,
            )
            .unwrap_err();

        assert!(matches!(error, GenerateError::Config(_)));
        assert!(rig.state.opened.lock().unwrap().is_empty());
        assert!(rig.state.released.lock().unwrap().is_empty());
    }

    #[test]
    fn object_masks_are_drawn_in_their_own_groups() {
        use crate::domain::{ObjectMask, Region};

        let rig = rig(20, 10, &[(0, 0), (10, 0)], [0, 0, 0], 1.0);
        let dimensions = canvas(20, 10);
        let mut region = vec![false; dimensions.pixel_count() as usize];
        for y in 0..10u32 {
            for x in 0..10u32 {
                region[(y * 20 + x) as usize] = true;
            }
        }
        let subject = ObjectMask::new(
            "subject",
            Some(Region::new(dimensions, region).unwrap()),
            None,
        )
        .unwrap();
        let masks: Vec<ObjectMask> = vec![subject];

        rig.use_case
            .execute(
                &Frame::filled(dimensions, [0, 0, 0]),
                &config(10, 25, 1, 0),
                Path::new("out.mp4"),
                &masks,
                None,
            )
            .unwrap();

        assert_eq!(frames(&rig).len(), 2, "one frame per group");
    }
}
