import { useRef, type ReactNode } from 'react';
import { useI18n } from '../../../app/i18n/resources';
import type { ProjectKind } from '../../../platform/projects/types';
import {
  EDITOR_DOCK_WIDTHS,
  type EditorWorkspace,
} from '../../../platform/preferences/editorWorkspace';
import { panelsFor } from '../../../registries';
import { ChevronLeftIcon, ChevronRightIcon } from '../../../ui/icons';
import { Tooltip } from '../../../ui/primitives/tooltip';
import { EditorActivityBar } from '../EditorActivityBar';

export interface EditorShellProps {
  /** Editor family; selects kind-specific chrome while the layout stays shared. */
  editorKind: ProjectKind;
  /** Controlled workspace chrome; owned by the screen so viewport state persists. */
  workspace: EditorWorkspace;
  onWorkspaceChange: (next: EditorWorkspace) => void;
  menubar: ReactNode;
  canvas: ReactNode;
  toolbar: ReactNode;
  overlays: ReactNode;
  leftDock: ReactNode;
  rightDock: ReactNode;
  statusBar: ReactNode;
  /** Pinned activity-bar bottom slot; the screen supplies it (e.g. settings). */
  activityBarFooter?: ReactNode;
  /** Extension rail action (command click or view activation). */
  onExtensionActivityAction?: (viewId: string, command: string | undefined) => void;
}

function DockToggle({
  side,
  open,
  onToggle,
}: {
  side: 'left' | 'right';
  open: boolean;
  onToggle: () => void;
}) {
  const { t } = useI18n();
  const panel = panelsFor(side)[0];
  if (!panel) return null;
  const label = t(panel.toggleKey);
  const Icon = open
    ? side === 'left'
      ? ChevronLeftIcon
      : ChevronRightIcon
    : side === 'left'
      ? ChevronRightIcon
      : ChevronLeftIcon;

  return (
    <Tooltip content={label} placement={side === 'left' ? 'right' : 'left'}>
      <button
        type="button"
        className="editor-dock__toggle"
        aria-label={label}
        aria-controls={`editor-dock-${side}`}
        aria-expanded={open}
        onClick={onToggle}
      >
        <Icon size={14} />
      </button>
    </Tooltip>
  );
}

/**
 * Master editor layout shared by every editor family (design, whiteboard,
 * slides). The six regions — menubar, activity bar, left dock, canvas,
 * right dock, status bar — render here exactly once, so default widths,
 * min/max clamps, and expand/collapse behave identically everywhere.
 * Kind editors supply only content slots, never their own layout.
 */
export function EditorShell({
  editorKind,
  workspace,
  onWorkspaceChange,
  menubar,
  canvas,
  toolbar,
  overlays,
  leftDock,
  rightDock,
  statusBar,
  activityBarFooter,
  onExtensionActivityAction,
}: EditorShellProps) {
  const { t } = useI18n();
  const openPanels = workspace.openPanels;
  const resizeRef = useRef<{ side: 'left' | 'right'; startX: number; startWidth: number } | null>(null);
  const dragWidthRef = useRef<{ side: 'left' | 'right'; width: number } | null>(null);
  const dockRefs = useRef<{ left: HTMLElement | null; right: HTMLElement | null }>({ left: null, right: null });

  function handleTogglePanel(id: string) {
    onWorkspaceChange({
      ...workspace,
      openPanels: openPanels.includes(id)
        ? openPanels.filter((open) => open !== id)
        : [...openPanels, id],
    });
  }

  function handleDockPointerDown(side: 'left' | 'right', event: React.PointerEvent<HTMLDivElement>) {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    resizeRef.current = {
      side,
      startX: event.clientX,
      startWidth: side === 'left' ? workspace.leftPanelWidth : workspace.rightPanelWidth,
    };
  }

  function handleDockPointerMove(event: React.PointerEvent<HTMLDivElement>) {
    const resize = resizeRef.current;
    if (!resize) return;
    const delta = event.clientX - resize.startX;
    const signedDelta = resize.side === 'left' ? delta : -delta;
    const width = Math.min(
      EDITOR_DOCK_WIDTHS.max,
      Math.max(EDITOR_DOCK_WIDTHS.min, Math.round(resize.startWidth + signedDelta)),
    );
    // Transient drag paint: write the width straight to the dock node so
    // the drag stays light — no workspace state, no persistence, no tree
    // re-render until release. The single commit lands on pointer-up.
    dragWidthRef.current = { side: resize.side, width };
    dockRefs.current[resize.side]?.style.setProperty('width', `${width}px`);
  }

  function handleDockPointerUp(event: React.PointerEvent<HTMLDivElement>) {
    const drag = dragWidthRef.current;
    dragWidthRef.current = null;
    resizeRef.current = null;
    event.currentTarget.releasePointerCapture(event.pointerId);
    if (!drag) return;
    const key = drag.side === 'left' ? 'leftPanelWidth' : 'rightPanelWidth';
    if (workspace[key] !== drag.width) {
      onWorkspaceChange({ ...workspace, [key]: drag.width });
    }
  }

  function handleDockPointerCancel(event: React.PointerEvent<HTMLDivElement>) {
    // Cancelled drags discard the transient width: nothing was committed.
    dragWidthRef.current = null;
    resizeRef.current = null;
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      // Detached node: nothing to release.
    }
  }

  function renderDock(side: 'left' | 'right', content: ReactNode) {
    const panel = panelsFor(side)[0];
    if (!panel) return null;
    const open = openPanels.includes(panel.id);
    const width = side === 'left' ? workspace.leftPanelWidth : workspace.rightPanelWidth;
    return (
      <aside
        id={`editor-dock-${side}`}
        ref={(node) => {
          dockRefs.current[side] = node;
        }}
        className={`editor-dock editor-dock--${side}${open ? '' : ' editor-dock--collapsed'}`}
        aria-label={t(panel.labelKey)}
        style={{ width: open ? width : 0 }}
      >
        <div className="editor-dock__toolbar">
          <DockToggle side={side} open={open} onToggle={() => handleTogglePanel(panel.id)} />
        </div>
        {open ? <div className="editor-dock__content">{content}</div> : null}
        {open ? (
          <div
            className={`editor-dock__resizer editor-dock__resizer--${side}`}
            role="separator"
            aria-orientation="vertical"
            aria-label={t(side === 'left' ? 'editor.panels.resizeLeft' : 'editor.panels.resizeRight')}
            aria-valuemin={EDITOR_DOCK_WIDTHS.min}
            aria-valuemax={EDITOR_DOCK_WIDTHS.max}
            aria-valuenow={width}
            onPointerDown={(event) => handleDockPointerDown(side, event)}
            onPointerMove={handleDockPointerMove}
            onPointerUp={handleDockPointerUp}
            onPointerCancel={handleDockPointerCancel}
          />
        ) : null}
      </aside>
    );
  }

  return (
    <div className="editor" data-editor-kind={editorKind}>
      {menubar}
      <div className="editor-workspace">
        <EditorActivityBar openPanels={openPanels} onTogglePanel={handleTogglePanel} footer={activityBarFooter} onExtensionAction={onExtensionActivityAction} />
        {renderDock('left', leftDock)}
        <div className="editor-canvaswrap">
          <div className="editor__canvas">{canvas}</div>
          {toolbar}
          {overlays}
        </div>
        {renderDock('right', rightDock)}
      </div>
      {statusBar}
    </div>
  );
}

/** Slots every kind editor forwards into the shared shell. */
export type KindEditorProps = Omit<EditorShellProps, 'editorKind'>;
