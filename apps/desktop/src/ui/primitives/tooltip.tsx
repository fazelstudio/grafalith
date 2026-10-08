import { cloneElement, isValidElement, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import './tooltip.css';

export type TooltipPlacement = 'auto' | 'top' | 'bottom' | 'left' | 'right';

type ResolvedPlacement = Exclude<TooltipPlacement, 'auto'>;

interface TooltipProps {
  content: string;
  placement?: TooltipPlacement;
  disabled?: boolean;
  delay?: number;
  children: React.ReactNode;
}

const GAP = 8;
const VIEWPORT_MARGIN = 8;

/**
 * Theme and locale are applied before React renders (inline script in
 * index.html mirrored by applyBootPreferences). A tooltip painted while
 * either is missing would first show fallback values then swap, so treat
 * that state as not ready and show nothing instead.
 */
function isBootReady(): boolean {
  if (typeof document === 'undefined') return false;
  const theme = document.documentElement.dataset.theme;
  if (theme !== 'light' && theme !== 'dark') return false;
  return document.documentElement.lang !== '';
}

/** Measure whether a resolved side keeps the tooltip inside the viewport. */
function fitsSide(
  side: ResolvedPlacement,
  trigger: DOMRect,
  tipWidth: number,
  tipHeight: number,
  viewportWidth: number,
  viewportHeight: number,
): boolean {
  if (side === 'top') return trigger.top >= tipHeight + GAP + VIEWPORT_MARGIN;
  if (side === 'bottom') return viewportHeight - trigger.bottom >= tipHeight + GAP + VIEWPORT_MARGIN;
  if (side === 'left') return trigger.left >= tipWidth + GAP + VIEWPORT_MARGIN;
  return viewportWidth - trigger.right >= tipWidth + GAP + VIEWPORT_MARGIN;
}

/** Pick the side with viewport space: above when there is room, below near the top edge, else to the side. */
function resolvePlacement(
  preferred: TooltipPlacement,
  trigger: DOMRect,
  tipWidth: number,
  tipHeight: number,
): ResolvedPlacement {
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  if (preferred !== 'auto' && fitsSide(preferred, trigger, tipWidth, tipHeight, viewportWidth, viewportHeight)) {
    return preferred;
  }
  const order: ResolvedPlacement[] = preferred === 'auto'
    ? ['top', 'bottom', 'right', 'left']
    : [preferred, 'top', 'bottom', 'right', 'left'];
  for (const side of order) {
    if (fitsSide(side, trigger, tipWidth, tipHeight, viewportWidth, viewportHeight)) return side;
  }
  const spaceTop = trigger.top;
  const spaceBottom = viewportHeight - trigger.bottom;
  const spaceLeft = trigger.left;
  const spaceRight = viewportWidth - trigger.right;
  const bestVertical = spaceTop >= spaceBottom ? 'top' : 'bottom';
  const bestHorizontal = spaceRight >= spaceLeft ? 'right' : 'left';
  return Math.max(spaceTop, spaceBottom) >= Math.max(spaceLeft, spaceRight)
    ? bestVertical
    : bestHorizontal;
}

/** Convert a resolved side into fixed coordinates clamped to the viewport. */
function resolveCoords(
  side: ResolvedPlacement,
  trigger: DOMRect,
  tipWidth: number,
  tipHeight: number,
): { x: number; y: number } {
  let x = 0;
  let y = 0;
  if (side === 'top') {
    x = trigger.left + trigger.width / 2 - tipWidth / 2;
    y = trigger.top - tipHeight - GAP;
  } else if (side === 'bottom') {
    x = trigger.left + trigger.width / 2 - tipWidth / 2;
    y = trigger.bottom + GAP;
  } else if (side === 'left') {
    x = trigger.left - tipWidth - GAP;
    y = trigger.top + trigger.height / 2 - tipHeight / 2;
  } else {
    x = trigger.right + GAP;
    y = trigger.top + trigger.height / 2 - tipHeight / 2;
  }
  const maxX = Math.max(VIEWPORT_MARGIN, window.innerWidth - tipWidth - VIEWPORT_MARGIN);
  const maxY = Math.max(VIEWPORT_MARGIN, window.innerHeight - tipHeight - VIEWPORT_MARGIN);
  return {
    x: Math.min(Math.max(Math.round(x), VIEWPORT_MARGIN), maxX),
    y: Math.min(Math.max(Math.round(y), VIEWPORT_MARGIN), maxY),
  };
}

/**
 * Single tooltip primitive for the desktop host.
 *
 * Content is a localized string supplied by the caller through `t()`, so the
 * visible text always follows the active locale. Styling uses the themed
 * elevated surface only, so the tooltip stays dark in dark mode and light in
 * light mode without extra props. The tooltip never uses the native `title`
 * attribute, so the browser default never appears. Position resolves at show
 * time from viewport space: above when there is room, below near the top
 * edge, or to the side for collapsed rails and right-edge docks. Nothing
 * shows until boot theme and locale are applied, so no fallback-colored or
 * fallback-language frame ever paints.
 */
export function Tooltip({
  content,
  placement = 'auto',
  disabled = false,
  delay = 250,
  children,
}: TooltipProps) {
  const triggerNode = useRef<HTMLElement | null>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const showTimer = useRef<number | null>(null);
  const tooltipId = useId();
  const [visible, setVisible] = useState(false);
  const [positioned, setPositioned] = useState(false);
  const [coords, setCoords] = useState({ x: 0, y: 0 });
  const [actual, setActual] = useState<ResolvedPlacement>('top');

  function clearTimer(): void {
    if (showTimer.current !== null) {
      window.clearTimeout(showTimer.current);
      showTimer.current = null;
    }
  }

  function hide(): void {
    clearTimer();
    setVisible(false);
    setPositioned(false);
  }

  function scheduleShow(): void {
    clearTimer();
    if (disabled || content === '' || !isBootReady()) return;
    if (delay <= 0) {
      setVisible(true);
      return;
    }
    showTimer.current = window.setTimeout(() => {
      showTimer.current = null;
      setVisible(true);
    }, delay);
  }

  function setTrigger(node: HTMLElement | null): void {
    triggerNode.current = node;
  }

  useEffect(() => {
    if (disabled || content === '') hide();
  }, [disabled, content]);

  useEffect(() => clearTimer, []);

  // Measure after mount so the side decision uses the real tooltip size.
  // New text at old coordinates never paints: state updates here flush
  // before paint, and a failed measurement keeps the tooltip hidden.
  const measuredContent = useRef(content);
  useLayoutEffect(() => {
    if (!visible) return;
    if (!isBootReady()) {
      hide();
      return;
    }
    if (measuredContent.current !== content) {
      measuredContent.current = content;
      setPositioned(false);
    }
    const trigger = triggerNode.current?.getBoundingClientRect();
    const tooltip = tooltipRef.current;
    if (!trigger || !tooltip) return;
    const tipWidth = tooltip.offsetWidth;
    const tipHeight = tooltip.offsetHeight;
    if (tipWidth === 0 && tipHeight === 0) return;
    const side = resolvePlacement(placement, trigger, tipWidth, tipHeight);
    setActual(side);
    setCoords(resolveCoords(side, trigger, tipWidth, tipHeight));
    setPositioned(true);
  }, [visible, placement, content]);

  // A stale fixed tooltip is worse than none while the page moves.
  useEffect(() => {
    if (!visible) return;
    function onDismiss(event: KeyboardEvent): void {
      if (event.key === 'Escape') hide();
    }
    function onRelayout(): void {
      hide();
    }
    document.addEventListener('keydown', onDismiss, true);
    window.addEventListener('scroll', onRelayout, true);
    window.addEventListener('resize', onRelayout);
    return () => {
      document.removeEventListener('keydown', onDismiss, true);
      window.removeEventListener('scroll', onRelayout, true);
      window.removeEventListener('resize', onRelayout);
    };
  }, [visible]);

  if (disabled || content === '') return <>{children}</>;

  function attachTrigger(element: React.ReactElement): React.ReactElement {
    const original = element.props as {
      onMouseEnter?: (event: React.MouseEvent) => void;
      onMouseLeave?: (event: React.MouseEvent) => void;
      onFocus?: (event: React.FocusEvent) => void;
      onBlur?: (event: React.FocusEvent) => void;
      ref?: React.Ref<HTMLElement>;
    };
    return cloneElement(element, {
      onMouseEnter: (event: React.MouseEvent) => {
        original.onMouseEnter?.(event);
        scheduleShow();
      },
      onMouseLeave: (event: React.MouseEvent) => {
        original.onMouseLeave?.(event);
        hide();
      },
      onFocus: (event: React.FocusEvent) => {
        original.onFocus?.(event);
        scheduleShow();
      },
      onBlur: (event: React.FocusEvent) => {
        original.onBlur?.(event);
        hide();
      },
      ref: (node: HTMLElement | null) => {
        setTrigger(node);
        const ref = original.ref;
        if (typeof ref === 'function') ref(node);
        else if (ref && typeof ref === 'object' && 'current' in ref) {
          (ref as React.MutableRefObject<HTMLElement | null>).current = node;
        }
      },
    } as Partial<unknown>);
  }

  const trigger = isValidElement(children) && typeof children.type === 'string'
    ? attachTrigger(children as React.ReactElement)
    : (
      <span
        ref={setTrigger}
        className="opennary-tooltip-trigger"
        onMouseEnter={scheduleShow}
        onMouseLeave={hide}
        onFocusCapture={scheduleShow}
        onBlurCapture={hide}
      >
        {children}
      </span>
    );

  return (
    <>
      {trigger}
      {visible
        ? createPortal(
          <div
            ref={tooltipRef}
            id={tooltipId}
            role="tooltip"
            aria-hidden="true"
            data-placement={actual}
            className="opennary-tooltip"
            data-positioned={positioned ? 'true' : 'false'}
            style={{ left: coords.x, top: coords.y }}
          >
            <span className="opennary-tooltip__text">{content}</span>
          </div>,
          document.body,
        )
        : null}
    </>
  );
}
