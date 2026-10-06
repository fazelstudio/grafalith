export { EngineClient } from "./client.js";
export type {
  BatchResult,
  DrawBounds,
  DrawSnapshot,
  EnginePort,
  OpResult,
  SessionSnapshot,
} from "./client.js";
export { ExtensionRegistry, OverlayRegistry } from "./extension.js";
export type {
  DrawCalls,
  ExtensionContext,
  ExtensionManifest,
  ExtensionModule,
  OverlayRenderer,
  ToolContribution,
} from "./extension.js";
export type { SdkBatchOp, SdkOpName } from "./protocol.generated.js";
