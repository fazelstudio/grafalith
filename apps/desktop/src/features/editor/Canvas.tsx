import { useRef, useEffect, useCallback, useState } from 'react';
import type {
  Engine,
  FrameSnapshot,
  RenderModelDto,
  SessionStateDto,
  SnapGuideDto,
} from '../../hooks/useEngine';
import { lastResultData, parseBatchResult } from '../../hooks/useEngine';
import { canExecuteCommand, executeCommand, type CommandContext, type ViewActions } from '../../registries';
import { executeExtensionCommand, hasExtensionCommand, extensionMenuRowsFor } from '../../platform/extensions/extensionContributions';
import { commandResultMessage } from './engineGaps';
import { CanvasContextMenu } from './menus/menus';
import { useToast } from '../../app/shell/ToastProvider';
import { drawRenderModel, NO_PREVIEW, type GhostPreview } from '../../render/drawModel';
import { screenToScene, sceneToScreen } from '../../render/coords';
import { useI18n } from '../../app/i18n/resources';
import { FitIcon, FitSelectionIcon, MinusIcon, PlusIcon } from '../../ui/icons';
import { Tooltip } from '../../ui/primitives/tooltip';
import { contentBounds, selectionBounds } from './navigator';
import { fitViewport, zoomViewport } from './viewport';
import { DESKTOP_TIMING } from '../../app/theme/tokens';

interface CanvasProps {
  engine: Engine;
  activeTool: string;
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

export function Canvas({
  engine,
  activeTool,
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
  const trailRef = useRef<[number, number][]>([]);
  const activePointerRef = useRef<number | null>(null);
  const clickCountRef = useRef<number>(0);
  const lastClickTimeRef = useRef<number>(0);
  const composingRef = useRef(false);
  const toolRef = useRef(activeTool);
  toolRef.current = activeTool;
  // Deferred text-overlay focus; cleared on unmount so a closed project
  // never focuses a detached node.
  const focusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function focusTextAreaSoon(): void {
    if (focusTimerRef.current !== null) clearTimeout(focusTimerRef.current);
    focusTimerRef.current = setTimeout(() => {
      focusTimerRef.current = null;
      textAreaRef.current?.focus();
    }, 0);
  }

  const [menu, setMenu] = useState<ContextMenuState | null>(null);
  const { t } = useI18n();
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
  const failCountRef = useRef(0);
  const errorReportedRef = useRef(false);
  const [zoomLabel, setZoomLabel] = useState('100%');
  const zoomLabelRef = useRef('100%');
  // Visible text overlay, driven by engine `textEditing` (id changes only).
  const [editingId, setEditingId] = useState<string | null>(null);
  const editingIdRef = useRef<string | null>(null);
  editingIdRef.current = editingId;

  const sendBatch = useCallback(async (ops: unknown[]): Promise<string> => {
    // Serialize input batches through a chain: rapid pointer moves must
    // reach the engine in DOM order (Tauri invokes otherwise race on the
    // thread pool). Read-only frame queries bypass the chain.
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

  function frameKey(snapshot: FrameSnapshot): string {
    const session = snapshot.session;
    const childCount = snapshot.model.frames.reduce((sum, pass) => sum + pass.children.length, 0);
    return JSON.stringify([
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
  const maybeEmitFrame = useCallback((snapshot: FrameSnapshot, force: boolean) => {
    const key = frameKey(snapshot);
    const now = Date.now();
    if (
      !force &&
      (key === lastEmitRef.current.key || now - lastEmitRef.current.time < DESKTOP_TIMING.frameMirrorThrottleMs)
    ) {
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

  const fitModel = useCallback(async (model: RenderModelDto, boundsOf: (model: RenderModelDto) => { minX: number; minY: number; maxX: number; maxY: number } | null) => {
    const { width, height } = sizeRef.current;
    if (!(width > 0 && height > 0)) return;
    const viewport = fitViewport(boundsOf(model), width, height);
    if (viewport) await applyViewport(viewport);
  }, [sendBatch]);

  const fitContent = useCallback(async () => {
    const snapshot = frameRef.current;
    if (!snapshot) return;
    await fitModel(snapshot.model, contentBounds);
  }, [fitModel]);

  const fitSelection = useCallback(async () => {
    const snapshot = frameRef.current;
    if (!snapshot || snapshot.session.selection.length === 0) return;
    const selection = snapshot.session.selection;
    await fitModel(snapshot.model, (model) => selectionBounds(model, selection));
  }, [fitModel]);

  // View actions shared with view commands (one implementation, two surfaces).
  const onViewActionsRef = useRef(onViewActions);
  onViewActionsRef.current = onViewActions;
  useEffect(() => {
    onViewActionsRef.current?.({ zoomStep, resetZoom, fitContent, fitSelection });
    return () => onViewActionsRef.current?.(null);
  }, [zoomStep, resetZoom, fitContent, fitSelection]);

  // -- tool switching -------------------------------------------------------

  useEffect(() => {
    sendBatch([{ op: 'setTool', tool: activeTool }]);
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
    trailRef.current = [];
  }, [activeTool, engine, sendBatch]);

  // -- frame loop: one crossing per frame (renderModel + sessionState) ------

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
    window.addEventListener('resize', resize);

    // Native wheel listener so preventDefault works (React attaches wheel
    // as passive and warns). Zoom/pan math stays engine-side.
    async function onWheelNative(e: WheelEvent) {
      e.preventDefault();
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      await sendBatch([{
        op: 'wheel',
        dx: e.deltaX,
        dy: e.deltaY,
        zoomGesture: e.ctrlKey || e.metaKey,
        x, y,
      }]);
    }
    canvas.addEventListener('wheel', onWheelNative, { passive: false });

    let alive = true;
    let inFlight = false;

    async function frame() {
      if (!alive) return;
      if (!inFlight && cssWidth > 0 && cssHeight > 0) {
        inFlight = true;
        try {
          const snapshot = await engine.getFrame(cssWidth, cssHeight);
          if (snapshot && alive) {
            frameRef.current = snapshot;
            failCountRef.current = 0;
            syncTextOverlay(snapshot);
            maybeEmitFrame(snapshot, false);
            syncChrome(snapshot);
          }
        } catch {
          // Transport hiccup: keep the last frame, retry next rAF. A long
          // outage surfaces once as a recoverable error instead of a
          // silently frozen canvas.
          failCountRef.current += 1;
          if (failCountRef.current >= 300) {
            reportRenderError();
          }
        } finally {
          inFlight = false;
        }
      }
      if (!canvas || !ctx || !alive) return;
      const snapshot = frameRef.current;
      if (snapshot) {
        positionTextArea(snapshot);
        try {
          drawRenderModel(
            ctx,
            snapshot.model,
            cssWidth,
            cssHeight,
            ghostRef.current,
            editingIdRef.current,
            guidesRef.current,
          );
        } catch {
          reportRenderError();
        }
      } else {
        ctx.clearRect(0, 0, cssWidth, cssHeight);
      }
      rafRef.current = requestAnimationFrame(frame);
    }

    function syncTextOverlay(snapshot: FrameSnapshot) {
      const id = snapshot.session.textEditing?.id ?? null;
      if (id !== editingIdRef.current) {
        setEditingId(id);
        if (id) {
          // Focus after paint so the caret appears immediately.
          focusTextAreaSoon();
        }
      }
    }

    function positionTextArea(snapshot: FrameSnapshot) {
      const ta = textAreaRef.current;
      const textState = snapshot.session.textEditing;
      if (!ta || !textState) return;
      const entry = findEntryBounds(snapshot, textState.id);
      const viewport = snapshot.session.viewport;
      if (entry) {
        const [sx, sy] = sceneToScreen([entry.x, entry.y], viewport);
        ta.style.display = 'block';
        ta.style.left = `${sx}px`;
        ta.style.top = `${sy}px`;
        ta.style.width = `${Math.max(entry.width * viewport.zoom, 40)}px`;
        ta.style.height = `${Math.max(entry.height * viewport.zoom, 24)}px`;
        ta.style.fontSize = `${entry.fontSize * viewport.zoom}px`;
        ta.style.fontFamily = entry.fontFamily;
        ta.style.color = entry.strokeColor;
      }
      // Engine is authoritative for draft + caret: mirror without fighting
      // the user's in-progress composition.
      if (!composingRef.current && ta.value !== textState.draft) {
        ta.value = textState.draft;
      }
      if (document.activeElement === ta && !composingRef.current) {
        const caret = Math.min(textState.caret, ta.value.length);
        if (ta.selectionStart !== caret || ta.selectionEnd !== caret) {
          try {
            ta.setSelectionRange(caret, caret);
          } catch {
            // Hidden or detached textarea: ignore.
          }
        }
      }
    }

    rafRef.current = requestAnimationFrame(frame);

    return () => {
      alive = false;
      window.removeEventListener('resize', resize);
      canvas.removeEventListener('wheel', onWheelNative);
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
      }
      if (focusTimerRef.current !== null) {
        clearTimeout(focusTimerRef.current);
        focusTimerRef.current = null;
      }
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

  function updateCursor(pos?: [number, number], button?: number): void {
    const phase = frameRef.current?.session.pointerPhase;
    if (activePointerRef.current !== null || phase?.kind === 'dragging' || button === 1) {
      setCursor('var(--cursor-grabbing)');
      return;
    }
    if (button === 1) {
      setCursor('var(--cursor-grab)');
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
    if (pos && hasElementAt(sceneOf(pos))) {
      setCursor('var(--cursor-pointer)');
      return;
    }
    setCursor('var(--cursor-select)');
  }

  // -- pointer ---------------------------------------------------------------

  const handlePointerDown = useCallback(async (e: React.PointerEvent) => {
    setMenu(null);
    canvasRef.current?.focus();
    const now = Date.now();
    const timeSinceLastClick = now - lastClickTimeRef.current;
    clickCountRef.current = timeSinceLastClick < 400 ? clickCountRef.current + 1 : 1;
    lastClickTimeRef.current = now;

    const pos = getPos(e);
    updateCursor(pos, e.button);
    cursorRef.current = pos;
    const button = e.button === 2 ? 'right' : e.button === 1 ? 'middle' : 'left';

    const raw = await sendBatch([{
      op: 'pointerDown',
      x: pos[0], y: pos[1], button,
      modifiers: getModifiers(e),
      clickCount: clickCountRef.current,
    }]);
    const batch = parseBatch(raw);
    const outcome = batch ? (lastResultData(batch, 'pointerDown') as {
      hit?: string | null; beganTextEdit?: string | null; committedText?: boolean;
    } | undefined) : undefined;
    if (outcome?.beganTextEdit) {
      setEditingId(outcome.beganTextEdit);
      focusTextAreaSoon();
    } else if (outcome?.committedText) {
      setEditingId(null);
    }
    if (activeTool === 'select' && button === 'left' && outcome?.hit) {
      setCursor('var(--cursor-grabbing)');
    }

    // Freedraw accumulates its own display trail from the press origin.
    if (toolRef.current === 'freedraw' && button === 'left') {
      trailRef.current = [sceneOf(pos)];
    }

    activePointerRef.current = e.pointerId;
    try {
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    } catch {
      // Mouse input may not support capture in all browsers: the gesture
      // still works, only out-of-window tracking degrades.
    }
  }, [sendBatch]);

  const handlePointerMove = useCallback(async (e: React.PointerEvent) => {
    const pos = getPos(e);
    updateCursor(pos);
    cursorRef.current = pos;
    const scene = sceneOf(pos);
    const modifiers = getModifiers(e);
    const session = frameRef.current?.session;
    const phase = session?.pointerPhase;
    const origin = phase?.originScene as [number, number] | undefined;

    const ops: unknown[] = [{
      op: 'pointerMove',
      x: pos[0], y: pos[1],
      modifiers,
    }];

    // Choose the read-only preview query from the last-known phase (one
    // frame stale at most). Failures are ignored: the preview is a hint,
    // the commit path stays authoritative.
    let previewKind: GhostPreview['kind'] = 'none';
    if (phase && origin) {
      if (phase.kind === 'drawing' || phase.kind === 'pressed') {
        const tool = toolRef.current;
        if (DRAW_TOOLS.has(tool)) {
          previewKind = 'draw';
          ghostRef.current = { kind: 'draw', shape: tool, origin, cursor: scene };
        } else if (tool === 'freedraw') {
          const trail = trailRef.current;
          const last = trail[trail.length - 1];
          if (!last || last[0] !== scene[0] || last[1] !== scene[1]) {
            trail.push(scene);
          }
          ghostRef.current = { kind: 'freedraw', trail: [...trail] };
        }
      } else if (phase.kind === 'rubberBand') {
        previewKind = 'rubber';
        ghostRef.current = { kind: 'rubber', origin, cursor: scene };
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

    const raw = await sendBatch(ops);
    const batch = parseBatch(raw);
    if (!batch) return;
    if (previewKind === 'move') {
      const data = lastResultData(batch, 'previewMove') as {
        dx?: number; dy?: number; guides?: SnapGuideDto[];
      } | undefined;
      if (data && typeof data.dx === 'number' && typeof data.dy === 'number') {
        ghostRef.current = { kind: 'move', affected: phase?.affected ?? [], dx: data.dx, dy: data.dy };
        guidesRef.current = data.guides ?? null;
      }
    } else if (previewKind === 'resize') {
      const data = lastResultData(batch, 'previewResize') as {
        changed?: boolean; x?: number; y?: number; width?: number; height?: number;
      } | undefined;
      if (data?.changed && data.x !== undefined) {
        ghostRef.current = {
          kind: 'resize',
          box: { x: data.x, y: data.y as number, width: data.width as number, height: data.height as number },
        };
      } else {
        ghostRef.current = NO_PREVIEW;
      }
    } else if (previewKind === 'rotate') {
      const data = lastResultData(batch, 'previewRotate') as {
        changed?: boolean; rotation?: number;
      } | undefined;
      if (data?.changed && typeof data.rotation === 'number' && phase?.target) {
        ghostRef.current = { kind: 'rotate', id: phase.target, rotation: data.rotation };
      } else {
        ghostRef.current = NO_PREVIEW;
      }
    }
  }, [sendBatch]);

  const clearTransient = useCallback(() => {
    ghostRef.current = NO_PREVIEW;
    guidesRef.current = null;
    trailRef.current = [];
  }, []);

  const handlePointerUp = useCallback(async (e: React.PointerEvent) => {
    const pos = getPos(e);
    cursorRef.current = pos;
    const button = e.button === 2 ? 'right' : e.button === 1 ? 'middle' : 'left';
    const raw = await sendBatch([
      {
        op: 'pointerUp',
        x: pos[0], y: pos[1], button,
        modifiers: getModifiers(e),
      },
      { op: 'sessionState' },
    ]);
    const batch = parseBatch(raw);
    const session = batch
      ? (lastResultData(batch, 'sessionState') as SessionStateDto | undefined)
      : undefined;
    const outcome = batch
      ? (lastResultData(batch, 'pointerUp') as { kind?: string; id?: string } | undefined)
      : undefined;
    if (session && frameRef.current) {
      frameRef.current = { ...frameRef.current, session };
      // Commits change selection and history: push one snapshot now so
      // panels never wait for the next throttled emission.
      maybeEmitFrame(frameRef.current, true);
      syncChrome(frameRef.current);
    }
    clearTransient();
    activePointerRef.current = null;
    updateCursor(pos);
    if (button === 'left' && outcome?.kind === 'shapeCreated' && outcome.id) {
      onToolChange?.('select');
    }
  }, [sendBatch, clearTransient, maybeEmitFrame, onToolChange]);

  const handlePointerCancel = useCallback(async () => {
    await sendBatch([{ op: 'pointerCancel' }]);
    clearTransient();
    activePointerRef.current = null;
    updateCursor();
  }, [sendBatch, clearTransient]);

  const handleBlur = useCallback(() => {
    // Focus loss must not orphan a gesture (no orphaned captures).
    if (activePointerRef.current !== null) {
      sendBatch([{ op: 'pointerCancel' }]);
      clearTransient();
      activePointerRef.current = null;
    }
  }, [sendBatch, clearTransient]);

  // -- keyboard: global shortcuts own all canvas keys -------------------------
  // Canvas keeps no local key handler: window-level `useEditorShortcuts`
  // resolves keys to registry commands through one path, focus-aware so
  // text/input targets never trigger editor commands. The text overlay
  // below owns its keystrokes and stops propagation as a second guard.

  // -- text overlay (engine owns draft + caret) --------------------------------

  const syncCaretAfterEdit = useCallback(async () => {
    // The frame loop mirrors draft/caret into the textarea; nudge an
    // immediate sync so typing never visibly lags a frame.
    try {
      const raw = await sendBatch([{ op: 'sessionState' }]);
      const batch = parseBatch(raw);
      const session = batch
        ? (lastResultData(batch, 'sessionState') as SessionStateDto | undefined)
        : undefined;
      if (session?.textEditing && frameRef.current) {
        frameRef.current = { ...frameRef.current, session };
      }
    } catch {
      // Next frame covers it.
    }
  }, [sendBatch]);

  const handleTextKeyDown = useCallback(async (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Second guard: the global shortcut listener already skips editable
    // targets, but stopping propagation keeps text keystrokes from ever
    // reaching editor commands even if focus detection lags a frame.
    e.stopPropagation();
    const ta = e.currentTarget;
    if (e.key === 'Escape') {
      e.preventDefault();
      // Engine-defined: Escape commits (TS finishEditing parity).
      await sendBatch([{ op: 'keyDown', key: 'Escape', modifiers: getModifiers(e) }]);
      setEditingId(null);
      canvasRef.current?.focus();
      return;
    }
    if (composingRef.current) return;
    if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      await sendBatch([{ op: 'textInput', text: '\n' }]);
      await syncCaretAfterEdit();
      return;
    }
    if (e.key === 'Backspace') {
      e.preventDefault();
      await sendBatch([{ op: 'textBackspace' }]);
      await syncCaretAfterEdit();
      return;
    }
    if (e.key === 'Delete') {
      e.preventDefault();
      await sendBatch([{ op: 'textDelete' }]);
      await syncCaretAfterEdit();
      return;
    }
    if (e.key.length === 1 && !e.ctrlKey && !e.metaKey) {
      // Printable input goes through the engine draft (controlled overlay).
      e.preventDefault();
      await sendBatch([{ op: 'textInput', text: e.key }]);
      await syncCaretAfterEdit();
      return;
    }
    if (e.key === 'Tab') {
      e.preventDefault();
      await sendBatch([{ op: 'textInput', text: '  ' }]);
      await syncCaretAfterEdit();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && ['z', 'Z', 'y', 'Y', 'd', 'D', 'v', 'V', 'x', 'X'].includes(e.key)) {
      // Browser textarea undo would fork the draft: engine owns history.
      e.preventDefault();
      return;
    }
    void ta;
  }, [sendBatch, syncCaretAfterEdit]);

  const handleTextSelect = useCallback(async (e: React.SyntheticEvent<HTMLTextAreaElement>) => {
    if (composingRef.current) return;
    const ta = e.currentTarget;
    // Arrow/Home/End motion falls through natively; sync the caret back.
    try {
      await sendBatch([{ op: 'textSetCaret', caret: ta.selectionStart ?? 0 }]);
    } catch {
      // Next frame covers it.
    }
  }, [sendBatch]);

  const handleTextPaste = useCallback(async (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    e.preventDefault();
    const text = e.clipboardData.getData('text/plain');
    if (text) {
      await sendBatch([{ op: 'textInput', text }]);
      await syncCaretAfterEdit();
    }
  }, [sendBatch, syncCaretAfterEdit]);

  const handleTextBlur = useCallback(async () => {
    // TS blur parity: leaving the overlay commits (no-op when the session
    // already ended via outside-click or Escape).
    if (editingIdRef.current) {
      await sendBatch([{ op: 'commitText' }]);
      setEditingId(null);
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
    await syncCaretAfterEdit();
  }, [sendBatch, syncCaretAfterEdit]);

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
          border: '1px dashed var(--accent)',
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
        onSelect={handleTextSelect}
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
function findEntryBounds(
  snapshot: FrameSnapshot,
  id: string,
): { x: number; y: number; width: number; height: number; fontSize: number; fontFamily: string; strokeColor: string } | null {
  const all = [
    ...snapshot.model.base,
    ...snapshot.model.frames.flatMap((pass) => [pass.frame, ...pass.children]),
  ];
  const entry = all.find((item) => item.id === id);
  if (!entry) return null;
  const fontSize = entry.detail.type === 'text' ? entry.detail.fontSize : 16;
  const fontFamily = entry.detail.type === 'text' ? entry.detail.fontFamily : 'sans-serif';
  return {
    x: entry.bounds.minX,
    y: entry.bounds.minY,
    width: Math.max(entry.bounds.maxX - entry.bounds.minX, 10),
    height: Math.max(entry.bounds.maxY - entry.bounds.minY, 10),
    fontSize,
    fontFamily,
    strokeColor: entry.strokeColor,
  };
}
