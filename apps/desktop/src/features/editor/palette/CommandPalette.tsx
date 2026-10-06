import { useEffect, useMemo, useRef, useState } from 'react';
import {
  searchCommands,
  canExecuteCommand,
  commandShortcutLabel,
  type CommandContext,
} from '../../../registries';
import { useI18n } from '../../../app/i18n/resources';
import { SearchInput } from '../../../ui/primitives/controls';

interface CommandPaletteProps {
  open: boolean;
  context: CommandContext;
  onClose: () => void;
  onExecute: (id: string) => void;
}

/**
 * Command palette built from the same registry as toolbar, menus, and
 * shortcuts. Search covers labels and keywords; enablement mirrors the
 * shared `canExecute` path so the palette never diverges from buttons.
 */
export function CommandPalette({ open, context, onClose, onExecute }: CommandPaletteProps) {
  const { t } = useI18n();
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const results = useMemo(() => searchCommands(query), [query]);

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
        if (target) {
          const verdict = canExecuteCommand(target.id, context);
          if (verdict.executable) onExecute(target.id);
        }
      }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, results, active, context, onClose, onExecute]);

  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  if (!open) return null;

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
            results.map((command, index) => {
              const verdict = canExecuteCommand(command.id, context);
              const shortcut = commandShortcutLabel(command);
              return (
                <button
                  key={command.id}
                  type="button"
                  role="option"
                  aria-selected={index === active}
                  aria-disabled={!verdict.executable || undefined}
                  data-index={index}
                  className={`palette__item${index === active ? ' palette__item--active' : ''}`}
                  disabled={!verdict.executable}
                  title={command.defaultDescription ?? command.defaultLabel}
                  onMouseEnter={() => setActive(index)}
                  onClick={() => {
                    if (verdict.executable) onExecute(command.id);
                  }}
                >
                  <span className="palette__label">{t(command.labelKey)}</span>
                  {shortcut ? <kbd className="ui-shortcut">{shortcut}</kbd> : null}
                </button>
              );
            })
          )}
        </div>
        <div className="palette__hint">{t('editor.palette.hint')}</div>
      </div>
    </div>
  );
}
