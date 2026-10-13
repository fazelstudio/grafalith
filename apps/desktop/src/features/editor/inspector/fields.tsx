import { useEffect, useRef, useState } from 'react';
import { MIXED, type InspectorFieldDefinition, type InspectorFieldContext } from './descriptors';
import { useI18n } from '../../../app/i18n/resources';
import { Tooltip } from '../../../ui/primitives/tooltip';
import { CheckIcon, ChevronDownIcon, ResetIcon } from '../../../ui/icons';
import { commandShortcutLabel, formatShortcut } from '../../../registries';
import { ColorPicker } from './ColorPicker';
import type { FillValue } from './colorSwatches';

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
    onResult(field.id, result.status === 'ok', result.status === 'ok' ? null : t('editor.errors.commandFailed', { message: t(field.labelKey) }));
  }

  async function reset() {
    if (disabled || field.resetValue === undefined || value === MIXED) return;
    setDraft(String(field.resetValue));
    const result = await field.write(field.resetValue, ctx);
    onResult(field.id, result.status === 'ok', result.status === 'ok' ? null : t('editor.errors.commandFailed', { message: t(field.labelKey) }));
  }

  const resetLabel = field.resetValue === undefined
    ? undefined
    : t('editor.inspector.resetField', { field: t(field.labelKey) });

  return (
    <label className={`inspector-field${field.stacked === true ? ' inspector-field--stacked' : ''}${field.halfWidth === true ? ' inspector-field--half' : ''}`}>
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
        {resetLabel !== undefined ? (
          <Tooltip content={resetLabel}>
            <button
              type="button"
              className="inspector-field__reset"
              aria-label={resetLabel}
              disabled={disabled || value === MIXED}
              onClick={() => void reset()}
              onKeyDown={(event) => event.stopPropagation()}
            >
              <ResetIcon size={14} />
            </button>
          </Tooltip>
        ) : field.reserveResetSpace === true ? (
          <span className="inspector-field__reset inspector-field__reset--spacer" aria-hidden="true" />
        ) : null}
      </span>
    </label>
  );
}

/**
 * Opacity as one button: single click opens the preset menu (home Create
 * menu pattern), double-click swaps the label for an inline editor where
 * Enter, Esc, and blur all commit. No unit label.
 */
export function OpacityTemplate({ field, ctx, onResult }: FieldProps) {
  const { t } = useI18n();
  const value = field.read(ctx);
  const disabled = field.disabled?.(ctx) ?? false;
  const presets = field.presets ?? [];
  const [menuOpen, setMenuOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useDraft(value);
  const rootRef = useRef<HTMLSpanElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const editingRef = useRef(false);

  // Outside interaction closes the menu, matching the home create menu.
  useEffect(() => {
    if (!menuOpen) return;
    function onPointerDown(event: PointerEvent): void {
      if (!rootRef.current?.contains(event.target as Node)) setMenuOpen(false);
    }
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [menuOpen]);

  async function writeAndReport(numeric: number): Promise<void> {
    const result = await field.write(numeric, ctx);
    onResult(field.id, result.status === 'ok', result.status === 'ok' ? null : t('editor.errors.commandFailed', { message: t(field.labelKey) }));
  }

  async function choosePreset(preset: number): Promise<void> {
    if (disabled) return;
    setMenuOpen(false);
    setDraft(String(preset));
    await writeAndReport(preset);
    setTimeout(() => buttonRef.current?.focus(), 0);
  }

  function beginEdit(): void {
    if (disabled) return;
    setMenuOpen(false);
    editingRef.current = true;
    setDraft(value === MIXED ? '' : String(value));
    setEditing(true);
    setTimeout(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    }, 0);
  }

  async function commitEdit(raw: string): Promise<void> {
    if (!editingRef.current) return;
    editingRef.current = false;
    setEditing(false);
    const numeric = Number(raw);
    if (raw.trim() === '' || !Number.isFinite(numeric)) {
      onResult(field.id, false, t('editor.errors.invalidNumber'));
      return;
    }
    await writeAndReport(numeric);
  }

  function onMenuItemKeyDown(event: React.KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      setMenuOpen(false);
      setTimeout(() => buttonRef.current?.focus(), 0);
      return;
    }
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp' && event.key !== 'Home' && event.key !== 'End') return;
    event.preventDefault();
    const items = Array.from(rootRef.current?.querySelectorAll<HTMLElement>('[role="menuitemradio"]') ?? []);
    const index = items.indexOf(event.currentTarget as HTMLElement);
    if (event.key === 'Home') {
      items[0]?.focus();
      return;
    }
    if (event.key === 'End') {
      items[items.length - 1]?.focus();
      return;
    }
    const delta = event.key === 'ArrowDown' ? 1 : -1;
    items[(index + delta + items.length) % items.length]?.focus();
  }

  const text = value === MIXED ? mixedPlaceholder(t) : String(value);

  return (
    <label className="inspector-field">
      <span className="inspector-field__label">{t(field.labelKey)}</span>
      <span className="inspector-field__control">
        <span className="inspector-field__opacity" ref={rootRef}>
          {editing ? (
            <input
              ref={inputRef}
              type="number"
              className="ui-input inspector-field__input"
              value={draft}
              placeholder={value === MIXED ? mixedPlaceholder(t) : undefined}
              disabled={disabled}
              min={field.min}
              max={field.max}
              step={field.step ?? 1}
              aria-label={t(field.labelKey)}
              onChange={(event) => setDraft(event.target.value)}
              onBlur={(event) => void commitEdit(event.target.value)}
              onKeyDown={(event) => {
                // Esc commits this draft instead of cancelling it.
                if (event.key === 'Enter' || event.key === 'Escape') {
                  event.preventDefault();
                  void commitEdit((event.target as HTMLInputElement).value).then(() => buttonRef.current?.focus());
                }
                event.stopPropagation();
              }}
            />
          ) : (
            <Tooltip content={t(field.labelKey)}>
              <button
                ref={buttonRef}
                type="button"
                className={menuOpen ? 'inspector-field__opacity-button inspector-field__opacity-button--open' : 'inspector-field__opacity-button'}
                aria-haspopup="menu"
                aria-expanded={menuOpen}
                aria-controls="inspector-opacity-menu"
                disabled={disabled}
                onClick={() => setMenuOpen((open) => !open)}
                onDoubleClick={beginEdit}
                onKeyDown={(event) => event.stopPropagation()}
              >
                <span className="inspector-field__opacity-value">{text}</span>
                <ChevronDownIcon size={14} />
              </button>
            </Tooltip>
          )}
          {menuOpen && !editing ? (
            <div id="inspector-opacity-menu" className="inspector-field__opacity-menu" role="menu" aria-label={t('editor.inspector.preset')}>
              {presets.map((preset) => (
                <button
                  key={preset}
                  type="button"
                  className="inspector-field__opacity-item"
                  role="menuitemradio"
                  aria-checked={preset === value}
                  onClick={() => void choosePreset(preset)}
                  onKeyDown={onMenuItemKeyDown}
                >
                  <span>{preset}</span>
                  <span className="inspector-field__opacity-check" aria-hidden="true">
                    {preset === value ? <CheckIcon size={14} /> : null}
                  </span>
                </button>
              ))}
            </div>
          ) : null}
        </span>
      </span>
    </label>
  );
}

/** Modern color input: popover picker with gradients for fills, solid only for strokes. */
export function ColorTemplate({ field, ctx, onResult }: FieldProps) {
  const { t } = useI18n();
  const raw = field.read(ctx);
  const disabled = field.disabled?.(ctx) ?? false;
  const mixed = raw === MIXED;
  const current: FillValue = mixed
    ? '#000000'
    : field.allowGradient === true
      ? (raw as FillValue)
      : String(raw);
  const text = mixed
    ? mixedPlaceholder(t)
    : typeof current === 'string'
      ? current
      : t('editor.inspector.colorGradient');

  async function commit(next: FillValue) {
    const result = await field.write(next as unknown as Exclude<typeof raw, typeof MIXED>, ctx);
    onResult(field.id, result.status === 'ok', result.status === 'ok' ? null : t('editor.errors.commandFailed', { message: text }));
  }

  return (
    <span className="inspector-field">
      <span className="inspector-field__label">{t(field.labelKey)}</span>
      <span className="inspector-field__control">
        <ColorPicker
          label={t(field.labelKey)}
          value={current}
          mixed={mixed}
          allowGradient={field.allowGradient === true}
          projectId={ctx.projectId}
          disabled={disabled}
          selectionIds={ctx.selection}
          fillPreviewRef={ctx.fillPreviewRef}
          onCommit={(next) => void commit(next)}
        />
        <Tooltip content={text}>
          <span className="inspector-field__value">{text}</span>
        </Tooltip>
      </span>
    </span>
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
      <Tooltip content={text}>
        <dd className="inspector-field__value">
          {text}
        </dd>
      </Tooltip>
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
          onClick={() => onDistribute('horizontal')}
        >
          {t('editor.commands.distributeHorizontal')}
        </button>
        <button
          type="button"
          className="ui-button ui-button--sm ui-button--secondary inspector-align__button"
          disabled={!canDistribute}
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
    case 'opacity':
      return <OpacityTemplate field={field} ctx={ctx} onResult={onResult} />;
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
