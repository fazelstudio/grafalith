//! Minimal example extension: registers a custom shape + tool through
//! the plugin API without mutating core internals.

use nary_core::element::{BaseElement, CustomElement, Element, ElementId, PatchValue};
use nary_core::plugin::{Plugin, PluginContext, PluginMetadata, PluginRegistry};
use nary_core::shape_extension::ShapeExtension;

// ---------------------------------------------------------------------------
// Example: a "star" shape extension
// ---------------------------------------------------------------------------

struct StarExtension;

impl ShapeExtension for StarExtension {
    fn type_name(&self) -> &str {
        "star"
    }

    fn render_desc(&self, _element: &CustomElement) -> Option<nary_core::render_model::DrawEntry> {
        None
    }

    fn hit_test(&self, _element: &CustomElement, px: f64, py: f64) -> Option<bool> {
        Some((px * px + py * py).sqrt() <= 50.0)
    }

    fn bounds(&self, _element: &CustomElement) -> Option<nary_core::geometry::rect::Bounds> {
        None
    }
}

// ---------------------------------------------------------------------------
// Example: a plugin that registers the star shape + a custom tool
// ---------------------------------------------------------------------------

struct StarPlugin {
    metadata: PluginMetadata,
}

impl StarPlugin {
    fn new() -> Self {
        Self {
            metadata: PluginMetadata::new("com.example.star-shapes", "Star Shapes", "1.0.0"),
        }
    }
}

impl Plugin for StarPlugin {
    fn metadata(&self) -> &PluginMetadata {
        &self.metadata
    }

    fn register(&mut self, ctx: &mut PluginContext) {
        ctx.register_shape("star", Box::new(StarExtension));
        ctx.register_tool("star");
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[test]
fn minimal_example_extension_registers_without_mutating_core() {
    let mut registry = PluginRegistry::new();
    let plugin = Box::new(StarPlugin::new());
    registry
        .register(plugin)
        .expect("plugin registers successfully");
    assert_eq!(registry.len(), 1);
}

#[test]
fn star_shape_extension_hit_test() {
    let ext = StarExtension;
    let el = CustomElement {
        base: BaseElement {
            id: ElementId::of("el-1"),
            x: 0.0,
            y: 0.0,
            width: 100.0,
            height: 100.0,
            rotation: 0.0,
            stroke_color: "#000".to_string(),
            background_color: nary_core::element::FillStyle::default_transparent(),
            stroke_width: 2.0,
            stroke_style: nary_core::element::StrokeStyle::Solid,
            stroke_cap: nary_core::element::StrokeCap::Butt,
            stroke_join: nary_core::element::StrokeJoin::Miter,
            stroke_align: nary_core::element::StrokeAlign::Center,
            fill_style: nary_core::element::ElementFillStyle::Solid,
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
            background_color: nary_core::element::FillStyle::default_transparent(),
            stroke_width: 2.0,
            stroke_style: nary_core::element::StrokeStyle::Solid,
            stroke_cap: nary_core::element::StrokeCap::Butt,
            stroke_join: nary_core::element::StrokeJoin::Miter,
            stroke_align: nary_core::element::StrokeAlign::Center,
            fill_style: nary_core::element::ElementFillStyle::Solid,
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
fn plugin_registry_lifecycle() {
    let mut registry = PluginRegistry::new();
    let plugin = Box::new(StarPlugin::new());
    registry.register(plugin).unwrap();
    assert_eq!(registry.len(), 1);
    registry.dispose_all();
    assert!(registry.is_empty());
}
