//! Resize / rotate / handle math shared by interaction and rendering.
//!
//! TS sources: `packages/core/src/interaction/transform.ts`
//! (`computeAxisAlignedResize`, `resizeNoRotation`, `resizeWithRotation`,
//! `applyProportionalContentScaling`, `updateRotate`, `MIN size >= 1`,
//! Shift aspect-lock for all shapes); handle geometry and hit radii in
//! `packages/core/src/render/render-selection.ts` (`getResizeHandles`,
//! `getRotateHandlePosition`, `hitTestResizeHandle`, `hitTestRotateHandle`,
//! `hitTestBoundingBox`); stroke thresholds in `shapes/{line,arrow,
//! freedraw,path}.ts` (`strokeWidth / 2 + 4`); path-edit radii in
//! `packages/core/src/interaction/path-edit.ts` (8 / 6 / 10, all `/ zoom`);
//! pen thresholds in `pen-tool.ts` (close 12, drag-detect 3).
//!
//! Coordinate spaces: resize inputs arrive as scene-space
//! points (callers convert from screen via the viewport first); handle
//! radii marked "screen px" convert through [`screen_to_world_tolerance`].
//! Rotation-aware resize works in the element's local frame: inverse-rotate
//! the pointer, run the axis-aligned anchor logic, rotate the center delta
//! back (TS `resizeWithRotation` strategy).

use crate::point::Point;
use crate::rect::Bounds;
use crate::rotation::{to_local_space, ROTATE_SNAP_INCREMENT};

// Named numeric contracts: do not change silently.

/// Minimum element dimension after resize (TS `Math.max(1, …)` in both
/// resize paths; images/text collapse guards elsewhere reuse it).
pub const MIN_SIZE: f64 = 1.0;

/// Stroke hit-test padding in scene units: line/arrow/freedraw/path use
/// `strokeWidth / 2 + STROKE_HIT_PADDING` (TS `+ 4` in each shape).
pub const STROKE_HIT_PADDING: f64 = 4.0;

/// Resize/rotate handle hit radius padding in screen px: TS adds `+ 2`
/// after the `/ zoom` normalization (`handleSize / zoom + 2`,
/// `rotateHandleRadius / zoom + 2`).
pub const HANDLE_HIT_PADDING_PX: f64 = 2.0;

/// Path-edit anchor hit radius in screen px (TS `ANCHOR_HIT_RADIUS`).
pub const PATH_ANCHOR_HIT_RADIUS_PX: f64 = 8.0;

/// Path-edit Bezier-handle hit radius in screen px (TS `HANDLE_HIT_RADIUS`).
pub const PATH_HANDLE_HIT_RADIUS_PX: f64 = 6.0;

/// Path-edit segment hover threshold in screen px (TS
/// `SEGMENT_HIT_THRESHOLD`).
pub const PATH_SEGMENT_HIT_THRESHOLD_PX: f64 = 10.0;

/// Pen-tool close threshold in scene units (TS `CLOSE_THRESHOLD`).
pub const PEN_CLOSE_THRESHOLD: f64 = 12.0;

/// Pen-tool drag-detect threshold in screen px (TS `pen-drag 3 px`).
pub const PEN_DRAG_THRESHOLD_PX: f64 = 3.0;

// Tolerance conversion: explicit units, zoom-aware.

/// Converts a screen-pixel tolerance to world (scene) units.
///
/// Thresholds authored in screen px (snap `5`, handles, path-edit radii)
/// divide by the viewport zoom so feel is zoom-independent
/// (`threshold / zoom` at every TS call site). A non-finite or
/// non-positive zoom falls back to `1.0` (TS `safeZoom` guard in
/// `findSnapToObject`); `0.0` can never be a divisor here.
pub fn screen_to_world_tolerance(screen_px: f64, zoom: f64) -> f64 {
    let safe_zoom = if zoom.is_finite() && zoom > 0.0 {
        zoom
    } else {
        1.0
    };
    screen_px / safe_zoom
}

/// Stroke hit-test threshold in scene units for a given stroke width.
///
/// Exact TS formula shared by line/arrow/freedraw/path hit-tests.
/// Deliberately NOT zoom-normalized: TS compares scene distances against
/// this value directly, so lines feel thinner at high zoom (preserved).
pub fn stroke_hit_threshold(stroke_width: f64) -> f64 {
    stroke_width / 2.0 + STROKE_HIT_PADDING
}

// Resize handles.

/// The eight resize handles (TS `HandleType` in `render-selection.ts`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum HandleType {
    /// Top-left corner.
    TopLeft,
    /// Top edge midpoint.
    TopCenter,
    /// Top-right corner.
    TopRight,
    /// Left edge midpoint.
    MiddleLeft,
    /// Right edge midpoint.
    MiddleRight,
    /// Bottom-left corner.
    BottomLeft,
    /// Bottom edge midpoint.
    BottomCenter,
    /// Bottom-right corner.
    BottomRight,
}

impl HandleType {
    /// All eight handles in TS `getResizeHandles` order.
    pub const ALL: [HandleType; 8] = [
        HandleType::TopLeft,
        HandleType::TopCenter,
        HandleType::TopRight,
        HandleType::MiddleLeft,
        HandleType::MiddleRight,
        HandleType::BottomLeft,
        HandleType::BottomCenter,
        HandleType::BottomRight,
    ];

    /// Whether this handle moves the left edge (anchors on the right).
    pub fn moves_left(self) -> bool {
        matches!(
            self,
            HandleType::TopLeft | HandleType::MiddleLeft | HandleType::BottomLeft
        )
    }

    /// Whether this handle moves the right edge.
    pub fn moves_right(self) -> bool {
        matches!(
            self,
            HandleType::TopRight | HandleType::MiddleRight | HandleType::BottomRight
        )
    }

    /// Whether this handle moves the top edge.
    pub fn moves_top(self) -> bool {
        matches!(
            self,
            HandleType::TopLeft | HandleType::TopCenter | HandleType::TopRight
        )
    }

    /// Whether this handle moves the bottom edge.
    pub fn moves_bottom(self) -> bool {
        matches!(
            self,
            HandleType::BottomLeft | HandleType::BottomCenter | HandleType::BottomRight
        )
    }
}

/// A resize handle position in scene coordinates (TS `ResizeHandle`).
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct ResizeHandle {
    /// Which handle this is.
    pub kind: HandleType,
    /// Scene-space position.
    pub position: Point,
}

/// The eight resize-handle positions for `bounds`, in scene coordinates.
///
/// Exact port of TS `getResizeHandles` (corners + edge midpoints from the
/// axis-aligned box; rotation is applied by the caller when needed).
pub fn get_resize_handles(bounds: &Bounds) -> [ResizeHandle; 8] {
    let cx = (bounds.min_x + bounds.max_x) / 2.0;
    let cy = (bounds.min_y + bounds.max_y) / 2.0;
    let at = |kind: HandleType, x: f64, y: f64| ResizeHandle {
        kind,
        position: [x, y],
    };
    [
        at(HandleType::TopLeft, bounds.min_x, bounds.min_y),
        at(HandleType::TopCenter, cx, bounds.min_y),
        at(HandleType::TopRight, bounds.max_x, bounds.min_y),
        at(HandleType::MiddleLeft, bounds.min_x, cy),
        at(HandleType::MiddleRight, bounds.max_x, cy),
        at(HandleType::BottomLeft, bounds.min_x, bounds.max_y),
        at(HandleType::BottomCenter, cx, bounds.max_y),
        at(HandleType::BottomRight, bounds.max_x, bounds.max_y),
    ]
}

/// Rotate-handle position in scene coordinates (unrotated frame).
///
/// Ports TS `getRotateHandlePosition`: centered above the top edge by
/// `rotate_handle_offset / zoom` scene units. The caller rotates it about
/// the box center when the selection is rotated.
pub fn get_rotate_handle_position(bounds: &Bounds, zoom: f64, rotate_handle_offset: f64) -> Point {
    let cx = (bounds.min_x + bounds.max_x) / 2.0;
    [
        cx,
        bounds.min_y - screen_to_world_tolerance(rotate_handle_offset, zoom),
    ]
}

/// Hit-tests a scene point against the eight resize handles.
///
/// Ports TS `hitTestResizeHandle`: each handle is rotated about the box
/// center by `rotation` first; the hit box is `handle_size / zoom + 2`
/// (see [`HANDLE_HIT_PADDING_PX`]). Returns the first hit in TS order.
pub fn hit_test_resize_handle(
    px: f64,
    py: f64,
    bounds: &Bounds,
    zoom: f64,
    handle_size: f64,
    rotation: f64,
) -> Option<HandleType> {
    let hit_radius = screen_to_world_tolerance(handle_size, zoom) + HANDLE_HIT_PADDING_PX;
    let center = bounds.center();
    for handle in get_resize_handles(bounds) {
        let (hx, hy) = if rotation != 0.0 {
            let rotated = crate::rotation::rotate_point_around(
                &handle.position,
                &[center[0], center[1]],
                rotation,
            );
            (rotated[0], rotated[1])
        } else {
            (handle.position[0], handle.position[1])
        };
        if (px - hx).abs() <= hit_radius && (py - hy).abs() <= hit_radius {
            return Some(handle.kind);
        }
    }
    None
}

/// Hit-tests a scene point against the rotate handle (circle test).
///
/// Ports TS `hitTestRotateHandle` with radius
/// `rotate_handle_radius / zoom + 2`.
pub fn hit_test_rotate_handle(
    px: f64,
    py: f64,
    bounds: &Bounds,
    zoom: f64,
    rotate_handle_radius: f64,
    rotate_handle_offset: f64,
    rotation: f64,
) -> bool {
    let pos = get_rotate_handle_position(bounds, zoom, rotate_handle_offset);
    let hit_radius = screen_to_world_tolerance(rotate_handle_radius, zoom) + HANDLE_HIT_PADDING_PX;
    let (rx, ry) = if rotation != 0.0 {
        let center = bounds.center();
        let rotated = crate::rotation::rotate_point_around(&pos, &[center[0], center[1]], rotation);
        (rotated[0], rotated[1])
    } else {
        (pos[0], pos[1])
    };
    let dx = px - rx;
    let dy = py - ry;
    dx * dx + dy * dy <= hit_radius * hit_radius
}

/// Hit-tests a scene point against the selection-box outline.
///
/// Ports TS `hitTestBoundingBox`: the point maps into the unrotated frame
/// first; it must lie within `threshold` outside the box but on an edge
/// band. Note the TS quirk preserved here: `threshold` is
/// `boundingBoxHitThreshold` used directly in scene units (NOT
/// `/ zoom`), unlike the handle radii above.
pub fn hit_test_bounding_box(
    px: f64,
    py: f64,
    bounds: &Bounds,
    threshold: f64,
    rotation: f64,
) -> bool {
    let (lx, ly) = if rotation != 0.0 {
        let center = bounds.center();
        let local = to_local_space(px, py, center[0], center[1], rotation);
        (local[0], local[1])
    } else {
        (px, py)
    };
    let in_x = lx >= bounds.min_x - threshold && lx <= bounds.max_x + threshold;
    let in_y = ly >= bounds.min_y - threshold && ly <= bounds.max_y + threshold;
    if !in_x || !in_y {
        return false;
    }
    (lx - bounds.min_x).abs() < threshold
        || (lx - bounds.max_x).abs() < threshold
        || (ly - bounds.min_y).abs() < threshold
        || (ly - bounds.max_y).abs() < threshold
}

// Resize math.

/// Result of an axis-aligned resize step: new origin plus dimensions.
///
/// Dimensions may be clamped to [`MIN_SIZE`] by the wrappers below; the
/// raw [`compute_axis_aligned_resize`] step preserves TS flip behavior
/// (negative drag flips to the opposite corner, dimensions stay positive).
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct ResizeOutput {
    /// New top-left x (scene units, local frame).
    pub x: f64,
    /// New top-left y (scene units, local frame).
    pub y: f64,
    /// New width (always non-negative out of the raw step).
    pub width: f64,
    /// New height (always non-negative out of the raw step).
    pub height: f64,
}

/// Axis-aligned resize with opposite corner/edge anchored and flip support.
///
/// Exact port of TS `computeAxisAlignedResize`: `handle` names the dragged
/// edge(s), `point` is the pointer in the element's local (unrotated)
/// frame, and `lock_aspect` (Shift — Figma/TLDraw convention, all shapes)
/// scales the driven axis from the original aspect ratio. Dragging past
/// the opposite edge flips orientation instead of going negative.
pub fn compute_axis_aligned_resize(
    orig_x: f64,
    orig_y: f64,
    orig_w: f64,
    orig_h: f64,
    handle: HandleType,
    point: &Point,
    lock_aspect: bool,
) -> ResizeOutput {
    let mut new_x = orig_x;
    let mut new_y = orig_y;
    let mut new_w = orig_w;
    let mut new_h = orig_h;

    let aspect_ratio = if orig_h != 0.0 { orig_w / orig_h } else { 1.0 };

    if handle.moves_right() {
        new_w = point[0] - orig_x;
        if lock_aspect {
            new_h = new_w / aspect_ratio;
        }
    }
    if handle.moves_left() {
        new_w = orig_x + orig_w - point[0];
        new_x = point[0];
        if lock_aspect {
            new_h = new_w / aspect_ratio;
        }
    }
    if handle.moves_bottom() {
        new_h = point[1] - orig_y;
        if lock_aspect {
            new_w = new_h * aspect_ratio;
            if handle.moves_left() {
                new_x = orig_x + orig_w - new_w;
            }
        }
    }
    if handle.moves_top() {
        new_h = orig_y + orig_h - point[1];
        new_y = point[1];
        if lock_aspect {
            new_w = new_h * aspect_ratio;
            if handle.moves_left() {
                new_x = orig_x + orig_w - new_w;
            }
        }
    }

    // Flip: dragged past the opposite edge — mirror to stay positive.
    if new_w < 0.0 {
        new_x += new_w;
        new_w = new_w.abs();
    }
    if new_h < 0.0 {
        new_y += new_h;
        new_h = new_h.abs();
    }

    ResizeOutput {
        x: new_x,
        y: new_y,
        width: new_w,
        height: new_h,
    }
}

/// Unrotated resize: axis-aligned step plus the `>= 1` minimum clamp.
///
/// Ports TS `resizeNoRotation` (the clamp is `Math.max(1, …)` there).
pub fn resize_no_rotation(
    orig_x: f64,
    orig_y: f64,
    orig_w: f64,
    orig_h: f64,
    handle: HandleType,
    point: &Point,
    lock_aspect: bool,
) -> ResizeOutput {
    let raw =
        compute_axis_aligned_resize(orig_x, orig_y, orig_w, orig_h, handle, point, lock_aspect);
    ResizeOutput {
        x: raw.x,
        y: raw.y,
        width: raw.width.max(MIN_SIZE),
        height: raw.height.max(MIN_SIZE),
    }
}

/// Rotated resize: inverse-rotate the pointer, run the axis-aligned logic
/// (flip + aspect lock identical to the unrotated path), clamp, then
/// rotate the center delta back to world space.
///
/// Ports TS `resizeWithRotation`: the opposite corner/edge in *local* space stays static (no
/// center-symmetric growth), and rotation is preserved on the output. The
/// returned box stays axis-aligned in world space — it is the element's
/// new `x/y/width/height` with `rotation` unchanged.
///
/// `unrotated` is the element's local-frame box (`Bounds::from_xywh(x, y,
/// w, h)`); `rotation` is its current rotation in radians.
pub fn resize_with_rotation(
    unrotated: &Bounds,
    rotation: f64,
    handle: HandleType,
    scene_point: &Point,
    lock_aspect: bool,
) -> ResizeOutput {
    let (orig_x, orig_y) = (unrotated.min_x, unrotated.min_y);
    let (orig_w, orig_h) = (unrotated.width(), unrotated.height());
    let old_cx = orig_x + orig_w / 2.0;
    let old_cy = orig_y + orig_h / 2.0;

    // Inverse-rotate the pointer into the unrotated frame.
    let local = to_local_space(scene_point[0], scene_point[1], old_cx, old_cy, rotation);
    let raw =
        compute_axis_aligned_resize(orig_x, orig_y, orig_w, orig_h, handle, &local, lock_aspect);
    let final_w = raw.width.max(MIN_SIZE);
    let final_h = raw.height.max(MIN_SIZE);

    // Adjust for clamping (final may differ from raw at minimum size).
    let adj_x = raw.x + (raw.width - final_w) / 2.0;
    let adj_y = raw.y + (raw.height - final_h) / 2.0;
    let new_local_cx = adj_x + final_w / 2.0;
    let new_local_cy = adj_y + final_h / 2.0;
    let ddx = new_local_cx - old_cx;
    let ddy = new_local_cy - old_cy;
    let cos = rotation.cos();
    let sin = rotation.sin();
    let world_cx = old_cx + ddx * cos - ddy * sin;
    let world_cy = old_cy + ddx * sin + ddy * cos;

    ResizeOutput {
        x: world_cx - final_w / 2.0,
        y: world_cy - final_h / 2.0,
        width: final_w,
        height: final_h,
    }
}

/// Scales element-relative points by `(scale_x, scale_y)`.
///
/// Ports the line/arrow/freedraw branch of TS
/// `applyProportionalContentScaling`: points are relative to the element
/// origin, so the visual geometry follows `width`/`height` (previously a
/// no-op — metadata changed but pixels did not move).
pub fn scale_points(points: &[Point], scale_x: f64, scale_y: f64) -> Vec<Point> {
    points
        .iter()
        .map(|p| [p[0] * scale_x, p[1] * scale_y])
        .collect()
}

/// Scales text font size proportionally to a resize.
///
/// Ports the text branch of TS `applyProportionalContentScaling`
/// (TLDraw convention): uniform scale uses `min(scaleX, scaleY)` so a
/// side-only drag may leave the font unchanged; the result floors at 8px.
pub fn scale_font_size(font_size: f64, orig_w: f64, orig_h: f64, new_w: f64, new_h: f64) -> f64 {
    let scale_x = if orig_w > 0.0 { new_w / orig_w } else { 1.0 };
    let scale_y = if orig_h > 0.0 { new_h / orig_h } else { 1.0 };
    (font_size * scale_x.min(scale_y)).round().max(8.0)
}

/// Snaps a rotation to 15° increments when Shift is held.
///
/// Thin wrapper over the [`ROTATE_SNAP_INCREMENT`] rounding inside
/// [`crate::rotation::rotate_delta`], exposed for callers that already
/// hold an absolute angle.
pub fn snap_rotation(rotation: f64) -> f64 {
    (rotation / ROTATE_SNAP_INCREMENT).round() * ROTATE_SNAP_INCREMENT
}

/// Normalizes a rotation to `[-PI, PI]`.
///
/// Delegates to [`crate::rotation::normalize_rotation`] for callers that
/// only import `transform` (single owner, no duplicated math).
pub fn normalize_angle(rotation: f64) -> f64 {
    crate::rotation::normalize_rotation(rotation)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::point::approx_eq;

    #[test]
    fn bottom_right_resize_grows_box() {
        // transform.test.ts: (100,100,80,60), BR drag to (220,200).
        let out = resize_no_rotation(
            100.0,
            100.0,
            80.0,
            60.0,
            HandleType::BottomRight,
            &[220.0, 200.0],
            false,
        );
        assert_eq!(
            out,
            ResizeOutput {
                x: 100.0,
                y: 100.0,
                width: 120.0,
                height: 100.0
            }
        );
    }

    #[test]
    fn top_left_resize_moves_origin_and_keeps_far_corner() {
        // transform.test.ts: TL drag to (80,80) → (80,80,100,80).
        let out = resize_no_rotation(
            100.0,
            100.0,
            80.0,
            60.0,
            HandleType::TopLeft,
            &[80.0, 80.0],
            false,
        );
        assert_eq!(
            out,
            ResizeOutput {
                x: 80.0,
                y: 80.0,
                width: 100.0,
                height: 80.0
            }
        );
    }

    #[test]
    fn resize_enforces_minimum_size_and_flips_past_edge() {
        // Drag BR far past the top-left: flips, then clamps to >= 1.
        let out = resize_no_rotation(
            100.0,
            100.0,
            80.0,
            60.0,
            HandleType::BottomRight,
            &[50.0, 50.0],
            false,
        );
        assert!(out.width >= 1.0 && out.height >= 1.0);
        // Pure flip check on the raw step: negative drag mirrors.
        let raw = compute_axis_aligned_resize(
            100.0,
            100.0,
            80.0,
            60.0,
            HandleType::BottomRight,
            &[50.0, 50.0],
            false,
        );
        assert_eq!(
            (raw.x, raw.y, raw.width, raw.height),
            (50.0, 50.0, 50.0, 50.0)
        );
    }

    #[test]
    fn aspect_lock_holds_ratio_for_corner_and_side_handles() {
        // 80×60 (4:3) via BR with Shift: h follows w.
        let out = resize_no_rotation(
            0.0,
            0.0,
            80.0,
            60.0,
            HandleType::BottomRight,
            &[120.0, 200.0],
            true,
        );
        assert!(approx_eq(out.width / out.height, 80.0 / 60.0, 1e-9));
        // Top edge with Shift keeps the ratio through the height driver.
        let out = resize_no_rotation(
            0.0,
            0.0,
            80.0,
            60.0,
            HandleType::TopCenter,
            &[0.0, -30.0],
            true,
        );
        assert!(approx_eq(out.width / out.height, 80.0 / 60.0, 1e-9));
    }

    #[test]
    fn rotated_resize_preserves_rotation_and_valid_dims() {
        // transform.test.ts: 90°-rotated box stays valid, rotation kept.
        let unrotated = Bounds::from_xywh(100.0, 100.0, 80.0, 60.0);
        let out = resize_with_rotation(
            &unrotated,
            std::f64::consts::FRAC_PI_2,
            HandleType::BottomRight,
            &[180.0, 170.0],
            false,
        );
        assert!(out.width >= 1.0 && out.height >= 1.0);
        assert!(out.x.is_finite() && out.y.is_finite());
    }

    #[test]
    fn rotated_top_left_keeps_opposite_local_corner_fixed() {
        // transform.test.ts pins the opposite corner within 15px at 45°.
        let rot = std::f64::consts::FRAC_PI_4;
        let cos = rot.cos();
        let sin = rot.sin();
        let orig_opp = [
            140.0 + (40.0 * cos - 30.0 * sin),
            130.0 + (40.0 * sin + 30.0 * cos),
        ];
        let out = resize_with_rotation(
            &Bounds::from_xywh(100.0, 100.0, 80.0, 60.0),
            rot,
            HandleType::TopLeft,
            &[120.0, 120.0],
            false,
        );
        let new_cx = out.x + out.width / 2.0;
        let new_cy = out.y + out.height / 2.0;
        let new_opp = [
            new_cx + (out.width / 2.0 * cos - out.height / 2.0 * sin),
            new_cy + (out.width / 2.0 * sin + out.height / 2.0 * cos),
        ];
        assert!((new_opp[0] - orig_opp[0]).abs() < 15.0);
        assert!((new_opp[1] - orig_opp[1]).abs() < 15.0);
    }

    #[test]
    fn content_scaling_follows_box() {
        let pts: Vec<Point> = vec![[0.0, 0.0], [100.0, 0.0]];
        assert_eq!(scale_points(&pts, 2.0, 1.0), vec![[0.0, 0.0], [200.0, 0.0]]);
        // Doubling both axes doubles a 16px font; side-only drag floors
        // through min(scaleX, scaleY).
        assert_eq!(scale_font_size(16.0, 100.0, 50.0, 200.0, 100.0), 32.0);
        assert_eq!(scale_font_size(16.0, 100.0, 50.0, 200.0, 50.0), 16.0);
    }

    #[test]
    fn stroke_and_handle_tolerances_use_documented_units() {
        // Stroke: fixed scene units, NOT zoom-normalized (TS parity).
        assert_eq!(stroke_hit_threshold(2.0), 5.0);
        // Handles: screen px → world via / zoom, then + 2.
        assert!(approx_eq(screen_to_world_tolerance(8.0, 2.0), 4.0, 1e-12));
        assert!(approx_eq(screen_to_world_tolerance(5.0, 0.0), 5.0, 1e-12));
        assert!(approx_eq(
            screen_to_world_tolerance(5.0, f64::NAN),
            5.0,
            1e-12
        ));
        // Resize handle hit box: |dx|,|dy| <= size/zoom + 2.
        let b = Bounds::from_xywh(0.0, 0.0, 100.0, 100.0);
        assert_eq!(
            hit_test_resize_handle(0.0, 0.0, &b, 1.0, 8.0, 0.0),
            Some(HandleType::TopLeft)
        );
        assert_eq!(hit_test_resize_handle(50.0, 50.0, &b, 1.0, 8.0, 0.0), None);
        // Bounding-box edge band (threshold 4, unrotated).
        assert!(hit_test_bounding_box(50.0, 1.0, &b, 4.0, 0.0));
        assert!(!hit_test_bounding_box(50.0, 50.0, &b, 4.0, 0.0));
        // Rotate handle sits above the top edge.
        let pos = get_rotate_handle_position(&b, 1.0, 24.0);
        assert_eq!(pos, [50.0, -24.0]);
        assert!(hit_test_rotate_handle(50.0, -24.0, &b, 1.0, 6.0, 24.0, 0.0));
    }
}
