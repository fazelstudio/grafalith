import { useEffect, useRef, useState, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';

export interface EngineStatus {
  bindingsVersion: string;
  protocolVersion: number;
  schemaVersion: number;
  elementCount: number;
  sceneNonce: number;
  canUndo: boolean;
  canRedo: boolean;
  undoLen: number;
  redoLen: number;
  selection: string[];
  tool: string;
  order: string[];
  viewport: ViewportDto;
  textEditing: string | null;
  pointerPhase: string;
  assetGeneration: number;
}

export interface ViewportDto {
  scrollX: number;
  scrollY: number;
  zoom: number;
}

export interface BoundsDto {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export type PaintDto =
  | { type: 'solid'; color: string }
  | { type: 'linear'; angle: number; stops: { offset: number; color: string }[] }
  | { type: 'radial'; stops: { offset: number; color: string }[] };

export type DrawDetailDto =
  | { type: 'none' }
  | { type: 'text'; text: string; fontSize: number; fontFamily: string }
  | { type: 'image'; assetId: string; ready: boolean }
  | { type: 'frame'; name: string; clipContent: boolean }
  | { type: 'arrow'; hasStart: boolean; hasEnd: boolean }
  | { type: 'path'; closed: boolean }
  | { type: 'custom'; typeName: string };

export interface PathSegmentDto {
  point: [number, number];
  handleIn?: [number, number];
  handleOut?: [number, number];
}

export interface DrawEntryDto {
  id: string;
  kind: string;
  bounds: BoundsDto;
  rotation: number;
  paint: PaintDto;
  strokeColor: string;
  strokeWidth: number;
  /** `"solid"`, `"dashed"`, or `"dotted"`. */
  strokeStyle: string;
  opacity: number;
  detail: DrawDetailDto;
  /** Absolute scene-space polyline for line/arrow/freedraw (absent otherwise). */
  points?: [number, number][];
  /** Absolute scene-space path anchors (absent for non-path). */
  segments?: PathSegmentDto[];
}

export interface FramePassDto {
  frame: DrawEntryDto;
  children: DrawEntryDto[];
}

export interface SelectionOverlayDto {
  bounds: BoundsDto;
  handles: [number, number][];
  rotateHandle: [number, number];
  rotation: number;
}

export interface SnapGuideDto {
  vertical: boolean;
  position: number;
  startX: number;
  startY: number;
  endX: number;
  endY: number;
}

export interface TextStateDto {
  id: string;
  draft: string;
  caret: number;
  composing: boolean;
}

export interface RenderModelDto {
  base: DrawEntryDto[];
  frames: FramePassDto[];
  selection: SelectionOverlayDto | null;
  snapGuides: SnapGuideDto[];
  textEditing: TextStateDto | null;
  viewport: ViewportDto;
  assetGeneration: number;
}

export interface PhaseDto {
  kind: string;
  originScene?: [number, number];
  affected?: string[];
  additive?: boolean;
  /** Dragged element id (resize/rotate phases only). */
  target?: string;
  /** Dragged resize handle, TS kebab-case (resize phase only). */
  handle?: string;
}

export interface SessionStateDto {
  selection: string[];
  tool: string;
  viewport: ViewportDto;
  textEditing: TextStateDto | null;
  pointerPhase: PhaseDto;
  canUndo: boolean;
  canRedo: boolean;
  undoLen: number;
  redoLen: number;
  enabledTools: string[] | null;
  assetGeneration: number;
}

export interface OpResult {
  op: string;
  ok: boolean;
  code?: string;
  message?: string;
  /** Wire payload varies per op; callers narrow it with a cast. */
  data?: unknown;
}

export interface BatchResult {
  version: number;
  applied: number;
  results: OpResult[];
}

/** Parse an `apply_batch` result string (throws on unparseable envelopes). */
export function parseBatchResult(raw: string): BatchResult {
  return JSON.parse(raw) as BatchResult;
}

/** Find the last successful result for `op` in a batch result. */
export function lastResultData(batch: BatchResult, op: string): unknown {
  for (let i = batch.results.length - 1; i >= 0; i--) {
    const entry = batch.results[i];
    if (entry.op === op && entry.ok) return entry.data;
  }
  return undefined;
}

export interface FrameSnapshot {
  model: RenderModelDto;
  session: SessionStateDto;
}

export interface Engine {
  ready: boolean;
  /** True when the Tauri transport failed; the editor reports this honestly. */
  failed: boolean;
  /** Original initialization rejection for actionable diagnostics. */
  failure: unknown;
  sendBatch: (ops: unknown[]) => Promise<string>;
  getStatus: () => Promise<EngineStatus>;
  /** One crossing for the whole frame: renderModel + sessionState (CSS px!). */
  getFrame: (cssWidth: number, cssHeight: number) => Promise<FrameSnapshot | null>;
  getRenderModel: (cssWidth: number, cssHeight: number) => Promise<RenderModelDto | null>;
  getSessionState: () => Promise<SessionStateDto>;
  exportScene: () => Promise<string>;
  importScene: (json: string, tracked: boolean) => Promise<string>;
}

export function useEngine(): Engine {
  const [lifecycle, setLifecycle] = useState<'pending' | 'ready' | 'failed'>('pending');
  const [failure, setFailure] = useState<unknown>(null);
  const engineRef = useRef<Engine | null>(null);

  useEffect(() => {
    let cancelled = false;
    invoke('create_engine').then(
      () => {
        if (!cancelled) setLifecycle('ready');
      },
      (error: unknown) => {
        if (!cancelled) {
          setFailure(error);
          setLifecycle('failed');
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, []);

  const sendBatch = useCallback(async (ops: unknown[]): Promise<string> => {
    const batch = JSON.stringify(ops);
    return invoke('apply_batch', { batch });
  }, []);

  const getStatus = useCallback(async (): Promise<EngineStatus> => {
    const json = await invoke<string>('status');
    return JSON.parse(json);
  }, []);

  const getSessionState = useCallback(async (): Promise<SessionStateDto> => {
    const result = await sendBatch([{ op: 'sessionState' }]);
    const parsed = parseBatchResult(result);
    const data = lastResultData(parsed, 'sessionState') as SessionStateDto | undefined;
    return data as SessionStateDto;
  }, [sendBatch]);

  const getRenderModel = useCallback(async (
    cssWidth: number,
    cssHeight: number,
  ): Promise<RenderModelDto | null> => {
    const result = await sendBatch([
      {
        op: 'renderModel',
        canvasWidth: cssWidth,
        canvasHeight: cssHeight,
        showGrid: false,
        readyImages: [],
      },
    ]);
    const parsed = parseBatchResult(result);
    return (lastResultData(parsed, 'renderModel') as RenderModelDto | undefined) ?? null;
  }, [sendBatch]);

  // One crossing per frame: the model and the session observe the same
  // state, so previews (session origin + local cursor) never skew from
  // the committed geometry they overlay.
  const getFrame = useCallback(async (
    cssWidth: number,
    cssHeight: number,
  ): Promise<FrameSnapshot | null> => {
    const result = await sendBatch([
      {
        op: 'renderModel',
        canvasWidth: cssWidth,
        canvasHeight: cssHeight,
        showGrid: false,
        readyImages: [],
      },
      { op: 'sessionState' },
    ]);
    const parsed = parseBatchResult(result);
    const model = lastResultData(parsed, 'renderModel') as RenderModelDto | undefined;
    const session = lastResultData(parsed, 'sessionState') as SessionStateDto | undefined;
    if (!model || !session) return null;
    return { model, session };
  }, [sendBatch]);

  const exportScene = useCallback(async (): Promise<string> => {
    return invoke('export_scene');
  }, []);

  const importScene = useCallback(async (json: string, tracked: boolean): Promise<string> => {
    return invoke('import_scene', { sceneJson: json, tracked });
  }, []);

  if (!engineRef.current) {
    engineRef.current = {
      ready: false,
      failed: false,
      failure: null,
      sendBatch,
      getStatus,
      getFrame,
      getRenderModel,
      getSessionState,
      exportScene,
      importScene,
    };
  }

  engineRef.current.ready = lifecycle === 'ready';
  engineRef.current.failed = lifecycle === 'failed';
  engineRef.current.failure = failure;

  return engineRef.current;
}
