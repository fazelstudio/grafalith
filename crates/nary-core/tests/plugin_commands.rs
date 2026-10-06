//! Plugin inlet on [`Editor`](nary_core::editor::Editor): registration wires
//! tool ids into the live session, and plugin commands execute through the
//! same history machinery as built-in commands (one undo entry per run,
//! rollback on failure, silence on no-op).

use nary_core::command::CommandContext;
use nary_core::command_extension::CommandExtension;
use nary_core::editor::Editor;
use nary_core::element::{create_rectangle, CounterIdGenerator, Element};
use nary_core::interaction::ToolId;
use nary_core::plugin::{Plugin, PluginContext, PluginMetadata};
use nary_core::{EngineError, EngineResult};

/// Command that creates one rectangle through the context (history-tracked).
struct CreateSticker;

impl CommandExtension for CreateSticker {
    fn command_id(&self) -> &str {
        "acme.sticker.create"
    }

    fn execute(&self, ctx: &mut CommandContext) -> EngineResult<()> {
        let mut gen = CounterIdGenerator::new();
        ctx.upsert(Element::Rectangle(create_rectangle(&mut gen)))?;
        Ok(())
    }
}

/// Command that mutates and then fails (must roll back entirely).
struct FailAfterWrite;

impl CommandExtension for FailAfterWrite {
    fn command_id(&self) -> &str {
        "acme.broken.write"
    }

    fn execute(&self, ctx: &mut CommandContext) -> EngineResult<()> {
        let mut gen = CounterIdGenerator::new();
        ctx.upsert(Element::Rectangle(create_rectangle(&mut gen)))?;
        Err(EngineError::InvalidInput(
            "simulated command failure".to_string(),
        ))
    }
}

/// Command that succeeds without touching the document (records nothing).
struct NoopCommand;

impl CommandExtension for NoopCommand {
    fn command_id(&self) -> &str {
        "acme.noop.ping"
    }

    fn execute(&self, _ctx: &mut CommandContext) -> EngineResult<()> {
        Ok(())
    }
}

struct AcmePlugin {
    metadata: PluginMetadata,
}

impl AcmePlugin {
    fn new() -> Self {
        Self {
            metadata: PluginMetadata::new("com.acme.sticker", "Acme Sticker", "1.0.0"),
        }
    }
}

impl Plugin for AcmePlugin {
    fn metadata(&self) -> &PluginMetadata {
        &self.metadata
    }

    fn register(&mut self, ctx: &mut PluginContext) {
        ctx.register_tool("acme.sticker");
        ctx.register_command(Box::new(CreateSticker));
        ctx.register_command(Box::new(FailAfterWrite));
        ctx.register_command(Box::new(NoopCommand));
    }
}

fn registered_editor() -> Editor {
    let mut editor = Editor::new();
    editor
        .register_plugin(Box::new(AcmePlugin::new()))
        .expect("compatible plugin registers");
    editor
}

#[test]
fn register_plugin_wires_tool_ids_into_live_session() {
    let editor = registered_editor();
    assert!(editor
        .tool_registry()
        .contains(&ToolId::Custom("acme.sticker".to_string())));
    assert_eq!(
        editor.plugin_command_ids(),
        vec![
            "acme.sticker.create".to_string(),
            "acme.broken.write".to_string(),
            "acme.noop.ping".to_string(),
        ]
    );
}

#[test]
fn incompatible_plugin_changes_nothing() {
    let mut editor = Editor::new();
    struct OldPlugin {
        metadata: PluginMetadata,
    }
    impl Plugin for OldPlugin {
        fn metadata(&self) -> &PluginMetadata {
            &self.metadata
        }
        fn register(&mut self, ctx: &mut PluginContext) {
            ctx.register_tool("old.tool");
        }
    }
    let result = editor.register_plugin(Box::new(OldPlugin {
        metadata: PluginMetadata {
            id: "old.plugin".to_string(),
            name: "Old".to_string(),
            version: "0.1.0".to_string(),
            min_protocol_version: 0,
            max_protocol_version: 0,
        },
    }));
    assert!(result.is_err());
    assert!(!editor
        .tool_registry()
        .contains(&ToolId::Custom("old.tool".to_string())));
    assert!(editor.plugin_command_ids().is_empty());
}

#[test]
fn unknown_plugin_command_is_not_found_and_changes_nothing() {
    let mut editor = registered_editor();
    let nonce_before = editor.document().scene_nonce();
    let result = editor.execute_plugin_command("acme.missing.nope");
    assert!(matches!(result, Err(EngineError::NotFound(_))));
    assert_eq!(editor.document().scene_nonce(), nonce_before);
    assert_eq!(editor.document().element_count(), 0);
    assert!(!editor.history().can_undo());
}

#[test]
fn plugin_command_create_is_one_undoable_entry() {
    let mut editor = registered_editor();
    let outcome = editor
        .execute_plugin_command("acme.sticker.create")
        .expect("known command runs");
    assert!(outcome.changed);
    assert_eq!(editor.document().element_count(), 1);
    assert_eq!(editor.history().undo_len(), 1);

    assert!(editor.undo().expect("undo works"));
    assert_eq!(editor.document().element_count(), 0);

    assert!(editor.redo().expect("redo works"));
    assert_eq!(editor.document().element_count(), 1);
}

#[test]
fn failing_plugin_command_rolls_back_and_records_nothing() {
    let mut editor = registered_editor();
    let result = editor.execute_plugin_command("acme.broken.write");
    assert!(matches!(result, Err(EngineError::InvalidInput(_))));
    assert_eq!(editor.document().element_count(), 0);
    assert!(!editor.history().can_undo());
}

#[test]
fn noop_plugin_command_records_nothing_and_preserves_redo() {
    let mut editor = registered_editor();
    // One real entry first, then undo so the redo stack is non-empty.
    editor
        .execute_plugin_command("acme.sticker.create")
        .expect("create runs");
    editor.undo().expect("undo works");
    assert!(editor.history().can_redo());

    let outcome = editor
        .execute_plugin_command("acme.noop.ping")
        .expect("noop runs");
    assert!(!outcome.changed);
    assert!(editor.history().can_redo());
    assert_eq!(editor.history().undo_len(), 0);
}
