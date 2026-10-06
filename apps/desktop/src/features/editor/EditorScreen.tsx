import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useEngine, type FrameSnapshot } from '../../hooks/useEngine';
import { useI18n } from '../../app/i18n/resources';
import { notifyBootDataReady } from '../../app/boot';
import { Button, EmptyState, LoadingState } from '../../ui/primitives/controls';
import { Dialog } from '../../ui/primitives/overlays';
import { toolRegistry, executeCommand, type CommandContext, type ViewActions } from '../../registries';
import { commandResultMessage } from './engineGaps';
import { normalizeSelection } from './selection';
import { useEditorShortcuts } from './shortcuts/useEditorShortcuts';
import { CommandPalette } from './palette/CommandPalette';
import { Canvas } from './Canvas';
import { EditorTopBar } from './EditorTopBar';
import { EditorToolbar } from './EditorToolbar';
import { EditorStatusBar } from './EditorStatusBar';
import { PanelHost } from './panels/PanelHost';
import { useProjectPersistence } from './useProjectPersistence';
import { useProjectSession } from './useProjectSession';
import { useToast } from '../../app/shell/ToastProvider';
import {
  type EditorWorkspace,
} from '../../platform/preferences/editorWorkspace';
import { preferenceService } from '../../platform/preferences/preferenceService';
import type { ViewportState } from '../../render/coords';
import './editor.css';

interface EditorScreenProps {
  projectId: string;
  onBackToHome: () => void;
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
 * Design-editor workspace: top bar, registry-driven toolbar, canvas
 * viewport with engine-owned state, docked panels, and status line. The
 * engine owns document, selection, and viewport; React mirrors them for
 * chrome and panels through the shared frame snapshot. All user intents
 * flow through one command registry; shortcuts, menus, palette, toolbar,
 * and context menu share that source.
 */
export function EditorScreen({ projectId, onBackToHome }: EditorScreenProps) {
  const engine = useEngine();
  const { t } = useI18n();
  const { notify } = useToast();
  const [workspace, setWorkspace] = useState<EditorWorkspace>(() => preferenceService.getWorkspace());
  const [frame, setFrame] = useState<FrameSnapshot | null>(null);
  const [rendererFailed, setRendererFailed] = useState(false);
  const [canvasKey, setCanvasKey] = useState(0);
  const [protocolVersion, setProtocolVersion] = useState<number | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const restoredRef = useRef<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { session, retry } = useProjectSession(engine, projectId);
  const sessionKind = session.kind;
  useEffect(() => {
    // Settled session (ready or failed) means first content is ready to show.
    if (sessionKind !== 'opening') notifyBootDataReady();
  }, [sessionKind]);
  const { saveState, saveNow, flushForClose, recovery, restoreRecovery, discardRecovery } =
    useProjectPersistence(engine, projectId, session.kind === 'ready');
  const [closeDialogOpen, setCloseDialogOpen] = useState(false);
  const [closing, setClosing] = useState(false);

  const activeTool = workspace.activeTool;
  const openPanels = workspace.openPanels;

  useEffect(() => {
    preferenceService.setWorkspace(workspace);
  }, [workspace]);

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  const handleTogglePanel = useCallback((id: string) => {
    setWorkspace((prev) => ({
      ...prev,
      openPanels: prev.openPanels.includes(id)
        ? prev.openPanels.filter((open) => open !== id)
        : [...prev.openPanels, id],
    }));
  }, []);

  const dismissHint = useCallback(() => {
    setWorkspace((prev) => ({ ...prev, hintDismissed: true }));
  }, []);

  const openPalette = useCallback(() => setPaletteOpen(true), []);
  const closePalette = useCallback(() => setPaletteOpen(false), []);

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
    link.download = 'nary-scene.json';
    link.click();
    URL.revokeObjectURL(url);
  }, [engine]);

  const handleImportScene = useCallback(async () => {
    fileInputRef.current?.click();
  }, []);

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
      files: session.kind === 'ready' ? { exportScene: handleExportScene, importScene: handleImportScene } : undefined,
      ui: { openPalette },
    };
  }, [engine, frame, activeTool, session.kind, handleExportScene, handleImportScene, openPalette, viewActions]);

  useEditorShortcuts({
    context: commandContext,
    paletteOpen,
    onToolChange: handleToolChange,
    notify,
    t,
  });

  // Project save stays outside the command registry (persistence lifecycle,
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

  const handlePaletteExecute = useCallback(
    async (id: string) => {
      setPaletteOpen(false);
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
      const normalizedIds = normalizeSelection(ids, live);
      // Additive toggles one row; unknown ids are already dropped.
      const next =
        additive && normalizedIds.length === 1
          ? current.includes(normalizedIds[0])
            ? current.filter((id) => id !== normalizedIds[0])
            : [...current, normalizedIds[0]]
          : normalizedIds;
      void engine.sendBatch([{ op: 'select', ids: next }]);
    },
    [engine, frame],
  );

  const saveLabel =
    saveState.kind === 'saved'
      ? t('editor.project.saved')
      : saveState.kind === 'saving'
        ? t('editor.project.saving')
        : saveState.kind === 'save-failed'
          ? t('editor.project.saveFailed')
          : saveState.kind === 'recovering'
            ? t('editor.project.recovering')
            : t('editor.project.unsavedChanges');

  // Explicit close lifecycle: saved closes at once, saving waits for the
  // in-flight write, dirty asks to save first, and save-failed preserves
  // the recovery snapshot instead of discarding it silently.
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
    // A failed save keeps its recovery snapshot so the next open can still
    // offer the unsaved work back; a plain dirty discard clears it.
    if (saveState.kind !== 'save-failed') discardRecovery();
    setCloseDialogOpen(false);
    onBackToHome();
  }, [discardRecovery, onBackToHome, saveState.kind]);

  const handleRestoreRecovery = useCallback(async () => {
    const ok = await restoreRecovery();
    if (!ok) notify(t('editor.project.saveFailed'));
  }, [notify, restoreRecovery, t]);

  // Desktop reliability: attempt a save when the page hides while dirty
  // instead of relying on unload alone.
  useEffect(() => {
    function onHide() {
      if (document.visibilityState === 'hidden' && saveState.kind === 'dirty') saveNow();
    }
    document.addEventListener('visibilitychange', onHide);
    return () => document.removeEventListener('visibilitychange', onHide);
  }, [saveNow, saveState.kind]);

  const startingEngine = session.kind === 'opening' && !engine.ready && !engine.failed;
  const showHint =
    session.kind === 'ready' &&
    !rendererFailed &&
    frame !== null &&
    totalEntries(frame) === 0 &&
    !workspace.hintDismissed;

  return (
    <div className="editor">
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
      {session.kind === 'opening' ? (
        <div className="editor__center">
          <LoadingState
            label={t(startingEngine ? 'editor.errors.engineStarting' : 'editor.project.opening')}
          />
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
          <EditorTopBar
            projectName={session.name}
            saveLabel={saveLabel}
            saveDisabled={
              saveState.kind === 'saving' ||
              saveState.kind === 'saved' ||
              saveState.kind === 'recovering'
            }
            onSave={saveNow}
            onBack={requestClose}
            context={commandContext}
            openPanels={openPanels}
            onTogglePanel={handleTogglePanel}
            onOpenPalette={openPalette}
          />
          {recovery ? (
            <div className="editor__banner" role="alert">
              <span>{t('editor.project.recoveryAvailable')}</span>
              <Button variant="secondary" size="sm" onClick={() => void handleRestoreRecovery()}>
                {t('editor.project.recoveryRestore')}
              </Button>
              <Button variant="ghost" size="sm" onClick={discardRecovery}>
                {t('editor.project.recoveryDiscard')}
              </Button>
            </div>
          ) : null}
          <EditorToolbar
            activeTool={activeTool}
            onToolChange={handleToolChange}
            context={commandContext}
          />
          <div className="editor-workspace">
            {openPanels.includes('layers') ? (
              <aside className="editor-dock editor-dock--left" aria-label={t('editor.panels.layers')}>
                <PanelHost
                  location="left"
                  frame={frame}
                  onSelect={handleSelect}
                  engine={engine}
                  sendBatch={engine.sendBatch}
                  commandContext={commandContext}
                />
              </aside>
            ) : null}
            <div className="editor-canvaswrap">
              <div className="editor__canvas">
                <Canvas
                  key={canvasKey}
                  engine={engine}
                  activeTool={activeTool}
                  onFrame={handleFrame}
                  onRenderError={handleRenderError}
                  commandContext={commandContext}
                  onViewActions={handleViewActionsReady}
                />
              </div>
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
                  <span>{t('editor.hint.text')}</span>
                  <Button variant="ghost" size="sm" onClick={dismissHint} title={t('editor.hint.dismiss')}>
                    {t('editor.hint.dismiss')}
                  </Button>
                </div>
              ) : null}
            </div>
            {openPanels.includes('inspector') ? (
              <aside
                className="editor-dock editor-dock--right"
                aria-label={t('editor.panels.inspector')}
              >
                <PanelHost
                  location="right"
                  frame={frame}
                  onSelect={handleSelect}
                  engine={engine}
                  sendBatch={engine.sendBatch}
                  commandContext={commandContext}
                />
              </aside>
            ) : null}
          </div>
          <EditorStatusBar frame={frame} protocolVersion={protocolVersion} />
          <CommandPalette
            open={paletteOpen}
            context={commandContext}
            onClose={closePalette}
            onExecute={(id) => void handlePaletteExecute(id)}
          />
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
