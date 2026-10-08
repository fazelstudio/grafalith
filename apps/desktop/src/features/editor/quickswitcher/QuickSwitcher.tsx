import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  searchUnifiedPalette,
  type AppCommandContext,
  type CommandContext,
  type UnifiedPaletteRow,
} from '../../../registries';
import type { FrameSnapshot } from '../../../hooks/useEngine';
import { useI18n } from '../../../app/i18n/resources';
import { SearchInput } from '../../../ui/primitives/controls';
import { Tooltip } from '../../../ui/primitives/tooltip';
import { PaletteCommandRow } from '../palette/PaletteCommandRow';
import { buildNavigatorEntries } from '../navigator';
import { kindLabel } from '../panels/LayersPanel';

interface TitlebarQuickSwitcherProps {
  projectName: string;
  /** True while the project holds changes not yet written to storage. */
  dirty: boolean;
  open: boolean;
  initialQuery: string;
  frame: FrameSnapshot | null;
  context: CommandContext;
  appContext: AppCommandContext;
  onPillClick: () => void;
  onClose: () => void;
  onExecuteCommand: (row: UnifiedPaletteRow) => void;
  onSelectLayer: (id: string) => void;
}

/** Portal host lookup for the shell titlebar center slot (editor only). */
export function TitlebarQuickSwitcher(props: TitlebarQuickSwitcherProps) {
  const [target, setTarget] = useState<HTMLElement | null>(null);
  useEffect(() => {
    setTarget(document.getElementById('editor-titlebar-center'));
  }, []);
  if (!target) return null;
  return createPortal(<QuickSwitcherBox {...props} />, target);
}

/**
 * Project capsule with an attached quick-open dropdown. The dropdown renders
 * in the same portal subtree as the capsule, anchored below it at the same
 * width so it reads as the capsule expanding downward. Default mode lists
 * layer objects; a leading `>` switches to command search. The list shows at
 * most ten rows before scrolling. A trailing `*` marks unsaved changes.
 */
function QuickSwitcherBox({
  projectName,
  dirty,
  open,
  initialQuery,
  frame,
  context,
  appContext,
  onPillClick,
  onClose,
  onExecuteCommand,
  onSelectLayer,
}: TitlebarQuickSwitcherProps) {
  const { t } = useI18n();
  const [query, setQuery] = useState(initialQuery);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const previousFocus = useRef<Element | null>(null);

  const isCommandMode = query.startsWith('>');
  const commandResults = useMemo(
    () => (isCommandMode ? searchUnifiedPalette(query.slice(1), context, appContext) : []),
    [isCommandMode, query, context, appContext],
  );
  const layerEntries = useMemo(() => {
    if (!frame || isCommandMode) return [];
    const entries = buildNavigatorEntries(frame.model, frame.session.selection);
    const needle = query.trim().toLowerCase();
    if (needle === '') return entries;
    return entries.filter((entry) => {
      const name = entry.name.toLowerCase();
      const kind = entry.kind.toLowerCase();
      const localized = kindLabel(entry.kind, t).toLowerCase();
      return name.includes(needle) || kind.includes(needle) || localized.includes(needle);
    });
  }, [frame, isCommandMode, query, t]);
  const rowCount = isCommandMode ? commandResults.length : layerEntries.length;

  useEffect(() => {
    if (open) {
      previousFocus.current = document.activeElement;
      setQuery(initialQuery);
      setActive(0);
      setTimeout(() => inputRef.current?.focus(), 0);
    } else if (previousFocus.current instanceof HTMLElement) {
      previousFocus.current.focus();
      previousFocus.current = null;
    }
  }, [open, initialQuery]);

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
        setActive((index) => Math.min(index + 1, Math.max(rowCount - 1, 0)));
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        setActive((index) => Math.max(index - 1, 0));
      } else if (event.key === 'Enter') {
        event.preventDefault();
        if (isCommandMode) {
          const target = commandResults[active];
          if (target?.executable) onExecuteCommand(target);
        } else {
          const target = layerEntries[active];
          if (target) onSelectLayer(target.id);
        }
      }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, rowCount, active, isCommandMode, commandResults, layerEntries, context, onClose, onExecuteCommand, onSelectLayer]);

  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const displayName = dirty ? `${projectName}*` : projectName;

  return (
    <div className="quickswitcher">
      <Tooltip content={displayName} placement="bottom">
        <button
          type="button"
          className="quickswitcher-pill"
          onClick={onPillClick}
          aria-haspopup="dialog"
          aria-expanded={open}
        >
          <span className="quickswitcher-pill__name">{displayName}</span>
        </button>
      </Tooltip>
      {open ? (
        <>
          <div
            className="quickswitcher-scrim"
            onMouseDown={(event) => {
              event.preventDefault();
              onClose();
            }}
          />
          <div className="quickswitcher__dropdown" role="dialog" aria-modal="true" aria-label={t('editor.quickSwitcher.title')}>
            <div className="palette__search">
              <SearchInput
                label={t('editor.quickSwitcher.title')}
                inputRef={inputRef}
                placeholder={t('editor.quickSwitcher.placeholder')}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </div>
            <div ref={listRef} className="palette__list" role="listbox" aria-label={t('editor.quickSwitcher.title')}>
              {isCommandMode ? (
                commandResults.length === 0 ? (
                  <div className="palette__empty">{t('editor.palette.empty')}</div>
                ) : (
                  commandResults.map((row, index) => (
                    <PaletteCommandRow
                      key={`${row.kind}:${row.id}`}
                      row={row}
                      index={index}
                      active={index === active}
                      onPick={onExecuteCommand}
                      onHighlight={setActive}
                    />
                  ))
                )
              ) : layerEntries.length === 0 ? (
                <div className="palette__empty">{t('editor.quickSwitcher.emptyObjects')}</div>
              ) : (
                layerEntries.map((entry, index) => {
                  const title = entry.name === '' ? kindLabel(entry.kind, t) : entry.name;
                  return (
                    <button
                      key={entry.id}
                      type="button"
                      role="option"
                      aria-selected={index === active}
                      aria-current={entry.selected ? 'true' : undefined}
                      data-index={index}
                      className={`palette__item${index === active ? ' palette__item--active' : ''}`}
                      onMouseEnter={() => setActive(index)}
                      onClick={() => onSelectLayer(entry.id)}
                    >
                      <span className="palette__label">{title}</span>
                      <span className="ui-shortcut">{kindLabel(entry.kind, t)}</span>
                    </button>
                  );
                })
              )}
            </div>
            <div className="palette__hint">{t('editor.quickSwitcher.hint')}</div>
          </div>
        </>
      ) : null}
    </div>
  );
}
