/**
 * Pointer interaction rules.
 *
 * The engine owns the pointer phase machine (idle → pressed → dragging /
 * rubberBand / drawing / panning); the host owns only these predictable
 * mappings. Do not copy another app's shortcuts blindly: these follow the
 * engine's TS-parity behavior and common conventions (click selects the hit
 * with group-aware expansion engine-side, or clears when empty; select-tool
 * drag moves the selection with previewMove guides committed on pointerUp;
 * draw-tool drag creates a shape with ghost preview committed on pointerUp;
 * empty drag rubber-bands a multi-select; shift+click toggles one row in
 * layers or additive-selects on canvas via engine modifiers; shift+drag
 * axis-locks moves, aspect-locks resizes, and ×10-nudges arrows;
 * middle-drag/wheel pans and zooms engine-side with no host math;
 * space-to-pan is an engine gap, never faked with a tool; escape runs the
 * engine escape chain; enter commits text in the overlay and does nothing
 * outside text).
 */
export const POINTER_RULES = {
  click: 'select-or-clear',
  dragSelect: 'move-preview-commit',
  dragDraw: 'ghost-preview-commit',
  dragEmpty: 'rubber-band',
  shiftClick: 'toggle-one',
  shiftDrag: 'axis-or-aspect-lock',
  wheel: 'pan-or-zoom-gesture',
  spacePan: 'engine-gap',
  escape: 'escape-chain',
  enter: 'commit-text-or-nothing',
} as const;
