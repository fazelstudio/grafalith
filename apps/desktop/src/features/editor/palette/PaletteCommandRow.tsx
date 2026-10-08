import {
  commandRegistry,
  appCommandRegistry,
  commandShortcutLabel,
  type UnifiedPaletteRow,
} from '../../../registries';
import { useI18n } from '../../../app/i18n/resources';

interface PaletteCommandRowProps {
  row: UnifiedPaletteRow;
  index: number;
  active: boolean;
  onPick: (row: UnifiedPaletteRow) => void;
  onHighlight: (index: number) => void;
}

/**
 * One palette row shared by the command palette overlay and the
 * titlebar quick switcher. Engine and host commands render through one
 * template so the two surfaces never diverge in behavior or markup.
 */
export function PaletteCommandRow({ row, index, active, onPick, onHighlight }: PaletteCommandRowProps) {
  const { t } = useI18n();
  const command =
    row.kind === 'engine' ? commandRegistry.get(row.id) : appCommandRegistry.get(row.id);
  const shortcut =
    row.kind === 'engine' && command && 'shortcuts' in command
      ? commandShortcutLabel(command as Parameters<typeof commandShortcutLabel>[0])
      : undefined;
  const label = command ? t(command.labelKey) : row.label;
  return (
    <button
      key={`${row.kind}:${row.id}`}
      type="button"
      role="option"
      aria-selected={active}
      aria-disabled={!row.executable || undefined}
      data-index={index}
      className={`palette__item${active ? ' palette__item--active' : ''}`}
      disabled={!row.executable}
      onMouseEnter={() => onHighlight(index)}
      onClick={() => {
        if (row.executable) onPick(row);
      }}
    >
      <span className="palette__label">{label}</span>
      {shortcut ? <kbd className="ui-shortcut">{shortcut}</kbd> : null}
    </button>
  );
}
