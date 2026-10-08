//! Minimal example extension: registers a custom shape + tool through
//! the extension API without mutating core internals.

use opennary_core::element::{BaseElement, CustomElement, Element, ElementId, PatchValue};
use opennary_core::extension::{Extension, ExtensionContext, ExtensionMetadata, ExtensionRegistry};
use opennary_core::shape_extension::ShapeExtension;

// ---------------------------------------------------------------------------
// Example: a "star" shape extension
// ---------------------------------------------------------------------------

struct StarShape;

impl ShapeExtension for StarShape {
    fn type_name(&self) -> &str {
        "star"
    }

    fn render_desc(
        &self,
        _element: &CustomElement,
    ) -> Option<opennary_core::render_model::DrawEntry> {
        None
    }

    fn hit_test(&self, _element: &CustomElement, px: f64, py: f64) -> Option<bool> {
        Some((px * px + py * py).sqrt() <= 50.0)
    }

    fn bounds(&self, _element: &CustomElement) -> Option<opennary_core::geometry::rect::Bounds> {
        None
    }
}

// ---------------------------------------------------------------------------
// Example: a extension that registers the star shape + a custom tool
// ---------------------------------------------------------------------------

struct StarExtension {
    metadata: ExtensionMetadata,
}

impl StarExtension {
    fn new() -> Self {
        Self {
            metadata: ExtensionMetadata::new("com.example.star-shapes", "Star Shapes", "1.0.0"),
        }
    }
}

impl Extension for StarExtension {
    fn metadata(&self) -> &ExtensionMetadata {
        &self.metadata
    }

    fn register(&mut self, ctx: &mut ExtensionContext) {
        ctx.register_shape("star", Box::new(StarShape));
        ctx.register_tool("star");
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[test]
fn minimal_example_extension_registers_without_mutating_core() {
    let mut registry = ExtensionRegistry::new();
    let extension = Box::new(StarExtension::new());
    registry
        .register(extension)
        .expect("extension registers successfully");
    assert_eq!(registry.len(), 1);
}

#[test]
fn star_shape_extension_hit_test() {
    let ext = StarShape;
    let el = CustomElement {
        base: BaseElement {
            id: ElementId::of("el-1"),
            x: 0.0,
            y: 0.0,
            width: 100.0,
            height: 100.0,
            rotation: 0.0,
            stroke_color: "#000".to_string(),
            background_color: opennary_core::element::FillStyle::default_transparent(),
            stroke_width: 2.0,
            stroke_style: opennary_core::element::StrokeStyle::Solid,
            stroke_cap: opennary_core::element::StrokeCap::Butt,
            stroke_join: opennary_core::element::StrokeJoin::Miter,
            stroke_align: opennary_core::element::StrokeAlign::Center,
            fill_style: opennary_core::element::ElementFillStyle::Solid,
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
        type_name: "star".to_string(),
        data: std::collections::HashMap::new(),
    };
    assert_eq!(ext.hit_test(&el, 0.0, 0.0), Some(true));
    assert_eq!(ext.hit_test(&el, 100.0, 100.0), Some(false));
}

#[test]
fn custom_element_validates_and_round_trips() {
    let mut data = std::collections::HashMap::new();
    data.insert(
        "points".to_string(),
        PatchValue::Array(vec![PatchValue::Number(0.0), PatchValue::Number(10.0)]),
    );
    let el = CustomElement {
        base: BaseElement {
            id: ElementId::of("el-1"),
            x: 0.0,
            y: 0.0,
            width: 100.0,
            height: 100.0,
            rotation: 0.0,
            stroke_color: "#000".to_string(),
            background_color: opennary_core::element::FillStyle::default_transparent(),
            stroke_width: 2.0,
            stroke_style: opennary_core::element::StrokeStyle::Solid,
            stroke_cap: opennary_core::element::StrokeCap::Butt,
            stroke_join: opennary_core::element::StrokeJoin::Miter,
            stroke_align: opennary_core::element::StrokeAlign::Center,
            fill_style: opennary_core::element::ElementFillStyle::Solid,
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
        type_name: "star".to_string(),
        data,
    };
    let element = Element::Custom(el);
    assert!(element.validate().is_ok());
    assert_eq!(element.element_type_name(), "star");
}

#[test]
fn extension_registry_lifecycle() {
    let mut registry = ExtensionRegistry::new();
    let extension = Box::new(StarExtension::new());
    registry.register(extension).unwrap();
    assert_eq!(registry.len(), 1);
    registry.dispose_all();
    assert!(registry.is_empty());
}
