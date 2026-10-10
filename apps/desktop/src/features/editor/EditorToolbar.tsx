import {
  toolRegistry,
} from '../../registries';
import { useEffect, useRef, useState } from 'react';
import { useI18n } from '../../app/i18n/resources';
import { Tooltip } from '../../ui/primitives/tooltip';
import { ExtensionTools } from './ExtensionTools';
import {
  ArrowToolIcon,
  ChevronUpIcon,
  EllipseToolIcon,
  FrameToolIcon,
  FreedrawToolIcon,
  LineToolIcon,
  RectangleToolIcon,
  SelectToolIcon,
  TextToolIcon,
} from '../../ui/icons';

interface EditorToolbarProps {
  activeTool: string;
  onToolChange: (tool: string) => void;
  kind: 'design' | 'whiteboard' | 'diagram';
  /** When true the tool stays active after commit (toggled by double-click). */
  stickyTool: boolean;
  onToggleSticky: () => void;
}

/**
 * Registry-driven toolbar: promoted tools and overflow tools derive from
 * descriptors, while action buttons derive from toolbar-surface commands.
 * Adding a tool or command does not require changing this component.
 *
 * Single-click activates a tool; double-click toggles sticky mode (the
 * tool stays active after commit instead of returning to Select).
 */
export function EditorToolbar({ activeTool, onToolChange, kind, stickyTool, onToggleSticky }: EditorToolbarProps) {
  const { t } = useI18n();
  const [moreOpen, setMoreOpen] = useState(false);
  const moreRef = useRef<HTMLDivElement>(null);
  const tools = toolRegistry.all();
  const primaryTools = tools.filter((tool) => tool.toolbarPlacement === 'primary');
  const additionalTools = tools.filter((tool) => tool.toolbarPlacement === 'more');

  useEffect(() => {
    if (!moreOpen) return;
    const close = (event: PointerEvent) => {
      if (!moreRef.current?.contains(event.target as Node)) setMoreOpen(false);
    };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [moreOpen]);

  function toolTitle(id: string): string {
    const tool = toolRegistry.get(id);
    if (!tool) return id;
    const base = tool.descriptionKey ? t(tool.descriptionKey) : t(tool.labelKey);
    const hint = tool.shortcutHint ? ` (${tool.shortcutHint})` : '';
    const sticky =
      activeTool === id && id !== 'select'
        ? ` — ${t(stickyTool ? 'editor.tools.stickyOn' : 'editor.tools.stickyOff')}`
        : '';
    return `${base}${hint}${sticky}`;
  }

  function toolIcon(id: string, size = 18) {
    const icons = {
      select: SelectToolIcon,
      rectangle: RectangleToolIcon,
      ellipse: EllipseToolIcon,
      frame: FrameToolIcon,
      line: LineToolIcon,
      arrow: ArrowToolIcon,
      text: TextToolIcon,
      freedraw: FreedrawToolIcon,
    } as const;
    const Icon = icons[id as keyof typeof icons];
    return Icon ? <Icon size={size} /> : null;
  }

  return (
    <div className="editor-toolbar">
      <div className="editor-toolbar__tools" role="toolbar" aria-label={t('editor.title')}>
        {primaryTools.map((tool) => (
          <Tooltip key={tool.id} content={toolTitle(tool.id)} placement="top">
            <button
              type="button"
              onClick={() => onToolChange(tool.id)}
              onDoubleClick={() => {
                if (tool.id !== 'select') {
                  onToolChange(tool.id);
                  onToggleSticky();
                }
              }}
              aria-pressed={activeTool === tool.id}
              aria-keyshortcuts={tool.shortcutHint}
              data-sticky={activeTool === tool.id && stickyTool && tool.id !== 'select' ? 'true' : undefined}
              className="ui-button ui-button--sm ui-button--secondary editor-toolbar__tool"
            >
              {toolIcon(tool.icon)}
              <span className="sr-only">{t(tool.labelKey)}</span>
            </button>
          </Tooltip>
        ))}
        <ExtensionTools kind={kind} />
        {additionalTools.length > 0 ? (          <div ref={moreRef} className="editor-toolbar__more">
            <button
              type="button"
              className="ui-button ui-button--sm ui-button--secondary editor-toolbar__more-trigger"
              aria-haspopup="menu"
              aria-expanded={moreOpen}
              onClick={() => setMoreOpen((open) => !open)}
            >
              <ChevronUpIcon size={14} />
              <span>{t('editor.toolbar.moreTools')}</span>
            </button>
            {moreOpen ? (
              <div className="editor-toolbar__more-menu" role="menu" aria-label={t('editor.toolbar.moreTools')}>
                {additionalTools.map((tool) => (
                  <button
                    key={tool.id}
                    type="button"
                    role="menuitemradio"
                    aria-checked={activeTool === tool.id}
                    className="editor-toolbar__more-item"
                    onClick={() => {
                      onToolChange(tool.id);
                      setMoreOpen(false);
                    }}
                    onDoubleClick={() => {
                      if (tool.id !== 'select') {
                        onToolChange(tool.id);
                        onToggleSticky();
                      }
                    }}
                  >
                    {toolIcon(tool.icon)}
                    <span>{t(tool.labelKey)}</span>
                    {tool.shortcutHint ? <kbd className="ui-shortcut">{tool.shortcutHint}</kbd> : null}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
