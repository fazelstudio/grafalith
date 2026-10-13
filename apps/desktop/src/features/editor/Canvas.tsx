import { useRef, useEffect, useCallback, useState } from 'react';
import type {
  DrawEntryDto,
  Engine,
  FrameSnapshot,
  RenderModelDto,
  SessionStateDto,
  SnapGuideDto,
} from '../../hooks/useEngine';
import { lastResultData, lastResultEntry, parseBatchResult } from '../../hooks/useEngine';
import { canExecuteCommand, executeCommand, type CommandContext, type ViewActions } from '../../registries';
import { executeExtensionCommand, hasExtensionCommand, extensionMenuRowsFor } from '../../platform/extensions/extensionContributions';
import { commandResultMessage } from './engineGaps';
import {
  caretIndexAt,
  caretRange,
  contrastingTextColor,
  hasPoorContrast,
  legibleTextColor,
  lineRowForY,
  planDraftReconcile,
  planKeyEdit,
} from './textEditing';
import { CanvasContextMenu } from './menus/menus';
import { useToast } from '../../app/shell/ToastProvider';
import { drawRenderModel, NO_PREVIEW, type GhostPreview } from '../../render/drawModel';
import { cursorForResizeHandle, ROTATE_CURSOR, selectionHandleCursor } from '../../render/cursors';
import { screenToScene, sceneToScreen } from '../../render/coords';
import { useI18n } from '../../app/i18n/resources';
import { useTheme } from '../../app/theme/ThemeProvider';
import { DESKTOP_TIMING, themeTokens } from '../../app/theme/tokens';
import { FitIcon, FitSelectionIcon, MinusIcon, PlusIcon } from '../../ui/icons';
import { Tooltip } from '../../ui/primitives/tooltip';
import { zoomViewport } from './viewport';
import type { FillPreview } from '../../render/drawModel';
interface CanvasProps {
  engine: Engine;
  activeTool: string;
  /** When true the creation tool stays active after commit instead of returning to Select. */
  stickyTool: boolean;
  /**
   * Uncommitted fill preview (inspector stop drag), shared by ref so drags
   * repaint without re-rendering. Canvas clears nothing; the writer owns it.
   */
  fillPreviewRef: { current: FillPreview | null };
  /** Throttled snapshots for panels and chrome sharing engine state. */
  onFrame?: (snapshot: FrameSnapshot) => void;
  /** Recoverable renderer failure; the last good frame stays visible. */
  onRenderError?: () => void;
  /** Shared command context assembled by the shell (single execution source). */
  commandContext: CommandContext;
  /** Host registers viewport actions so view commands reuse one implementation. */
  onViewActions?: (actions: ViewActions | null) => void;
  /** Returns to selection after a completed shape gesture. */
  onToolChange?: (tool: string) => void;
}

interface ContextMenuState {
  x: number;
  y: number;
  intents: string[];
}

const DRAW_TOOLS = new Set(['rectangle', 'ellipse', 'line', 'arrow', 'frame', 'image']);
const DRAW_CURSOR_TOOLS = new Set([...DRAW_TOOLS, 'freedraw']);
// Grace after user caret motion during which the mirror never snaps back.
const USER_CARET_GRACE_MS = 250;
// Transport retry delay after a failed frame fetch (error path only).
const RETRY_POLL_MS = 250;

/** Fixed-page chrome: dim outside the bounds, hairline on the boundary. */
function paintCanvasBounds(
  ctx: CanvasRenderingContext2D,
  snapshot: FrameSnapshot,
  cssWidth: number,
  cssHeight: number,
): void {
  const mode = snapshot.session.canvasMode;
  const width = mode?.width ?? 0;
  const height = mode?.height ?? 0;
  if (mode?.mode !== 'bounded' || !Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return;
  }
  const viewport = snapshot.session.viewport;
  const [x, y] = sceneToScreen([0, 0], viewport);
  const [right, bottom] = sceneToScreen([width, height], viewport);
  ctx.save();
  // Veil colors match the engine theme defaults so both themes read the same.
  ctx.beginPath();
  ctx.rect(0, 0, cssWidth, cssHeight);
  ctx.rect(x, y, right - x, bottom - y);
  ctx.fillStyle = 'rgba(0, 0, 0, 0.08)';
  ctx.fill('evenodd');
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.2)';
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 0.5, y + 0.5, right - x - 1, bottom - y - 1);
  ctx.restore();
}

export function Canvas({
  engine,
  activeTool,
  stickyTool,
  fillPreviewRef,
  onFrame,
  onRenderError,
  commandContext,
  onViewActions,
  onToolChange,
}: CanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const textAreaRef = useRef<HTMLTextAreaElement>(null);
  const rafRef = useRef<number | null>(null);
  const chainRef = useRef<Promise<unknown>>(Promise.resolve());
  const sizeRef = useRef<{ width: number; height: number }>({ width: 0, height: 0 });

  // Per-frame engine truth (never duplicated into React state).
  const frameRef = useRef<FrameSnapshot | null>(null);
  const cursorRef = useRef<[number, number] | null>(null);
  const ghostRef = useRef<GhostPreview>(NO_PREVIEW);
  const guidesRef = useRef<SnapGuideDto[] | null>(null);
  // Bumped on every ghost/guide assignment: the paint key below repaints
  // transient overlays without touching the committed model.
  const paintTickRef = useRef(0);
  const trailRef = useRef<[number, number][]>([]);
  const activePointerRef = useRef<number | null>(null);
  // Press origin in scene units, stored at pointer-down so drag previews and
  // move forwarding survive a stale frame (the watcher may still report the
  // previous idle phase while the engine already holds the press).
  const pressOriginRef = useRef<[number, number] | null>(null);
  // Last session adopted synchronously from a pointer batch, so moves can
  // gate on the press even before the watcher fetches it or when no frame
  // exists yet. Refreshed by every pointer adoption and watcher poll.
  const pressSessionRef = useRef<SessionStateDto | null>(null);
  // Bumped on every chained input; the watcher discards a poll that started
  // before the latest input instead of painting its stale session over it.
  const inputGenRef = useRef(0);
  // Tool held at press time. A release only commits when the live tool still
  // matches it: switching tools mid-drag cancels the gesture engine-side,
  // and the release must stay a cancel instead of storing a shape for a
  // tool the user already left.
  const pressToolRef = useRef<string | null>(null);
  // Whether the current press is still unreleased. Guards the stateless
  // draw commit below so a stray release (after cancel, blur, or tool
  // switch) can never store a second shape.
  const pressActiveRef = useRef(false);
  // Gesture identity minted once per press. The release echoes it as the
  // commit request id, so a transport retry or a duplicate release returns
  // the stored shape instead of storing a second one (the engine remembers
  // the latest commit per id).
  const pressRequestRef = useRef<string | null>(null);
  const previewInFlightRef = useRef(false);
  const previewGenerationRef = useRef(0);
  const pendingPreviewRef = useRef<{
    ops: unknown[];
    kind: GhostPreview['kind'];
    affected: string[];
    target?: string;
  } | null>(null);
  const clickCountRef = useRef<number>(0);
  const lastClickTimeRef = useRef<number>(0);
  const composingRef = useRef(false);
  // Long-press state: holding still on an object shows the held hand until
  // a drag or release takes over. Timer handle beside it for cleanup.
  const longPressRef = useRef(false);
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Optimistic input state for sends the frame loop has not acknowledged
  // yet. Intercepted keystrokes plan against this (not a stale frame), so
  // fast typing composes in order instead of scrambling; the frame mirror
  // holds off until the engine draft catches up. Cleared on every session
  // transition and commit.
  const pendingRef = useRef<{ value: string; caret: number } | null>(null);
  // Stale-frame guard: frame queries bypass the input chain, so a frame
  // sent before a press can resolve after it. A locally known session is
  // only dropped after several consecutive session-less frames.
  const nullStreakRef = useRef(0);
  // Session id the overlay is waiting for after a press: lets the sync
  // tell a stale frame (previous session) apart from a genuinely
  // engine-started one. Null once adopted or ended.
  const expectSessionRef = useRef<string | null>(null);
  // Shared 2D context for pixel-exact click-to-caret measurement (never
  // the render context, so measuring cannot disturb a frame).
  const measureCtxRef = useRef<CanvasRenderingContext2D | null>(null);
  const toolRef = useRef(activeTool);
  toolRef.current = activeTool;
  const stickyRef = useRef(stickyTool);
  stickyRef.current = stickyTool;
  const onToolChangeRef = useRef(onToolChange);
  onToolChangeRef.current = onToolChange;
  const [menu, setMenu] = useState<ContextMenuState | null>(null);
  const { t } = useI18n();
  const { resolved } = useTheme();
  const canvasBackground = themeTokens[resolved].colors.canvasBg;
  const canvasBackgroundRef = useRef(canvasBackground);
  canvasBackgroundRef.current = canvasBackground;
  const { notify } = useToast();
  const tRef = useRef(t);
  tRef.current = t;
  const commandContextRef = useRef(commandContext);
  commandContextRef.current = commandContext;
  const onFrameRef = useRef(onFrame);
  onFrameRef.current = onFrame;
  const onRenderErrorRef = useRef(onRenderError);
  onRenderErrorRef.current = onRenderError;
  const lastEmitRef = useRef<{ time: number; key: string }>({ time: 0, key: '' });
  const pendingFrameRef = useRef<FrameSnapshot | null>(null);
  const failCountRef = useRef(0);
  const errorReportedRef = useRef(false);
  const [zoomLabel, setZoomLabel] = useState('100%');
  const zoomLabelRef = useRef('100%');
  // Visible text overlay, driven by engine `textEditing` (id changes only).
  const [editingId, setEditingId] = useState<string | null>(null);
  const editingIdRef = useRef<string | null>(null);
  editingIdRef.current = editingId;
  // Last user-driven caret motion: the mirror must not snap the caret back
  // while its sync is still traveling to the engine, or arrows and clicks
  // freeze wherever a stale frame left them.
  const lastUserCaretAtRef = useRef(0);
  // Set once the user acts inside the overlay, so focus retries stop
  // re-placing a stale caret over live motion.
  const focusSettledRef = useRef(false);

  useEffect(() => {
    if (!editingId) return;
    focusSettledRef.current = false;
    // Focus can lose to a re-render or a late pointer-up: retry across a
    // few frames until the overlay owns focus, the user acts, or the
    // session ends, so a single click always leaves a blinking caret behind.
    let attempts = 0;
    let frame = 0;
    const focusSoon = () => {
      if (editingIdRef.current !== editingId || focusSettledRef.current) return;
      const textarea = textAreaRef.current;
      if (!textarea) return;
      textarea.focus();
      const caret = Math.min(
        frameRef.current?.session.textEditing?.caret ?? 0,
        textarea.value.length,
      );
      try {
        textarea.setSelectionRange(caret, caret);
      } catch {
        // Hidden or detached textarea: ignore.
      }
      attempts += 1;
      if (document.activeElement !== textarea && attempts < 3) {
        frame = requestAnimationFrame(focusSoon);
      }
    };
    frame = requestAnimationFrame(focusSoon);
    return () => cancelAnimationFrame(frame);
  }, [editingId]);

  const sendBatch = useCallback(async (ops: unknown[]): Promise<string> => {
    // Serialize input batches through a chain: rapid pointer moves must
    // reach the engine in DOM order (Tauri invokes otherwise race on the
    // thread pool). Read-only frame queries bypass the chain.
    // Every input potentially dirties engine state, so the watcher wakes
    // for exactly one fresh frame instead of polling on a timer.
    inputGenRef.current += 1;
    needsPollRef.current = true;
    kickRef.current();
    const work = chainRef.current.then(() => engine.sendBatch(ops));
    chainRef.current = work.then(() => undefined, () => undefined);
    return work;
  }, [engine]);

  function parseBatch(raw: string) {
    try {
      return parseBatchResult(raw);
    } catch {
      return null;
    }
  }

  // Gesture identity for exactly-once draw commits: stable for the press,
  // unique across presses, so engine-side deduplication can tell a retry
  // apart from a new gesture.
  function mintRequestId(): string {
    const cryptoObj = typeof globalThis.crypto?.randomUUID === 'function'
      ? globalThis.crypto
      : undefined;
    if (cryptoObj) {
      try {
        return cryptoObj.randomUUID();
      } catch {
        // Non-secure contexts reject: fall through to the local fallback.
      }
    }
    return `draw-${Date.now().toString(36)}-${Math.floor(Math.random() * 0xffffffff).toString(36)}`;
  }

  function statusModelKey(session: SessionStateDto): string {
    // Everything that can change the committed picture: content (nonce),
    // selection overlay, culled region, edited element, asset pixels.
    // Draft text and caret are deliberately absent: the canvas skips the
    // editing entry, so typing must never repaint it.
    return JSON.stringify([
      session.sceneNonce,
      session.selection,
      Math.round(session.viewport.scrollX * 10) / 10,
      Math.round(session.viewport.scrollY * 10) / 10,
      Math.round(session.viewport.zoom * 1000) / 1000,
      session.textEditing?.id ?? null,
      session.assetGeneration,
    ]);
  }

  function frameKey(snapshot: FrameSnapshot): string {
    const session = snapshot.session;
    const childCount = snapshot.model.frames.reduce((sum, pass) => sum + pass.children.length, 0);
    return JSON.stringify([
      session.sceneNonce,
      session.selection,
      session.tool,
      Math.round(session.viewport.scrollX * 10) / 10,
      Math.round(session.viewport.scrollY * 10) / 10,
      Math.round(session.viewport.zoom * 1000) / 1000,
      session.canUndo,
      session.canRedo,
      snapshot.model.base.length,
      snapshot.model.frames.length,
      childCount,
      session.textEditing?.id ?? null,
    ]);
  }

  // Panels and chrome mirror engine state without their own polling: the
  // canvas already crosses once per frame, so it forwards snapshots whose
  // visible state changed, throttled to keep React renders off the pointer path.
  // Throttled-but-changed snapshots are never dropped: one trailing flush
  // delivers the latest state when the window passes, so discrete clicks
  // always land instead of stalling until the next mutation.
  const trailingEmitRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const maybeEmitFrame = useCallback((snapshot: FrameSnapshot, force: boolean) => {
    const now = Date.now();
    const key = frameKey(snapshot);
    if (!force && key === lastEmitRef.current.key) {
      lastEmitRef.current = { time: now, key };
      return;
    }
    // Throttle first: the key stringifies the whole selection, so building
    // it every frame would cost more than the renders it guards.
    if (!force && now - lastEmitRef.current.time < DESKTOP_TIMING.frameMirrorThrottleMs) {
      trailingEmitRef.current ??= setTimeout(() => {
        trailingEmitRef.current = null;
        const latest = pendingFrameRef.current;
        pendingFrameRef.current = null;
        if (latest && frameKey(latest) !== lastEmitRef.current.key) {
          lastEmitRef.current = { time: Date.now(), key: frameKey(latest) };
          onFrameRef.current?.(latest);
        }
      }, DESKTOP_TIMING.frameMirrorThrottleMs - (now - lastEmitRef.current.time));
      pendingFrameRef.current = snapshot;
      return;
    }
    lastEmitRef.current = { time: now, key };
    onFrameRef.current?.(snapshot);
  }, []);

  function syncChrome(snapshot: FrameSnapshot) {
    const label = `${Math.round(snapshot.session.viewport.zoom * 100)}%`;
    if (label !== zoomLabelRef.current) {
      zoomLabelRef.current = label;
      setZoomLabel(label);
    }
  }

  function reportRenderError() {
    if (errorReportedRef.current) return;
    errorReportedRef.current = true;
    onRenderErrorRef.current?.();
  }

  async function applyViewport(viewport: { scrollX: number; scrollY: number; zoom: number }) {
    await sendBatch([{ op: 'setViewport', ...viewport }]);
  }

  const zoomStep = useCallback(async (factor: number) => {
    const session = frameRef.current?.session;
    if (!session) return;
    const { width, height } = sizeRef.current;
    if (!(width > 0 && height > 0)) return;
    await applyViewport(zoomViewport(session.viewport, factor, width / 2, height / 2));
  }, [sendBatch]);

  const resetZoom = useCallback(async () => {
    const session = frameRef.current?.session;
    if (!session || session.viewport.zoom === 1) return;
    const { width, height } = sizeRef.current;
    if (!(width > 0 && height > 0)) return;
    await applyViewport(zoomViewport(session.viewport, 1 / session.viewport.zoom, width / 2, height / 2));
  }, [sendBatch]);

  // Fit through the engine op so bounds come from the full document,
  // never the viewport-culled frame model (culled content would fit to
  // nothing or to a partial box). Padding mirrors the host fit helper:
  // 48 screen px expressed in scene units at the current zoom.
  const fitContent = useCallback(async () => {
    const { width, height } = sizeRef.current;
    if (!(width > 0 && height > 0)) return;
    const zoom = frameRef.current?.session.viewport.zoom ?? 1;
    await sendBatch([{
      op: 'fitViewport',
      canvasWidth: width,
      canvasHeight: height,
      padding: 48 / Math.max(zoom, 0.1),
    }]);
  }, [sendBatch]);

  const fitSelection = useCallback(async () => {
    const selection = frameRef.current?.session.selection;
    if (!selection || selection.length === 0) return;
    const { width, height } = sizeRef.current;
    if (!(width > 0 && height > 0)) return;
    const zoom = frameRef.current?.session.viewport.zoom ?? 1;
    await sendBatch([{
      op: 'fitViewport',
      canvasWidth: width,
      canvasHeight: height,
      padding: 48 / Math.max(zoom, 0.1),
      ids: [...selection],
    }]);
  }, [sendBatch]);

  // Frame watcher: demand-driven fetches only. The loop below sleeps while
  // clean and wakes through kick() — every mutation crosses a sender that
  // marks dirty first, so idle canvases cost zero crossings.
  const needsPollRef = useRef(true);
  const kickRef = useRef<() => void>(() => undefined);
  // refreshFrame is the watcher kick for host-driven mutations (panels,
  // menus, palette): it marks the loop dirty so one fresh frame follows.
  const refreshFrame = useCallback(() => {
    needsPollRef.current = true;
    kickRef.current();
  }, []);
  const onViewActionsRef = useRef(onViewActions);
  onViewActionsRef.current = onViewActions;
  useEffect(() => {
    onViewActionsRef.current?.({ zoomStep, resetZoom, fitContent, fitSelection, refreshFrame });
    return () => onViewActionsRef.current?.(null);
  }, [zoomStep, resetZoom, fitContent, fitSelection, refreshFrame]);

  const lastModelKeyRef = useRef<string | null>(null);
  const lastPaintKeyRef = useRef<string | null>(null);
  // Coalesced wheel deltas, flushed once per frame (see onWheelNative).
  const wheelAccumRef = useRef<{ dx: number; dy: number; zoomGesture: boolean; x: number; y: number } | null>(null);
  // Overlay caches, keyed to avoid per-frame layout work (see positionTextArea).
  const entryCacheRef = useRef<{ model: RenderModelDto | null; id: string; entry: TextEntryBounds | null }>({
    model: null,
    id: '',
    entry: null,
  });
  const overlayStyleKeyRef = useRef<string | null>(null);


  // Transient overlays never touch the document: assign through these so
  // the paint key notices every preview change. Every assignment also
  // wakes the watcher for a paint-only pass (the fetch gate stays closed,
  // so no crossing follows): without it, draw ghosts would never appear
  // while the loop sleeps between inputs.
  function setGhost(ghost: GhostPreview): void {
    ghostRef.current = ghost;
    paintTickRef.current += 1;
    kickRef.current();
  }

  function setGuides(guides: SnapGuideDto[] | null): void {
    guidesRef.current = guides;
    paintTickRef.current += 1;
    kickRef.current();
  }

  // -- tool switching -------------------------------------------------------

  useEffect(() => {
    // New text contrasts with the canvas behind it, so the theme travels in
    // the same batch: later ops observe it and defaults never lag a switch.
    const configure = { op: 'configure', theme: { colors: { canvasBackground } } };
    sendBatch([configure, { op: 'setTool', tool: activeTool }]);
    setCursor(
      activeTool === 'select'
        ? 'var(--cursor-select)'
        : activeTool === 'text'
          ? 'var(--cursor-text)'
          : 'var(--cursor-draw)',
    );
    // A tool switch cancels gestures/sessions engine-side; drop host ghosts.
    ghostRef.current = NO_PREVIEW;
    guidesRef.current = null;
    paintTickRef.current += 1;
    trailRef.current = [];
    pressOriginRef.current = null;
    pressSessionRef.current = null;
    pressActiveRef.current = false;
    pressRequestRef.current = null;
  }, [activeTool, canvasBackground, engine, sendBatch]);

  // -- frame loop: small session poll per tick, model + paint on dirty ----

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let cssWidth = 0;
    let cssHeight = 0;

    function resize() {
      if (!canvas || !ctx || !container) return;
      const rect = container.getBoundingClientRect();
      if (!rect) return;
      cssWidth = rect.width;
      cssHeight = rect.height;
      sizeRef.current = { width: rect.width, height: rect.height };
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.max(1, Math.round(rect.width * dpr));
      canvas.height = Math.max(1, Math.round(rect.height * dpr));
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    resize();
    const onResize = () => {
      resize();
      kick();
    };
    window.addEventListener('resize', onResize);
    // A hidden tab keeps its last pixels: skip work while hidden and
    // re-measure on return (the size may have changed underneath us).
    const onVisibility = () => {
      if (!document.hidden) {
        resize();
        kick();
      }
    };
    document.addEventListener('visibilitychange', onVisibility);

    // Native wheel listener so preventDefault works (React attaches wheel
    // as passive and warns). Deltas accumulate and flush once per frame: a
    // smooth-scroll burst otherwise crosses once per event. Zoom/pan math
    // stays engine-side.
    async function onWheelNative(e: WheelEvent) {
      e.preventDefault();
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const zoomGesture = e.ctrlKey || e.metaKey;
      const accum = wheelAccumRef.current;
      if (accum && accum.zoomGesture === zoomGesture) {
        accum.dx += e.deltaX;
        accum.dy += e.deltaY;
        accum.x = x;
        accum.y = y;
      } else {
        // A mode switch flushes first so a zoom never swallows a pan.
        await flushWheel();
        wheelAccumRef.current = { dx: e.deltaX, dy: e.deltaY, zoomGesture, x, y };
      }
      needsPollRef.current = true;
      kickRef.current();
    }
    canvas.addEventListener('wheel', onWheelNative, { passive: false });

    async function flushWheel(): Promise<void> {
      const pending = wheelAccumRef.current;
      wheelAccumRef.current = null;
      if (!pending) return;
      await sendBatch([{
        op: 'wheel',
        dx: pending.dx,
        dy: pending.dy,
        zoomGesture: pending.zoomGesture,
        x: pending.x,
        y: pending.y,
      }]);
    }

    let alive = true;
    let inFlight = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    // Watcher kick: schedule one loop iteration when none is running. The
    // loop sleeps while clean, so idle canvases cost zero crossings.
    function kick() {
      if (alive && rafRef.current === null) {
        rafRef.current = requestAnimationFrame(frame);
      }
    }
    kickRef.current = kick;

    async function frame() {
      rafRef.current = null;
      if (!alive) return;
      const due = needsPollRef.current;
      if (!inFlight && cssWidth > 0 && cssHeight > 0 && !document.hidden && due) {
        inFlight = true;
        needsPollRef.current = false;
        const genAtStart = inputGenRef.current;
        try {
          // The wheel accumulator flushes first so the poll below observes
          // the post-scroll state in the same frame.
          await flushWheel();
          // One small crossing per poll (session snapshot, now carrying the
          // scene nonce); the full model only follows when something
          // paint-relevant changed. Idle frames, caret moves, and draft
          // typing therefore stay cheap no matter how large the scene grows.
          const session = await engine.getSessionState();
          if (alive) {
            // An input landed mid-fetch, so this snapshot predates it. Leave
            // the synchronously adopted session alone and refetch fresh
            // instead of painting the stale phase over the live press.
            if (genAtStart !== inputGenRef.current) {
              needsPollRef.current = true;
            } else {
              pressSessionRef.current = session;
              failCountRef.current = 0;
              const modelKey = statusModelKey(session);
              if (modelKey !== lastModelKeyRef.current) {
                lastModelKeyRef.current = modelKey;
                const snapshot = await engine.getFrame(cssWidth, cssHeight);
                if (snapshot && alive) {
                  if (genAtStart !== inputGenRef.current) {
                    needsPollRef.current = true;
                  } else {
                    frameRef.current = snapshot;
                    pressSessionRef.current = snapshot.session;
                    syncTextOverlay(snapshot);
                    maybeEmitFrame(snapshot, false);
                    syncChrome(snapshot);
                  }
                }
              } else if (frameRef.current) {
                frameRef.current = { ...frameRef.current, session };
                const live = frameRef.current;
                syncTextOverlay(live);
                maybeEmitFrame(live, false);
                syncChrome(live);
              }
            }
          }
        } catch {
          // Transport hiccup: keep the last frame and retry once after a
          // beat. A long outage surfaces once as a recoverable error
          // instead of a silently frozen canvas.
          failCountRef.current += 1;
          if (failCountRef.current >= 300) {
            reportRenderError();
          } else if (retryTimer === null) {
            retryTimer = setTimeout(() => {
              retryTimer = null;
              needsPollRef.current = true;
              kick();
            }, RETRY_POLL_MS);
          }
        } finally {
          inFlight = false;
        }
      }
      if (!canvas || !ctx || !alive) return;
      const snapshot = frameRef.current;
      if (snapshot) {
        positionTextArea(snapshot);
        // A fill preview never coincides with a canvas gesture (opening the
        // color popover requires no press, and any press outside closes it),
        // so it rides the gesture ghost slot instead of a second overlay.
        const fillPreview = fillPreviewRef.current;
        const ghost: GhostPreview =
          fillPreview && ghostRef.current.kind === 'none'
            ? { kind: 'fill', ids: fillPreview.ids, paint: fillPreview.paint }
            : ghostRef.current;
        // Caret moves, draft typing, and panel-only changes leave this key
        // untouched, so the canvas is not repainted for them.
        const paintKey = JSON.stringify([
          lastModelKeyRef.current,
          paintTickRef.current,
          fillPreview,
          cssWidth,
          cssHeight,
        ]);
        if (paintKey !== lastPaintKeyRef.current) {
          lastPaintKeyRef.current = paintKey;
          try {
            drawRenderModel(
              ctx,
              snapshot.model,
              cssWidth,
              cssHeight,
              ghost,
              editingIdRef.current,
              guidesRef.current,
              isSingleTextSelection(snapshot),
            );
            paintCanvasBounds(ctx, snapshot, cssWidth, cssHeight);
          } catch {
            reportRenderError();
          }
        }
      } else {
        ctx.clearRect(0, 0, cssWidth, cssHeight);
      }
      // Continue only while fresh work arrived mid-frame; otherwise the
      // watcher sleeps until the next input, resize, or refresh request.
      if (needsPollRef.current) {
        kick();
      }
    }

    function syncTextOverlay(snapshot: FrameSnapshot) {
      const id = snapshot.session.textEditing?.id ?? null;
      if (id !== null) {
        nullStreakRef.current = 0;
        const expected = expectSessionRef.current;
        // A stale frame can still carry the previous session while the new
        // one is on its way: only adopt what we wait for (or anything when
        // we wait for nothing, e.g. extension-started sessions), and never
        // override a locally known different id.
        if (editingIdRef.current === null && (expected === null || id === expected)) {
          expectSessionRef.current = null;
          pendingRef.current = null;
          setEditingId(id);
        } else if (id === expected) {
          expectSessionRef.current = null;
        }
        return;
      }
      // Frame queries bypass the input chain, so a frame sent before a
      // press can resolve after it with no session. Only a sustained run
      // of session-less frames ends a locally known session; genuine ends
      // already clear it synchronously in their handlers.
      if (editingIdRef.current !== null) {
        nullStreakRef.current += 1;
        if (nullStreakRef.current >= 3) {
          nullStreakRef.current = 0;
          expectSessionRef.current = null;
          pendingRef.current = null;
          setEditingId(null);
        }
      } else {
        nullStreakRef.current = 0;
      }
    }

    function positionTextArea(snapshot: FrameSnapshot) {
      const ta = textAreaRef.current;
      const textState = snapshot.session.textEditing;
      if (!ta || !textState) return;
      // One lookup per model, not per frame: the entry cannot move without
      // a model refetch (identity-keyed).
      const cached = entryCacheRef.current;
      let entry: TextEntryBounds | null;
      if (cached.model === snapshot.model && cached.id === textState.id) {
        entry = cached.entry;
      } else {
        entry = findEntryBounds(snapshot.model, textState.id);
        entryCacheRef.current = { model: snapshot.model, id: textState.id, entry };
      }
      if (!entry) {
        // Panned or zoomed away from the element under edit: park the
        // overlay instead of leaving it at a stale position.
        ta.style.display = 'none';
        overlayStyleKeyRef.current = null;
        return;
      }
      const viewport = snapshot.session.viewport;
      const fontSizePx = entry.fontSize * viewport.zoom;
      const lineHeightPx = fontSizePx * 1.25;
      const draft = textState.draft;
      const lineCount = Math.max(1, draft.split('\n').length);
      // Size from shaped metrics, never from layout reads: scrollWidth
      // forces a synchronous layout on every frame while typing.
      const width = Math.max(entry.width * viewport.zoom, measureDraftWidth(entry, draft, fontSizePx) + fontSizePx * 0.5, 1);
      const height = Math.max(lineHeightPx * lineCount, 1);
      // Anchor the growth by alignment so the overlay and the commit share
      // a center/right edge: left grows rightward, center grows both ways,
      // right grows leftward. Otherwise centered text visibly jumps when
      // the committed box narrows to the content.
      const widthScene = width / viewport.zoom;
      const leftScene =
        entry.textAlign === 'center'
          ? entry.x + entry.width / 2 - widthScene / 2
          : entry.textAlign === 'right'
            ? entry.x + entry.width - widthScene
            : entry.x;
      const [sx, sy] = sceneToScreen([leftScene, entry.y], viewport);
      const displayColor = legibleTextColor(entry.strokeColor, canvasBackgroundRef.current);
      // Rounded style key: identical frames skip every DOM write below.
      const key = JSON.stringify([
        Math.round(sx * 10) / 10,
        Math.round(sy * 10) / 10,
        Math.round(fontSizePx * 100) / 100,
        Math.round(width * 10) / 10,
        Math.round(height * 10) / 10,
        entry.fontFamily,
        displayColor,
        entry.textAlign,
      ]);
      if (key !== overlayStyleKeyRef.current) {
        overlayStyleKeyRef.current = key;
        ta.style.display = 'block';
        ta.style.left = `${sx}px`;
        // Lift by half the leading: the canvas draws from the em-box top
        // while the textarea's first baseline sits half-leading plus ascent
        // below its top, so without this the overlay reads low and the
        // commit visibly jumps up. Same font on both sides keeps it exact.
        ta.style.top = `${sy - (lineHeightPx - fontSizePx) / 2}px`;
        ta.style.fontSize = `${fontSizePx}px`;
        // Same stack as the canvas fill (`drawTextKind`): the engine font
        // name first, system sans as fallback so a missing handwriting
        // font never renders blank.
        ta.style.fontFamily = `${entry.fontFamily}, sans-serif`;
        // Display-only safety net: the committed color normally contrasts by
        // construction, but an older element may not, and typing must stay
        // visible regardless. Committed rendering keeps the stored color.
        ta.style.color = displayColor;
        ta.style.caretColor = displayColor;
        ta.style.textAlign = entry.textAlign;
        ta.style.lineHeight = `${lineHeightPx}px`;
        ta.style.width = `${width}px`;
        ta.style.height = `${height}px`;
      }
      // The engine draft acknowledges our optimistic sends: once it catches
      // up, normal mirroring resumes. Until then the native value leads and
      // must not be clobbered, or rapid input visibly stutters.
      const pending = pendingRef.current;
      if (pending !== null && textState.draft === pending.value) {
        pendingRef.current = null;
      }
      // Engine is authoritative for draft + caret: mirror without fighting
      // the user's in-progress composition or unacknowledged input.
      if (!composingRef.current && pendingRef.current === null && ta.value !== textState.draft) {
        ta.value = textState.draft;
      }
      if (document.activeElement === ta && !composingRef.current) {
        const caret = Math.min(textState.caret, ta.value.length);
        // User motion wins for a beat after it happens: its sync may still
        // be traveling while a stale frame arrives, and snapping back would
        // freeze the caret wherever the stale frame left it.
        const freshMotion = Date.now() - lastUserCaretAtRef.current < USER_CARET_GRACE_MS;
        if (!freshMotion && (ta.selectionStart !== caret || ta.selectionEnd !== caret)) {
          try {
            ta.setSelectionRange(caret, caret);
          } catch {
            // Hidden or detached textarea: ignore.
          }
        }
      }
    }

    // Widest shaped line for overlay auto-grow: pure canvas math, never a
    // layout read, so sizing costs nothing while typing.
    function measureDraftWidth(entry: TextEntryBounds, draft: string, fontSizePx: number): number {
      let measureCtx = measureCtxRef.current;
      if (!measureCtx) {
        if (typeof document === 'undefined') return 0;
        const probe = document.createElement('canvas').getContext('2d');
        if (!probe) return 0;
        measureCtxRef.current = probe;
        measureCtx = probe;
      }
      const measure: CanvasRenderingContext2D = measureCtx;
      measure.font = `${fontSizePx}px ${entry.fontFamily}, sans-serif`;
      let max = 0;
      for (const line of draft.split('\n')) {
        const w = measure.measureText(line).width;
        if (w > max) max = w;
      }
      return max;
    }

    // First paint goes through the watcher like every other frame.
    kick();

    return () => {
      alive = false;
      kickRef.current = () => undefined;
      window.removeEventListener('resize', onResize);
      document.removeEventListener('visibilitychange', onVisibility);
      canvas.removeEventListener('wheel', onWheelNative);
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      if (retryTimer !== null) {
        clearTimeout(retryTimer);
      }
      if (trailingEmitRef.current !== null) {
        clearTimeout(trailingEmitRef.current);
        trailingEmitRef.current = null;
      }
      pendingFrameRef.current = null;
    };
  }, [engine, maybeEmitFrame]);

  // -- helpers ---------------------------------------------------------------

  const getPos = (e: React.PointerEvent | React.MouseEvent): [number, number] => {
    const canvas = canvasRef.current;
    if (!canvas) return [0, 0];
    const rect = canvas.getBoundingClientRect();
    return [e.clientX - rect.left, e.clientY - rect.top];
  };

  const getModifiers = (e: React.PointerEvent | React.KeyboardEvent) => ({
    shift: e.shiftKey,
    alt: e.altKey,
    ctrlOrCmd: e.ctrlKey || e.metaKey,
  });

  function sceneOf(pos: [number, number]): [number, number] {
    const session = frameRef.current?.session;
    const viewport = session?.viewport ?? { scrollX: 0, scrollY: 0, zoom: 1 };
    return screenToScene(pos, viewport);
  }

  function hasElementAt(scene: [number, number]): boolean {
    const snapshot = frameRef.current;
    if (!snapshot) return false;
    const entries = [
      ...snapshot.model.base,
      ...snapshot.model.frames.flatMap((pass) => [pass.frame, ...pass.children]),
    ];
    return entries.some(
      (entry) =>
        scene[0] >= entry.bounds.minX &&
        scene[0] <= entry.bounds.maxX &&
        scene[1] >= entry.bounds.minY &&
        scene[1] <= entry.bounds.maxY,
    );
  }

  function setCursor(cursor: string): void {
    const canvas = canvasRef.current;
    if (canvas && canvas.style.cursor !== cursor) canvas.style.cursor = cursor;
  }

  function updateCursor(pos?: [number, number]): void {
    const snapshot = frameRef.current;
    const phase = snapshot?.session.pointerPhase;
    const kind = phase?.kind;
    // Real drags: a held hand for moves and pans, the matching cursor for
    // resize and rotate drags, the default arrow for draw/marquee gestures.
    if (kind === 'dragging' || kind === 'panning') {
      setCursor('var(--cursor-grabbing)');
      return;
    }
    if (kind === 'draggingResize') {
      setCursor((phase?.handle && cursorForResizeHandle(phase.handle)) || 'var(--cursor-grabbing)');
      return;
    }
    if (kind === 'draggingRotate') {
      setCursor(ROTATE_CURSOR);
      return;
    }
    if (kind === 'drawing' || kind === 'rubberBand') {
      setCursor('var(--cursor-select)');
      return;
    }
    // A press held still on an object becomes a held hand (long-press).
    if (longPressRef.current) {
      setCursor('var(--cursor-grabbing)');
      return;
    }
    if (activeTool === 'text') {
      setCursor('var(--cursor-text)');
      return;
    }
    if (DRAW_CURSOR_TOOLS.has(activeTool)) {
      setCursor('var(--cursor-draw)');
      return;
    }
    if (pos && snapshot && activeTool === 'select') {
      const handle = selectionHandleCursor(
        snapshot.model,
        snapshot.session.viewport,
        pos,
        isSingleTextSelection(snapshot),
      );
      if (handle) {
        setCursor(handle);
        return;
      }
    }
    if (pos && hasElementAt(sceneOf(pos))) {
      setCursor('var(--cursor-pointer)');
      return;
    }
    setCursor('var(--cursor-select)');
  }

  // -- pointer ---------------------------------------------------------------

  // One-shot contrast repair for a fresh text element: when the creation
  // default raced a theme sync, the provisional stroke may be unreadable.
  // Correcting it now joins the still-open creation transaction, so typing
  // and the commit share one visible color and one undo entry. Only empty
  // drafts qualify, so elements carrying content keep their colors.
  const healFreshTextContrast = useCallback(async (id: string) => {
    try {
      const { width, height } = sizeRef.current;
      if (!(width > 0 && height > 0)) return;
      const raw = await sendBatch([{ op: 'renderModel', canvasWidth: width, canvasHeight: height }]);
      const batch = parseBatch(raw);
      const model = batch
        ? (lastResultData(batch, 'renderModel') as RenderModelDto | undefined)
        : undefined;
      const entry = model ? findModelEntry(model, id) : null;
      if (!entry || entry.detail.type !== 'text' || entry.detail.text !== '') return;
      const canvasBackground = canvasBackgroundRef.current;
      if (!hasPoorContrast(entry.strokeColor, canvasBackground)) return;
      await sendBatch([{
        op: 'setStyle',
        ids: [id],
        patch: { strokeColor: contrastingTextColor(canvasBackground) },
      }]);
    } catch {
      // The overlay safety net keeps typing visible; the next frame covers it.
    }
  }, [sendBatch]);

  // Pixel-exact click-to-caret for reopened text: shape the clicked line
  // with the committed font on a private context and put the caret on the
  // nearest shaped boundary. The engine estimate stays the headless
  // fallback; this only overrides it where native metrics exist.
  const refineTextCaret = useCallback(async (id: string, scene: [number, number]) => {
    try {
      const model = frameRef.current?.model;
      const entry = model ? findModelEntry(model, id) : null;
      if (!entry || entry.detail.type !== 'text' || entry.detail.text === '') return;
      let measureCtx = measureCtxRef.current;
      if (!measureCtx) {
        if (typeof document === 'undefined') return;
        const probe = document.createElement('canvas').getContext('2d');
        if (!probe) return;
        measureCtxRef.current = probe;
        measureCtx = probe;
      }
      const measure: CanvasRenderingContext2D = measureCtx;
      const { fontSize, fontFamily, text } = entry.detail;
      measure.font = `${fontSize}px ${fontFamily}, sans-serif`;
      const lines = text.split('\n');
      const frame = entry.frame ?? entry.bounds;
      const row = lineRowForY(scene[1] - frame.minY, fontSize * 1.25, lines.length);
      const caret = caretIndexAt(lines, row, scene[0] - frame.minX, (s) => measure.measureText(s).width);
      await sendBatch([{ op: 'textSetCaret', caret }]);
    } catch {
      // The engine estimate stands.
    }
  }, [sendBatch]);

  const handlePointerDown = useCallback(async (e: React.PointerEvent) => {
    setMenu(null);
    canvasRef.current?.focus();
    const now = Date.now();
    const timeSinceLastClick = now - lastClickTimeRef.current;
    clickCountRef.current = timeSinceLastClick < 400 ? clickCountRef.current + 1 : 1;
    lastClickTimeRef.current = now;

    const pos = getPos(e);
    updateCursor(pos);
    cursorRef.current = pos;
    const button = e.button === 2 ? 'right' : e.button === 1 ? 'middle' : 'left';

    const ops: unknown[] = [];
    // A left draw press declares its own tool first: batch ops apply
    // sequentially in one crossing, so the press always observes the tool
    // the host shows even when an earlier tool switch raced engine creation,
    // remounts, or slow transport. Without this a press can land on a stale
    // Select while the toolbar shows a draw tool, and the release silently
    // becomes a rubber band instead of a shape. Other buttons never capture
    // a draw press engine-side, and select/text presses skip this to keep
    // their paths (and the text outside-click flow) exactly as before.
    if (button === 'left' && (DRAW_TOOLS.has(toolRef.current) || toolRef.current === 'freedraw')) {
      ops.push({ op: 'setTool', tool: toolRef.current });
    }
    if (toolRef.current === 'text') {
      // The default stroke contrasts with the canvas behind the click, so
      // the theme travels in the same batch: the press observes it and a
      // fresh session can never be tinted by a stale theme.
      ops.push({ op: 'configure', theme: { colors: { canvasBackground: canvasBackgroundRef.current } } });
    }
    ops.push({
      op: 'pointerDown',
      x: pos[0], y: pos[1], button,
      modifiers: getModifiers(e),
      clickCount: clickCountRef.current,
    });
    pressToolRef.current = toolRef.current;
    pressRequestRef.current = mintRequestId();
    // Read the session back in the same batch (mirroring pointerUp): move
    // handling gates on the host-known phase, so the press must be adopted
    // synchronously instead of waiting for the next watcher fetch.
    ops.push({ op: 'sessionState' });
    const raw = await sendBatch(ops);
    const batch = parseBatch(raw);
    const outcome = batch ? (lastResultData(batch, 'pointerDown') as {
      hit?: string | null; beganTextEdit?: string | null; beganTextEditNew?: boolean | null; committedText?: boolean;
    } | undefined) : undefined;
    const pressSession = batch
      ? (lastResultData(batch, 'sessionState') as SessionStateDto | undefined)
      : undefined;
    // Keep the press origin beside the adopted session: previews use it while
    // the watcher still reports the previous phase, and the watcher never
    // overwrites it with a stale fetch (generation guard in the frame loop).
    pressOriginRef.current = sceneOf(pos);
    if (pressSession) {
      pressSessionRef.current = pressSession;
      if (frameRef.current) {
        frameRef.current = { ...frameRef.current, session: pressSession };
        maybeEmitFrame(frameRef.current, true);
      }
    }
    const beganId = outcome?.beganTextEdit ?? null;
    const beganNew = outcome?.beganTextEditNew ?? null;
    if (toolRef.current === 'text' && beganId && beganNew === true && outcome?.committedText) {
      // Text-tool outside-click finish: the press committed the previous
      // draft and opened a fresh placeholder. Discard that placeholder,
      // then re-select the committed text so its box and handles appear;
      // the tool returns to Select. Selecting an id the engine just
      // deleted is harmless: it paints no overlay and panels normalize
      // stale ids away.
      const priorId = editingIdRef.current;
      await sendBatch([{ op: 'cancelText' }]);
      // Drop the canvas skip synchronously so the committed text paints on
      // the very next frame instead of blinking out for a render.
      editingIdRef.current = null;
      expectSessionRef.current = null;
      pendingRef.current = null;
      setEditingId(null);
      if (priorId) {
        await sendBatch([{ op: 'select', ids: [priorId] }]);
      }
      if (!stickyRef.current) onToolChangeRef.current?.('select');
      clearTransient();
      activePointerRef.current = null;
      updateCursor(pos);
      return;
    }
    if (beganId) {
      // A new session to edit: a fresh caret on empty canvas, the existing
      // text under the cursor with the text tool (single and double click
      // behave the same there), or a double-clicked text with Select.
      expectSessionRef.current = beganId;
      setEditingId(beganId);
      if (toolRef.current === 'text') {
        void healFreshTextContrast(beganId);
      }
      if (beganNew === false) {
        // Reopened content: refine the estimated caret to the shaped
        // boundary nearest the press.
        void refineTextCaret(beganId, sceneOf(pos));
      }
    } else if (outcome?.committedText) {
      editingIdRef.current = null;
      expectSessionRef.current = null;
      pendingRef.current = null;
      setEditingId(null);
    }
    if (activeTool === 'select' && button === 'left' && outcome?.hit) {
      // A press held still on an object becomes the held hand; any drag,
      // release, or cancel below takes over first.
      if (longPressTimerRef.current !== null) clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = setTimeout(() => {
        longPressTimerRef.current = null;
        longPressRef.current = true;
        updateCursor(cursorRef.current ?? undefined);
      }, 500);
    }

    // Freedraw accumulates its own display trail from the press origin.
    if (toolRef.current === 'freedraw' && button === 'left') {
      trailRef.current = [sceneOf(pos)];
    }

    activePointerRef.current = e.pointerId;
    pressActiveRef.current = true;
    try {
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    } catch {
      // Mouse input may not support capture in all browsers: the gesture
      // still works, only out-of-window tracking degrades.
    }
  }, [sendBatch, healFreshTextContrast, refineTextCaret]);

  const handlePointerMove = useCallback(async (e: React.PointerEvent) => {
    const pos = getPos(e);
    updateCursor(pos);
    cursorRef.current = pos;
    const scene = sceneOf(pos);
    const modifiers = getModifiers(e);
    const session = frameRef.current?.session ?? pressSessionRef.current;
    const phase = session?.pointerPhase;
    // A press held locally is authoritative while the watcher catches up:
    // its moves must reach the engine even when the last fetched phase still
    // reads idle, otherwise the engine never crosses the drag threshold and
    // the release commits nothing. Idle hover (no press held) still skips
    // the crossing entirely.
    const pointerHeld = activePointerRef.current !== null;
    if (!phase || phase.kind === 'idle') {
      if (!pointerHeld) return;
    }
    const origin = (phase?.originScene as [number, number] | undefined)
      ?? pressOriginRef.current
      ?? undefined;

    // A started drag takes over from a pending long-press.
    if (phase?.kind !== 'pressed' && longPressTimerRef.current !== null) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }

    const ops: unknown[] = [{
      op: 'pointerMove',
      x: pos[0], y: pos[1],
      modifiers,
    }];

    // Choose the read-only preview query from the last-known phase (one
    // frame stale at most). Failures are ignored: the preview is a hint,
    // the commit path stays authoritative. While the watcher still reports
    // the previous phase, a held press with a draw tool still paints a
    // local ghost from the press origin; the engine commit stays the only
    // writer, on release.
    let previewKind: GhostPreview['kind'] = 'none';
    const pressKind = phase?.kind;
    if (origin && (pressKind === 'drawing' || pressKind === 'pressed' || (!pressKind && pointerHeld))) {
      const tool = toolRef.current;
      if (DRAW_TOOLS.has(tool)) {
        previewKind = 'draw';
        setGhost({ kind: 'draw', shape: tool, origin, cursor: scene });
      } else if (tool === 'freedraw') {
        const trail = trailRef.current;
        const last = trail[trail.length - 1];
        if (!last || last[0] !== scene[0] || last[1] !== scene[1]) {
          trail.push(scene);
        }
        setGhost({ kind: 'freedraw', trail: [...trail] });
      }
    }
    if (phase && origin) {
      if (pressKind === 'drawing' || pressKind === 'pressed') {
        // Draw preview handled above; other gestures handled below.
      } else if (phase.kind === 'rubberBand') {
        previewKind = 'rubber';
        setGhost({ kind: 'rubber', origin, cursor: scene });
      } else if (phase.kind === 'dragging' && phase.affected) {
        previewKind = 'move';
        ops.push({
          op: 'previewMove',
          ids: phase.affected,
          from: { x: origin[0], y: origin[1] },
          to: { x: scene[0], y: scene[1] },
          axisLock: modifiers.shift,
        });
      } else if (phase.kind === 'draggingResize' && phase.target && phase.handle) {
        previewKind = 'resize';
        ops.push({
          op: 'previewResize',
          id: phase.target,
          handle: phase.handle,
          x: scene[0], y: scene[1],
          lockAspect: modifiers.shift,
        });
      } else if (phase.kind === 'draggingRotate' && phase.target) {
        previewKind = 'rotate';
        ops.push({
          op: 'previewRotate',
          id: phase.target,
          anchor: { x: origin[0], y: origin[1] },
          current: { x: scene[0], y: scene[1] },
          snap: modifiers.shift,
        });
      }
    }

    if (previewKind === 'move' || previewKind === 'resize' || previewKind === 'rotate') {
      const request = {
        ops,
        kind: previewKind,
        affected: phase?.affected ?? [],
        target: phase?.target,
      };
      pendingPreviewRef.current = request;
      if (previewInFlightRef.current) return;
      previewInFlightRef.current = true;
      const generation = previewGenerationRef.current;
      try {
        while (pendingPreviewRef.current) {
          const next = pendingPreviewRef.current;
          pendingPreviewRef.current = null;
          const raw = await sendBatch(next.ops);
          const batch = parseBatch(raw);
          if (!batch || generation !== previewGenerationRef.current) continue;
          if (next.kind === 'move') {
            const data = lastResultData(batch, 'previewMove') as {
              dx?: number; dy?: number; guides?: SnapGuideDto[];
            } | undefined;
            if (data && typeof data.dx === 'number' && typeof data.dy === 'number') {
              setGhost({ kind: 'move', affected: next.affected, dx: data.dx, dy: data.dy });
              setGuides(data.guides ?? null);
            }
          } else if (next.kind === 'resize') {
            const data = lastResultData(batch, 'previewResize') as {
              changed?: boolean; x?: number; y?: number; width?: number; height?: number; fontSize?: number | null;
              guides?: SnapGuideDto[];
            } | undefined;
            setGhost(data?.changed && data.x !== undefined && next.target
              ? {
                  kind: 'resize',
                  id: next.target,
                  box: { x: data.x, y: data.y as number, width: data.width as number, height: data.height as number },
                  fontSize: typeof data.fontSize === 'number' ? data.fontSize : null,
                }
              : NO_PREVIEW);
            setGuides(data?.guides ?? null);
          } else {
            const data = lastResultData(batch, 'previewRotate') as {
              changed?: boolean; rotation?: number;
            } | undefined;
            setGhost(data?.changed && typeof data.rotation === 'number' && next.target
              ? { kind: 'rotate', id: next.target, rotation: data.rotation }
              : NO_PREVIEW);
          }
        }
      } finally {
        previewInFlightRef.current = false;
      }
      return;
    }

    await sendBatch(ops);
  }, [sendBatch, setGhost, setGuides]);

  const clearTransient = useCallback(() => {
    previewGenerationRef.current += 1;
    ghostRef.current = NO_PREVIEW;
    guidesRef.current = null;
    paintTickRef.current += 1;
    trailRef.current = [];
    pendingPreviewRef.current = null;
    pressOriginRef.current = null;
  }, []);

  // A press, drag, or hold is over: the held hand must not stick around.
  function clearLongPress(): void {
    if (longPressTimerRef.current !== null) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
    longPressRef.current = false;
  }

  const handlePointerUp = useCallback(async (e: React.PointerEvent) => {
    const canvas = canvasRef.current;
    const rect = canvas?.getBoundingClientRect();
    // Drops outside the canvas (over panels, toolbar, or outside the window
    // — pointer capture still routes them here) cancel the gesture instead
    // of committing scene coordinates from behind UI chrome.
    if (rect && (e.clientX < rect.left || e.clientX > rect.right || e.clientY < rect.top || e.clientY > rect.bottom)) {
      await sendBatch([{ op: 'pointerCancel' }]);
      clearTransient();
      clearLongPress();
      activePointerRef.current = null;
      pressSessionRef.current = null;
      pressActiveRef.current = false;
      pressRequestRef.current = null;
      updateCursor();
      return;
    }
    const pos = getPos(e);
    cursorRef.current = pos;
    const button = e.button === 2 ? 'right' : e.button === 1 ? 'middle' : 'left';
    const scene = sceneOf(pos);
    const tool = toolRef.current;
    const isDrawRelease =
      button === 'left' &&
      (DRAW_TOOLS.has(tool) || tool === 'freedraw') &&
      pressActiveRef.current &&
      pressToolRef.current === tool;
    // Draw releases commit statelessly: the commit op releases the pointer
    // capture itself, so a normal release never goes through cancellation
    // and a stuck capture cannot block the store. The pointer phase is
    // never consulted, so a lost threshold transition, a cancelled capture,
    // or a stale tool can no longer swallow the shape; the commit still
    // happens exactly once, here on release — never per move. The request
    // id makes a retried or duplicate release return the stored shape
    // instead of storing a second one. Other tools keep the pointer-up
    // path below untouched.
    const ops: unknown[] = isDrawRelease
      ? [
          {
            op: 'commitDraw',
            requestId: pressRequestRef.current ?? mintRequestId(),
            shape: tool,
            origin: {
              x: pressOriginRef.current?.[0] ?? scene[0],
              y: pressOriginRef.current?.[1] ?? scene[1],
            },
            current: { x: scene[0], y: scene[1] },
            ...(tool === 'freedraw' && trailRef.current.length > 0
              ? { trail: trailRef.current.map(([x, y]) => ({ x, y })) }
              : {}),
          },
          { op: 'sessionState' },
        ]
      : [
          {
            op: 'pointerUp',
            x: pos[0], y: pos[1], button,
            modifiers: getModifiers(e),
          },
          { op: 'sessionState' },
        ];
    let batch = null;
    let transportOk = true;
    try {
      batch = parseBatch(await sendBatch(ops));
    } catch {
      batch = null;
      transportOk = false;
    }
    const session = batch
      ? (lastResultData(batch, 'sessionState') as SessionStateDto | undefined)
      : undefined;
    const outcome = !isDrawRelease && batch
      ? (lastResultData(batch, 'pointerUp') as { kind?: string; id?: string } | undefined)
      : undefined;
    const commit = isDrawRelease && batch
      ? (lastResultData(batch, 'commitDraw') as { id?: string | null } | undefined)
      : undefined;
    // The release commits (draw tools create one history entry here, never
    // per move). Adopt the session synchronously so panels and the next
    // press observe the post-commit state without waiting for the watcher.
    if (session) {
      pressSessionRef.current = session;
      if (frameRef.current) {
        frameRef.current = { ...frameRef.current, session };
        // Commits change selection and history: push one snapshot now so
        // panels never wait for the next throttled emission.
        maybeEmitFrame(frameRef.current, true);
        syncChrome(frameRef.current);
      }
    } else {
      pressSessionRef.current = null;
    }
    pressActiveRef.current = false;
    pressRequestRef.current = null;
    clearTransient();
    clearLongPress();
    activePointerRef.current = null;
    updateCursor(pos);
    // After a completed creation gesture the tool returns to Select unless
    // sticky mode holds it (double-click the toolbar icon to toggle).
    const createdId = isDrawRelease ? commit?.id : outcome?.kind === 'shapeCreated' ? outcome.id : undefined;
    if (button === 'left' && createdId) {
      if (!stickyRef.current) onToolChangeRef.current?.('select');
    }
    // A missing commit result means the crossing itself failed (transport
    // or parse): below-minimum declines still report an id of null and stay
    // silent, so only genuine loss surfaces. The console entry carries the
    // raw op outcome for bug reports.
    if (isDrawRelease && !commit) {
      try {
        console.error('[canvas] draw commit lost', {
          transportOk,
          entry: batch ? lastResultEntry(batch, 'commitDraw') ?? null : null,
          applied: batch?.applied ?? null,
          shape: tool,
        });
      } catch {
        // Logging must never break the release path.
      }
      notify(tRef.current('editor.errors.drawCommitLost'));
    }
  }, [sendBatch, clearTransient, maybeEmitFrame, notify]);

  const handlePointerCancel = useCallback(async () => {
    // Idempotent: a cancel after a completed release (including the
    // implicit capture loss that follows a normal pointerup) is a no-op
    // instead of a redundant crossing. A cancel racing an in-flight release
    // is still safe: it queues behind the release through the input chain
    // and only re-clears already-cleared state.
    if (!pressActiveRef.current && activePointerRef.current === null) return;
    await sendBatch([{ op: 'pointerCancel' }]);
    clearTransient();
    clearLongPress();
    activePointerRef.current = null;
    pressSessionRef.current = null;
    pressActiveRef.current = false;
    pressRequestRef.current = null;
    updateCursor();
  }, [sendBatch, clearTransient]);

  const handleBlur = useCallback(() => {
    // Focus loss must not orphan a gesture (no orphaned captures).
    if (activePointerRef.current !== null) {
      sendBatch([{ op: 'pointerCancel' }]);
      clearTransient();
      clearLongPress();
      activePointerRef.current = null;
      pressSessionRef.current = null;
      pressActiveRef.current = false;
      pressRequestRef.current = null;
    }
  }, [sendBatch, clearTransient]);

  // -- keyboard: global shortcuts own all canvas keys -------------------------
  // Canvas keeps no local key handler: window-level `useEditorShortcuts`
  // resolves keys to registry commands through one path, focus-aware so
  // text/input targets never trigger editor commands. The text overlay
  // below owns its keystrokes and stops propagation as a second guard.

  // -- text overlay (engine owns draft + caret) --------------------------------

  // Send one intercepted keystroke. Ranges come from the native selection
  // when it matches the base, otherwise the optimistic caret leads: every
  // keystroke plans against the latest known state, so fast typing composes
  // in order instead of scrambling.
  const applyKeyEdit = useCallback(async (
    base: { value: string; caret: number },
    range: { start: number; end: number },
    insert: string | null,
    forward = false,
  ): Promise<void> => {
    const plan = planKeyEdit(base.value, range.start, range.end, insert, forward);
    if (!plan) return;
    pendingRef.current = { value: plan.expected, caret: plan.expectedCaret };
    const ops: unknown[] = [{ op: 'textSetCaret', caret: plan.ops.setCaret }];
    for (let i = 0; i < plan.ops.backspaces; i += 1) {
      ops.push({ op: 'textBackspace' });
    }
    for (let i = 0; i < plan.ops.deleteForwards; i += 1) {
      ops.push({ op: 'textDelete' });
    }
    if (plan.ops.insert) {
      ops.push({ op: 'textInput', text: plan.ops.insert });
    }
    // The per-frame session poll mirrors the draft/caret back; no extra
    // crossing per keystroke.
    await sendBatch(ops);
  }, [sendBatch]);

  function nativeRange(ta: HTMLTextAreaElement): { start: number; end: number } {
    return caretRange(ta.value, ta.selectionStart ?? 0, ta.selectionEnd ?? 0);
  }

  const handleTextKeyDown = useCallback(async (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Second guard: the global shortcut listener already skips editable
    // targets, but stopping propagation keeps text keystrokes from ever
    // reaching editor commands even if focus detection lags a frame.
    e.stopPropagation();
    focusSettledRef.current = true;
    const ta = e.currentTarget;
    if (e.key === 'Escape') {
      e.preventDefault();
      // Engine-defined: Escape commits (TS finishEditing parity).
      await sendBatch([{ op: 'keyDown', key: 'Escape', modifiers: getModifiers(e) }]);
      editingIdRef.current = null;
      expectSessionRef.current = null;
      pendingRef.current = null;
      setEditingId(null);
      canvasRef.current?.focus();
      if (!stickyRef.current) onToolChangeRef.current?.('select');
      return;
    }
    if (composingRef.current) return;
    // Plan against the latest known state: optimistic sends when input is
    // in flight, otherwise the native range over the synced draft. Planning
    // against a stale frame is what scrambles fast typing, so a diverged
    // native value stays native and the change handler reconciles it.
    const pending = pendingRef.current;
    const session = frameRef.current?.session.textEditing;
    let base: { value: string; caret: number } | null = null;
    let range: { start: number; end: number } | null = null;
    if (pending) {
      base = pending;
      range = { start: pending.caret, end: pending.caret };
    } else if (session && ta.value === session.draft) {
      base = { value: ta.value, caret: 0 };
      range = nativeRange(ta);
    } else {
      return;
    }
    // Enter inserts a newline (Shift+Enter is identical — there is no
    // chat-style "Enter commits" here; commit is Esc, outside-click, blur,
    // or tool/selection change).
    if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      await applyKeyEdit(base, range, '\n');
      return;
    }
    if (e.key === 'Backspace') {
      e.preventDefault();
      await applyKeyEdit(base, range, null);
      return;
    }
    if (e.key === 'Delete') {
      e.preventDefault();
      await applyKeyEdit(base, range, null, true);
      return;
    }
    if (e.key.length === 1 && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      await applyKeyEdit(base, range, e.key);
      return;
    }
    if (e.key === 'Tab') {
      e.preventDefault();
      await applyKeyEdit(base, range, '  ');
      return;
    }
    if ((e.ctrlKey || e.metaKey) && ['z', 'Z', 'y', 'Y', 'd', 'D', 'v', 'V'].includes(e.key)) {
      // Browser textarea undo would fork the draft: engine owns history.
      // Cut stays native and reconciles through onChange below.
      e.preventDefault();
      return;
    }
  }, [sendBatch, applyKeyEdit]);

  const syncCaretFromNative = useCallback(async (ta: HTMLTextAreaElement) => {
    if (composingRef.current) return;
    // Sending is idempotent (same value, no history), so the select,
    // click, and key-up paths below may all call this for one motion.
    const engineCaret = frameRef.current?.session.textEditing?.caret;
    const at = ta.selectionStart ?? 0;
    if (engineCaret !== undefined && at === ta.selectionEnd && at === Math.min(engineCaret, ta.value.length)) {
      return;
    }
    focusSettledRef.current = true;
    lastUserCaretAtRef.current = Date.now();
    try {
      await sendBatch([{ op: 'textSetCaret', caret: at }]);
    } catch {
      // Next frame covers it.
    }
  }, [sendBatch]);

  const handleTextSelect = useCallback(async (e: React.SyntheticEvent<HTMLTextAreaElement>) => {
    await syncCaretFromNative(e.currentTarget);
  }, [syncCaretFromNative]);

  const handleTextClick = useCallback(async (e: React.MouseEvent<HTMLTextAreaElement>) => {
    await syncCaretFromNative(e.currentTarget);
  }, [syncCaretFromNative]);

  const handleTextKeyUp = useCallback(async (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Backup for caret keys when the select event never arrives: arrows,
    // Home, and End only ever move the native caret.
    if (
      e.key === 'ArrowLeft' ||
      e.key === 'ArrowRight' ||
      e.key === 'ArrowUp' ||
      e.key === 'ArrowDown' ||
      e.key === 'Home' ||
      e.key === 'End'
    ) {
      await syncCaretFromNative(e.currentTarget);
    }
  }, [syncCaretFromNative]);

  const handleTextPaste = useCallback(async (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    e.preventDefault();
    const text = e.clipboardData.getData('text/plain');
    if (!text) return;
    const ta = e.currentTarget;
    const pending = pendingRef.current;
    if (pending) {
      await applyKeyEdit(pending, { start: pending.caret, end: pending.caret }, text);
      return;
    }
    const session = frameRef.current?.session.textEditing;
    if (!session || ta.value !== session.draft) {
      // Diverged mid-flight: insert at the engine caret; the change
      // handler reconciles any native remainder.
      await sendBatch([{ op: 'textInput', text }]);
      return;
    }
    await applyKeyEdit({ value: ta.value, caret: 0 }, nativeRange(ta), text);
  }, [sendBatch, applyKeyEdit]);

  const reconcileValue = useCallback(async (ta: HTMLTextAreaElement, base: string): Promise<void> => {
    const plan = planDraftReconcile(base, ta.value);
    if (!plan) return;
    pendingRef.current = {
      value: ta.value,
      caret: Array.from(ta.value.slice(0, ta.selectionStart ?? ta.value.length)).length,
    };
    const ops: unknown[] = [{ op: 'textSetCaret', caret: plan.setCaret }];
    for (let i = 0; i < plan.backspaces; i += 1) {
      ops.push({ op: 'textBackspace' });
    }
    if (plan.insert) {
      ops.push({ op: 'textInput', text: plan.insert });
    }
    await sendBatch(ops);
  }, [sendBatch]);

  const handleTextChange = useCallback(async (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    // Catches edits the key handler never sees (native cut, mobile
    // keyboards, autofill, composition-end remainders): reconcile the
    // native value onto the optimistic base, not a stale frame, so rapid
    // changes compose instead of duplicating. Key-handled input calls
    // preventDefault, so it never fires this path twice for one keystroke.
    if (composingRef.current) return;
    const ta = e.currentTarget;
    const session = frameRef.current?.session.textEditing;
    if (!session) {
      ta.value = '';
      return;
    }
    await reconcileValue(ta, pendingRef.current?.value ?? session.draft);
  }, [reconcileValue]);

  const handleTextBlur = useCallback(async () => {
    // TS blur parity: leaving the overlay commits (no-op when the session
    // already ended via outside-click or Escape). A committed text object
    // returns the tool to Select unless sticky mode holds it.
    if (editingIdRef.current) {
      const raw = await sendBatch([{ op: 'commitText' }]);
      const batch = parseBatch(raw);
      const data = batch
        ? (lastResultData(batch, 'commitText') as { committed?: boolean } | undefined)
        : undefined;
      editingIdRef.current = null;
      expectSessionRef.current = null;
      pendingRef.current = null;
      setEditingId(null);
      if (data?.committed && !stickyRef.current) onToolChangeRef.current?.('select');
    }
  }, [sendBatch]);

  const handleCompositionStart = useCallback(() => {
    composingRef.current = true;
    sendBatch([{ op: 'compositionStart' }]);
  }, [sendBatch]);

  const handleCompositionUpdate = useCallback((e: React.CompositionEvent) => {
    sendBatch([{ op: 'compositionUpdate', buffer: e.data ?? '' }]);
  }, [sendBatch]);

  const handleCompositionEnd = useCallback(async (e: React.CompositionEvent) => {
    composingRef.current = false;
    await sendBatch([{ op: 'compositionEnd', finalText: e.data ?? '' }]);
    // Some browsers report an empty final string while the committed char
    // already sits in the field with no further change event: reconcile
    // that remainder one time (rare path, one extra crossing only here).
    try {
      const ta = e.currentTarget as HTMLTextAreaElement | null;
      if (!ta) return;
      const raw = await sendBatch([{ op: 'sessionState' }]);
      const batch = parseBatch(raw);
      const session = batch
        ? (lastResultData(batch, 'sessionState') as SessionStateDto | undefined)
        : undefined;
      const draft = session?.textEditing?.draft;
      if (draft === undefined || ta.value === draft) return;
      await reconcileValue(ta, draft);
    } catch {
      // Next frame covers it.
    }
  }, [sendBatch, reconcileValue]);

  // -- context menu (engine decides intents, host renders via shared registry) ---

  const handleContextMenu = useCallback(async (e: React.MouseEvent) => {
    e.preventDefault();
    const pos = getPos(e);
    const raw = await sendBatch([
      { op: 'pointerDown', x: pos[0], y: pos[1], button: 'right', modifiers: { shift: false, alt: false, ctrlOrCmd: false }, clickCount: 1 },
      { op: 'pointerUp', x: pos[0], y: pos[1], button: 'right', modifiers: { shift: false, alt: false, ctrlOrCmd: false } },
      { op: 'contextMenu' },
    ]);
    const batch = parseBatch(raw);
    const data = batch
      ? (lastResultData(batch, 'contextMenu') as { intents?: string[] } | undefined)
      : undefined;
    const intents = data?.intents ?? [];
    for (const row of extensionMenuRowsFor('canvas.context')) {
      if (!intents.includes(row.commandId)) intents.push(row.commandId);
    }
    if (intents.length > 0) {
      setMenu({ x: e.clientX, y: e.clientY, intents });
    }
  }, [sendBatch]);

  const runMenuAction = useCallback(async (intent: string) => {
    setMenu(null);
    if (hasExtensionCommand(intent)) {
      const outcome = await executeExtensionCommand(intent);
      if (!outcome.ok && outcome.reason) notify(outcome.reason);
      return;
    }
    const result = await executeCommand(intent, commandContextRef.current);
    const message = commandResultMessage(intent, result, tRef.current);
    if (message) notify(message);
  }, [notify]);

  // Viewcontrols dispatch through the shared view commands so enablement,
  // toasts, and shortcuts stay identical to menubar, palette, and keys.
  const runViewCommand = useCallback(async (id: string) => {
    const result = await executeCommand(id, commandContextRef.current);
    const message = commandResultMessage(id, result, tRef.current);
    if (message) notify(message);
  }, [notify]);

  // -- render ------------------------------------------------------------------

  return (
    <div
      ref={containerRef}
      style={{ position: 'absolute', inset: 0, overflow: 'hidden' }}
    >
      <canvas
        ref={canvasRef}
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          cursor:
            activeTool === 'select'
              ? 'var(--cursor-select)'
              : activeTool === 'text'
                ? 'var(--cursor-text)'
                : 'var(--cursor-draw)',
          touchAction: 'none',
        }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
        onLostPointerCapture={handlePointerCancel}
        onBlur={handleBlur}
        onContextMenu={handleContextMenu}
        tabIndex={0}
        aria-label={t('editor.canvasAriaLabel')}
      />
      <textarea
        ref={textAreaRef}
        style={{
          display: editingId ? 'block' : 'none',
          position: 'absolute',
          overflow: 'hidden',
          background: 'transparent',
          border: 'none',
          outline: 'none',
          padding: 0,
          margin: 0,
          resize: 'none',
          zIndex: 5,
          lineHeight: 1.25,
          whiteSpace: 'pre',
        }}
        rows={1}
        onKeyDown={handleTextKeyDown}
        onKeyUp={handleTextKeyUp}
        onSelect={handleTextSelect}
        onClick={handleTextClick}
        onChange={handleTextChange}
        onPaste={handleTextPaste}
        onBlur={handleTextBlur}
        onCompositionStart={handleCompositionStart}
        onCompositionUpdate={handleCompositionUpdate}
        onCompositionEnd={handleCompositionEnd}
      />
      {menu && (
        <CanvasContextMenu
          x={menu.x}
          y={menu.y}
          intents={menu.intents}
          context={commandContextRef.current}
          onExecute={(intent) => void runMenuAction(intent)}
          onClose={() => setMenu(null)}
        />
      )}
      <div className="editor-viewcontrols" role="group" aria-label={t('editor.title')}>
        <Tooltip content={t('editor.view.zoomOut')} placement="top">
          <button
            type="button"
            className="editor-viewcontrols__button"
            onClick={() => void runViewCommand('zoomOut')}
            disabled={!canExecuteCommand('zoomOut', commandContext).executable}
            aria-label={t('editor.view.zoomOut')}
          >
            <MinusIcon size={14} />
          </button>
        </Tooltip>
        <Tooltip content={t('editor.view.resetZoom')} placement="top">
          <button
            type="button"
            className="editor-viewcontrols__label"
            onClick={() => void runViewCommand('resetZoom')}
            disabled={!canExecuteCommand('resetZoom', commandContext).executable}
            aria-label={t('editor.view.resetZoom')}
          >
            {zoomLabel}
          </button>
        </Tooltip>
        <Tooltip content={t('editor.view.zoomIn')} placement="top">
          <button
            type="button"
            className="editor-viewcontrols__button"
            onClick={() => void runViewCommand('zoomIn')}
            disabled={!canExecuteCommand('zoomIn', commandContext).executable}
            aria-label={t('editor.view.zoomIn')}
          >
            <PlusIcon size={14} />
          </button>
        </Tooltip>
        <Tooltip content={t('editor.view.fitContent')} placement="top">
          <button
            type="button"
            className="editor-viewcontrols__button"
            onClick={() => void runViewCommand('fitContent')}
            disabled={!canExecuteCommand('fitContent', commandContext).executable}
            aria-label={t('editor.view.fitContent')}
          >
            <FitIcon size={14} />
          </button>
        </Tooltip>
        <Tooltip content={t('editor.view.fitSelection')} placement="top">
          <button
            type="button"
            className="editor-viewcontrols__button"
            onClick={() => void runViewCommand('fitSelection')}
            disabled={!canExecuteCommand('fitSelection', commandContext).executable}
            aria-label={t('editor.view.fitSelection')}
          >
            <FitSelectionIcon size={14} />
          </button>
        </Tooltip>
      </div>
    </div>
  );
}

/** Committed bounds + style of the element under edit (for overlay placement). */
function isSingleTextSelection(snapshot: FrameSnapshot): boolean {
  const selection = snapshot.session.selection;
  if (selection.length !== 1) return false;
  const id = selection[0];
  const all = [
    ...snapshot.model.base,
    ...snapshot.model.frames.flatMap((pass) => [pass.frame, ...pass.children]),
  ];
  return all.some((item) => item.id === id && item.kind === 'text');
}

/** One committed entry by id across the base pass and frame passes. */
function findModelEntry(model: RenderModelDto, id: string): DrawEntryDto | null {
  const all = [
    ...model.base,
    ...model.frames.flatMap((pass) => [pass.frame, ...pass.children]),
  ];
  return all.find((item) => item.id === id) ?? null;
}

/** Committed bounds + style of the element under edit (for overlay placement). */
interface TextEntryBounds {
  x: number;
  y: number;
  width: number;
  height: number;
  fontSize: number;
  fontFamily: string;
  strokeColor: string;
  textAlign: 'left' | 'center' | 'right';
}

function findEntryBounds(model: RenderModelDto, id: string): TextEntryBounds | null {
  const entry = findModelEntry(model, id);
  if (!entry) return null;
  const fontSize = entry.detail.type === 'text' ? entry.detail.fontSize : 16;
  const fontFamily = entry.detail.type === 'text' ? entry.detail.fontFamily : 'sans-serif';
  const textAlign = entry.detail.type === 'text' ? entry.detail.align : 'left';
  const frame = entry.frame ?? entry.bounds;
  return {
    x: frame.minX,
    y: frame.minY,
    width: Math.max(frame.maxX - frame.minX, 10),
    height: Math.max(frame.maxY - frame.minY, 10),
    fontSize,
    fontFamily,
    strokeColor: entry.strokeColor,
    textAlign,
  };
}
