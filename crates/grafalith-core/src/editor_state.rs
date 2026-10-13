//! Transient editor state: selection, active tool, and viewport.
//!
//! TS sources: `packages/core/src/editor/editor.ts` (`activeTool`,
//! `enabledTools`, `viewport`, `setActiveTool` gate) and
//! `packages/core/src/interaction/selection.ts` (`SelectionState` shape).
//!
//! Transient/editor-session separation: this state is *transient* — it never enters the
//! [`Document`](crate::document::Document), never serializes, and carries no
//! version/nonce. [`SelectionState`](crate::selection::SelectionState)
//! already lives in its own module; this module adds the viewport, the tool
//! gate, and the owning [`EditorState`] struct. Gesture sessions (pointer
//! origin, drag threshold, transient transform) live in
//! [`crate::gesture`]; the thin intent facade over all three is
//! [`crate::editor::Editor`].

use crate::canvas_mode::CanvasMode;
use crate::selection::SelectionState;

/// Viewport state: scroll offset plus zoom (TS `Viewport` parity).
///
/// Single-owner re-export: the shape and its math live in
/// [`crate::geometry::viewport`] (no duplicated viewport state between
/// session and math). Transient like all of this module:
/// never serialized, no version/nonce.
pub use crate::geometry::viewport::Viewport;

/// Transient editor state: what the user is doing, not what the document
/// contains.
#[derive(Debug, Clone, PartialEq)]
pub struct EditorState {
    /// Currently selected element ids (ordered, de-duplicated).
    pub selection: SelectionState,
    /// Active tool id (TS default `'select'`).
    pub active_tool: String,
    /// Allowed tool ids, or `None` when every tool is allowed (TS
    /// `enabledTools` parity).
    pub enabled_tools: Option<Vec<String>>,
    /// Canvas mode: unbounded workboard or fixed-size page. Per-project
    /// host config applied at session start; never serialized with the
    /// document (transient like the rest of this struct).
    pub canvas_mode: CanvasMode,
    /// Current viewport.
    pub viewport: Viewport,
}

impl EditorState {
    /// Creates default state: empty selection, `select` tool, default
    /// viewport, all tools allowed, infinite canvas.
    pub fn new() -> Self {
        Self {
            selection: SelectionState::new(),
            active_tool: "select".to_string(),
            enabled_tools: None,
            canvas_mode: CanvasMode::default_mode(),
            viewport: Viewport::new(),
        }
    }

    /// Creates state with an explicit tool allow-list.
    pub fn with_enabled_tools(tools: Vec<String>) -> Self {
        Self {
            enabled_tools: Some(tools),
            ..Self::new()
        }
    }

    /// Switches the active tool.
    ///
    /// Returns `false` and changes nothing when the tool is rejected by the
    /// allow-list (TS `setActiveTool` parity — the caller reflects the
    /// rejection in custom UI). Gesture/transaction cancellation on tool
    /// switch lives one layer up in [`crate::editor::Editor`], which owns
    /// the gesture session and the history alongside this state.
    pub fn set_active_tool(&mut self, tool: impl Into<String>) -> bool {
        let tool = tool.into();
        if let Some(allowed) = &self.enabled_tools {
            if !allowed.iter().any(|entry| entry == &tool) {
                return false;
            }
        }
        self.active_tool = tool;
        true
    }
}

impl Default for EditorState {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::element::ElementId;

    #[test]
    fn default_state_matches_ts_initial_values() {
        let state = EditorState::new();
        assert!(state.selection.is_empty());
        assert_eq!(state.active_tool, "select");
        assert_eq!(state.enabled_tools, None);
        assert_eq!(state.canvas_mode, CanvasMode::default_mode());
        assert_eq!(state.viewport, Viewport::new());
        assert_eq!(state.viewport.zoom, 1.0);
    }

    #[test]
    fn tool_gate_rejects_without_mutating() {
        let mut state =
            EditorState::with_enabled_tools(vec!["select".to_string(), "rectangle".to_string()]);
        assert!(state.set_active_tool("rectangle"));
        assert_eq!(state.active_tool, "rectangle");
        assert!(!state.set_active_tool("ellipse"));
        assert_eq!(state.active_tool, "rectangle", "rejected switch keeps tool");
    }

    #[test]
    fn selection_state_is_transient_and_ordered() {
        let mut state = EditorState::new();
        state.selection.select(vec![
            ElementId::of("b"),
            ElementId::of("a"),
            ElementId::of("b"),
        ]);
        assert_eq!(
            state.selection.ids(),
            &[ElementId::of("b"), ElementId::of("a")]
        );
    }
}
