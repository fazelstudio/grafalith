//! `ext-sticker`: an out-of-workspace Nary plugin (M6).
//!
//! A third-party crate that adds a node type (`example.sticker`), a tool
//! (`example.sticker`), and a command (`example.sticker.create`) without
//! modifying engine sources. It depends on `nary-core` only, through the
//! public plugin traits.

use std::collections::HashMap;

use nary_core::command::CommandContext;
use nary_core::command_extension::CommandExtension;
use nary_core::element::{
    BaseElement, CustomElement, Element, ElementFillStyle, FillStyle, PatchValue, StrokeStyle,
};
use nary_core::geometry::rect::Bounds;
use nary_core::plugin::{Plugin, PluginContext, PluginMetadata};
use nary_core::render_model::DrawEntry;
use nary_core::EngineResult;

/// Discriminator for sticker elements (namespaced per ADR-0016).
pub const STICKER_TYPE: &str = "example.sticker";

/// Tool id for the sticker tool (host-owned draw behavior).
pub const STICKER_TOOL: &str = "example.sticker";

/// Command id for sticker creation.
pub const STICKER_CREATE_COMMAND: &str = "example.sticker.create";

/// Default sticker size in scene units.
pub const STICKER_SIZE: f64 = 120.0;

/// Builds a sticker element with fresh defaults (ids come from the caller
/// so tests stay deterministic; commands mint them from the context).
pub fn sticker_element(
    id: impl Into<String>,
    seed: u32,
    nonce: u32,
    x: f64,
    y: f64,
    faces: f64,
    label: impl Into<String>,
) -> Element {
    let mut data = HashMap::new();
    data.insert("faces".to_string(), PatchValue::Number(faces));
    data.insert("label".to_string(), PatchValue::Text(label.into()));
    Element::Custom(CustomElement {
        base: BaseElement {
            id: nary_core::element::ElementId::of(id.into()),
            x,
            y,
            width: STICKER_SIZE,
            height: STICKER_SIZE,
            rotation: 0.0,
            stroke_color: "#333333".to_string(),
            background_color: FillStyle::Solid {
                color: "#ffd54a".to_string(),
            },
            stroke_width: 2.0,
            stroke_style: StrokeStyle::Solid,
            fill_style: ElementFillStyle::Solid,
            opacity: 100.0,
            seed,
            version: 0,
            version_nonce: nonce,
            is_deleted: false,
            group_ids: Vec::new(),
            locked: false,
            hidden: false,
            frame_id: None,
            constraints: None,
            child_layout_sizing: None,
        },
        type_name: STICKER_TYPE.to_string(),
        data,
    })
}

/// Circle behavior for the square sticker box: corners miss.
pub struct StickerShape;

impl nary_core::shape_extension::ShapeExtension for StickerShape {
    fn type_name(&self) -> &str {
        STICKER_TYPE
    }

    fn render_desc(&self, _element: &CustomElement) -> Option<DrawEntry> {
        // Hosts draw stickers from the `Custom{type_name, data}` entry the
        // render model already carries — no engine raster here (ADR-0017).
        None
    }

    fn hit_test(&self, element: &CustomElement, px: f64, py: f64) -> Option<bool> {
        let base = &element.base;
        let cx = base.x + base.width / 2.0;
        let cy = base.y + base.height / 2.0;
        let radius = base.width.min(base.height) / 2.0;
        Some((px - cx).hypot(py - cy) <= radius)
    }

    fn bounds(&self, element: &CustomElement) -> Option<Bounds> {
        let base = &element.base;
        Some(Bounds::from_xywh(base.x, base.y, base.width, base.height))
    }

    fn default_size(&self) -> Option<(f64, f64)> {
        Some((STICKER_SIZE, STICKER_SIZE))
    }
}

/// Creates one sticker as a history-tracked command.
pub struct StickerCreate;

impl CommandExtension for StickerCreate {
    fn command_id(&self) -> &str {
        STICKER_CREATE_COMMAND
    }

    fn execute(&self, ctx: &mut CommandContext) -> EngineResult<()> {
        let id = ctx.fresh_element_id();
        let seed = ctx.fresh_seed();
        let nonce = ctx.fresh_nonce();
        ctx.upsert(sticker_element(id.as_str(), seed, nonce, 100.0, 100.0, 5.0, "star"))?;
        Ok(())
    }
}

/// The plugin: one tool, one shape, one command.
pub struct StickerPlugin {
    metadata: PluginMetadata,
}

impl StickerPlugin {
    /// Creates the plugin with its/default metadata.
    pub fn new() -> Self {
        Self {
            metadata: PluginMetadata::new(
                "com.example.sticker",
                "Example Sticker",
                env!("CARGO_PKG_VERSION"),
            ),
        }
    }
}

impl Default for StickerPlugin {
    fn default() -> Self {
        Self::new()
    }
}

impl Plugin for StickerPlugin {
    fn metadata(&self) -> &PluginMetadata {
        &self.metadata
    }

    fn register(&mut self, ctx: &mut PluginContext) {
        ctx.register_tool(STICKER_TOOL);
        ctx.register_shape(STICKER_TYPE, Box::new(StickerShape));
        ctx.register_command(Box::new(StickerCreate));
    }
}
