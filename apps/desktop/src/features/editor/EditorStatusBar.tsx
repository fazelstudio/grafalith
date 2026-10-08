import type { FrameSnapshot } from '../../hooks/useEngine';
import { useI18n } from '../../app/i18n/resources';
import {
  canExecuteCommand,
  canExecuteAppCommand,
  statusForSide,
  type AppCommandContext,
  type CommandContext,
} from '../../registries';
import {
  hasExtensionCommand,
  isExtensionStatusVisible,
  extensionStatusText,
  extensionViewsFor,
} from '../../platform/extensions/extensionContributions';

interface EditorStatusBarProps {
  frame: FrameSnapshot | null;
  protocolVersion: number | null;
  context: CommandContext;
  appContext: AppCommandContext;
  onExecuteCommand: (id: string) => void;
  onExecuteAppCommand: (id: string) => void;
  onExecuteExtensionCommand: (id: string) => void;
}

interface EditorStatusBarProps {
  frame: FrameSnapshot | null;
  protocolVersion: number | null;
  context: CommandContext;
  appContext: AppCommandContext;
  onExecuteCommand: (id: string) => void;
  onExecuteAppCommand: (id: string) => void;
}

/** Status item id to the command a click runs (display stays read-only). */
const STATUS_CLICKS: Readonly<Record<string, { kind: 'engine' | 'app'; id: string }>> = {
  selection: { kind: 'engine', id: 'selectAll' },
  tool: { kind: 'app', id: 'dialog.openQuickSwitcher' },
  zoom: { kind: 'engine', id: 'resetZoom' },
};

/**
 * Engine status line mirroring the shared frame snapshot. Actionable items
 * (selection, tool, zoom) dispatch through the shared command path; the
 * full list stays available in the statusbar context menu registry.
 */
export function EditorStatusBar({
  frame,
  protocolVersion,
  context,
  appContext,
  onExecuteCommand,
  onExecuteAppCommand,
  onExecuteExtensionCommand,
}: EditorStatusBarProps) {
  const { t } = useI18n();
  if (!frame) return null;
  const currentFrame = frame;
  const toolKey = `editor.tools.${currentFrame.session.tool}`;
  const toolName = t(toolKey) === toolKey ? currentFrame.session.tool : t(toolKey);

  function valueFor(id: string): string | null {
    if (id === 'engine') return t('editor.status.engine');
    if (id === 'protocol') {
      return protocolVersion === null ? null : t('editor.status.protocol', { version: protocolVersion });
    }
    if (id === 'selection') return t('editor.status.selected', { count: currentFrame.session.selection.length });
    if (id === 'tool') return t('editor.status.tool', { tool: toolName });
    if (id === 'zoom') return t('editor.status.zoom', { zoom: currentFrame.session.viewport.zoom.toFixed(2) });
    return null;
  }

  function renderSide(side: 'left' | 'right') {
    const extensionItems =
      side === 'right'
        ? extensionViewsFor('status').filter((view) => isExtensionStatusVisible(view.id))
        : [];
    return (
      <div className={`editor-statusbar__side editor-statusbar__side--${side}`}>
        {statusForSide(side).map((item) => {
          const value = valueFor(item.id);
          if (value === null) return null;
          const click = STATUS_CLICKS[item.id];
          if (!click) return <span key={item.id}>{value}</span>;
          const executable =
            click.kind === 'engine'
              ? canExecuteCommand(click.id, context).executable
              : canExecuteAppCommand(click.id, appContext).executable;
          return (
            <button
              key={item.id}
              type="button"
              className="editor-statusbar__action"
              disabled={!executable}
              onClick={() => {
                if (click.kind === 'engine') onExecuteCommand(click.id);
                else onExecuteAppCommand(click.id);
              }}
              aria-label={value}
            >
              {value}
            </button>
          );
        })}
        {extensionItems.map((view) => {
          const text = extensionStatusText(view.id, view.title);
          if (!view.command || !hasExtensionCommand(view.command)) {
            return <span key={`extension:${view.id}`}>{text}</span>;
          }
          return (
            <button
              key={`extension:${view.id}`}
              type="button"
              className="editor-statusbar__action"
              onClick={() => onExecuteExtensionCommand(view.command as string)}
              aria-label={text}
            >
              {text}
            </button>
          );
        })}
      </div>
    );
  }

  return (
    <div className="editor-statusbar" aria-label={t('editor.title')}>
      {renderSide('left')}
      {renderSide('right')}
    </div>
  );
}
