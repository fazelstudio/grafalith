import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useI18n } from '../../app/i18n/resources';
import { notifyBootDataReady } from '../../app/boot';
import { useToast } from '../../app/shell/ToastProvider';
import { getProjectStore } from '../../platform/projects/projectService';
import { parseProjectError, type ProjectError, type ProjectSummary } from '../../platform/projects/types';
import { filterProjects } from '../projects/search';
import { projectTemplateRegistry } from '../projects/templateRegistry';
import { ChevronDownIcon, EditorIcon, PlusIcon } from '../../ui/icons';
import { Button, EmptyState, LoadingState, SearchInput } from '../../ui/primitives/controls';
import { deriveHomeListState, toProjectOpenError, type ProjectOpenError } from './homeState';
import { ProjectCard } from './ProjectCard';
import { CreateProjectDialog, DeleteProjectDialog, RenameProjectDialog } from './ProjectDialogs';
import { ProjectMenu } from './ProjectMenu';
import './home.css';

interface HomeScreenProps {
  onOpenProject: (id: string) => void;
}

type LoadState =
  | { kind: 'loading' }
  | { kind: 'ready'; projects: ProjectSummary[] }
  | { kind: 'failed'; error: ProjectError };

type DialogState =
  | null
  | { kind: 'create'; templateId: string }
  | { kind: 'rename'; project: ProjectSummary }
  | { kind: 'delete'; project: ProjectSummary };

interface MenuState {
  project: ProjectSummary;
  x: number;
  y: number;
}

/** Home level: create, discover, search, and manage local projects. */
export function HomeScreen({ onOpenProject }: HomeScreenProps) {
  const { t } = useI18n();
  const { notify } = useToast();
  const [loadState, setLoadState] = useState<LoadState>({ kind: 'loading' });
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [dialog, setDialog] = useState<DialogState>(null);
  const [dialogPending, setDialogPending] = useState(false);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [createMenuOpen, setCreateMenuOpen] = useState(false);
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [openError, setOpenError] = useState<ProjectOpenError | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const createMenuRef = useRef<HTMLDivElement>(null);

  const refresh = useCallback(async (initial: boolean) => {
    if (initial) setLoadState({ kind: 'loading' });
    try {
      const projects = await getProjectStore().list();
      setLoadState({ kind: 'ready', projects });
    } catch (raw) {
      setLoadState({ kind: 'failed', error: parseProjectError(raw) });
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      await refresh(true);
      // Settled list (or settled error) means first content is ready to show.
      if (!cancelled) notifyBootDataReady();
    })();
    return () => {
      cancelled = true;
    };
  }, [refresh]);

  useEffect(() => {
    if (!createMenuOpen) return;
    createMenuRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    function onPointerDown(event: PointerEvent): void {
      if (!createMenuRef.current?.contains(event.target as Node)) setCreateMenuOpen(false);
    }
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [createMenuOpen]);

  const projects = loadState.kind === 'ready' ? loadState.projects : [];
  const filtered = useMemo(() => filterProjects(projects, query), [projects, query]);
  const listState =
    loadState.kind === 'ready' ? deriveHomeListState(projects, query, filtered) : null;
  const visible =
    listState?.kind === 'populated' || listState?.kind === 'search-results'
      ? listState.projects
      : [];

  useEffect(() => {
    if (selectedId !== null && !visible.some((project) => project.id === selectedId)) {
      setSelectedId(null);
    }
  }, [visible, selectedId]);

  function describeError(error: ProjectError): string {
    return error.details !== undefined
      ? t(error.messageKey, { details: error.details })
      : t(error.messageKey);
  }

  const openProject = useCallback(
    async (project: ProjectSummary) => {
      if (openingId !== null) return;
      setOpeningId(project.id);
      setOpenError(null);
      try {
        await getProjectStore().open(project.id);
        onOpenProject(project.id);
      } catch (raw) {
        setOpenError(toProjectOpenError(parseProjectError(raw), project.name));
      } finally {
        setOpeningId(null);
      }
    },
    [openingId, onOpenProject],
  );

  async function createProject(name: string, templateId: string): Promise<void> {
    if (dialogPending) return;
    setDialogPending(true);
    setDialogError(null);
    try {
      const template = projectTemplateRegistry.get(templateId) ?? projectTemplateRegistry.all()[0];
      const created = await getProjectStore().create(name, template.buildScene());
      notify(t('projects.notifications.created', { name: created.name }));
      setDialog(null);
      onOpenProject(created.id);
    } catch (raw) {
      const error = parseProjectError(raw);
      const message =
        error.code === 'invalid-name' ? describeError(error) : t('projects.errors.createFailed');
      setDialogError(message);
    } finally {
      setDialogPending(false);
    }
  }

  function createDesign(): void {
    setCreateMenuOpen(false);
    openDialog({ kind: 'create', templateId: 'blank' });
  }

  async function renameProject(id: string, name: string): Promise<void> {
    setDialogPending(true);
    setDialogError(null);
    try {
      const renamed = await getProjectStore().rename(id, name);
      notify(t('projects.notifications.renamed', { name: renamed.name }));
      setDialog(null);
      await refresh(false);
    } catch (raw) {
      setDialogError(describeError(parseProjectError(raw)));
    } finally {
      setDialogPending(false);
    }
  }

  async function duplicateProject(project: ProjectSummary): Promise<void> {
    setMenu(null);
    try {
      const copy = await getProjectStore().duplicate(project.id);
      notify(t('projects.notifications.duplicated', { name: copy.name }));
      await refresh(false);
    } catch (raw) {
      setOpenError(toProjectOpenError(parseProjectError(raw), project.name));
    }
  }

  async function deleteProject(project: ProjectSummary): Promise<void> {
    setDialogPending(true);
    setDialogError(null);
    try {
      await getProjectStore().remove(project.id);
      notify(t('projects.notifications.trashed', { name: project.name }));
      setDialog(null);
      if (selectedId === project.id) setSelectedId(null);
      await refresh(false);
    } catch (raw) {
      setDialogError(describeError(parseProjectError(raw)));
    } finally {
      setDialogPending(false);
    }
  }

  async function favoriteProject(project: ProjectSummary): Promise<void> {
    setMenu(null);
    try {
      await getProjectStore().favorite(project.id);
      notify(t('projects.notifications.favorited', { name: project.name }));
      await refresh(false);
    } catch (raw) {
      setOpenError(toProjectOpenError(parseProjectError(raw), project.name));
    }
  }

  async function unfavoriteProject(project: ProjectSummary): Promise<void> {
    setMenu(null);
    try {
      await getProjectStore().unfavorite(project.id);
      notify(t('projects.notifications.unfavorited', { name: project.name }));
      await refresh(false);
    } catch (raw) {
      setOpenError(toProjectOpenError(parseProjectError(raw), project.name));
    }
  }

  function openDialog(next: DialogState): void {
    setDialog(next);
    setDialogError(null);
    setDialogPending(false);
  }

  function onHomeKeyDown(event: React.KeyboardEvent): void {
    if (dialog !== null) return;
    const target = event.target as HTMLElement;
    if (event.key === 'Escape' && createMenuOpen) {
      event.preventDefault();
      setCreateMenuOpen(false);
      return;
    }
    if (target.closest('[role="dialog"]') || target.closest('[role="menu"]')) return;
    const typing =
      target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT';
    if (event.key === 'Escape') {
      if (menu !== null) {
        setMenu(null);
        return;
      }
      if (!typing && query !== '') {
        setQuery('');
      }
      return;
    }
    if (typing) return;
    if (event.key === 'n' || event.key === 'N') {
      event.preventDefault();
      openDialog({ kind: 'create', templateId: 'blank' });
    } else if (event.key === '/') {
      event.preventDefault();
      searchRef.current?.focus();
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      if (visible.length === 0) return;
      event.preventDefault();
      const index = visible.findIndex((project) => project.id === selectedId);
      const next =
        event.key === 'ArrowDown'
          ? visible[(index + 1 + visible.length) % visible.length]
          : visible[(index - 1 + visible.length) % visible.length];
      setSelectedId(next.id);
      // Focus follows the highlight so screen readers announce the move.
      document.querySelector<HTMLElement>(`[data-project-id="${next.id}"]`)?.focus();
    } else if (event.key === 'Enter') {
      const selected = visible.find((project) => project.id === selectedId);
      if (selected && target.tagName !== 'BUTTON') {
        event.preventDefault();
        void openProject(selected);
      }
    } else if (event.key === 'F2') {
      const selected = visible.find((project) => project.id === selectedId);
      if (selected) {
        event.preventDefault();
        openDialog({ kind: 'rename', project: selected });
      }
    }
  }

  const busy = openingId !== null;
  const showRecentSection =
    loadState.kind === 'loading' ||
    loadState.kind === 'failed' ||
    listState?.kind === 'populated' ||
    listState?.kind === 'search-results' ||
    listState?.kind === 'search-empty';

  return (
    <div className="home" onKeyDown={onHomeKeyDown}>
      <header className="workspace-page-header home__page-header">
        <div>
          <h1 className="workspace-page-title">{t('navigation.projects')}</h1>
          <p className="workspace-page-description">{t('home.description')}</p>
        </div>
        <div className="home__header-actions">
          <div className="home__toolbar">
            <SearchInput
              label={t('home.search.label')}
              placeholder={t('home.search.placeholder')}
              value={query}
              inputRef={searchRef}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  event.stopPropagation();
                  if (query !== '') {
                    setQuery('');
                  } else {
                    event.currentTarget.blur();
                  }
                }
              }}
            />
          </div>
          <div className="home__create" ref={createMenuRef}>
            <Button
              variant="primary"
              disabled={dialogPending}
              onClick={() => setCreateMenuOpen((open) => !open)}
              aria-haspopup="menu"
              aria-expanded={createMenuOpen}
              aria-controls="home-create-menu"
            >
              <PlusIcon size={15} />
              {t('home.actions.create')}
              <ChevronDownIcon className="home__create-chevron" size={13} />
            </Button>
            {createMenuOpen ? (
              <div id="home-create-menu" className="home__create-menu" role="menu">
                <button
                  type="button"
                  className="home__create-menu-item"
                  role="menuitem"
                  onClick={createDesign}
                  onKeyDown={(event) => {
                    if (event.key === 'Escape') {
                      event.preventDefault();
                      event.stopPropagation();
                      setCreateMenuOpen(false);
                      createMenuRef.current
                        ?.querySelector<HTMLElement>('[aria-haspopup="menu"]')
                        ?.focus();
                    } else if (
                      event.key === 'ArrowDown' ||
                      event.key === 'ArrowUp' ||
                      event.key === 'Home' ||
                      event.key === 'End'
                    ) {
                      event.preventDefault();
                      createMenuRef.current
                        ?.querySelector<HTMLElement>('[role="menuitem"]')
                        ?.focus();
                    }
                  }}
                >
                  <EditorIcon size={15} />
                  <span className="home__create-menu-title">{t('home.actions.design')}</span>
                </button>
              </div>
            ) : null}
          </div>
        </div>
      </header>

      {openError ? (
        <div className="home__banner" role="alert">
          <span>
            {openError.details !== undefined
              ? t(openError.messageKey, { details: openError.details })
              : t(openError.messageKey)}
          </span>
          <Button variant="ghost" size="sm" onClick={() => setOpenError(null)}>
            {t('common.actions.close')}
          </Button>
        </div>
      ) : null}

      {openingId !== null ? (
        <div className="home__status" role="status" aria-live="polite">
          {t('projects.opening', {
            name: projects.find((project) => project.id === openingId)?.name ?? '',
          })}
        </div>
      ) : null}

      {showRecentSection ? (
        <section className="home__recent" aria-label={t('home.recent.title')}>
          <h2 className="home__section-title">{t('home.recent.title')}</h2>
          {loadState.kind === 'loading' ? (
            <div className="home__recent-card">
              <LoadingState label={t('projects.loading')} />
            </div>
          ) : null}
          {loadState.kind === 'failed' ? (
            <div className="home__recent-card">
              <EmptyState
                title={describeError(loadState.error)}
                action={
                  <Button variant="secondary" onClick={() => void refresh(true)}>
                    {t('common.actions.retry')}
                  </Button>
                }
              />
            </div>
          ) : null}
          {listState?.kind === 'search-empty' ? (
            <div className="home__recent-card">
              <EmptyState
                title={t('projects.search.noResultsTitle')}
                description={t('projects.search.noResultsDescription', { query: listState.query })}
              />
            </div>
          ) : null}
          {listState?.kind === 'search-results' ? (
            <p className="home__count" aria-live="polite">
              {t('projects.search.resultsCount', {
                count: listState.projects.length,
                total: listState.total,
              })}
            </p>
          ) : null}
          {visible.length > 0 ? (
            <div className="home__grid">
              {visible.map((project) => (
                <ProjectCard
                  key={project.id}
                  project={project}
                  selected={project.id === selectedId}
                  busy={busy}
                  onOpen={() => void openProject(project)}
                  onMenu={(entry, x, y) => {
                    setSelectedId(entry.id);
                    setMenu({ project: entry, x, y });
                  }}
                  onRename={() => openDialog({ kind: 'rename', project })}
                />
              ))}
            </div>
          ) : null}
        </section>
      ) : null}

      {menu ? (
        <ProjectMenu
          project={menu.project}
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          onOpen={() => {
            setMenu(null);
            void openProject(menu.project);
          }}
          onRename={() => {
            setMenu(null);
            openDialog({ kind: 'rename', project: menu.project });
          }}
          onDuplicate={() => void duplicateProject(menu.project)}
          onDelete={() => {
            setMenu(null);
            openDialog({ kind: 'delete', project: menu.project });
          }}
          onFavorite={() => void favoriteProject(menu.project)}
          onUnfavorite={() => void unfavoriteProject(menu.project)}
        />
      ) : null}

      {dialog?.kind === 'create' ? (
        <CreateProjectDialog
          onClose={() => {
            if (!dialogPending) openDialog(null);
          }}
          onConfirm={(name) => void createProject(name, dialog.templateId)}
          pending={dialogPending}
          error={dialogError}
        />
      ) : null}
      {dialog?.kind === 'rename' ? (
        <RenameProjectDialog
          project={dialog.project}
          onClose={() => openDialog(null)}
          onConfirm={(name) => void renameProject(dialog.project.id, name)}
          pending={dialogPending}
          error={dialogError}
        />
      ) : null}
      {dialog?.kind === 'delete' ? (
        <DeleteProjectDialog
          project={dialog.project}
          onClose={() => openDialog(null)}
          onConfirm={() => void deleteProject(dialog.project)}
          pending={dialogPending}
          error={dialogError}
        />
      ) : null}
    </div>
  );
}
