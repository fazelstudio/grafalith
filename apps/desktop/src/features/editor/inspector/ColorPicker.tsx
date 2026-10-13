import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { HexColorInput, HexColorPicker } from 'react-colorful';
import { useI18n } from '../../../app/i18n/resources';
import {
  emptyFillModeMemory,
  fillEquals,
  fillToCss,
  fillToPaint,
  isGradientFill,
  normalizeHexColor,
  recordColorRecent,
  solidOfFill,
  stopOffsetAt,
  switchFillMode,
  visibleSwatches,
  type FillModeMemory,
  type FillValue,
} from './colorSwatches';
import type { FillPreview } from '../../../render/drawModel';

const POPOVER_WIDTH = 224;
const MAX_STOPS = 5;

interface ColorPickerProps {
  label: string;
  value: FillValue;
  mixed: boolean;
  allowGradient: boolean;
  projectId: string;
  disabled?: boolean;
  /** Selected ids repainted by the live fill preview during stop drags. */
  selectionIds: readonly string[];
  /** Uncommitted fill preview shared with the canvas loop (writer-owned). */
  fillPreviewRef: { current: FillPreview | null };
  onCommit: (value: FillValue) => void;
}

/** Popover color editor: modern picker, gradient tools for fills, template/recent swatches. */
export function ColorPicker({ label, value, mixed, allowGradient, projectId, disabled, selectionIds, fillPreviewRef, onCommit }: ColorPickerProps) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<FillValue>(value);
  const [activeStop, setActiveStop] = useState(0);
  const [swatches, setSwatches] = useState<readonly FillValue[]>([]);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const buttonRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const pickerWrapRef = useRef<HTMLSpanElement>(null);
  const recordedRef = useRef<FillValue>(value);
  const dotDragRef = useRef<{
    index: number;
    stop: { offset: number; color: string };
    start: FillValue;
    final: FillValue;
  } | null>(null);
  const onCommitRef = useRef(onCommit);
  const modeMemoryRef = useRef<FillModeMemory>(emptyFillModeMemory());
  // Hue-bar box measured at runtime so stop dots overlay the strip exactly
  // without depending on the picker package's internal metrics.
  const [hueBox, setHueBox] = useState<{ top: number; height: number } | null>(null);

  // Closed popover always reflects the selection; edits stay local while open.
  useEffect(() => {
    if (!open) {
      setDraft(value);
      recordedRef.current = value;
    }
  }, [value, open]);

  function placePopover(): void {
    const rect = buttonRef.current?.getBoundingClientRect();
    if (!rect) return;
    const x = Math.max(8, Math.min(rect.left, window.innerWidth - POPOVER_WIDTH - 8));
    setPosition({ x, y: Math.min(rect.bottom + 6, window.innerHeight - 8) });
  }

  // Keep the whole popover inside the viewport after layout settles, and
  // measure the hue strip so gradient stop dots overlay it exactly.
  useLayoutEffect(() => {
    if (!open) return;
    const popover = popoverRef.current;
    if (!popover) return;
    const rect = popover.getBoundingClientRect();
    setPosition((previous) => ({
      x: Math.max(8, Math.min(previous.x, window.innerWidth - rect.width - 8)),
      y: rect.bottom > window.innerHeight - 8 ? Math.max(8, window.innerHeight - rect.height - 8) : previous.y,
    }));
    const wrap = pickerWrapRef.current?.getBoundingClientRect();
    const hue = pickerWrapRef.current?.querySelector('.react-colorful__hue')?.getBoundingClientRect();
    setHueBox(wrap && hue ? { top: hue.top - wrap.top, height: hue.height } : null);
  }, [open, draft]);

  // Outside interaction closes and records; keys never leak to editor shortcuts.
  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent): void {
      if (!popoverRef.current?.contains(event.target as Node) && !buttonRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    function onScroll(): void {
      setOpen(false);
    }
    document.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onScroll);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onScroll);
    };
  }, [open ]);

  // Closing settles the recent row once instead of per drag tick.
  useEffect(() => {
    if (!open && !fillEquals(draft, recordedRef.current)) {
      recordColorRecent(projectId, draft);
      recordedRef.current = draft;
      setSwatches(visibleSwatches(projectId));
    }
  }, [open, draft, projectId]);

  // Latest commit for the unmount guard below (the prop closure may be stale).
  useEffect(() => {
    onCommitRef.current = onCommit;
  });

  // A drag orphaned by unmount (popover closed mid-drag) still commits once
  // instead of silently dropping the previewed fill.
  useEffect(() => () => {
    const drag = dotDragRef.current;
    dotDragRef.current = null;
    fillPreviewRef.current = null;
    if (drag && !fillEquals(drag.final, drag.start)) void onCommitRef.current(drag.final);
  }, [fillPreviewRef]);

  function openPopover(): void {
    if (disabled) return;
    setDraft(value);
    recordedRef.current = value;
    modeMemoryRef.current =
      typeof value === 'string'
        ? { ...emptyFillModeMemory(), solid: value }
        : isGradientFill(value)
          ? { ...emptyFillModeMemory(), gradient: value }
          : emptyFillModeMemory();
    setActiveStop(0);
    setSwatches(visibleSwatches(projectId));
    placePopover();
    setOpen(true);
  }

  function switchMode(to: 'solid' | 'gradient'): void {
    const alreadyThere = (to === 'solid') === !isGradientFill(draft);
    if (alreadyThere) return;
    const switched = switchFillMode(modeMemoryRef.current, draft, to);
    modeMemoryRef.current = switched.memory;
    update(switched.next);
  }

  function update(next: FillValue): void {
    setDraft(next);
    onCommit(next);
  }

  function pickSwatch(swatch: FillValue): void {
    update(swatch);
    recordColorRecent(projectId, swatch);
    recordedRef.current = swatch;
    setSwatches(visibleSwatches(projectId));
  }

  function onSolidChange(color: string): void {
    update(color);
  }

  function onStopChange(color: string): void {
    if (!isGradientFill(draft)) return;
    const stops = draft.stops.map((stop, index) => (index === activeStop ? { ...stop, color } : stop));
    update({ ...draft, stops });
  }

  function addStop(): void {
    if (!isGradientFill(draft) || draft.stops.length >= MAX_STOPS) return;
    const base = draft.stops[Math.min(activeStop, draft.stops.length - 1)];
    const offset = Math.round(Math.min(1, Math.max(0, base.offset + (base.offset >= 1 ? -0.1 : 0.1))) * 100) / 100;
    addStopAt(offset);
  }

  function addStopAt(offset: number): void {
    if (!isGradientFill(draft) || draft.stops.length >= MAX_STOPS) return;
    const base = draft.stops[Math.min(activeStop, draft.stops.length - 1)];
    const created = { offset, color: base.color };
    const stops = [...draft.stops, created].sort((a, b) => a.offset - b.offset);
    setActiveStop(stops.indexOf(created));
    update({ ...draft, stops });
  }

  function onHueDoubleClick(event: React.MouseEvent): void {
    if ((event.target as HTMLElement).closest('.color-stop--on-hue')) return;
    const hue = pickerWrapRef.current?.querySelector('.react-colorful__hue');
    if (!hue) return;
    const rect = hue.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) return;
    addStopAt(stopOffsetAt(event.clientX, rect.left, rect.width));
  }

  function hueBarRect(): DOMRect | null {
    const hue = pickerWrapRef.current?.querySelector('.react-colorful__hue');
    if (!hue) return null;
    const rect = hue.getBoundingClientRect();
    return Number.isFinite(rect.width) && rect.width > 0 ? rect : null;
  }

  function onDotPointerDown(event: React.PointerEvent, index: number): void {
    setActiveStop(index);
    if (!isGradientFill(draft)) return;
    const stop = draft.stops[index];
    if (!stop) return;
    dotDragRef.current = { index, stop, start: draft, final: draft };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function onDotPointerMove(event: React.PointerEvent): void {
    const drag = dotDragRef.current;
    if (!drag || !isGradientFill(draft)) return;
    const rect = hueBarRect();
    if (!rect) return;
    const offset = stopOffsetAt(event.clientX, rect.left, rect.width);
    const currentIndex = draft.stops.indexOf(drag.stop);
    if (currentIndex < 0) return;
    const current = draft.stops[currentIndex];
    if (!current || current.offset === offset) return;
    const moved = { ...current, offset };
    const stops = [...draft.stops.slice(0, currentIndex), moved, ...draft.stops.slice(currentIndex + 1)].sort(
      (a, b) => a.offset - b.offset,
    );
    const next = { ...draft, stops };
    drag.final = next;
    drag.stop = moved;
    drag.index = stops.indexOf(moved);
    setActiveStop(stops.indexOf(moved));
    setDraft(next);
    fillPreviewRef.current = { ids: [...selectionIds], paint: fillToPaint(next) };
  }

  function endDotDrag(): void {
    const drag = dotDragRef.current;
    if (!drag) return;
    
    // Clear drag state immediately
    dotDragRef.current = null;
    fillPreviewRef.current = null;
    
    // Commit only if there are actual changes (not a pure click)
    if (drag.final && !fillEquals(drag.final, drag.start)) {
      // The draft state has been updated during drag, so we can commit it
      onCommit(drag.final);
    } else {
      // Pure click - no commit needed
      setDraft(drag.start);
    }
  }

  function removeStop(): void {
    if (!isGradientFill(draft) || draft.stops.length <= 2) return;
    const stops = draft.stops.filter((_, index) => index !== activeStop);
    setActiveStop(Math.min(activeStop, stops.length - 1));
    update({ ...draft, stops });
  }

  const showingGradient = allowGradient && isGradientFill(draft);
  const activeColor = showingGradient
    ? (normalizeHexColor(draft.stops[Math.min(activeStop, draft.stops.length - 1)]?.color) ?? '#000000')
    : solidOfFill(draft);
  const buttonClass = `color-swatch-button${typeof value === 'string' && value.toLowerCase() === 'transparent' && !mixed ? ' color-swatch-button--transparent' : ''}${mixed ? ' color-swatch-button--mixed' : ''}`;

  return (
    <span className="color-picker">
      <button
        ref={buttonRef}
        type="button"
        className={buttonClass}
        style={mixed ? undefined : { background: fillToCss(value) }}
        disabled={disabled}
        aria-label={label}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => (open ? setOpen(false) : openPopover())}
        onKeyDown={(event) => event.stopPropagation()}
      />
      {open ? (
        <div
          ref={popoverRef}
          className="color-popover"
          role="dialog"
          aria-label={label}
          style={{ left: position.x, top: position.y, width: POPOVER_WIDTH }}
          onKeyDown={(event) => {
            event.stopPropagation();
            if (event.key === 'Escape') {
              event.preventDefault();
              setOpen(false);
              buttonRef.current?.focus();
            }
          }}
        >
          {allowGradient ? (
            <span className="ui-segmented" role="radiogroup" aria-label={label}>
              <button
                type="button"
                role="radio"
                aria-checked={!showingGradient}
                className="ui-segmented__option"
                onClick={() => switchMode('solid')}
              >
                {t('editor.inspector.colorSolid')}
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={showingGradient}
                className="ui-segmented__option"
                onClick={() => switchMode('gradient')}
              >
                {t('editor.inspector.colorGradient')}
              </button>
            </span>
          ) : null}
          <span className={`color-picker-hue${showingGradient ? ' color-picker-hue--gradient' : ''}`} ref={pickerWrapRef} onDoubleClick={onHueDoubleClick}>
            <HexColorPicker
              className="color-popover__picker"
              color={activeColor}
              onChange={showingGradient ? onStopChange : onSolidChange}
            />
            {showingGradient && hueBox ? (
              <span
                className="color-stop-hue-overlay"
                style={{ top: hueBox.top, height: hueBox.height }}
              >
                {draft.stops.map((stop, index) => (
                  <button
                    key={`${stop.offset}-${index}`}
                    type="button"
                    className={`color-stop color-stop--on-hue${index === activeStop ? ' color-stop--active' : ''}`}
                    style={{ background: stop.color, left: `${stop.offset * 100}%` }}
                    aria-pressed={index === activeStop}
                    aria-label={`${stop.color} ${Math.round(stop.offset * 100)}%`}
                    onClick={() => setActiveStop(index)}
                    onPointerDown={(event) => onDotPointerDown(event, index)}
                    onPointerMove={onDotPointerMove}
                    onPointerUp={endDotDrag}
                    onPointerCancel={endDotDrag}
                  />
                ))}
              </span>
            ) : null}
          </span>
          <HexColorInput
            className="ui-input inspector-field__input"
            prefixed
            color={activeColor}
            onChange={showingGradient ? onStopChange : onSolidChange}
            aria-label={label}
          />
          {showingGradient ? (
            <>
              <div className="color-stops" role="group" aria-label={t('editor.inspector.colorGradient')}>
                <button
                  type="button"
                  className="color-stop color-stop--add"
                  disabled={draft.stops.length >= MAX_STOPS}
                  aria-label={t('editor.inspector.gradientAddStop')}
                  onClick={addStop}
                >
                  +
                </button>
                <button
                  type="button"
                  className="color-stop color-stop--add"
                  disabled={draft.stops.length <= 2}
                  aria-label={t('editor.inspector.gradientRemoveStop')}
                  onClick={removeStop}
                >
                  −
                </button>
              </div>
              <span className="ui-segmented" role="radiogroup" aria-label={t('editor.inspector.colorGradient')}>
                <button
                  type="button"
                  role="radio"
                  aria-checked={draft.gradientType === 'linear'}
                  className="ui-segmented__option"
                  onClick={() => update({ ...draft, gradientType: 'linear' })}
                >
                  Linear
                </button>
                <button
                  type="button"
                  role="radio"
                  aria-checked={draft.gradientType === 'radial'}
                  className="ui-segmented__option"
                  onClick={() => update({ ...draft, gradientType: 'radial' })}
                >
                  Radial
                </button>
              </span>
              {draft.gradientType === 'linear' ? (
                <label className="color-angle">
                  <span className="color-angle__label">{t('editor.inspector.gradientAngle')}</span>
                  <input
                    type="range"
                    min={0}
                    max={360}
                    step={1}
                    value={Math.round(draft.angle)}
                    aria-label={t('editor.inspector.gradientAngle')}
                    onChange={(event) => update({ ...draft, angle: Number(event.target.value) })}
                  />
                  <span className="color-angle__value">{Math.round(draft.angle)}°</span>
                </label>
              ) : null}
            </>
          ) : null}
          <div className="color-swatches" role="group" aria-label={t('editor.inspector.colorSwatches')}>
            <button
              type="button"
              className="color-swatch color-swatch--transparent"
              aria-label={t('editor.inspector.colorTransparent')}
              aria-pressed={typeof draft === 'string' && draft.toLowerCase() === 'transparent'}
              onClick={() => pickSwatch('transparent')}
            />
            {swatches.map((swatch, index) => {
              const key = typeof swatch === 'string' ? swatch : `gradient-${index}`;
              const swatchLabel =
                typeof swatch === 'string' ? swatch : `${t('editor.inspector.colorGradient')} ${index + 1}`;
              return (
                <button
                  key={`${key}-${index}`}
                  type="button"
                  className="color-swatch"
                  style={{ background: fillToCss(swatch) }}
                  aria-label={swatchLabel}
                  aria-pressed={fillEquals(draft, swatch)}
                  onClick={() => pickSwatch(swatch)}
                />
              );
            })}
          </div>
        </div>
      ) : null}
    </span>
  );
}
