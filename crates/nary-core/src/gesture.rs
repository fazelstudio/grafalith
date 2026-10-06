//! Gesture lifecycle and cancellation primitives.
//!
//! TS sources: `packages/core/src/editor/editor.ts`
//! (`DRAG_THRESHOLD_PX = 4`, pointer-down/move/up disambiguation,
//! `pendingCollapseIds`, tool-switch/Escape/`pointercancel` cancel paths)
//! and `packages/core/src/interaction/transform.ts` (preview → single-commit).
//!
//! Two complementary patterns cover the cancellation contract (start state,
//! transient state, cancel trigger, rollback, cleanup, event emission,
//! history behavior): deferred commit ([`GestureSession`], the default),
//! where pointer moves only update transient state and the document is never
//! touched until `pointerup` commits one
//! [`MoveElements`](crate::command::MoveElements) command (one history
//! entry), so cancellation just discards transient state with nothing to
//! roll back and no history entry; and live transaction for multi-event
//! gestures that must paint intermediate states (`begin_transaction` at
//! gesture start, execute per pointer move, `commit_transaction` on
//! `pointerup`, `cancel_transaction` with rollback and no entry on
//! Escape/`pointercancel`/tool-switch).
//!
//! Cancel behavior is uniform across both: `pointerup` past the threshold
//! commits while below it is a click with no mutation; Escape,
//! `pointercancel`, and tool-switch cancel; undo/redo mid-gesture is refused
//! by the editor shell (undo auto-commits first inside a live transaction).

use crate::command::MoveElements;
use crate::element::ElementId;
use crate::EngineResult;

/// Click-vs-drag threshold in screen pixels (TS `DRAG_THRESHOLD_PX`
/// contract, `editor.ts:178`): a pointer-down becomes a drag mutation only
/// after moving at least this far. Below it, `pointerup` is a click and
/// records no history.
pub const DRAG_THRESHOLD_PX: f64 = 4.0;

/// Gesture lifecycle phase.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum GesturePhase {
    /// No active gesture.
    #[default]
    Idle,
    /// Pointer down, threshold not yet exceeded (may still become a click).
    Pressed,
    /// Threshold exceeded: transient drag delta is tracked.
    Dragging,
}

/// Deferred-commit drag session over scene-space coordinates.
///
/// The session captures its start state (affected ids + pointer origin) and
/// tracks transient state (current pointer, threshold flag) without touching
/// the document. [`GestureSession::commit_move`] converts a past-threshold
/// drag into a single [`MoveElements`](crate::command::MoveElements)
/// command; [`GestureSession::cancel`] drops a below-threshold or aborted
/// gesture with zero document or history effects.
#[derive(Debug, Clone)]
pub struct GestureSession {
    phase: GesturePhase,
    affected: Vec<ElementId>,
    origin_x: f64,
    origin_y: f64,
    current_x: f64,
    current_y: f64,
    threshold_exceeded: bool,
}

impl GestureSession {
    /// Starts a gesture: records the affected ids and the pointer origin.
    /// Non-finite origins are rejected before any state is created.
    pub fn begin(affected: Vec<ElementId>, x: f64, y: f64) -> EngineResult<Self> {
        if !x.is_finite() || !y.is_finite() {
            return Err(crate::EngineError::InvalidInput(format!(
                "gesture origin must be finite, got ({x}, {y})"
            )));
        }
        Ok(Self {
            phase: GesturePhase::Pressed,
            affected,
            origin_x: x,
            origin_y: y,
            current_x: x,
            current_y: y,
            threshold_exceeded: false,
        })
    }

    /// Current lifecycle phase.
    pub fn phase(&self) -> GesturePhase {
        self.phase
    }

    /// Affected element ids captured at gesture start.
    pub fn affected(&self) -> &[ElementId] {
        &self.affected
    }

    /// Advances the transient pointer position.
    ///
    /// Returns `true` once the drag threshold is exceeded (screen-space
    /// Euclidean distance `>= DRAG_THRESHOLD_PX`), flipping the phase from
    /// `Pressed` to `Dragging`. Non-finite positions are rejected and leave
    /// the transient state untouched.
    pub fn update(&mut self, x: f64, y: f64) -> EngineResult<bool> {
        if !x.is_finite() || !y.is_finite() {
            return Err(crate::EngineError::InvalidInput(format!(
                "gesture position must be finite, got ({x}, {y})"
            )));
        }
        self.current_x = x;
        self.current_y = y;
        if !self.threshold_exceeded {
            let dx = x - self.origin_x;
            let dy = y - self.origin_y;
            if dx.hypot(dy) >= DRAG_THRESHOLD_PX {
                self.threshold_exceeded = true;
                self.phase = GesturePhase::Dragging;
            }
        }
        Ok(self.threshold_exceeded)
    }

    /// Transient drag delta, or `None` while below the threshold (a click in
    /// progress — committing it must be a no-op).
    pub fn transient_delta(&self) -> Option<(f64, f64)> {
        if self.threshold_exceeded {
            Some((
                self.current_x - self.origin_x,
                self.current_y - self.origin_y,
            ))
        } else {
            None
        }
    }

    /// Converts a past-threshold drag into its commit command, or `None`
    /// for a click (no mutation, no history entry — TS "click never becomes
    /// drag" parity).
    pub fn commit_move(&self) -> Option<MoveElements> {
        let (dx, dy) = self.transient_delta()?;
        Some(MoveElements::new(self.affected.clone(), dx, dy))
    }

    /// Cancels the gesture: transient state is dropped unread. The document
    /// was never touched by the deferred pattern, so cancellation needs no
    /// rollback and emits no history entry by construction.
    pub fn cancel(self) {}
}

#[cfg(test)]
mod tests {
    use super::*;

    fn session() -> GestureSession {
        GestureSession::begin(vec![ElementId::of("a")], 0.0, 0.0).unwrap()
    }

    #[test]
    fn drag_threshold_matches_ts_contract() {
        assert_eq!(DRAG_THRESHOLD_PX, 4.0);
    }

    #[test]
    fn below_threshold_is_a_click_with_no_commit() {
        let mut gesture = session();
        assert_eq!(gesture.phase(), GesturePhase::Pressed);
        assert!(!gesture.update(2.0, 2.0).unwrap());
        assert_eq!(gesture.phase(), GesturePhase::Pressed);
        assert_eq!(gesture.transient_delta(), None);
        assert!(gesture.commit_move().is_none());
        gesture.cancel();
    }

    #[test]
    fn past_threshold_tracks_transient_and_commits_one_command() {
        let mut gesture = session();
        assert!(gesture.update(3.0, 4.0).unwrap(), "5px >= 4px threshold");
        assert_eq!(gesture.phase(), GesturePhase::Dragging);
        assert_eq!(gesture.transient_delta(), Some((3.0, 4.0)));
        let cmd = gesture.commit_move().expect("drag commits");
        assert_eq!(cmd.dx, 3.0);
        assert_eq!(cmd.dy, 4.0);
        assert_eq!(cmd.ids, vec![ElementId::of("a")]);
    }

    #[test]
    fn non_finite_input_is_rejected_without_state_change() {
        assert!(GestureSession::begin(vec![], f64::NAN, 0.0).is_err());
        let mut gesture = session();
        assert!(gesture.update(f64::INFINITY, 0.0).is_err());
        assert_eq!(gesture.transient_delta(), None);
        assert_eq!(gesture.phase(), GesturePhase::Pressed);
    }
}
