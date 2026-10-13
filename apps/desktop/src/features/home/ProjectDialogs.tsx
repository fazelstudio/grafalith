import { useState } from 'react';
import { useI18n } from '../../app/i18n/resources';
import { validateProjectName } from '../projects/projectNames';
import type { ProjectCanvas, ProjectKind, ProjectSummary } from '../../platform/projects/types';
import { Button, SegmentedControl, Select, TextInput } from '../../ui/primitives/controls';
import { Dialog } from '../../ui/primitives/overlays';
import { TRASH_RETENTION_DAYS } from '../../platform/projects/projectService';
import { persistenceConfig } from '../../platform/projects/persistenceConfig';
import {
  applyOrientation,
  CANVAS_UNITS,
  canvasPresetRegistry,
  defaultCanvasForKind,
  fromSceneUnits,
  presetDimensions,
  toSceneUnits,
  type CanvasPresetDefinition,
} from '../projects/canvasPresets';

interface CreateDialogProps {
  kind: ProjectKind;
  onClose: () => void;
  onConfirm: (name: string, canvas: ProjectCanvas) => void;
  pending: boolean;
  error: string | null;
}

type CanvasOrientation = 'portrait' | 'landscape';

interface CanvasSelection {
  mode: 'infinite' | 'fixed';
  presetId: string;
  width: string;
  height: string;
  unit: CanvasPresetDefinition['unit'];
  orientation: CanvasOrientation;
}

/** Starting canvas for the dialog: kind default, whiteboard always infinite. */
function initialCanvasSelection(kind: ProjectKind): CanvasSelection {
  const canvas = defaultCanvasForKind(kind);
  if (canvas.mode === 'infinite') {
    return { mode: 'infinite', presetId: 'custom', width: '', height: '', unit: 'px', orientation: 'portrait' };
  }
  const preset = canvasPresetRegistry.get('slide-16x9') ?? canvasPresetRegistry.all()[0];
  return {
    mode: 'fixed',
    presetId: preset.id,
    width: String(preset.width),
    height: String(preset.height),
    unit: preset.unit,
    orientation: 'portrait',
  };
}

function matchingPresetId(width: string, height: string, unit: CanvasPresetDefinition['unit']): string {
  const w = Number(width);
  const h = Number(height);
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return 'custom';
  for (const preset of canvasPresetRegistry.all()) {
    if (preset.unit !== unit) continue;
    if (Math.abs(preset.width - w) < 1e-9 && Math.abs(preset.height - h) < 1e-9) return preset.id;
    if (Math.abs(preset.width - h) < 1e-9 && Math.abs(preset.height - w) < 1e-9) return preset.id;
  }
  return 'custom';
}

function resolveCanvas(selection: CanvasSelection): ProjectCanvas | null {
  if (selection.mode === 'infinite') return { mode: 'infinite', width: 0, height: 0, unit: 'px' };
  const width = Number(selection.width);
  const height = Number(selection.height);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
  return {
    mode: 'fixed',
    width: toSceneUnits(width, selection.unit),
    height: toSceneUnits(height, selection.unit),
    unit: selection.unit,
  };
}

/** Collects and validates a project name before creating the selected template. */
export function CreateProjectDialog({ kind, onClose, onConfirm, pending, error }: CreateDialogProps) {
  const { t } = useI18n();
  const [name, setName] = useState('');
  const [canvas, setCanvas] = useState<CanvasSelection>(() => initialCanvasSelection(kind));
  const [validationKey, setValidationKey] = useState<string | null>(null);
  // Slides are always fixed pages; only Design chooses between canvases.
  const showCanvas = kind !== 'whiteboard';
  const showModeToggle = kind === 'design';

  function confirm(): void {
    if (pending) return;
    const checked = validateProjectName(name);
    if (!checked.ok) {
      setValidationKey(checked.errorKey);
      return;
    }
    const resolved = resolveCanvas(canvas);
    if (!resolved) {
      setValidationKey('projects.errors.invalidCanvas');
      return;
    }
    onConfirm(checked.value, resolved);
  }

  function patchCanvas(patch: Partial<CanvasSelection>): void {
    setCanvas((current) => ({ ...current, ...patch }));
    setValidationKey(null);
  }

  function selectPreset(presetId: string): void {
    if (presetId === 'custom') {
      patchCanvas({ presetId });
      return;
    }
    const preset = canvasPresetRegistry.get(presetId);
    if (!preset) return;
    const dims = presetDimensions(preset, canvas.orientation);
    patchCanvas({ presetId, width: String(dims.width), height: String(dims.height), unit: preset.unit });
  }

  function selectOrientation(orientation: CanvasOrientation): void {
    const width = Number(canvas.width);
    const height = Number(canvas.height);
    const swapped =
      Number.isFinite(width) && Number.isFinite(height)
        ? applyOrientation(width, height, orientation)
        : { width, height };
    patchCanvas({
      orientation,
      width: Number.isFinite(swapped.width) ? String(swapped.width) : canvas.width,
      height: Number.isFinite(swapped.height) ? String(swapped.height) : canvas.height,
      presetId: 'custom',
    });
  }

  function selectUnit(unit: CanvasPresetDefinition['unit']): void {
    const width = Number(canvas.width);
    const height = Number(canvas.height);
    if (!Number.isFinite(width) || !Number.isFinite(height)) {
      patchCanvas({ unit });
      return;
    }
    patchCanvas({
      unit,
      width: String(fromSceneUnits(toSceneUnits(width, canvas.unit), unit)),
      height: String(fromSceneUnits(toSceneUnits(height, canvas.unit), unit)),
    });
  }

  const activePresetId = canvas.presetId === 'custom' ? matchingPresetId(canvas.width, canvas.height, canvas.unit) : canvas.presetId;

  return (
    <Dialog
      title={t('projects.dialogs.createTitle')}
      onClose={onClose}
      className="home-dialog--create"
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
        {showCanvas ? (
          <>
            {showModeToggle ? (
              <SegmentedControl<CanvasSelection['mode']>
                label={t('projects.canvas.modeLabel')}
                value={canvas.mode}
                onChange={(mode) => patchCanvas({ mode })}
                options={[
                  { value: 'infinite', label: t('projects.canvas.infinite') },
                  { value: 'fixed', label: t('projects.canvas.fixed') },
                ]}
              />
            ) : null}
            {canvas.mode === 'fixed' ? (
              <>
                <Select
                  label={t('projects.canvas.presetLabel')}
                  value={activePresetId}
                  onChange={(presetId) => selectPreset(presetId)}
                  options={[
                    { value: 'custom', label: t('projects.canvas.custom') },
                    ...canvasPresetRegistry
                      .all()
                      .map((preset) => ({ value: preset.id, label: t(preset.labelKey) })),
                  ]}
                />
                <div className="home-dialog__row">
                  <TextInput
                    label={t('projects.canvas.widthLabel')}
                    value={canvas.width}
                    inputMode="decimal"
                    disabled={pending}
                    onChange={(event) => patchCanvas({ width: event.target.value, presetId: 'custom' })}
                  />
                  <TextInput
                    label={t('projects.canvas.heightLabel')}
                    value={canvas.height}
                    inputMode="decimal"
                    disabled={pending}
                    onChange={(event) => patchCanvas({ height: event.target.value, presetId: 'custom' })}
                  />
                  <Select
                    label={t('projects.canvas.unitLabel')}
                    value={canvas.unit}
                    onChange={(unit) => selectUnit(unit as CanvasPresetDefinition['unit'])}
                    options={CANVAS_UNITS.map((unit) => ({ value: unit, label: unit }))}
                  />
                </div>
                <SegmentedControl<CanvasOrientation>
                  label={t('projects.canvas.orientationLabel')}
                  value={canvas.orientation}
                  onChange={(orientation) => selectOrientation(orientation)}
                  options={[
                    { value: 'portrait', label: t('projects.canvas.portrait') },
                    { value: 'landscape', label: t('projects.canvas.landscape') },
                  ]}
                />
              </>
            ) : null}
          </>
        ) : null}
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
