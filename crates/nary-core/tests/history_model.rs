//! History integration tests: commands, history, transactions, editor
//! state, and gesture cancellation.
//!
//! TS oracles: `history/history-manager.test.ts` (18 — basic undo/redo,
//! batching, redo-clear, limit, consecutive undo, canUndo/canRedo, destroy,
//! recordEntry), `remediation.test.ts` (batched-move redo invalidation,
//! z-order undo/redo, order-slot restore), and `editor/editor.test.ts`
//! (history + move/skip-locked flows).
//!
//! Paste scenarios are intentionally absent: the clipboard payload + remap
//! algorithm is covered by the clipboard suite.
//! The transaction API exercised here is the seam paste will commit through
//! (single history entry per paste, like the TS batch).

use nary_core::command::{
    Command, CommandContext, CommandOutcome, CreateElements, HistoryEntry, MoveElements, Reorder,
    SetStyle, StylePatch,
};
use nary_core::document::Document;
use nary_core::editor::{Editor, EditorEvent};
use nary_core::editor_state::EditorState;
use nary_core::element::{create_rectangle, CounterIdGenerator, Element, ElementId};
use nary_core::gesture::{GesturePhase, GestureSession, DRAG_THRESHOLD_PX};
use nary_core::history::{HistoryManager, DEFAULT_MAX_STACK_SIZE};
use nary_core::{EngineError, EngineResult};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn rectangle(id: &str, gen: &mut CounterIdGenerator) -> Element {
    let mut rect = create_rectangle(gen);
    rect.base.id = ElementId::of(id);
    Element::Rectangle(rect)
}

fn editor_with_two() -> (Editor, CounterIdGenerator) {
    let mut gen = CounterIdGenerator::new();
    let mut editor = Editor::new();
    editor.create(rectangle("a", &mut gen)).unwrap();
    editor.create(rectangle("b", &mut gen)).unwrap();
    assert_eq!(editor.history().undo_len(), 2);
    (editor, gen)
}

// ---------------------------------------------------------------------------
// Required scenarios
// ---------------------------------------------------------------------------

#[test]
fn scenario_create_undo_redo() {
    let mut doc = Document::new();
    let mut history = HistoryManager::new();
    let mut gen = CounterIdGenerator::new();

    history
        .execute(
            &mut doc,
            CreateElements::new(vec![rectangle("r1", &mut gen)]),
        )
        .unwrap();
    assert!(doc.contains("r1"));

    assert!(history.undo(&mut doc).unwrap());
    assert!(!doc.contains("r1"), "undo of create removes the element");

    assert!(history.redo(&mut doc).unwrap());
    assert!(doc.contains("r1"), "redo restores the creation");
    assert_eq!(doc.get("r1").unwrap().base().x, 0.0);
}

#[test]
fn scenario_move_undo_redo() {
    let mut doc = Document::new();
    let mut history = HistoryManager::new();
    let mut gen = CounterIdGenerator::new();
    history
        .execute(
            &mut doc,
            CreateElements::new(vec![rectangle("r1", &mut gen)]),
        )
        .unwrap();

    history
        .execute(
            &mut doc,
            MoveElements::new(vec![ElementId::of("r1")], 50.0, 60.0),
        )
        .unwrap();
    assert_eq!(doc.get("r1").unwrap().base().x, 50.0);

    assert!(history.undo(&mut doc).unwrap());
    assert_eq!(doc.get("r1").unwrap().base().x, 0.0);
    assert_eq!(doc.get("r1").unwrap().base().y, 0.0);

    assert!(history.redo(&mut doc).unwrap());
    assert_eq!(doc.get("r1").unwrap().base().x, 50.0);
}

#[test]
fn scenario_multi_object_move_is_one_entry_and_skips_locked() {
    let mut doc = Document::new();
    let mut history = HistoryManager::new();
    let mut gen = CounterIdGenerator::new();
    for id in ["a", "b", "c"] {
        history
            .execute(&mut doc, CreateElements::new(vec![rectangle(id, &mut gen)]))
            .unwrap();
    }
    // Lock "c" directly (the editor filters locked ids before commanding).
    nary_core::lock::lock_elements(&mut doc, &[ElementId::of("c")]).unwrap();

    let entries_before = history.undo_len();
    let outcome = history
        .execute(
            &mut doc,
            MoveElements::new(
                vec![
                    ElementId::of("a"),
                    ElementId::of("b"),
                    ElementId::of("c"),
                    ElementId::of("ghost"),
                ],
                10.0,
                0.0,
            ),
        )
        .unwrap();
    assert!(outcome.changed);
    assert_eq!(history.undo_len(), entries_before + 1);
    assert_eq!(doc.get("a").unwrap().base().x, 10.0);
    assert_eq!(doc.get("b").unwrap().base().x, 10.0);
    assert_eq!(
        doc.get("c").unwrap().base().x,
        0.0,
        "locked element is skipped"
    );

    assert!(history.undo(&mut doc).unwrap());
    assert_eq!(doc.get("a").unwrap().base().x, 0.0);
    assert_eq!(doc.get("b").unwrap().base().x, 0.0);
}

#[test]
fn scenario_style_mutation_undo_redo() {
    let mut doc = Document::new();
    let mut history = HistoryManager::new();
    let mut gen = CounterIdGenerator::new();
    history
        .execute(
            &mut doc,
            CreateElements::new(vec![rectangle("r1", &mut gen)]),
        )
        .unwrap();

    history
        .execute(
            &mut doc,
            SetStyle::new(
                vec![ElementId::of("r1")],
                StylePatch {
                    stroke_color: Some("#ff0000".to_string()),
                    opacity: Some(80.0),
                    ..StylePatch::default()
                },
            ),
        )
        .unwrap();
    assert_eq!(doc.get("r1").unwrap().base().stroke_color, "#ff0000");

    assert!(history.undo(&mut doc).unwrap());
    assert_eq!(doc.get("r1").unwrap().base().stroke_color, "#000000");

    assert!(history.redo(&mut doc).unwrap());
    assert_eq!(doc.get("r1").unwrap().base().stroke_color, "#ff0000");
}

#[test]
fn scenario_reorder_undo_redo() {
    let mut doc = Document::new();
    let mut history = HistoryManager::new();
    let mut gen = CounterIdGenerator::new();
    for id in ["a", "b", "c"] {
        history
            .execute(&mut doc, CreateElements::new(vec![rectangle(id, &mut gen)]))
            .unwrap();
    }
    let before = doc.order();
    let rotated = vec![ElementId::of("b"), ElementId::of("c"), ElementId::of("a")];
    history
        .execute(&mut doc, Reorder::new(rotated.clone()))
        .unwrap();
    assert_eq!(doc.order(), rotated);

    assert!(history.undo(&mut doc).unwrap());
    assert_eq!(doc.order(), before);

    assert!(history.redo(&mut doc).unwrap());
    assert_eq!(doc.order(), rotated);
}

#[test]
fn scenario_failed_command_leaves_state_safe() {
    let mut doc = Document::new();
    let mut history = HistoryManager::new();
    let mut gen = CounterIdGenerator::new();
    history
        .execute(
            &mut doc,
            CreateElements::new(vec![rectangle("r1", &mut gen)]),
        )
        .unwrap();
    let nonce_before = doc.scene_nonce();
    let snapshot = doc.to_snapshot();

    // Failure 1: pre-touch validation (invalid element in a batch).
    let mut bad = create_rectangle(&mut gen);
    bad.base.id = ElementId::of("bad");
    bad.base.width = f64::NAN;
    let err = history
        .execute(
            &mut doc,
            CreateElements::new(vec![rectangle("r2", &mut gen), Element::Rectangle(bad)]),
        )
        .unwrap_err();
    assert!(matches!(err, EngineError::InvalidInput(_)));
    assert!(!doc.contains("r2"));
    assert!(!doc.contains("bad"));
    assert_eq!(doc.to_snapshot(), snapshot, "content unchanged");
    assert_eq!(doc.scene_nonce(), nonce_before, "nonce untouched");
    assert_eq!(history.undo_len(), 1, "nothing recorded");

    // Failure 2: mid-application failure rolls back via a custom command
    // (external commands build next states through owned clones — the
    // concrete `base` field is public on each element struct).
    struct ShiftThenFail;
    impl Command for ShiftThenFail {
        fn label(&self) -> &str {
            "shift-then-fail"
        }
        fn execute(&mut self, ctx: &mut CommandContext) -> EngineResult<CommandOutcome> {
            ctx.upsert({
                let mut next = ctx.doc().get("r1").unwrap().clone();
                shift_x(&mut next, 25.0);
                next
            })?;
            Err(EngineError::InvalidInput("boom".to_string()))
        }
    }
    fn shift_x(element: &mut Element, dx: f64) {
        match element {
            Element::Rectangle(el) => el.base.x += dx,
            Element::Ellipse(el) => el.base.x += dx,
            Element::Line(el) => el.base.x += dx,
            Element::Arrow(el) => el.base.x += dx,
            Element::Text(el) => el.base.x += dx,
            Element::Freedraw(el) => el.base.x += dx,
            Element::Frame(el) => el.base.x += dx,
            Element::Image(el) => el.base.x += dx,
            Element::Path(el) => el.base.x += dx,
            Element::Instance(el) => el.base.x += dx,
            Element::Custom(el) => el.base.x += dx,
        }
    }
    let err = history.execute(&mut doc, ShiftThenFail).unwrap_err();
    assert!(matches!(err, EngineError::InvalidInput(_)));
    assert_eq!(
        doc.to_snapshot(),
        snapshot,
        "mid-application failure rolls back content"
    );
    assert!(doc.validate().is_ok());
    assert_eq!(history.undo_len(), 1, "failed command records nothing");
}

#[test]
fn scenario_undo_then_new_mutation_clears_redo() {
    let mut doc = Document::new();
    let mut history = HistoryManager::new();
    let mut gen = CounterIdGenerator::new();
    history
        .execute(
            &mut doc,
            CreateElements::new(vec![rectangle("r1", &mut gen)]),
        )
        .unwrap();
    history
        .execute(
            &mut doc,
            MoveElements::new(vec![ElementId::of("r1")], 10.0, 0.0),
        )
        .unwrap();
    assert!(history.undo(&mut doc).unwrap());
    assert!(history.can_redo());

    history
        .execute(
            &mut doc,
            MoveElements::new(vec![ElementId::of("r1")], 20.0, 0.0),
        )
        .unwrap();
    assert!(!history.can_redo(), "new mutation clears redo");
    assert_eq!(doc.get("r1").unwrap().base().x, 20.0);

    // Committing a transaction clears redo too (batched-move parity).
    assert!(history.undo(&mut doc).unwrap());
    assert!(history.can_redo());
    history.begin_transaction(&doc);
    history
        .execute(
            &mut doc,
            MoveElements::new(vec![ElementId::of("r1")], 5.0, 0.0),
        )
        .unwrap();
    history.commit_transaction(&doc);
    assert!(!history.can_redo());
}

// ---------------------------------------------------------------------------
// Grouped operations / transactions
// ---------------------------------------------------------------------------

#[test]
fn grouped_create_plus_style_is_one_undo_step() {
    let mut doc = Document::new();
    let mut history = HistoryManager::new();
    let mut gen = CounterIdGenerator::new();

    history
        .transaction(&mut doc, |ctx| {
            ctx.upsert(rectangle("r1", &mut gen))?;
            ctx.upsert(rectangle("r2", &mut gen))?;
            let mut styled = ctx.doc().get("r1").unwrap().clone();
            match &mut styled {
                Element::Rectangle(el) => {
                    el.base.stroke_color = "#ff0000".to_string();
                }
                _ => unreachable!(),
            }
            ctx.upsert(styled)?;
            Ok(())
        })
        .unwrap();

    assert_eq!(history.undo_len(), 1, "grouped ops collapse to one entry");
    assert_eq!(doc.get("r1").unwrap().base().stroke_color, "#ff0000");

    assert!(history.undo(&mut doc).unwrap());
    assert!(!doc.contains("r1"));
    assert!(!doc.contains("r2"));

    assert!(history.redo(&mut doc).unwrap());
    assert_eq!(doc.get("r1").unwrap().base().stroke_color, "#ff0000");
}

#[test]
fn transaction_failure_is_atomic() {
    let mut doc = Document::new();
    let mut history = HistoryManager::new();
    let mut gen = CounterIdGenerator::new();
    history
        .execute(
            &mut doc,
            CreateElements::new(vec![rectangle("r1", &mut gen)]),
        )
        .unwrap();
    let snapshot = doc.to_snapshot();

    let err = history
        .transaction(&mut doc, |ctx| {
            ctx.upsert(rectangle("r2", &mut gen))?;
            let mut bad = rectangle("r3", &mut gen);
            match &mut bad {
                Element::Rectangle(el) => el.base.width = f64::NAN,
                _ => unreachable!(),
            }
            ctx.upsert(bad)?;
            Ok(())
        })
        .unwrap_err();
    assert!(matches!(err, EngineError::InvalidInput(_)));
    assert_eq!(doc.to_snapshot(), snapshot);
    assert_eq!(history.undo_len(), 1);
}

#[test]
fn cancel_transaction_rolls_back_without_history() {
    let mut doc = Document::new();
    let mut history = HistoryManager::new();
    let mut gen = CounterIdGenerator::new();
    history
        .execute(
            &mut doc,
            CreateElements::new(vec![rectangle("r1", &mut gen)]),
        )
        .unwrap();

    history.begin_transaction(&doc);
    history
        .execute(
            &mut doc,
            MoveElements::new(vec![ElementId::of("r1")], 30.0, 0.0),
        )
        .unwrap();
    assert_eq!(doc.get("r1").unwrap().base().x, 30.0);
    history.cancel_transaction(&mut doc).unwrap();

    assert_eq!(doc.get("r1").unwrap().base().x, 0.0);
    assert_eq!(history.undo_len(), 1, "cancel records nothing");
    assert!(!history.can_redo(), "cancel preserves redo state");
    assert!(doc.validate().is_ok());
}

#[test]
fn manual_record_entry_round_trip() {
    let mut doc = Document::new();
    let mut history = HistoryManager::new();
    let mut gen = CounterIdGenerator::new();
    history
        .execute(
            &mut doc,
            CreateElements::new(vec![rectangle("r1", &mut gen)]),
        )
        .unwrap();

    let before = doc.get("r1").unwrap().clone();
    let mut after = before.clone();
    match &mut after {
        Element::Rectangle(el) => el.base.x = 100.0,
        _ => unreachable!(),
    }
    let mut updates = std::collections::HashMap::new();
    updates.insert(
        ElementId::of("r1"),
        nary_core::command::SlotDelta {
            before: Some(before),
            after: Some(after),
        },
    );
    history.record_entry(HistoryEntry {
        element_updates: updates,
        order_before: None,
        order_after: None,
    });
    assert_eq!(history.undo_len(), 2);
    assert!(history.undo(&mut doc).unwrap());
    assert_eq!(doc.get("r1").unwrap().base().x, 0.0);
}

#[test]
fn stack_limit_and_status() {
    assert_eq!(DEFAULT_MAX_STACK_SIZE, 100);
    let mut history = HistoryManager::with_max_stack_size(3);
    let mut doc = Document::new();
    let mut gen = CounterIdGenerator::new();
    for i in 0..5 {
        history
            .execute(
                &mut doc,
                CreateElements::new(vec![rectangle(&format!("r{i}"), &mut gen)]),
            )
            .unwrap();
    }
    assert_eq!(history.undo_len(), 3);
    let status = history.status();
    assert!(status.can_undo);
    assert!(!status.can_redo);
}

#[test]
fn destroy_detaches_without_blocking_mutation() {
    let mut doc = Document::new();
    let mut history = HistoryManager::new();
    let mut gen = CounterIdGenerator::new();
    history
        .execute(
            &mut doc,
            CreateElements::new(vec![rectangle("r1", &mut gen)]),
        )
        .unwrap();
    history.destroy();
    history
        .execute(
            &mut doc,
            MoveElements::new(vec![ElementId::of("r1")], 10.0, 0.0),
        )
        .unwrap();
    assert_eq!(doc.get("r1").unwrap().base().x, 10.0);
    assert_eq!(history.undo_len(), 1);
}

// ---------------------------------------------------------------------------
// Selection / editor state
// ---------------------------------------------------------------------------

#[test]
fn editor_state_tool_gate_and_viewport_defaults() {
    let state = EditorState::new();
    assert_eq!(state.active_tool, "select");
    assert_eq!(state.viewport.zoom, 1.0);

    let mut gated = EditorState::with_enabled_tools(vec!["select".to_string()]);
    assert!(gated.set_active_tool("select"));
    assert!(!gated.set_active_tool("rectangle"));
    assert_eq!(gated.active_tool, "select");
}

#[test]
fn editor_selection_and_events() {
    let (mut editor, _) = editor_with_two();
    editor.select(vec![ElementId::of("a"), ElementId::of("b")]);
    editor.toggle_selection(ElementId::of("b"));
    assert_eq!(editor.state().selection.ids(), &[ElementId::of("a")]);
    editor.clear_selection();
    assert!(editor.state().selection.is_empty());

    let saw_selection = editor
        .drain_events()
        .iter()
        .any(|event| matches!(event, EditorEvent::SelectionChanged(_)));
    assert!(saw_selection, "selection ops notify");
}

// ---------------------------------------------------------------------------
// Gestures and cancellation
// ---------------------------------------------------------------------------

#[test]
fn gesture_threshold_click_never_becomes_drag() {
    assert_eq!(DRAG_THRESHOLD_PX, 4.0);
    let mut gesture = GestureSession::begin(vec![ElementId::of("a")], 0.0, 0.0).unwrap();
    assert_eq!(gesture.phase(), GesturePhase::Pressed);
    assert!(!gesture.update(2.0, 2.0).unwrap());
    assert!(gesture.commit_move().is_none());
    gesture.cancel();
}

#[test]
fn editor_drag_commits_single_entry_and_cancels_cleanly() {
    let (mut editor, _) = editor_with_two();
    let undo_before = editor.history().undo_len();

    editor
        .gesture_begin(vec![ElementId::of("a")], 0.0, 0.0)
        .unwrap();
    editor.gesture_update(1.0, 1.0).unwrap();
    assert!(!editor.gesture_commit().unwrap(), "click commits nothing");
    assert_eq!(editor.history().undo_len(), undo_before);

    editor
        .gesture_begin(vec![ElementId::of("a")], 0.0, 0.0)
        .unwrap();
    assert!(editor.gesture_update(10.0, 5.0).unwrap());
    assert!(editor.gesture_commit().unwrap());
    assert_eq!(editor.history().undo_len(), undo_before + 1);
    assert_eq!(editor.document().get("a").unwrap().base().x, 10.0);

    editor
        .gesture_begin(vec![ElementId::of("a")], 10.0, 5.0)
        .unwrap();
    editor.gesture_update(99.0, 99.0).unwrap();
    editor.gesture_cancel().unwrap();
    assert_eq!(editor.document().get("a").unwrap().base().x, 10.0);
    assert_eq!(editor.history().undo_len(), undo_before + 1);
    assert!(editor.document().validate().is_ok());
}

#[test]
fn delete_selected_skips_locked_via_editor_filter() {
    let (mut editor, _) = editor_with_two();
    // Lock "b" through the editor intent, then delete both through the
    // editor after filtering locked ids (TS `deleteSelected` parity).
    editor.lock(vec![ElementId::of("b")]).unwrap();
    let ids: Vec<ElementId> = ["a", "b"]
        .iter()
        .map(|id| ElementId::of(*id))
        .filter(|id| {
            editor
                .document()
                .get(id.as_str())
                .map(|el| !el.base().locked)
                .unwrap_or(false)
        })
        .collect();
    assert_eq!(ids, vec![ElementId::of("a")]);
    editor.delete(ids).unwrap();
    assert!(editor.document().get("a").unwrap().base().is_deleted);
    assert!(!editor.document().get("b").unwrap().base().is_deleted);

    assert!(editor.undo().unwrap());
    assert!(!editor.document().get("a").unwrap().base().is_deleted);
    assert!(editor.redo().unwrap());
    assert!(editor.document().get("a").unwrap().base().is_deleted);
}
