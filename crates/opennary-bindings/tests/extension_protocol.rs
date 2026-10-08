//! `executeCommand` protocol tests: extension commands are registered natively
//! (Rust objects never cross the JSON boundary) and dispatched dynamically
//! by id through `ExtensionRegistry::command_by_id` as one undoable step.

use opennary_bindings::Engine;
use opennary_core::command::CommandContext;
use opennary_core::command_extension::CommandExtension;
use opennary_core::element::{create_rectangle, CounterIdGenerator, Element};
use opennary_core::extension::{Extension, ExtensionContext, ExtensionMetadata};
use opennary_core::EngineResult;
use serde_json::{json, Value};

struct StampCreate;

impl CommandExtension for StampCreate {
    fn command_id(&self) -> &str {
        "acme.stamp.create"
    }

    fn execute(&self, ctx: &mut CommandContext) -> EngineResult<()> {
        let mut gen = CounterIdGenerator::new();
        ctx.upsert(Element::Rectangle(create_rectangle(&mut gen)))?;
        Ok(())
    }
}

struct StampExtension {
    metadata: ExtensionMetadata,
}

impl Extension for StampExtension {
    fn metadata(&self) -> &ExtensionMetadata {
        &self.metadata
    }

    fn register(&mut self, ctx: &mut ExtensionContext) {
        ctx.register_tool("acme.stamp");
        ctx.register_command(Box::new(StampCreate));
    }
}

fn engine_with_stamp() -> Engine {
    let mut engine = Engine::new();
    engine
        .register_extension(Box::new(StampExtension {
            metadata: ExtensionMetadata::new("com.acme.stamp", "Acme Stamp", "1.0.0"),
        }))
        .expect("compatible extension registers");
    engine
}

fn run(engine: &mut Engine, ops: Value) -> Value {
    let out = engine.apply_batch(&ops.to_string());
    serde_json::from_str(&out).expect("batch result parses")
}

#[test]
fn execute_command_unknown_id_is_not_found_and_batch_continues() {
    let mut engine = Engine::new();
    let result = run(
        &mut engine,
        json!([
            {"op": "executeCommand", "commandId": "acme.missing.nope"},
            {"op": "sessionState"},
        ]),
    );
    let results = result["results"].as_array().expect("results array");
    assert_eq!(results.len(), 2);
    assert_eq!(results[0]["op"], "executeCommand");
    assert_eq!(results[0]["ok"], false);
    assert_eq!(results[0]["code"], "notFound");
    assert_eq!(results[1]["op"], "sessionState");
    assert_eq!(results[1]["ok"], true);
    assert_eq!(result["applied"], 1);
}

#[test]
fn execute_command_runs_extension_command_as_one_undoable_step() {
    let mut engine = engine_with_stamp();
    let result = run(
        &mut engine,
        json!([
            {"op": "executeCommand", "commandId": "acme.stamp.create"},
        ]),
    );
    assert_eq!(result["results"][0]["op"], "executeCommand");
    assert_eq!(result["results"][0]["ok"], true);
    assert_eq!(result["results"][0]["data"]["changed"], true);
    assert_eq!(engine.element_count(), 1);

    let undo = run(&mut engine, json!([{"op": "undo"}]));
    assert_eq!(undo["results"][0]["ok"], true);
    assert_eq!(engine.element_count(), 0);

    let redo = run(&mut engine, json!([{"op": "redo"}]));
    assert_eq!(redo["results"][0]["ok"], true);
    assert_eq!(engine.element_count(), 1);
}

#[test]
fn registered_extension_tool_is_accepted_by_set_tool() {
    let mut engine = engine_with_stamp();
    let result = run(
        &mut engine,
        json!([{"op": "setTool", "tool": "acme.stamp"}]),
    );
    assert_eq!(result["results"][0]["ok"], true);
    assert_eq!(result["results"][0]["data"]["accepted"], true);
    assert_eq!(result["results"][0]["data"]["tool"], "acme.stamp");
}
