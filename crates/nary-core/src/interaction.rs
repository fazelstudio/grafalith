//! Host-neutral editor interaction: normalized input, tools, keyboard,
//! context-menu intents, and the pointer-phase state machine.
//!
//! TS sources: `packages/core/src/editor/editor.ts` (pointer state machine,
//! `DRAG_THRESHOLD_PX = 4`, double-click 400 ms / 5 px contract, selection
//! click ordering, `pendingCollapseIds`, group drill-in, Escape /
//! `pointercancel` / tool-switch cancel paths, `enabledTools` gate),
//! `packages/core/src/interaction/selection.ts` (click, Shift+click,
//! rubber-band, `boundsOverlap` inclusive-touch, top-wins, group expansion,
//! locked/hidden skips, `deleteSelected`, `nudgeSelected`),
//! `packages/core/src/interaction/transform.ts` (move axis-lock, snap hook),
//! `packages/core/src/interaction/keyboard-history.ts` /
//! `keyboard-clipboard.ts` (modifier handling, field/busy guards live
//! host-side), `packages/core/src/interaction/draw-tool.ts` (drag-create,
//! minimum size), `pen-tool.ts` (close 12, drag-detect 3 px),
//! `crop-handler.ts` (natural-px crop, 10 px minimum),
//! `pan-zoom.ts` (space/middle pan, ctrl-wheel anchored zoom), and
//! `render/render-selection.ts` (handle geometry).
//!
//! Module 07 contract: core consumes normalized events — hosts translate
//! DOM/Tauri/native events into [`InputEvent`] (including double-click
//! detection and focused-field guards, which need host APIs core must never
//! touch). All coordinates in events are **screen pixels**; conversion to
//! scene units happens here through the viewport, so thresholds keep their
//! TS screen-space meaning.

use std::collections::HashSet;

use crate::document::Document;
use crate::element::{Element, ElementId};
use crate::geometry::point::Point;
use crate::geometry::rect::Bounds;
use crate::geometry::snap::apply_snap;
/// Snap configuration, re-exported for editor consumers.
pub use crate::geometry::snap::SnapConfig;
/// Snap guide, re-exported for editor consumers.
pub use crate::geometry::snap::SnapGuide;
use crate::geometry::transform::HandleType;
use crate::geometry::viewport::{screen_to_scene, Viewport};
use crate::theme::NaryTheme;
use crate::{EngineError, EngineResult};

// ---------------------------------------------------------------------------
// Modifiers + pointer buttons (platform-aware)
// ---------------------------------------------------------------------------

/// Modifier keys for an input event.
///
/// A single `ctrl_or_cmd` flag covers both Windows/Linux `Ctrl` and macOS
/// `Cmd` (TS `metaKey || ctrlKey` parity) — core never hard-codes an OS
/// modifier name; the host sets the flag from whatever the platform reports.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct Modifiers {
    /// Shift key held.
    pub shift: bool,
    /// Alt/Option key held.
    pub alt: bool,
    /// Ctrl (Win/Linux) or Cmd (macOS) held.
    pub ctrl_or_cmd: bool,
}

impl Modifiers {
    /// No modifiers held.
    pub fn none() -> Self {
        Self::default()
    }

    /// Shift-only modifiers (aspect lock / axis lock / 10 px nudge).
    pub fn shift() -> Self {
        Self {
            shift: true,
            ..Self::default()
        }
    }

    /// Additive-selection modifiers: Shift-click or Ctrl/Cmd-click (TS
    /// `shiftKey || ctrlKey || metaKey` parity in the click path).
    pub fn is_additive(&self) -> bool {
        self.shift || self.ctrl_or_cmd
    }
}

/// Which pointer button an event came from.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub enum PointerButton {
    /// Primary button (touch counts as left).
    #[default]
    Left,
    /// Middle button (pan).
    Middle,
    /// Right button (context click).
    Right,
}

// ---------------------------------------------------------------------------
// Normalized input events
// ---------------------------------------------------------------------------

/// A keyboard key in host-neutral form (hosts map `KeyboardEvent.key` here).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Key {
    /// Forward delete.
    Delete,
    /// Backspace.
    Backspace,
    /// Escape.
    Escape,
    /// Enter / return.
    Enter,
    /// Left arrow.
    ArrowLeft,
    /// Right arrow.
    ArrowRight,
    /// Up arrow.
    ArrowUp,
    /// Down arrow.
    ArrowDown,
    /// A printable character (already modifier-resolved by the host).
    Char(char),
    /// Any other key, by name (host passes `key` through for logging).
    Other(String),
}

/// Normalized input event: the only input core understands.
///
/// Screen coordinates are pixels; scene conversion happens inside the
/// handlers via the viewport. `click_count` carries the host's
/// double-click detection (TS: within 400 ms and 5 px) — core never runs
/// timers. Text-field focus guards (`TEXTAREA`/`INPUT`/`isContentEditable`,
/// `isBusy`) stay host-side: the host simply does not forward editing keys
/// as [`InputEvent::KeyDown`] while a field owns them.
#[derive(Debug, Clone, PartialEq)]
pub enum InputEvent {
    /// Pointer pressed: screen position, button, modifiers, host click count.
    PointerDown {
        /// Screen x in pixels.
        x: f64,
        /// Screen y in pixels.
        y: f64,
        /// Button pressed.
        button: PointerButton,
        /// Modifiers held.
        modifiers: Modifiers,
        /// 1 for single, 2 for double-click (host-detected).
        click_count: u32,
    },
    /// Pointer moved: screen position plus current modifiers.
    PointerMove {
        /// Screen x in pixels.
        x: f64,
        /// Screen y in pixels.
        y: f64,
        /// Modifiers held.
        modifiers: Modifiers,
    },
    /// Pointer released.
    PointerUp {
        /// Screen x in pixels.
        x: f64,
        /// Screen y in pixels.
        y: f64,
        /// Button released.
        button: PointerButton,
        /// Modifiers held.
        modifiers: Modifiers,
    },
    /// Pointer stream aborted (touch interruption, browser gesture).
    PointerCancel,
    /// Key pressed (never forwarded for IME-composing or field-owned keys).
    KeyDown {
        /// Key pressed.
        key: Key,
        /// Modifiers held.
        modifiers: Modifiers,
    },
    /// Key released (tracked for completeness; currently no behavior).
    KeyUp {
        /// Key released.
        key: Key,
        /// Modifiers held.
        modifiers: Modifiers,
    },
    /// Committed plain-text input for the active text session.
    TextInput {
        /// Text to insert at the caret (never forwarded mid-composition).
        text: String,
    },
    /// IME composition started.
    CompositionStart,
    /// IME composition updated (intermediate, never finalized).
    CompositionUpdate {
        /// Current composition buffer.
        buffer: String,
    },
    /// IME composition ended (the final string merges at the caret).
    CompositionEnd {
        /// Final composed string.
        final_text: String,
    },
    /// Mouse-wheel event (deltas in screen pixels).
    Wheel {
        /// Horizontal scroll delta in pixels.
        delta_x: f64,
        /// Vertical scroll delta in pixels.
        delta_y: f64,
        /// True when Ctrl/Cmd is held (zoom gesture, not scroll).
        zoom_gesture: bool,
        /// Screen x of the cursor (zoom anchor).
        x: f64,
        /// Screen y of the cursor (zoom anchor).
        y: f64,
    },
}

// ---------------------------------------------------------------------------
// Tools (registry-driven, instance-scoped)
// ---------------------------------------------------------------------------

/// A tool identifier. Well-known tools are constructors; host-registered
/// custom tools ride as [`ToolId::Custom`].
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub enum ToolId {
    /// Selection / move / resize / rotate tool (TS default `'select'`).
    Select,
    /// Text tool (click creates or edits text).
    Text,
    /// Shape-draw tool for a registry shape type (TS `DrawToolType`).
    Draw(String),
    /// Host-registered custom tool.
    Custom(String),
}

impl ToolId {
    /// The `select` tool id.
    pub fn select() -> Self {
        Self::Select
    }

    /// Parses the TS string tool ids (`"select"`, `"text"`, shape types as
    /// [`ToolId::Draw`], anything else as [`ToolId::Custom`]).
    pub fn parse(id: &str) -> Self {
        match id {
            "select" => Self::Select,
            "text" => Self::Text,
            "rectangle" | "ellipse" | "line" | "arrow" | "freedraw" | "frame" | "image"
            | "path" => Self::Draw(id.to_string()),
            _ => Self::Custom(id.to_string()),
        }
    }

    /// Serializes back to the TS string id (`select`/`text`/shape/custom).
    pub fn as_str(&self) -> &str {
        match self {
            Self::Select => "select",
            Self::Text => "text",
            Self::Draw(shape) | Self::Custom(shape) => shape,
        }
    }

    /// Returns `true` for the select tool.
    pub fn is_select(&self) -> bool {
        matches!(self, Self::Select)
    }

    /// Returns `true` for the text tool.
    pub fn is_text(&self) -> bool {
        matches!(self, Self::Text)
    }

    /// Returns `true` for shape-draw tools.
    pub fn is_draw(&self) -> bool {
        matches!(self, Self::Draw(_))
    }
}

impl std::str::FromStr for ToolId {
    /// Never fails: delegates to [`ToolId::parse`].
    type Err = std::convert::Infallible;

    fn from_str(id: &str) -> Result<Self, Self::Err> {
        Ok(Self::parse(id))
    }
}

impl std::fmt::Display for ToolId {
    /// Displays the TS string id.
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.as_str())
    }
}

/// Instance-scoped tool registry (no globals).
///
/// Built-ins mirror the TS shape surface (`rectangle`, `ellipse`, `line`,
/// `arrow`, `text`, `freedraw`, `frame`, `image`, `path`); custom tools
/// register explicitly instead of arriving via import side-effects.
#[derive(Debug, Clone)]
pub struct ToolRegistry {
    /// Known tool ids.
    known: HashSet<ToolId>,
}

impl ToolRegistry {
    /// Registry with the built-in tools registered.
    pub fn with_builtins() -> Self {
        let mut registry = Self {
            known: HashSet::new(),
        };
        registry.register_builtin_tools();
        registry
    }

    /// Registers the built-in tools (idempotent).
    pub fn register_builtin_tools(&mut self) {
        for id in [
            ToolId::Select,
            ToolId::Text,
            ToolId::Draw("rectangle".to_string()),
            ToolId::Draw("ellipse".to_string()),
            ToolId::Draw("line".to_string()),
            ToolId::Draw("arrow".to_string()),
            ToolId::Draw("freedraw".to_string()),
            ToolId::Draw("frame".to_string()),
            ToolId::Draw("image".to_string()),
            ToolId::Draw("path".to_string()),
        ] {
            self.known.insert(id);
        }
    }

    /// Registers a host custom tool.
    pub fn register_custom(&mut self, id: &str) {
        self.known.insert(ToolId::Custom(id.to_string()));
    }

    /// Returns `true` when the tool is known to this registry.
    pub fn contains(&self, tool: &ToolId) -> bool {
        self.known.contains(tool)
    }
}

impl Default for ToolRegistry {
    fn default() -> Self {
        Self::with_builtins()
    }
}

// ---------------------------------------------------------------------------
// Keyboard intents (platform-aware)
// ---------------------------------------------------------------------------

/// What a key press means. Clipboard/history intents are decisions, not
/// executions: copy/paste/cut/duplicate payloads are host-routed, so the
/// editor reports them as [`KeyAction::UnhandledIntent`].
#[derive(Debug, Clone, PartialEq)]
pub enum KeyIntent {
    /// Delete the current selection (Delete / Backspace).
    DeleteSelected,
    /// Nudge the selection by a scene-space delta (arrows; Shift × 10).
    Nudge {
        /// Scene-space delta x.
        dx: f64,
        /// Scene-space delta y.
        dy: f64,
    },
    /// Undo (Ctrl/Cmd+Z).
    Undo,
    /// Redo (Ctrl/Cmd+Shift+Z or Ctrl/Cmd+Y).
    Redo,
    /// Copy selection (Ctrl/Cmd+C).
    Copy,
    /// Paste (Ctrl/Cmd+V).
    Paste,
    /// Cut selection (Ctrl/Cmd+X).
    Cut,
    /// Duplicate selection (Ctrl/Cmd+D, no Shift — TS parity).
    Duplicate,
    /// Escape: the editor runs its cancel chain (gesture → text commit →
    /// group exit → clear selection).
    Escape,
}

/// Maps a key + modifiers to an intent, or `None` when the host should
/// route the key elsewhere (text fields, IME, unbound keys).
///
/// `text_editing` mirrors the TS field guards: while a text session owns
/// the caret, only Escape reaches core (as commit); everything else belongs
/// to the textarea, including Enter (newline) and arrows (caret motion).
pub fn key_to_intent(key: &Key, modifiers: &Modifiers, text_editing: bool) -> Option<KeyIntent> {
    if text_editing {
        return match key {
            Key::Escape => Some(KeyIntent::Escape),
            _ => None,
        };
    }
    match key {
        Key::Escape => Some(KeyIntent::Escape),
        Key::Delete | Key::Backspace => Some(KeyIntent::DeleteSelected),
        Key::ArrowLeft => Some(KeyIntent::Nudge {
            dx: if modifiers.shift { -10.0 } else { -1.0 },
            dy: 0.0,
        }),
        Key::ArrowRight => Some(KeyIntent::Nudge {
            dx: if modifiers.shift { 10.0 } else { 1.0 },
            dy: 0.0,
        }),
        Key::ArrowUp => Some(KeyIntent::Nudge {
            dx: 0.0,
            dy: if modifiers.shift { -10.0 } else { -1.0 },
        }),
        Key::ArrowDown => Some(KeyIntent::Nudge {
            dx: 0.0,
            dy: if modifiers.shift { 10.0 } else { 1.0 },
        }),
        Key::Char('z') | Key::Char('Z') if modifiers.ctrl_or_cmd => {
            if modifiers.shift {
                Some(KeyIntent::Redo)
            } else {
                Some(KeyIntent::Undo)
            }
        }
        Key::Char('y') | Key::Char('Y') if modifiers.ctrl_or_cmd => Some(KeyIntent::Redo),
        Key::Char('c') | Key::Char('C') if modifiers.ctrl_or_cmd => Some(KeyIntent::Copy),
        Key::Char('v') | Key::Char('V') if modifiers.ctrl_or_cmd => Some(KeyIntent::Paste),
        Key::Char('x') | Key::Char('X') if modifiers.ctrl_or_cmd => Some(KeyIntent::Cut),
        Key::Char('d') | Key::Char('D') if modifiers.ctrl_or_cmd && !modifiers.shift => {
            Some(KeyIntent::Duplicate)
        }
        _ => None,
    }
}

// ---------------------------------------------------------------------------
// Context-menu intents (core decides, host renders)
// ---------------------------------------------------------------------------

/// A context-menu action core offers for the current selection. There is no
/// context-menu widget in core (verified absence in TS: no
/// `context-menu*.ts`); the host renders these intents however it draws
/// menus.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ContextMenuIntent {
    /// Soft-delete the selection.
    Delete,
    /// Duplicate the selection (listed when non-empty).
    Duplicate,
    /// Bring selection to front.
    BringToFront,
    /// Send selection to back.
    SendToBack,
    /// Bring selection one step forward.
    BringForward,
    /// Send selection one step backward.
    SendBackward,
    /// Group the selection (2+ elements).
    Group,
    /// Remove group membership from grouped members.
    Ungroup,
    /// Lock the selection.
    Lock,
    /// Unlock locked members of the selection.
    Unlock,
}

/// Context-menu intents for `selection` (empty selection → no menu).
pub fn context_menu_intents(doc: &Document, selection: &[ElementId]) -> Vec<ContextMenuIntent> {
    if selection.is_empty() {
        return Vec::new();
    }
    let mut intents = vec![
        ContextMenuIntent::Delete,
        ContextMenuIntent::Duplicate,
        ContextMenuIntent::BringToFront,
        ContextMenuIntent::SendToBack,
        ContextMenuIntent::BringForward,
        ContextMenuIntent::SendBackward,
    ];
    if selection.len() >= 2 {
        intents.push(ContextMenuIntent::Group);
    }
    let mut has_grouped = false;
    let mut has_unlocked = false;
    let mut has_locked = false;
    for id in selection {
        let Some(element) = doc.get(id.as_str()) else {
            continue;
        };
        if !element.base().group_ids.is_empty() {
            has_grouped = true;
        }
        if element.base().locked {
            has_locked = true;
        } else {
            has_unlocked = true;
        }
    }
    if has_grouped {
        intents.push(ContextMenuIntent::Ungroup);
    }
    if has_unlocked {
        intents.push(ContextMenuIntent::Lock);
    }
    if has_locked {
        intents.push(ContextMenuIntent::Unlock);
    }
    intents
}

// ---------------------------------------------------------------------------
// Selection helpers (pure parts of the click path)
// ---------------------------------------------------------------------------

/// Resolves a hit id to the ids selected in normal mode: all members of
/// the outermost group, or the single id (TS `resolveGroupSelection`
/// parity; group drill-in bypasses this via `editing_group_id`).
pub fn resolve_group_selection(doc: &Document, hit: &ElementId) -> Vec<ElementId> {
    let members = crate::group::group_members(doc, hit.as_str());
    if members.len() > 1 {
        members
    } else {
        vec![hit.clone()]
    }
}

/// Normalizes two scene-space rubber-band corners to an inclusive bounds
/// (TS `finishRubberBand` min/max parity; touching counts via
/// [`Bounds::intersects`]).
pub fn rubber_band_bounds(start: &Point, end: &Point) -> Bounds {
    Bounds {
        min_x: start[0].min(end[0]),
        min_y: start[1].min(end[1]),
        max_x: start[0].max(end[0]),
        max_y: start[1].max(end[1]),
    }
}

/// Hit-tests a scene point against the single-selection resize handles.
///
/// Returns `None` unless exactly one element is selected (TS checks handles
/// only for single selection) and the point lands in a handle box
/// (`handle_size / zoom + 2`, rotation-aware — [`crate::geometry`]).
pub fn resize_handle_at(
    doc: &Document,
    selection: &[ElementId],
    scene: &Point,
    theme: &NaryTheme,
    zoom: f64,
) -> Option<(ElementId, HandleType)> {
    if selection.len() != 1 {
        return None;
    }
    let id = &selection[0];
    let element = doc.get(id.as_str())?;
    if element.base().is_deleted || element.base().locked {
        return None;
    }
    let bounds = element.bounds();
    let hit = crate::geometry::transform::hit_test_resize_handle(
        scene[0],
        scene[1],
        &bounds,
        zoom,
        theme.sizes.handle_size,
        element.base().rotation,
    )?;
    Some((id.clone(), hit))
}

/// Hit-tests a scene point against the single-selection rotate handle.
pub fn rotate_handle_at(
    doc: &Document,
    selection: &[ElementId],
    scene: &Point,
    theme: &NaryTheme,
    zoom: f64,
) -> Option<ElementId> {
    if selection.len() != 1 {
        return None;
    }
    let id = &selection[0];
    let element = doc.get(id.as_str())?;
    if element.base().is_deleted || element.base().locked {
        return None;
    }
    let bounds = element.bounds();
    if crate::geometry::transform::hit_test_rotate_handle(
        scene[0],
        scene[1],
        &bounds,
        zoom,
        theme.sizes.rotate_handle_radius,
        theme.sizes.rotate_handle_offset,
        element.base().rotation,
    ) {
        Some(id.clone())
    } else {
        None
    }
}

/// Snaps a desired multi-drag delta through the object/grid snap math.
///
/// The desired combined bounds (affected elements shifted by the raw delta)
/// snap by center alignment; the returned delta keeps every element's
/// relative offset while landing the whole block on the guide/grid (TS
/// `updateMove` snap-hook parity — TS snaps only moves, never resizes).
/// Guides are for the host overlay; the delta already includes the snap.
pub fn snap_move_delta(
    doc: &Document,
    affected: &[ElementId],
    raw_dx: f64,
    raw_dy: f64,
    config: &SnapConfig,
    zoom: f64,
) -> (f64, f64, Vec<SnapGuide>) {
    let mut boxes: Vec<Bounds> = Vec::new();
    for id in affected {
        if let Some(element) = doc.get(id.as_str()) {
            if element.base().is_deleted || element.base().locked {
                continue;
            }
            let mut bounds = element.bounds();
            bounds.min_x += raw_dx;
            bounds.max_x += raw_dx;
            bounds.min_y += raw_dy;
            bounds.max_y += raw_dy;
            boxes.push(bounds);
        }
    }
    if boxes.is_empty() {
        return (raw_dx, raw_dy, Vec::new());
    }
    let mut combined = boxes[0];
    for bounds in &boxes[1..] {
        combined = combined.union(bounds);
    }
    let center = combined.center();
    let mut candidates: Vec<Bounds> = Vec::new();
    let excluded: HashSet<&str> = affected.iter().map(|id| id.as_str()).collect();
    for element in doc.get_all() {
        if element.base().is_deleted || element.base().hidden {
            continue;
        }
        if excluded.contains(element.id().as_str()) {
            continue;
        }
        candidates.push(element.bounds());
    }
    let empty_excludes: HashSet<usize> = HashSet::new();
    let result = apply_snap(
        center[0],
        center[1],
        &combined,
        config,
        &candidates,
        &empty_excludes,
        zoom,
    );
    let snapped_dx = raw_dx + (result.x - center[0]);
    let snapped_dy = raw_dy + (result.y - center[1]);
    (snapped_dx, snapped_dy, result.guides)
}

// ---------------------------------------------------------------------------
// Pointer phase (deterministic state machine)
// ---------------------------------------------------------------------------

/// Pressed-but-undecided pointer capture (may still become a click).
#[derive(Debug, Clone, PartialEq)]
pub struct PressedCapture {
    /// Screen-space origin (threshold measured here, in screen px).
    pub origin_screen: Point,
    /// Scene-space origin.
    pub origin_scene: Point,
    /// Hit element at press time, if any.
    pub hit: Option<ElementId>,
    /// Button pressed.
    pub button: PointerButton,
    /// Additive flag at press time.
    pub additive: bool,
    /// Resize target when pressed on a handle.
    pub resize_target: Option<(ElementId, HandleType)>,
    /// Rotate target when pressed on the rotate handle.
    pub rotate_target: Option<ElementId>,
    /// Active tool at press time.
    pub tool: ToolId,
}

/// Deterministic pointer phase for the select/move/resize/rotate/rubber/
/// draw flows. Text sessions live beside this in the editor (a press while
/// editing commits first — outside-click parity).
#[derive(Debug, Clone, Default, PartialEq)]
pub enum EditorPointerPhase {
    /// No pointer capture.
    #[default]
    Idle,
    /// Pointer down, threshold not yet exceeded (may become a click).
    Pressed(PressedCapture),
    /// Past-threshold move drag over the captured ids.
    DraggingMove {
        /// Elements the drag moves (resolved at press time).
        affected: Vec<ElementId>,
        /// Scene-space press origin.
        origin_scene: Point,
        /// Shift held at the latest move (dominant-axis lock).
        axis_lock: bool,
    },
    /// Past-threshold resize drag of one element.
    DraggingResize {
        /// Element being resized.
        id: ElementId,
        /// Dragged handle.
        handle: HandleType,
        /// Scene-space press position (rotate anchor math uses the live
        /// pointer, so only the start point is stored).
        anchor_scene: Point,
        /// Aspect-lock flag at the latest move.
        lock_aspect: bool,
    },
    /// Past-threshold rotate drag of one element.
    DraggingRotate {
        /// Element being rotated.
        id: ElementId,
        /// Scene-space press position (angle anchor).
        anchor_scene: Point,
        /// Snap flag at the latest move.
        snap: bool,
    },
    /// Past-threshold rubber-band drag from the scene-space origin.
    RubberBand {
        /// Scene-space press origin.
        origin_scene: Point,
        /// Additive flag at press time.
        additive: bool,
    },
    /// Past-threshold shape-draw drag from the scene-space origin.
    /// For `freedraw` the stroke trail accumulates here (scene-space points,
    /// origin first); all other shapes derive their box from the origin and
    /// the live cursor host-side, committing via [`draw_box_element`].
    Drawing {
        /// Shape type being drawn.
        shape: String,
        /// Scene-space press origin.
        origin_scene: Point,
        /// Scene-space stroke trail for `freedraw` (empty otherwise).
        stroke: Vec<Point>,
    },
    /// Middle-drag pan from the screen-space origin (TS `pan-zoom.ts`
    /// middle-button parity; space-drag pans stay host-side through
    /// [`crate::editor::Editor::pan_by_screen`]).
    Panning {
        /// Screen-space press origin.
        origin_screen: Point,
        /// Scroll offsets at press time.
        origin_scroll: Point,
    },
}

impl EditorPointerPhase {
    /// Returns `true` while a gesture is captured (anything but idle).
    pub fn is_captured(&self) -> bool {
        !matches!(self, Self::Idle)
    }

    /// Returns `true` while past the click/drag threshold.
    pub fn is_dragging(&self) -> bool {
        matches!(
            self,
            Self::DraggingMove { .. }
                | Self::DraggingResize { .. }
                | Self::DraggingRotate { .. }
                | Self::RubberBand { .. }
                | Self::Drawing { .. }
                | Self::Panning { .. }
        )
    }
}

/// Screen-space Euclidean distance between two screen points.
pub fn screen_distance(a: &Point, b: &Point) -> f64 {
    (a[0] - b[0]).hypot(a[1] - b[1])
}

/// Converts a screen event point to scene coordinates, rejecting
/// non-finite input before any state changes.
pub fn event_to_scene(x: f64, y: f64, viewport: &Viewport) -> EngineResult<Point> {
    if !x.is_finite() || !y.is_finite() {
        return Err(EngineError::InvalidInput(format!(
            "pointer position must be finite, got ({x}, {y})"
        )));
    }
    Ok(screen_to_scene(&[x, y], viewport))
}

// ---------------------------------------------------------------------------
// Draw-create + pen + crop sessions
// ---------------------------------------------------------------------------

/// Minimum drag size that commits a shape (TS `DrawTool` fallback
/// `width > 2 && height > 2` parity; lines/arrows use endpoint distance).
pub const DRAW_MIN_SIZE: f64 = 2.0;

/// Minimum crop edge in natural pixels (TS `crop-handler.ts` clamp).
pub const CROP_MIN_PX: f64 = 10.0;

/// Builds a drag-created element for `shape` over the scene-space box, or
/// `None` when the drag is below the minimum size (a click on a shape tool
/// creates nothing — TS parity).
///
/// `next_id` is minted by the caller (the document stays the identity
/// authority). Text delegates to the text flow (`None` here); freedraw accumulates its trail in the pointer `Drawing` phase
/// instead (see `Editor::commit_freedraw_stroke`); path needs a multi-click
/// pen session (see [`PenSession`]).
pub fn draw_box_element(
    shape: &str,
    next_id: ElementId,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> Option<Element> {
    // Factories mint through a throwaway counter; the caller-supplied id
    // (from the document authority) overwrites it before return.
    let mut counter = crate::element::CounterIdGenerator::new();
    match shape {
        "rectangle" => {
            if width <= DRAW_MIN_SIZE || height <= DRAW_MIN_SIZE {
                return None;
            }
            let mut el = crate::element::create_rectangle(&mut counter);
            el.base.id = next_id;
            el.base.x = x;
            el.base.y = y;
            el.base.width = width;
            el.base.height = height;
            Some(Element::Rectangle(el))
        }
        "ellipse" => {
            if width <= DRAW_MIN_SIZE || height <= DRAW_MIN_SIZE {
                return None;
            }
            let mut el = crate::element::create_ellipse(&mut counter);
            el.base.id = next_id;
            el.base.x = x;
            el.base.y = y;
            el.base.width = width;
            el.base.height = height;
            Some(Element::Ellipse(el))
        }
        "frame" => {
            if width <= DRAW_MIN_SIZE || height <= DRAW_MIN_SIZE {
                return None;
            }
            let mut el = crate::element::create_frame(&mut counter);
            el.base.id = next_id;
            el.base.x = x;
            el.base.y = y;
            el.base.width = width;
            el.base.height = height;
            Some(Element::Frame(el))
        }
        "line" => {
            if width.hypot(height) <= DRAW_MIN_SIZE {
                return None;
            }
            let mut el = crate::element::create_line(&mut counter);
            el.base.id = next_id;
            el.base.x = x;
            el.base.y = y;
            el.base.width = width;
            el.base.height = height;
            el.points = vec![[0.0, 0.0], [width, height]];
            Some(Element::Line(el))
        }
        "arrow" => {
            if width.hypot(height) <= DRAW_MIN_SIZE {
                return None;
            }
            let mut el = crate::element::create_arrow(&mut counter);
            el.base.id = next_id;
            el.base.x = x;
            el.base.y = y;
            el.base.width = width;
            el.base.height = height;
            el.points = vec![[0.0, 0.0], [width, height]];
            Some(Element::Arrow(el))
        }
        "image" => {
            if width <= DRAW_MIN_SIZE || height <= DRAW_MIN_SIZE {
                return None;
            }
            let mut el = crate::element::create_image(&mut counter);
            el.base.id = next_id;
            el.base.x = x;
            el.base.y = y;
            el.base.width = width;
            el.base.height = height;
            Some(Element::Image(el))
        }
        _ => None,
    }
}

/// Builds a drag-created element consulting the instance-scoped
/// [`crate::shape_registry::ShapeRegistry`] first (TS `DrawTool`
/// registry-dispatch parity: custom `onCreateDrag` wins, built-ins fall
/// back to [`draw_box_element`]).
///
/// `path` and `text`/`freedraw` still return `None` here by design: paths
/// need the multi-click [`PenSession`], text goes through the text flow,
/// and freedraw accumulates its trail in the pointer `Drawing` phase.
pub fn draw_box_element_via_registry(
    registry: &crate::shape_registry::ShapeRegistry,
    shape: &str,
    next_id: ElementId,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> Option<Element> {
    if let Some(extension) = registry.extension(shape) {
        let minimum = extension.minimum_size().unwrap_or(DRAW_MIN_SIZE);
        if width.hypot(height) <= minimum {
            return None;
        }
        if let Some(custom) = extension.create_drag(&next_id, x, y, width, height) {
            return Some(custom);
        }
        // Extension registered but declines drag-create: fall through to
        // the built-in box so reserved names keep working.
    }
    draw_box_element(shape, next_id, x, y, width, height)
}

/// Minimal pen session: multi-click path builder state.
///
/// Ports the TS `PenTool` thresholds (`CLOSE_THRESHOLD = 12` scene units,
/// close only with 3+ points; drag-detect 3 px is host-measured and arrives
/// as separate points) plus the click-drag symmetric Bezier handles: a
/// click adds a sharp corner anchor; a click-drag grows symmetric
/// `handle_in`/`handle_out` (relative offsets, Alt breaks symmetry).
/// The session owns points, handles, close detection, and finish/cancel
/// lifecycle deterministically; committing builds a `PathElement` with
/// recalculated bounds (host mints the id via the document authority).
#[derive(Debug, Clone, Default, PartialEq)]
pub struct PenSession {
    /// Committed path points in scene coordinates.
    pub points: Vec<Point>,
    /// Per-anchor incoming handle (relative offset), if any.
    pub handles_in: Vec<Option<Point>>,
    /// Per-anchor outgoing handle (relative offset), if any.
    pub handles_out: Vec<Option<Point>>,
    /// Whether the path closed (first/last merged).
    pub closed: bool,
}

impl PenSession {
    /// Starts an empty pen session.
    pub fn new() -> Self {
        Self::default()
    }

    /// Adds a click point (sharp corner, no handles yet). Returns `true`
    /// when the click closes the path (3+ points and within
    /// [`crate::geometry::transform::PEN_CLOSE_THRESHOLD`] of the first
    /// point — TS `finishPath(true)` parity).
    pub fn add_point(&mut self, point: Point) -> bool {
        if self.points.len() >= 3 {
            let first = self.points[0];
            if (point[0] - first[0]).hypot(point[1] - first[1])
                < crate::geometry::transform::PEN_CLOSE_THRESHOLD
            {
                self.closed = true;
                return true;
            }
        }
        self.points.push(point);
        self.handles_in.push(None);
        self.handles_out.push(None);
        false
    }

    /// Grows symmetric Bezier handles on the last anchor by dragging to
    /// `current` (scene coords): `handle_out = current - anchor`,
    /// `handle_in = -handle_out`, unless `alt_break` keeps the opposite
    /// side untouched (TS symmetric-drag + Alt-break parity). No-op when
    /// no anchor exists yet.
    pub fn drag_handle(&mut self, current: Point, alt_break: bool) {
        let Some(last) = self.points.last().copied() else {
            return;
        };
        let out = [current[0] - last[0], current[1] - last[1]];
        if out[0].hypot(out[1]) < crate::geometry::transform::PEN_DRAG_THRESHOLD_PX {
            return;
        }
        let idx = self.points.len() - 1;
        self.handles_out[idx] = Some(out);
        if !alt_break {
            self.handles_in[idx] = Some([-out[0], -out[1]]);
        }
    }

    /// Finishes the path: `true` when it has 2+ points and can commit (TS
    /// double-click/Enter/Escape-with-points parity — fewer than 2 points
    /// cancels instead).
    pub fn can_finish(&self) -> bool {
        self.points.len() >= 2
    }

    /// Builds the committed path segments (scene-space anchors with
    /// relative handles) plus the recalculated `(x, y, width, height)` box
    /// (floor 1 — TS `buildPathElement/computeBounds` parity). Returns
    /// `None` when fewer than 2 points exist.
    pub fn build_path(&self) -> Option<PenPath> {
        if self.points.len() < 2 {
            return None;
        }
        let mut min_x = f64::INFINITY;
        let mut min_y = f64::INFINITY;
        let mut max_x = f64::NEG_INFINITY;
        let mut max_y = f64::NEG_INFINITY;
        for (i, point) in self.points.iter().enumerate() {
            min_x = min_x.min(point[0]);
            min_y = min_y.min(point[1]);
            max_x = max_x.max(point[0]);
            max_y = max_y.max(point[1]);
            for handle in [&self.handles_in[i], &self.handles_out[i]]
                .into_iter()
                .flatten()
            {
                min_x = min_x.min(point[0] + handle[0]);
                min_y = min_y.min(point[1] + handle[1]);
                max_x = max_x.max(point[0] + handle[0]);
                max_y = max_y.max(point[1] + handle[1]);
            }
        }
        let x = min_x;
        let y = min_y;
        let width = (max_x - min_x).max(1.0);
        let height = (max_y - min_y).max(1.0);
        let segments = self
            .points
            .iter()
            .enumerate()
            .map(|(i, point)| crate::element::PathSegment {
                point: [point[0] - x, point[1] - y],
                handle_in: self.handles_in[i],
                handle_out: self.handles_out[i],
            })
            .collect();
        Some(PenPath {
            x,
            y,
            width,
            height,
            segments,
            closed: self.closed,
        })
    }
}

/// Committed pen path: recalculated box plus relative segments ready to
/// store as a `PathElement`.
#[derive(Debug, Clone, PartialEq)]
pub struct PenPath {
    /// Top-left x in scene coordinates.
    pub x: f64,
    /// Top-left y in scene coordinates.
    pub y: f64,
    /// Width in scene units (>= 1).
    pub width: f64,
    /// Height in scene units (>= 1).
    pub height: f64,
    /// Segments relative to the box origin.
    pub segments: Vec<crate::element::PathSegment>,
    /// Whether the path closed.
    pub closed: bool,
}

/// Crop handle being dragged.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CropHandle {
    /// Top-left corner.
    TopLeft,
    /// Top edge.
    Top,
    /// Top-right corner.
    TopRight,
    /// Right edge.
    Right,
    /// Bottom-right corner.
    BottomRight,
    /// Bottom edge.
    Bottom,
    /// Bottom-left corner.
    BottomLeft,
    /// Left edge.
    Left,
}

/// Minimal crop session in natural image pixels.
///
/// Ports the TS `CropHandler` data contract: the crop starts as the full
/// image (or the preserved region), drags clamp per edge with a 10 px
/// minimum, and committing the exact full image stores `None` (TS
/// `endCrop(true)` parity). Scene↔natural conversion stays with the caller
/// (it needs the element box); this session owns region math + lifecycle.
#[derive(Debug, Clone, PartialEq)]
pub struct CropSession {
    /// Cropped element id.
    pub target: ElementId,
    /// Current region in natural pixels.
    pub crop: crate::element::CropRegion,
    /// Natural image width.
    pub natural_width: f64,
    /// Natural image height.
    pub natural_height: f64,
}

impl CropSession {
    /// Starts a crop session over the full image or a preserved region.
    pub fn new(
        target: ElementId,
        existing: Option<crate::element::CropRegion>,
        natural_width: f64,
        natural_height: f64,
    ) -> Self {
        let crop = existing.unwrap_or(crate::element::CropRegion {
            x: 0.0,
            y: 0.0,
            width: natural_width,
            height: natural_height,
        });
        Self {
            target,
            crop,
            natural_width,
            natural_height,
        }
    }

    /// Moves one edge/corner to natural-pixel `point`, clamped so every
    /// edge keeps [`CROP_MIN_PX`] and the region stays inside the image.
    pub fn drag_handle(&mut self, handle: CropHandle, point: Point) {
        let min = CROP_MIN_PX;
        let (nw, nh) = (self.natural_width, self.natural_height);
        let mut crop = self.crop;
        match handle {
            CropHandle::TopLeft | CropHandle::Left | CropHandle::BottomLeft => {
                crop.x = point[0].clamp(0.0, crop.x + crop.width - min);
                crop.width += self.crop.x - crop.x;
            }
            _ => {}
        }
        match handle {
            CropHandle::TopLeft | CropHandle::Top | CropHandle::TopRight => {
                crop.y = point[1].clamp(0.0, crop.y + crop.height - min);
                crop.height += self.crop.y - crop.y;
            }
            _ => {}
        }
        match handle {
            CropHandle::TopRight | CropHandle::Right | CropHandle::BottomRight => {
                crop.width = (point[0] - crop.x).clamp(min, nw - crop.x);
            }
            _ => {}
        }
        match handle {
            CropHandle::BottomLeft | CropHandle::Bottom | CropHandle::BottomRight => {
                crop.height = (point[1] - crop.y).clamp(min, nh - crop.y);
            }
            _ => {}
        }
        self.crop = crop;
    }

    /// Returns `true` when the region is the exact full image (commit
    /// stores `None` — TS `endCrop(true)` parity).
    pub fn is_full_image(&self) -> bool {
        self.crop.x == 0.0
            && self.crop.y == 0.0
            && self.crop.width == self.natural_width
            && self.crop.height == self.natural_height
    }

    /// Converts a scene-space point to natural image pixels for the given
    /// element box (`img_x/y/w/h` scene units; TS `crop-handler.ts`
    /// `(scene - img) / size * natural` parity).
    pub fn scene_to_natural(
        &self,
        scene: Point,
        img_x: f64,
        img_y: f64,
        img_w: f64,
        img_h: f64,
    ) -> Point {
        if img_w == 0.0 || img_h == 0.0 {
            return [0.0, 0.0];
        }
        [
            (scene[0] - img_x) / img_w * self.natural_width,
            (scene[1] - img_y) / img_h * self.natural_height,
        ]
    }

    /// Converts natural image pixels back to scene coordinates for the
    /// given element box (inverse of [`CropSession::scene_to_natural`]).
    pub fn natural_to_scene(
        &self,
        natural: Point,
        img_x: f64,
        img_y: f64,
        img_w: f64,
        img_h: f64,
    ) -> Point {
        if self.natural_width == 0.0 || self.natural_height == 0.0 {
            return [img_x, img_y];
        }
        [
            img_x + natural[0] / self.natural_width * img_w,
            img_y + natural[1] / self.natural_height * img_h,
        ]
    }

    /// Overlay bounds of the current crop region in scene coordinates for
    /// the given element box (TS `getCropOverlayBounds` parity: natural→
    /// scene mapping of the region rect).
    pub fn overlay_bounds(
        &self,
        img_x: f64,
        img_y: f64,
        img_w: f64,
        img_h: f64,
    ) -> crate::geometry::rect::Bounds {
        let top_left =
            self.natural_to_scene([self.crop.x, self.crop.y], img_x, img_y, img_w, img_h);
        let bottom_right = self.natural_to_scene(
            [
                self.crop.x + self.crop.width,
                self.crop.y + self.crop.height,
            ],
            img_x,
            img_y,
            img_w,
            img_h,
        );
        crate::geometry::rect::Bounds {
            min_x: top_left[0],
            min_y: top_left[1],
            max_x: bottom_right[0],
            max_y: bottom_right[1],
        }
    }

    /// Hit-tests the 8 crop handles in scene coordinates for the given
    /// element box (`8 / zoom` radius per handle — TS
    /// `hitTestCropHandle` parity). Returns the handle whose square
    /// contains `scene_pt`, corners first, then edges.
    pub fn hit_test_handle(
        &self,
        scene_pt: Point,
        img_x: f64,
        img_y: f64,
        img_w: f64,
        img_h: f64,
        zoom: f64,
    ) -> Option<CropHandle> {
        let safe_zoom = if zoom.is_finite() && zoom > 0.0 {
            zoom
        } else {
            1.0
        };
        let radius = 8.0 / safe_zoom;
        let overlay = self.overlay_bounds(img_x, img_y, img_w, img_h);
        let cx = (overlay.min_x + overlay.max_x) / 2.0;
        let cy = (overlay.min_y + overlay.max_y) / 2.0;
        let candidates = [
            (CropHandle::TopLeft, overlay.min_x, overlay.min_y),
            (CropHandle::Top, cx, overlay.min_y),
            (CropHandle::TopRight, overlay.max_x, overlay.min_y),
            (CropHandle::Right, overlay.max_x, cy),
            (CropHandle::BottomRight, overlay.max_x, overlay.max_y),
            (CropHandle::Bottom, cx, overlay.max_y),
            (CropHandle::BottomLeft, overlay.min_x, overlay.max_y),
            (CropHandle::Left, overlay.min_x, cy),
        ];
        for (handle, hx, hy) in candidates {
            if (scene_pt[0] - hx).abs() <= radius && (scene_pt[1] - hy).abs() <= radius {
                return Some(handle);
            }
        }
        None
    }
}

/// Sets an image element's crop region as one undoable step (full-image
/// commits store `None` — TS `endCrop` parity).
#[derive(Debug, Clone, PartialEq)]
pub struct SetCrop {
    /// Target image element id.
    pub id: ElementId,
    /// New region in natural pixels, or `None` for the full image.
    pub crop: Option<crate::element::CropRegion>,
}

impl SetCrop {
    /// Builds a crop command for the given target and region.
    pub fn new(id: ElementId, crop: Option<crate::element::CropRegion>) -> Self {
        Self { id, crop }
    }
}

impl crate::command::Command for SetCrop {
    fn label(&self) -> &str {
        "crop"
    }

    fn execute(
        &mut self,
        ctx: &mut crate::command::CommandContext,
    ) -> crate::EngineResult<crate::command::CommandOutcome> {
        let Some(element) = ctx.doc().get(self.id.as_str()).cloned() else {
            return Ok(crate::command::CommandOutcome::default());
        };
        if element.base().is_deleted {
            return Ok(crate::command::CommandOutcome::default());
        }
        if element.element_type_name() != "image" {
            return Err(crate::EngineError::InvalidInput(format!(
                "crop target '{}' is not an image",
                self.id.as_str()
            )));
        }
        if let Some(region) = &self.crop {
            region.validate()?;
        }
        let mut next = element.clone();
        if let crate::element::Element::Image(image) = &mut next {
            image.crop = self.crop;
        }
        next.validate()?;
        ctx.upsert(next)?;
        Ok(crate::command::CommandOutcome {
            affected: vec![self.id.clone()],
            changed: true,
        })
    }
}

/// Wheel intent: zoom (Ctrl/Cmd held) or pan (plain scroll).
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum WheelIntent {
    /// Cursor-anchored zoom (TS factor `0.9` / `1.1`, clamped 0.1–10).
    Zoom {
        /// Multiplicative factor.
        factor: f64,
    },
    /// Scroll pan in screen pixels (caller divides by zoom).
    Pan {
        /// Horizontal delta in pixels.
        dx: f64,
        /// Vertical delta in pixels.
        dy: f64,
    },
}

/// Maps a wheel event to an intent (TS `pan-zoom.ts` parity: zoom iff
/// Ctrl/Cmd is held, factor by `delta_y` sign; otherwise pan).
pub fn wheel_intent(delta_x: f64, delta_y: f64, zoom_gesture: bool) -> WheelIntent {
    if zoom_gesture {
        WheelIntent::Zoom {
            factor: if delta_y > 0.0 { 0.9 } else { 1.1 },
        }
    } else {
        WheelIntent::Pan {
            dx: delta_x,
            dy: delta_y,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::element::{create_rectangle, CounterIdGenerator};

    fn doc_with_two() -> (Document, CounterIdGenerator) {
        let mut gen = CounterIdGenerator::new();
        let mut doc = Document::new();
        let mut a = create_rectangle(&mut gen);
        a.base.id = ElementId::of("a");
        a.base.x = 0.0;
        a.base.y = 0.0;
        a.base.width = 100.0;
        a.base.height = 100.0;
        doc.upsert(Element::Rectangle(a)).unwrap();
        let mut b = create_rectangle(&mut gen);
        b.base.id = ElementId::of("b");
        b.base.x = 200.0;
        b.base.y = 200.0;
        b.base.width = 100.0;
        b.base.height = 100.0;
        doc.upsert(Element::Rectangle(b)).unwrap();
        (doc, gen)
    }

    #[test]
    fn tool_ids_round_trip_ts_strings() {
        assert_eq!(ToolId::parse("select"), ToolId::Select);
        assert_eq!(ToolId::parse("text"), ToolId::Text);
        assert_eq!(
            ToolId::parse("rectangle"),
            ToolId::Draw("rectangle".to_string())
        );
        assert_eq!(ToolId::parse("laser"), ToolId::Custom("laser".to_string()));
        assert_eq!(ToolId::Select.as_str(), "select");
        assert_eq!(ToolId::Draw("ellipse".to_string()).as_str(), "ellipse");
    }

    #[test]
    fn registry_knows_builtins_and_customs() {
        let mut registry = ToolRegistry::with_builtins();
        assert!(registry.contains(&ToolId::Select));
        assert!(registry.contains(&ToolId::Draw("rectangle".to_string())));
        assert!(!registry.contains(&ToolId::Custom("laser".to_string())));
        registry.register_custom("laser");
        assert!(registry.contains(&ToolId::Custom("laser".to_string())));
    }

    #[test]
    fn keyboard_maps_ts_shortcuts_without_os_names() {
        let plain = Modifiers::none();
        let cmd = Modifiers {
            ctrl_or_cmd: true,
            ..Modifiers::none()
        };
        assert_eq!(
            key_to_intent(&Key::Delete, &plain, false),
            Some(KeyIntent::DeleteSelected)
        );
        assert_eq!(
            key_to_intent(&Key::ArrowLeft, &plain, false),
            Some(KeyIntent::Nudge { dx: -1.0, dy: 0.0 })
        );
        assert_eq!(
            key_to_intent(&Key::ArrowLeft, &Modifiers::shift(), false),
            Some(KeyIntent::Nudge { dx: -10.0, dy: 0.0 })
        );
        assert_eq!(
            key_to_intent(&Key::Char('z'), &cmd, false),
            Some(KeyIntent::Undo)
        );
        assert_eq!(
            key_to_intent(
                &Key::Char('z'),
                &Modifiers {
                    shift: true,
                    ctrl_or_cmd: true,
                    ..Modifiers::none()
                },
                false
            ),
            Some(KeyIntent::Redo)
        );
        assert_eq!(
            key_to_intent(&Key::Char('d'), &cmd, false),
            Some(KeyIntent::Duplicate)
        );
        // Shift+Ctrl+D is not duplicate (TS takes plain Ctrl+D only).
        assert_eq!(
            key_to_intent(
                &Key::Char('d'),
                &Modifiers {
                    shift: true,
                    ctrl_or_cmd: true,
                    ..Modifiers::none()
                },
                false
            ),
            None
        );
        // Text editing swallows everything but Escape.
        assert_eq!(key_to_intent(&Key::Delete, &plain, true), None);
        assert_eq!(
            key_to_intent(&Key::Escape, &plain, true),
            Some(KeyIntent::Escape)
        );
    }

    #[test]
    fn context_menu_lists_group_and_lock_intents() {
        let (doc, _) = doc_with_two();
        assert!(context_menu_intents(&doc, &[]).is_empty());
        let single = vec![ElementId::of("a")];
        let intents = context_menu_intents(&doc, &single);
        assert!(intents.contains(&ContextMenuIntent::Delete));
        assert!(!intents.contains(&ContextMenuIntent::Group));
        assert!(intents.contains(&ContextMenuIntent::Lock));
        let pair = vec![ElementId::of("a"), ElementId::of("b")];
        assert!(context_menu_intents(&doc, &pair).contains(&ContextMenuIntent::Group));
    }

    #[test]
    fn rubber_band_normalizes_corners() {
        let bounds = rubber_band_bounds(&[100.0, 100.0], &[0.0, 50.0]);
        assert_eq!(
            (bounds.min_x, bounds.min_y, bounds.max_x, bounds.max_y),
            (0.0, 50.0, 100.0, 100.0)
        );
    }

    #[test]
    fn draw_box_rejects_clicks_and_builds_shapes() {
        assert!(draw_box_element("rectangle", ElementId::of("x"), 0.0, 0.0, 1.0, 1.0).is_none());
        let rect = draw_box_element("rectangle", ElementId::of("r"), 10.0, 20.0, 50.0, 60.0)
            .expect("drag creates");
        assert_eq!(rect.base().x, 10.0);
        assert_eq!(rect.base().width, 50.0);
        let line =
            draw_box_element("line", ElementId::of("l"), 0.0, 0.0, 30.0, 40.0).expect("line drag");
        assert_eq!(line.element_type_name(), "line");
        assert!(draw_box_element("text", ElementId::of("t"), 0.0, 0.0, 50.0, 50.0).is_none());
        assert!(draw_box_element("freedraw", ElementId::of("f"), 0.0, 0.0, 50.0, 50.0).is_none());
    }

    #[test]
    fn pen_session_closes_near_start_with_three_points() {
        let mut pen = PenSession::new();
        assert!(!pen.can_finish());
        assert!(!pen.add_point([0.0, 0.0]));
        assert!(!pen.add_point([50.0, 0.0]));
        assert!(!pen.add_point([50.0, 50.0]));
        assert!(pen.can_finish());
        assert!(pen.add_point([2.0, 2.0]), "closes within 12 units");
        assert!(pen.closed);
    }

    #[test]
    fn crop_session_clamps_and_detects_full_image() {
        let mut crop = CropSession::new(ElementId::of("img"), None, 800.0, 600.0);
        assert!(crop.is_full_image());
        crop.drag_handle(CropHandle::TopLeft, [100.0, 50.0]);
        assert!(!crop.is_full_image());
        assert_eq!((crop.crop.x, crop.crop.y), (100.0, 50.0));
        crop.drag_handle(CropHandle::TopLeft, [-500.0, -500.0]);
        assert_eq!((crop.crop.x, crop.crop.y), (0.0, 0.0));
        assert!(crop.crop.width >= CROP_MIN_PX && crop.crop.height >= CROP_MIN_PX);
    }

    #[test]
    fn wheel_maps_zoom_gesture_vs_pan() {
        assert_eq!(
            wheel_intent(0.0, 100.0, true),
            WheelIntent::Zoom { factor: 0.9 }
        );
        assert_eq!(
            wheel_intent(0.0, -100.0, true),
            WheelIntent::Zoom { factor: 1.1 }
        );
        assert_eq!(
            wheel_intent(10.0, 20.0, false),
            WheelIntent::Pan { dx: 10.0, dy: 20.0 }
        );
    }
}
