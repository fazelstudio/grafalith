import { useEffect, useMemo, useRef, useState } from 'react';
import {
  searchUnifiedPalette,
  groupUnifiedRows,
  type AppCommandContext,
  type CommandContext,
  type UnifiedPaletteRow,
} from '../../../registries';
import { useI18n } from '../../../app/i18n/resources';
import { SearchInput } from '../../../ui/primitives/controls';
import { PaletteCommandRow } from './PaletteCommandRow';

interface CommandPaletteProps {
  open: boolean;
  context: CommandContext;
  appContext: AppCommandContext;
  onClose: () => void;
  onExecute: (row: UnifiedPaletteRow) => void;
}

/**
 * Command palette built from the unified engine + host registries.
 * Results group by category and rank MRU first; enablement mirrors the
 * shared canExecute paths so the palette never diverges from buttons.
 */
export function CommandPalette({ open, context, appContext, onClose, onExecute }: CommandPaletteProps) {
  const { t } = useI18n();
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const results = useMemo(
    () => searchUnifiedPalette(query, context, appContext),
    [query, context, appContext],
  );
  const groups = useMemo(() => groupUnifiedRows(results), [results]);

  // Focus the search field on open; return focus to the invoker on close so
  // keyboard users never lose their place in the editor chrome.
  const previousFocus = useRef<Element | null>(null);
  useEffect(() => {
    if (open) {
      previousFocus.current = document.activeElement;
      setQuery('');
      setActive(0);
      setTimeout(() => inputRef.current?.focus(), 0);
    } else if (previousFocus.current instanceof HTMLElement) {
      previousFocus.current.focus();
      previousFocus.current = null;
    }
  }, [open ]);

  useEffect(() => {
    setActive(0);
  }, [query]);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      } else if (event.key === 'ArrowDown') {
        event.preventDefault();
        setActive((index) => Math.min(index + 1, Math.max(results.length - 1, 0)));
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        setActive((index) => Math.max(index - 1, 0));
      } else if (event.key === 'Enter') {
        event.preventDefault();
        const target = results[active];
        if (target?.executable) onExecute(target);
      }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, results, active, onClose, onExecute]);

  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  if (!open) return null;

  let rowIndex = -1;
  return (
    <div
      className="palette-overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="palette" role="dialog" aria-modal="true" aria-label={t('editor.palette.title')}>
        <div className="palette__search">
          <SearchInput
            label={t('editor.palette.title')}
            inputRef={inputRef}
            placeholder={t('editor.palette.placeholder')}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        <div ref={listRef} className="palette__list" role="listbox" aria-label={t('editor.palette.title')}>
          {results.length === 0 ? (
            <div className="palette__empty">{t('editor.palette.empty')}</div>
          ) : (
            groups.map((group) => (
              <div key={group.category}>
                <div className="palette__group" role="presentation">
                  {group.category}
                </div>
                {group.rows.map((row) => {
                  rowIndex += 1;
                  const index = rowIndex;
                  return (
                    <PaletteCommandRow
                      key={`${row.kind}:${row.id}`}
                      row={row}
                      index={index}
                      active={index === active}
                      onPick={onExecute}
                      onHighlight={setActive}
                    />
                  );
                })}
              </div>
            ))
          )}
        </div>
        <div className="palette__hint">{t('editor.palette.hint')}</div>
      </div>
    </div>
  );
}
