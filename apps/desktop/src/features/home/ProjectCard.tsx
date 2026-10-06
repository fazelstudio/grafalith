import { useI18n } from '../../app/i18n/resources';
import type { ProjectSummary } from '../../platform/projects/types';
import { ProjectsIcon, StarIcon } from '../../ui/icons';
import { formatProjectDate } from './formatDate';

interface ProjectCardProps {
  project: ProjectSummary;
  selected: boolean;
  busy: boolean;
  onOpen: () => void;
  onMenu: (project: ProjectSummary, x: number, y: number) => void;
  onRename: () => void;
}

/** Compact project entry showing metadata only, never scene content. */
export function ProjectCard({ project, selected, busy, onOpen, onMenu, onRename }: ProjectCardProps) {
  const { t, locale } = useI18n();

  function openMenuAt(event: React.MouseEvent): void {
    event.preventDefault();
    event.stopPropagation();
    onMenu(project, event.clientX, event.clientY);
  }

  function openMenuFromButton(event: React.MouseEvent<HTMLButtonElement>): void {
    event.stopPropagation();
    const rect = event.currentTarget.getBoundingClientRect();
    onMenu(project, rect.left, rect.bottom + 4);
  }

  function onKeyDown(event: React.KeyboardEvent): void {
    if (event.key === 'Enter') {
      event.preventDefault();
      event.stopPropagation();
      onOpen();
    } else if (event.key === 'F2') {
      event.preventDefault();
      event.stopPropagation();
      onRename();
    }
  }

  const stamp = project.lastOpenedAtMs ?? project.updatedAtMs;

  return (
    <article
      className={`project-card${selected ? ' project-card--selected' : ''}`}
      tabIndex={0}
      data-project-id={project.id}
      aria-label={project.name}
      onDoubleClick={onOpen}
      onKeyDown={onKeyDown}
      onContextMenu={openMenuAt}
    >
      <div className="project-card__preview" aria-hidden="true">
        <span className="project-card__preview-sheet">
          <ProjectsIcon size={22} />
        </span>
      </div>
      {project.favoriteAtMs !== undefined ? (
        <span className="project-card__favorite" aria-hidden="true">
          <StarIcon size={14} />
        </span>
      ) : null}
      <button
        type="button"
        className="project-card__main"
        onClick={onOpen}
        disabled={busy}
        title={t('projects.actions.open')}
      >
        <span className="project-card__name">{project.name}</span>
        <span className="project-card__meta">
          {t('projects.list.updatedAt', { date: formatProjectDate(stamp, locale) })}
        </span>
        {project.documentExists ? null : (
          <span className="project-card__warning">{t('projects.list.missingFile')}</span>
        )}
      </button>
      <button
        type="button"
        className="project-card__menu-button"
        aria-label={t('projects.actions.projectMenu', { name: project.name })}
        aria-haspopup="menu"
        onClick={openMenuFromButton}
        disabled={busy}
      >
        ⋯
      </button>
    </article>
  );
}
