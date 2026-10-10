//! Deliberate host-boundary engine.
//!
//! [`Engine`] is the only stateful surface the bindings expose: an
//! instance-scoped owner of the Rust [`Editor`](grafalith_core::editor::Editor),
//! the [`Clipboard`], and the host-visible asset generation (no globals, so
//! many engines coexist in one WASM module). It reuses the exact
//! command/transaction/io machinery the Rust editor uses — no second
//! implementation of any engine rule.
//!
//! Boundary rules enforced here: every crossing is a JSON string typed in
//! [`protocol`](crate::protocol) — Rust domain types never serialize
//! directly (render/session/event shapes live in
//! [`render_dto`](crate::render_dto)). [`Engine::apply_batch`] executes an
//! op array in **one** crossing and reports per-op outcomes; each op is
//! individually atomic while the batch itself is not a transaction
//! (documented in the result shape, not incidental). Query ops
//! (`renderModel`, `contextMenu`, `drainEvents`, `sessionState`) observe
//! the state left by earlier ops in the same batch, so one frame costs one
//! crossing. Element creation reuses the [`grafalith_io`] import pipeline through
//! a scratch document, so creation-time validation cannot drift from
//! file-import parity. Text commits use the deterministic
//! [`FallbackMeasurer`](grafalith_core::text_session::FallbackMeasurer)
//! (0.6-factor sizing): the TS oracle measures with the canvas 2D context,
//! so hosts needing pixel-exact boxes follow up with `setBounds` (a pinned
//! expected difference, not silent drift). Failures are JSON envelopes,
//! never panics and never Rust internals.

use std::collections::HashSet;

use grafalith_core::boolean::BooleanOp;
use grafalith_core::clipboard::{duplicate_elements, Clipboard};
use grafalith_core::command::{
    CommandOutcome, CreateElements, GroupElements, Reorder, SetLocked, SetStyle, StylePatch,
    UngroupElements,
};
use grafalith_core::document::{Document, ImportSummary, SCHEMA_VERSION};
use grafalith_core::editor::Editor;
use grafalith_core::element::{
    ElementId, StrokeAlign as DomainStrokeAlign, StrokeCap as DomainStrokeCap,
    StrokeJoin as DomainStrokeJoin, StrokeStyle as DomainStrokeStyle,
};
use grafalith_core::extension::Extension;
use grafalith_core::geometry::viewport::Viewport;
use grafalith_core::interaction::{Key, Modifiers, PointerButton};
use grafalith_core::render_model::RenderConfig;
use grafalith_core::text_session::FallbackMeasurer;
use grafalith_core::theme::{resolve_theme, ThemeOverride};
use grafalith_core::zorder::{
    bring_forward_order, bring_to_front_order, send_backward_order, send_to_back_order,
};
use grafalith_core::{EngineError, EngineResult};
use serde_json::{json, Value};

use crate::protocol::{err_result, ok_result, op_name, unsupported_result, OpResult};
use crate::protocol::{
    BatchOp, BatchResult, EngineStatus, JpegOptionsJson, ModifiersJson, PngOptionsJson, PointJson,
    RenderQueryJson, SnapConfigJson, StylePatchJson, ThemeOverrideJson, ViewportStatusJson,
    WebpOptionsJson, PROTOCOL_VERSION,
};
use crate::render_dto::{
    context_intent_name, event_dto, key_action_dto, phase_name, pointer_down_dto, pointer_up_dto,
    render_model_dto, session_state_dto, snap_guide_dto, viewport_dto, RenderCache, RenderCacheKey,
};

/// Bindings crate version (echoed in [`EngineStatus`] for skew detection).
pub const BINDINGS_VERSION: &str = env!("CARGO_PKG_VERSION");

/// Instance-scoped engine handle for one host document view.
///
/// Owns one [`Editor`] (document, history, selection, tool, viewport,
/// pointer machine, text session, theme), one [`Clipboard`], and the asset
/// generation counter. Selection and tool are session mirrors: they accept
/// whatever the host sends (custom tools included, subject to the TS
/// `enabledTools` gate) and never touch history directly.
pub struct Engine {
    editor: Editor,
    clipboard: Clipboard,
    asset_generation: u64,
    /// One-entry render cache: hosts poll `renderModel` every frame, and
    /// most polls repeat the previous inputs exactly.
    render_cache: RenderCache,
}

impl Engine {
    /// Creates an empty engine (`tool` starts as `"select"`, TS parity).
    pub fn new() -> Self {
        Self {
            editor: Editor::new(),
            clipboard: Clipboard::new(),
            asset_generation: 0,
            render_cache: RenderCache::new(),
        }
    }

    /// Returns the bindings crate version.
    pub fn version() -> &'static str {
        BINDINGS_VERSION
    }

    /// Borrows the document (for native embedding; WASM hosts use JSON).
    pub fn document(&self) -> &Document {
        self.editor.document()
    }

    /// Registers a extension on the owned editor (native embedding and SDK
    /// path — extensions are Rust objects and never cross the JSON boundary).
    /// Declared tool ids join the live session; declared commands run via
    /// the `executeCommand` op. Thin delegation: no engine rules live here.
    pub fn register_extension(&mut self, extension: Box<dyn Extension>) -> EngineResult<()> {
        self.editor.register_extension(extension)
    }

    /// Returns the whitelisted status snapshot (hosts poll this for
    /// render-loop dirty checks and toolbar state — no per-element
    /// getter loop exists by design).
    pub fn status(&self) -> EngineStatus {
        let viewport = self.editor.viewport();
        EngineStatus {
            bindings_version: BINDINGS_VERSION.to_string(),
            protocol_version: PROTOCOL_VERSION,
            schema_version: SCHEMA_VERSION,
            element_count: self.editor.document().element_count(),
            scene_nonce: self.editor.document().scene_nonce(),
            can_undo: self.editor.history().can_undo(),
            can_redo: self.editor.history().can_redo(),
            undo_len: self.editor.history().undo_len(),
            redo_len: self.editor.history().redo_len(),
            selection: selection_strings(self.editor.state().selection.ids()),
            tool: self.editor.state().active_tool.clone(),
            order: self
                .editor
                .document()
                .order()
                .iter()
                .map(|id| id.as_str().to_string())
                .collect(),
            viewport: ViewportStatusJson {
                scroll_x: viewport.scroll_x,
                scroll_y: viewport.scroll_y,
                zoom: viewport.zoom,
            },
            text_editing: self.editor.text_editing().map(|id| id.as_str().to_string()),
            pointer_phase: phase_name(self.editor.pointer_phase()).to_string(),
            asset_generation: self.asset_generation,
            pen_active: self.editor.is_pen_active(),
            cropping: self
                .editor
                .cropping_element_id()
                .map(|id| id.as_str().to_string()),
            path_editing: self
                .editor
                .path_editing_id()
                .map(|id| id.as_str().to_string()),
        }
    }

    /// Returns [`Engine::status`] serialized (never fails; falls back to
    /// a minimal literal only if serialization itself breaks).
    pub fn status_json(&self) -> String {
        serde_json::to_string(&self.status()).unwrap_or_else(|_| {
            r#"{"bindingsVersion":"?","protocolVersion":1,"schemaVersion":1,"elementCount":0,"sceneNonce":0,"canUndo":false,"canRedo":false,"undoLen":0,"redoLen":0,"selection":[],"tool":"select","order":[],"viewport":{"scrollX":0,"scrollY":0,"zoom":1},"textEditing":null,"pointerPhase":"idle","assetGeneration":0}"#.to_string()
        })
    }

    /// Exports the document to its scene-JSON string (TS
    /// `exportSceneToJSON` parity, including the tombstone order vector).
    pub fn export_scene(&self) -> EngineResult<String> {
        grafalith_io::export_str(self.editor.document())
    }

    /// Replaces document content from a scene-JSON string.
    ///
    /// Validation, repair, and atomicity are exactly the
    /// [`grafalith_io`] pipeline's (per-element leniency with skip
    /// counts; failures leave the document untouched). `tracked`
    /// records the replacement as one undo entry.
    pub fn import_scene(&mut self, scene_json: &str, tracked: bool) -> EngineResult<ImportSummary> {
        if tracked {
            let (doc, history) = self.editor.doc_history_mut();
            grafalith_io::import_str_tracked(doc, history, scene_json)
        } else {
            grafalith_io::import_str(self.editor.document_mut(), scene_json)
        }
    }

    /// Replaces document content from an SVG string (`svg` feature).
    ///
    /// Same atomicity contract as [`Engine::import_scene`]; shapes resolve
    /// to paths, text chunks to text, groups to group ids, and unsupported
    /// content counts as skips. `tracked` records one undo entry.
    #[cfg(feature = "svg")]
    pub fn import_svg(&mut self, svg: &str, tracked: bool) -> EngineResult<ImportSummary> {
        if tracked {
            let (doc, history) = self.editor.doc_history_mut();
            grafalith_io::import_svg_str_tracked(doc, history, svg)
        } else {
            grafalith_io::import_svg_str(self.editor.document_mut(), svg)
        }
    }

    /// Executes a JSON array of [`BatchOp`] in one crossing and returns
    /// the [`BatchResult`] JSON string. This function itself never fails:
    /// whole-batch parse problems become an error envelope string, and
    /// per-op problems become `ok: false` entries inside the result.
    pub fn apply_batch(&mut self, batch_json: &str) -> String {
        let ops: Vec<BatchOp> = match serde_json::from_str(batch_json) {
            Ok(ops) => ops,
            Err(err) => {
                return crate::protocol::error_envelope(
                    "parseError",
                    &format!("batch must be a JSON array of ops: {err}"),
                );
            }
        };
        let result = self.apply_ops(ops);
        serde_json::to_string(&result).unwrap_or_else(|_| {
            crate::protocol::error_envelope("serializeError", "failed to serialize batch result")
        })
    }

    /// Executes already-parsed ops (the testable core of
    /// [`Engine::apply_batch`]).
    pub fn apply_ops(&mut self, ops: Vec<BatchOp>) -> BatchResult {
        let mut results = Vec::with_capacity(ops.len());
        for op in &ops {
            results.push(self.apply_one(op));
        }
        let applied = results.iter().filter(|result| result.ok).count();
        BatchResult {
            version: PROTOCOL_VERSION,
            applied,
            results,
        }
    }

    /// Undoes one history entry (`false` = nothing to undo, or refused
    /// mid-gesture/editing — TS `Editor.undo` guard parity).
    pub fn undo(&mut self) -> EngineResult<bool> {
        self.editor.undo()
    }

    /// Redoes one history entry (`false` = nothing to redo, or refused
    /// mid-gesture/editing).
    pub fn redo(&mut self) -> EngineResult<bool> {
        self.editor.redo()
    }

    /// Whether `undo` would do anything.
    pub fn can_undo(&self) -> bool {
        self.editor.history().can_undo()
    }

    /// Whether `redo` would do anything.
    pub fn can_redo(&self) -> bool {
        self.editor.history().can_redo()
    }

    /// Current document nonce (render-loop dirty check).
    pub fn scene_nonce(&self) -> u64 {
        self.editor.document().scene_nonce()
    }

    /// Live (non-deleted) element count.
    pub fn element_count(&self) -> usize {
        self.editor.document().element_count()
    }

    /// Encodes the current clipboard buffer to the versioned payload
    /// string for host system-clipboard writes.
    pub fn encode_clipboard(&self) -> EngineResult<String> {
        grafalith_io::encode_clipboard(self.clipboard.buffered())
    }

    /// Decodes a clipboard payload string, reporting admitted ids and
    /// skip counts without touching engine state (hosts decide whether
    /// to feed the ids back through a `paste` op).
    pub fn decode_clipboard(payload: &str) -> EngineResult<Value> {
        let decoded = grafalith_io::decode_clipboard(payload)?;
        Ok(json!({
            "count": decoded.elements.len(),
            "skipped": decoded.skipped,
            "ids": decoded.elements.iter().map(|element| element.id().as_str()).collect::<Vec<_>>(),
        }))
    }

    /// Plans PNG export from JSON options, returning the plan JSON string
    /// (pure math — canvas allocation and rasterization stay host-side).
    pub fn plan_png_export(&self, options_json: &str) -> EngineResult<Value> {
        let options: PngOptionsJson = serde_json::from_str(options_json).map_err(|err| {
            EngineError::InvalidInput(format!("PNG options must be a JSON object: {err}"))
        })?;
        let backend = grafalith_io::PngExportOptions {
            background: options
                .background
                .unwrap_or_else(|| "transparent".to_string()),
            padding: options.padding.unwrap_or(20.0),
            scale: options.scale.unwrap_or(2.0),
        };
        let plan = grafalith_io::plan_png_export(self.editor.document(), &backend)?;
        Ok(json!({
            "contentBounds": {
                "minX": plan.content_bounds.min_x,
                "minY": plan.content_bounds.min_y,
                "maxX": plan.content_bounds.max_x,
                "maxY": plan.content_bounds.max_y,
            },
            "canvasWidthPx": plan.canvas_width_px,
            "canvasHeightPx": plan.canvas_height_px,
            "effectiveScale": plan.effective_scale,
            "background": plan.background,
            "padding": plan.padding,
        }))
    }

    /// Plans JPEG export (pure math — encoding stays host-side). JPEG has
    /// no alpha channel: `"transparent"` resolves to white in the plan.
    pub fn plan_jpeg_export(&self, options_json: &str) -> EngineResult<Value> {
        let options: JpegOptionsJson = serde_json::from_str(options_json).map_err(|err| {
            EngineError::InvalidInput(format!("JPEG options must be a JSON object: {err}"))
        })?;
        let backend = grafalith_io::JpegExportOptions {
            background: options.background.unwrap_or_else(|| "#ffffff".to_string()),
            padding: options.padding.unwrap_or(20.0),
            scale: options.scale.unwrap_or(2.0),
            quality: options.quality.unwrap_or(90),
        };
        let plan = grafalith_io::plan_jpeg_export(self.editor.document(), &backend)?;
        Ok(json!({
            "contentBounds": {
                "minX": plan.content_bounds.min_x,
                "minY": plan.content_bounds.min_y,
                "maxX": plan.content_bounds.max_x,
                "maxY": plan.content_bounds.max_y,
            },
            "canvasWidthPx": plan.canvas_width_px,
            "canvasHeightPx": plan.canvas_height_px,
            "effectiveScale": plan.effective_scale,
            "background": plan.background,
            "padding": plan.padding,
            "quality": plan.quality,
        }))
    }

    /// Plans WebP export (pure math — encoding stays host-side).
    pub fn plan_webp_export(&self, options_json: &str) -> EngineResult<Value> {
        let options: WebpOptionsJson = serde_json::from_str(options_json).map_err(|err| {
            EngineError::InvalidInput(format!("WebP options must be a JSON object: {err}"))
        })?;
        let backend = grafalith_io::WebpExportOptions {
            background: options
                .background
                .unwrap_or_else(|| "transparent".to_string()),
            padding: options.padding.unwrap_or(20.0),
            scale: options.scale.unwrap_or(2.0),
            quality: options.quality.unwrap_or(90),
            lossless: options.lossless.unwrap_or(false),
        };
        let plan = grafalith_io::plan_webp_export(self.editor.document(), &backend)?;
        Ok(json!({
            "contentBounds": {
                "minX": plan.content_bounds.min_x,
                "minY": plan.content_bounds.min_y,
                "maxX": plan.content_bounds.max_x,
                "maxY": plan.content_bounds.max_y,
            },
            "canvasWidthPx": plan.canvas_width_px,
            "canvasHeightPx": plan.canvas_height_px,
            "effectiveScale": plan.effective_scale,
            "background": plan.background,
            "padding": plan.padding,
            "quality": plan.quality,
            "lossless": plan.lossless,
        }))
    }

    // -- single-op dispatch ------------------------------------------------

    fn apply_one(&mut self, op: &BatchOp) -> OpResult {
        match op {
            BatchOp::Create { element } => self.op_create(element),
            BatchOp::Delete { ids } => {
                let outcome = self.editor.delete(ids_of(ids));
                outcome_result(op, outcome)
            }
            BatchOp::Move { ids, dx, dy } => {
                let outcome = self.editor.move_elements(ids_of(ids), *dx, *dy);
                outcome_result(op, outcome)
            }
            BatchOp::SetBounds {
                id,
                x,
                y,
                width,
                height,
            } => {
                let outcome =
                    self.editor
                        .resize_element(ElementId::of(id.clone()), *x, *y, *width, *height);
                outcome_result(op, outcome)
            }
            BatchOp::SetRotation { id, rotation } => {
                let outcome = self
                    .editor
                    .rotate_element(ElementId::of(id.clone()), *rotation);
                outcome_result(op, outcome)
            }
            BatchOp::SetStyle { ids, patch } => self.op_set_style(ids, patch),
            BatchOp::SetLocked { ids, locked } => {
                let outcome = self
                    .editor
                    .execute_command(SetLocked::new(ids_of(ids), *locked));
                outcome_result(op, outcome)
            }
            BatchOp::Reorder { order } => {
                let outcome = self.editor.execute_command(Reorder::new(ids_of(order)));
                outcome_result(op, outcome)
            }
            BatchOp::Group { ids } => {
                let group_id = self.editor.document_mut().fresh_element_id();
                let outcome = self
                    .editor
                    .execute_command(GroupElements::new(ids_of(ids), group_id.clone()));
                match outcome {
                    Ok(result) => ok_result(
                        op_name(op),
                        Some(json!({
                            "groupId": group_id.as_str(),
                            "affected": ids_of_str(&result.affected),
                        })),
                    ),
                    Err(err) => err_result(op_name(op), &err),
                }
            }
            BatchOp::Ungroup { group_id } => {
                let outcome = self
                    .editor
                    .execute_command(UngroupElements::new(ElementId::of(group_id.clone())));
                outcome_result(op, outcome)
            }
            BatchOp::Select { ids } => {
                self.editor.select(ids_of(ids));
                ok_result(
                    op_name(op),
                    Some(json!({ "selected": self.editor.state().selection.ids().len() })),
                )
            }
            BatchOp::SetTool { tool } => match self.editor.set_active_tool(tool.clone()) {
                Ok(accepted) => ok_result(
                    op_name(op),
                    Some(json!({
                        "tool": self.editor.state().active_tool,
                        "accepted": accepted,
                    })),
                ),
                Err(err) => err_result(op_name(op), &err),
            },
            BatchOp::Copy { ids } => {
                let buffered = self.clipboard.copy(self.editor.document(), &ids_of(ids));
                ok_result(
                    op_name(op),
                    Some(json!({
                        "buffered": buffered.len(),
                        "ids": buffered.iter().map(|element| element.id().as_str()).collect::<Vec<_>>(),
                    })),
                )
            }
            BatchOp::Paste { target } => {
                let point = target.as_ref().map(|item: &PointJson| [item.x, item.y]);
                let (doc, history) = self.editor.doc_history_mut();
                match self.clipboard.paste(doc, history, point) {
                    Ok(committed) => ok_result(
                        op_name(op),
                        Some(json!({
                            "count": committed.len(),
                            "ids": committed.iter().map(|element| element.id().as_str()).collect::<Vec<_>>(),
                        })),
                    ),
                    Err(err) => err_result(op_name(op), &err),
                }
            }
            BatchOp::Duplicate { ids } => {
                let (doc, history) = self.editor.doc_history_mut();
                match duplicate_elements(doc, history, &ids_of(ids)) {
                    Ok(committed) => ok_result(
                        op_name(op),
                        Some(json!({
                            "count": committed.len(),
                            "ids": committed.iter().map(|element| element.id().as_str()).collect::<Vec<_>>(),
                        })),
                    ),
                    Err(err) => err_result(op_name(op), &err),
                }
            }
            BatchOp::Cut { ids } => {
                let (doc, history) = self.editor.doc_history_mut();
                match self.clipboard.cut(doc, history, &ids_of(ids)) {
                    Ok(buffered) => {
                        self.prune_selection();
                        ok_result(
                            op_name(op),
                            Some(json!({
                                "buffered": buffered.len(),
                                "ids": buffered.iter().map(|element| element.id().as_str()).collect::<Vec<_>>(),
                            })),
                        )
                    }
                    Err(err) => err_result(op_name(op), &err),
                }
            }
            BatchOp::Nudge { dx, dy } => {
                let outcome = self.editor.nudge_selected(*dx, *dy);
                outcome_result(op, outcome)
            }
            BatchOp::DeleteSelected => match self.editor.delete_selected() {
                Ok(result) => {
                    self.prune_selection();
                    ok_result(
                        op_name(op),
                        Some(json!({ "affected": ids_of_str(&result.affected) })),
                    )
                }
                Err(err) => err_result(op_name(op), &err),
            },
            BatchOp::Undo => match self.undo() {
                Ok(undone) => ok_result(op_name(op), Some(json!({ "undone": undone }))),
                Err(err) => err_result(op_name(op), &err),
            },
            BatchOp::Redo => match self.redo() {
                Ok(redone) => ok_result(op_name(op), Some(json!({ "redone": redone }))),
                Err(err) => err_result(op_name(op), &err),
            },
            BatchOp::ImportScene { scene, tracked } => {
                let payload = scene.to_string();
                match self.import_scene(&payload, *tracked) {
                    Ok(summary) => ok_result(
                        op_name(op),
                        Some(json!({ "imported": summary.imported, "skipped":
                            summary.skipped })),
                    ),
                    Err(err) => err_result(op_name(op), &err),
                }
            }
            #[cfg(feature = "svg")]
            BatchOp::ImportSvg { svg, tracked } => match self.import_svg(svg, *tracked) {
                Ok(summary) => ok_result(
                    op_name(op),
                    Some(json!({ "imported": summary.imported, "skipped":
                            summary.skipped })),
                ),
                Err(err) => err_result(op_name(op), &err),
            },
            BatchOp::ExportScene => match self.export_scene() {
                Ok(scene) => match serde_json::from_str::<Value>(&scene) {
                    Ok(value) => ok_result(op_name(op), Some(value)),
                    Err(err) => unsupported_result(
                        op_name(op),
                        format!("export produced invalid JSON: {err}"),
                    ),
                },
                Err(err) => err_result(op_name(op), &err),
            },
            BatchOp::PointerDown {
                x,
                y,
                button,
                modifiers,
                click_count,
            } => {
                let name = op_name(op);
                match parse_button(button) {
                    Ok(btn) => match self.editor.pointer_down(
                        *x,
                        *y,
                        btn,
                        parse_modifiers(modifiers),
                        *click_count,
                    ) {
                        Ok(outcome) => dto_result(name, pointer_down_dto(&outcome)),
                        Err(err) => err_result(name, &err),
                    },
                    Err(err) => err_result(name, &err),
                }
            }
            BatchOp::PointerMove { x, y, modifiers } => {
                match self.editor.pointer_move(*x, *y, parse_modifiers(modifiers)) {
                    Ok(past_threshold) => ok_result(
                        op_name(op),
                        Some(json!({ "pastThreshold": past_threshold })),
                    ),
                    Err(err) => err_result(op_name(op), &err),
                }
            }
            BatchOp::PointerUp {
                x,
                y,
                button,
                modifiers,
            } => {
                let name = op_name(op);
                match parse_button(button) {
                    Ok(btn) => match self
                        .editor
                        .pointer_up(*x, *y, btn, parse_modifiers(modifiers))
                    {
                        Ok(outcome) => dto_result(name, pointer_up_dto(&outcome)),
                        Err(err) => err_result(name, &err),
                    },
                    Err(err) => err_result(name, &err),
                }
            }
            BatchOp::PointerCancel => match self.editor.pointer_cancel() {
                Ok(()) => ok_result(op_name(op), None),
                Err(err) => err_result(op_name(op), &err),
            },
            BatchOp::KeyDown { key, modifiers } => {
                match self
                    .editor
                    .handle_key(parse_key(key), parse_modifiers(modifiers))
                {
                    Ok(action) => dto_result(op_name(op), key_action_dto(&action)),
                    Err(err) => err_result(op_name(op), &err),
                }
            }
            BatchOp::Wheel {
                dx,
                dy,
                zoom_gesture,
                x,
                y,
            } => match self.editor.apply_wheel(*dx, *dy, *zoom_gesture, *x, *y) {
                Ok(()) => ok_result(
                    op_name(op),
                    Some(json!({ "viewport": viewport_dto(&self.editor.viewport()) })),
                ),
                Err(err) => err_result(op_name(op), &err),
            },
            BatchOp::StartTextAt { x, y } => match self.editor.start_text_at(*x, *y) {
                Ok(id) => ok_result(op_name(op), Some(json!({ "id": id.as_str() }))),
                Err(err) => err_result(op_name(op), &err),
            },
            BatchOp::TextInput { text } => match self.editor.text_insert(text) {
                Ok(inserted) => ok_result(op_name(op), Some(json!({ "inserted": inserted }))),
                Err(err) => err_result(op_name(op), &err),
            },
            BatchOp::TextBackspace => match self.editor.text_backspace() {
                Ok(deleted) => ok_result(op_name(op), Some(json!({ "deleted": deleted }))),
                Err(err) => err_result(op_name(op), &err),
            },
            BatchOp::TextDelete => match self.editor.text_delete_forward() {
                Ok(deleted) => ok_result(op_name(op), Some(json!({ "deleted": deleted }))),
                Err(err) => err_result(op_name(op), &err),
            },
            BatchOp::TextSetCaret { caret } => match self.editor.text_set_caret(*caret) {
                Ok(clamped) => ok_result(op_name(op), Some(json!({ "caret": clamped }))),
                Err(err) => err_result(op_name(op), &err),
            },
            BatchOp::CompositionStart => match self.editor.composition_start() {
                Ok(()) => ok_result(op_name(op), None),
                Err(err) => err_result(op_name(op), &err),
            },
            BatchOp::CompositionUpdate { buffer } => {
                match self.editor.composition_update(buffer.clone()) {
                    Ok(()) => ok_result(op_name(op), None),
                    Err(err) => err_result(op_name(op), &err),
                }
            }
            BatchOp::CompositionEnd { final_text } => {
                match self.editor.composition_end(final_text) {
                    Ok(()) => ok_result(op_name(op), None),
                    Err(err) => err_result(op_name(op), &err),
                }
            }
            BatchOp::CommitText => match self.editor.commit_text(&FallbackMeasurer) {
                Ok(committed) => ok_result(op_name(op), Some(json!({ "committed": committed }))),
                Err(err) => err_result(op_name(op), &err),
            },
            BatchOp::CancelText => match self.editor.cancel_text() {
                Ok(cancelled) => ok_result(op_name(op), Some(json!({ "cancelled": cancelled }))),
                Err(err) => err_result(op_name(op), &err),
            },
            BatchOp::BringToFront { ids } => self.op_reorder_layer(op, ids, LayerMove::Front),
            BatchOp::SendToBack { ids } => self.op_reorder_layer(op, ids, LayerMove::Back),
            BatchOp::BringForward { ids } => self.op_reorder_layer(op, ids, LayerMove::Forward),
            BatchOp::SendBackward { ids } => self.op_reorder_layer(op, ids, LayerMove::Backward),
            BatchOp::Align { ids, mode } => {
                let name = op_name(op);
                match parse_align_mode(mode) {
                    Ok(parsed) => {
                        let outcome = self.editor.align_elements(ids_of(ids), parsed);
                        outcome_result_by_name(name, outcome)
                    }
                    Err(err) => err_result(name, &err),
                }
            }
            BatchOp::Distribute { ids, axis } => {
                let name = op_name(op);
                match parse_distribute_axis(axis) {
                    Ok(parsed) => {
                        let outcome = self.editor.distribute_elements(ids_of(ids), parsed);
                        outcome_result_by_name(name, outcome)
                    }
                    Err(err) => err_result(name, &err),
                }
            }
            BatchOp::ApplyAutoLayout { frame_id } => {
                let outcome = self
                    .editor
                    .apply_auto_layout(ElementId::of(frame_id.clone()));
                outcome_result(op, outcome)
            }
            BatchOp::ResizeSelection {
                ids,
                original,
                next,
            } => {
                use grafalith_core::geometry::rect::Bounds;
                let outcome = self.editor.resize_selection(
                    ids_of(ids),
                    Bounds {
                        min_x: original.min_x,
                        min_y: original.min_y,
                        max_x: original.max_x,
                        max_y: original.max_y,
                    },
                    Bounds {
                        min_x: next.min_x,
                        min_y: next.min_y,
                        max_x: next.max_x,
                        max_y: next.max_y,
                    },
                );
                outcome_result(op, outcome)
            }
            BatchOp::PenBegin => {
                self.editor.pen_begin();
                ok_result(op_name(op), Some(json!({ "active": true })))
            }
            BatchOp::PenClick { x, y } => match self.editor.pen_click([*x, *y]) {
                Ok(closed) => ok_result(op_name(op), Some(json!({ "closed": closed }))),
                Err(err) => err_result(op_name(op), &err),
            },
            BatchOp::PenDragHandle { x, y, alt_break } => {
                match self.editor.pen_drag_handle([*x, *y], *alt_break) {
                    Ok(()) => ok_result(op_name(op), None),
                    Err(err) => err_result(op_name(op), &err),
                }
            }
            BatchOp::PenCommit => match self.editor.pen_commit() {
                Ok(Some(id)) => ok_result(
                    op_name(op),
                    Some(json!({ "committed": true, "id": id.as_str() })),
                ),
                Ok(None) => ok_result(op_name(op), Some(json!({ "committed": false }))),
                Err(err) => err_result(op_name(op), &err),
            },
            BatchOp::PenCancel => {
                self.editor.pen_cancel();
                ok_result(op_name(op), Some(json!({ "active": false })))
            }
            BatchOp::CropStart { id } => match self.editor.start_crop(&ElementId::of(id.clone())) {
                Ok(()) => ok_result(op_name(op), None),
                Err(err) => err_result(op_name(op), &err),
            },
            BatchOp::CropDrag { handle, x, y } => {
                let name = op_name(op);
                match parse_crop_handle(handle) {
                    Ok(parsed) => match self.editor.crop_drag(parsed, [*x, *y]) {
                        Ok(()) => ok_result(name, None),
                        Err(err) => err_result(name, &err),
                    },
                    Err(err) => err_result(name, &err),
                }
            }
            BatchOp::CropCommit => match self.editor.commit_crop() {
                Ok(committed) => ok_result(op_name(op), Some(json!({ "committed": committed }))),
                Err(err) => err_result(op_name(op), &err),
            },
            BatchOp::CropCancel => {
                self.editor.cancel_crop();
                ok_result(op_name(op), Some(json!({ "active": false })))
            }
            BatchOp::PathEditBegin { id } => {
                match self.editor.start_path_edit(&ElementId::of(id.clone())) {
                    Ok(()) => ok_result(op_name(op), None),
                    Err(err) => err_result(op_name(op), &err),
                }
            }
            BatchOp::PathEditPress { x, y, zoom, alt } => {
                match self.editor.path_press([*x, *y], *zoom, *alt) {
                    Ok(kind) => ok_result(op_name(op), Some(json!({ "kind": kind }))),
                    Err(err) => err_result(op_name(op), &err),
                }
            }
            BatchOp::PathEditDrag { x, y, alt_break } => {
                match self.editor.path_drag([*x, *y], *alt_break) {
                    Ok(()) => ok_result(op_name(op), None),
                    Err(err) => err_result(op_name(op), &err),
                }
            }
            BatchOp::PathEditRelease => {
                let released = self.editor.path_release();
                ok_result(op_name(op), Some(json!({ "released": released })))
            }
            BatchOp::PathEditCommit => match self.editor.commit_path_edit() {
                Ok(committed) => ok_result(op_name(op), Some(json!({ "committed": committed }))),
                Err(err) => err_result(op_name(op), &err),
            },
            BatchOp::PathEditCancel => {
                self.editor.cancel_path_edit();
                ok_result(op_name(op), Some(json!({ "active": false })))
            }
            BatchOp::SetViewport { viewport } => {
                let next = Viewport {
                    scroll_x: viewport.scroll_x,
                    scroll_y: viewport.scroll_y,
                    zoom: viewport.zoom,
                };
                match self.editor.set_viewport(next) {
                    Ok(()) => ok_result(
                        op_name(op),
                        Some(json!({ "viewport": viewport_dto(&self.editor.viewport()) })),
                    ),
                    Err(err) => err_result(op_name(op), &err),
                }
            }
            BatchOp::FitViewport {
                canvas_width,
                canvas_height,
                padding,
                ids,
            } => self.op_frame_viewport(op, *canvas_width, *canvas_height, *padding, ids, false),
            BatchOp::FillViewport {
                canvas_width,
                canvas_height,
                padding,
                ids,
            } => self.op_frame_viewport(op, *canvas_width, *canvas_height, *padding, ids, true),
            BatchOp::Configure {
                enabled_tools,
                theme,
                snap,
            } => {
                let result = self.op_configure(
                    op,
                    enabled_tools,
                    theme.as_ref().as_ref(),
                    snap.as_ref().as_ref(),
                );
                if result.ok {
                    self.asset_generation = self.asset_generation.wrapping_add(1);
                }
                result
            }
            BatchOp::NotifyAssetsChanged => {
                self.asset_generation = self.asset_generation.wrapping_add(1);
                ok_result(
                    op_name(op),
                    Some(json!({ "assetGeneration": self.asset_generation })),
                )
            }
            BatchOp::RenderModel { query } => self.op_render_model(op, query),
            BatchOp::PreviewMove {
                ids,
                from,
                to,
                axis_lock,
            } => {
                let name = op_name(op);
                match self.editor.preview_move(
                    &ids_of(ids),
                    [from.x, from.y],
                    [to.x, to.y],
                    *axis_lock,
                ) {
                    Ok((dx, dy, guides)) => dto_result(
                        name,
                        json!({
                            "dx": dx,
                            "dy": dy,
                            "guides": guides.iter().map(snap_guide_dto).collect::<Vec<_>>(),
                        }),
                    ),
                    Err(err) => err_result(name, &err),
                }
            }
            BatchOp::PreviewResize {
                id,
                handle,
                x,
                y,
                lock_aspect,
            } => {
                let name = op_name(op);
                match parse_handle(handle) {
                    Ok(parsed) => {
                        match self.editor.preview_resize(
                            &ElementId::of(id.clone()),
                            parsed,
                            [*x, *y],
                            *lock_aspect,
                        ) {
                            Ok(Some(output)) => dto_result(
                                name,
                                json!({
                                    "changed": true,
                                    "x": output.x,
                                    "y": output.y,
                                    "width": output.width,
                                    "height": output.height,
                                    "fontSize": output.font_size,
                                }),
                            ),
                            Ok(None) => dto_result(name, json!({ "changed": false })),
                            Err(err) => err_result(name, &err),
                        }
                    }
                    Err(err) => err_result(name, &err),
                }
            }
            BatchOp::PreviewRotate {
                id,
                anchor,
                current,
                snap,
            } => {
                let name = op_name(op);
                match self.editor.preview_rotate(
                    &ElementId::of(id.clone()),
                    [anchor.x, anchor.y],
                    [current.x, current.y],
                    *snap,
                ) {
                    Ok(Some(rotation)) => {
                        dto_result(name, json!({ "changed": true, "rotation": rotation }))
                    }
                    Ok(None) => dto_result(name, json!({ "changed": false })),
                    Err(err) => err_result(name, &err),
                }
            }
            BatchOp::ContextMenu => {
                let intents: Vec<&str> = self
                    .editor
                    .context_menu()
                    .iter()
                    .map(context_intent_name)
                    .collect();
                ok_result(op_name(op), Some(json!({ "intents": intents })))
            }
            BatchOp::DrainEvents => {
                let events: Vec<_> = self.editor.drain_events().iter().map(event_dto).collect();
                dto_result(op_name(op), json!({ "events": events }))
            }
            BatchOp::SessionState => dto_result(
                op_name(op),
                session_state_dto(&self.editor, self.asset_generation),
            ),
            BatchOp::ExecuteCommand { command_id } => {
                let outcome = self.editor.execute_extension_command(command_id);
                outcome_result(op, outcome)
            }
            BatchOp::BooleanUnion { ids } => self.op_boolean(op, BooleanOp::Union, ids),
            BatchOp::BooleanSubtract { ids } => self.op_boolean(op, BooleanOp::Subtract, ids),
            BatchOp::BooleanIntersect { ids } => self.op_boolean(op, BooleanOp::Intersect, ids),
            BatchOp::BooleanExclude { ids } => self.op_boolean(op, BooleanOp::Exclude, ids),
        }
    }

    /// Creates one element through the scratch-document import pipeline so
    /// creation-time validation is the file-import validation.
    fn op_create(&mut self, element: &Value) -> OpResult {
        let name = "create";
        let envelope = json!({
            "schemaVersion": SCHEMA_VERSION,
            "elements": [element],
            "elementOrder": [],
        });
        let payload = envelope.to_string();
        let mut scratch = Document::new();
        let admitted = match grafalith_io::import_str(&mut scratch, &payload) {
            Ok(summary) => {
                if summary.imported == 0 {
                    return err_result(
                        name,
                        &EngineError::InvalidInput(
                            "element was skipped as unknown or mistyped".to_string(),
                        ),
                    );
                }
                scratch.get_all().into_iter().cloned().collect::<Vec<_>>()
            }
            Err(err) => return err_result(name, &err),
        };
        match self
            .editor
            .execute_command(CreateElements::new(admitted.clone()))
        {
            Ok(_) => ok_result(
                name,
                Some(json!({
                    "ids": admitted.iter().map(|element| element.id().as_str()).collect::<Vec<_>>(),
                })),
            ),
            Err(err) => err_result(name, &err),
        }
    }

    /// Applies one rectangle boolean op: exactly two ids, one undoable
    /// entry. Non-rectangle inputs surface the stable `unsupported` code;
    /// every other failure is typed.
    fn op_boolean(&mut self, op: &BatchOp, kind: BooleanOp, ids: &[String]) -> OpResult {
        let [first, second] = ids else {
            return err_result(
                op_name(op),
                &EngineError::InvalidInput(format!(
                    "boolean.{} needs exactly two element ids",
                    kind.name()
                )),
            );
        };
        let outcome = self.editor.apply_boolean(
            kind,
            ElementId::of(first.clone()),
            ElementId::of(second.clone()),
        );
        outcome_result(op, outcome)
    }

    /// Fits or fills the canvas with content as one session change.
    fn op_frame_viewport(
        &mut self,
        op: &BatchOp,
        canvas_width: f64,
        canvas_height: f64,
        padding: f64,
        ids: &Option<Vec<String>>,
        fill: bool,
    ) -> OpResult {
        let selection = ids.clone().map(|ids| ids_of(&ids));
        let framed = if fill {
            self.editor
                .fill_viewport(canvas_width, canvas_height, padding, selection)
        } else {
            self.editor
                .fit_viewport(canvas_width, canvas_height, padding, selection)
        };
        match framed {
            Ok(viewport) => ok_result(
                op_name(op),
                Some(json!({ "viewport": viewport_dto(&viewport) })),
            ),
            Err(err) => err_result(op_name(op), &err),
        }
    }

    /// Applies a style patch. Gradient `background` objects parse through
    /// the shared io fill parser (same validation as file import);
    /// mistyped fills are explicit `invalidInput` errors.
    fn op_set_style(&mut self, ids: &[String], patch: &StylePatchJson) -> OpResult {
        let name = "setStyle";
        let domain = match parse_style_patch(patch) {
            Ok(patch) => patch,
            Err(err) => return err_result(name, &err),
        };
        let outcome = self
            .editor
            .execute_command(SetStyle::new(ids_of(ids), domain));
        outcome_result_by_name(name, outcome)
    }

    /// Executes one history-tracked layering move using the shared pure
    /// order math in [`grafalith_core::zorder`] (the same functions the
    /// direct document path uses — one implementation, two call sites).
    fn op_reorder_layer(&mut self, op: &BatchOp, ids: &[String], direction: LayerMove) -> OpResult {
        let name = op_name(op);
        let requested = ids_of(ids);
        let known: Vec<ElementId> = requested
            .into_iter()
            .filter(|id| self.editor.document().contains(id.as_str()))
            .collect();
        let current = self.editor.document().order();
        let next = match direction {
            LayerMove::Front => bring_to_front_order(current, &known),
            LayerMove::Back => send_to_back_order(current, &known),
            LayerMove::Forward => bring_forward_order(current, &known),
            LayerMove::Backward => send_backward_order(current, &known),
        };
        let outcome = self.editor.execute_command(Reorder::new(next));
        outcome_result_by_name(name, outcome)
    }

    /// Applies host configuration: tool allow-list, theme override, snap
    /// config. Each present field validates before any write, so a bad
    /// `configure` leaves the whole session untouched.
    fn op_configure(
        &mut self,
        op: &BatchOp,
        enabled_tools: &Option<Option<Vec<String>>>,
        theme: Option<&ThemeOverrideJson>,
        snap: Option<&SnapConfigJson>,
    ) -> OpResult {
        let name = op_name(op);
        let next_theme = match theme {
            Some(json) => match parse_theme_override(json) {
                Ok(parsed) => Some(resolve_theme(Some(&parsed))),
                Err(err) => return err_result(name, &err),
            },
            None => None,
        };
        let next_snap = match snap {
            Some(json) => match merge_snap_config(self.editor.snap_config(), json) {
                Ok(merged) => Some(merged),
                Err(err) => return err_result(name, &err),
            },
            None => None,
        };
        if let Some(tools) = enabled_tools {
            self.editor.set_enabled_tools(tools.clone());
        }
        if let Some(resolved) = next_theme {
            self.editor.set_theme(resolved);
        }
        if let Some(config) = next_snap {
            self.editor.set_snap_config(config);
        }
        ok_result(
            name,
            Some(json!({
                "tool": self.editor.state().active_tool,
                "enabledTools": self.editor.state().enabled_tools,
            })),
        )
    }

    /// Builds the deterministic host render description for one frame.
    fn op_render_model(&self, op: &BatchOp, query: &RenderQueryJson) -> OpResult {
        let name = op_name(op);
        if !query.canvas_width.is_finite()
            || !query.canvas_height.is_finite()
            || query.canvas_width <= 0.0
            || query.canvas_height <= 0.0
        {
            return err_result(
                name,
                &EngineError::InvalidInput(format!(
                    "render canvas size must be finite and positive, got ({} {})",
                    query.canvas_width, query.canvas_height
                )),
            );
        }
        if let Some(grid_size) = query.grid_size {
            if !grid_size.is_finite() {
                return err_result(
                    name,
                    &EngineError::InvalidInput(format!(
                        "render grid size must be finite, got {grid_size}"
                    )),
                );
            }
        }
        let mut config = RenderConfig::new(query.canvas_width, query.canvas_height);
        config.show_grid = query.show_grid;
        if let Some(grid_size) = query.grid_size {
            config.grid_size = grid_size;
        }
        config.asset_generation = self.asset_generation;
        let ready: HashSet<String> = query.ready_images.iter().cloned().collect();
        // Cached across identical polls (one frame costs one clone, not one
        // rebuild); any input change misses and rebuilds transparently.
        let key = RenderCacheKey::capture(&self.editor, &config, &ready);
        let dto = self
            .render_cache
            .get_or_build(key, || render_model_dto(&self.editor, &config, &ready));
        dto_result(name, dto)
    }

    /// Render-cache hits so far (observability for hosts and benchmarks).
    pub fn render_cache_hits(&self) -> u64 {
        self.render_cache.hits()
    }

    /// Render-cache misses (rebuilds) so far.
    pub fn render_cache_misses(&self) -> u64 {
        self.render_cache.misses()
    }

    /// Drops dead ids from the selection mirror (TS `deleteSelected`
    /// deselects what it deleted).
    fn prune_selection(&mut self) {
        let live: Vec<ElementId> = self
            .editor
            .state()
            .selection
            .ids()
            .iter()
            .filter(|id| {
                self.editor
                    .document()
                    .get(id.as_str())
                    .is_some_and(|element| !element.base().is_deleted)
            })
            .cloned()
            .collect();
        self.editor.select(live);
    }
}

impl Default for Engine {
    /// Creates an empty engine (see [`Engine::new`]).
    fn default() -> Self {
        Self::new()
    }
}

/// History-tracked layering direction for [`Engine::op_reorder_layer`].
#[derive(Debug, Clone, Copy)]
enum LayerMove {
    /// Move to the front (end of the order vector).
    Front,
    /// Move to the back (start of the order vector).
    Back,
    /// Move forward by one step.
    Forward,
    /// Move backward by one step.
    Backward,
}

/// Parses a pointer-button name (touch counts as left).
fn parse_button(button: &str) -> EngineResult<PointerButton> {
    match button {
        "left" => Ok(PointerButton::Left),
        "middle" => Ok(PointerButton::Middle),
        "right" => Ok(PointerButton::Right),
        _ => Err(EngineError::InvalidInput(format!(
            "unknown pointer button '{button}' (expected left, middle, or right)"
        ))),
    }
}

/// Parses a TS kebab-case resize-handle name (see `handle_name`).
fn parse_handle(handle: &str) -> EngineResult<grafalith_core::geometry::transform::HandleType> {
    use grafalith_core::geometry::transform::HandleType as H;
    match handle {
        "top-left" => Ok(H::TopLeft),
        "top-center" => Ok(H::TopCenter),
        "top-right" => Ok(H::TopRight),
        "middle-left" => Ok(H::MiddleLeft),
        "middle-right" => Ok(H::MiddleRight),
        "bottom-left" => Ok(H::BottomLeft),
        "bottom-center" => Ok(H::BottomCenter),
        "bottom-right" => Ok(H::BottomRight),
        _ => Err(EngineError::InvalidInput(format!(
            "unknown resize handle '{handle}' (expected top-left, top-center, top-right, middle-left, middle-right, bottom-left, bottom-center, or bottom-right)"
        ))),
    }
}

/// Converts wire modifiers to domain modifiers.
fn parse_modifiers(modifiers: &ModifiersJson) -> Modifiers {
    Modifiers {
        shift: modifiers.shift,
        alt: modifiers.alt,
        ctrl_or_cmd: modifiers.ctrl_or_cmd,
    }
}

/// Parses an align mode name from the wire (`"left"`, `"right"`, `"top"`,
/// `"bottom"`, `"centerH"`, `"centerV"`).
fn parse_align_mode(mode: &str) -> EngineResult<grafalith_core::alignment::AlignMode> {
    use grafalith_core::alignment::AlignMode as M;
    match mode {
        "left" => Ok(M::Left),
        "right" => Ok(M::Right),
        "top" => Ok(M::Top),
        "bottom" => Ok(M::Bottom),
        "centerH" => Ok(M::CenterH),
        "centerV" => Ok(M::CenterV),
        _ => Err(EngineError::InvalidInput(format!(
            "unknown align mode '{mode}' (expected left, right, top, bottom, centerH, or centerV)"
        ))),
    }
}

/// Parses a distribute axis name from the wire (`"horizontal"`, `"vertical"`).
fn parse_distribute_axis(axis: &str) -> EngineResult<grafalith_core::alignment::DistributeAxis> {
    use grafalith_core::alignment::DistributeAxis as A;
    match axis {
        "horizontal" => Ok(A::Horizontal),
        "vertical" => Ok(A::Vertical),
        _ => Err(EngineError::InvalidInput(format!(
            "unknown distribute axis '{axis}' (expected horizontal or vertical)"
        ))),
    }
}

/// Parses a crop handle name from the wire (TS kebab-case parity).
fn parse_crop_handle(handle: &str) -> EngineResult<grafalith_core::interaction::CropHandle> {
    use grafalith_core::interaction::CropHandle as H;
    match handle {
        "top-left" => Ok(H::TopLeft),
        "top" => Ok(H::Top),
        "top-right" => Ok(H::TopRight),
        "right" => Ok(H::Right),
        "bottom-right" => Ok(H::BottomRight),
        "bottom" => Ok(H::Bottom),
        "bottom-left" => Ok(H::BottomLeft),
        "left" => Ok(H::Left),
        _ => Err(EngineError::InvalidInput(format!(
            "unknown crop handle '{handle}' (expected top-left, top, top-right, right, bottom-right, bottom, bottom-left, or left)"
        ))),
    }
}

/// Parses a host `KeyboardEvent.key` value to a domain key.
///
/// Named keys follow the DOM `key` values (`"Delete"`, `"ArrowLeft"`, …);
/// a single remaining character becomes [`Key::Char`]; anything else rides
/// as [`Key::Other`] (logged, no behavior — host passthrough).
fn parse_key(key: &str) -> Key {
    match key {
        "Delete" => Key::Delete,
        "Backspace" => Key::Backspace,
        "Escape" => Key::Escape,
        "Enter" => Key::Enter,
        "ArrowLeft" => Key::ArrowLeft,
        "ArrowRight" => Key::ArrowRight,
        "ArrowUp" => Key::ArrowUp,
        "ArrowDown" => Key::ArrowDown,
        _ => {
            let mut chars = key.chars();
            match (chars.next(), chars.next()) {
                (Some(first), None) => Key::Char(first),
                _ => Key::Other(key.to_string()),
            }
        }
    }
}

/// Converts a wire theme override to the domain override, rejecting
/// non-finite numeric tokens before anything is applied.
fn parse_theme_override(json: &ThemeOverrideJson) -> EngineResult<ThemeOverride> {
    use grafalith_core::theme::{
        ThemeBorderRadiusOverride, ThemeColorsOverride, ThemeFontsOverride, ThemeSizesOverride,
    };
    let mut parsed = ThemeOverride::default();
    if let Some(colors) = &json.colors {
        parsed.colors = Some(ThemeColorsOverride {
            canvas_background: colors.canvas_background.clone(),
            selection_outline: colors.selection_outline.clone(),
            handle_fill: colors.handle_fill.clone(),
            handle_stroke: colors.handle_stroke.clone(),
            rubber_band_fill: colors.rubber_band_fill.clone(),
            rubber_band_stroke: colors.rubber_band_stroke.clone(),
            grid_line: colors.grid_line.clone(),
            canvas_out_of_bounds_overlay: colors.canvas_out_of_bounds_overlay.clone(),
            canvas_bounds_border: colors.canvas_bounds_border.clone(),
        });
    }
    if let Some(fonts) = &json.fonts {
        parsed.fonts = Some(ThemeFontsOverride {
            family: fonts.family.clone(),
            available_families: fonts.available_families.clone(),
        });
    }
    if let Some(sizes) = &json.sizes {
        let finite = [
            ("handleSize", sizes.handle_size),
            ("rotateHandleRadius", sizes.rotate_handle_radius),
            ("rotateHandleOffset", sizes.rotate_handle_offset),
            ("selectionOutlineWidth", sizes.selection_outline_width),
            ("rotateHandleLineWidth", sizes.rotate_handle_line_width),
            ("handleLineWidth", sizes.handle_line_width),
            ("boundingBoxHitThreshold", sizes.bounding_box_hit_threshold),
        ];
        for (field, value) in finite {
            if let Some(number) = value {
                if !number.is_finite() {
                    return Err(EngineError::InvalidInput(format!(
                        "theme sizes.{field} must be finite, got {number}"
                    )));
                }
            }
        }
        parsed.sizes = Some(ThemeSizesOverride {
            handle_size: sizes.handle_size,
            rotate_handle_radius: sizes.rotate_handle_radius,
            rotate_handle_offset: sizes.rotate_handle_offset,
            selection_outline_width: sizes.selection_outline_width,
            rotate_handle_line_width: sizes.rotate_handle_line_width,
            handle_line_width: sizes.handle_line_width,
            bounding_box_hit_threshold: sizes.bounding_box_hit_threshold,
        });
    }
    if let Some(border_radius) = &json.border_radius {
        for (field, value) in [
            ("handle", border_radius.handle),
            ("panel", border_radius.panel),
        ] {
            if let Some(number) = value {
                if !number.is_finite() {
                    return Err(EngineError::InvalidInput(format!(
                        "theme borderRadius.{field} must be finite, got {number}"
                    )));
                }
            }
        }
        parsed.border_radius = Some(ThemeBorderRadiusOverride {
            handle: border_radius.handle,
            panel: border_radius.panel,
        });
    }
    Ok(parsed)
}

/// Merges a partial wire snap config over the current config, rejecting
/// non-finite numerics before anything is applied.
fn merge_snap_config(
    current: grafalith_core::geometry::snap::SnapConfig,
    json: &SnapConfigJson,
) -> EngineResult<grafalith_core::geometry::snap::SnapConfig> {
    let mut next = current;
    if let Some(grid_size) = json.grid_size {
        if !grid_size.is_finite() {
            return Err(EngineError::InvalidInput(format!(
                "snap gridSize must be finite, got {grid_size}"
            )));
        }
        next.grid_size = grid_size;
    }
    if let Some(snap_to_grid) = json.snap_to_grid {
        next.snap_to_grid = snap_to_grid;
    }
    if let Some(show_grid) = json.show_grid {
        next.show_grid = show_grid;
    }
    if let Some(snap_to_objects) = json.snap_to_objects {
        next.snap_to_objects = snap_to_objects;
    }
    if let Some(snap_threshold) = json.snap_threshold {
        if !snap_threshold.is_finite() {
            return Err(EngineError::InvalidInput(format!(
                "snap snapThreshold must be finite, got {snap_threshold}"
            )));
        }
        next.snap_threshold = snap_threshold;
    }
    Ok(next)
}

/// Parses a scalar style patch (background must already be cleared as a
/// plain string or null by the caller).
fn parse_style_patch(patch: &StylePatchJson) -> EngineResult<StylePatch> {
    let mut domain = StylePatch::default();
    if let Some(color) = &patch.stroke_color {
        domain.stroke_color = Some(color.clone());
    }
    if let Some(color) = &patch.border_color {
        domain.border_color = Some(color.clone());
    }
    if let Some(width) = patch.stroke_width {
        if !width.is_finite() {
            return Err(EngineError::InvalidInput(format!(
                "strokeWidth must be finite, got {width}"
            )));
        }
        domain.stroke_width = Some(width);
    }
    if let Some(style) = &patch.stroke_style {
        domain.stroke_style = Some(match style.as_str() {
            "solid" => DomainStrokeStyle::Solid,
            "dashed" => DomainStrokeStyle::Dashed,
            "dotted" => DomainStrokeStyle::Dotted,
            _ => {
                return Err(EngineError::InvalidInput(format!(
                    "unknown strokeStyle '{style}' (expected solid, dashed, or dotted)"
                )));
            }
        });
    }
    if let Some(cap) = &patch.stroke_cap {
        domain.stroke_cap = Some(match cap.as_str() {
            "butt" => DomainStrokeCap::Butt,
            "round" => DomainStrokeCap::Round,
            "square" => DomainStrokeCap::Square,
            _ => {
                return Err(EngineError::InvalidInput(format!(
                    "unknown strokeCap '{cap}' (expected butt, round, or square)"
                )));
            }
        });
    }
    if let Some(join) = &patch.stroke_join {
        domain.stroke_join = Some(match join.as_str() {
            "miter" => DomainStrokeJoin::Miter,
            "round" => DomainStrokeJoin::Round,
            "bevel" => DomainStrokeJoin::Bevel,
            _ => {
                return Err(EngineError::InvalidInput(format!(
                    "unknown strokeJoin '{join}' (expected miter, round, or bevel)"
                )));
            }
        });
    }
    if let Some(align) = &patch.stroke_align {
        domain.stroke_align = Some(match align.as_str() {
            "inside" => DomainStrokeAlign::Inside,
            "center" => DomainStrokeAlign::Center,
            "outside" => DomainStrokeAlign::Outside,
            _ => {
                return Err(EngineError::InvalidInput(format!(
                    "unknown strokeAlign '{align}' (expected inside, center, or outside)"
                )));
            }
        });
    }
    if let Some(opacity) = patch.opacity {
        if !opacity.is_finite() {
            return Err(EngineError::InvalidInput(format!(
                "opacity must be finite, got {opacity}"
            )));
        }
        domain.opacity = Some(opacity);
    }
    if let Some(background) = &patch.background {
        match background {
            Value::Null => {}
            value => match grafalith_io::parse_fill_style(value) {
                Some(fill) => domain.background = Some(fill),
                None => {
                    return Err(EngineError::InvalidInput(
                        "background must be a color string or gradient object".to_string(),
                    ));
                }
            },
        }
    }
    Ok(domain)
}

/// Converts string ids to domain ids.
fn ids_of(ids: &[String]) -> Vec<ElementId> {
    ids.iter().cloned().map(ElementId::of).collect()
}

/// Renders affected domain ids as strings for result payloads.
fn ids_of_str(ids: &[ElementId]) -> Vec<&str> {
    ids.iter().map(ElementId::as_str).collect()
}

/// Renders selection ids as owned strings for status payloads.
fn selection_strings(ids: &[ElementId]) -> Vec<String> {
    ids.iter().map(|id| id.as_str().to_string()).collect()
}

/// Wraps a serializable DTO in an [`OpResult`] (serialization of plain
/// data cannot fail in practice; a failure becomes `serializeError`).
fn dto_result(op: &str, dto: impl serde::Serialize) -> OpResult {
    match serde_json::to_value(&dto) {
        Ok(data) => ok_result(op, Some(data)),
        Err(err) => unsupported_result(op, format!("failed to serialize result: {err}")),
    }
}

/// Wraps a command outcome in an [`OpResult`] named by the op.
fn outcome_result(op: &BatchOp, outcome: EngineResult<CommandOutcome>) -> OpResult {
    outcome_result_by_name(op_name(op), outcome)
}

/// Wraps a command outcome in an [`OpResult`] with an explicit name.
fn outcome_result_by_name(name: &str, outcome: EngineResult<CommandOutcome>) -> OpResult {
    match outcome {
        Ok(result) => ok_result(
            name,
            Some(json!({
                "affected": ids_of_str(&result.affected),
                "changed": result.changed,
            })),
        ),
        Err(err) => err_result(name, &err),
    }
}
