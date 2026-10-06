import type { FrameSnapshot } from '../../hooks/useEngine';
import { useI18n } from '../../app/i18n/resources';

interface EditorStatusBarProps {
  frame: FrameSnapshot | null;
  protocolVersion: number | null;
}

/** Engine status line mirroring the shared frame snapshot. */
export function EditorStatusBar({ frame, protocolVersion }: EditorStatusBarProps) {
  const { t } = useI18n();
  if (!frame) return null;
  const toolKey = `editor.tools.${frame.session.tool}`;
  const toolName = t(toolKey) === toolKey ? frame.session.tool : t(toolKey);

  return (
    <div className="editor-statusbar">
      <span>{t('editor.status.engine')}</span>
      {protocolVersion !== null ? (
        <span>{t('editor.status.protocol', { version: protocolVersion })}</span>
      ) : null}
      <span>{t('editor.status.selected', { count: frame.session.selection.length })}</span>
      <span>{t('editor.status.tool', { tool: toolName })}</span>
      <span>{t('editor.status.zoom', { zoom: frame.session.viewport.zoom.toFixed(2) })}</span>
    </div>
  );
}
