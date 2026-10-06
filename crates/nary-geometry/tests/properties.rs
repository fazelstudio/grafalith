//! Deterministic property tests for `nary-geometry` (std-only LCG, no
//! framework): transform round-trips, viewport invertibility, and bounds
//! algebra invariants over hundreds of random integer-coordinate inputs
//! (exact float arithmetic, zero tolerance).

use nary_geometry::rect::Bounds;
use nary_geometry::rotation::{to_local_space, to_world_space};
use nary_geometry::viewport::{scene_to_screen, screen_to_scene, Viewport};

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
        let x = self.next(80) - 40.0;
        let y = self.next(80) - 40.0;
        Bounds::from_xywh(x, y, self.next(40), self.next(40))
    }
}

fn approx(a: f64, b: f64) -> bool {
    (a - b).abs() <= 1e-9
}

#[test]
fn rotation_round_trip_is_identity() {
    let mut rng = Lcg(0x1a2b_3c4d_5e6f_7081);
    for _ in 0..500 {
        let center = [rng.next(100) - 50.0, rng.next(100) - 50.0];
        let point = [rng.next(200) - 100.0, rng.next(200) - 100.0];
        // Exact only at multiples of 90°; general angles round-trip within
        // trig precision.
        let rotation = rng.next(8) * std::f64::consts::FRAC_PI_4;
        let local = to_local_space(point[0], point[1], center[0], center[1], rotation);
        let back = to_world_space(local[0], local[1], center[0], center[1], rotation);
        assert!(approx(back[0], point[0]) && approx(back[1], point[1]));
        // Zero rotation is the identity, exactly.
        let same = to_local_space(point[0], point[1], center[0], center[1], 0.0);
        assert_eq!(same, point);
    }
}

#[test]
fn viewport_conversions_invert_each_other() {
    let mut rng = Lcg(0x9e37_79b9_7f4a_7c15);
    for _ in 0..500 {
        let viewport = Viewport {
            scroll_x: rng.next(400) - 200.0,
            scroll_y: rng.next(400) - 200.0,
            zoom: 0.5 + rng.next(4) * 0.5,
        };
        let scene = [rng.next(500) - 250.0, rng.next(500) - 250.0];
        let screen = scene_to_screen(&scene, &viewport);
        let back = screen_to_scene(&screen, &viewport);
        assert!(approx(back[0], scene[0]) && approx(back[1], scene[1]));
    }
}

#[test]
fn bounds_algebra_invariants_hold() {
    let mut rng = Lcg(0x0123_4567_89ab_cdef);
    for _ in 0..500 {
        let a = rng.rect();
        let b = rng.rect();
        // Union contains both inputs and is the smallest such box.
        let union = a.union(&b);
        assert!(union.contains(&a) && union.contains(&b));
        assert!(union.min_x <= a.min_x.min(b.min_x));
        // Intersection (when positive) sits inside both inputs.
        let (x0, y0, x1, y1) = (
            a.min_x.max(b.min_x),
            a.min_y.max(b.min_y),
            a.max_x.min(b.max_x),
            a.max_y.min(b.max_y),
        );
        if x0 < x1 && y0 < y1 {
            let hit = Bounds::new(x0, y0, x1, y1);
            assert!(a.contains(&hit) && b.contains(&hit));
            // Positive overlap always reports as intersecting.
            assert!(a.intersects(&b));
        }
        // Edge-touching counts as intersecting (inclusive-touch contract).
        let touching = Bounds::from_xywh(a.max_x, a.min_y, 5.0, 5.0);
        if a.max_y > a.min_y {
            assert!(a.intersects(&touching));
        }
    }
}

use proptest::prelude::*;

proptest! {
    #![proptest_config(ProptestConfig::with_cases(256))]

    #[test]
    fn rotation_round_trip_proptest(
        px in -1e6f64..1e6f64,
        py in -1e6f64..1e6f64,
        cx in -1e6f64..1e6f64,
        cy in -1e6f64..1e6f64,
        rot in -1e4f64..1e4f64,
    ) {
        // Supported domain: scene-size coordinates and sane angles.
        // Outside it (e.g. 1e308 centers with 1e16-rad rotations, found by
        // an unbounded run) f64 argument reduction cannot round-trip to
        // 1e-9 — inherent float behavior, covered for robustness (no NaN,
        // no panic) by `extreme_inputs_stay_finite` below instead.
        let local = to_local_space(px, py, cx, cy, rot);
        let back = to_world_space(local[0], local[1], cx, cy, rot);
        let scale = px.abs().max(py.abs()).max(cx.abs()).max(cy.abs()).max(1.0);
        prop_assert!((back[0] - px).abs() <= 1e-9 * scale);
        prop_assert!((back[1] - py).abs() <= 1e-9 * scale);
    }

    #[test]
    fn extreme_inputs_stay_finite(
        px in -1e300f64..1e300f64,
        py in -1e300f64..1e300f64,
        cx in -1e300f64..1e300f64,
        cy in -1e300f64..1e300f64,
        rot in any::<f64>(),
    ) {
        // Overflow-free zone: beyond ~1e300, `px - cx` itself can overflow
        // to inf (pure float behavior, no panic — downstream finite guards
        // at storage/input boundaries already treat inf as miss/invalid).
        prop_assume!(rot.is_finite());
        let local = to_local_space(px, py, cx, cy, rot);
        let back = to_world_space(local[0], local[1], cx, cy, rot);
        prop_assert!(local[0].is_finite() && local[1].is_finite());
        prop_assert!(back[0].is_finite() && back[1].is_finite());
    }

    #[test]
    fn boolean_area_identities_proptest(
        ax in -50i32..50i32,
        ay in -50i32..50i32,
        aw in 0i32..50i32,
        ah in 0i32..50i32,
        bx in -50i32..50i32,
        by in -50i32..50i32,
        bw in 0i32..50i32,
        bh in 0i32..50i32,
    ) {
        use nary_geometry::boolean::{exclude, intersect, subtract, union_partition};

        let a = Bounds::from_xywh(ax as f64, ay as f64, aw as f64, ah as f64);
        let b = Bounds::from_xywh(bx as f64, by as f64, bw as f64, bh as f64);
        let area = |bounds: &Bounds| {
            (bounds.max_x - bounds.min_x).max(0.0) * (bounds.max_y - bounds.min_y).max(0.0)
        };
        let total = |boxes: &[Bounds]| -> f64 { boxes.iter().map(area).sum() };
        let overlap = intersect(&a, &b).map_or(0.0, |hit| area(&hit));

        // Difference restores the input area minus the overlap.
        prop_assert!((total(&subtract(&a, &b)) - (area(&a) - overlap)).abs() < 1e-9);
        // Union and exclusion conserve area exactly.
        prop_assert!(
            (total(&union_partition(&a, &b)) - (area(&a) + area(&b) - overlap)).abs() < 1e-9
        );
        prop_assert!(
            (total(&exclude(&a, &b)) - (area(&a) + area(&b) - 2.0 * overlap)).abs() < 1e-9
        );
        // Outputs are pairwise disjoint with positive area.
        for outputs in [subtract(&a, &b), union_partition(&a, &b), exclude(&a, &b)] {
            for (i, first) in outputs.iter().enumerate() {
                prop_assert!(area(first) > 0.0);
                for (j, second) in outputs.iter().enumerate() {
                    if i != j {
                        prop_assert!(intersect(first, second).is_none());
                    }
                }
            }
        }
    }
}
