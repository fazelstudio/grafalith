//! Scene `<->` screen coordinate math and zoom clamping.
//!
//! TS source: `packages/core/src/render/viewport.ts` (`sceneToScreen`,
//! `screenToScene`, `getViewportBounds`, `clampZoom` 0.1–10).
//!
//! Pure functions only. Every operation declares its
//! coordinate space — screen space (pixels, origin at the canvas
//! top-left), world/document space (scene units), and local element space
//! (see [`crate::rotation`]). Screen-pixel tolerances convert via
//! [`crate::transform::screen_to_world_tolerance`]; values from different
//! spaces are never compared without explicit conversion.

use crate::point::Point;

/// Minimum allowed zoom (TS `MIN_ZOOM` in `clampZoom`).
pub const MIN_ZOOM: f64 = 0.1;

/// Maximum allowed zoom (TS `MAX_ZOOM` in `clampZoom`).
pub const MAX_ZOOM: f64 = 10.0;

/// Camera state in scene coordinates (TS `Viewport`).
///
/// `scrollX/scrollY` shift the scene under the canvas; `zoom` scales it.
/// The mapping is `screen = (scene + scroll) * zoom`.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Viewport {
    /// Horizontal scroll offset in scene units.
    pub scroll_x: f64,
    /// Vertical scroll offset in scene units.
    pub scroll_y: f64,
    /// Zoom factor (clamped to [`MIN_ZOOM`]–[`MAX_ZOOM`] by [`clamp_zoom`]).
    pub zoom: f64,
}

impl Viewport {
    /// Identity viewport: origin at the canvas corner, zoom 1.
    pub fn identity() -> Self {
        Self {
            scroll_x: 0.0,
            scroll_y: 0.0,
            zoom: 1.0,
        }
    }

    /// Default viewport: origin at zero, zoom 1 (TS initial parity).
    ///
    /// Alias of [`Viewport::identity`] matching the transient editor-state
    /// constructor name; the geometry crate is the single owner of this
    /// shape (no duplicated viewport math).
    pub fn new() -> Self {
        Self::identity()
    }

    /// Returns `true` when all three fields are finite (no
    /// `NaN`/`Infinity` in persistent or camera state).
    pub fn is_finite(&self) -> bool {
        self.scroll_x.is_finite() && self.scroll_y.is_finite() && self.zoom.is_finite()
    }
}

impl Default for Viewport {
    /// Defaults to [`Viewport::identity`].
    fn default() -> Self {
        Self::identity()
    }
}

/// Converts a world (scene-space) point to screen (pixel) space.
///
/// Exact port of TS `sceneToScreen`.
pub fn scene_to_screen(point: &Point, viewport: &Viewport) -> Point {
    [
        (point[0] + viewport.scroll_x) * viewport.zoom,
        (point[1] + viewport.scroll_y) * viewport.zoom,
    ]
}

/// Converts a screen (pixel) point to world (scene) space.
///
/// Exact port of TS `screenToScene` (the inverse of [`scene_to_screen`]).
pub fn screen_to_scene(point: &Point, viewport: &Viewport) -> Point {
    [
        point[0] / viewport.zoom - viewport.scroll_x,
        point[1] / viewport.zoom - viewport.scroll_y,
    ]
}

/// Visible rectangle in world (scene) coordinates for a canvas of
/// `canvas_width × canvas_height` screen pixels.
///
/// Exact port of TS `getViewportBounds` (top-left via [`screen_to_scene`],
/// size as the scene-space delta).
pub fn viewport_bounds(
    viewport: &Viewport,
    canvas_width: f64,
    canvas_height: f64,
) -> (f64, f64, f64, f64) {
    let top_left = screen_to_scene(&[0.0, 0.0], viewport);
    let bottom_right = screen_to_scene(&[canvas_width, canvas_height], viewport);
    (
        top_left[0],
        top_left[1],
        bottom_right[0] - top_left[0],
        bottom_right[1] - top_left[1],
    )
}

/// Clamps a zoom value to [`MIN_ZOOM`]–[`MAX_ZOOM`].
///
/// Exact port of TS `clampZoom`.
pub fn clamp_zoom(zoom: f64) -> f64 {
    zoom.clamp(MIN_ZOOM, MAX_ZOOM)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::point::{approx_eq, points_approx_eq};

    #[test]
    fn scene_screen_round_trip_through_scroll_and_zoom() {
        let vp = Viewport {
            scroll_x: 100.0,
            scroll_y: -50.0,
            zoom: 2.0,
        };
        let world = [10.0, 20.0];
        let screen = scene_to_screen(&world, &vp);
        assert_eq!(screen, [220.0, -60.0]);
        let back = screen_to_scene(&screen, &vp);
        assert!(points_approx_eq(&back, &world, 1e-12));
    }

    #[test]
    fn viewport_bounds_span_canvas_size_over_zoom() {
        let vp = Viewport::identity();
        assert_eq!(viewport_bounds(&vp, 800.0, 600.0), (0.0, 0.0, 800.0, 600.0));
        let zoomed = Viewport {
            scroll_x: 0.0,
            scroll_y: 0.0,
            zoom: 2.0,
        };
        let (x, y, w, h) = viewport_bounds(&zoomed, 800.0, 600.0);
        assert!(approx_eq(x, 0.0, 1e-12) && approx_eq(y, 0.0, 1e-12));
        assert!(approx_eq(w, 400.0, 1e-12) && approx_eq(h, 300.0, 1e-12));
    }

    #[test]
    fn zoom_clamps_to_tenths() {
        assert_eq!(clamp_zoom(0.05), MIN_ZOOM);
        assert_eq!(clamp_zoom(50.0), MAX_ZOOM);
        assert_eq!(clamp_zoom(2.5), 2.5);
        assert!(!Viewport {
            scroll_x: f64::NAN,
            scroll_y: 0.0,
            zoom: 1.0
        }
        .is_finite());
    }
}
