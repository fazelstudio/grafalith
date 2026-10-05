//! Exact boolean operations on axis-aligned boxes.
//!
//! These are pure set operations over [`Bounds`] rectangles (no curves):
//! intersection, difference, union, and symmetric difference. Every result
//! is an exact, pairwise-disjoint cover — no approximation, no sampling.
//!
//! Scope note: full path boolean ops (bezier union/subtract) are a
//! follow-up behind a precision ADR (`i_overlay` is the top candidate;
//! see `docs/engine/01-research.md`). The rectangle domain is exact with
//! zero dependencies, which is why it lands first: it covers the common
//! design-tool case (rect-on-rect booleans) without new crates.

use crate::rect::Bounds;

/// Returns `true` when the box covers a positive area (non-empty input).
fn is_solid(bounds: &Bounds) -> bool {
    bounds.max_x > bounds.min_x && bounds.max_y > bounds.min_y
}

/// Intersection of two boxes, or `None` when they share no positive area.
///
/// Edge-touching boxes do not intersect: a zero-area seam cannot become an
/// element (`MIN_SIZE = 1` would reject it downstream), so it is not a
/// useful result.
pub fn intersect(a: &Bounds, b: &Bounds) -> Option<Bounds> {
    let candidate = Bounds::new(
        a.min_x.max(b.min_x),
        a.min_y.max(b.min_y),
        a.max_x.min(b.max_x),
        a.max_y.min(b.max_y),
    );
    if is_solid(&candidate) {
        Some(candidate)
    } else {
        None
    }
}

/// Fragments of `a` not covered by `b`: zero to four disjoint boxes, exact.
///
/// The overlap (when any) splits `a` into up to four slabs — left, right,
/// top-middle, bottom-middle — each emitted only with positive area. With
/// no overlap the result is exactly `[a]`; with full cover it is empty.
pub fn subtract(a: &Bounds, b: &Bounds) -> Vec<Bounds> {
    if !is_solid(a) {
        return Vec::new();
    }
    if !is_solid(b) {
        return vec![*a];
    }
    let overlap_x0 = a.min_x.max(b.min_x);
    let overlap_x1 = a.max_x.min(b.max_x);
    let overlap_y0 = a.min_y.max(b.min_y);
    let overlap_y1 = a.max_y.min(b.max_y);
    if overlap_x0 >= overlap_x1 || overlap_y0 >= overlap_y1 {
        return vec![*a];
    }
    let mut out = Vec::with_capacity(4);
    if overlap_x0 > a.min_x {
        out.push(Bounds::new(a.min_x, a.min_y, overlap_x0, a.max_y));
    }
    if overlap_x1 < a.max_x {
        out.push(Bounds::new(overlap_x1, a.min_y, a.max_x, a.max_y));
    }
    if overlap_y0 > a.min_y {
        out.push(Bounds::new(overlap_x0, a.min_y, overlap_x1, overlap_y0));
    }
    if overlap_y1 < a.max_y {
        out.push(Bounds::new(overlap_x0, overlap_y1, overlap_x1, a.max_y));
    }
    out
}

/// Exact disjoint cover of `a ∪ b`.
///
/// With no overlap both inputs are returned as-is; otherwise the covered
/// part of `a` is partitioned around the overlap and `b` closes the union.
/// Output order is deterministic: `a`-fragments first, then `b`.
pub fn union_partition(a: &Bounds, b: &Bounds) -> Vec<Bounds> {
    let mut out = subtract(a, b);
    if is_solid(b) {
        out.push(*b);
    }
    out
}

/// Symmetric difference (`a ⊕ b`): parts covered by exactly one input.
///
/// Concatenates both differences; every output is disjoint from every other
/// by construction. Empty inputs contribute nothing.
pub fn exclude(a: &Bounds, b: &Bounds) -> Vec<Bounds> {
    let mut out = subtract(a, b);
    out.extend(subtract(b, a));
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Deterministic LCG over small integers (exact float arithmetic).
    struct Lcg(u64);

    impl Lcg {
        fn next(&mut self, bound: i64) -> f64 {
            self.0 = self
                .0
                .wrapping_mul(6364136223846793005)
                .wrapping_add(1442695040888963407);
            ((self.0 >> 33) % (bound as u64)) as f64
        }

        fn rect(&mut self) -> Bounds {
            let x = self.next(40);
            let y = self.next(40);
            let w = self.next(30);
            let h = self.next(30);
            Bounds::from_xywh(x, y, w, h)
        }
    }

    fn area(bounds: &Bounds) -> f64 {
        (bounds.max_x - bounds.min_x).max(0.0) * (bounds.max_y - bounds.min_y).max(0.0)
    }

    fn total_area(boxes: &[Bounds]) -> f64 {
        boxes.iter().map(area).sum()
    }

    fn assert_disjoint(boxes: &[Bounds]) {
        for (i, first) in boxes.iter().enumerate() {
            assert!(is_solid(first), "output {i} has positive area");
            for (j, second) in boxes.iter().enumerate() {
                if i != j {
                    assert!(
                        intersect(first, second).is_none(),
                        "outputs {i} and {j} overlap"
                    );
                }
            }
        }
    }

    #[test]
    fn intersect_is_exact_overlap_or_nothing() {
        let a = Bounds::from_xywh(0.0, 0.0, 10.0, 10.0);
        let b = Bounds::from_xywh(5.0, 5.0, 10.0, 10.0);
        assert_eq!(intersect(&a, &b), Some(Bounds::new(5.0, 5.0, 10.0, 10.0)));
        // Edge touch is not an intersection.
        let c = Bounds::from_xywh(10.0, 0.0, 5.0, 5.0);
        assert_eq!(intersect(&a, &c), None);
        // Disjoint boxes do not intersect.
        let d = Bounds::from_xywh(20.0, 20.0, 5.0, 5.0);
        assert_eq!(intersect(&a, &d), None);
        // Containment returns the inner box.
        assert_eq!(intersect(&a, &a), Some(a));
    }

    #[test]
    fn subtract_partitions_exactly() {
        // No overlap: identity.
        let a = Bounds::from_xywh(0.0, 0.0, 10.0, 10.0);
        let far = Bounds::from_xywh(50.0, 50.0, 5.0, 5.0);
        assert_eq!(subtract(&a, &far), vec![a]);
        // Full cover: empty.
        assert!(subtract(&a, &a).is_empty());
        let big = Bounds::from_xywh(-5.0, -5.0, 20.0, 20.0);
        assert!(subtract(&a, &big).is_empty());
        // Corner bite: two slabs.
        let bite = Bounds::from_xywh(5.0, 5.0, 10.0, 10.0);
        let parts = subtract(&a, &bite);
        assert_eq!(parts.len(), 2);
        assert_disjoint(&parts);
        assert_eq!(total_area(&parts), 75.0);
        // Center hole: four slabs.
        let hole = Bounds::from_xywh(3.0, 3.0, 4.0, 4.0);
        let parts = subtract(&a, &hole);
        assert_eq!(parts.len(), 4);
        assert_disjoint(&parts);
        assert_eq!(total_area(&parts), 100.0 - 16.0);
    }

    #[test]
    fn boolean_identities_hold_on_random_boxes() {
        let mut rng = Lcg(0x1234_5678_9abc_def0);
        for _ in 0..500 {
            let a = rng.rect();
            let b = rng.rect();
            let area_a = total_area(&[a]);
            let area_b = total_area(&[b]);
            let area_both = intersect(&a, &b).map_or(0.0, |hit| total_area(&[hit]));

            let diff = subtract(&a, &b);
            assert_disjoint(&diff);
            assert_eq!(total_area(&diff), area_a - area_both);

            let union = union_partition(&a, &b);
            assert_disjoint(&union);
            assert_eq!(total_area(&union), area_a + area_b - area_both);

            let xor = exclude(&a, &b);
            assert_disjoint(&xor);
            assert_eq!(total_area(&xor), area_a + area_b - 2.0 * area_both);

            // Commutativity of area (order differs by construction).
            assert_eq!(total_area(&union_partition(&b, &a)), total_area(&union));
            assert_eq!(intersect(&a, &b), intersect(&b, &a));
        }
    }
}
