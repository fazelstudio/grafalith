import { useEffect, useState } from 'react';
import { MIXED, type InspectorFieldDefinition, type InspectorFieldContext } from './descriptors';
import { useI18n } from '../../../app/i18n/resources';
import { commandShortcutLabel, formatShortcut } from '../../../registries';

interface FieldProps {
  field: InspectorFieldDefinition;
  ctx: InspectorFieldContext;
  onResult: (fieldId: string, ok: boolean, message: string | null) => void;
}

function useDraft(value: string | number | boolean | typeof MIXED): [string, (next: string) => void, string] {
  const committed = value === MIXED ? '' : String(value);
  const [draft, setDraft] = useState(committed);
  useEffect(() => {
    setDraft(committed);
  }, [committed]);
  return [draft, setDraft, committed];
}

function mixedPlaceholder(t: (key: string) => string): string {
  return t('editor.inspector.mixed');
}

/** Numeric input committing on blur/Enter (one history entry per commit, not per keystroke). */
export function NumberTemplate({ field, ctx, onResult }: FieldProps) {
  const { t } = useI18n();
  const value = field.read(ctx);
  const [draft, setDraft] = useDraft(value);
  const disabled = field.disabled?.(ctx) ?? false;

  async function commit(raw: string) {
    if (disabled) return;
    const numeric = Number(raw);
    if (raw.trim() === '' || !Number.isFinite(numeric)) {
      onResult(field.id, false, t('editor.errors.invalidNumber'));
      return;
    }
    const result = await field.write(numeric, ctx);
    onResult(field.id, result.status === 'ok', result.status === 'ok' ? null : t('editor.errors.commandFailed', { message: field.defaultLabel }));
  }

  return (
    <label className="inspector-field">
      <span className="inspector-field__label">{t(field.labelKey)}</span>
      <span className="inspector-field__control">
        <input
          type="number"
          className="ui-input inspector-field__input"
          value={value === MIXED ? draft : draft}
          placeholder={value === MIXED ? mixedPlaceholder(t) : undefined}
          disabled={disabled}
          min={field.min}
          max={field.max}
          step={field.step ?? 1}
          aria-label={t(field.labelKey)}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={(event) => void commit(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              void commit((event.target as HTMLInputElement).value);
            }
            // Arrow keys adjust natively; global nudge shortcuts stay
            // suppressed while the input owns focus (focus-aware guard).
            event.stopPropagation();
          }}
        />
        {field.unit ? <span className="inspector-field__unit">{field.unit}</span> : null}
      </span>
    </label>
  );
}

/** Color input for solid fills/strokes only (gradients stay disabled by descriptor). */
export function ColorTemplate({ field, ctx, onResult }: FieldProps) {
  const { t } = useI18n();
  const value = field.read(ctx);
  const disabled = field.disabled?.(ctx) ?? false;
  const solid = typeof value === 'string' ? value : '#000000';

  async function commit(next: string) {
    const result = await field.write(next, ctx);
    onResult(field.id, result.status === 'ok', result.status === 'ok' ? null : t('editor.errors.commandFailed', { message: next }));
  }

  if (value === MIXED && !disabled) {
    return (
      <label className="inspector-field">
        <span className="inspector-field__label">{t(field.labelKey)}</span>
        <span className="inspector-field__control">
          <input
            type="color"
            className="inspector-field__color"
            value="#000000"
            disabled={disabled}
            aria-label={t(field.labelKey)}
            onChange={(event) => void commit(event.target.value)}
            onKeyDown={(event) => event.stopPropagation()}
          />
          <span className="inspector-field__mixed">{mixedPlaceholder(t)}</span>
        </span>
      </label>
    );
  }

  return (
    <label className="inspector-field">
      <span className="inspector-field__label">{t(field.labelKey)}</span>
      <span className="inspector-field__control">
        <input
          type="color"
          className="inspector-field__color"
          value={disabled ? '#000000' : solid}
          disabled={disabled}
          aria-label={t(field.labelKey)}
          title={disabled ? t('editor.inspector.gradientNote') : t(field.labelKey)}
          onChange={(event) => void commit(event.target.value)}
          onKeyDown={(event) => event.stopPropagation()}
        />
        <span className="inspector-field__value" title={disabled ? t('editor.inspector.gradientNote') : solid}>
          {disabled ? t('editor.inspector.gradientNote') : solid}
        </span>
      </span>
    </label>
  );
}

/** Segmented option control (dash style and similar enumerations). */
export function SegmentedTemplate({ field, ctx, onResult }: FieldProps) {
  const { t } = useI18n();
  const value = field.read(ctx);
  const disabled = field.disabled?.(ctx) ?? false;

  async function pick(next: string) {
    const result = await field.write(next, ctx);
    onResult(field.id, result.status === 'ok', result.status === 'ok' ? null : t('editor.errors.commandFailed', { message: next }));
  }

  return (
    <span className="inspector-field">
      <span className="inspector-field__label">{t(field.labelKey)}</span>
      <span className="inspector-field__control">
        <span className="ui-segmented" role="radiogroup" aria-label={t(field.labelKey)}>
          {(field.options ?? []).map((option) => (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={value === option.value}
              disabled={disabled}
              title={t(option.labelKey)}
              className="ui-segmented__option"
              onClick={() => void pick(option.value)}
              onKeyDown={(event) => event.stopPropagation()}
            >
              {t(option.labelKey)}
            </button>
          ))}
        </span>
        {value === MIXED ? <span className="inspector-field__mixed">{mixedPlaceholder(t)}</span> : null}
      </span>
    </span>
  );
}

/** Read-only metadata (id, kind, text content without a write op). */
export function ReadonlyTemplate({ field, ctx }: FieldProps) {
  const { t } = useI18n();
  const value = field.read(ctx);
  const text = value === MIXED ? '—' : String(value);
  return (
    <div className="inspector-field">
      <dt className="inspector-field__label">{t(field.labelKey)}</dt>
      <dd className="inspector-field__value" title={text}>
        {text}
      </dd>
    </div>
  );
}

/** Alignment buttons delegating to the shared align/distribute commands. */
export function AlignmentTemplate({
  onAlign,
  canAlign,
  onDistribute,
  canDistribute,
}: {
  onAlign: (mode: string) => void;
  canAlign: boolean;
  onDistribute: (axis: string) => void;
  canDistribute: boolean;
}) {
  const { t } = useI18n();
  const aligns: { mode: string; label: string }[] = [
    { mode: 'left', label: t('editor.commands.alignLeft') },
    { mode: 'centerH', label: t('editor.commands.alignCenterH') },
    { mode: 'right', label: t('editor.commands.alignRight') },
    { mode: 'top', label: t('editor.commands.alignTop') },
    { mode: 'centerV', label: t('editor.commands.alignCenterV') },
    { mode: 'bottom', label: t('editor.commands.alignBottom') },
  ];
  return (
    <div className="inspector-align">
      <div className="inspector-align__row" role="group" aria-label={t('editor.inspector.align')}>
        {aligns.map((item) => (
          <button
            key={item.mode}
            type="button"
            className="ui-button ui-button--sm ui-button--secondary inspector-align__button"
            disabled={!canAlign}
            title={item.label}
            onClick={() => onAlign(item.mode)}
          >
            {item.label}
          </button>
        ))}
      </div>
      <div className="inspector-align__row" role="group" aria-label={t('editor.inspector.distribute')}>
        <button
          type="button"
          className="ui-button ui-button--sm ui-button--secondary inspector-align__button"
          disabled={!canDistribute}
          title={t('editor.commands.distributeHorizontal')}
          onClick={() => onDistribute('horizontal')}
        >
          {t('editor.commands.distributeHorizontal')}
        </button>
        <button
          type="button"
          className="ui-button ui-button--sm ui-button--secondary inspector-align__button"
          disabled={!canDistribute}
          title={t('editor.commands.distributeVertical')}
          onClick={() => onDistribute('vertical')}
        >
          {t('editor.commands.distributeVertical')}
        </button>
      </div>
    </div>
  );
}

/** Dispatch one field to its template (adding a field needs no new branch here beyond its control type). */
export function InspectorField({ field, ctx, onResult, alignment }: FieldProps & {
  alignment?: {
    onAlign: (mode: string) => void;
    canAlign: boolean;
    onDistribute: (axis: string) => void;
    canDistribute: boolean;
  };
}) {
  switch (field.control) {
    case 'number':
      return <NumberTemplate field={field} ctx={ctx} onResult={onResult} />;
    case 'color':
      return <ColorTemplate field={field} ctx={ctx} onResult={onResult} />;
    case 'segmented':
    case 'select':
    case 'toggle':
      return <SegmentedTemplate field={field} ctx={ctx} onResult={onResult} />;
    case 'alignment':
      if (!alignment) return null;
      return (
        <AlignmentTemplate
          onAlign={alignment.onAlign}
          canAlign={alignment.canAlign}
          onDistribute={alignment.onDistribute}
          canDistribute={alignment.canDistribute}
        />
      );
    case 'text':
      return <NumberTemplate field={field} ctx={ctx} onResult={onResult} />;
    case 'readonly':
    default:
      return <ReadonlyTemplate field={field} ctx={ctx} onResult={onResult} />;
  }
}

export function shortcutAriaHint(shortcut: string | undefined): string | undefined {
  return shortcut;
}

export { commandShortcutLabel, formatShortcut };
