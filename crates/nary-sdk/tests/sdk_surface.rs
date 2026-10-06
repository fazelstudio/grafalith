//! The SDK facade exposes everything an out-of-tree native plugin needs:
//! registration, a history-tracked command, and error/version plumbing —
//! with no direct engine imports in the plugin code below.

use nary_sdk::command::{CommandContext, CommandExtension};
use nary_sdk::element::{
    CustomElement, Element, ElementFillStyle, FillStyle, StrokeAlign, StrokeCap, StrokeJoin,
    StrokeStyle,
};
use nary_sdk::plugin::{Plugin, PluginContext, PluginMetadata, PluginRegistry};
use nary_sdk::{EngineResult, PROTOCOL_VERSION, SDK_VERSION};

struct Ping;

impl CommandExtension for Ping {
    fn command_id(&self) -> &str {
        "spec.ping.run"
    }

    fn execute(&self, ctx: &mut CommandContext) -> EngineResult<()> {
        let id = ctx.fresh_element_id();
        let seed = ctx.fresh_seed();
        let nonce = ctx.fresh_nonce();
        ctx.upsert(Element::Custom(CustomElement {
            base: nary_sdk::element::BaseElement {
                id,
                x: 0.0,
                y: 0.0,
                width: 10.0,
                height: 10.0,
                rotation: 0.0,
                stroke_color: "#000".to_string(),
                background_color: FillStyle::Solid {
                    color: "#fff".to_string(),
                },
                stroke_width: 1.0,
                stroke_style: StrokeStyle::Solid,
                stroke_cap: StrokeCap::default(),
                stroke_join: StrokeJoin::default(),
                stroke_align: StrokeAlign::default(),
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
            type_name: "spec.ping".to_string(),
            data: Default::default(),
        }))?;
        Ok(())
    }
}

struct SpecPlugin {
    metadata: nary_sdk::plugin::PluginMetadata,
}

impl Plugin for SpecPlugin {
    fn metadata(&self) -> &PluginMetadata {
        &self.metadata
    }

    fn register(&mut self, ctx: &mut PluginContext) {
        ctx.register_tool("spec.ping");
        ctx.register_command(Box::new(Ping));
    }
}

#[test]
fn sdk_surface_registers_and_executes_end_to_end() {
    assert!(!SDK_VERSION.is_empty());
    assert_eq!(PROTOCOL_VERSION, 1);
    let mut registry = PluginRegistry::new();
    registry
        .register(Box::new(SpecPlugin {
            metadata: PluginMetadata::new("spec.ping", "Spec Ping", "1.0.0"),
        }))
        .expect("compatible plugin registers");
    assert_eq!(registry.tools(), &["spec.ping".to_string()]);
    assert!(registry.command_by_id("spec.ping.run").is_some());

    // Through a real editor: one undoable entry, then undo restores.
    let mut editor = nary_core::editor::Editor::new();
    editor
        .register_plugin(Box::new(SpecPlugin {
            metadata: PluginMetadata::new("spec.ping", "Spec Ping", "1.0.0"),
        }))
        .expect("editor accepts the plugin");
    let outcome = editor
        .execute_plugin_command("spec.ping.run")
        .expect("command runs");
    assert!(outcome.changed);
    assert_eq!(editor.document().element_count(), 1);
    assert!(editor.undo().expect("undo works"));
    assert_eq!(editor.document().element_count(), 0);
}
