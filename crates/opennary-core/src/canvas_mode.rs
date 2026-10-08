//! Canvas mode: infinite vs. bounded (pure config).
//!
//! TS source: `packages/core/src/render/canvas-mode.ts` (`CanvasMode` +
//! `DEFAULT_CANVAS_MODE`; immutable after editor init — pinned by
//! `editor/canvas-mode.test.ts`).
//!
//! Mode is plain config data. Bounded-mode painting (dim-outside,
//! border) belongs to the render model, not here.

use opennary_geometry::Bounds;

use crate::element::FillStyle;

/// Canvas mode configuration.
#[derive(Debug, Clone, PartialEq)]
pub enum CanvasMode {
    /// Unlimited canvas, no visible boundaries (the default).
    Infinite,
    /// Fixed `width` × `height` canvas at the origin with a visual boundary.
    Bounded {
        /// Canvas width in scene units.
        width: f64,
        /// Canvas height in scene units.
        height: f64,
        /// Optional canvas background fill.
        background: Option<FillStyle>,
    },
}

impl CanvasMode {
    /// The default mode: infinite canvas (TS `DEFAULT_CANVAS_MODE`).
    pub fn default_mode() -> Self {
        Self::Infinite
    }

    /// Bounds of a bounded canvas at the origin, or `None` for infinite
    /// mode (TS `getCanvasBounds`).
    pub fn canvas_bounds(&self) -> Option<Bounds> {
        match self {
            Self::Infinite => None,
            Self::Bounded { width, height, .. } => Some(Bounds::new(0.0, 0.0, *width, *height)),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn infinite_is_default_with_null_bounds() {
        let mode = CanvasMode::default_mode();
        assert_eq!(mode, CanvasMode::Infinite);
        assert_eq!(mode.canvas_bounds(), None);
    }

    #[test]
    fn bounded_reports_origin_bounds() {
        let mode = CanvasMode::Bounded {
            width: 1920.0,
            height: 1080.0,
            background: None,
        };
        assert_eq!(
            mode.canvas_bounds(),
            Some(Bounds::new(0.0, 0.0, 1920.0, 1080.0))
        );
    }
}
