//! Pure text-editing session: caret, draft, IME composition, commit/cancel.
//!
//! TS sources: `packages/core/src/interaction/text-editor.ts`
//! (`startEditing` / `startEditingAtPosition` defaults, caret estimate
//! `0.6 × fontSize` / line `1.25 × fontSize`, `finishEditing` commit on
//! blur/Escape/outside-click, `cancelEditing` discard, auto-size boxes) and
//! `packages/core/src/editor/editor.ts` (Escape-during-text commits,
//! double-click starts editing, tool-switch finishes editing).
//!
//! IME composition is not ordinary input — intermediate
//! [`TextSession::composition_update`] buffers never finalize text; only
//! [`TextSession::composition_end`] merges. The session owns no textarea
//! (host concern); it owns the draft, the caret, and the commit math, so
//! every transition is unit-testable without a DOM.
//!
//! Whitespace rule: the document layer never trims; this session applies
//! the TS `finishEditing` commit rule (`trim()` + delete-when-empty)
//! verbatim, so intentional whitespace *inside* the text is preserved while
//! the commit boundary matches the behavioral oracle.

use crate::element::{ElementId, TEXT_LINE_HEIGHT_MULTIPLIER};
use crate::render_model::TextMeasurer;

/// Character-width factor for the caret estimate (TS
/// `estimateCaretPosition`: `charW = fontSize * 0.6`).
pub const CARET_CHAR_WIDTH_FACTOR: f64 = 0.6;

/// Estimates the caret char index for a click at scene-space
/// (`click_x`, `click_y`) inside a text run.
///
/// Ports TS `estimateCaretPosition`: the click row maps through
/// `lineHeight = fontSize × 1.25`, the column through `charW = fontSize ×
/// 0.6` over that line's chars, clamped to the text. Hosts with native
/// metrics may override the result — this is the deterministic fallback
/// the oracle pins, not a layout engine.
pub fn estimate_caret_index(
    text: &str,
    font_size: f64,
    click_x: f64,
    click_y: f64,
    element_x: f64,
    element_y: f64,
) -> usize {
    if text.is_empty() || font_size <= 0.0 {
        return 0;
    }
    let line_height = font_size * TEXT_LINE_HEIGHT_MULTIPLIER;
    let char_width = font_size * CARET_CHAR_WIDTH_FACTOR;
    let lines: Vec<&str> = text.split('\n').collect();
    let row = ((click_y - element_y) / line_height).floor() as isize;
    let row = row.clamp(0, lines.len() as isize - 1) as usize;
    let line = lines[row];
    let chars = line.chars().count();
    let col = ((click_x - element_x) / char_width).round() as isize;
    let col = col.clamp(0, chars as isize) as usize;
    lines[..row]
        .iter()
        .map(|line| line.chars().count() + 1)
        .sum::<usize>()
        + col
}

/// Deterministic fallback measurer for host-absent commits.
///
/// Uses the same `0.6 × fontSize` per-char factor as the caret estimate and
/// the TS test mock. Hosts should commit with native canvas metrics for
/// pixel-exact boxes; this keeps tool-switch/outside-click/Escape commits
/// deterministic when the host did not commit explicitly first.
pub struct FallbackMeasurer;

impl TextMeasurer for FallbackMeasurer {
    /// Width estimate: char count × `fontSize × 0.6`.
    fn measure_line_width(&self, line: &str, font_size: f64, _family: &str) -> f64 {
        line.chars().count() as f64 * font_size * CARET_CHAR_WIDTH_FACTOR
    }
}

/// What committing a text session writes to the document.
#[derive(Debug, Clone, PartialEq)]
pub enum TextCommitAction {
    /// Upsert the element with committed text and re-measured box.
    Upsert {
        /// Element to update.
        id: ElementId,
        /// Trimmed committed text.
        text: String,
        /// New box width.
        width: f64,
        /// New box height.
        height: f64,
    },
    /// The committed text is empty: soft-delete the element (TS
    /// `finishEditing` empty branch parity).
    Delete {
        /// Element to soft-delete.
        id: ElementId,
    },
}

/// Computes the commit box for trimmed `text` (TS `finishEditing` parity):
/// new elements auto-size (`max(measured, 10)` × `max(measured, one line)`),
/// existing elements grow but never shrink below their current box.
pub fn commit_box(
    is_new: bool,
    element_width: f64,
    element_height: f64,
    font_size: f64,
    measured_width: f64,
    measured_height: f64,
) -> (f64, f64) {
    let one_line = font_size * TEXT_LINE_HEIGHT_MULTIPLIER;
    if is_new {
        (measured_width.max(10.0), measured_height.max(one_line))
    } else {
        (
            element_width.max(measured_width),
            element_height.max(measured_height).max(one_line),
        )
    }
}

/// Pure text-editing session over one text element.
#[derive(Debug, Clone, PartialEq)]
pub struct TextSession {
    /// Element being edited.
    target: ElementId,
    /// True when the element was just created for this session.
    is_new: bool,
    /// Text at session start (untouched reference for milling).
    base_text: String,
    /// Current draft buffer (committed keystrokes + finished compositions).
    draft: String,
    /// Caret as a char index into `draft`.
    caret: usize,
    /// True between [`TextSession::composition_start`] and
    /// [`TextSession::composition_end`].
    composition_active: bool,
    /// Intermediate IME buffer (never part of the draft until end).
    composition_buffer: String,
}

impl TextSession {
    /// Starts a session for a freshly created empty element (caret at 0,
    /// textarea-select-all parity: the first keystroke replaces nothing —
    /// hosts implement select-all visually; the draft starts empty).
    pub fn begin_new(target: ElementId) -> Self {
        Self {
            target,
            is_new: true,
            base_text: String::new(),
            draft: String::new(),
            caret: 0,
            composition_active: false,
            composition_buffer: String::new(),
        }
    }

    /// Starts a session editing existing `base_text`, with the caret at
    /// `caret` (clamped to the text; hosts pass the
    /// [`estimate_caret_index`] result for click-positioned carets, or 0
    /// for select-all).
    pub fn begin_edit(target: ElementId, base_text: String, caret: usize) -> Self {
        let clamped = caret.min(base_text.chars().count());
        Self {
            target,
            is_new: false,
            draft: base_text.clone(),
            base_text,
            caret: clamped,
            composition_active: false,
            composition_buffer: String::new(),
        }
    }

    /// Edited element id.
    pub fn target(&self) -> &ElementId {
        &self.target
    }

    /// Returns `true` for sessions over freshly created elements.
    pub fn is_new(&self) -> bool {
        self.is_new
    }

    /// Current draft buffer.
    pub fn draft(&self) -> &str {
        &self.draft
    }

    /// Caret as a char index into the draft.
    pub fn caret(&self) -> usize {
        self.caret
    }

    /// Moves the caret, clamped to the draft (hosts call this for
    /// arrow-key caret motion, which core never sees as text input).
    pub fn set_caret(&mut self, caret: usize) {
        self.caret = caret.min(self.draft.chars().count());
    }

    /// Returns `true` while an IME composition is open.
    pub fn composition_active(&self) -> bool {
        self.composition_active
    }

    /// Current intermediate IME buffer (for host display only).
    pub fn composition_buffer(&self) -> &str {
        &self.composition_buffer
    }

    /// Inserts plain text at the caret.
    ///
    /// Returns `false` (and changes nothing) while a composition is open —
    /// intermediate keystrokes belong to [`TextSession::composition_update`],
    /// never to the draft.
    pub fn insert_text(&mut self, text: &str) -> bool {
        if self.composition_active {
            return false;
        }
        let byte = self.char_to_byte(self.caret);
        self.draft.insert_str(byte, text);
        self.caret += text.chars().count();
        true
    }

    /// Deletes the char before the caret (Backspace inside the session).
    /// Returns `false` when at the start or composing.
    pub fn backspace(&mut self) -> bool {
        if self.composition_active || self.caret == 0 {
            return false;
        }
        let end = self.char_to_byte(self.caret);
        let start = self.char_to_byte(self.caret - 1);
        self.draft.drain(start..end);
        self.caret -= 1;
        true
    }

    /// Deletes the char after the caret (Delete inside the session).
    /// Returns `false` when at the end or composing. The caret stays put.
    pub fn delete_forward(&mut self) -> bool {
        if self.composition_active {
            return false;
        }
        if self.caret >= self.draft.chars().count() {
            return false;
        }
        let start = self.char_to_byte(self.caret);
        let end = self.char_to_byte(self.caret + 1);
        self.draft.drain(start..end);
        true
    }

    /// Opens an IME composition.
    pub fn composition_start(&mut self) {
        self.composition_active = true;
        self.composition_buffer.clear();
    }

    /// Replaces the intermediate buffer (never touches the draft —
    /// intermediate updates must not finalize text).
    pub fn composition_update(&mut self, buffer: String) {
        if self.composition_active {
            self.composition_buffer = buffer;
        }
    }

    /// Ends the composition, merging `final_text` into the draft at the
    /// caret (hosts pass the IME's committed string here).
    pub fn composition_end(&mut self, final_text: &str) {
        if !self.composition_active {
            return;
        }
        self.composition_active = false;
        self.composition_buffer.clear();
        let byte = self.char_to_byte(self.caret);
        self.draft.insert_str(byte, final_text);
        self.caret += final_text.chars().count();
    }

    /// Builds the commit action with TS `finishEditing` semantics:
    /// `trim()` the draft; empty commits delete (even for new elements —
    /// TS deletes rather than leaving a placeholder).
    ///
    /// Measurement comes from the host [`TextMeasurer`] (core never calls
    /// canvas APIs).
    pub fn commit_action<M: TextMeasurer>(
        &self,
        measurer: &M,
        element_width: f64,
        element_height: f64,
        font_size: f64,
        font_family: &str,
    ) -> TextCommitAction {
        let text = self.draft.trim().to_string();
        if text.is_empty() {
            return TextCommitAction::Delete {
                id: self.target.clone(),
            };
        }
        let (measured_width, measured_height) =
            crate::render_model::measure_text_element(measurer, &text, font_size, font_family);
        let (width, height) = commit_box(
            self.is_new,
            element_width,
            element_height,
            font_size,
            measured_width,
            measured_height,
        );
        TextCommitAction::Upsert {
            id: self.target.clone(),
            text,
            width,
            height,
        }
    }

    /// Cancels without touching the document (TS `cancelEditing` parity:
    /// the textarea is dropped and the scene keeps whatever it has —
    /// including a fresh empty placeholder, which a later commit deletes).
    /// The editor implements this by dropping the session.
    pub fn cancel_is_no_document_change(&self) -> bool {
        true
    }

    /// Base text at session start (for host diffing/debugging).
    pub fn base_text(&self) -> &str {
        &self.base_text
    }

    /// Maps a char index to its byte offset.
    fn char_to_byte(&self, caret: usize) -> usize {
        self.draft
            .char_indices()
            .nth(caret)
            .map(|(byte, _)| byte)
            .unwrap_or(self.draft.len())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    struct StubMeasurer;

    impl TextMeasurer for StubMeasurer {
        fn measure_line_width(&self, line: &str, font_size: f64, _family: &str) -> f64 {
            line.chars().count() as f64 * font_size * 0.6
        }
    }

    #[test]
    fn new_session_starts_empty_and_types() {
        let mut session = TextSession::begin_new(ElementId::of("t"));
        assert!(session.is_new());
        assert_eq!(session.caret(), 0);
        assert!(session.insert_text("hi"));
        assert_eq!(session.draft(), "hi");
        assert_eq!(session.caret(), 2);
        assert!(session.backspace());
        assert_eq!(session.draft(), "h");
    }

    #[test]
    fn delete_forward_removes_after_caret_and_clamps() {
        let mut session = TextSession::begin_new(ElementId::of("t"));
        session.insert_text("abc");
        session.set_caret(1);
        assert!(session.delete_forward());
        assert_eq!(session.draft(), "ac");
        assert_eq!(session.caret(), 1);
        session.set_caret(2);
        assert!(!session.delete_forward(), "at end deletes nothing");
        session.set_caret(99);
        assert_eq!(session.caret(), 2, "caret clamps to draft");
        session.composition_start();
        session.set_caret(0);
        assert!(!session.delete_forward(), "composing deletes nothing");
    }

    #[test]
    fn plain_input_is_ignored_while_composing() {
        let mut session = TextSession::begin_new(ElementId::of("t"));
        session.composition_start();
        assert!(session.composition_active());
        assert!(!session.insert_text("x"));
        assert_eq!(session.draft(), "");
        session.composition_update("nihon".to_string());
        assert_eq!(session.draft(), "", "intermediate never finalizes");
        assert_eq!(session.composition_buffer(), "nihon");
        session.composition_end("日本");
        assert!(!session.composition_active());
        assert_eq!(session.draft(), "日本");
        assert_eq!(session.caret(), 2);
    }

    #[test]
    fn commit_trims_and_deletes_when_empty() {
        let measurer = StubMeasurer;
        let mut session = TextSession::begin_new(ElementId::of("t"));
        session.insert_text("   ");
        assert_eq!(
            session.commit_action(&measurer, 100.0, 20.0, 16.0, "Virgil"),
            TextCommitAction::Delete {
                id: ElementId::of("t")
            }
        );
    }

    #[test]
    fn commit_preserves_inner_whitespace_and_autosizes_new() {
        let measurer = StubMeasurer;
        let mut session = TextSession::begin_new(ElementId::of("t"));
        session.insert_text("  a  b  ");
        match session.commit_action(&measurer, 100.0, 20.0, 16.0, "Virgil") {
            TextCommitAction::Upsert {
                text,
                width,
                height,
                ..
            } => {
                assert_eq!(text, "a  b", "ends trim, inner gaps stay");
                assert!(width >= 10.0);
                assert!(height >= 16.0 * TEXT_LINE_HEIGHT_MULTIPLIER);
            }
            TextCommitAction::Delete { .. } => panic!("non-empty must upsert"),
        }
    }

    #[test]
    fn commit_on_existing_box_never_shrinks() {
        let measurer = StubMeasurer;
        let session = TextSession::begin_edit(ElementId::of("t"), "hello".to_string(), 5);
        match session.commit_action(&measurer, 500.0, 200.0, 16.0, "Virgil") {
            TextCommitAction::Upsert { width, height, .. } => {
                assert_eq!(width, 500.0);
                assert_eq!(height, 200.0);
            }
            TextCommitAction::Delete { .. } => panic!("non-empty must upsert"),
        }
    }

    #[test]
    fn caret_estimate_maps_click_to_chars() {
        // 16px font: char 9.6 wide, lines 20 high; "hello" at (100, 50).
        let index = estimate_caret_index("hello", 16.0, 100.0 + 9.6 * 2.0, 50.0 + 5.0, 100.0, 50.0);
        assert_eq!(index, 2);
        assert_eq!(estimate_caret_index("", 16.0, 999.0, 999.0, 0.0, 0.0), 0);
        let multi = estimate_caret_index("ab\ncdef", 16.0, 5.0, 25.0, 0.0, 0.0);
        assert_eq!(multi, 3 + 1, "second line, one char in");
    }

    #[test]
    fn cancel_never_touches_the_document() {
        let session = TextSession::begin_new(ElementId::of("t"));
        assert!(session.cancel_is_no_document_change());
    }
}
