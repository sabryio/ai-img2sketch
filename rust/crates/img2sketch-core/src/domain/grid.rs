//! The drawing grid: an image divided into equal square cells.
//!
//! The drawing never touches a pixel of the source directly. It works cell by cell, because a cell
//! is what one stroke of the pen covers, and everything downstream — which cells are inked, which
//! order they are drawn in, how many frames the drawing takes — is counted in cells.
//!
//! A [`Grid`] is therefore not a copy of the image; it is a way of asking for one cell of it. The
//! cells are uniform only because [`DimensionAdjuster`](crate::application::services::DimensionAdjuster)
//! rounded both sides to a multiple of the split length first, and the constructor refuses a grid
//! that would leave a partial cell behind rather than quietly drawing a rectangle.

use super::dimensions::Dimensions;
use super::gray_image::GrayImage;

/// One cell of the grid: a row and a column, not a pixel.
///
/// `row` and `column` are in cell units, so the pixel a cell starts at is `row * split_len`. The
/// pair is `(vertical, horizontal)` in the order the Python engine uses, which is why a cell
/// literal reads `row, column` everywhere.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub struct Cell {
    /// How far down the grid the cell sits.
    pub row: u32,
    /// How far across the grid the cell sits.
    pub column: u32,
}

impl Cell {
    /// A cell at a row and a column.
    #[must_use]
    pub const fn new(row: u32, column: u32) -> Self {
        Self { row, column }
    }

    /// The first pixel row this cell covers.
    #[must_use]
    pub const fn top(self, split_len: u32) -> u32 {
        self.row * split_len
    }

    /// The first pixel column this cell covers.
    #[must_use]
    pub const fn left(self, split_len: u32) -> u32 {
        self.column * split_len
    }
}

/// An image divided into `rows` × `columns` equal cells.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Grid {
    rows: u32,
    columns: u32,
    cell_size: u32,
    dimensions: Dimensions,
    pixels: Vec<u8>,
}

/// Why an image could not become a grid.
#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum GridError {
    /// The image does not divide evenly, so some cells would be partial.
    #[error(
        "a {width}x{height} image cannot be split into {columns}x{rows} equal cells: {width} is not \
         {columns} cells of equal width and {height} is not {rows} of equal height"
    )]
    NotDivisible {
        /// The image's width.
        width: u32,
        /// The image's height.
        height: u32,
        /// How many rows were asked for.
        rows: u32,
        /// How many columns were asked for.
        columns: u32,
    },
    /// A grid needs at least one row, one column and one pixel per cell.
    #[error("a grid needs a non-zero row count, column count and cell size")]
    Empty,
}

impl Grid {
    /// Divides an image into equal cells.
    ///
    /// # Errors
    ///
    /// Returns [`GridError::Empty`] if any count is zero, and [`GridError::NotDivisible`] if the
    /// sides are not exactly `rows` and `columns` cells long — or if the cells would not come out
    /// square, which is the same mistake seen from another side.
    pub fn split(image: &GrayImage, rows: u32, columns: u32) -> Result<Self, GridError> {
        if rows == 0 || columns == 0 {
            return Err(GridError::Empty);
        }
        let (width, height) = (image.width(), image.height());
        if !width.is_multiple_of(columns) || !height.is_multiple_of(rows) {
            return Err(GridError::NotDivisible {
                width,
                height,
                rows,
                columns,
            });
        }

        let cell_size = width / columns;
        if cell_size == 0 || cell_size != height / rows {
            return Err(GridError::NotDivisible {
                width,
                height,
                rows,
                columns,
            });
        }

        Ok(Self {
            rows,
            columns,
            cell_size,
            dimensions: image.dimensions(),
            pixels: image.pixels().to_vec(),
        })
    }

    /// How many cells tall the grid is.
    #[must_use]
    pub const fn rows(&self) -> u32 {
        self.rows
    }

    /// How many cells wide the grid is.
    #[must_use]
    pub const fn columns(&self) -> u32 {
        self.columns
    }

    /// How many pixels one side of a cell covers.
    #[must_use]
    pub const fn cell_size(&self) -> u32 {
        self.cell_size
    }

    /// The size the grid's image has.
    #[must_use]
    pub const fn dimensions(&self) -> Dimensions {
        self.dimensions
    }

    /// The rows of one cell, top to bottom, each `cell_size` bytes.
    ///
    /// A cell is a square of the image, so its rows are not contiguous — this walks the image row
    /// by row and yields only the span the cell covers. A cell outside the grid yields nothing
    /// rather than panicking; the constructor is what makes that unreachable in practice.
    pub fn cell_rows(&self, cell: Cell) -> impl Iterator<Item = &[u8]> + '_ {
        let width = self.dimensions.width() as usize;
        let size = self.cell_size as usize;
        let top = (cell.row * self.cell_size) as usize;
        let left = (cell.column * self.cell_size) as usize;
        let pixels = self.pixels.as_slice();

        (0..size).filter_map(move |offset| {
            let start = (top + offset) * width + left;
            pixels.get(start..start + size)
        })
    }

    /// Whether any pixel of one cell is darker than `threshold`.
    ///
    /// This is the question that decides whether a cell is drawn at all: the thresholded image is
    /// black where there is ink, so a cell with no pixel below the threshold has nothing to draw.
    #[must_use]
    pub fn has_pixel_below(&self, cell: Cell, threshold: u8) -> bool {
        self.cell_rows(cell)
            .any(|row| row.iter().any(|pixel| *pixel < threshold))
    }
}

#[cfg(test)]
mod tests {
    use super::{Cell, Grid, GridError};
    use crate::domain::{Dimensions, GrayImage};

    /// A 4x4 image whose value is its own column, so cells are easy to tell apart.
    fn columns_of_four() -> GrayImage {
        let mut pixels = Vec::new();
        for _ in 0..4u8 {
            pixels.extend_from_slice(&[0, 1, 2, 3]);
        }
        GrayImage::new(Dimensions::new(4, 4).unwrap(), pixels).unwrap()
    }

    #[test]
    fn splits_an_image_into_equal_cells() {
        let grid = Grid::split(&columns_of_four(), 2, 2).unwrap();
        assert_eq!(grid.rows(), 2);
        assert_eq!(grid.columns(), 2);
        assert_eq!(grid.cell_size(), 2);
        assert_eq!(grid.dimensions(), Dimensions::new(4, 4).unwrap());

        let top_right = Cell::new(0, 1);
        let rows: Vec<Vec<u8>> = grid.cell_rows(top_right).map(<[u8]>::to_vec).collect();
        assert_eq!(rows, vec![vec![2, 3], vec![2, 3]]);
    }

    #[test]
    fn refuses_an_image_that_does_not_divide_evenly() {
        let image = GrayImage::filled(Dimensions::new(5, 4).unwrap(), 0);
        assert_eq!(
            Grid::split(&image, 2, 2),
            Err(GridError::NotDivisible {
                width: 5,
                height: 4,
                rows: 2,
                columns: 2
            })
        );
    }

    #[test]
    fn refuses_cells_that_would_not_be_square() {
        // 6x4 into 2 rows and 2 columns: 3px wide, 2px tall.
        let image = GrayImage::filled(Dimensions::new(6, 4).unwrap(), 0);
        assert!(Grid::split(&image, 2, 2).is_err());
    }

    #[test]
    fn refuses_an_empty_grid() {
        let image = GrayImage::filled(Dimensions::new(4, 4).unwrap(), 0);
        assert_eq!(Grid::split(&image, 0, 2), Err(GridError::Empty));
        assert_eq!(Grid::split(&image, 2, 0), Err(GridError::Empty));
    }

    #[test]
    fn finds_cells_with_ink_in_them() {
        let mut image = GrayImage::filled(Dimensions::new(4, 4).unwrap(), 255);
        // One black pixel in the bottom-left cell.
        image.pixels_mut()[2 * 4] = 0;
        let grid = Grid::split(&image, 2, 2).unwrap();

        assert!(grid.has_pixel_below(Cell::new(1, 0), 10));
        assert!(!grid.has_pixel_below(Cell::new(0, 0), 10));
        assert!(!grid.has_pixel_below(Cell::new(1, 1), 10));
    }

    #[test]
    fn a_cell_outside_the_grid_yields_nothing() {
        let grid = Grid::split(&columns_of_four(), 2, 2).unwrap();
        assert_eq!(grid.cell_rows(Cell::new(9, 9)).count(), 0);
    }
}
