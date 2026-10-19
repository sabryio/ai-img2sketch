//! Deciding the order the cells are drawn in, and how fast.
//!
//! With no object masks there is one group: every inked cell, drawn at the global skip rate. With
//! masks, each named object gets its own group in the order the masks were written, followed by
//! whatever belonged to nobody.
//!
//! Two things about this are easy to get subtly wrong and are therefore pinned by tests:
//!
//! - **A cell belongs to the object that owns most of it.** A mask edge rarely lands on a cell
//!   boundary, so a cell straddling two objects has to be awarded to one of them, and "most pixels
//!   wins, ties to the earlier mask" is the rule.
//! - **Overlapping masks are resolved by order.** A later mask overwrites an earlier one where they
//!   both claim a pixel, so the last one written wins — which is also the order the groups are
//!   drawn in, and the only reading of two overlapping regions that a user can predict.

use crate::domain::{Cell, Dimensions, ObjectMask};

/// The label the single group carries when nothing was masked.
pub const IMAGE_LABEL: &str = "image";
/// The label the catch-all group carries when masks leave cells unclaimed.
pub const BACKGROUND_LABEL: &str = "background";

/// A set of cells drawn together, at one speed, under one name.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DrawingGroup {
    label: String,
    cells: Vec<Cell>,
    skip_rate: u32,
}

impl DrawingGroup {
    /// A group of cells drawn at one skip rate.
    #[must_use]
    pub fn new(label: impl Into<String>, cells: Vec<Cell>, skip_rate: u32) -> Self {
        Self {
            label: label.into(),
            cells,
            skip_rate,
        }
    }

    /// The name the group reports progress under.
    #[must_use]
    pub fn label(&self) -> &str {
        &self.label
    }

    /// The cells, in the order they will be drawn from.
    #[must_use]
    pub fn cells(&self) -> &[Cell] {
        &self.cells
    }

    /// How many cells are drawn between frames.
    #[must_use]
    pub const fn skip_rate(&self) -> u32 {
        self.skip_rate
    }
}

/// Groups inked cells into the order they are drawn.
#[derive(Debug, Clone, Copy, Default)]
pub struct DrawingPlanner;

impl DrawingPlanner {
    /// The ordered drawing groups for the given cells.
    #[must_use]
    pub fn plan(
        black_cells: &[Cell],
        object_masks: &[ObjectMask],
        dimensions: Dimensions,
        split_len: u32,
        default_skip_rate: u32,
    ) -> Vec<DrawingGroup> {
        if object_masks.is_empty() {
            return vec![DrawingGroup::new(
                IMAGE_LABEL,
                black_cells.to_vec(),
                default_skip_rate,
            )];
        }

        let (object_ids, background_index) = Self::build_object_id_map(object_masks, dimensions);

        let mut buckets: Vec<Vec<Cell>> = vec![Vec::new(); object_masks.len()];
        let mut unclaimed: Vec<Cell> = Vec::new();
        for cell in black_cells {
            let owner = Self::classify_cell(
                *cell,
                &object_ids,
                dimensions,
                split_len,
                object_masks.len(),
            )
            .or(background_index);
            match owner {
                Some(index) => buckets[index].push(*cell),
                None => unclaimed.push(*cell),
            }
        }

        let mut groups = Vec::new();
        for (index, mask) in object_masks.iter().enumerate() {
            let cells = std::mem::take(&mut buckets[index]);
            if !cells.is_empty() {
                groups.push(DrawingGroup::new(
                    mask.name(),
                    cells,
                    mask.skip_rate().unwrap_or(default_skip_rate),
                ));
            }
        }
        if !unclaimed.is_empty() {
            groups.push(DrawingGroup::new(
                BACKGROUND_LABEL,
                unclaimed,
                default_skip_rate,
            ));
        }
        groups
    }

    /// A per-pixel owner for every pixel, and the index of the catch-all mask if there is one.
    ///
    /// Masks are applied in order, so a later mask wins where they overlap.
    fn build_object_id_map(
        object_masks: &[ObjectMask],
        dimensions: Dimensions,
    ) -> (Vec<i64>, Option<usize>) {
        let mut object_ids = vec![-1i64; dimensions.pixel_count() as usize];
        let mut background_index = None;

        for (index, mask) in object_masks.iter().enumerate() {
            let Some(region) = mask.region() else {
                background_index = Some(index);
                continue;
            };
            let width = dimensions.width().min(region.dimensions().width());
            let height = dimensions.height().min(region.dimensions().height());
            for y in 0..height {
                for x in 0..width {
                    if region.contains(x, y) {
                        let offset = (y as usize) * (dimensions.width() as usize) + (x as usize);
                        object_ids[offset] = index as i64;
                    }
                }
            }
        }

        (object_ids, background_index)
    }

    /// Which object owns most of a cell, or `None` when nobody does.
    fn classify_cell(
        cell: Cell,
        object_ids: &[i64],
        dimensions: Dimensions,
        split_len: u32,
        object_count: usize,
    ) -> Option<usize> {
        let width = dimensions.width() as usize;
        let height = dimensions.height() as usize;
        let size = split_len as usize;
        let top = cell.top(split_len) as usize;
        let left = cell.left(split_len) as usize;

        let mut counts = vec![0u32; object_count];
        let mut owned = false;
        for offset in 0..size {
            let y = top + offset;
            if y >= height {
                break;
            }
            for step in 0..size {
                let x = left + step;
                if x >= width {
                    break;
                }
                let id = object_ids[y * width + x];
                if id >= 0
                    && let Some(count) = counts.get_mut(id as usize)
                {
                    *count += 1;
                    owned = true;
                }
            }
        }
        if !owned {
            return None;
        }

        // The most pixels wins; a tie goes to the earlier mask, matching `numpy.argmax`.
        let mut best = (0usize, counts.first().copied().unwrap_or(0));
        for (index, count) in counts.iter().enumerate() {
            if *count > best.1 {
                best = (index, *count);
            }
        }
        (best.1 > 0).then_some(best.0)
    }
}

#[cfg(test)]
mod tests {
    use super::{BACKGROUND_LABEL, DrawingGroup, DrawingPlanner, IMAGE_LABEL};
    use crate::domain::{Cell, Dimensions, ObjectMask, Region};

    fn large_canvas() -> Dimensions {
        Dimensions::new(40, 40).unwrap()
    }

    /// A region covering everything in `[top, bottom) x [left, right)` in cells.
    fn block(
        dimensions: Dimensions,
        rows: std::ops::Range<u32>,
        columns: std::ops::Range<u32>,
    ) -> Region {
        let mut pixels = vec![false; dimensions.pixel_count() as usize];
        for y in rows.clone() {
            for x in columns.clone() {
                for dy in 0..10u32 {
                    for dx in 0..10u32 {
                        let py = y * 10 + dy;
                        let px = x * 10 + dx;
                        if py < dimensions.height() && px < dimensions.width() {
                            pixels[(py as usize) * (dimensions.width() as usize) + (px as usize)] =
                                true;
                        }
                    }
                }
            }
        }
        Region::new(dimensions, pixels).unwrap()
    }

    #[test]
    fn one_group_when_nothing_is_masked() {
        let cells = vec![Cell::new(0, 0), Cell::new(1, 1)];
        let groups = DrawingPlanner::plan(&cells, &[], large_canvas(), 10, 8);
        assert_eq!(groups, vec![DrawingGroup::new(IMAGE_LABEL, cells, 8)]);
    }

    #[test]
    fn groups_follow_the_order_the_masks_were_written_in() {
        let dimensions = large_canvas();
        // The catch-all is written first, so it is drawn first: the group order is the mask order,
        // and a catch-all takes its place in that order like any other object. Unclaimed cells
        // only get a group of their own at the end, when no mask claimed the catch-all role.
        let background = ObjectMask::background("sky", None).unwrap();
        let subject =
            ObjectMask::new("face", Some(block(dimensions, 0..1, 0..1)), Some(3)).unwrap();

        let cells = vec![
            Cell::new(0, 0), // the face
            Cell::new(3, 3), // the sky
        ];
        let groups = DrawingPlanner::plan(&cells, &[background, subject], dimensions, 10, 8);

        assert_eq!(groups.len(), 2);
        assert_eq!(groups[0].label(), "sky");
        assert_eq!(groups[0].cells(), &[Cell::new(3, 3)]);
        assert_eq!(groups[0].skip_rate(), 8, "the catch-all uses the default");
        assert_eq!(groups[1].label(), "face");
        assert_eq!(groups[1].cells(), &[Cell::new(0, 0)]);
        assert_eq!(groups[1].skip_rate(), 3, "a mask may set its own speed");
    }

    #[test]
    fn a_cell_belongs_to_the_object_that_owns_most_of_it() {
        let dimensions = large_canvas();
        // A 10x10 cell is 36 pixels majority-claimed: 6 columns of 6 rows.
        let mut pixels = vec![false; dimensions.pixel_count() as usize];
        for y in 0..6u32 {
            for x in 0..6u32 {
                pixels[(y as usize) * (dimensions.width() as usize) + (x as usize)] = true;
            }
        }
        let sliver = Region::new(dimensions, pixels).unwrap();
        let mask = ObjectMask::new("corner", Some(sliver), None).unwrap();

        let groups = DrawingPlanner::plan(&[Cell::new(0, 0)], &[mask], dimensions, 10, 8);
        assert_eq!(groups.len(), 1);
        assert_eq!(groups[0].label(), "corner");
    }

    #[test]
    fn cells_no_mask_claims_are_drawn_last_as_background() {
        let dimensions = large_canvas();
        let mask = ObjectMask::new("face", Some(block(dimensions, 0..1, 0..1)), None).unwrap();
        let cells = vec![Cell::new(2, 2), Cell::new(0, 0)];

        let groups = DrawingPlanner::plan(&cells, &[mask], dimensions, 10, 8);
        assert_eq!(groups.len(), 2);
        assert_eq!(groups[0].label(), "face");
        assert_eq!(groups[1].label(), BACKGROUND_LABEL);
        assert_eq!(groups[1].cells(), &[Cell::new(2, 2)]);
    }

    #[test]
    fn an_object_drawn_by_nothing_is_absent_from_the_plan() {
        let dimensions = large_canvas();
        let empty =
            ObjectMask::new("nothing here", Some(block(dimensions, 3..4, 3..4)), None).unwrap();
        let groups = DrawingPlanner::plan(&[Cell::new(0, 0)], &[empty], dimensions, 10, 8);
        assert_eq!(groups.len(), 1);
        assert_eq!(groups[0].label(), BACKGROUND_LABEL);
    }

    #[test]
    fn a_later_mask_wins_where_two_overlap() {
        let dimensions = large_canvas();
        let first = ObjectMask::new("first", Some(block(dimensions, 0..1, 0..1)), None).unwrap();
        let second = ObjectMask::new("second", Some(block(dimensions, 0..1, 0..1)), None).unwrap();

        let groups = DrawingPlanner::plan(&[Cell::new(0, 0)], &[first, second], dimensions, 10, 8);
        assert_eq!(groups.len(), 1);
        assert_eq!(groups[0].label(), "second");
    }
}
