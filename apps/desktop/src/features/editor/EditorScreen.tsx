import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useEngine, type FrameSnapshot } from '../../hooks/useEngine';
import { useI18n } from '../../app/i18n/resources';
import { useTheme } from '../../app/theme/ThemeProvider';
import { themeTokens } from '../../app/theme/tokens';
import { notifyBootDataReady } from '../../app/boot';
import { Button, EmptyState, LoadingState } from '../../ui/primitives/controls';
import { Dialog } from '../../ui/primitives/overlays';
import {
  toolRegistry,
  executeCommand,
  executeAppCommand,
  executeUnifiedRow,
  type AppCommandContext,
  type CommandContext,
  type UnifiedPaletteRow,
  type ViewActions,
} from '../../registries';
import { commandResultMessage } from './engineGaps';
import { exportPngImage, pngFileName } from './exportPng';
import { exportSvgImage, svgFileName } from './exportSvg';
import { exportPdfBlob, pdfFileName } from './exportPdf';
import { normalizeSelection } from './selection';
import { useEditorShortcuts } from './shortcuts/useEditorShortcuts';
import { TitlebarQuickSwitcher } from './quickswitcher/QuickSwitcher';
import { CreateProjectDialog } from '../home/ProjectDialogs';
import { SettingsModal } from '../settings/SettingsModal';
import { getProjectStore } from '../../platform/projects/projectService';
import { getExtensionHost } from '../../platform/extensions/extensionHost';
import { getContextKeys } from '../../platform/context/contextKeys';
import { isTauriRuntime } from '../../platform/projects/tauriAdapter';
import {
  normalizeProjectKind,
  parseProjectError,
  type ProjectCanvas,
  type ProjectKind,
} from '../../platform/projects/types';
import { projectKindHintKey, templateForKind } from '../projects/projectKinds';
import { Canvas } from './Canvas';
import type { FillPreview } from '../../render/drawModel';
import { EditorTopBar } from './EditorTopBar';
import { EditorToolbar } from './EditorToolbar';
import { EditorStatusBar } from './EditorStatusBar';
import { PanelHost } from './panels/PanelHost';
import { useProjectPersistence } from './useProjectPersistence';
import { useProjectSession } from './useProjectSession';
import { useToast } from '../../app/shell/ToastProvider';
import { preferenceService } from '../../platform/preferences/preferenceService';
import type { EditorWorkspace } from '../../platform/preferences/editorWorkspace';
import type { ViewportState } from '../../render/coords';
import { SettingsIcon } from '../../ui/icons';
import { Tooltip } from '../../ui/primitives/tooltip';
import { DesignEditor } from './editors/DesignEditor';
import { SlidesEditor } from './editors/SlidesEditor';
import { WhiteboardEditor } from './editors/WhiteboardEditor';
import './editor.css';

interface EditorScreenProps {
  projectId: string;
  onBackToHome: () => void;
  onOpenProject: (id: string) => void;
}

function totalEntries(frame: FrameSnapshot): number {
  let count = frame.model.base.length;
  for (const pass of frame.model.frames) {
    count += 1 + pass.children.length;
  }
  return count;
}

function allDocumentIds(frame: FrameSnapshot | null): string[] {
  if (!frame) return [];
  const ids: string[] = [];
  for (const entry of frame.model.base) ids.push(entry.id);
  for (const pass of frame.model.frames) {
    ids.push(pass.frame.id);
    for (const child of pass.children) ids.push(child.id);
  }
  return ids;
}

function liveIdSet(frame: FrameSnapshot | null): Set<string> {
  return new Set(allDocumentIds(frame));
}

function sameViewport(a: ViewportState, b: ViewportState): boolean {
  return (
    Math.abs(a.scrollX - b.scrollX) < 0.5 &&
    Math.abs(a.scrollY - b.scrollY) < 0.5 &&
    Math.abs(a.zoom - b.zoom) < 0.001
  );
}

/**
 * Editor orchestrator: session, persistence, commands, and window identity.
 * Layout itself lives in `EditorShell` (one master template); the project
 * kind only selects which thin kind editor wraps that shell.
 */
export function EditorScreen({ projectId, onBackToHome, onOpenProject }: EditorScreenProps) {
  const engine = useEngine();
  const { t } = useI18n();
  const { resolved } = useTheme();
  const { notify } = useToast();
  const [workspace, setWorkspace] = useState<EditorWorkspace>(() => preferenceService.getWorkspace());
  const [frame, setFrame] = useState<FrameSnapshot | null>(null);
  const [rendererFailed, setRendererFailed] = useState(false);
  const [canvasKey, setCanvasKey] = useState(0);
  const [protocolVersion, setProtocolVersion] = useState<number | null>(null);
  const [quickOpen, setQuickOpen] = useState<{ open: boolean; initialQuery: string }>({
    open: false,
    initialQuery: '',
  });
  const [createKind, setCreateKind] = useState<ProjectKind | null>(null);
  const [createPending, setCreatePending] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const restoredRef = useRef<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const extensionInputRef = useRef<HTMLInputElement>(null);
  const extensionPickResolve = useRef<((file: File | undefined) => void) | null>(null);
  const { session, retry } = useProjectSession(engine, projectId);
  const sessionKind = session.kind;
  useEffect(() => {
    // Settled session (ready or failed) means first content is ready to show.
    if (sessionKind !== 'opening') notifyBootDataReady();
  }, [sessionKind]);
  useEffect(() => {
    // Project entry never waits for extensions: pause their queue while the
    // project opens, then resume and drain once the session is ready.
    const host = getExtensionHost();
    host.setNotifier((message, options) => notify(message, options));
    host.enqueueStartupActivation();
    if (sessionKind === 'opening') {
      host.pauseExtensions();
    } else if (sessionKind === 'ready') {
      host.resumeExtensions();
      void host.drainStartupQueue();
    }
  }, [sessionKind, notify]);

  const lastSelectionRef = useRef<string>('');
  // Uncommitted fill preview (inspector stop drag) shared from the panels
  // to the canvas loop by ref: drags repaint without re-rendering, and the
  // writer (ColorPicker) owns clearing it on commit, cancel, or close.
  const fillPreviewRef = useRef<FillPreview | null>(null);
  useEffect(() => {
    // Fan selection changes out to active extension workspaces.
    if (session.kind !== 'ready' || !frame) return;
    const key = frame.session.selection.join('\0');
    if (key !== lastSelectionRef.current) {
      lastSelectionRef.current = key;
      getExtensionHost().emitSelection(frame.session.selection);
    }
  }, [frame, session.kind]);

  const documentOpenedRef = useRef(false);
  useEffect(() => {
    if (session.kind === 'ready') {
      getExtensionHost().emitDocument(projectId);
      documentOpenedRef.current = true;
    }
    return () => {
      // Only close what this screen actually opened: opening→ready churn
      // and unmounts before ready must not emit a phantom close.
      if (documentOpenedRef.current) {
        documentOpenedRef.current = false;
        getExtensionHost().emitProjectClosed(projectId);
      }
    };
  }, [session.kind, projectId]);

  const { saveState, saveNow, flushForClose } = useProjectPersistence(
    engine,
    projectId,
    session.kind === 'ready',
  );
  const dirty = saveState.kind !== 'saved';
  const projectKind: ProjectKind =
    session.kind === 'ready' ? normalizeProjectKind(session.projectKind) : 'design';
  const [closeDialogOpen, setCloseDialogOpen] = useState(false);
  const [closing, setClosing] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const activeTool = workspace.activeTool;

  useEffect(() => {
    // Keep central context keys current so `when` clauses, palette rows,
    // and extension tools gate on live editor state.
    if (session.kind !== 'ready') return;
    const selectedCount = frame?.session.selection.length ?? 0;
    getContextKeys().syncEditorState({
      screen: 'editor',
      editorType: projectKind,
      hasActiveProject: true,
      selectedCount,
      activeTool,
      layerSelected: selectedCount > 0,
    });
    getExtensionHost().emitActiveEditor(projectKind);
  }, [session.kind, projectId, projectKind, activeTool, frame]);

  useEffect(() => {
    preferenceService.setWorkspace(workspace);
  }, [workspace]);

  // Window identity follows the localized app name ("<name>[*] - Grafalith")
  // while a project is open so the OS frame matches the titlebar capsule,
  // including the dirty marker.
  const appName = t('common.appName');
  useEffect(() => {
    if (session.kind !== 'ready') return;
    const title = `${session.name}${dirty ? '*' : ''} - ${appName}`;
    document.title = title;
    let cancelled = false;
    (async () => {
      try {
        if (!isTauriRuntime()) return;
        const { getCurrentWindow } = await import('@tauri-apps/api/window');
        if (!cancelled) await getCurrentWindow().setTitle(title);
      } catch {
        // Browser preview or missing permission: document title still applies.
      }
    })();
    return () => {
      cancelled = true;
      document.title = appName;
    };
  }, [session, dirty, appName]);

  useEffect(() => {
    if (session.kind !== 'ready') return;
    setWorkspace((previous) =>
      previous.activeTool === 'select' ? previous : { ...previous, activeTool: 'select' },
    );
  }, [projectId, session.kind]);

  useEffect(() => {
    if (!engine.ready) return;
    let cancelled = false;
    engine
      .getStatus()
      .then((status) => {
        if (!cancelled) setProtocolVersion(status.protocolVersion);
      })
      .catch(() => {
        // Protocol badge stays hidden; the status line still works.
      });
    return () => {
      cancelled = true;
    };
  }, [engine, engine.ready]);

  // Restore the last viewport for this document once it opens, unless the
  // workspace preference disables it (settings -> editor).
  useEffect(() => {
    if (session.kind !== 'ready' || !engine.ready || restoredRef.current === projectId) return;
    restoredRef.current = projectId;
    const saved = workspace.restoreViewport ? workspace.viewports[projectId] : undefined;
    if (saved) {
      void engine.sendBatch([{ op: 'setViewport', ...saved }]);
    }
    // Intentionally one-shot per document; later viewports persist below.
  }, [session, engine, projectId]);

  // Persist viewport movement for this document as the engine reports it.
  useEffect(() => {
    if (!frame || session.kind !== 'ready') return;
    const viewport = frame.session.viewport;
    setWorkspace((prev) => {
      const saved = prev.viewports[projectId];
      if (saved && sameViewport(saved, viewport)) return prev;
      return { ...prev, viewports: { ...prev.viewports, [projectId]: { ...viewport } } };
    });
  }, [frame, session, projectId]);

  const handleFrame = useCallback((snapshot: FrameSnapshot) => {
    setFrame(snapshot);
  }, []);

  const handleRenderError = useCallback(() => {
    setRendererFailed(true);
  }, []);

  const retryRenderer = useCallback(() => {
    setRendererFailed(false);
    setCanvasKey((key) => key + 1);
  }, []);

  const handleToolChange = useCallback((tool: string) => {
    if (!toolRegistry.get(tool)) return;
    setWorkspace((prev) => (prev.activeTool === tool ? prev : { ...prev, activeTool: tool }));
  }, []);

  const handleToggleSticky = useCallback(() => {
    setWorkspace((prev) => ({ ...prev, stickyTool: !prev.stickyTool }));
  }, []);

  // Keep the engine's canvas-background token aligned with the desktop
  // canvas: new text defaults contrast against this (stored per element,
  // so existing objects never change when the theme switches).
  useEffect(() => {
    if (!engine.ready || session.kind !== 'ready') return;
    const canvasBackground = themeTokens[resolved].colors.canvasBg;
    void engine
      .sendBatch([{ op: 'configure', theme: { colors: { canvasBackground } } }])
      .catch(() => {
        // Text defaults stay usable regardless; the next sync covers it.
      });
  }, [engine, engine.ready, session.kind, resolved]);

  // Apply the project's canvas mode once the session is ready: the engine
  // echoes it in `sessionState` for any host reading the live session.
  useEffect(() => {
    if (!engine.ready || session.kind !== 'ready') return;
    const canvasMode =
      session.canvas.mode === 'fixed'
        ? { mode: 'bounded', width: session.canvas.width, height: session.canvas.height }
        : { mode: 'infinite' };
    void engine.sendBatch([{ op: 'configure', canvasMode }]).catch(() => {
      // Infinite remains the engine default; the next sync covers it.
    });
  }, [engine, engine.ready, session]);

  const dismissHint = useCallback(() => {
    setWorkspace((prev) => ({ ...prev, hintDismissed: true }));
  }, []);

  const openLayers = useCallback(
    () => setQuickOpen({ open: true, initialQuery: '' }),
    [],
  );
  const openCommands = useCallback(
    () => setQuickOpen({ open: true, initialQuery: '>' }),
    [],
  );
  const closeQuick = useCallback(
    () => setQuickOpen((current) => (current.open ? { ...current, open: false } : current)),
    [],
  );

  const [viewActions, setViewActions] = useState<ViewActions | null>(null);
  const handleViewActionsReady = useCallback((actions: ViewActions | null) => {
    setViewActions(actions);
  }, []);

  const handleExportScene = useCallback(async () => {
    const sceneJson = await engine.exportScene();
    const blob = new Blob([sceneJson], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'grafalith-scene.json';
    link.click();
    URL.revokeObjectURL(url);
  }, [engine]);

  const handleImportScene = useCallback(async () => {
    fileInputRef.current?.click();
  }, []);

  const handleExportPng = useCallback(async () => {
    const canvas = session.kind === 'ready' ? session.canvas : { mode: 'infinite', width: 0, height: 0, unit: 'px' } as const;
    const name = session.kind === 'ready' ? session.name : 'grafalith';
    const file = pngFileName(name);
    const blob = await exportPngImage(engine, canvas);
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = file;
    link.click();
    URL.revokeObjectURL(url);
    notify(t('editor.notifications.exportedPng', { file }));
  }, [engine, session, notify, t]);

  const handleExportSvg = useCallback(async () => {
    const canvas = session.kind === 'ready' ? session.canvas : { mode: 'infinite', width: 0, height: 0, unit: 'px' } as const;
    const name = session.kind === 'ready' ? session.name : 'grafalith';
    const file = svgFileName(name);
    const blob = await exportSvgImage(engine, canvas);
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = file;
    link.click();
    URL.revokeObjectURL(url);
    notify(t('editor.notifications.exportedSvg', { file }));
  }, [engine, session, notify, t]);

  const handleExportPdf = useCallback(async () => {
    const canvas = session.kind === 'ready' ? session.canvas : { mode: 'infinite', width: 0, height: 0, unit: 'px' } as const;
    const name = session.kind === 'ready' ? session.name : 'grafalith';
    const file = pdfFileName(name);
    const blob = await exportPdfBlob(engine, canvas);
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = file;
    link.click();
    URL.revokeObjectURL(url);
    notify(t('editor.notifications.exportedPdf', { file }));
  }, [engine, session, notify, t]);

  const handleImportFile = useCallback(
    async (file: File) => {
      try {
        const text = await file.text();
        await engine.importScene(text, true);
      } catch (error) {
        notify(t('editor.errors.commandFailed', { message: error instanceof Error ? error.message : String(error) }));
      } finally {
        if (fileInputRef.current) fileInputRef.current.value = '';
      }
    },
    [engine, notify, t],
  );

  // Single assembled command context for every surface (toolbar, menu,
  // context menu, palette, shortcuts, inspector). Selection is normalized
  // centrally so stale ids never reach commands.
  const commandContext: CommandContext = useMemo(() => {
    const live = liveIdSet(frame);
    const selection = normalizeSelection(frame?.session.selection ?? [], live);
    return {
      engine,
      sendBatch: engine.sendBatch,
      selection,
      canUndo: frame?.session.canUndo ?? false,
      canRedo: frame?.session.canRedo ?? false,
      activeTool,
      viewport: frame?.session.viewport ?? { scrollX: 0, scrollY: 0, zoom: 1 },
      textEditingId: frame?.session.textEditing?.id ?? null,
      documentIds: allDocumentIds(frame),
      view: viewActions ?? undefined,
      files: session.kind === 'ready' ? { exportScene: handleExportScene, importScene: handleImportScene, exportPng: handleExportPng, exportSvg: handleExportSvg, exportPdf: handleExportPdf } : undefined,
      ui: { openPalette: openCommands },
    };
  }, [engine, frame, activeTool, session.kind, handleExportScene, handleImportScene, handleExportPng, handleExportSvg, handleExportPdf, openCommands, viewActions]);

  useEditorShortcuts({
    context: commandContext,
    paletteOpen: quickOpen.open,
    onToolChange: handleToolChange,
    notify,
    t,
    onOpenQuickSwitcher: openLayers,
  });

  // Manual save stays outside the command registry (persistence lifecycle,
  // not an engine intent) but uses one window listener instead of scattered
  // per-component handlers. It works from inputs too.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && (event.key === 's' || event.key === 'S')) {
        event.preventDefault();
        saveNow();
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [saveNow]);

  const handleQuickExecute = useCallback(
    async (id: string) => {
      setQuickOpen((current) => ({ ...current, open: false }));
      const result = await executeCommand(id, commandContext);
      const message = commandResultMessage(id, result, t);
      if (message) notify(message);
    },
    [commandContext, notify, t],
  );

  const handleSelect = useCallback(
    (ids: string[], additive: boolean) => {
      const live = liveIdSet(frame);
      const current = normalizeSelection(frame?.session.selection ?? [], live);
      // Group members act as one unit: any grouped node (element or group)
      // resolves to its outermost container plus every member, so a group
      // click and a member click converge on the same selection.
      const groupIds = new Set((frame?.model.groups ?? []).map((group) => group.id));
      const membersOf = (groupId: string): string[] => {
        const out: string[] = [];
        if (!frame) return out;
        const visit = (entry: { id: string; groupIds: string[] }): void => {
          if (entry.groupIds.includes(groupId)) out.push(entry.id);
        };
        for (const entry of frame.model.base) visit(entry);
        for (const pass of frame.model.frames) {
          for (const child of pass.children) visit(child);
        }
        return out;
      };
      const outermostOf = (elementId: string): string | null => {
        if (!frame) return null;
        const find = (entries: readonly { id: string; groupIds: string[] }[]): readonly string[] | null => {
          const entry = entries.find((candidate) => candidate.id === elementId);
          return entry ? entry.groupIds : null;
        };
        const path = find(frame.model.base) ?? find(frame.model.frames.flatMap((pass) => [pass.frame, ...pass.children]));
        return path && path.length > 0 ? path[path.length - 1] : null;
      };
      const unitMembers = (id: string): string[] => {
        if (groupIds.has(id)) return membersOf(id);
        const outer = outermostOf(id);
        if (outer) return membersOf(outer);
        return live.has(id) ? [id] : [];
      };
      const expand = (list: readonly string[]): string[] => {
        const out: string[] = [];
        const seen = new Set<string>();
        for (const id of list) {
          for (const member of unitMembers(id)) {
            if (!seen.has(member)) {
              seen.add(member);
              out.push(member);
            }
          }
        }
        return out;
      };
      let next: string[];
      if (!additive) {
        next = expand(ids);
      } else {
        // Additive toggles whole units: a unit fully inside the current
        // selection leaves it, otherwise it joins.
        const pending = new Set(current);
        const seenUnit = new Set<string>();
        let touched = false;
        for (const id of ids) {
          const unit = unitMembers(id);
          if (unit.length === 0 || seenUnit.has(unit[0])) continue;
          seenUnit.add(unit[0]);
          touched = true;
          if (unit.every((member) => pending.has(member))) {
            for (const member of unit) pending.delete(member);
          } else {
            for (const member of unit) pending.add(member);
          }
        }
        if (!touched) return;
        next = current.filter((id) => pending.has(id));
        for (const id of pending) {
          if (!next.includes(id)) next.push(id);
        }
      }
      if (next.length === 0) {
        // Genuine clears go through the raw op: the selectIds command
        // refuses empty targets, which would otherwise leave stale ids.
        // The watcher wakes for the cleared session like any other change.
        void engine
          .sendBatch([{ op: 'select', ids: [] }])
          .then(() => viewActions?.refreshFrame?.())
          .catch(() => undefined);
        return;
      }
      const snapshot = frame;
      const selection = normalizeSelection(snapshot?.session.selection ?? [], live);
      const documentIds = snapshot ? allDocumentIds(snapshot) : [];
      const viewport = snapshot?.session.viewport ?? { scrollX: 0, scrollY: 0, zoom: 1 };
      void executeCommand('selectIds', {
        engine,
        sendBatch: engine.sendBatch,
        selection,
        canUndo: snapshot?.session.canUndo ?? false,
        canRedo: snapshot?.session.canRedo ?? false,
        activeTool,
        viewport,
        textEditingId: snapshot?.session.textEditing?.id ?? null,
        documentIds,
        targetIds: next,
        // Without the view channel, runOp cannot wake the frame watcher
        // and programmatic selection would never visibly land.
        view: viewActions ?? undefined,
      });
    },
    [engine, frame, activeTool, viewActions],
  );

  const handleQuickSelect = useCallback(
    (id: string) => {
      setQuickOpen((current) => ({ ...current, open: false }));
      handleSelect([id], false);
    },
    [handleSelect],
  );

  // File menu host actions: project creation reuses the home name dialog so
  // validation stays identical; duplication copies the open project store entry.
  const handleNewProject = useCallback((kind: ProjectKind) => {
    setCreateError(null);
    setCreatePending(false);
    setCreateKind(kind);
  }, []);

  const confirmNewProject = useCallback(
    async (name: string, canvas: ProjectCanvas) => {
      if (createPending || createKind === null) return;
      setCreatePending(true);
      setCreateError(null);
      try {
        const template = templateForKind(createKind);
        const created = await getProjectStore().create(name, template.buildScene(), template.kind, canvas);
        notify(t('projects.notifications.created', { name: created.name }));
        setCreateKind(null);
        onOpenProject(created.id);
      } catch (raw) {
        const error = parseProjectError(raw);
        setCreateError(
          error.code === 'invalid-name'
            ? t(error.messageKey, { details: error.details ?? '' })
            : t('projects.errors.createFailed'),
        );
      } finally {
        setCreatePending(false);
      }
    },
    [createPending, createKind, notify, onOpenProject, t],
  );

  const handleDuplicateProject = useCallback(async () => {
    try {
      const copy = await getProjectStore().duplicate(projectId);
      notify(t('projects.notifications.duplicated', { name: copy.name }));
      onOpenProject(copy.id);
    } catch (raw) {
      const error = parseProjectError(raw);
      notify(
        error.details !== undefined
          ? t(error.messageKey, { details: error.details })
          : t(error.messageKey),
      );
    }
  }, [notify, onOpenProject, projectId, t]);

  // Explicit close lifecycle: saved closes at once, saving waits for the
  // in-flight write, dirty asks to save first.
  const requestClose = useCallback(() => {
    if (saveState.kind === 'saved') {
      onBackToHome();
      return;
    }
    setCloseDialogOpen(true);
  }, [onBackToHome, saveState.kind]);

  const confirmSaveAndClose = useCallback(async () => {
    setClosing(true);
    try {
      const ok = await flushForClose();
      if (ok) {
        setCloseDialogOpen(false);
        onBackToHome();
      }
    } finally {
      setClosing(false);
    }
  }, [flushForClose, onBackToHome]);

  const confirmDiscardAndClose = useCallback(() => {
    setCloseDialogOpen(false);
    onBackToHome();
  }, [onBackToHome]);

  // Single host command context for menubar File rows, status bar actions,
  // and the activity rail. Store-backed project ops reuse the same project
  // store calls as home so both surfaces share one execution path.
  const appContext: AppCommandContext = useMemo(
    () => ({
      navigate: (path: string) => {
        if (path === '#/') requestClose();
      },
      newProject: (kind: string) => handleNewProject(kind as ProjectKind),
      saveProject: () => saveNow(),
      duplicateProject: () => handleDuplicateProject(),
      requestClose,
      openPanels: workspace.openPanels,
      togglePanel: (id: string) =>
        setWorkspace((prev) => ({
          ...prev,
          openPanels: prev.openPanels.includes(id)
            ? prev.openPanels.filter((open) => open !== id)
            : [...prev.openPanels, id],
        })),
      openDialog: (id) => {
        if (id === 'settings') setSettingsOpen(true);
        else if (id === 'quickSwitcher') openCommands();
      },
      notify,
      activateTool: (id: string) => handleToolChange(id),
      toggleStickyTool: () => handleToggleSticky(),
      runViewCommand: (id: string) => handleQuickExecute(id),
      pickExtensionFile: () =>
        new Promise<File | undefined>((resolve) => {
          extensionPickResolve.current = resolve;
          extensionInputRef.current?.click();
          // A dismissed dialog never resolves the click; backstop it.
          setTimeout(() => {
            if (extensionPickResolve.current) {
              extensionPickResolve.current = null;
              resolve(undefined);
            }
          }, 60000);
        }),
      installExtensionBytes: async (bytes: Uint8Array) => getExtensionHost().installFromBytes(bytes),
    }),
    [
      requestClose,
      handleNewProject,
      saveNow,
      handleDuplicateProject,
      workspace.openPanels,
      notify,
      handleToolChange,
      handleToggleSticky,
      openCommands,
      handleQuickExecute,
    ],
  );

  const handleExecuteAppCommand = useCallback(
    async (id: string, patch?: Partial<AppCommandContext>) => {
      const result = await executeAppCommand(id, patch ? { ...appContext, ...patch } : appContext);
      if (result.status === 'disabled') {
        notify(t('editor.errors.commandFailed', { message: id }));
      }
    },
    [appContext, notify, t],
  );

  const handleQuickExecuteUnified = useCallback(
    async (row: UnifiedPaletteRow) => {
      setQuickOpen((current) => ({ ...current, open: false }));
      const outcome = await executeUnifiedRow(row, commandContext, appContext);
      if (!outcome.ok) {
        notify(t('editor.errors.commandFailed', { message: row.id }));
      }
    },
    [commandContext, appContext, notify, t],
  );

  const handleExtensionActivityAction = useCallback(
    async (viewId: string, command: string | undefined) => {
      const host = getExtensionHost();
      if (command) {
        const outcome = await host.executeCommand(command);
        if (!outcome.ok) notify(t('editor.errors.commandFailed', { message: command }));
      } else {
        await host.activateByTrigger({ kind: 'view', viewId });
      }
    },
    [notify, t],
  );

  // Desktop reliability: attempt an autosave when the page hides while dirty
  // instead of relying on unload alone. Respects the autosave preference.
  useEffect(() => {
    function onHide() {
      if (
        document.visibilityState === 'hidden' &&
        saveState.kind === 'dirty' &&
        preferenceService.getAutosaveEnabled()
      ) {
        saveNow();
      }
    }
    document.addEventListener('visibilitychange', onHide);
    return () => document.removeEventListener('visibilitychange', onHide);
  }, [saveNow, saveState.kind]);

  const startingEngine = session.kind === 'opening' && !engine.ready && !engine.failed;
  const openingLabel =
    startingEngine
      ? t('editor.errors.engineStarting')
      : session.kind !== 'opening'
      ? t('editor.project.opening')
      : session.stage === 'read'
        ? t('editor.project.openingRead')
        : session.stage === 'validate'
          ? t('editor.project.openingValidate')
          : session.stage === 'initialize'
            ? t('editor.project.openingInitialize')
            : t('editor.project.opening');
  const showHint =
    session.kind === 'ready' &&
    !rendererFailed &&
    frame !== null &&
    totalEntries(frame) === 0 &&
    !workspace.hintDismissed;

  const overlays = (
    <>
      {rendererFailed ? (
        <div className="editor-overlay" role="alert">
          <div className="editor-overlay__title">{t('editor.errors.rendererFailed')}</div>
          <div className="editor-overlay__hint">{t('editor.errors.rendererDescription')}</div>
          <Button variant="secondary" size="sm" onClick={retryRenderer}>
            {t('common.actions.retry')}
          </Button>
        </div>
      ) : null}
      {showHint ? (
        <div className="editor-hint">
          <span>{t(projectKindHintKey(projectKind))}</span>
          <Button variant="ghost" size="sm" onClick={dismissHint}>
            {t('editor.hint.dismiss')}
          </Button>
        </div>
      ) : null}
    </>
  );

  const shellProps = {
    workspace,
    onWorkspaceChange: setWorkspace,
    onExtensionActivityAction: (viewId: string, command: string | undefined) =>
      void handleExtensionActivityAction(viewId, command),
    menubar: (
      <EditorTopBar
        context={commandContext}
        appContext={appContext}
        onExecuteAppCommand={(id, patch) => void handleExecuteAppCommand(id, patch)}
      />
    ),
    canvas: (
      <Canvas
        key={canvasKey}
        engine={engine}
        activeTool={activeTool}
        stickyTool={workspace.stickyTool}
        fillPreviewRef={fillPreviewRef}
        onFrame={handleFrame}
        onRenderError={handleRenderError}
        commandContext={commandContext}
        onViewActions={handleViewActionsReady}
        onToolChange={handleToolChange}
      />
    ),
    toolbar: (
      <EditorToolbar
        activeTool={activeTool}
        onToolChange={handleToolChange}
        kind={projectKind}
        stickyTool={workspace.stickyTool}
        onToggleSticky={handleToggleSticky}
      />
    ),
    overlays,
      leftDock: (
        <PanelHost
          location="left"
          frame={frame}
          onSelect={handleSelect}
          engine={engine}
          sendBatch={engine.sendBatch}
          commandContext={commandContext}
          projectId={projectId}
          fillPreviewRef={fillPreviewRef}
        />
      ),
      rightDock: (
        <PanelHost
          location="right"
          frame={frame}
          onSelect={handleSelect}
          engine={engine}
          sendBatch={engine.sendBatch}
          commandContext={commandContext}
          projectId={projectId}
          fillPreviewRef={fillPreviewRef}
        showInteractionTab={projectKind === 'design' && session.kind === 'ready' && session.canvas.mode === 'infinite'}
      />
    ),
    statusBar: (
      <EditorStatusBar
        frame={frame}
        protocolVersion={protocolVersion}
        context={commandContext}
        appContext={appContext}
        onExecuteCommand={(id) => void handleQuickExecute(id)}
        onExecuteAppCommand={(id) => void handleExecuteAppCommand(id)}
        onExecuteExtensionCommand={(id) => void handleExtensionActivityAction(id, id)}
      />
    ),
    activityBarFooter: (
      <Tooltip content={t('settings.title')} placement="right">
        <button
          type="button"
          className="editor-activitybar__item"
          aria-label={t('settings.title')}
          onClick={() => void handleExecuteAppCommand('dialog.openSettings')}
        >
          <SettingsIcon size={20} />
        </button>
      </Tooltip>
    ),
  };

  return (
    <div className="editor-screen">
      <input
        ref={fileInputRef}
        type="file"
        accept="application/json,.json"
        aria-label={t('editor.toolbar.import')}
        style={{ display: 'none' }}
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void handleImportFile(file);
        }}
      />
      <input
        ref={extensionInputRef}
        type="file"
        accept=".grlt,application/zip"
        aria-label={t('editor.menu.installExtension')}
        style={{ display: 'none' }}
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          const resolve = extensionPickResolve.current;
          extensionPickResolve.current = null;
          resolve?.(file);
        }}
      />
      {session.kind === 'opening' ? (
        <div className="editor__center">
          <LoadingState label={openingLabel} />
        </div>
      ) : null}
      {session.kind === 'failed' ? (
        <div className="editor__center">
          <EmptyState
            title={
              session.error.details !== undefined
                ? t(session.error.messageKey, { details: session.error.details })
                : t(session.error.messageKey)
            }
            description={
              session.error.details !== undefined
                ? t('projects.errors.technicalDetails', { details: session.error.details })
                : undefined
            }
            action={
              <div className="editor__center-actions">
                <Button variant="secondary" onClick={retry}>
                  {t('common.actions.retry')}
                </Button>
                <Button variant="primary" onClick={onBackToHome}>
                  {t('navigation.backToHome')}
                </Button>
              </div>
            }
          />
        </div>
      ) : null}
      {session.kind === 'ready' ? (
        <>
          <TitlebarQuickSwitcher
            projectName={session.name}
            dirty={dirty}
            open={quickOpen.open}
            initialQuery={quickOpen.initialQuery}
            frame={frame}
            context={commandContext}
            appContext={appContext}
            onPillClick={() => {
              if (quickOpen.open) closeQuick();
              else openLayers();
            }}
            onClose={closeQuick}
            onExecuteCommand={(row) => void handleQuickExecuteUnified(row)}
            onSelectLayer={handleQuickSelect}
          />
          {projectKind === 'whiteboard' ? (
            <WhiteboardEditor {...shellProps} />
          ) : projectKind === 'slides' ? (
            <SlidesEditor {...shellProps} />
          ) : (
            <DesignEditor {...shellProps} />
          )}
          {createKind !== null ? (
            <CreateProjectDialog
              kind={createKind}
              onClose={() => {
                if (!createPending) setCreateKind(null);
              }}
              onConfirm={(name, canvas) => void confirmNewProject(name, canvas)}
              pending={createPending}
              error={createError}
            />
          ) : null}
          {settingsOpen ? <SettingsModal onClose={() => setSettingsOpen(false)} /> : null}
          {closeDialogOpen ? (
            <Dialog
              title={t('editor.project.closeTitle')}
              description={t('editor.project.closeDescription')}
              onClose={() => {
                if (!closing) setCloseDialogOpen(false);
              }}
              actions={
                <>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setCloseDialogOpen(false)}
                    disabled={closing}
                  >
                    {t('editor.project.closeCancel')}
                  </Button>
                  <Button variant="secondary" size="sm" onClick={confirmDiscardAndClose} disabled={closing}>
                    {t('editor.project.closeDiscard')}
                  </Button>
                  <Button variant="primary" size="sm" onClick={() => void confirmSaveAndClose()} disabled={closing}>
                    {closing ? t('editor.project.closeWaiting') : t('editor.project.closeSave')}
                  </Button>
                </>
              }
            />
          ) : null}
        </>
      ) : null}
    </div>
  );
}
