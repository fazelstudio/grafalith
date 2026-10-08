import { useState, type CSSProperties, type MouseEvent } from 'react';
import type { Engine, FrameSnapshot } from '../../../hooks/useEngine';
import { useI18n } from '../../../app/i18n/resources';
import { useToast } from '../../../app/shell/ToastProvider';
import { executeCommand, menusFor, type CommandContext } from '../../../registries';
import { executeExtensionCommand, hasExtensionCommand } from '../../../platform/extensions/extensionContributions';
import { commandResultMessage } from '../engineGaps';
import { Tooltip } from '../../../ui/primitives/tooltip';
import { buildNavigatorEntries } from '../navigator';
import { normalizeSelection } from '../selection';
import { CanvasContextMenu } from '../menus/menus';

interface LayersPanelProps {
  frame: FrameSnapshot | null;
  onSelect: (ids: string[], additive: boolean) => void;
  engine: Engine;
  sendBatch: (ops: unknown[]) => Promise<string>;
  commandContext: CommandContext;
}

/** Localized element-kind label with a raw-id fallback for custom kinds. */
export function kindLabel(kind: string, t: (key: string) => string): string {
  const key = `editor.kinds.${kind}`;
  const label = t(key);
  return label === key ? kind : label;
}

/**
 * Document tree driven by the render model: rows follow paint order
 * (topmost first) and highlight the normalized engine selection.
 * Clicking a row replaces the engine selection; shift-click toggles one row.
 * Right-click opens the layers context menu from the menu registry.
 */
export function LayersPanel({ frame, onSelect, commandContext }: LayersPanelProps) {
  const { t } = useI18n();
  const { notify } = useToast();
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  if (!frame) return null;
  const liveIds = new Set<string>();
  for (const entry of frame.model.base) liveIds.add(entry.id);
  for (const pass of frame.model.frames) {
    liveIds.add(pass.frame.id);
    for (const child of pass.children) liveIds.add(child.id);
  }
  const selection = normalizeSelection(frame.session.selection, liveIds);
  const entries = buildNavigatorEntries(frame.model, selection);
  const intents = menusFor('layers.context').map((row) => row.commandId);

  function openMenu(event: MouseEvent, id: string) {
    event.preventDefault();
    onSelect([id], false);
    setMenu({ x: event.clientX, y: event.clientY });
  }

  async function runMenuAction(intent: string) {
    setMenu(null);
    if (hasExtensionCommand(intent)) {
      await executeExtensionCommand(intent);
      return;
    }
    const result = await executeCommand(intent, commandContext);
    const message = commandResultMessage(intent, result, t);
    if (message) notify(message);
  }

  if (entries.length === 0) {
    return (
      <div className="editor-panel__empty">
        <div className="editor-panel__empty-title">{t('editor.navigator.empty')}</div>
        <div className="editor-panel__empty-hint">{t('editor.navigator.emptyHint')}</div>
      </div>
    );
  }
  return (
    <>
    <ul className="editor-layers" aria-label={t('editor.panels.layers')}>
      {entries.map((row) => {
        const title = row.name === '' ? kindLabel(row.kind, t) : row.name;
        return (
          <li key={row.id}>
            <Tooltip content={title}>
              <button
                type="button"
                className="editor-layers__row"
                style={{ '--layer-depth': row.depth } as CSSProperties}
                aria-current={row.selected ? 'true' : undefined}
                onClick={(event) => onSelect([row.id], event.shiftKey)}
                onContextMenu={(event) => openMenu(event, row.id)}
              >
                <span className="editor-layers__kind">{kindLabel(row.kind, t)}</span>
                {row.name === '' ? null : <span className="editor-layers__name">{row.name}</span>}
              </button>
            </Tooltip>
          </li>
        );
      })}
    </ul>
    {menu ? (
      <CanvasContextMenu
        x={menu.x}
        y={menu.y}
        intents={intents}
        context={commandContext}
        onExecute={(intent) => void runMenuAction(intent)}
        onClose={() => setMenu(null)}
      />
    ) : null}
    </>
  );
}
