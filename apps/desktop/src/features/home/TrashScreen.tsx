import { useCallback, useEffect, useState } from 'react';
import { useI18n } from '../../app/i18n/resources';
import { useToast } from '../../app/shell/ToastProvider';
import {
  getProjectStore,
  TRASH_RETENTION_DAYS,
  TRASH_RETENTION_MS,
} from '../../platform/projects/projectService';
import { parseProjectError, type ProjectError, type TrashedProjectSummary } from '../../platform/projects/types';
import { Button, EmptyState, LoadingState } from '../../ui/primitives/controls';
import { DeletePermanentlyDialog } from './ProjectDialogs';
import './trash.css';

type LoadState =
  | { kind: 'loading' }
  | { kind: 'ready'; projects: TrashedProjectSummary[] }
  | { kind: 'failed'; error: ProjectError };

/** Recoverable project list with explicit restore and permanent-delete actions. */
export function TrashScreen() {
  const { t } = useI18n();
  const { notify } = useToast();
  const [loadState, setLoadState] = useState<LoadState>({ kind: 'loading' });
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [deleteProject, setDeleteProject] = useState<TrashedProjectSummary | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const refresh = useCallback(async (initial: boolean) => {
    if (initial) setLoadState({ kind: 'loading' });
    try {
      setLoadState({ kind: 'ready', projects: await getProjectStore().listTrash() });
    } catch (raw) {
      setLoadState({ kind: 'failed', error: parseProjectError(raw) });
    }
  }, []);

  useEffect(() => {
    void refresh(true);
    const interval = window.setInterval(() => void refresh(false), 60_000);
    return () => window.clearInterval(interval);
  }, [refresh]);

  async function restore(project: TrashedProjectSummary): Promise<void> {
    setPendingId(project.id);
    setActionError(null);
    try {
      await getProjectStore().restore(project.id);
      notify(t('projects.notifications.restored', { name: project.name }));
      await refresh(false);
    } catch (raw) {
      const error = parseProjectError(raw);
      setActionError(
        error.code === 'storage-unavailable'
          ? t(error.messageKey)
          : t('projects.trash.restoreFailed'),
      );
    } finally {
      setPendingId(null);
    }
  }

  async function permanentlyDelete(project: TrashedProjectSummary): Promise<void> {
    setPendingId(project.id);
    setActionError(null);
    try {
      await getProjectStore().deletePermanently(project.id);
      notify(t('projects.notifications.deleted', { name: project.name }));
      setDeleteProject(null);
      await refresh(false);
    } catch (raw) {
      const error = parseProjectError(raw);
      setActionError(
        error.code === 'storage-unavailable'
          ? t(error.messageKey)
          : t('projects.trash.deleteFailed'),
      );
    } finally {
      setPendingId(null);
    }
  }

  const projects = loadState.kind === 'ready' ? loadState.projects : [];

  return (
    <div className="trash">
      <header className="workspace-page-header trash__header">
        <div>
          <h1 className="workspace-page-title">{t('projects.trash.title')}</h1>
          <p className="workspace-page-description">
            {t('projects.trash.description', { days: TRASH_RETENTION_DAYS })}
          </p>
        </div>
      </header>

      {actionError && !deleteProject ? (
        <div className="trash__error" role="alert">
          <span>{actionError}</span>
          <Button variant="ghost" size="sm" onClick={() => setActionError(null)}>
            {t('common.actions.close')}
          </Button>
        </div>
      ) : null}

      {loadState.kind === 'loading' ? <LoadingState label={t('projects.loading')} /> : null}
      {loadState.kind === 'failed' ? (
        <EmptyState
          title={
            loadState.error.details
              ? t(loadState.error.messageKey, { details: loadState.error.details })
              : t(loadState.error.messageKey)
          }
          action={
            <Button variant="secondary" onClick={() => void refresh(true)}>
              {t('common.actions.retry')}
            </Button>
          }
        />
      ) : null}
      {loadState.kind === 'ready' && projects.length === 0 ? (
        <EmptyState
          title={t('projects.trash.emptyTitle')}
          description={t('projects.trash.emptyDescription')}
        />
      ) : null}
      {projects.length > 0 ? (
        <div className="trash__list">
          {projects.map((project) => {
            const days = Math.max(
              1,
              Math.ceil((project.deletedAtMs + TRASH_RETENTION_MS - Date.now()) / 86_400_000),
            );
            const busy = pendingId !== null;
            return (
              <article key={project.id} className="trash-card">
                <div className="trash-card__details">
                  <h2 className="trash-card__name">{project.name}</h2>
                  <p className="trash-card__meta">
                    {days === 1
                      ? t('projects.trash.dayRemaining')
                      : t('projects.trash.daysRemaining', { days })}
                  </p>
                </div>
                <div className="trash-card__actions">
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={busy}
                    onClick={() => void restore(project)}
                  >
                    {t('projects.actions.restore')}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="trash-card__delete"
                    disabled={busy}
                    onClick={() => setDeleteProject(project)}
                  >
                    {t('projects.actions.deletePermanently')}
                  </Button>
                </div>
              </article>
            );
          })}
        </div>
      ) : null}

      {deleteProject ? (
        <DeletePermanentlyDialog
          project={deleteProject}
          onClose={() => setDeleteProject(null)}
          onConfirm={() => void permanentlyDelete(deleteProject)}
          pending={pendingId === deleteProject.id}
          error={actionError}
        />
      ) : null}
    </div>
  );
}
