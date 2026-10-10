//! Shape extension boundary for extension-registered custom shapes.
//!
//! Custom shape *data* arrives through the extensible shape system; the
//! instance-scoped `ShapeRegistry` reserves custom type names.
//!
//! This module defines the [`ShapeExtension`] trait — the behavior contract
//! that extension-registered custom shapes implement. The trait is object-safe
//! so the registry can store `Box<dyn ShapeExtension>` and dispatch
//! render/hit-test/bounds without knowing the concrete type.
//!
//! Design rules: the trait is the *only* way custom shapes interact with
//! core internals (no mutable core state is exposed); all methods return
//! `Option` so the core can fall back to safe defaults (raw box) when a
//! extension declines to answer; the trait is `Send + Sync` so extensions can be
//! shared across threads in Tauri hosts.

use crate::element::CustomElement;
use crate::geometry::rect::Bounds;
use crate::render_model::DrawEntry;

/// Behavior extension for a extension-registered custom shape type.
///
/// Each implementation handles exactly one custom type name (returned by
/// [`ShapeExtension::type_name`]). The core dispatches render, hit-test,
/// and bounds queries to the registered extension when it encounters a
/// [`crate::element::Element::Custom`] whose `type_name` matches.
///
/// All methods return `Option` so the core can fall back to safe defaults
/// when a extension declines to answer. This keeps the boundary explicit:
/// a extension that returns `None` for `hit_test` gets the raw-box fallback,
/// never a silent wrong answer.
pub trait ShapeExtension: Send + Sync {
    /// The custom type name this extension handles (e.g. `"star"`).
    fn type_name(&self) -> &str;

    /// Provides a render description for `element`.
    ///
    /// Returns `None` to use the default render (raw box with the
    /// element's paint/stroke). The returned [`DrawEntry`] replaces the
    /// default entry entirely — the extension owns the full description.
    fn render_desc(&self, element: &CustomElement) -> Option<DrawEntry>;

    /// Hit-tests a scene-space point against `element`.
    ///
    /// Returns `None` to use the default hit test (raw unrotated box).
    fn hit_test(&self, element: &CustomElement, px: f64, py: f64) -> Option<bool>;

    /// Provides custom bounds for `element`.
    ///
    /// Returns `None` to use the default bounds (raw unrotated box).
    fn bounds(&self, element: &CustomElement) -> Option<Bounds>;

    /// Minimum drag size in scene units that commits a draw-create for
    /// this type (TS `hasMinimumSize` parity). The default (`None`)
    /// keeps the core `DRAW_MIN_SIZE = 2` fallback.
    fn minimum_size(&self) -> Option<f64> {
        None
    }

    /// Default element properties for a draw-create of this type, as
    /// (width, height) seed extents applied before the drag box overwrites
    /// the origin (TS `getDefaultProps` parity). The default (`None`)
    /// keeps the built-in factory defaults.
    fn default_size(&self) -> Option<(f64, f64)> {
        None
    }

    /// Builds a drag-created element for a custom type over the
    /// scene-space box (TS `onCreateDrag` parity). Returns `None` to fall
    /// back to the raw-box custom element. The default declines, so
    /// existing extensions keep working without changes.
    fn create_drag(
        &self,
        _id: &crate::element::ElementId,
        _x: f64,
        _y: f64,
        _width: f64,
        _height: f64,
    ) -> Option<crate::element::Element> {
        None
    }
}

/// Dispatches a render query to the registered extension for `type_name`.
///
/// Returns `None` when no extension is registered for the type or the
/// extension declines to answer.
pub fn dispatch_render(
    extension: &dyn ShapeExtension,
    element: &CustomElement,
) -> Option<DrawEntry> {
    extension.render_desc(element)
}

/// Dispatches a hit-test query to the registered extension for `type_name`.
///
/// Returns `None` when no extension is registered for the type or the
/// extension declines to answer.
pub fn dispatch_hit_test(
    extension: &dyn ShapeExtension,
    element: &CustomElement,
    px: f64,
    py: f64,
) -> Option<bool> {
    extension.hit_test(element, px, py)
}

/// Dispatches a bounds query to the registered extension for `type_name`.
///
/// Returns `None` when no extension is registered for the type or the
/// extension declines to answer.
pub fn dispatch_bounds(extension: &dyn ShapeExtension, element: &CustomElement) -> Option<Bounds> {
    extension.bounds(element)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::element::{BaseElement, ElementId};

    struct StarExtension;

    impl ShapeExtension for StarExtension {
        fn type_name(&self) -> &str {
            "star"
        }

        fn render_desc(&self, _element: &CustomElement) -> Option<DrawEntry> {
            None
        }

        fn hit_test(&self, _element: &CustomElement, px: f64, py: f64) -> Option<bool> {
            Some(px * px + py * py <= 100.0)
        }

        fn bounds(&self, _element: &CustomElement) -> Option<Bounds> {
            None
        }
    }

    fn custom_element(type_name: &str) -> CustomElement {
        CustomElement {
            base: BaseElement {
                id: ElementId::of("el-1"),
                x: 0.0,
                y: 0.0,
                width: 10.0,
                height: 10.0,
                rotation: 0.0,
                stroke_color: "#000".to_string(),
                background_color: crate::element::FillStyle::default_transparent(),
                stroke_width: 2.0,
                stroke_style: crate::element::StrokeStyle::Solid,
                stroke_cap: crate::element::StrokeCap::Butt,
                stroke_join: crate::element::StrokeJoin::Miter,
                stroke_align: crate::element::StrokeAlign::Center,
                fill_style: crate::element::ElementFillStyle::Solid,
                opacity: 100.0,
                seed: 1,
                version: 1,
                version_nonce: 1,
                is_deleted: false,
                group_ids: vec![],
                locked: false,
                hidden: false,
                frame_id: None,
                constraints: None,
                child_layout_sizing: None,
            },
            type_name: type_name.to_string(),
            data: std::collections::HashMap::new(),
        }
    }

    #[test]
    fn star_extension_hit_test() {
        let ext = StarExtension;
        let el = custom_element("star");
        assert_eq!(dispatch_hit_test(&ext, &el, 0.0, 0.0), Some(true));
        assert_eq!(dispatch_hit_test(&ext, &el, 20.0, 20.0), Some(false));
    }

    #[test]
    fn star_extension_declines_render_and_bounds() {
        let ext = StarExtension;
        let el = custom_element("star");
        assert!(dispatch_render(&ext, &el).is_none());
        assert!(dispatch_bounds(&ext, &el).is_none());
    }

    #[test]
    fn type_name_is_stable() {
        let ext = StarExtension;
        assert_eq!(ext.type_name(), "star");
    }
}
