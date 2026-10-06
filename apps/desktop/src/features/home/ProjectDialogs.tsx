import { useState } from 'react';
import { useI18n } from '../../app/i18n/resources';
import { validateProjectName } from '../projects/projectNames';
import type { ProjectSummary } from '../../platform/projects/types';
import { Button, TextInput } from '../../ui/primitives/controls';
import { Dialog } from '../../ui/primitives/overlays';
import { TRASH_RETENTION_DAYS } from '../../platform/projects/projectService';
import { persistenceConfig } from '../../platform/projects/persistenceConfig';

interface CreateDialogProps {
  onClose: () => void;
  onConfirm: (name: string) => void;
  pending: boolean;
  error: string | null;
}

/** Collects and validates a project name before creating the selected template. */
export function CreateProjectDialog({ onClose, onConfirm, pending, error }: CreateDialogProps) {
  const { t } = useI18n();
  const [name, setName] = useState('');
  const [validationKey, setValidationKey] = useState<string | null>(null);

  function confirm(): void {
    if (pending) return;
    const checked = validateProjectName(name);
    if (!checked.ok) {
      setValidationKey(checked.errorKey);
      return;
    }
    onConfirm(checked.value);
  }

  return (
    <Dialog
      title={t('projects.dialogs.createTitle')}
      onClose={onClose}
      actions={
        <>
          <Button variant="secondary" onClick={onClose} disabled={pending}>
            {t('common.actions.cancel')}
          </Button>
          <Button variant="primary" onClick={confirm} disabled={pending || name.trim() === ''}>
            {t(pending ? 'projects.actions.creating' : 'projects.actions.create')}
          </Button>
        </>
      }
    >
      <div className="home-dialog__fields">
        <TextInput
          label={t('projects.dialogs.nameLabel')}
          placeholder={t('projects.dialogs.namePlaceholder')}
          value={name}
          maxLength={persistenceConfig.maxNameLength * 2}
          disabled={pending}
          onChange={(event) => {
            setName(
              [...event.currentTarget.value]
                .slice(0, persistenceConfig.maxNameLength)
                .join(''),
            );
            setValidationKey(null);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && name.trim() !== '') confirm();
          }}
        />
        {validationKey ? (
          <p className="home-dialog__error" role="alert">
            {t(validationKey)}
          </p>
        ) : null}
        {error ? (
          <p className="home-dialog__error" role="alert">
            {error}
          </p>
        ) : null}
      </div>
    </Dialog>
  );
}

interface RenameDialogProps {
  project: ProjectSummary;
  onClose: () => void;
  onConfirm: (name: string) => void;
  pending: boolean;
  error: string | null;
}

/** Compact rename with focus preserved and Escape discarding the draft. */
export function RenameProjectDialog({ project, onClose, onConfirm, pending, error }: RenameDialogProps) {
  const { t } = useI18n();
  const [name, setName] = useState(project.name);
  const [validationKey, setValidationKey] = useState<string | null>(null);

  function confirm(): void {
    const checked = validateProjectName(name);
    if (!checked.ok) {
      setValidationKey(checked.errorKey);
      return;
    }
    onConfirm(checked.value);
  }

  return (
    <Dialog
      title={t('projects.dialogs.renameTitle')}
      onClose={onClose}
      actions={
        <>
          <Button variant="secondary" onClick={onClose} disabled={pending}>
            {t('common.actions.cancel')}
          </Button>
          <Button variant="primary" onClick={confirm} disabled={pending}>
            {t('projects.actions.rename')}
          </Button>
        </>
      }
    >
      <div className="home-dialog__fields">
        <TextInput
          label={t('projects.dialogs.renameLabel')}
          value={name}
          disabled={pending}
          onChange={(event) => {
            setName(event.target.value);
            setValidationKey(null);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') confirm();
          }}
        />
        {validationKey ? (
          <p className="home-dialog__error" role="alert">
            {t(validationKey)}
          </p>
        ) : null}
        {error ? (
          <p className="home-dialog__error" role="alert">
            {error}
          </p>
        ) : null}
      </div>
    </Dialog>
  );
}

interface DeleteDialogProps {
  project: ProjectSummary;
  onClose: () => void;
  onConfirm: () => void;
  pending: boolean;
  error: string | null;
}

/** Destructive confirmation naming the project and stating permanence. */
export function DeleteProjectDialog({ project, onClose, onConfirm, pending, error }: DeleteDialogProps) {
  const { t } = useI18n();

  return (
    <Dialog
      title={t('projects.dialogs.deleteTitle', { name: project.name })}
      description={t('projects.dialogs.deleteDescription', { days: TRASH_RETENTION_DAYS })}
      onClose={onClose}
      actions={
        <>
          <Button variant="secondary" onClick={onClose} disabled={pending}>
            {t('common.actions.cancel')}
          </Button>
          <Button variant="destructive" onClick={onConfirm} disabled={pending}>
            {t('projects.actions.confirmDelete')}
          </Button>
        </>
      }
    >
      <p className="home-dialog__note">{t('projects.dialogs.deleteNote', { days: TRASH_RETENTION_DAYS })}</p>
      {error ? (
        <p className="home-dialog__error" role="alert">
          {error}
        </p>
      ) : null}
    </Dialog>
  );
}

/** Explicit confirmation for deletion from Trash, which cannot be restored. */
export function DeletePermanentlyDialog({
  project,
  onClose,
  onConfirm,
  pending,
  error,
}: DeleteDialogProps) {
  const { t } = useI18n();

  return (
    <Dialog
      title={t('projects.dialogs.deletePermanentlyTitle', { name: project.name })}
      description={t('projects.dialogs.deletePermanentlyDescription')}
      onClose={onClose}
      actions={
        <>
          <Button variant="secondary" onClick={onClose} disabled={pending}>
            {t('common.actions.cancel')}
          </Button>
          <Button variant="destructive" onClick={onConfirm} disabled={pending}>
            {t('projects.actions.deletePermanently')}
          </Button>
        </>
      }
    >
      {error ? (
        <p className="home-dialog__error" role="alert">
          {error}
        </p>
      ) : null}
    </Dialog>
  );
}
