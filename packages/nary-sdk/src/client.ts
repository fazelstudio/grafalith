import type { SdkBatchOp } from "./protocol.generated.js";

/** Minimal engine surface the client drives (satisfied by JsEngine). */
export interface EnginePort {
  apply_batch(batchJson: string): string;
  element_count(): number;
}

export interface OpResult {
  op: string;
  ok: boolean;
  code?: string;
  message?: string;
  data?: unknown;
}

export interface BatchResult {
  version: number;
  applied: number;
  results: OpResult[];
}

export interface SessionSnapshot {
  selection: string[];
  tool: string;
  canUndo: boolean;
  canRedo: boolean;
  viewport: { scrollX: number; scrollY: number; zoom: number };
}

export interface DrawBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface DrawSnapshot {
  id: string;
  kind: string;
  bounds: DrawBounds;
}

function asData(result: BatchResult, op: string): unknown {
  const first = result.results[0];
  if (!first || first.op !== op || !first.ok) {
    throw new Error(
      `engine call ${op} failed: ${first?.code ?? "unknown"} ${first?.message ?? ""}`,
    );
  }
  return first.data;
}

/** Typed host client over the JSON-string protocol (VSCode `vscode` analog). */
export class EngineClient {
  constructor(private readonly engine: EnginePort) {}

  /** One crossing, many intents — the batching rule. */
  batch(ops: SdkBatchOp[]): BatchResult {
    return JSON.parse(this.engine.apply_batch(JSON.stringify(ops))) as BatchResult;
  }

  activateTool(tool: string): boolean {
    const data = asData(this.batch([{ op: "setTool", tool }]), "setTool") as {
      accepted: boolean;
    };
    return data.accepted;
  }

  createElement(element: Record<string, unknown>): string {
    const data = asData(this.batch([{ op: "create", element }]), "create") as {
      ids: string[];
    };
    return data.ids[0];
  }

  select(ids: string[]): number {
    const data = asData(this.batch([{ op: "select", ids }]), "select") as {
      selected: number;
    };
    return data.selected;
  }

  undo(): boolean {
    return (asData(this.batch([{ op: "undo" }]), "undo") as { undone: boolean })
      .undone;
  }

  redo(): boolean {
    return (asData(this.batch([{ op: "redo" }]), "redo") as { redone: boolean })
      .redone;
  }

  deleteSelected(): void {
    asData(this.batch([{ op: "deleteSelected" }]), "deleteSelected");
  }

  sessionState(): SessionSnapshot {
    return asData(this.batch([{ op: "sessionState" }]), "sessionState") as SessionSnapshot;
  }

  renderEntries(canvasWidth: number, canvasHeight: number): DrawSnapshot[] {
    const data = asData(
      this.batch([{ op: "renderModel", canvasWidth, canvasHeight }]),
      "renderModel",
    ) as { base: DrawSnapshot[] };
    return data.base;
  }

  drainEvents(): unknown[] {
    const data = asData(this.batch([{ op: "drainEvents" }]), "drainEvents") as {
      events: unknown[];
    };
    return data.events;
  }
}
