//! Thin editor shell: intent routing over owned state.
//!
//! TS sources: `packages/core/src/editor/editor.ts` (facade shape,
//! `moveElements`/`resizeElement`/`rotateElement` guards, selection/tool/
//! history/viewport method families, tool-switch cancellation, undo guards
//! during active gestures, the pointer state machine with
//! `pendingCollapseIds` group-collapse deferral, double-click text/group
//! paths, right-click select, Escape/`pointercancel` cancel paths) and
//! `packages/core/src/interaction/selection.ts` (group-aware click,
//! rubber-band, `deleteSelected` frame release, `nudgeSelected`).
//!
//! This shell is the full host-neutral interaction runtime. Pointer,
//! keyboard, text, and wheel flows arrive as normalized [`InputEvent`]s
//! (DOM/browser translation stays host-side) and run through a
//! deterministic phase machine ([`EditorPointerPhase`]) with the TS
//! threshold, selection, group, locked-guard, snap-hook, and cancel
//! semantics. Every persistent mutation still routes through
//! [`HistoryManager`] commands (one gesture = one entry); transient state
//! (phase, pending collapse, group drill-in, text session, snap guides)
//! never enters the document.
//!
//! Events are notifications, never a second source of truth:
//! [`EditorEvent`] values are pushed onto a drainable queue — no listener
//! callbacks, so no hidden mutation path.

use std::collections::HashSet;

use crate::alignment::{AlignElements, AlignMode, DistributeAxis, DistributeElements};
use crate::arrow_binding::{update_bound_arrows, update_bound_arrows_many};
use crate::auto_layout::ApplyAutoLayout;
use crate::command::{
    Command, CommandOutcome, CreateElements, DeleteElements, GroupElements, MoveElements, Reorder,
    ResizeElements, RotateElements, SetBounds, SetLocked, SetRotation, SetStyle, SetText,
    StylePatch, UngroupElements,
};
use crate::constraints::apply_constraints;
use crate::document::Document;
use crate::editor_state::EditorState;
use crate::element::{create_freedraw, create_text, CounterIdGenerator, Element, ElementId};
use crate::extension::{Extension, ExtensionRegistry};
use crate::frame::frame_children;
use crate::geometry::snap::SnapConfig;
use crate::geometry::transform::HandleType;
use crate::geometry::viewport::{clamp_zoom, screen_to_scene, Viewport};
use crate::gesture::{GestureSession, DRAG_THRESHOLD_PX};
use crate::group::outermost_group_id;
use crate::history::{HistoryManager, HistoryStatus};
use crate::hit_test::{
    combined_bounds, hit_test_top_indexed, query_in_bounds_indexed, HitTestFilter,
};
use crate::interaction::{
    context_menu_intents, draw_box_element, event_to_scene, key_to_intent, resize_handle_at,
    resolve_group_selection, rotate_handle_at, rubber_band_bounds, screen_distance,
    snap_move_delta, wheel_intent, ContextMenuIntent, EditorPointerPhase, InputEvent, Key,
    KeyIntent, Modifiers, PointerButton, PressedCapture, SnapGuide, ToolId, ToolRegistry,
    WheelIntent,
};
use crate::render_model::TextMeasurer;
use crate::text_session::{estimate_caret_index, FallbackMeasurer, TextCommitAction, TextSession};
use crate::theme::{default_theme, GrafalithTheme};
use crate::EngineResult;

// ---------------------------------------------------------------------------
// Events + outcomes
// ---------------------------------------------------------------------------

/// Notification emitted by [`Editor`] intent methods.
#[derive(Debug, Clone, PartialEq)]
pub enum EditorEvent {
    /// Persistent document content changed.
    DocumentChanged,
    /// Undo/redo availability changed.
    HistoryChanged(HistoryStatus),
    /// Selection changed (selected ids in selection order).
    SelectionChanged(Vec<ElementId>),
    /// Active tool changed.
    ToolChanged(String),
    /// Viewport changed (pan/zoom).
    ViewportChanged(Viewport),
    /// Text-editing session started (`Some`) or ended (`None`).
    TextEditingChanged(Option<ElementId>),
    /// A drag gesture started tracking.
    GestureStarted,
    /// A drag gesture committed one history entry.
    GestureCommitted,
    /// A gesture was cancelled with no document or history effect.
    GestureCancelled,
}

/// Outcome of [`Editor::pointer_down`].
#[derive(Debug, Clone, PartialEq)]
pub struct PointerDownOutcome {
    /// Hit element at press time, if any.
    pub hit: Option<ElementId>,
    /// Text session started by this press (text tool or double-click).
    pub began_text_edit: Option<ElementId>,
    /// Whether that session is over a fresh element (`Some(true)`), a
    /// reopened one (`Some(false)`), or no session began (`None`). Hosts
    /// need this to tell an outside-click placeholder (discard) apart from
    /// a click onto another existing text (keep editing).
    pub began_text_edit_is_new: Option<bool>,
    /// A previous text session committed first (outside-click parity).
    pub committed_text: bool,
}

/// Outcome of [`Editor::pointer_up`].
#[derive(Debug, Clone, PartialEq)]
pub enum PointerUpOutcome {
    /// Below-threshold click (selection updated, no mutation).
    Click,
    /// Past-threshold drag committed (`true` = one history entry written).
    DragCommitted(bool),
    /// Rubber band finished (selected ids).
    RubberBand(Vec<ElementId>),
    /// Shape-draw drag finished (new element id, if the drag was big enough).
    ShapeCreated(Option<ElementId>),
    /// Middle-drag pan finished.
    Panned,
    /// Stray release with nothing captured.
    Dismissed,
}

/// Outcome of the Escape chain in [`Editor::handle_key`].
#[derive(Debug, Clone, PartialEq)]
pub enum EscapeOutcome {
    /// A captured gesture was cancelled (no mutation).
    GestureCancelled,
    /// Text editing committed (`true` = document changed).
    TextCommitted(bool),
    /// Group drill-in exited and selection cleared.
    GroupExited,
    /// Selection cleared.
    SelectionCleared,
    /// Nothing to cancel, commit, exit, or clear.
    NothingToDo,
}

/// Outcome of [`Editor::handle_key`].
#[derive(Debug, Clone, PartialEq)]
pub enum KeyAction {
    /// Selection deleted (locked skipped, one history entry).
    Deleted(CommandOutcome),
    /// Selection nudged (one history entry).
    Nudged(CommandOutcome),
    /// Undo attempted (`false` = nothing to undo or refused mid-gesture).
    Undone(bool),
    /// Redo attempted.
    Redone(bool),
    /// Escape chain ran.
    EscapeHandled(EscapeOutcome),
    /// Intent decided but not executed here (clipboard payloads — the host
    /// routes these).
    UnhandledIntent(KeyIntent),
    /// Key belongs elsewhere (text fields, IME, unbound).
    Ignored,
}

/// Outcome of [`Editor::handle_input`], the single normalized entry point.
#[derive(Debug, Clone, PartialEq)]
pub enum InputOutcome {
    /// Pointer press processed.
    PointerDown(PointerDownOutcome),
    /// Pointer move processed (`true` = past the drag threshold).
    PointerMove(bool),
    /// Pointer release processed.
    PointerUp(PointerUpOutcome),
    /// Pointer stream cancelled (no mutation).
    PointerCancelled,
    /// Key processed.
    Key(KeyAction),
    /// Plain text inserted into the active session.
    TextInserted(bool),
    /// IME composition event absorbed.
    CompositionHandled,
    /// Wheel applied to the viewport.
    WheelApplied,
    /// Event needed no core behavior.
    Ignored,
}

// ---------------------------------------------------------------------------
// Editor
// ---------------------------------------------------------------------------

/// Intent facade over document, history, editor state, gestures, the
/// pointer-phase machine, and text sessions.
pub struct Editor {
    doc: Document,
    history: HistoryManager,
    state: EditorState,
    gesture: Option<GestureSession>,
    pointer_phase: EditorPointerPhase,
    pending_collapse: Option<Vec<ElementId>>,
    editing_group_id: Option<ElementId>,
    text_session: Option<TextSession>,
    pen_session: Option<crate::interaction::PenSession>,
    crop_session: Option<crate::interaction::CropSession>,
    path_editor: Option<crate::path_edit::PathEditor>,
    tools: ToolRegistry,
    extensions: ExtensionRegistry,
    snap_config: SnapConfig,
    theme: GrafalithTheme,
    /// Guides from the latest committed move. Populated during the release
    /// commit and cleared before it returns, so renders only ever show
    /// guides for a drag still in flight (hosts paint those from the live
    /// preview responses, not from here).
    last_snap_guides: Vec<SnapGuide>,
    events: Vec<EditorEvent>,
}

impl Editor {
    /// Creates an editor with an empty document and default state.
    pub fn new() -> Self {
        Self {
            doc: Document::new(),
            history: HistoryManager::new(),
            state: EditorState::new(),
            gesture: None,
            pointer_phase: EditorPointerPhase::Idle,
            pending_collapse: None,
            editing_group_id: None,
            text_session: None,
            pen_session: None,
            crop_session: None,
            path_editor: None,
            tools: ToolRegistry::with_builtins(),
            extensions: ExtensionRegistry::new(),
            snap_config: SnapConfig::defaults(),
            theme: default_theme(),
            last_snap_guides: Vec::new(),
            events: Vec::new(),
        }
    }

    /// Borrows the document.
    pub fn document(&self) -> &Document {
        &self.doc
    }

    /// Mutably borrows the document for host-boundary command execution.
    ///
    /// The bindings `Engine` owns one `Editor` and routes its document ops
    /// through the same [`HistoryManager`] machinery the editor uses, so the
    /// two cannot diverge into parallel documents.
    pub fn document_mut(&mut self) -> &mut Document {
        &mut self.doc
    }

    /// Borrows the transient editor state.
    pub fn state(&self) -> &EditorState {
        &self.state
    }

    /// Borrows the history manager.
    pub fn history(&self) -> &HistoryManager {
        &self.history
    }

    /// Mutably borrows the history manager (see [`Editor::document_mut`]).
    pub fn history_mut(&mut self) -> &mut HistoryManager {
        &mut self.history
    }

    /// Mutably borrows document and history together for multi-borrow
    /// operations (clipboard paste/cut/duplicate, tracked import) that need
    /// both at once. Single-command mutations should prefer
    /// [`Editor::execute_command`].
    pub fn doc_history_mut(&mut self) -> (&mut Document, &mut HistoryManager) {
        (&mut self.doc, &mut self.history)
    }

    /// Current viewport (scroll + zoom, TS `Viewport` parity).
    pub fn viewport(&self) -> Viewport {
        self.state.viewport
    }

    /// Replaces the viewport (host-driven pan/zoom presets, resize restore).
    ///
    /// Per-move streaming stays in [`Editor::pan_by_screen`]/[`Editor::zoom_by`]/
    /// [`Editor::apply_wheel`]; this setter is the explicit-state path for
    /// host-owned viewport restores and tests. Non-finite components are a
    /// typed error; zoom is clamped to the TS `0.1–10` range.
    pub fn set_viewport(&mut self, viewport: Viewport) -> EngineResult<()> {
        if !viewport.scroll_x.is_finite()
            || !viewport.scroll_y.is_finite()
            || !viewport.zoom.is_finite()
        {
            return Err(crate::EngineError::InvalidInput(format!(
                "viewport must be finite, got ({}, {}, {})",
                viewport.scroll_x, viewport.scroll_y, viewport.zoom
            )));
        }
        self.state.viewport = Viewport {
            scroll_x: viewport.scroll_x,
            scroll_y: viewport.scroll_y,
            zoom: clamp_zoom(viewport.zoom),
        };
        self.emit_viewport();
        Ok(())
    }

    /// Fits content into the canvas as one session change (no history):
    /// the whole content (or `ids` when given) becomes visible with
    /// `padding` scene units on every side.
    pub fn fit_viewport(
        &mut self,
        canvas_width: f64,
        canvas_height: f64,
        padding: f64,
        ids: Option<Vec<ElementId>>,
    ) -> EngineResult<Viewport> {
        self.frame_viewport(canvas_width, canvas_height, padding, ids, false)
    }

    /// Fills the canvas with content as one session change (no history):
    /// like [`Editor::fit_viewport`], but the content covers the canvas
    /// (edges may crop).
    pub fn fill_viewport(
        &mut self,
        canvas_width: f64,
        canvas_height: f64,
        padding: f64,
        ids: Option<Vec<ElementId>>,
    ) -> EngineResult<Viewport> {
        self.frame_viewport(canvas_width, canvas_height, padding, ids, true)
    }

    /// Shared fit/fill math: zoom to the padded content box, then center
    /// it. Empty content, non-finite inputs, and non-positive canvas sizes
    /// are explicit errors. Zoom clamps to the `0.1–10` range through
    /// [`Editor::set_viewport`].
    fn frame_viewport(
        &mut self,
        canvas_width: f64,
        canvas_height: f64,
        padding: f64,
        ids: Option<Vec<ElementId>>,
        fill: bool,
    ) -> EngineResult<Viewport> {
        if !canvas_width.is_finite() || !canvas_height.is_finite() {
            return Err(crate::EngineError::InvalidInput(format!(
                "fit/fill needs a finite canvas, got ({canvas_width}, {canvas_height})"
            )));
        }
        if canvas_width <= 0.0 || canvas_height <= 0.0 {
            return Err(crate::EngineError::InvalidInput(format!(
                "fit/fill needs a positive canvas, got ({canvas_width}, {canvas_height})"
            )));
        }
        if !padding.is_finite() || padding < 0.0 {
            return Err(crate::EngineError::InvalidInput(format!(
                "fit/fill padding must be finite and non-negative, got {padding}"
            )));
        }
        let targets = match ids {
            Some(ids) => ids,
            None => self
                .doc
                .get_all()
                .iter()
                .map(|element| element.id().clone())
                .collect(),
        };
        let Some(content) = combined_bounds(&self.doc, &targets) else {
            return Err(crate::EngineError::InvalidInput(
                "fit/fill found no visible content".to_string(),
            ));
        };
        let padded_w = (content.max_x - content.min_x) + padding * 2.0;
        let padded_h = (content.max_y - content.min_y) + padding * 2.0;
        // Degenerate (point) content frames at zoom 1, centered.
        let zoom = if padded_w <= 0.0 || padded_h <= 0.0 {
            1.0
        } else if fill {
            (canvas_width / padded_w).max(canvas_height / padded_h)
        } else {
            (canvas_width / padded_w).min(canvas_height / padded_h)
        };
        let center_x = (content.min_x + content.max_x) / 2.0;
        let center_y = (content.min_y + content.max_y) / 2.0;
        // Invert `screen = (scene + scroll) * zoom` for the canvas center.
        let clamped = clamp_zoom(zoom);
        self.set_viewport(Viewport {
            scroll_x: canvas_width / (2.0 * clamped) - center_x,
            scroll_y: canvas_height / (2.0 * clamped) - center_y,
            zoom: clamped,
        })?;
        Ok(self.viewport())
    }

    /// Replaces the tool allow-list (`None` = every tool allowed, TS
    /// `enabledTools` parity). The active tool is unchanged; a disallowed
    /// active tool is rejected on the next [`Editor::set_active_tool`] call,
    /// matching the TS gate (no surprise tool switches from config).
    pub fn set_enabled_tools(&mut self, tools: Option<Vec<String>>) {
        self.state.enabled_tools = tools;
    }

    /// Borrows the pointer-phase machine (deterministic, inspectable).
    pub fn pointer_phase(&self) -> &EditorPointerPhase {
        &self.pointer_phase
    }

    /// Active text-editing target, if any.
    pub fn text_editing(&self) -> Option<&ElementId> {
        self.text_session.as_ref().map(TextSession::target)
    }

    /// Active text draft, if a session owns the caret (hosts mirror this
    /// into the native textarea).
    pub fn text_draft(&self) -> Option<&str> {
        self.text_session.as_ref().map(TextSession::draft)
    }

    /// Caret as a char index into [`Editor::text_draft`], if editing.
    pub fn text_caret(&self) -> Option<usize> {
        self.text_session.as_ref().map(TextSession::caret)
    }

    /// Returns `true` while an IME composition is open on the session.
    pub fn text_composing(&self) -> bool {
        self.text_session
            .as_ref()
            .is_some_and(TextSession::composition_active)
    }

    /// Group drill-in target from double-click, if any.
    pub fn editing_group_id(&self) -> Option<&ElementId> {
        self.editing_group_id.as_ref()
    }

    /// Current snap configuration (move-drag hook).
    pub fn snap_config(&self) -> SnapConfig {
        self.snap_config
    }

    /// Replaces the snap configuration.
    pub fn set_snap_config(&mut self, config: SnapConfig) {
        self.snap_config = config;
    }

    /// Borrows the theme used for handle geometry.
    pub fn theme(&self) -> &GrafalithTheme {
        &self.theme
    }

    /// Replaces the theme used for handle geometry.
    pub fn set_theme(&mut self, theme: GrafalithTheme) {
        self.theme = theme;
    }

    /// Snap guides from the last committed move (host overlay hint).
    pub fn last_snap_guides(&self) -> &[SnapGuide] {
        &self.last_snap_guides
    }

    /// Returns `true` while a legacy programmatic drag is tracked.
    pub fn gesture_active(&self) -> bool {
        self.gesture.is_some()
    }

    /// Drains queued notifications, oldest first.
    pub fn drain_events(&mut self) -> Vec<EditorEvent> {
        std::mem::take(&mut self.events)
    }

    /// Active tool as a [`ToolId`] (parsed from the TS string id).
    pub fn active_tool_id(&self) -> ToolId {
        ToolId::parse(&self.state.active_tool)
    }

    /// Borrows the instance-scoped tool registry (built-ins plus host
    /// custom tools — the UI lists these; unknown string ids still parse
    /// as draw/custom tools for forward compatibility).
    pub fn tool_registry(&self) -> &ToolRegistry {
        &self.tools
    }

    /// Registers a extension on this editor instance and wires its declared
    /// capabilities into the live session: custom tool ids join the tool
    /// registry (so `set_active_tool` accepts them subject to the
    /// allow-list), while shapes, commands, and serializers stay queryable
    /// through [`Editor::extension_registry`].
    ///
    /// Incompatible extensions (protocol range mismatch) are rejected with an
    /// error and change nothing.
    pub fn register_extension(&mut self, extension: Box<dyn Extension>) -> EngineResult<()> {
        self.extensions.register(extension)?;
        let tools: Vec<String> = self.extensions.tools().to_vec();
        for tool in &tools {
            self.tools.register_custom(tool);
        }
        Ok(())
    }

    /// Borrows the instance-scoped extension registry (shapes, commands,
    /// serializers, importers, exporters declared by registered extensions).
    pub fn extension_registry(&self) -> &ExtensionRegistry {
        &self.extensions
    }

    /// Lists the command ids of all registered extension commands, in
    /// registration order (introspection for host UIs building menus).
    pub fn extension_command_ids(&self) -> Vec<String> {
        self.extensions
            .commands()
            .iter()
            .map(|command| command.command_id().to_string())
            .collect()
    }

    /// Executes a registered extension command by id as one undoable step.
    ///
    /// Unknown ids are a `NotFound` error that changes nothing. A failing
    /// command rolls back and records nothing; a successful no-op command
    /// records nothing and preserves the redo stack — the same contract as
    /// [`Editor::execute_command`]. Refused while a history transaction is
    /// already open (explicit error, never nested).
    pub fn execute_extension_command(&mut self, command_id: &str) -> EngineResult<CommandOutcome> {
        if self.extensions.command_by_id(command_id).is_none() {
            return Err(crate::EngineError::NotFound(format!(
                "unknown extension command '{command_id}'"
            )));
        }
        let nonce_before = self.doc.scene_nonce();
        self.history.transaction(&mut self.doc, |ctx| {
            let extension = self.extensions.command_by_id(command_id).ok_or_else(|| {
                crate::EngineError::NotFound(format!("unknown extension command '{command_id}'"))
            })?;
            extension.execute(ctx)
        })?;
        let outcome = CommandOutcome {
            affected: Vec::new(),
            changed: self.doc.scene_nonce() != nonce_before,
        };
        self.after_mutation(&outcome);
        Ok(outcome)
    }

    // -- document intents -------------------------------------------------

    /// Executes one command against the owned document + history, emitting
    /// mutation notifications when it changed anything.
    ///
    /// The bindings `Engine` owns one `Editor` and routes its document ops
    /// through this method, so boundary mutations share the exact
    /// history/event path the pointer machine uses (one entry per op,
    /// `DocumentChanged` + `HistoryChanged` only when `changed`).
    pub fn execute_command<C: Command>(&mut self, command: C) -> EngineResult<CommandOutcome> {
        let outcome = self.history.execute(&mut self.doc, command)?;
        self.after_mutation(&outcome);
        Ok(outcome)
    }

    /// Creates an element as one undoable step, returning its id.
    pub fn create(&mut self, element: Element) -> EngineResult<ElementId> {
        let id = element.id().clone();
        let outcome = self
            .history
            .execute(&mut self.doc, CreateElements::new(vec![element]))?;
        self.after_mutation(&outcome);
        Ok(id)
    }

    /// Soft-deletes elements as one undoable step.
    ///
    /// Bound arrows that referenced a deleted target are detached in the
    /// same entry (they become floating instead of dangling).
    pub fn delete(&mut self, ids: Vec<ElementId>) -> EngineResult<CommandOutcome> {
        let outcome = self.history.transaction(&mut self.doc, |ctx| {
            let mut cmd = DeleteElements::new(ids.clone());
            let mut outcome = cmd.execute(ctx)?;
            for id in &ids {
                let follow = update_bound_arrows(ctx, id)?;
                outcome.affected.extend(follow.affected);
                outcome.changed |= follow.changed;
            }
            Ok(outcome)
        })?;
        self.after_mutation(&outcome);
        Ok(outcome)
    }

    /// Applies a rectangle boolean op to two elements as one undoable step.
    ///
    /// Both inputs are soft-deleted and every result box becomes a fresh
    /// rectangle (first input's style, fresh ids, on top). See
    /// [`crate::boolean`] for validation rules. Arrow bindings that
    /// referenced a consumed input detach in the same entry.
    pub fn apply_boolean(
        &mut self,
        kind: crate::boolean::BooleanOp,
        first: ElementId,
        second: ElementId,
    ) -> EngineResult<CommandOutcome> {
        let plan = crate::boolean::plan_boolean(&self.doc, kind, first, second)?;
        let mut mint = || {
            // Collision-guarded like paste: the counter source is
            // independent of stored ids, so loop until fresh.
            let mut id = self.doc.fresh_element_id();
            while self.doc.contains(id.as_str()) {
                id = self.doc.fresh_element_id();
            }
            let seed = self.doc.fresh_seed();
            let nonce = self.doc.fresh_nonce();
            (id, seed, nonce)
        };
        let mut created = Vec::new();
        match &plan.results {
            crate::boolean::BooleanResults::Rects(boxes) => {
                for bounds in boxes {
                    let (id, seed, nonce) = mint();
                    created.push(crate::boolean::result_element(
                        &plan.style_source,
                        id,
                        seed,
                        nonce,
                        bounds,
                    ));
                }
            }
            crate::boolean::BooleanResults::Paths(contours) => {
                for anchors in contours {
                    let (id, seed, nonce) = mint();
                    created.push(crate::boolean::path_result_element(
                        &plan.style_source,
                        id,
                        seed,
                        nonce,
                        anchors,
                    ));
                }
            }
        }
        let outcome = self.history.transaction(&mut self.doc, |ctx| {
            let mut affected = vec![plan.first.clone(), plan.second.clone()];
            ctx.soft_delete(plan.first.as_str())?;
            ctx.soft_delete(plan.second.as_str())?;
            for element in &created {
                ctx.upsert(element.clone())?;
                affected.push(element.id().clone());
            }
            // One scan for both consumed inputs (mass-operation linearity).
            let follow = update_bound_arrows_many(ctx, &[plan.first.clone(), plan.second.clone()])?;
            affected.extend(follow.affected);
            Ok(CommandOutcome {
                affected,
                changed: true,
            })
        })?;
        self.after_mutation(&outcome);
        Ok(outcome)
    }
    ///
    /// Bound arrow endpoints that track a moved target follow in the same
    /// entry (TS `updateBoundArrows` parity, routed through commands rather
    /// than hidden `afterUpsert` hooks).
    pub fn move_elements(
        &mut self,
        ids: Vec<ElementId>,
        dx: f64,
        dy: f64,
    ) -> EngineResult<CommandOutcome> {
        let outcome = self.history.transaction(&mut self.doc, |ctx| {
            let mut cmd = MoveElements::new(ids.clone(), dx, dy);
            let mut outcome = cmd.execute(ctx)?;
            // One arrow scan for the whole move (linear, not per-id).
            let follow = update_bound_arrows_many(ctx, &ids)?;
            outcome.affected.extend(follow.affected);
            outcome.changed |= follow.changed;
            Ok(outcome)
        })?;
        self.after_mutation(&outcome);
        Ok(outcome)
    }

    /// Directly replaces an element's bounds as one undoable step (TS
    /// `Editor.resizeElement` parity: locked/deleted/unknown/sub-minimum
    /// are no-ops; non-finite is a typed error).
    ///
    /// When the target is a frame, direct children with explicit
    /// [`Constraints`] follow via [`apply_constraints`] in the same entry,
    /// and bound arrows track the resized target.
    pub fn resize_element(
        &mut self,
        id: ElementId,
        x: f64,
        y: f64,
        width: f64,
        height: f64,
    ) -> EngineResult<CommandOutcome> {
        use crate::geometry::rect::Bounds;
        let old_bounds = self.doc.get(id.as_str()).map(|element| element.bounds());
        let outcome = self.history.transaction(&mut self.doc, |ctx| {
            let mut cmd = SetBounds::new(id.clone(), x, y, width, height);
            let mut outcome = cmd.execute(ctx)?;
            // Frame-constraint propagation (TS `constraints.ts` parity).
            if let Some(old) = &old_bounds {
                let new_bounds = Bounds {
                    min_x: x,
                    min_y: y,
                    max_x: x + width,
                    max_y: y + height,
                };
                let children = frame_children(ctx.doc(), id.as_str());
                for child_id in children {
                    let Some(child) = ctx.doc().get(child_id.as_str()).cloned() else {
                        continue;
                    };
                    if child.base().is_deleted {
                        continue;
                    }
                    let Some(constraints) = child.base().constraints else {
                        continue;
                    };
                    let (nx, ny, nw, nh) = apply_constraints(&child, constraints, *old, new_bounds);
                    let mut next = child.clone();
                    {
                        let base = next.base_mut();
                        base.x = nx;
                        base.y = ny;
                        base.width = nw;
                        base.height = nh;
                    }
                    // Skip invalid outputs rather than failing the whole
                    // resize (a child with degenerate input stays put).
                    if next.validate().is_ok() {
                        ctx.upsert(next)?;
                        outcome.affected.push(child_id);
                        outcome.changed = true;
                    }
                }
            }
            let follow = update_bound_arrows(ctx, &id)?;
            outcome.affected.extend(follow.affected);
            outcome.changed |= follow.changed;
            Ok(outcome)
        })?;
        self.after_mutation(&outcome);
        Ok(outcome)
    }

    /// Directly sets an element's rotation as one undoable step (TS
    /// `Editor.rotateElement` parity).
    pub fn rotate_element(&mut self, id: ElementId, rotation: f64) -> EngineResult<CommandOutcome> {
        let outcome = self
            .history
            .execute(&mut self.doc, SetRotation::new(id, rotation))?;
        self.after_mutation(&outcome);
        Ok(outcome)
    }

    /// Applies a style patch as one undoable step.
    pub fn set_style(
        &mut self,
        ids: Vec<ElementId>,
        patch: StylePatch,
    ) -> EngineResult<CommandOutcome> {
        let outcome = self
            .history
            .execute(&mut self.doc, SetStyle::new(ids, patch))?;
        self.after_mutation(&outcome);
        Ok(outcome)
    }

    /// Replaces the z-order as one undoable step.
    pub fn reorder(&mut self, order: Vec<ElementId>) -> EngineResult<CommandOutcome> {
        let outcome = self.history.execute(&mut self.doc, Reorder::new(order))?;
        self.after_mutation(&outcome);
        Ok(outcome)
    }

    /// Aligns elements to one edge (or center) of their combined bounds as
    /// one undoable step (TS `alignment.ts` parity).
    pub fn align_elements(
        &mut self,
        ids: Vec<ElementId>,
        mode: AlignMode,
    ) -> EngineResult<CommandOutcome> {
        let outcome = self
            .history
            .execute(&mut self.doc, AlignElements::new(ids, mode))?;
        self.after_mutation(&outcome);
        Ok(outcome)
    }

    /// Aligns the current selection (convenience over [`Editor::align_elements`]).
    pub fn align_selected(&mut self, mode: AlignMode) -> EngineResult<CommandOutcome> {
        let ids = self.state.selection.ids().to_vec();
        self.align_elements(ids, mode)
    }

    /// Distributes elements with equal gaps along one axis as one undoable
    /// step (outer elements stay fixed; fewer than 3 valid elements is a
    /// no-op — TS `distribute*` parity).
    pub fn distribute_elements(
        &mut self,
        ids: Vec<ElementId>,
        axis: DistributeAxis,
    ) -> EngineResult<CommandOutcome> {
        let outcome = self
            .history
            .execute(&mut self.doc, DistributeElements::new(ids, axis))?;
        self.after_mutation(&outcome);
        Ok(outcome)
    }

    /// Distributes the current selection (convenience over
    /// [`Editor::distribute_elements`]).
    pub fn distribute_selected(&mut self, axis: DistributeAxis) -> EngineResult<CommandOutcome> {
        let ids = self.state.selection.ids().to_vec();
        self.distribute_elements(ids, axis)
    }

    /// Runs a frame's auto-layout config as one undoable step (child
    /// constraints are ignored while layout runs — TS `auto-layout.ts`
    /// parity). Non-frames and frames without config are no-ops.
    pub fn apply_auto_layout(&mut self, frame_id: ElementId) -> EngineResult<CommandOutcome> {
        let outcome = self
            .history
            .execute(&mut self.doc, ApplyAutoLayout::new(frame_id))?;
        self.after_mutation(&outcome);
        Ok(outcome)
    }

    /// Proportionally rescales a multi-selection from `original` to `next`
    /// combined bounds as one undoable step (TS multi-select resize
    /// parity). Single-element callers should keep using
    /// [`Editor::resize_element`]; this entry point is the block-scale path.
    pub fn resize_selection(
        &mut self,
        ids: Vec<ElementId>,
        original: crate::geometry::rect::Bounds,
        next: crate::geometry::rect::Bounds,
    ) -> EngineResult<CommandOutcome> {
        let outcome = self.history.execute(
            &mut self.doc,
            crate::command::ResizeSelection::new(ids, original, next),
        )?;
        self.after_mutation(&outcome);
        Ok(outcome)
    }

    /// Starts a pen session for multi-click path creation (TS `PenTool`
    /// parity: idle → drawing). Any existing pen session is replaced.
    pub fn pen_begin(&mut self) {
        self.pen_session = Some(crate::interaction::PenSession::new());
    }

    /// Clicks a pen anchor at `scene` (sharp corner; returns `true` when
    /// the click closes the path). Errors without an active session.
    pub fn pen_click(&mut self, scene: [f64; 2]) -> EngineResult<bool> {
        let Some(session) = self.pen_session.as_mut() else {
            return Err(crate::EngineError::InvalidInput(
                "no pen session is active".to_string(),
            ));
        };
        Ok(session.add_point(scene))
    }

    /// Drags the last pen anchor's handles to `scene` (symmetric unless
    /// `alt_break`). Errors without an active session.
    pub fn pen_drag_handle(&mut self, scene: [f64; 2], alt_break: bool) -> EngineResult<()> {
        let Some(session) = self.pen_session.as_mut() else {
            return Err(crate::EngineError::InvalidInput(
                "no pen session is active".to_string(),
            ));
        };
        session.drag_handle(scene, alt_break);
        Ok(())
    }

    /// Returns `true` while a pen session is active.
    pub fn is_pen_active(&self) -> bool {
        self.pen_session.is_some()
    }

    /// Cancels the pen session with no document effect.
    pub fn pen_cancel(&mut self) {
        self.pen_session = None;
    }

    /// Commits the pen session as one `CreateElements` history entry
    /// (2+ anchors required; fewer cancels silently). Returns the new
    /// path id, or `None` when nothing committed.
    pub fn pen_commit(&mut self) -> EngineResult<Option<ElementId>> {
        let Some(session) = self.pen_session.take() else {
            return Ok(None);
        };
        let Some(built) = session.build_path() else {
            return Ok(None);
        };
        let id = self.doc.fresh_element_id();
        let mut counter = crate::element::CounterIdGenerator::new();
        let mut path = crate::element::create_path(&mut counter);
        path.base.id = id.clone();
        path.base.x = built.x;
        path.base.y = built.y;
        path.base.width = built.width;
        path.base.height = built.height;
        path.segments = built.segments;
        path.closed = built.closed;
        let outcome = self.history.execute(
            &mut self.doc,
            CreateElements::new(vec![crate::element::Element::Path(path)]),
        )?;
        self.after_mutation(&outcome);
        Ok(Some(id))
    }

    /// Starts a crop session over an image element (TS `CropHandler`
    /// parity). Errors for unknown/deleted/non-image targets.
    pub fn start_crop(&mut self, id: &ElementId) -> EngineResult<()> {
        let Some(element) = self.doc.get(id.as_str()) else {
            return Err(crate::EngineError::NotFound(format!(
                "crop target '{}' not found",
                id.as_str()
            )));
        };
        if element.base().is_deleted {
            return Err(crate::EngineError::InvalidInput(format!(
                "crop target '{}' is deleted",
                id.as_str()
            )));
        }
        let crate::element::Element::Image(image) = element else {
            return Err(crate::EngineError::InvalidInput(format!(
                "crop target '{}' is not an image",
                id.as_str()
            )));
        };
        self.crop_session = Some(crate::interaction::CropSession::new(
            id.clone(),
            image.crop,
            image.natural_width,
            image.natural_height,
        ));
        Ok(())
    }

    /// Drags the crop session's `handle` to natural-pixel `point`.
    /// Errors without an active session.
    pub fn crop_drag(
        &mut self,
        handle: crate::interaction::CropHandle,
        point: [f64; 2],
    ) -> EngineResult<()> {
        let Some(session) = self.crop_session.as_mut() else {
            return Err(crate::EngineError::InvalidInput(
                "no crop session is active".to_string(),
            ));
        };
        session.drag_handle(handle, point);
        Ok(())
    }

    /// Returns `true` while a crop session is active.
    pub fn is_cropping(&self) -> bool {
        self.crop_session.is_some()
    }

    /// Borrows the crop target id, if cropping.
    pub fn cropping_element_id(&self) -> Option<&ElementId> {
        self.crop_session.as_ref().map(|session| &session.target)
    }

    /// Commits the crop session as one `SetCrop` history entry
    /// (full-image commits store `None`). Returns `false` without an
    /// active session.
    pub fn commit_crop(&mut self) -> EngineResult<bool> {
        let Some(session) = self.crop_session.take() else {
            return Ok(false);
        };
        let crop = if session.is_full_image() {
            None
        } else {
            Some(session.crop)
        };
        let outcome = self.history.execute(
            &mut self.doc,
            crate::interaction::SetCrop::new(session.target, crop),
        )?;
        self.after_mutation(&outcome);
        Ok(outcome.changed)
    }

    /// Cancels the crop session with no document effect.
    pub fn cancel_crop(&mut self) {
        self.crop_session = None;
    }

    /// Starts a path-edit session over a path element (TS `PathEditor`
    /// parity). Errors for unknown/deleted/non-path targets.
    pub fn start_path_edit(&mut self, id: &ElementId) -> EngineResult<()> {
        let Some(element) = self.doc.get(id.as_str()).cloned() else {
            return Err(crate::EngineError::NotFound(format!(
                "path target '{}' not found",
                id.as_str()
            )));
        };
        let crate::element::Element::Path(path) = &element else {
            return Err(crate::EngineError::InvalidInput(format!(
                "path target '{}' is not a path",
                id.as_str()
            )));
        };
        self.path_editor = Some(crate::path_edit::PathEditor::begin(id.clone(), path)?);
        Ok(())
    }

    /// Returns `true` while a path-edit session is active.
    pub fn is_path_editing(&self) -> bool {
        self.path_editor.is_some()
    }

    /// Borrows the path-edit target id, if editing.
    pub fn path_editing_id(&self) -> Option<&ElementId> {
        self.path_editor.as_ref().map(|editor| &editor.target)
    }

    /// Routes a path-edit press at `scene` (`zoom` for hit radii,
    /// `alt` for delete-anchor). Returns the press kind name for hosts
    /// (`"anchor"`, `"handle"`, `"add"`, `"delete"`, `"none"`).
    pub fn path_press(
        &mut self,
        scene: [f64; 2],
        zoom: f64,
        alt: bool,
    ) -> EngineResult<&'static str> {
        let Some(editor) = self.path_editor.as_mut() else {
            return Err(crate::EngineError::InvalidInput(
                "no path-edit session is active".to_string(),
            ));
        };
        let kind = editor.pointer_down(&scene, zoom, alt);
        Ok(match kind {
            crate::path_edit::PressKind::AnchorDrag => "anchor",
            crate::path_edit::PressKind::HandleDrag => "handle",
            crate::path_edit::PressKind::AddAnchor => "add",
            crate::path_edit::PressKind::DeleteAnchor => "delete",
            crate::path_edit::PressKind::None => "none",
        })
    }

    /// Drags the active path-edit target to `scene` (`alt_break` splits
    /// symmetric handles). Errors without an active session or drag.
    pub fn path_drag(&mut self, scene: [f64; 2], alt_break: bool) -> EngineResult<()> {
        let Some(editor) = self.path_editor.as_mut() else {
            return Err(crate::EngineError::InvalidInput(
                "no path-edit session is active".to_string(),
            ));
        };
        editor.pointer_move(&scene, alt_break)
    }

    /// Releases the active path-edit drag (no document effect yet —
    /// hosts commit explicitly, matching crop/text staging). Returns
    /// `true` when a drag was active.
    pub fn path_release(&mut self) -> bool {
        if let Some(editor) = self.path_editor.as_mut() {
            editor.pointer_up().is_some()
        } else {
            false
        }
    }

    /// Commits the path-edit session as one `SetPathSegments` history
    /// entry. Returns `false` without an active session.
    pub fn commit_path_edit(&mut self) -> EngineResult<bool> {
        let Some(editor) = self.path_editor.take() else {
            return Ok(false);
        };
        let outcome = self
            .history
            .execute(&mut self.doc, editor.commit_command())?;
        self.after_mutation(&outcome);
        Ok(outcome.changed)
    }

    /// Cancels the path-edit session with no document effect.
    pub fn cancel_path_edit(&mut self) {
        self.path_editor = None;
    }

    /// Locks elements as one undoable step.
    pub fn lock(&mut self, ids: Vec<ElementId>) -> EngineResult<CommandOutcome> {
        let outcome = self
            .history
            .execute(&mut self.doc, SetLocked::new(ids, true))?;
        self.after_mutation(&outcome);
        Ok(outcome)
    }

    /// Unlocks elements as one undoable step.
    pub fn unlock(&mut self, ids: Vec<ElementId>) -> EngineResult<CommandOutcome> {
        let outcome = self
            .history
            .execute(&mut self.doc, SetLocked::new(ids, false))?;
        self.after_mutation(&outcome);
        Ok(outcome)
    }

    /// Deletes the current selection as one undoable step (TS
    /// `deleteSelected` parity: frame children are released first, locked
    /// elements are skipped, the selection clears).
    pub fn delete_selected(&mut self) -> EngineResult<CommandOutcome> {
        let selected = self.state.selection.ids().to_vec();
        let outcome = self.history.transaction(&mut self.doc, |ctx| {
            for id in &selected {
                let is_open_frame = matches!(ctx.doc().get(id.as_str()),
                    Some(element) if element.element_type_name() == "frame" && !element.base().locked);
                if is_open_frame {
                    for child in frame_children(ctx.doc(), id.as_str()) {
                        if let Some(element) = ctx.doc().get(child.as_str()) {
                            let mut next = element.clone();
                            next.base_mut().frame_id = None;
                            ctx.upsert(next)?;
                        }
                    }
                }
            }
            let mut cmd = DeleteElements::new(
                selected
                    .iter()
                    .filter(|id| {
                        matches!(ctx.doc().get(id.as_str()),
                            Some(element) if !element.base().locked)
                    })
                    .cloned()
                    .collect(),
            );
            let mut outcome = cmd.execute(ctx)?;
            // Detach arrows bound to a deleted target in the same entry —
            // one scan for the whole selection (linear, not per-id).
            let follow = update_bound_arrows_many(ctx, &selected)?;
            outcome.affected.extend(follow.affected);
            outcome.changed |= follow.changed;
            Ok(outcome)
        })?;
        self.state.selection.clear();
        self.emit_selection();
        self.after_mutation(&outcome);
        Ok(outcome)
    }

    /// Nudges the selection by a scene-space delta as one undoable step
    /// (TS `nudgeSelected` parity: locked elements are skipped by the
    /// move command; bound arrows follow in the same entry).
    pub fn nudge_selected(&mut self, dx: f64, dy: f64) -> EngineResult<CommandOutcome> {
        let ids = self.state.selection.ids().to_vec();
        let outcome = self.history.transaction(&mut self.doc, |ctx| {
            let mut cmd = MoveElements::new(ids.clone(), dx, dy);
            let mut outcome = cmd.execute(ctx)?;
            // One arrow scan for the whole nudge (linear, not per-id).
            let follow = update_bound_arrows_many(ctx, &ids)?;
            outcome.affected.extend(follow.affected);
            outcome.changed |= follow.changed;
            Ok(outcome)
        })?;
        self.after_mutation(&outcome);
        Ok(outcome)
    }

    /// Context-menu intents for the current selection (core decides, host
    /// renders).
    pub fn context_menu(&self) -> Vec<ContextMenuIntent> {
        context_menu_intents(&self.doc, self.state.selection.ids())
    }

    /// Groups the current selection as one undoable step (2+ elements;
    /// `None` without mutating otherwise).
    ///
    /// The fresh group id is minted even when nothing is tagged (TS
    /// `group-actions.ts` parity); members append it innermost-last
    /// through the history transaction so one undo ungroups.
    pub fn group_selected(&mut self) -> EngineResult<Option<ElementId>> {
        let selected = self.state.selection.ids().to_vec();
        if selected.len() < 2 {
            return Ok(None);
        }
        let group_id = self.doc.next_group_id();
        let outcome = self.history.transaction(&mut self.doc, |ctx| {
            let mut cmd = GroupElements::new(selected.clone(), group_id.clone());
            cmd.execute(ctx)
        })?;
        self.after_mutation(&outcome);
        Ok(Some(group_id))
    }

    /// Removes a group from every member as one undoable step (nested
    /// memberships keep their other ids — TS `ungroup` parity).
    pub fn ungroup(&mut self, group_id: &ElementId) -> EngineResult<CommandOutcome> {
        let outcome = self.history.transaction(&mut self.doc, |ctx| {
            let mut cmd = UngroupElements::new(group_id.clone());
            cmd.execute(ctx)
        })?;
        self.after_mutation(&outcome);
        Ok(outcome)
    }

    // -- selection intents ------------------------------------------------

    /// Replaces the selection (TS `select` parity).
    pub fn select(&mut self, ids: Vec<ElementId>) {
        self.state.selection.select(ids);
        self.emit_selection();
    }

    /// Adds an id to the selection.
    pub fn add_to_selection(&mut self, id: ElementId) {
        self.state.selection.add(id);
        self.emit_selection();
    }

    /// Toggles an id in the selection.
    pub fn toggle_selection(&mut self, id: ElementId) {
        self.state.selection.toggle(id);
        self.emit_selection();
    }

    /// Clears the selection.
    pub fn clear_selection(&mut self) {
        self.state.selection.clear();
        self.emit_selection();
    }

    /// Exits group drill-in mode (keeps the selection).
    pub fn exit_group_editing(&mut self) {
        self.editing_group_id = None;
    }

    // -- tools ------------------------------------------------------------

    /// Switches the active tool, cancelling any captured gesture or legacy
    /// drag, committing text editing (TS `setActiveTool` finish parity),
    /// and rolling back any open transaction so no half-mutated state leaks
    /// across tools. Returns `false` without changing anything when the
    /// tool is rejected by the allow-list.
    pub fn set_active_tool(&mut self, tool: impl Into<String>) -> EngineResult<bool> {
        self.cancel_pointer_capture();
        self.last_snap_guides.clear();
        if self.gesture.is_some() {
            self.gesture = None;
            self.events.push(EditorEvent::GestureCancelled);
        }
        if self.text_session.is_some() {
            self.commit_text_with_fallback()?;
        }
        self.pending_collapse = None;
        if self.history.in_transaction() {
            self.history.cancel_transaction(&mut self.doc)?;
        }
        let tool_string = tool.into();
        if !self.state.set_active_tool(tool_string.clone()) {
            return Ok(false);
        }
        self.events.push(EditorEvent::ToolChanged(tool_string));
        Ok(true)
    }

    // -- legacy programmatic drag (deferred-commit primitive) -------------

    /// Starts tracking a programmatic drag over the given ids. Refused
    /// while the pointer machine holds a capture (one gesture at a time).
    pub fn gesture_begin(&mut self, ids: Vec<ElementId>, x: f64, y: f64) -> EngineResult<()> {
        if self.pointer_phase.is_captured() {
            return Err(crate::EngineError::InvalidInput(
                "pointer capture is active; commit or cancel it first".to_string(),
            ));
        }
        self.gesture = Some(GestureSession::begin(ids, x, y)?);
        self.events.push(EditorEvent::GestureStarted);
        Ok(())
    }

    /// Advances the tracked programmatic drag. Returns `true` once past
    /// the drag threshold. Errors when no drag is tracked.
    pub fn gesture_update(&mut self, x: f64, y: f64) -> EngineResult<bool> {
        let Some(gesture) = self.gesture.as_mut() else {
            return Err(crate::EngineError::InvalidInput(
                "no gesture is being tracked".to_string(),
            ));
        };
        gesture.update(x, y)
    }

    /// Commits the tracked programmatic drag: a past-threshold drag becomes
    /// one [`MoveElements`](crate::command::MoveElements) history entry (plus
    /// bound-arrow follow in the same entry); a below-threshold click commits
    /// nothing. Errors when no drag is tracked.
    pub fn gesture_commit(&mut self) -> EngineResult<bool> {
        let Some(gesture) = self.gesture.take() else {
            return Err(crate::EngineError::InvalidInput(
                "no gesture is being tracked".to_string(),
            ));
        };
        let Some(cmd) = gesture.commit_move() else {
            return Ok(false);
        };
        let moved_ids = cmd.ids.clone();
        let outcome = self.history.transaction(&mut self.doc, |ctx| {
            let mut cmd = cmd.clone();
            let mut outcome = cmd.execute(ctx)?;
            // One arrow scan for the whole gesture (linear, not per-id).
            let follow = update_bound_arrows_many(ctx, &moved_ids)?;
            outcome.affected.extend(follow.affected);
            outcome.changed |= follow.changed;
            Ok(outcome)
        })?;
        self.after_mutation(&outcome);
        self.events.push(EditorEvent::GestureCommitted);
        Ok(outcome.changed)
    }

    /// Cancels the tracked programmatic drag with no document or history
    /// effect. Errors when no drag is tracked.
    pub fn gesture_cancel(&mut self) -> EngineResult<()> {
        let Some(gesture) = self.gesture.take() else {
            return Err(crate::EngineError::InvalidInput(
                "no gesture is being tracked".to_string(),
            ));
        };
        gesture.cancel();
        self.events.push(EditorEvent::GestureCancelled);
        Ok(())
    }

    // -- normalized pointer dispatch ----------------------------------

    /// Processes a pointer press in screen pixels (host translates DOM
    /// coordinates; double-click detection stays host-side and arrives as
    /// `click_count`).
    pub fn pointer_down(
        &mut self,
        x: f64,
        y: f64,
        button: PointerButton,
        modifiers: Modifiers,
        click_count: u32,
    ) -> EngineResult<PointerDownOutcome> {
        if self.gesture.is_some() {
            return Err(crate::EngineError::InvalidInput(
                "programmatic gesture is active; commit or cancel it first".to_string(),
            ));
        }
        if self.pointer_phase.is_captured() {
            return Err(crate::EngineError::InvalidInput(
                "pointer already captured; release it first".to_string(),
            ));
        }
        let viewport = self.state.viewport;
        let scene = event_to_scene(x, y, &viewport)?;
        // Outside-click commits text first (TS blur parity), then the press
        // continues through the normal path.
        let mut committed_text = false;
        if self.text_session.is_some() {
            committed_text = self.commit_text_with_fallback()?;
        }
        let tool = ToolId::parse(&self.state.active_tool);
        if tool.is_text() {
            if button != PointerButton::Left {
                return Ok(PointerDownOutcome {
                    hit: None,
                    began_text_edit: None,
                    began_text_edit_is_new: None,
                    committed_text,
                });
            }
            let id = self.start_text_at(scene[0], scene[1])?;
            let is_new = self
                .text_session
                .as_ref()
                .is_some_and(|session| session.is_new());
            return Ok(PointerDownOutcome {
                hit: None,
                began_text_edit: Some(id),
                began_text_edit_is_new: Some(is_new),
                committed_text,
            });
        }
        if let ToolId::Draw(shape) = tool.clone() {
            if button != PointerButton::Left {
                return Ok(PointerDownOutcome {
                    hit: None,
                    began_text_edit: None,
                    began_text_edit_is_new: None,
                    committed_text,
                });
            }
            self.pointer_phase = EditorPointerPhase::Pressed(PressedCapture {
                origin_screen: [x, y],
                origin_scene: scene,
                hit: None,
                button,
                additive: modifiers.is_additive(),
                resize_target: None,
                rotate_target: None,
                tool: ToolId::Draw(shape),
            });
            return Ok(PointerDownOutcome {
                hit: None,
                began_text_edit: None,
                began_text_edit_is_new: None,
                committed_text,
            });
        }
        if let ToolId::Custom(_) = tool {
            // Host-owned tools capture without core behavior (registry
            // parity: known but not core-driven).
            self.pointer_phase = EditorPointerPhase::Pressed(PressedCapture {
                origin_screen: [x, y],
                origin_scene: scene,
                hit: None,
                button,
                additive: modifiers.is_additive(),
                resize_target: None,
                rotate_target: None,
                tool,
            });
            return Ok(PointerDownOutcome {
                hit: None,
                began_text_edit: None,
                began_text_edit_is_new: None,
                committed_text,
            });
        }
        match button {
            PointerButton::Right => {
                let hit =
                    hit_test_top_indexed(&self.doc, scene[0], scene[1], HitTestFilter::selection());
                if let Some(hit_id) = hit.clone() {
                    if !self.state.selection.contains(&hit_id) {
                        self.right_click_select(&hit_id, modifiers.is_additive());
                    }
                }
                return Ok(PointerDownOutcome {
                    hit,
                    began_text_edit: None,
                    began_text_edit_is_new: None,
                    committed_text,
                });
            }
            PointerButton::Middle => {
                self.pointer_phase = EditorPointerPhase::Panning {
                    origin_screen: [x, y],
                    origin_scroll: [viewport.scroll_x, viewport.scroll_y],
                };
                return Ok(PointerDownOutcome {
                    hit: None,
                    began_text_edit: None,
                    began_text_edit_is_new: None,
                    committed_text,
                });
            }
            PointerButton::Left => {}
        }
        let hit = hit_test_top_indexed(&self.doc, scene[0], scene[1], HitTestFilter::selection());
        // Double-click carries edit intent, so it runs before the handles
        // below: on a small selected box the handle hit areas overlap the
        // content, and a double-click there means edit, not resize. Single
        // clicks keep the handle priority after this block.
        if click_count >= 2 {
            if let Some(hit_id) = hit.clone() {
                if let Some(element) = self.doc.get(hit_id.as_str()) {
                    if element.element_type_name() == "text" {
                        let id = self.start_text_at(scene[0], scene[1])?;
                        let is_new = self
                            .text_session
                            .as_ref()
                            .is_some_and(|session| session.is_new());
                        self.pointer_phase = EditorPointerPhase::Pressed(PressedCapture {
                            origin_screen: [x, y],
                            origin_scene: scene,
                            hit: Some(hit_id.clone()),
                            button,
                            additive: modifiers.is_additive(),
                            resize_target: None,
                            rotate_target: None,
                            tool: ToolId::Select,
                        });
                        return Ok(PointerDownOutcome {
                            hit: Some(hit_id),
                            began_text_edit: Some(id),
                            began_text_edit_is_new: Some(is_new),
                            committed_text,
                        });
                    }
                }
                if let Some(outer) = outermost_group_id(&self.doc, hit_id.as_str()) {
                    self.editing_group_id = Some(outer);
                    self.state.selection.select(vec![hit_id.clone()]);
                    self.emit_selection();
                    self.pointer_phase = EditorPointerPhase::Pressed(PressedCapture {
                        origin_screen: [x, y],
                        origin_scene: scene,
                        hit: Some(hit_id.clone()),
                        button,
                        additive: modifiers.is_additive(),
                        resize_target: None,
                        rotate_target: None,
                        tool: ToolId::Select,
                    });
                    return Ok(PointerDownOutcome {
                        hit: Some(hit_id),
                        began_text_edit: None,
                        began_text_edit_is_new: None,
                        committed_text,
                    });
                }
            }
        }
        // Handles first for single clicks (single selection only — TS parity).
        let selection = self.state.selection.ids().to_vec();
        if selection.len() == 1 {
            if let Some((id, handle)) =
                resize_handle_at(&self.doc, &selection, &scene, &self.theme, viewport.zoom)
            {
                self.pending_collapse = None;
                self.pointer_phase = EditorPointerPhase::Pressed(PressedCapture {
                    origin_screen: [x, y],
                    origin_scene: scene,
                    hit: None,
                    button,
                    additive: modifiers.is_additive(),
                    resize_target: Some((id, handle)),
                    rotate_target: None,
                    tool: ToolId::Select,
                });
                return Ok(PointerDownOutcome {
                    hit: None,
                    began_text_edit: None,
                    began_text_edit_is_new: None,
                    committed_text,
                });
            }
            if let Some(id) =
                rotate_handle_at(&self.doc, &selection, &scene, &self.theme, viewport.zoom)
            {
                self.pending_collapse = None;
                self.pointer_phase = EditorPointerPhase::Pressed(PressedCapture {
                    origin_screen: [x, y],
                    origin_scene: scene,
                    hit: None,
                    button,
                    additive: modifiers.is_additive(),
                    resize_target: None,
                    rotate_target: Some(id),
                    tool: ToolId::Select,
                });
                return Ok(PointerDownOutcome {
                    hit: None,
                    began_text_edit: None,
                    began_text_edit_is_new: None,
                    committed_text,
                });
            }
        }
        if let Some(hit_id) = hit.clone() {
            self.press_select(&hit_id, modifiers.is_additive());
            self.pointer_phase = EditorPointerPhase::Pressed(PressedCapture {
                origin_screen: [x, y],
                origin_scene: scene,
                hit: Some(hit_id.clone()),
                button,
                additive: modifiers.is_additive(),
                resize_target: None,
                rotate_target: None,
                tool: ToolId::Select,
            });
            Ok(PointerDownOutcome {
                hit: Some(hit_id),
                began_text_edit: None,
                began_text_edit_is_new: None,
                committed_text,
            })
        } else {
            // Empty space: clear (unless additive) + exit drill-in, then a
            // drag becomes a rubber band (TS parity).
            if !modifiers.is_additive() {
                self.state.selection.clear();
                self.editing_group_id = None;
                self.emit_selection();
            }
            self.pointer_phase = EditorPointerPhase::Pressed(PressedCapture {
                origin_screen: [x, y],
                origin_scene: scene,
                hit: None,
                button,
                additive: modifiers.is_additive(),
                resize_target: None,
                rotate_target: None,
                tool: ToolId::Select,
            });
            Ok(PointerDownOutcome {
                hit: None,
                began_text_edit: None,
                began_text_edit_is_new: None,
                committed_text,
            })
        }
    }

    /// Processes a pointer move in screen pixels. Returns `true` once past
    /// the drag threshold ([`DRAG_THRESHOLD_PX`], screen-space Euclidean —
    /// a press never becomes a drag below it).
    pub fn pointer_move(&mut self, x: f64, y: f64, modifiers: Modifiers) -> EngineResult<bool> {
        let viewport = self.state.viewport;
        let scene = event_to_scene(x, y, &viewport)?;
        let phase = std::mem::replace(&mut self.pointer_phase, EditorPointerPhase::Idle);
        match phase {
            EditorPointerPhase::Idle => Ok(false),
            EditorPointerPhase::Pressed(capture) => {
                if screen_distance(&capture.origin_screen, &[x, y]) < DRAG_THRESHOLD_PX {
                    self.pointer_phase = EditorPointerPhase::Pressed(capture);
                    return Ok(false);
                }
                self.pointer_phase = if let Some((id, handle)) = capture.resize_target {
                    EditorPointerPhase::DraggingResize {
                        id,
                        handle,
                        anchor_scene: capture.origin_scene,
                        lock_aspect: modifiers.shift,
                    }
                } else if let Some(id) = capture.rotate_target {
                    EditorPointerPhase::DraggingRotate {
                        id,
                        anchor_scene: capture.origin_scene,
                        snap: modifiers.shift,
                    }
                } else if let ToolId::Draw(shape) = capture.tool {
                    let stroke = if shape == "freedraw" {
                        vec![capture.origin_scene, scene]
                    } else {
                        Vec::new()
                    };
                    EditorPointerPhase::Drawing {
                        shape,
                        origin_scene: capture.origin_scene,
                        stroke,
                    }
                } else if capture.button == PointerButton::Middle {
                    EditorPointerPhase::Panning {
                        origin_screen: capture.origin_screen,
                        origin_scroll: [viewport.scroll_x, viewport.scroll_y],
                    }
                } else if capture.tool == ToolId::Select && capture.hit.is_some() {
                    EditorPointerPhase::DraggingMove {
                        affected: self.state.selection.ids().to_vec(),
                        origin_scene: capture.origin_scene,
                        axis_lock: modifiers.shift,
                    }
                } else if capture.tool == ToolId::Select {
                    EditorPointerPhase::RubberBand {
                        origin_scene: capture.origin_scene,
                        additive: capture.additive,
                    }
                } else {
                    // Custom tools never drag in core (host-owned).
                    EditorPointerPhase::Pressed(capture)
                };
                // Custom-tool presses stay pressed (host drives them).
                if self.pointer_phase.is_captured() && !self.pointer_phase.is_dragging() {
                    return Ok(false);
                }
                let _ = scene;
                Ok(true)
            }
            EditorPointerPhase::DraggingMove {
                affected,
                origin_scene,
                ..
            } => {
                self.pointer_phase = EditorPointerPhase::DraggingMove {
                    affected,
                    origin_scene,
                    axis_lock: modifiers.shift,
                };
                Ok(true)
            }
            EditorPointerPhase::DraggingResize {
                id,
                handle,
                anchor_scene,
                ..
            } => {
                self.pointer_phase = EditorPointerPhase::DraggingResize {
                    id,
                    handle,
                    anchor_scene,
                    lock_aspect: modifiers.shift,
                };
                Ok(true)
            }
            EditorPointerPhase::DraggingRotate {
                id, anchor_scene, ..
            } => {
                self.pointer_phase = EditorPointerPhase::DraggingRotate {
                    id,
                    anchor_scene,
                    snap: modifiers.shift,
                };
                Ok(true)
            }
            EditorPointerPhase::RubberBand {
                origin_scene,
                additive,
            } => {
                self.pointer_phase = EditorPointerPhase::RubberBand {
                    origin_scene,
                    additive,
                };
                Ok(true)
            }
            EditorPointerPhase::Drawing {
                shape,
                origin_scene,
                mut stroke,
            } => {
                if shape == "freedraw" && stroke.last() != Some(&scene) {
                    stroke.push(scene);
                }
                self.pointer_phase = EditorPointerPhase::Drawing {
                    shape,
                    origin_scene,
                    stroke,
                };
                Ok(true)
            }
            EditorPointerPhase::Panning {
                origin_screen,
                origin_scroll,
            } => {
                let zoom = viewport.zoom;
                self.state.viewport.scroll_x = origin_scroll[0] + (x - origin_screen[0]) / zoom;
                self.state.viewport.scroll_y = origin_scroll[1] + (y - origin_screen[1]) / zoom;
                self.pointer_phase = EditorPointerPhase::Panning {
                    origin_screen,
                    origin_scroll,
                };
                self.emit_viewport();
                Ok(true)
            }
        }
    }

    /// Processes a pointer release in screen pixels.
    pub fn pointer_up(
        &mut self,
        x: f64,
        y: f64,
        _button: PointerButton,
        modifiers: Modifiers,
    ) -> EngineResult<PointerUpOutcome> {
        let viewport = self.state.viewport;
        let scene = event_to_scene(x, y, &viewport)?;
        let phase = std::mem::replace(&mut self.pointer_phase, EditorPointerPhase::Idle);
        match phase {
            EditorPointerPhase::Idle => Ok(PointerUpOutcome::Dismissed),
            EditorPointerPhase::Pressed(capture) => {
                // Below-threshold click: collapse a deferred group/member
                // selection, otherwise the press already selected (TS
                // `pendingCollapseIds` parity). No mutation, no history.
                // A shape-tool tap creates nothing (TS minimum-size parity)
                // but still reports the draw outcome for the host.
                if let Some(ids) = self.pending_collapse.take() {
                    self.state.selection.select(ids);
                    self.emit_selection();
                }
                if matches!(capture.tool, ToolId::Draw(_)) {
                    return Ok(PointerUpOutcome::ShapeCreated(None));
                }
                Ok(PointerUpOutcome::Click)
            }
            EditorPointerPhase::DraggingMove {
                affected,
                origin_scene,
                axis_lock,
            } => {
                let mut dx = scene[0] - origin_scene[0];
                let mut dy = scene[1] - origin_scene[1];
                if axis_lock {
                    // Shift locks to the dominant axis (TS `updateMove` parity).
                    if dx.abs() >= dy.abs() {
                        dy = 0.0;
                    } else {
                        dx = 0.0;
                    }
                }
                let _ = modifiers;
                if dx == 0.0 && dy == 0.0 {
                    self.pending_collapse = None;
                    return Ok(PointerUpOutcome::DragCommitted(false));
                }
                let (dx, dy, guides) = snap_move_delta(
                    &self.doc,
                    &affected,
                    dx,
                    dy,
                    &self.snap_config,
                    viewport.zoom,
                );
                self.last_snap_guides = guides;
                let affected_set: HashSet<&str> = affected.iter().map(|id| id.as_str()).collect();
                let outcome = self.history.transaction(&mut self.doc, |ctx| {
                    let mut move_cmd = MoveElements::new(affected.clone(), dx, dy);
                    let mut outcome = move_cmd.execute(ctx)?;
                    // Frames carry their unselected children (TS `commitMove`
                    // parity: co-selected and locked children stay put —
                    // locked ones via the move guard, co-selected via the
                    // exclusion set).
                    let mut followers: Vec<ElementId> = Vec::new();
                    for id in &affected {
                        let is_open_frame = matches!(ctx.doc().get(id.as_str()),
                            Some(element) if element.element_type_name() == "frame"
                                && !element.base().is_deleted
                                && !element.base().locked);
                        if is_open_frame {
                            for child in frame_children(ctx.doc(), id.as_str()) {
                                if !affected_set.contains(child.as_str())
                                    && !followers.contains(&child)
                                {
                                    followers.push(child);
                                }
                            }
                        }
                    }
                    if !followers.is_empty() {
                        let mut follow = MoveElements::new(followers, dx, dy);
                        let follow_outcome = follow.execute(ctx)?;
                        outcome.affected.extend(follow_outcome.affected);
                        outcome.changed |= follow_outcome.changed;
                    }
                    // Bound arrows track every moved target in the same entry.
                    let mut moved: Vec<ElementId> = affected.clone();
                    // Note: followers were computed above; re-derive the
                    // extended set from the outcome to include them without
                    // re-borrowing `followers` after move.
                    for id in outcome.affected.clone() {
                        if !moved.contains(&id) {
                            moved.push(id);
                        }
                    }
                    // One arrow scan for the whole drag (linear, not per-id).
                    let follow = update_bound_arrows_many(ctx, &moved)?;
                    outcome.affected.extend(follow.affected);
                    outcome.changed |= follow.changed;
                    Ok(outcome)
                })?;
                self.pending_collapse = None;
                self.after_mutation(&outcome);
                self.events.push(EditorEvent::GestureCommitted);
                // Guides are drag-transient: hosts paint the live preview
                // guides mid-drag, so nothing may linger after release.
                self.last_snap_guides.clear();
                Ok(PointerUpOutcome::DragCommitted(outcome.changed))
            }
            EditorPointerPhase::DraggingResize {
                id,
                handle,
                anchor_scene: _,
                lock_aspect,
            } => {
                let resized_id = id.clone();
                let outcome = self.history.transaction(&mut self.doc, |ctx| {
                    let mut cmd = ResizeElements::new(id, handle, scene, lock_aspect);
                    let mut outcome = cmd.execute(ctx)?;
                    let follow = update_bound_arrows(ctx, &resized_id)?;
                    outcome.affected.extend(follow.affected);
                    outcome.changed |= follow.changed;
                    Ok(outcome)
                })?;
                self.pending_collapse = None;
                self.after_mutation(&outcome);
                self.events.push(EditorEvent::GestureCommitted);
                Ok(PointerUpOutcome::DragCommitted(outcome.changed))
            }
            EditorPointerPhase::DraggingRotate {
                id,
                anchor_scene,
                snap,
            } => {
                let rotated_id = id.clone();
                let outcome = self.history.transaction(&mut self.doc, |ctx| {
                    let mut cmd = RotateElements::new(id, anchor_scene, scene, snap);
                    let mut outcome = cmd.execute(ctx)?;
                    let follow = update_bound_arrows(ctx, &rotated_id)?;
                    outcome.affected.extend(follow.affected);
                    outcome.changed |= follow.changed;
                    Ok(outcome)
                })?;
                self.pending_collapse = None;
                self.after_mutation(&outcome);
                self.events.push(EditorEvent::GestureCommitted);
                Ok(PointerUpOutcome::DragCommitted(outcome.changed))
            }
            EditorPointerPhase::RubberBand {
                origin_scene,
                additive,
            } => {
                let bounds = rubber_band_bounds(&origin_scene, &scene);
                let ids = query_in_bounds_indexed(&self.doc, &bounds);
                if additive {
                    for id in &ids {
                        self.state.selection.add(id.clone());
                    }
                } else {
                    self.state.selection.select(ids.clone());
                }
                self.emit_selection();
                Ok(PointerUpOutcome::RubberBand(ids))
            }
            EditorPointerPhase::Drawing {
                shape,
                origin_scene,
                stroke,
            } => {
                if shape == "freedraw" {
                    return self.commit_freedraw_stroke(origin_scene, stroke);
                }
                let x = origin_scene[0].min(scene[0]);
                let y = origin_scene[1].min(scene[1]);
                let width = (scene[0] - origin_scene[0]).abs();
                let height = (scene[1] - origin_scene[1]).abs();
                let created = if let Some(element) =
                    draw_box_element(&shape, self.doc.fresh_element_id(), x, y, width, height)
                {
                    let id = element.id().clone();
                    let outcome = self
                        .history
                        .execute(&mut self.doc, CreateElements::new(vec![element]))?;
                    self.after_mutation(&outcome);
                    self.state.selection.select(vec![id.clone()]);
                    self.emit_selection();
                    Some(id)
                } else {
                    None
                };
                Ok(PointerUpOutcome::ShapeCreated(created))
            }
            EditorPointerPhase::Panning { .. } => Ok(PointerUpOutcome::Panned),
        }
    }

    /// Commits an accumulated freedraw stroke as one history entry.
    ///
    /// The trail holds scene-space samples (origin first). Points become
    /// origin-relative with uniform `0.5` pressures (TS freedraw defaults);
    /// the box spans the relative extents. Fewer than 2 samples commits
    /// nothing (TS `hasMinimumSize` parity — a tap is not a stroke).
    fn commit_freedraw_stroke(
        &mut self,
        origin_scene: [f64; 2],
        stroke: Vec<[f64; 2]>,
    ) -> EngineResult<PointerUpOutcome> {
        if stroke.len() < 2 {
            return Ok(PointerUpOutcome::ShapeCreated(None));
        }
        let mut rel: Vec<[f64; 2]> = Vec::with_capacity(stroke.len());
        let mut min_x = f64::INFINITY;
        let mut min_y = f64::INFINITY;
        let mut max_x = f64::NEG_INFINITY;
        let mut max_y = f64::NEG_INFINITY;
        for sample in &stroke {
            let point = [sample[0] - origin_scene[0], sample[1] - origin_scene[1]];
            if point[0] < min_x {
                min_x = point[0];
            }
            if point[1] < min_y {
                min_y = point[1];
            }
            if point[0] > max_x {
                max_x = point[0];
            }
            if point[1] > max_y {
                max_y = point[1];
            }
            rel.push(point);
        }
        let mut element = create_freedraw(&mut CounterIdGenerator::new());
        element.base.id = self.doc.fresh_element_id();
        element.base.x = origin_scene[0];
        element.base.y = origin_scene[1];
        element.base.width = max_x - min_x;
        element.base.height = max_y - min_y;
        element.points = rel;
        element.pressures = vec![0.5; stroke.len()];
        let id = element.base.id.clone();
        let outcome = self.history.execute(
            &mut self.doc,
            CreateElements::new(vec![Element::Freedraw(element)]),
        )?;
        self.after_mutation(&outcome);
        self.state.selection.select(vec![id.clone()]);
        self.emit_selection();
        Ok(PointerUpOutcome::ShapeCreated(Some(id)))
    }

    /// Cancels the pointer capture with no document or history effect
    /// (`pointercancel` parity). Text sessions are untouched (TS cancels
    /// only the transform/rubber paths here).
    pub fn pointer_cancel(&mut self) -> EngineResult<()> {
        self.cancel_pointer_capture();
        self.last_snap_guides.clear();
        if self.gesture.is_some() {
            self.gesture_cancel()?;
        }
        Ok(())
    }

    // -- normalized keyboard dispatch -------------------------------------

    /// Maps a key press to its intent and executes the core-owned intents.
    /// Clipboard intents surface as [`KeyAction::UnhandledIntent`];
    /// field/IME-owned keys arrive as [`KeyAction::Ignored`] because the
    /// host never forwards them.
    pub fn handle_key(&mut self, key: Key, modifiers: Modifiers) -> EngineResult<KeyAction> {
        let editing = self.text_session.is_some();
        let Some(intent) = key_to_intent(&key, &modifiers, editing) else {
            return Ok(KeyAction::Ignored);
        };
        if editing {
            debug_assert_eq!(intent, KeyIntent::Escape);
            let committed = self.commit_text_with_fallback()?;
            return Ok(KeyAction::EscapeHandled(EscapeOutcome::TextCommitted(
                committed,
            )));
        }
        match intent {
            KeyIntent::DeleteSelected => Ok(KeyAction::Deleted(self.delete_selected()?)),
            KeyIntent::Nudge { dx, dy } => Ok(KeyAction::Nudged(self.nudge_selected(dx, dy)?)),
            KeyIntent::Undo => Ok(KeyAction::Undone(self.undo()?)),
            KeyIntent::Redo => Ok(KeyAction::Redone(self.redo()?)),
            KeyIntent::Escape => Ok(KeyAction::EscapeHandled(self.escape_chain()?)),
            KeyIntent::Copy | KeyIntent::Paste | KeyIntent::Cut | KeyIntent::Duplicate => {
                Ok(KeyAction::UnhandledIntent(intent))
            }
        }
    }

    /// Runs the Escape chain in TS priority order: captured gesture →
    /// cancel; text editing → commit (TS commits, never discards); group
    /// drill-in → exit + clear; non-empty selection → clear.
    pub fn escape_chain(&mut self) -> EngineResult<EscapeOutcome> {
        if self.pointer_phase.is_captured() {
            self.cancel_pointer_capture();
            return Ok(EscapeOutcome::GestureCancelled);
        }
        if self.gesture.is_some() {
            self.gesture_cancel()?;
            return Ok(EscapeOutcome::GestureCancelled);
        }
        if self.text_session.is_some() {
            let committed = self.commit_text_with_fallback()?;
            return Ok(EscapeOutcome::TextCommitted(committed));
        }
        if self.editing_group_id.is_some() {
            self.editing_group_id = None;
            self.state.selection.clear();
            self.emit_selection();
            return Ok(EscapeOutcome::GroupExited);
        }
        if !self.state.selection.is_empty() {
            self.state.selection.clear();
            self.emit_selection();
            return Ok(EscapeOutcome::SelectionCleared);
        }
        Ok(EscapeOutcome::NothingToDo)
    }

    // -- normalized text dispatch -----------------------------------------

    /// Starts text editing at a scene point: the topmost text element
    /// containing the point reopens (caret estimated from the click —
    /// TS `startEditingAtPosition` parity), otherwise a new default text
    /// element is created as one history entry and editing begins on it.
    ///
    /// The selection clears when the session starts, so no bounding box or
    /// handles paint under the host caret while editing. Committing
    /// re-selects the element, so the box and handles appear exactly when
    /// editing ends.
    pub fn start_text_at(&mut self, scene_x: f64, scene_y: f64) -> EngineResult<ElementId> {
        if !scene_x.is_finite() || !scene_y.is_finite() {
            return Err(crate::EngineError::InvalidInput(format!(
                "text position must be finite, got ({scene_x}, {scene_y})"
            )));
        }
        if self.text_session.is_some() {
            self.commit_text_with_fallback()?;
        }
        for id in self.doc.order().iter().rev() {
            let Some(element) = self.doc.get(id.as_str()) else {
                continue;
            };
            let Element::Text(text) = element else {
                continue;
            };
            if text.base.is_deleted {
                continue;
            }
            if scene_x >= text.base.x
                && scene_x <= text.base.x + text.base.width
                && scene_y >= text.base.y
                && scene_y <= text.base.y + text.base.height
            {
                let caret = estimate_caret_index(
                    &text.text,
                    text.font_size,
                    scene_x,
                    scene_y,
                    text.base.x,
                    text.base.y,
                );
                let id = id.clone();
                self.text_session = Some(TextSession::begin_edit(
                    id.clone(),
                    text.text.clone(),
                    caret,
                ));
                self.events
                    .push(EditorEvent::TextEditingChanged(Some(id.clone())));
                self.state.selection.clear();
                self.emit_selection();
                return Ok(id);
            }
        }
        let id = self.doc.fresh_element_id();
        let mut text = create_text(&mut CounterIdGenerator::new());
        text.base.id = id.clone();
        text.base.x = scene_x;
        text.base.y = scene_y;
        // Default stroke contrasts with the canvas background (not the UI
        // theme): black on light canvases, white on dark ones. Stored on
        // the element, so later theme switches never rewrite it.
        text.base.stroke_color = crate::theme::default_text_color_for_theme(&self.theme);
        // Keep the provisional empty element and its eventual text commit in
        // one history entry. An empty session cancels this transaction so no
        // tombstone or undo step is left behind.
        self.history.begin_transaction(&self.doc);
        let outcome = self.history.execute(
            &mut self.doc,
            CreateElements::new(vec![Element::Text(text)]),
        )?;
        if !outcome.changed {
            self.history.cancel_transaction(&mut self.doc)?;
            return Err(crate::EngineError::InvalidInput(
                "failed to create text editing target".to_string(),
            ));
        }
        self.text_session = Some(TextSession::begin_new(id.clone()));
        self.events
            .push(EditorEvent::TextEditingChanged(Some(id.clone())));
        self.state.selection.clear();
        self.emit_selection();
        Ok(id)
    }

    /// Inserts plain text at the caret. Errors when no session is active
    /// (explicitness over silent drops); returns `false` without changing
    /// anything mid-composition.
    pub fn text_insert(&mut self, text: &str) -> EngineResult<bool> {
        let Some(session) = self.text_session.as_mut() else {
            return Err(crate::EngineError::InvalidInput(
                "no text session is active".to_string(),
            ));
        };
        Ok(session.insert_text(text))
    }

    /// Deletes the char before the caret (Backspace inside the session).
    /// Errors when no session is active; returns `false` at the start or
    /// mid-composition without changing anything.
    pub fn text_backspace(&mut self) -> EngineResult<bool> {
        let Some(session) = self.text_session.as_mut() else {
            return Err(crate::EngineError::InvalidInput(
                "no text session is active".to_string(),
            ));
        };
        Ok(session.backspace())
    }

    /// Deletes the char after the caret (Delete inside the session).
    /// Errors when no session is active; returns `false` at the end or
    /// mid-composition without changing anything.
    pub fn text_delete_forward(&mut self) -> EngineResult<bool> {
        let Some(session) = self.text_session.as_mut() else {
            return Err(crate::EngineError::InvalidInput(
                "no text session is active".to_string(),
            ));
        };
        Ok(session.delete_forward())
    }

    /// Moves the caret to a char index into the draft, clamped to the
    /// draft length. Errors when no session is active. Returns the clamped
    /// caret so hosts can sync their native selection exactly.
    pub fn text_set_caret(&mut self, caret: usize) -> EngineResult<usize> {
        let Some(session) = self.text_session.as_mut() else {
            return Err(crate::EngineError::InvalidInput(
                "no text session is active".to_string(),
            ));
        };
        session.set_caret(caret);
        Ok(session.caret())
    }

    /// Opens an IME composition on the active session.
    pub fn composition_start(&mut self) -> EngineResult<()> {
        let Some(session) = self.text_session.as_mut() else {
            return Err(crate::EngineError::InvalidInput(
                "no text session is active".to_string(),
            ));
        };
        session.composition_start();
        Ok(())
    }

    /// Buffers an intermediate IME update (never finalizes text).
    pub fn composition_update(&mut self, buffer: String) -> EngineResult<()> {
        let Some(session) = self.text_session.as_mut() else {
            return Err(crate::EngineError::InvalidInput(
                "no text session is active".to_string(),
            ));
        };
        session.composition_update(buffer);
        Ok(())
    }

    /// Ends the IME composition, merging the final string at the caret.
    pub fn composition_end(&mut self, final_text: &str) -> EngineResult<()> {
        let Some(session) = self.text_session.as_mut() else {
            return Err(crate::EngineError::InvalidInput(
                "no text session is active".to_string(),
            ));
        };
        session.composition_end(final_text);
        Ok(())
    }

    /// Commits the active session with host measurement (TS `finishEditing`
    /// parity: trim + delete-when-empty + re-measure). Returns `true` when
    /// the document changed; `false` with no session.
    ///
    /// A committed element becomes the selection, so the bounding box and
    /// handles appear when editing ends. A deleted element leaves the
    /// selection instead of lingering in it.
    pub fn commit_text<M: TextMeasurer>(&mut self, measurer: &M) -> EngineResult<bool> {
        let Some(session) = self.text_session.take() else {
            return Ok(false);
        };
        self.events.push(EditorEvent::TextEditingChanged(None));
        let target = session.target().clone();
        let Some(element) = self.doc.get(target.as_str()) else {
            return Ok(false);
        };
        let Element::Text(text) = element else {
            return Err(crate::EngineError::InvalidInput(format!(
                "text session target '{}' is not a text element",
                target.as_str()
            )));
        };
        let is_new = session.is_new();
        let action = session.commit_action(
            measurer,
            text.base.width,
            text.base.height,
            text.font_size,
            &text.font_family,
        );
        match action {
            TextCommitAction::Delete { id } => {
                if is_new {
                    self.history.cancel_transaction(&mut self.doc)?;
                    return Ok(false);
                }
                let outcome = self
                    .history
                    .execute(&mut self.doc, DeleteElements::new(vec![id.clone()]))?;
                self.after_mutation(&outcome);
                if self.state.selection.ids().contains(&id) {
                    let remaining = self
                        .state
                        .selection
                        .ids()
                        .iter()
                        .filter(|selected| *selected != &id)
                        .cloned()
                        .collect();
                    self.select(remaining);
                }
                Ok(outcome.changed)
            }
            TextCommitAction::Upsert {
                id,
                text,
                width,
                height,
            } => {
                let selected = id.clone();
                let outcome = self
                    .history
                    .execute(&mut self.doc, SetText::new(id, text, width, height))?;
                if is_new {
                    self.history.commit_transaction(&self.doc);
                }
                self.after_mutation(&outcome);
                self.select(vec![selected]);
                Ok(outcome.changed)
            }
        }
    }

    /// Cancels text editing with no document change (TS `cancelEditing`
    /// parity). Returns `true` when a session was dropped. A session over
    /// a freshly created element also rolls back its open creation
    /// transaction, so no empty ghost element or undo entry is left behind
    /// (the commit-empty path cancels the same transaction).
    pub fn cancel_text(&mut self) -> EngineResult<bool> {
        let Some(session) = self.text_session.take() else {
            return Ok(false);
        };
        let is_new = session.is_new();
        drop(session);
        self.events.push(EditorEvent::TextEditingChanged(None));
        if is_new && self.history.in_transaction() {
            self.history.cancel_transaction(&mut self.doc)?;
        }
        Ok(true)
    }

    // -- normalized wheel dispatch ----------------------------------------

    /// Applies a wheel event to the viewport: Ctrl/Cmd-held wheels zoom
    /// cursor-anchored (factor 0.9/1.1, clamped 0.1–10), plain wheels pan
    /// (TS `pan-zoom.ts` parity).
    pub fn apply_wheel(
        &mut self,
        delta_x: f64,
        delta_y: f64,
        zoom_gesture: bool,
        x: f64,
        y: f64,
    ) -> EngineResult<()> {
        if !delta_x.is_finite() || !delta_y.is_finite() {
            return Err(crate::EngineError::InvalidInput(format!(
                "wheel delta must be finite, got ({delta_x}, {delta_y})"
            )));
        }
        match wheel_intent(delta_x, delta_y, zoom_gesture) {
            WheelIntent::Zoom { factor } => self.zoom_by(factor, x, y),
            WheelIntent::Pan { dx, dy } => {
                let zoom = self.state.viewport.zoom;
                self.state.viewport.scroll_x -= dx / zoom;
                self.state.viewport.scroll_y -= dy / zoom;
                self.emit_viewport();
                Ok(())
            }
        }
    }

    /// Pans by screen-pixel deltas (host drives space-drag pans through
    /// this; middle-drag pans run through the phase machine instead).
    pub fn pan_by_screen(&mut self, dx_px: f64, dy_px: f64) -> EngineResult<()> {
        if !dx_px.is_finite() || !dy_px.is_finite() {
            return Err(crate::EngineError::InvalidInput(format!(
                "pan delta must be finite, got ({dx_px}, {dy_px})"
            )));
        }
        let zoom = self.state.viewport.zoom;
        self.state.viewport.scroll_x += dx_px / zoom;
        self.state.viewport.scroll_y += dy_px / zoom;
        self.emit_viewport();
        Ok(())
    }

    /// Cursor-anchored zoom by a multiplicative factor (clamped 0.1–10 —
    /// TS `clampZoom` parity).
    pub fn zoom_by(&mut self, factor: f64, screen_x: f64, screen_y: f64) -> EngineResult<()> {
        if !factor.is_finite() || factor <= 0.0 {
            return Err(crate::EngineError::InvalidInput(format!(
                "zoom factor must be positive and finite, got {factor}"
            )));
        }
        if !screen_x.is_finite() || !screen_y.is_finite() {
            return Err(crate::EngineError::InvalidInput(format!(
                "zoom anchor must be finite, got ({screen_x}, {screen_y})"
            )));
        }
        let viewport = self.state.viewport;
        let anchor = screen_to_scene(&[screen_x, screen_y], &viewport);
        let zoom = clamp_zoom(viewport.zoom * factor);
        self.state.viewport.zoom = zoom;
        self.state.viewport.scroll_x = screen_x / zoom - anchor[0];
        self.state.viewport.scroll_y = screen_y / zoom - anchor[1];
        self.emit_viewport();
        Ok(())
    }

    /// Transient move preview for host live rendering: the snapped delta
    /// and guides for a drag from `from_scene` to `to_scene` without
    /// touching the document or history (the commit path reuses the same
    /// math, so preview and commit agree).
    pub fn preview_move_delta(
        &self,
        affected: &[ElementId],
        from_scene: [f64; 2],
        to_scene: [f64; 2],
        axis_lock: bool,
    ) -> (f64, f64, Vec<SnapGuide>) {
        let mut dx = to_scene[0] - from_scene[0];
        let mut dy = to_scene[1] - from_scene[1];
        if axis_lock {
            if dx.abs() >= dy.abs() {
                dy = 0.0;
            } else {
                dx = 0.0;
            }
        }
        snap_move_delta(
            &self.doc,
            affected,
            dx,
            dy,
            &self.snap_config,
            self.state.viewport.zoom,
        )
    }

    /// Read-only move preview over explicit ids (the `previewMove` protocol
    /// query): snapped delta plus guides without touching the document or
    /// history. Non-finite endpoints are a typed error. Unknown, deleted,
    /// and locked ids filter exactly like the commit path.
    pub fn preview_move(
        &self,
        ids: &[ElementId],
        from_scene: [f64; 2],
        to_scene: [f64; 2],
        axis_lock: bool,
    ) -> EngineResult<(f64, f64, Vec<SnapGuide>)> {
        if !crate::geometry::point_is_finite(&from_scene)
            || !crate::geometry::point_is_finite(&to_scene)
        {
            return Err(crate::EngineError::InvalidInput(format!(
                "preview move endpoints must be finite, got ({from_scene:?}, {to_scene:?})"
            )));
        }
        Ok(self.preview_move_delta(ids, from_scene, to_scene, axis_lock))
    }

    /// Read-only resize preview (the `previewResize` protocol query): the
    /// box a handle drag would commit, without touching the document or
    /// history. Returns `None` for unknown/deleted/locked targets, exactly
    /// like the commit path's unchanged no-op.
    pub fn preview_resize(
        &self,
        id: &ElementId,
        handle: HandleType,
        to_scene: [f64; 2],
        lock_aspect: bool,
    ) -> EngineResult<Option<crate::command::ResizedBox>> {
        crate::command::preview_resize_box(&self.doc, id, handle, to_scene, lock_aspect)
    }

    /// Read-only rotation preview (the `previewRotate` protocol query): the
    /// angle a rotate drag would commit, without touching the document or
    /// history. Returns `None` for unknown/deleted/locked targets.
    pub fn preview_rotate(
        &self,
        id: &ElementId,
        anchor_scene: [f64; 2],
        to_scene: [f64; 2],
        snap: bool,
    ) -> EngineResult<Option<f64>> {
        crate::command::preview_rotation(&self.doc, id, anchor_scene, to_scene, snap)
    }

    // -- single normalized entry point ------------------------------------

    /// Routes any normalized [`InputEvent`] (the module-07 host boundary:
    /// one match, deterministic, no DOM anywhere below this call).
    pub fn handle_input(&mut self, event: InputEvent) -> EngineResult<InputOutcome> {
        match event {
            InputEvent::PointerDown {
                x,
                y,
                button,
                modifiers,
                click_count,
            } => Ok(InputOutcome::PointerDown(self.pointer_down(
                x,
                y,
                button,
                modifiers,
                click_count,
            )?)),
            InputEvent::PointerMove { x, y, modifiers } => Ok(InputOutcome::PointerMove(
                self.pointer_move(x, y, modifiers)?,
            )),
            InputEvent::PointerUp {
                x,
                y,
                button,
                modifiers,
            } => Ok(InputOutcome::PointerUp(
                self.pointer_up(x, y, button, modifiers)?,
            )),
            InputEvent::PointerCancel => {
                self.pointer_cancel()?;
                Ok(InputOutcome::PointerCancelled)
            }
            InputEvent::KeyDown { key, modifiers } => {
                Ok(InputOutcome::Key(self.handle_key(key, modifiers)?))
            }
            InputEvent::KeyUp { .. } => Ok(InputOutcome::Ignored),
            InputEvent::TextInput { text } => {
                Ok(InputOutcome::TextInserted(self.text_insert(&text)?))
            }
            InputEvent::CompositionStart => {
                self.composition_start()?;
                Ok(InputOutcome::CompositionHandled)
            }
            InputEvent::CompositionUpdate { buffer } => {
                self.composition_update(buffer)?;
                Ok(InputOutcome::CompositionHandled)
            }
            InputEvent::CompositionEnd { final_text } => {
                self.composition_end(&final_text)?;
                Ok(InputOutcome::CompositionHandled)
            }
            InputEvent::Wheel {
                delta_x,
                delta_y,
                zoom_gesture,
                x,
                y,
            } => {
                self.apply_wheel(delta_x, delta_y, zoom_gesture, x, y)?;
                Ok(InputOutcome::WheelApplied)
            }
        }
    }

    // -- undo / redo (guarded) --------------------------------------------

    /// Undoes the last entry. Refused (`false`) while a gesture, pointer
    /// capture, or text session is active (TS `Editor.undo` guard parity —
    /// no undo mid-gesture).
    pub fn undo(&mut self) -> EngineResult<bool> {
        if self.gesture.is_some() || self.pointer_phase.is_captured() || self.text_session.is_some()
        {
            return Ok(false);
        }
        let undone = self.history.undo(&mut self.doc)?;
        if undone {
            self.emit_mutation();
        }
        Ok(undone)
    }

    /// Redoes the last undone entry. Refused (`false`) under the same
    /// guards as [`Editor::undo`].
    pub fn redo(&mut self) -> EngineResult<bool> {
        if self.gesture.is_some() || self.pointer_phase.is_captured() || self.text_session.is_some()
        {
            return Ok(false);
        }
        let redone = self.history.redo(&mut self.doc)?;
        if redone {
            self.emit_mutation();
        }
        Ok(redone)
    }

    // Private helpers

    /// Press-time selection for a hit id (group-aware, additive toggle,
    /// exact-match keep, deferred collapse).
    fn press_select(&mut self, hit_id: &ElementId, additive: bool) {
        if self.editing_group_id.is_some() {
            if additive {
                self.state.selection.toggle(hit_id.clone());
                self.pending_collapse = None;
                self.emit_selection();
            } else if !self.state.selection.contains(hit_id) {
                self.state.selection.select(vec![hit_id.clone()]);
                self.pending_collapse = None;
                self.emit_selection();
            } else if self.state.selection.len() > 1 {
                self.pending_collapse = Some(vec![hit_id.clone()]);
            } else {
                self.pending_collapse = None;
            }
            return;
        }
        let ids = resolve_group_selection(&self.doc, hit_id);
        if additive {
            for id in &ids {
                self.state.selection.toggle(id.clone());
            }
            self.pending_collapse = None;
            self.emit_selection();
        } else if !selection_is_exact(self.state.selection.ids(), &ids) {
            self.state.selection.select(ids);
            self.pending_collapse = None;
            self.emit_selection();
        } else if self.state.selection.len() > ids.len() {
            // Re-click on a member of a larger selection defers the
            // collapse so a drag still moves the whole set (TS parity).
            self.pending_collapse = Some(ids);
        } else {
            self.pending_collapse = None;
        }
    }

    /// Right-click selection (TS `button == 2` parity: ignored while a
    /// capture is held — callers check — and selects the hit when it is
    /// not already selected).
    fn right_click_select(&mut self, hit_id: &ElementId, additive: bool) {
        if self.editing_group_id.is_some() {
            if additive {
                self.state.selection.toggle(hit_id.clone());
            } else {
                self.state.selection.select(vec![hit_id.clone()]);
            }
        } else {
            let ids = resolve_group_selection(&self.doc, hit_id);
            if additive {
                for id in &ids {
                    self.state.selection.toggle(id.clone());
                }
            } else {
                self.state.selection.select(ids);
            }
        }
        self.emit_selection();
    }

    /// Commits the active text session with the deterministic fallback
    /// measurer (tool-switch / outside-click / Escape paths where the host
    /// did not commit explicitly with native metrics — the 0.6-factor
    /// estimate matches the caret model, so boxes stay deterministic).
    fn commit_text_with_fallback(&mut self) -> EngineResult<bool> {
        if self.text_session.is_none() {
            return Ok(false);
        }
        let measurer = FallbackMeasurer;
        self.commit_text(&measurer)
    }

    /// Drops the pointer capture and pending collapse without document or
    /// history effects, emitting one cancellation when captured.
    fn cancel_pointer_capture(&mut self) {
        if self.pointer_phase.is_captured() {
            self.pointer_phase = EditorPointerPhase::Idle;
            self.pending_collapse = None;
            self.events.push(EditorEvent::GestureCancelled);
        } else {
            self.pending_collapse = None;
        }
    }

    /// Emits mutation notifications when a command actually changed content.
    fn after_mutation(&mut self, outcome: &CommandOutcome) {
        if outcome.changed {
            self.emit_mutation();
        }
    }

    /// Pushes document + history notifications.
    fn emit_mutation(&mut self) {
        self.events.push(EditorEvent::DocumentChanged);
        self.events
            .push(EditorEvent::HistoryChanged(self.history.status()));
    }

    /// Pushes a selection notification.
    fn emit_selection(&mut self) {
        self.events.push(EditorEvent::SelectionChanged(
            self.state.selection.ids().to_vec(),
        ));
    }

    /// Pushes a viewport notification.
    fn emit_viewport(&mut self) {
        self.events
            .push(EditorEvent::ViewportChanged(self.state.viewport));
    }
}

/// Returns `true` when the selection holds exactly `ids` (TS
/// `isSelectionExact` parity: same size and full membership).
fn selection_is_exact(current: &[ElementId], ids: &[ElementId]) -> bool {
    if current.len() != ids.len() {
        return false;
    }
    ids.iter().all(|id| current.contains(id))
}

impl Default for Editor {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::element::create_rectangle;

    fn rectangle(id: &str, gen: &mut CounterIdGenerator) -> Element {
        let mut rect = create_rectangle(gen);
        rect.base.id = ElementId::of(id);
        Element::Rectangle(rect)
    }

    #[test]
    fn create_select_drag_undo_redo_flow() {
        let mut editor = Editor::new();
        let mut gen = CounterIdGenerator::new();
        let id = editor.create(rectangle("r1", &mut gen)).unwrap();
        editor.select(vec![id.clone()]);
        assert_eq!(editor.state().selection.ids(), std::slice::from_ref(&id));

        editor.gesture_begin(vec![id.clone()], 0.0, 0.0).unwrap();
        assert!(editor.gesture_active());
        assert!(editor.gesture_update(10.0, 0.0).unwrap());
        assert!(!editor.undo().unwrap(), "undo refused mid-gesture");
        assert!(editor.gesture_commit().unwrap());
        assert_eq!(editor.document().get("r1").unwrap().base().x, 10.0);

        assert!(editor.undo().unwrap());
        assert_eq!(editor.document().get("r1").unwrap().base().x, 0.0);
        assert!(editor.redo().unwrap());
        assert_eq!(editor.document().get("r1").unwrap().base().x, 10.0);
    }

    #[test]
    fn gesture_cancel_leaves_no_trace() {
        let mut editor = Editor::new();
        let mut gen = CounterIdGenerator::new();
        editor.create(rectangle("r1", &mut gen)).unwrap();
        let nonce_before = editor.document().scene_nonce();
        let undo_before = editor.history().undo_len();

        editor
            .gesture_begin(vec![ElementId::of("r1")], 0.0, 0.0)
            .unwrap();
        editor.gesture_update(50.0, 50.0).unwrap();
        editor.gesture_cancel().unwrap();

        assert_eq!(editor.document().get("r1").unwrap().base().x, 0.0);
        assert_eq!(editor.document().scene_nonce(), nonce_before);
        assert_eq!(editor.history().undo_len(), undo_before);
        assert!(!editor.gesture_active());
    }

    #[test]
    fn tool_switch_cancels_gesture() {
        let mut editor = Editor::new();
        let mut gen = CounterIdGenerator::new();
        editor.create(rectangle("r1", &mut gen)).unwrap();
        editor
            .gesture_begin(vec![ElementId::of("r1")], 0.0, 0.0)
            .unwrap();
        editor.gesture_update(50.0, 0.0).unwrap();
        assert!(editor.set_active_tool("rectangle").unwrap());
        assert!(!editor.gesture_active());
        assert_eq!(editor.document().get("r1").unwrap().base().x, 0.0);
        assert_eq!(editor.state().active_tool, "rectangle");
    }

    #[test]
    fn new_text_defaults_to_contrasting_stroke() {
        let mut editor = Editor::new();
        let id = editor.start_text_at(10.0, 20.0).unwrap();
        let Element::Text(text) = editor.document().get(id.as_str()).unwrap() else {
            panic!("expected a text element");
        };
        // Default canvas background is white, so the default stroke is black.
        assert_eq!(text.base.stroke_color, "#000000");
    }

    #[test]
    fn new_text_is_white_on_dark_canvas() {
        let mut editor = Editor::new();
        editor.set_theme(crate::theme::resolve_theme(Some(
            &crate::theme::ThemeOverride {
                colors: Some(crate::theme::ThemeColorsOverride {
                    canvas_background: Some("#141412".to_string()),
                    ..Default::default()
                }),
                ..Default::default()
            },
        )));
        let id = editor.start_text_at(10.0, 20.0).unwrap();
        let Element::Text(text) = editor.document().get(id.as_str()).unwrap() else {
            panic!("expected a text element");
        };
        assert_eq!(text.base.stroke_color, "#ffffff");
    }

    #[test]
    fn text_session_hides_selection_and_commit_selects() {
        let mut editor = Editor::new();
        let id = editor.start_text_at(10.0, 20.0).unwrap();
        assert!(
            editor.state().selection.ids().is_empty(),
            "no box paints under the caret while editing"
        );
        editor.text_insert("hi").unwrap();
        let measurer = FallbackMeasurer;
        assert!(editor.commit_text(&measurer).unwrap());
        assert_eq!(editor.state().selection.ids(), &[id]);
    }

    #[test]
    fn commit_empty_existing_text_drops_it_from_selection() {
        let mut editor = Editor::new();
        let id = editor.start_text_at(10.0, 20.0).unwrap();
        editor.text_insert("hi").unwrap();
        let measurer = FallbackMeasurer;
        assert!(editor.commit_text(&measurer).unwrap());
        assert_eq!(editor.state().selection.ids(), std::slice::from_ref(&id));

        editor.start_text_at(10.0, 20.0).unwrap();
        assert!(editor.state().selection.ids().is_empty());
        let session_id = editor.text_editing().cloned().unwrap();
        assert_eq!(session_id, id);
        editor.text_set_caret(usize::MAX).unwrap();
        for _ in 0.."hi".len() {
            editor.text_backspace().unwrap();
        }
        assert!(editor.commit_text(&measurer).unwrap());
        assert!(
            editor.state().selection.ids().is_empty(),
            "the deleted element must not linger in the selection"
        );
    }

    #[test]
    fn cancel_new_text_leaves_no_ghost_or_history() {
        let mut editor = Editor::new();
        let undo_before = editor.history().undo_len();
        let id = editor.start_text_at(10.0, 20.0).unwrap();
        assert!(editor.document().contains(id.as_str()));
        assert!(editor.cancel_text().unwrap());
        assert!(
            !editor.document().contains(id.as_str()),
            "cancelled provisional text must be rolled back"
        );
        assert_eq!(editor.history().undo_len(), undo_before);
        assert!(!editor.history().in_transaction());
    }

    #[test]
    fn commit_empty_new_text_leaves_no_ghost_or_history() {
        let mut editor = Editor::new();
        let undo_before = editor.history().undo_len();
        let id = editor.start_text_at(10.0, 20.0).unwrap();
        editor.text_insert("   ").unwrap();
        let measurer = FallbackMeasurer;
        assert!(!editor.commit_text(&measurer).unwrap());
        assert!(!editor.document().contains(id.as_str()));
        assert_eq!(editor.history().undo_len(), undo_before);
    }

    #[test]
    fn text_resize_keeps_font_and_auto_height() {
        use crate::geometry::transform::HandleType;
        let mut editor = Editor::new();
        let id = editor.start_text_at(10.0, 20.0).unwrap();
        editor.text_insert("hi").unwrap();
        let measurer = FallbackMeasurer;
        assert!(editor.commit_text(&measurer).unwrap());
        let font_before = match editor.document().get(id.as_str()).unwrap() {
            Element::Text(text) => text.font_size,
            _ => panic!("expected text"),
        };
        // Horizontal resize: width follows, height stays one line, font stays.
        let outcome = editor
            .execute_command(crate::command::ResizeElements::new(
                id.clone(),
                HandleType::MiddleRight,
                [200.0, 20.0],
                false,
            ))
            .unwrap();
        assert!(outcome.changed);
        match editor.document().get(id.as_str()).unwrap() {
            Element::Text(text) => {
                assert_eq!(text.font_size, font_before);
                assert_eq!(
                    text.base.height,
                    font_before * crate::element::TEXT_LINE_HEIGHT_MULTIPLIER
                );
            }
            _ => panic!("expected text"),
        }
    }

    #[test]
    fn text_corner_resize_scales_font_and_preview_agrees() {
        use crate::geometry::transform::HandleType;
        let mut editor = Editor::new();
        let id = editor.start_text_at(10.0, 20.0).unwrap();
        editor.text_insert("hi").unwrap();
        let measurer = FallbackMeasurer;
        assert!(editor.commit_text(&measurer).unwrap());
        // Box is 19.2 wide (2 chars at 0.6 factor); doubling it must double
        // the font, with the height following the content at the new size.
        // The read-only preview and the commit use the same math.
        let preview = editor
            .preview_resize(&id, HandleType::BottomRight, [48.4, 40.0], false)
            .unwrap()
            .expect("preview resolves");
        let outcome = editor
            .execute_command(crate::command::ResizeElements::new(
                id.clone(),
                HandleType::BottomRight,
                [48.4, 40.0],
                false,
            ))
            .unwrap();
        assert!(outcome.changed);
        match editor.document().get(id.as_str()).unwrap() {
            Element::Text(text) => {
                assert_eq!(text.font_size, 32.0);
                assert_eq!(text.base.width, preview.width);
                assert_eq!(text.base.height, 40.0);
                assert_eq!(text.base.height, preview.height);
            }
            _ => panic!("expected text"),
        }
    }
}
