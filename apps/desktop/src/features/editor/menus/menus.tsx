import { useEffect, useRef, useState } from 'react';
import {
  commandRegistry,
  commandsForSurface,
  canExecuteCommand,
  appCommandRegistry,
  menusFor,
  menuRowExecutable,
  commandShortcutLabel,
  type CommandContext,
  type AppCommandContext,
  type MenuItemDefinition,
} from '../../../registries';
import { projectKindRegistry } from '../../projects/projectKinds';
import type { ProjectKind } from '../../../platform/projects/types';
import { useI18n } from '../../../app/i18n/resources';

type TopMenu = 'file' | 'edit' | 'view';

interface EditorMenuBarProps {
  context: CommandContext;
  appContext: AppCommandContext;
  onExecuteCommand: (id: string) => void;
  onExecuteAppCommand: (id: string, patch?: Partial<AppCommandContext>) => void;
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

const EDIT_COMMANDS = ['undo', 'redo', 'selectAll'] as const;
const VIEW_COMMANDS = ['zoomIn', 'zoomOut', 'resetZoom', 'fitContent', 'commandPalette'] as const;

/**
 * Registry-driven menu row: resolves engine and host commands through one
 * template so menubar, context, and select surfaces never diverge.
 */
function RegistryRow({
  row,
  context,
  appContext,
  onPickEngine,
  onPickApp,
}: {
  row: MenuItemDefinition;
  context: CommandContext;
  appContext: AppCommandContext;
  onPickEngine: (id: string) => void;
  onPickApp: (id: string) => void;
}) {
  const { t } = useI18n();
  const executable = menuRowExecutable(row, context, appContext);
  const command =
    row.commandKind === 'engine'
      ? commandRegistry.get(row.commandId)
      : appCommandRegistry.get(row.commandId);
  const shortcut =
    row.commandKind === 'engine' && command && 'shortcuts' in command
      ? commandShortcutLabel(command as Parameters<typeof commandShortcutLabel>[0])
      : undefined;
  const label = command ? t(command.labelKey) : row.defaultLabel;
  return (
    <button
      type="button"
      role="menuitem"
      className="editor-menu__item"
      disabled={!executable}
      onClick={() => {
        if (!executable) return;
        if (row.commandKind === 'engine') onPickEngine(row.commandId);
        else onPickApp(row.commandId);
      }}
    >
      <span className="editor-menu__label">{label}</span>
      {shortcut ? <kbd className="ui-shortcut">{shortcut}</kbd> : null}
    </button>
  );
}

/**
 * Editor menubar: File, Edit, and View only. Rows render from the menu
 * registry so enablement and shortcuts never diverge from palette, toolbar,
 * or keys. File rows are host commands (project store + dialogs), Edit/View
 * rows are engine intents — both dispatched through one path.
 */
export function EditorMenuBar({
  context,
  appContext,
  onExecuteCommand,
  onExecuteAppCommand,
}: EditorMenuBarProps) {
  const { t } = useI18n();
  const [openMenu, setOpenMenu] = useState<TopMenu | null>(null);
  const [newExpanded, setNewExpanded] = useState(false);
  const [exportExpanded, setExportExpanded] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRefs = useRef<Record<TopMenu, HTMLButtonElement | null>>({
    file: null,
    edit: null,
    view: null,
  });

  useEffect(() => {
    if (!openMenu) {
      setNewExpanded(false);
      setExportExpanded(false);
      return;
    }
    const current: TopMenu = openMenu;
    rootRef.current
      ?.querySelector<HTMLElement>(`[data-menu="${current}"] .editor-menu__popup button:not([disabled])`)
      ?.focus();
    function onPointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpenMenu(null);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault();
        setOpenMenu(null);
        triggerRefs.current[current]?.focus();
      }
    }
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [openMenu]);

  function toggle(menu: TopMenu) {
    setOpenMenu((current) => (current === menu ? null : menu));
  }

  function expandNewAndFocusFirstKind() {
    setNewExpanded(true);
    setTimeout(() => {
      rootRef.current?.querySelector<HTMLElement>('[data-submenu-kind]')?.focus();
    }, 0);
  }

  function collapseNewAndFocusParent() {
    setNewExpanded(false);
    setTimeout(() => {
      rootRef.current?.querySelector<HTMLElement>('[data-submenu-parent="new"]')?.focus();
    }, 0);
  }

  function expandExportAndFocusFirstRow() {
    setExportExpanded(true);
    setTimeout(() => {
      rootRef.current?.querySelector<HTMLElement>('[data-submenu="export"] button:not([disabled])')?.focus();
    }, 0);
  }

  function collapseExportAndFocusParent() {
    setExportExpanded(false);
    setTimeout(() => {
      rootRef.current?.querySelector<HTMLElement>('[data-submenu-parent="export"]')?.focus();
    }, 0);
  }

  function pickCommand(id: string) {
    setOpenMenu(null);
    onExecuteCommand(id);
  }

  function pickAppCommand(id: string, patch?: Partial<AppCommandContext>) {
    setOpenMenu(null);
    onExecuteAppCommand(id, patch);
  }

  function onPopupKeyDown(event: React.KeyboardEvent, menu: TopMenu) {
    const scope = rootRef.current?.querySelector<HTMLElement>(`[data-menu="${menu}"]`) ?? null;
    if (moveMenuFocus(scope, event.key)) {
      event.preventDefault();
    }
  }

  function trigger(menu: TopMenu, label: string) {
    return (
      <button
        ref={(node) => {
          triggerRefs.current[menu] = node;
        }}
        type="button"
        className="ui-button ui-button--sm ui-button--ghost editor-menu__trigger"
        aria-haspopup="menu"
        aria-expanded={openMenu === menu}
        onClick={() => toggle(menu)}
        onMouseEnter={() => {
          if (openMenu !== null && openMenu !== menu) setOpenMenu(menu);
        }}
      >
        {label}
      </button>
    );
  }

  return (
    <div ref={rootRef} className="editor-menubar" role="menubar" aria-label={t('editor.title')}>
      <div className="editor-menu" data-menu="file">
        {trigger('file', t('editor.menu.file'))}
        {openMenu === 'file' ? (
          <div
            className="editor-menu__popup"
            role="menu"
            aria-label={t('editor.menu.file')}
            onKeyDown={(event) => onPopupKeyDown(event, 'file')}
          >
            <div
              className="editor-menu__submenu-wrap"
              onMouseEnter={() => setNewExpanded(true)}
              onMouseLeave={() => setNewExpanded(false)}
            >
              <button
                type="button"
                role="menuitem"
                aria-haspopup="menu"
                aria-expanded={newExpanded}
                data-submenu-parent="new"
                className="editor-menu__item editor-menu__item--parent"
                onClick={() => setNewExpanded((value) => !value)}
                onKeyDown={(event) => {
                  if (event.key === 'ArrowRight') {
                    event.preventDefault();
                    event.stopPropagation();
                    expandNewAndFocusFirstKind();
                  }
                }}
              >
                <span className="editor-menu__label">{t('editor.menu.new')}</span>
                <span className="editor-menu__arrow" aria-hidden="true">
                  ›
                </span>
              </button>
              {newExpanded ? (
                <div className="editor-menu__submenu" role="menu" aria-label={t('editor.menu.new')}>
                  {projectKindRegistry.all().map((entry) => (
                    <button
                      key={entry.id}
                      type="button"
                      role="menuitem"
                      data-submenu-kind={entry.id}
                      className="editor-menu__item"
                      onClick={() => {
                        pickAppCommand('project.new', { targetKind: entry.id as ProjectKind });
                      }}
                      onKeyDown={(event) => {
                        if (event.key === 'ArrowLeft') {
                          event.preventDefault();
                          event.stopPropagation();
                          collapseNewAndFocusParent();
                        }
                      }}
                    >
                      <span className="editor-menu__label">{t(entry.labelKey)}</span>
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
            <div
              className="editor-menu__submenu-wrap"
              onMouseEnter={() => setExportExpanded(true)}
              onMouseLeave={() => setExportExpanded(false)}
            >
              <button
                type="button"
                role="menuitem"
                aria-haspopup="menu"
                aria-expanded={exportExpanded}
                data-submenu-parent="export"
                className="editor-menu__item editor-menu__item--parent"
                onClick={() => setExportExpanded((value) => !value)}
                onKeyDown={(event) => {
                  if (event.key === 'ArrowRight') {
                    event.preventDefault();
                    event.stopPropagation();
                    expandExportAndFocusFirstRow();
                  }
                }}
              >
                <span className="editor-menu__label">{t('editor.menu.export')}</span>
                <span className="editor-menu__arrow" aria-hidden="true">
                  ›
                </span>
              </button>
              {exportExpanded ? (
                <div
                  className="editor-menu__submenu"
                  role="menu"
                  aria-label={t('editor.menu.export')}
                  data-submenu="export"
                  onKeyDown={(event) => {
                    if (event.key === 'ArrowLeft') {
                      event.preventDefault();
                      event.stopPropagation();
                      collapseExportAndFocusParent();
                    }
                  }}
                >
                  {menusFor('menubar.file')
                    .filter((row) => row.id.startsWith('file.export'))
                    .map((row) => (
                      <span key={row.id}>
                        <RegistryRow
                          row={row}
                          context={context}
                          appContext={appContext}
                          onPickEngine={pickCommand}
                          onPickApp={(id) => pickAppCommand(id)}
                        />
                      </span>
                    ))}
                </div>
              ) : null}
            </div>
            {menusFor('menubar.file')
              .filter((row) => row.id !== 'file.new' && !row.id.startsWith('file.export'))
              .map((row, index, rows) => {
                const previous = rows[index - 1];
                const separator = previous !== undefined && previous.group !== row.group;
                return (
                  <span key={row.id}>
                    {separator ? <div className="editor-menu__separator" role="separator" /> : null}
                    <RegistryRow
                      row={row}
                      context={context}
                      appContext={appContext}
                      onPickEngine={pickCommand}
                      onPickApp={(id) => pickAppCommand(id)}
                    />
                  </span>
                );
              })}
            <button
              type="button"
              role="menuitem"
              className="editor-menu__item"
              disabled
              title={t('editor.menu.placeMediaUnavailable')}
            >
              <span className="editor-menu__label">{t('editor.menu.placeMedia')}</span>
            </button>
          </div>
        ) : null}
      </div>
      <div className="editor-menu" data-menu="edit">
        {trigger('edit', t('editor.menu.edit'))}
        {openMenu === 'edit' ? (
          <div
            className="editor-menu__popup"
            role="menu"
            aria-label={t('editor.menu.edit')}
            onKeyDown={(event) => onPopupKeyDown(event, 'edit')}
          >
            {menusFor('menubar.edit').map((row, index, rows) => {
              const previous = rows[index - 1];
              const separator = previous !== undefined && previous.group !== row.group;
              return (
                <span key={row.id}>
                  {separator ? <div className="editor-menu__separator" role="separator" /> : null}
                  <RegistryRow
                    row={row}
                    context={context}
                    appContext={appContext}
                    onPickEngine={pickCommand}
                    onPickApp={(id) => pickAppCommand(id)}
                  />
                </span>
              );
            })}
          </div>
        ) : null}
      </div>
      <div className="editor-menu" data-menu="view">
        {trigger('view', t('editor.menu.view'))}
        {openMenu === 'view' ? (
          <div
            className="editor-menu__popup"
            role="menu"
            aria-label={t('editor.menu.view')}
            onKeyDown={(event) => onPopupKeyDown(event, 'view')}
          >
            {menusFor('menubar.view').map((row, index, rows) => {
              const previous = rows[index - 1];
              const separator = previous !== undefined && previous.group !== row.group;
              return (
                <span key={row.id}>
                  {separator ? <div className="editor-menu__separator" role="separator" /> : null}
                  <RegistryRow
                    row={row}
                    context={context}
                    appContext={appContext}
                    onPickEngine={pickCommand}
                    onPickApp={(id) => pickAppCommand(id)}
                  />
                </span>
              );
            })}
          </div>
        ) : null}
      </div>
    </div>
  );
}

export const EDIT_MENU_COMMANDS: readonly string[] = EDIT_COMMANDS;
export const VIEW_MENU_COMMANDS: readonly string[] = VIEW_COMMANDS;

interface CanvasContextMenuProps {
  x: number;
  y: number;
  intents: readonly string[];
  context: CommandContext;
  labelOverrides?: Readonly<Record<string, string>>;
  onExecute: (id: string) => void;
  onClose: () => void;
}

/**
 * Canvas context menu: the engine decides intents, the host renders them
 * through the shared command registry (labels, shortcuts, enablement).
 * Unknown intents fall back to the raw label instead of breaking the menu.
 */
export function CanvasContextMenu({ x, y, intents, context, labelOverrides, onExecute, onClose }: CanvasContextMenuProps) {
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
              {labelOverrides?.[intent] ?? (command ? t(command.labelKey) : intent)}
            </span>
            {shortcut ? <kbd className="ui-shortcut">{shortcut}</kbd> : null}
          </button>
        );
      })}
    </div>
  );
}
