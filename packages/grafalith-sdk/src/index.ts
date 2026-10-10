export { EngineClient } from "./client.js";
export type {
  BatchResult,
  DrawBounds,
  DrawSnapshot,
  EnginePort,
  OpResult,
  SessionSnapshot,
} from "./client.js";
export {
  ExtensionRegistry,
  OverlayRegistry,
  activationMatches,
  createEngineOnlyRegistry,
  orderForActivation,
  shouldActivate,
} from "./extension.js";
export type {
  ActivationTrigger,
  DrawCalls,
  ExtensionContext,
  ExtensionManifest,
  ExtensionModule,
  OverlayRenderer,
  ToolContribution,
} from "./extension.js";
export { ExtensionCommandRegistry } from "./commands.js";
export type { Disposable, ExtensionCommandHandler, ExtensionCommandPredicate } from "./commands.js";
export { DisposableCollection, combineDisposables } from "./disposable.js";
export { MemoryOutputChannel, SYSTEM_OUTPUT_CHANNEL } from "./output.js";
export type { OutputChannel } from "./output.js";
export {
  GRLT_EXTENSION,
  GRLT_FORMAT_VERSION,
  GRLT_MANIFEST_FILENAME,
  grltPackageId,
  satisfiesEngines,
  validateGrltManifest,
} from "./manifest.js";
export type {
  GrltCommandContribution,
  GrltConfigContribution,
  GrltContributes,
  GrltDiagramContribution,
  GrltEditorToolContribution,
  GrltAssetProviderContribution,
  GrltHomeWidgetContribution,
  GrltKeybindingContribution,
  GrltManifest,
  GrltMenuPlacement,
  GrltModalContribution,
  GrltPermission,
  GrltProjectTemplateContribution,
  GrltThemeContribution,
  GrltToolbarContribution,
  GrltViewContribution,
} from "./manifest.js";
export { validateContributions } from "./contributions.js";
export type { ContributionHost } from "./contributions.js";
export { ContextKeyService, evaluateWhen } from "./contextKeys.js";
export type { BuiltinContextKey } from "./contextKeys.js";
export { GrafalithEventBus } from "./events.js";
export type { GrafalithEventName } from "./events.js";
export { resolveEnv } from "./env.js";
export type { EnvInfo } from "./env.js";
export { KeybindingRegistry } from "./keybindings.js";
export type { Keybinding } from "./keybindings.js";
export { createMemorySettings } from "./settings.js";
export type { SettingsApi, SettingsSection } from "./settings.js";
export { createMemoryStorage } from "./storage.js";
export type { ExtensionStorage } from "./storage.js";
export { createMemoryClipboard, createMemoryFilesystem } from "./hostCapabilities.js";
export type { ClipboardApi, FilesystemApi } from "./hostCapabilities.js";
export { createGrafalithApi } from "./grafalith.js";
export type {
  ActivityBarItem,
  Asset,
  CanvasOverlay,
  ColorPalette,
  DesignTool,
  DiagramType,
  EditorKind,
  Exporter,
  FontProvider,
  GradientPreset,
  HomeWidget,
  Importer,
  InspectorSection,
  MenuItem,
  GrafalithApi,
  GrafalithHost,
  PanelContribution,
  ProjectTemplate,
  ShapeType,
  SnapBehavior,
  StatusBarItem,
  StylePreset,
  ToastRequest,
  ToolEditorScope,
  ToolbarTool,
  Viewport,
} from "./grafalith.js";
export { MemoryWindowApi } from "./window.js";
export type {
  CancellationToken,
  DialogResult,
  InputBoxOptions,
  NotificationAction,
  NotificationLevel,
  NotificationOptions,
  ExtensionStatusBarItem,
  ProgressReporter,
  QuickPickItem,
  QuickPickOptions,
  WindowApi,
} from "./window.js";
export { ExtensionEvent, ExtensionMemento, createMemoryWorkspace } from "./workspace.js";
export type { ConfigStore, WorkspaceApi, WorkspaceEvents } from "./workspace.js";
export type { SdkBatchOp, SdkOpName } from "./protocol.generated.js";
