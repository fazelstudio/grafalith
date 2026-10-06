import { useEffect, useRef } from 'react';
import { useI18n } from '../../app/i18n/resources';
import { projectCapabilities } from '../../platform/projects/projectService';
import type { ProjectSummary } from '../../platform/projects/types';

interface ProjectMenuProps {
  project: ProjectSummary;
  x: number;
  y: number;
  onClose: () => void;
  onOpen: () => void;
  onRename: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onFavorite: () => void;
  onUnfavorite: () => void;
}

/** Progressive-disclosure menu; rows stay clean until the user asks for more. */
export function ProjectMenu({
  project,
  x,
  y,
  onClose,
  onOpen,
  onRename,
  onDuplicate,
  onDelete,
  onFavorite,
  onUnfavorite,
}: ProjectMenuProps) {
  const { t } = useI18n();
  const firstRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // Focus the first item on open; return focus to the invoker on close so
  // keyboard users never lose their place in the project grid.
  useEffect(() => {
    const previous = document.activeElement;
    firstRef.current?.focus();
    return () => {
      if (document.activeElement === document.body && previous instanceof HTMLElement) {
        previous.focus();
      }
    };
  }, []);

  const left = Math.max(8, Math.min(x, window.innerWidth - 220));
  const top = Math.max(8, Math.min(y, window.innerHeight - 220));

  function onKeyDown(event: React.KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
      return;
    }
    if (
      event.key !== 'ArrowDown' &&
      event.key !== 'ArrowUp' &&
      event.key !== 'Home' &&
      event.key !== 'End'
    ) {
      return;
    }
    event.preventDefault();
    const items = Array.from(
      menuRef.current?.querySelectorAll<HTMLElement>('button:not([disabled])') ?? [],
    );
    if (items.length === 0) return;
    const index = items.indexOf(document.activeElement as HTMLElement);
    let next = 0;
    if (event.key === 'ArrowDown') next = index === -1 ? 0 : (index + 1) % items.length;
    else if (event.key === 'ArrowUp') next = index === -1 ? items.length - 1 : (index - 1 + items.length) % items.length;
    else if (event.key === 'Home') next = 0;
    else next = items.length - 1;
    items[next].focus();
  }

  return (
    <div
      className="project-menu-overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={menuRef}
        className="project-menu"
        role="menu"
        aria-label={t('projects.actions.projectMenu', { name: project.name })}
        style={{ left, top }}
        onKeyDown={onKeyDown}
      >
        <button
          ref={firstRef}
          type="button"
          role="menuitem"
          className="project-menu__item"
          onClick={onOpen}
        >
          {t('projects.actions.open')}
        </button>
        <button type="button" role="menuitem" className="project-menu__item" onClick={onRename}>
          {t('projects.actions.rename')}
        </button>
        {projectCapabilities.supportsDuplicate ? (
          <button
            type="button"
            role="menuitem"
            className="project-menu__item"
            onClick={onDuplicate}
          >
            {t('projects.actions.duplicate')}
          </button>
        ) : null}
        {projectCapabilities.supportsFavorite ? (
          project.favoriteAtMs !== undefined ? (
            <button
              type="button"
              role="menuitem"
              className="project-menu__item"
              onClick={onUnfavorite}
            >
              {t('projects.actions.unfavorite')}
            </button>
          ) : (
            <button
              type="button"
              role="menuitem"
              className="project-menu__item"
              onClick={onFavorite}
            >
              {t('projects.actions.favorite')}
            </button>
          )
        ) : null}
        {projectCapabilities.supportsDelete ? (
          <>
            <hr className="project-menu__separator" />
            <button
              type="button"
              role="menuitem"
              className="project-menu__item project-menu__item--destructive"
              onClick={onDelete}
            >
              {t('projects.actions.delete')}
            </button>
          </>
        ) : null}
      </div>
    </div>
  );
}
