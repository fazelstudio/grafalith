import { useEffect, useRef, useState } from 'react';
import {
  commandsForSurface,
  canExecuteCommand,
  commandShortcutLabel,
  type CommandContext,
} from '../../../registries';
import { useI18n } from '../../../app/i18n/resources';

interface EditorMenuProps {
  context: CommandContext;
  onExecute: (id: string) => void;
}

/** Move focus among enabled menu items (ArrowUp/Down, Home/End). */
function moveMenuFocus(container: HTMLElement | null, key: string): boolean {
  if (!container) return false;
  if (key !== 'ArrowDown' && key !== 'ArrowUp' && key !== 'Home' && key !== 'End') return false;
  const items = Array.from(container.querySelectorAll<HTMLElement>('button:not([disabled])'));
  if (items.length === 0) return false;
  const active = document.activeElement as HTMLElement | null;
  const index = active ? items.indexOf(active) : -1;
  let next = 0;
  if (key === 'ArrowDown') next = index === -1 ? 0 : (index + 1) % items.length;
  else if (key === 'ArrowUp') next = index === -1 ? items.length - 1 : (index - 1 + items.length) % items.length;
  else if (key === 'Home') next = 0;
  else next = items.length - 1;
  items[next].focus();
  return true;
}

/**
 * Edit menu built from the same command definitions as toolbar, context
 * menu, palette, and shortcuts. Groups derive from command categories so
 * adding a command needs no new hardcoded menu branch.
 */
export function EditorMenu({ context, onExecute }: EditorMenuProps) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const commands = commandsForSurface('menu');

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement;
    rootRef.current?.querySelector<HTMLElement>('.editor-menu__popup button:not([disabled])')?.focus();
    function onPointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault();
        setOpen(false);
        triggerRef.current?.focus();
      }
    }
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
      // Click-outside leaves focus where the pointer landed; other closes
      // return focus to the trigger or wherever it was.
      if (document.activeElement === document.body && previous instanceof HTMLElement) {
        previous.focus();
      }
    };
  }, [open]);

  function onPopupKeyDown(event: React.KeyboardEvent): void {
    if (moveMenuFocus(rootRef.current, event.key)) event.preventDefault();
  }

  return (
    <div ref={rootRef} className="editor-menu">
      <button
        ref={triggerRef}
        type="button"
        className="ui-button ui-button--sm ui-button--ghost editor-menu__trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        {t('editor.menu.edit')}
      </button>
      {open ? (
        <div
          className="editor-menu__popup"
          role="menu"
          aria-label={t('editor.menu.edit')}
          onKeyDown={onPopupKeyDown}
        >
          {commands.map((command) => {
            const verdict = canExecuteCommand(command.id, context);
            const shortcut = commandShortcutLabel(command);
            return (
              <button
                key={command.id}
                type="button"
                role="menuitem"
                className="editor-menu__item"
                disabled={!verdict.executable}
                title={command.defaultDescription ?? command.defaultLabel}
                onClick={() => {
                  setOpen(false);
                  triggerRef.current?.focus();
                  if (verdict.executable) onExecute(command.id);
                }}
              >
                <span className="editor-menu__label">{t(command.labelKey)}</span>
                {shortcut ? <kbd className="ui-shortcut">{shortcut}</kbd> : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

interface CanvasContextMenuProps {
  x: number;
  y: number;
  intents: readonly string[];
  context: CommandContext;
  onExecute: (id: string) => void;
  onClose: () => void;
}

/**
 * Canvas context menu: the engine decides intents, the host renders them
 * through the shared command registry (labels, shortcuts, enablement).
 * Unknown intents fall back to the raw label instead of breaking the menu.
 */
export function CanvasContextMenu({ x, y, intents, context, onExecute, onClose }: CanvasContextMenuProps) {
  const { t } = useI18n();
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const previous = document.activeElement;
    function onPointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) onClose();
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      }
    }
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    rootRef.current?.querySelector<HTMLElement>('button:not([disabled])')?.focus();
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
      // Escape returns focus to the canvas; click-outside keeps pointer focus.
      if (document.activeElement === document.body && previous instanceof HTMLElement) {
        previous.focus();
      }
    };
  }, [onClose]);

  function onMenuKeyDown(event: React.KeyboardEvent): void {
    if (moveMenuFocus(rootRef.current, event.key)) event.preventDefault();
  }

  return (
    <div
      ref={rootRef}
      className="editor-contextmenu"
      style={{ left: x, top: y }}
      role="menu"
      aria-label={t('editor.menu.contextTitle')}
      onPointerDown={(event) => event.stopPropagation()}
      onKeyDown={onMenuKeyDown}
    >
      {intents.map((intent) => {
        const command = commandsForSurface('contextMenu').find((entry) => entry.id === intent);
        const verdict = command ? canExecuteCommand(command.id, context) : { executable: true as const };
        const shortcut = command ? commandShortcutLabel(command) : undefined;
        return (
          <button
            key={intent}
            type="button"
            role="menuitem"
            className="editor-contextmenu__item"
            disabled={!verdict.executable}
            onClick={() => onExecute(intent)}
          >
            <span className="editor-contextmenu__label">
              {command ? t(command.labelKey) : intent}
            </span>
            {shortcut ? <kbd className="ui-shortcut">{shortcut}</kbd> : null}
          </button>
        );
      })}
    </div>
  );
}
