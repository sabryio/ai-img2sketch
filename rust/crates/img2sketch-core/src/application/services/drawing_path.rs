//! Choosing the next cell to draw.
//!
//! The drawing visits cells nearest-first: after inking one, the next is the unvisited cell whose
//! centre is closest, which keeps the pen from jumping across the canvas and reads as a hand
//! working an area rather than a machine filling in pixels.
//!
//! Distance is measured between cell centres — but because every cell is the same size, measuring
//! between cell indices gives the same ordering, and that is what both engines do.

use crate::domain::Cell;

/// Nearest-neighbour ordering over grid cells.
#[derive(Debug, Clone, Copy, Default)]
pub struct DrawingPathCalculator;

impl DrawingPathCalculator {
    /// The straight-line distance between two cells, in cell units.
    #[must_use]
    pub fn euclidean_distance(source: Cell, target: Cell) -> f64 {
        let row = f64::from(source.row) - f64::from(target.row);
        let column = f64::from(source.column) - f64::from(target.column);
        (row * row + column * column).sqrt()
    }

    /// The index of the cell nearest `target`, or `None` when there is nothing left to visit.
    ///
    /// Ties go to the earlier cell, which is what `numpy.argmin` does and what keeps two runs of
    /// the same image identical.
    #[must_use]
    pub fn nearest_index(cells: &[Cell], target: Cell) -> Option<usize> {
        let mut best: Option<(usize, f64)> = None;
        for (index, cell) in cells.iter().enumerate() {
            let distance = Self::euclidean_distance(*cell, target);
            if best.is_none_or(|(_, nearest)| distance < nearest) {
                best = Some((index, distance));
            }
        }
        best.map(|(index, _)| index)
    }
}

#[cfg(test)]
mod tests {
    use super::DrawingPathCalculator;
    use crate::domain::Cell;

    #[test]
    fn counts_steps_between_cells() {
        let origin = Cell::new(0, 0);
        assert_eq!(
            DrawingPathCalculator::euclidean_distance(origin, Cell::new(3, 4)),
            5.0
        );
        assert_eq!(
            DrawingPathCalculator::euclidean_distance(origin, origin),
            0.0
        );
    }

    #[test]
    fn picks_the_nearest_cell() {
        let cells = vec![
            Cell::new(0, 0),
            Cell::new(0, 5),
            Cell::new(5, 5),
            Cell::new(0, 2),
        ];
        assert_eq!(
            DrawingPathCalculator::nearest_index(&cells, Cell::new(0, 0)),
            Some(0)
        );
        assert_eq!(
            DrawingPathCalculator::nearest_index(&cells, Cell::new(1, 4)),
            Some(1)
        );
        assert_eq!(
            DrawingPathCalculator::nearest_index(&cells, Cell::new(4, 5)),
            Some(2)
        );
    }

    #[test]
    fn a_tie_goes_to_the_earlier_cell() {
        let cells = vec![Cell::new(0, 0), Cell::new(0, 2)];
        assert_eq!(
            DrawingPathCalculator::nearest_index(&cells, Cell::new(0, 1)),
            Some(0)
        );
    }

    #[test]
    fn an_empty_list_has_no_nearest_cell() {
        assert_eq!(
            DrawingPathCalculator::nearest_index(&[], Cell::new(0, 0)),
            None
        );
    }
}
