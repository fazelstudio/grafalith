import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useI18n } from '../../app/i18n/resources';
import { notifyBootDataReady } from '../../app/boot';
import { useToast } from '../../app/shell/ToastProvider';
import { executeAppCommand, type AppCommandContext } from '../../registries/appCommands';
import { getProjectStore } from '../../platform/projects/projectService';
import {
  parseProjectError,
  type ProjectCanvas,
  type ProjectError,
  type ProjectKind,
  type ProjectSummary,
} from '../../platform/projects/types';
import { filterProjects } from '../projects/search';
import { copyColorRecents, pruneColorRecents } from '../editor/inspector/colorSwatches';
import { buildBlankScene, projectTemplateRegistry } from '../projects/templateRegistry';
import { projectKindRegistry, templateForKind } from '../projects/projectKinds';
import {
  homeWidgets,
  interceptProjectCreate,
  projectTemplates,
} from '../../platform/extensions/homeContributions';
import { getExtensionHost } from '../../platform/extensions/extensionHost';
import { extensionPanelStore } from '../../platform/extensions/extensionPanels';
import { getContextKeys } from '../../platform/context/contextKeys';
import { ExtensionErrorBoundary } from '../extension-manager/ExtensionErrorBoundary';
import { ChevronDownIcon, EditorIcon, GridViewIcon, ListViewIcon, PlusIcon } from '../../ui/icons';
import { resolveIcon } from '../../ui/iconRegistry';
import { Button, EmptyState, LoadingState, SearchInput } from '../../ui/primitives/controls';
import { Tooltip } from '../../ui/primitives/tooltip';
import { deriveHomeListState, toProjectOpenError, type ProjectOpenError } from './homeState';
import { ProjectCard } from './ProjectCard';
import { CreateProjectDialog, DeleteProjectDialog, RenameProjectDialog } from './ProjectDialogs';
import { ProjectMenu } from './ProjectMenu';
import './home.css';
import { preferenceService } from '../../platform/preferences/preferenceService';
import type { HomeViewMode } from '../../platform/preferences/editorWorkspace';

interface HomeScreenProps {
  onOpenProject: (id: string) => void;
}

type LoadState =
  | { kind: 'loading' }
  | { kind: 'ready'; projects: ProjectSummary[] }
  | { kind: 'failed'; error: ProjectError };

type DialogState =
  | null
  | { kind: 'create'; templateId: string; projectKind: ProjectKind }
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
  const [viewMode, setViewMode] = useState<HomeViewMode>(() => preferenceService.getHomeViewMode());
  const searchRef = useRef<HTMLInputElement>(null);
  const createMenuRef = useRef<HTMLDivElement>(null);

  const refresh = useCallback(async (initial: boolean) => {
    if (initial) setLoadState({ kind: 'loading' });
    try {
      const projects = await getProjectStore().list();
      setLoadState({ kind: 'ready', projects });
      // Recents live per project; drop rows whose project no longer exists.
      pruneColorRecents(projects.map((project) => project.id));
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
    // Home owns the context keys while no editor is mounted so `when`
    // clauses gate on live screen state.
    getContextKeys().syncEditorState({
      screen: 'home',
      editorType: 'none',
      hasActiveProject: false,
      selectedCount: 0,
      activeTool: 'select',
      layerSelected: false,
    });
  }, []);

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
    (project: ProjectSummary) => {
      if (openingId !== null) return;
      setOpeningId(project.id);
      setOpenError(null);
      setOpeningId(null);
      onOpenProject(project.id);
    },
    [openingId, onOpenProject],
  );

  async function createProject(name: string, templateId: string, canvas: ProjectCanvas): Promise<void> {
    if (dialogPending) return;
    setDialogPending(true);
    setDialogError(null);
    try {
      const builtin = projectTemplateRegistry.get(templateId);
      const extensionTemplate = builtin
        ? undefined
        : projectTemplates().find((template) => template.id === templateId);
      const template = builtin ?? projectTemplateRegistry.all()[0];
      const kind = extensionTemplate?.kind ?? template.kind;
      const created = await getProjectStore().create(
        name,
        builtin ? template.buildScene() : buildBlankScene(),
        kind,
        canvas,
      );
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

  function createOfKind(kind: ProjectKind): void {
    setCreateMenuOpen(false);
    // Extensions may redirect creation (custom template flow); otherwise
    // the kind default template opens as before.
    const redirect = interceptProjectCreate(kind);
    openDialog({ kind: 'create', templateId: redirect ?? templateForKind(kind).id, projectKind: kind });
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

  // Non-dialog project mutations run through the shared host commands so
  // the card menu, palette, and future extensions share one execution path.
  // Dialog-backed flows (create, rename, delete) keep typed field errors
  // and stay direct.
  const homeAppCtx: AppCommandContext = useMemo(
    () => ({
      notify,
      openProject: (id: string) => {
        const summary = projects.find((project) => project.id === id);
        if (summary) openProject(summary);
      },
      refreshHome: () => refresh(false),
      toggleFavorite: async (id: string) => {
        const current = projects.find((project) => project.id === id);
        if (current?.favoriteAtMs !== undefined) {
          await getProjectStore().unfavorite(id);
          notify(t('projects.notifications.unfavorited', { name: current.name }));
        } else {
          await getProjectStore().favorite(id);
          const name = current?.name ?? id;
          notify(t('projects.notifications.favorited', { name }));
        }
      },
    }),
    [notify, onOpenProject, refresh, projects, t],
  );

  const runHomeCommand = useCallback(
    async (id: string, patch?: Partial<AppCommandContext>, onError?: (raw: unknown) => void) => {
      const result = await executeAppCommand(id, { ...homeAppCtx, ...patch });
      if (result.status !== 'ok' && onError) onError(result);
    },
    [homeAppCtx],
  );

  async function duplicateProject(project: ProjectSummary): Promise<void> {
    setMenu(null);
    await runHomeCommand(
      'project.duplicate',
      {
        targetProjectId: project.id,
        duplicateProject: async () => {
          const copy = await getProjectStore().duplicate(project.id);
          copyColorRecents(project.id, copy.id);
          notify(t('projects.notifications.duplicated', { name: copy.name }));
        },
      },
      (result) => setOpenError(toProjectOpenError(parseProjectError(result), project.name)),
    );
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
    await runHomeCommand(
      'project.toggleFavorite',
      { targetProjectId: project.id },
      (result) => setOpenError(toProjectOpenError(parseProjectError(result), project.name)),
    );
  }

  async function unfavoriteProject(project: ProjectSummary): Promise<void> {
    setMenu(null);
    await runHomeCommand(
      'project.toggleFavorite',
      { targetProjectId: project.id },
      (result) => setOpenError(toProjectOpenError(parseProjectError(result), project.name)),
    );
  }

  function openDialog(next: DialogState): void {
    setDialog(next);    setDialogError(null);
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
      openDialog({ kind: 'create', templateId: 'blank', projectKind: 'design' });
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
        openProject(selected);
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
  function openExtensionWidget(extensionId: string): void {
    getExtensionHost().showOutput(extensionId);
    extensionPanelStore.openOutput(false);
  }
  function changeViewMode(mode: HomeViewMode): void {
    setViewMode(mode);
    preferenceService.setHomeViewMode(mode);
  }
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
            <div className="home__view-toggle" role="group" aria-label={t('home.view.label')}>
              <Tooltip content={t('home.view.grid')} placement="bottom">
                <button
                  type="button"
                  className={`home__view-button${viewMode === 'grid' ? ' home__view-button--active' : ''}`}
                  aria-pressed={viewMode === 'grid'}
                  aria-label={t('home.view.grid')}
                  onClick={() => changeViewMode('grid')}
                >
                  <GridViewIcon size={15} />
                </button>
              </Tooltip>
              <Tooltip content={t('home.view.list')} placement="bottom">
                <button
                  type="button"
                  className={`home__view-button${viewMode === 'list' ? ' home__view-button--active' : ''}`}
                  aria-pressed={viewMode === 'list'}
                  aria-label={t('home.view.list')}
                  onClick={() => changeViewMode('list')}
                >
                  <ListViewIcon size={15} />
                </button>
              </Tooltip>
            </div>
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
              className={createMenuOpen ? 'home__create-button--open' : undefined}
            >
              <PlusIcon size={15} />
              {t('home.actions.create')}
              <ChevronDownIcon className="home__create-chevron" size={13} />
            </Button>
            {createMenuOpen ? (
              <div id="home-create-menu" className="home__create-menu" role="menu">
                {projectKindRegistry.all().map((entry) => {
                  const KindIcon = resolveIcon(entry.icon) ?? EditorIcon;
                  return (
                    <button
                      key={entry.id}
                      type="button"
                      className="home__create-menu-item"
                      role="menuitem"
                      onClick={() => createOfKind(entry.id as ProjectKind)}
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
                          const items = Array.from(
                            createMenuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [],
                          );
                          const index = items.indexOf(event.currentTarget as HTMLElement);
                          const next =
                            event.key === 'ArrowDown' || event.key === 'End'
                              ? items[(index + 1) % items.length]
                              : items[(index - 1 + items.length) % items.length];
                          if (event.key === 'Home') items[0]?.focus();
                          else if (event.key === 'End') items[items.length - 1]?.focus();
                          else next?.focus();
                        }
                      }}
                    >
                      <KindIcon size={15} />
                      <span className="home__create-menu-title">{t(entry.labelKey)}</span>
                    </button>
                  );
                })}
                {projectTemplates().map((template) => (
                  <button
                    key={`extension-template:${template.id}`}
                    type="button"
                    className="home__create-menu-item"
                    role="menuitem"
                    onClick={() => {
                      setCreateMenuOpen(false);
                      openDialog({ kind: 'create', templateId: template.id, projectKind: template.kind });
                    }}
                  >
                    <EditorIcon size={15} />
                    <span className="home__create-menu-title">{template.title}</span>
                  </button>
                ))}
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

      {homeWidgets().length > 0 ? (
        <ExtensionErrorBoundary surface="home widgets">
          <section className="home__recent" aria-label={t('extensions.home.widgetsTitle')}>
            <h2 className="home__section-title">{t('extensions.home.widgetsTitle')}</h2>
            <div className="home__grid">
              {homeWidgets().map((widget) => (
                <button
                  key={widget.id}
                  type="button"
                  className="home__recent-card"
                  onClick={() => openExtensionWidget(widget.extensionId)}
                  title={widget.extensionId}
                >
                  <span>{widget.title}</span>
                </button>
              ))}
            </div>
          </section>
        </ExtensionErrorBoundary>
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
            <div className={viewMode === 'list' ? 'home__list' : 'home__grid'}>
              {visible.map((project) => (
                <ProjectCard
                  key={project.id}
                  project={project}
                  selected={project.id === selectedId}
                  busy={busy}
                  onOpen={() => openProject(project)}
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

      {listState?.kind === 'empty' ? (
        <div className="home__empty">
          <EmptyState title={t('home.empty')} />
        </div>
      ) : null}

      {menu ? (
        <ProjectMenu
          project={menu.project}
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          onOpen={() => {
            setMenu(null);
            void runHomeCommand('project.open', { targetProjectId: menu.project.id });
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
          kind={dialog.projectKind}
          onClose={() => {
            if (!dialogPending) openDialog(null);
          }}
          onConfirm={(name, canvas) => void createProject(name, dialog.templateId, canvas)}
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
