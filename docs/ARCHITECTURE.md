# ARCHITECTURE — Fazelidraw

This document is the **technical contract**. Decisions here must not be changed by AI agents without explicit maintainer approval. If an AI agent needs to deviate from this document, they must **stop and ask**, not silently change the architecture.

---

## 1. Design Principles

1. **Data-oriented over object-oriented.** Elements are plain objects (interfaces), not classes with methods. Behavior (render, hitTest) lives in separate functions that take elements as parameters — not methods on the element itself. This makes elements 100% serializable (JSON.stringify works directly) and easy to diff for history.
2. **Framework-agnostic core.** The `@fazelidraw/core` package must not import React/Vue/Svelte. UI (toolbar, property panel) lives in a separate layer that consumes the core through a public API.
3. **Single source of truth for the scene.** All elements live in one `Scene` store. No element state is duplicated in UI components.
4. **Explicit over implicit.** No "magic" — every coordinate transformation, every cache invalidation must be explicit and traceable.

## 2. Element Data Structure

### 2.1 Base Element

All elements inherit from this base shape (using TypeScript union types, not class inheritance):

```typescript
interface BaseElement {
  id: string;              // nanoid or uuid, generated once at creation
  type: ElementType;       // 'rectangle' | 'ellipse' | 'line' | 'arrow' | 'text' | 'freedraw'
  x: number;                // top-left, in scene coordinates (not screen)
  y: number;
  width: number;
  height: number;
  rotation: number;         // radians
  strokeColor: string;      // hex or 'transparent'
  backgroundColor: FillStyle; // see §2.3 — solid OR gradient
  strokeWidth: number;
  strokeStyle: 'solid' | 'dashed' | 'dotted';
  fillStyle: 'solid' | 'hachure' | 'cross-hatch';
  opacity: number;          // 0–100
  seed: number;              // for hand-drawn style rendering (if used)
  version: number;           // incremented on every mutation — used by history/cache
  versionNonce: number;      // random number, changes on every mutation, used for conflict detection
  isDeleted: boolean;        // soft-delete, not immediately removed from Map (simplifies undo & sync)
  groupIds: string[];        // for grouping, order from innermost to outermost
  locked: boolean;
}
```

**Why `isDeleted` instead of immediate deletion from Map?**
Reference: soft-delete pattern. Soft-delete makes undo/redo and (later) collaboration synchronization much simpler — you don't need to reconstruct elements from old snapshots, just toggle a flag.

**Why `version` + `versionNonce`?**
`version` for local ordering (linear increment). `versionNonce` for detecting "has this element actually changed" without deep-comparing the entire object — just compare the nonce.

### 2.2 Specific Elements

```typescript
interface RectangleElement extends BaseElement { type: 'rectangle'; roundness: number | null }
interface EllipseElement extends BaseElement { type: 'ellipse' }
interface LineElement extends BaseElement { type: 'line'; points: Point[] }
interface ArrowElement extends BaseElement {
  type: 'arrow';
  points: Point[];
  startBinding: Binding | null;
  endBinding: Binding | null;
  startArrowhead: ArrowheadType | null;
  endArrowhead: ArrowheadType | null;
}
interface TextElement extends BaseElement {
  type: 'text';
  text: string;
  fontSize: number;
  fontFamily: string;
  textAlign: 'left' | 'center' | 'right';
  containerId: string | null; // if this text is bound inside another shape
}
interface FreedrawElement extends BaseElement {
  type: 'freedraw';
  points: Point[];
  pressures: number[]; // for stylus/pressure-sensitive input
}

interface Binding {
  elementId: string;
  focus: number;   // relative position along the target element's edge
  gap: number;      // distance from the target element
}

type Point = [number, number];
```

### 2.3 Fill Style: Solid & Gradient

**Key decision**: `backgroundColor` is **not** a plain color string, because gradients need more data than a single color. Store as a discriminated union:

```typescript
type FillStyle =
  | { type: 'solid'; color: string }
  | { type: 'gradient'; gradientType: 'linear' | 'radial'; angle: number; stops: GradientStop[] };

interface GradientStop {
  offset: number; // 0–1
  color: string;
}
```

At render time, a separate function (`resolveFillStyle(ctx, fillStyle, bounds)`) converts this into a `CanvasGradient` object via `ctx.createLinearGradient()`/`ctx.createRadialGradient()`. **Do not** store `CanvasGradient` directly on the element — it's not a JSON-serializable object.

### 2.4 Scene Store

```typescript
class Scene {
  private elements: Map<string, Element> = new Map();
  private elementOrder: string[] = []; // z-index order, separate from Map (Map doesn't guarantee reliable order for this use case)
  private sceneNonce: number = 0;      // incremented on any mutation — used for render cache invalidation

  getElement(id: string): Element | undefined { return this.elements.get(id); }
  getAllElements(): Element[] { /* iterate elementOrder, lookup in Map — O(n) only when full list is needed */ }
  upsertElement(el: Element): void { /* set + bump sceneNonce */ }
  deleteElement(id: string): void { /* soft-delete: set isDeleted = true */ }
}
```

**Why `Map<id, Element>` instead of `Element[]`?**
Update/lookup by id is the most frequent operation (drag, resize, style change). `Array.find()` is O(n) per operation — with 5000 elements and drag triggering dozens of updates per second, this becomes a real bottleneck. `Map.get()`/`Map.set()` are O(1).

**Why is `elementOrder` separate?**
Z-index/layering needs stable and predictable order. `Map` insertion order in JS is actually deterministic, but separating render order from storage makes "bring to front/back" operations simple array manipulations without having to rebuild the Map.

## 3. Rendering Pipeline

### 3.1 Dual-Canvas Architecture

- **Static Canvas** — renders actual elements (shapes, text, arrows). Only re-renders when `sceneNonce` changes (element added/edited/deleted) or viewport (pan/zoom) changes.
- **Interactive Canvas** — renders selection box, resize handles, cursor collaborator (later), rubber-band selection. Updates every frame during user interaction, but **never** touches the static canvas.

This separation is critical: dragging selection handles happens dozens of times per second, but if that triggered re-rendering all 5000 elements every frame, performance would collapse. With two canvases, UI interaction and heavy element rendering are completely independent.

### 3.2 Render Loop

```
requestAnimationFrame loop:
  if (sceneNonce changed since last frame OR viewport changed):
    visibleElements = cullToViewport(scene.getAllElements(), viewport)
    renderStaticCanvas(visibleElements)
  if (interactionState changed):
    renderInteractiveCanvas(interactionState)
```

Use `requestAnimationFrame`, **not** direct rendering in every event handler (`mousemove` can fire 100+ times/sec — batching via rAF prevents excessive rendering).

### 3.3 Viewport Culling

```typescript
function cullToViewport(elements: Element[], viewport: Viewport): Element[] {
  return elements.filter(el => boundsIntersect(getElementBounds(el), viewport.bounds));
}
```

This is **mandatory** before the scene has more than ~200 elements. Without it, every frame tries to draw elements that aren't even visible on screen.

### 3.4 Cache Invalidation — `sceneNonce`

Store a single counter that increments on every element mutation. Before rendering, check: "has the nonce changed since the last frame?" If not, skip rendering entirely (the canvas is already correct). This prevents unnecessary rendering when nothing is changing (e.g., user is idle / hovering without action).

### 3.5 Coordinates: Scene Space vs Screen Space

**Never** store element positions in screen coordinates. All elements are stored in **scene coordinates** (absolute world, unaffected by pan/zoom). Conversion to screen coordinates only happens at the render/input point, through the transform matrix:

```typescript
interface Viewport { scrollX: number; scrollY: number; zoom: number; }

function sceneToScreen(point: Point, viewport: Viewport): Point {
  return [(point[0] + viewport.scrollX) * viewport.zoom, (point[1] + viewport.scrollY) * viewport.zoom];
}
```

Render using `ctx.setTransform()` once per frame to apply pan/zoom, then draw elements in their original scene coordinates — don't manually recalculate screen position per element point.

## 4. Hit-Testing & Spatial Index

### 4.1 Why a Spatial Index is Needed

Linear loop through all elements to check "where did the user click" is O(n) per click. With 5000 elements, this is still fast enough (< 1ms for simple operations), BUT the combination with rubber-band selection (requires repeated queries every drag frame) and viewport culling (repeated queries on every pan/zoom) makes it a real bottleneck on large scenes.

### 4.2 Choice: Grid Spatial Hash (not Quadtree/R-tree)

Based on research, **grid spatial hashing is simpler and sufficiently fast** for 2D whiteboard use-cases with relatively evenly spread elements (compared to very clustered data which is better suited for quadtrees). Grids are also much easier to implement and debug by AI agents than recursive quadtrees/R-trees.

```typescript
class SpatialGrid {
  private cellSize: number = 200; // scene units, tunable
  private cells: Map<string, Set<string>> = new Map(); // "cellX,cellY" -> Set<elementId>

  insert(elementId: string, bounds: Bounds): void { /* insert into all cells that overlap bounds */ }
  remove(elementId: string, bounds: Bounds): void { /* ... */ }
  queryBounds(bounds: Bounds): Set<string> { /* get elementId from all overlapping cells */ }
}
```

This index is updated every time an element changes position/size (re-insert), and is used for viewport culling AND hit-testing simultaneously.

**Definition of done for Phase 7**: benchmark grid hash vs linear scan on 5000 elements, document results. If grid hash doesn't provide significant improvement at the target scale, it may be simplified — but it must be measured, not assumed.

## 5. History (Undo/Redo)

**Don't** snapshot the entire scene on every action (wasteful memory, especially for large scenes). Use the **command pattern**: each user action produces a command object with `do()` and `undo()` that only stores the relevant delta.

```typescript
interface HistoryEntry {
  elementUpdates: Map<string, { before: Partial<Element>; after: Partial<Element> }>;
}
```

History is stored as a stack of `HistoryEntry[]`. Undo = apply `before` from the top entry. Redo = apply `after`.

## 6. Clipboard

- Copy: serialize selected elements (deep clone via `structuredClone`) to internal buffer AND (if possible) to `navigator.clipboard` as custom JSON mime-type, enabling paste across tabs/windows.
- Paste: generate new `id` for each element (don't reuse old ids — they will collide), offset position slightly from original.
- Duplicate: same as copy+paste but without going through clipboard, in a single operation.

## 7. Package Structure (Monorepo)

```
fazelidraw/
  packages/
    core/          # @fazelstudio/fazelidraw — pure engine, TypeScript, zero framework dependency
      src/
        scene/       # Scene store, element types
        render/      # Render pipeline, canvas layers
        spatial/     # Spatial grid index
        history/     # Undo/redo
        interaction/ # Pointer event handling, tool state machine
        shapes/      # Shape registry — see §9.3, also used by custom shapes v2
        theme/       # v2 — Theme/token system, see §9.1
    react/          # @fazelstudio/react — React binding/wrapper + UI overrides, see §9.2
  apps/
    demo/           # Example application for manual testing & showcase
  docs/             # this document
```

**Strict rule**: `packages/core` must NOT have dependencies on React/Vue/etc in `package.json`. If an AI agent adds those, it's a scope violation — see AGENTS.md.

## 8. Technical References

- Dual-canvas architecture, sceneNonce cache invalidation, viewport culling — designed based on established patterns in collaborative whiteboard tools.
- Spatial hashing vs quadtree for 2D hit-testing at medium scale (thousands of objects).
- Data-oriented design principles for frequently mutated mutable state (avoiding unnecessary reactive framework overhead without multiplayer requirements).
- **v2**: Extensibility patterns — `ShapeUtil` class per shape type with `configure()` for overrides without subclassing, UI overrides as separate props from the core editor, theme system with "display values pipeline" consumed by shape utils in a structured way (not hardcoded inline colors).

## 9. Extensibility & Customization Architecture (v2)

This is an **additional architecture layer on top of v1**, not a replacement. All decisions in §1–§8 (dual-canvas, Map-based scene, data-oriented elements) still apply — the customization API is built around them, not on top of them.

### 9.1 Three Customization Layers

```
┌─────────────────────────────────────────────────────┐
│ Layer 3: UI Overrides (packages/react)                │
│  → developer replaces toolbar, panel, icon components │
├─────────────────────────────────────────────────────┤
│ Layer 2: Theme / Design Tokens (packages/core/theme)   │
│  → developer changes colors, fonts, default sizes      │
├─────────────────────────────────────────────────────┤
│ Layer 1: Shape Registry (packages/core/shapes)          │
│  → developer adds/replaces shape types & tools          │
└─────────────────────────────────────────────────────┘
```

All three are independent — a developer may use one, two, or all three. Details per layer are in the respective phase documents (`09-customization-theme.md`, `10-customization-ui.md`, `11-customization-shapes.md`).

### 9.2 Principle: Config Object, Not Global Mutation

All customization is provided via a **config object passed during engine/component initialization**, NOT by modifying global variables or singletons:

```typescript
// CORRECT — config passed explicitly
const engine = createFazelidraw({
  theme: myCustomTheme,
  shapeUtils: [myCustomShapeUtil],
});

// WRONG — don't do this
FazelidrawTheme.primaryColor = '#ff0000'; // global mutation, race condition between instances
```

Reason: the engine must support **multiple instances on the same page** with different configurations (e.g., two side-by-side canvases with different themes) without affecting each other.

### 9.3 Shape Registry (Layer 1)

Extend the v1 shape module pattern (§1, shapes as pure functions `render`/`hitTest`/`getBounds`) into a **registry that can be registered from outside**:

```typescript
interface ShapeDefinition<T extends BaseElement> {
  type: string;
  render(ctx: CanvasRenderingContext2D, element: T, viewport: Viewport): void;
  hitTest(point: Point, element: T): boolean;
  getBounds(element: T): Bounds;
  getDefaultProps(): Partial<T>;
}

function registerShape<T extends BaseElement>(definition: ShapeDefinition<T>): void;
```

Built-in shapes (rectangle, ellipse, etc. from v1) are registered through the SAME registry — there is no privileged distinction between built-in shapes and developer custom shapes. This is consistent with the pattern where even some built-in shapes can be customized via `configure()` without subclassing.

### 9.4 Theme / Design Token System (Layer 2)

All visual values a developer might want to change (UI colors — NOT element drawing colors which already have `FillStyle` in §2.3 —, fonts, handle sizes, radii, etc.) are defined as tokens, not hardcoded in render code:

```typescript
interface FazelidrawTheme {
  colors: { background: string; selectionOutline: string; handleFill: string; /* ... */ };
  fonts: { default: string; /* available fonts in font picker */ };
  sizes: { handleSize: number; selectionOutlineWidth: number; /* ... */ };
}

const defaultTheme: FazelidrawTheme = { /* engine default values */ };
```

Render functions in `render-selection.ts` (from v1 Phase 3) and similar read from the `theme` resolved at that time (via context/parameter), not hardcoded constants.

### 9.5 UI Overrides (Layer 3, only relevant for `packages/react`)

For UI components (toolbar, color picker, property panel) rendered by React in `packages/react` — NOT the core engine (core remains framework-agnostic per §1):

```typescript
interface FazelidrawUIOverrides {
  components?: {
    ColorPicker?: React.ComponentType<ColorPickerProps>;
    Toolbar?: React.ComponentType<ToolbarProps>;
    // ...
  };
  icons?: Partial<Record<IconName, React.ComponentType>>;
}
```

Developers can replace the built-in `ColorPicker` with their own implementation (e.g., `react-colorful`) as long as it satisfies the `ColorPickerProps` interface (props contract, not implementation). This makes "switch to react-colorful" possible without forking.

### 9.6 Important Limitations

- Customization layers must NOT affect the core render path performance (§3) for developers who don't perform any customization — theme/shape registry resolution must happen outside the per-frame render-loop hot path (resolved once when config changes, not re-looked-up every frame).
- Core (`packages/core`) remains **framework-agnostic**. Shape Registry and Theme System live in core (plain TypeScript). UI Overrides (Layer 3) only exist in `packages/react` because they are inherently React components.

## 10. Headless Editor API Architecture (v3)

This layer addresses the need: **developers can build their own UI from scratch, not use `packages/react` at all, and still use the full engine capability through a clean API.** See `docs/PRD.md` §11 for the product principles; this section is the technical design.

### 10.1 Why This is Different from §9 (Customization v2)

§9 (Layers 1-3: Shape Registry, Theme, UI Overrides) assumes developers still use `FazelidrawEditor` from `packages/react` as the main framework, and replace parts of it via props. That's **composition within our framework**.

§10 is different: developers may **not use our framework at all**. They only need:
1. A way to create an engine instance (Scene + all logic) without any DOM/React.
2. A way to call every operation (create shape, select, transform, style, undo, etc.) through clear, well-contracted function/method calls.
3. A way to know when state changes, so their UI (in whatever form) can re-render.

`packages/react` (v2, Phase 9-15) is **not removed** — it's repositioned as a "reference implementation": one example of a UI built on top of this Editor API, not the only way to use the engine.

### 10.2 `Editor` — Single Public Contract

All engine capabilities (Scene, History, Clipboard, Selection, Transform, Shape Registry, Theme from v1-v2) are wrapped into one object/class:

```typescript
class Editor {
  // Scene & elements
  createElement(partial: Partial<Element>): Element;
  updateElement(id: string, patch: Partial<Element>): void;
  deleteElement(id: string): void;
  getElement(id: string): Element | undefined;
  getAllElements(): Element[];

  // Selection
  select(ids: string[]): void;
  getSelection(): string[];
  clearSelection(): void;

  // Active tool (for custom UI to know/set current drawing mode)
  setActiveTool(toolType: string): void;
  getActiveTool(): string;

  // Transform (called by custom UI through their own drag handlers or buttons)
  moveElements(ids: string[], dx: number, dy: number): void;
  resizeElement(id: string, newBounds: Bounds): void;
  rotateElement(id: string, angle: number): void;

  // History
  undo(): void;
  redo(): void;
  canUndo(): boolean;
  canRedo(): boolean;

  // Clipboard
  copy(ids: string[]): void;
  paste(): void;
  duplicate(ids: string[]): void;

  // Viewport
  pan(dx: number, dy: number): void;
  zoom(factor: number, center: Point): void;
  getViewport(): Viewport;

  // Style (from v1 Phase 4)
  setStyle(ids: string[], style: Partial<StyleProps>): void;

  // Event subscription — see §10.3
  on<E extends EditorEventType>(event: E, callback: (payload: EditorEventPayload<E>) => void): () => void;

  // Rendering — Editor still needs a target canvas for visual rendering
  mount(canvasElement: HTMLCanvasElement | HTMLElement): void;
  unmount(): void;
}

function createEditor(config?: FazelidrawConfig): Editor; // same config as v2 (theme, shapes, etc.)
```

**Design principle for the methods above**: each method is a **thin wrapper** around functions that already exist in v1/v2 (`Scene.upsertElement`, `groupElements`, `alignLeft`, etc. from previous phases) — this phase does NOT rewrite logic, only exposes what already exists through one consistent contract. If an ability from a previous phase (e.g., `distributeHorizontal` from Phase 13) doesn't yet have a wrapper method in `Editor`, it must be added here — the list above is the minimum baseline, not the final complete list (audit all public functions from Phase 0-15 during implementation).

### 10.3 Event System

```typescript
type EditorEventType =
  | 'change'            // scene changed (element added/edited/deleted)
  | 'selectionChange'    // selection changed
  | 'toolChange'          // active tool changed
  | 'viewportChange'      // pan/zoom changed
  | 'historyChange';      // undo/redo stack changed (for enabling/disabling UI buttons)

interface EditorEventPayloadMap<E extends EditorEventType> { /* specific payload per event, minimally includes relevant latest state */ }
```

- Implementation: simple pub-sub (Map from event type to Set of callbacks) — **no need for large reactive/state-management libraries**, consistent with the "lightweight" principle in PRD §1.
- `editor.on(...)` returns an `unsubscribe` function (common pattern in JS APIs) so custom UI (React, Vue, etc.) can clean up listeners when components unmount.
- Events MUST be triggered from the same point as internal `sceneNonce`/cache-invalidation (§3.4) — not a separate mechanism that could desync. Ideally `sceneNonce` bump is ONE of the triggers for the `change` event, not two parallel systems that need manual synchronization.
- **Performance boundary**: emitting events must not happen inside the per-frame render-loop hot path (§3.2) for cases where nothing actually changed — events only fire when state actually changes, consistent with the skip-render-if-`sceneNonce`-unchanged principle.

### 10.4 Granular UI Control (Product Principle from PRD §11.2)

This is what distinguishes "can override components" (v2) from "full control" (v3). The Editor API must support:

1. **Enable/disable capabilities granular** — not just "use built-in Toolbar or replace entirely", but developers can query/restrict which tools are active:
   ```typescript
   createEditor({ enabledTools: ['select', 'rectangle', 'text'] }); // other tools cannot be activated at all, not just hidden from UI
   ```
2. **No layout assumptions at the `packages/core` level.** Core must know NOTHING about "toolbar at the top" or "panel on the right" — that's entirely the UI's responsibility (both `packages/react` and developer custom UI). `mount()` in §10.2 only needs a canvas target, no DOM structure assumptions.
3. **Granular styling** — because core doesn't render any UI chrome (toolbar, panel) at all, "granular styling per UI element" is entirely in the developer's hands once they use the Editor API directly. For those who still use `packages/react`, this is already covered by the Theme pattern (§9.4) and Component Overrides (§9.5).

### 10.5 Important Limitations

- The Editor API does NOT replace `Scene`, `HistoryManager`, etc. that already exist — Editor is a **facade/wrapper**, not a new implementation. Phases 16-18 must not rewrite proven logic from Phases 0-15.
- `packages/react` MUST be refactored (not rewritten from scratch) to internally use the same `Editor` API, proving this API is truly sufficient to build a full UI — if `packages/react` still needs direct access to internal Scene (not through Editor), that's a signal the API is incomplete and must be fixed, not left as-is.
- The `mount()`/`unmount()` methods are still needed because core is still responsible for visual rendering (dual-canvas, §3) — "headless" here means "headless UI chrome" (toolbar, panel, etc.), NOT "headless rendering". If developers want to do their own visual rendering too (not just UI chrome), that's outside v3 scope — noted as a possible v4 if real needs arise.

---

**Note for AI Agent**: This document is a contract. If instructions in phase documents (`docs/phases/*.md`) appear to conflict with this document, this document wins — report the conflict to the user, don't silently choose one side.
