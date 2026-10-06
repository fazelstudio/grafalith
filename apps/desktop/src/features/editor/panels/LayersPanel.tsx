import type { Engine, FrameSnapshot } from '../../../hooks/useEngine';
import { useI18n } from '../../../app/i18n/resources';
import type { CommandContext } from '../../../registries';
import { buildNavigatorEntries } from '../navigator';
import { normalizeSelection } from '../selection';

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
 */
export function LayersPanel({ frame, onSelect }: LayersPanelProps) {
  const { t } = useI18n();
  if (!frame) return null;
  const liveIds = new Set<string>();
  for (const entry of frame.model.base) liveIds.add(entry.id);
  for (const pass of frame.model.frames) {
    liveIds.add(pass.frame.id);
    for (const child of pass.children) liveIds.add(child.id);
  }
  const selection = normalizeSelection(frame.session.selection, liveIds);
  const entries = buildNavigatorEntries(frame.model, selection);
  if (entries.length === 0) {
    return (
      <div className="editor-panel__empty">
        <div className="editor-panel__empty-title">{t('editor.navigator.empty')}</div>
        <div className="editor-panel__empty-hint">{t('editor.navigator.emptyHint')}</div>
      </div>
    );
  }
  return (
    <ul className="editor-layers" aria-label={t('editor.panels.layers')}>
      {entries.map((row) => {
        const title = row.name === '' ? kindLabel(row.kind, t) : row.name;
        return (
          <li key={row.id}>
            <button
              type="button"
              className="editor-layers__row"
              style={{ paddingLeft: `calc(var(--space-sm) + ${row.depth} * var(--space-md))` }}
              aria-current={row.selected ? 'true' : undefined}
              title={title}
              onClick={(event) => onSelect([row.id], event.shiftKey)}
            >
              <span className="editor-layers__kind">{kindLabel(row.kind, t)}</span>
              {row.name === '' ? null : <span className="editor-layers__name">{row.name}</span>}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
