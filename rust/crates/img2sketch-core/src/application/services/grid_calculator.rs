//! Dividing the canvas into cells, and finding the ones with ink in them.
//!
//! This is the same arithmetic as `application/services/drawing_calculator.py`, and it is a port
//! rather than an improvement because the grid is the unit every later decision is counted in: a
//! different cell count changes which cells are drawn, how long the drawing takes and how many
//! frames come out.

use crate::domain::{Cell, Dimensions, GrayImage, Grid, GridError};

/// Grid arithmetic over a size and a split length.
#[derive(Debug, Clone, Copy, Default)]
pub struct GridCalculator;

impl GridCalculator {
    /// How many cells tall and wide the canvas is.
    ///
    /// A split length of zero is refused by [`VideoConfig`](crate::domain::VideoConfig); it is
    /// treated as one here so this function stays total instead of panicking on a value the rest
    /// of the engine cannot produce.
    #[must_use]
    pub fn grid_dimensions(dimensions: Dimensions, split_len: u32) -> (u32, u32) {
        let split_len = split_len.max(1);
        (
            dimensions.height().div_ceil(split_len),
            dimensions.width().div_ceil(split_len),
        )
    }

    /// Divides a thresholded image into equal cells.
    ///
    /// # Errors
    ///
    /// Returns [`GridError`] when the image does not divide evenly — which the
    /// [`DimensionAdjuster`](crate::application::services::DimensionAdjuster) exists to prevent.
    pub fn split_into_grid(image: &GrayImage, rows: u32, columns: u32) -> Result<Grid, GridError> {
        Grid::split(image, rows, columns)
    }

    /// The cells with at least one pixel darker than `threshold`, in row-major order.
    ///
    /// Order matters: with no object masks the first cell found is the first cell drawn, and that
    /// is what makes two runs of the same image produce the same video.
    #[must_use]
    pub fn find_black_cells(grid: &Grid, threshold: u8) -> Vec<Cell> {
        let mut cells = Vec::new();
        for row in 0..grid.rows() {
            for column in 0..grid.columns() {
                let cell = Cell::new(row, column);
                if grid.has_pixel_below(cell, threshold) {
                    cells.push(cell);
                }
            }
        }
        cells
    }
}

#[cfg(test)]
mod tests {
    use super::GridCalculator;
    use crate::domain::{Cell, Dimensions, GrayImage};

    #[test]
    fn rounds_the_grid_up_to_whole_cells() {
        // The adjuster normally makes both sides divide, but the calculator itself ceilings.
        let (rows, columns) = GridCalculator::grid_dimensions(Dimensions::new(25, 15).unwrap(), 10);
        assert_eq!((rows, columns), (2, 3));
        assert_eq!(
            GridCalculator::grid_dimensions(Dimensions::new(30, 20).unwrap(), 10),
            (2, 3)
        );
    }

    #[test]
    fn a_zero_split_length_does_not_divide_by_zero() {
        assert_eq!(
            GridCalculator::grid_dimensions(Dimensions::new(30, 20).unwrap(), 0),
            (20, 30)
        );
    }

    #[test]
    fn lists_inked_cells_in_reading_order() {
        let mut image = GrayImage::filled(Dimensions::new(30, 20).unwrap(), 255);
        let width = 30usize;
        // Ink in the bottom-right cell and the top-left one, deliberately written out of order.
        image.pixels_mut()[15 * width + 25] = 0;
        image.pixels_mut()[0] = 0;

        let grid = GridCalculator::split_into_grid(&image, 2, 3).unwrap();
        assert_eq!(
            GridCalculator::find_black_cells(&grid, 10),
            vec![Cell::new(0, 0), Cell::new(1, 2)]
        );
    }

    #[test]
    fn a_blank_canvas_has_nothing_to_draw() {
        let image = GrayImage::filled(Dimensions::new(30, 20).unwrap(), 255);
        let grid = GridCalculator::split_into_grid(&image, 2, 3).unwrap();
        assert!(GridCalculator::find_black_cells(&grid, 10).is_empty());
    }

    #[test]
    fn a_threshold_of_zero_never_counts_a_pixel() {
        let image = GrayImage::filled(Dimensions::new(10, 10).unwrap(), 0);
        let grid = GridCalculator::split_into_grid(&image, 1, 1).unwrap();
        // A pixel has to be *below* the threshold, and nothing is below zero.
        assert!(GridCalculator::find_black_cells(&grid, 0).is_empty());
    }
}
