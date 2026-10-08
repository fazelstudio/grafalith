import { useEffect, useRef } from 'react';

interface DialogProps {
  title: string;
  description?: string;
  onClose: () => void;
  children?: React.ReactNode;
  /** Caller-provided buttons; omitted when the dialog needs none (no fallback label). */
  actions?: React.ReactNode;
  /** Extra dialog sizing (e.g. `ui-dialog--wide`); styling stays in CSS. */
  className?: string;
  /** Right-aligned header slot (e.g. search + close); the title block stays left. */
  headerExtra?: React.ReactNode;
}

/** Modal dialog with focus containment and Escape dismissal. */
export function Dialog({ title, description, onClose, children, actions, className, headerExtra }: DialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const previousFocus = useRef<Element | null>(null);

  useEffect(() => {
    previousFocus.current = document.activeElement;
    dialogRef.current?.querySelector<HTMLElement>('button, [href], input, select, textarea, [tabindex]')?.focus();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      }
      if (event.key === 'Tab' && dialogRef.current) {
        const focusable = Array.from(
          dialogRef.current.querySelectorAll<HTMLElement>(
            'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
          ),
        ).filter((node) => !node.hasAttribute('disabled'));
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    }

    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      if (previousFocus.current instanceof HTMLElement) previousFocus.current.focus();
    };
  }, [onClose]);

  return (
    <div className="ui-dialog-overlay" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <div ref={dialogRef} className={`ui-dialog${className ? ` ${className}` : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="ui-dialog__header">
          <div className="ui-dialog__heading">
            <div className="ui-dialog__title">{title}</div>
            {description ? <div className="ui-dialog__description">{description}</div> : null}
          </div>
          {headerExtra ? <div className="ui-dialog__header-extra">{headerExtra}</div> : null}
        </div>
        {children}
        {actions ? <div className="ui-dialog__actions">{actions}</div> : null}
      </div>
    </div>
  );
}

export { Tooltip } from './tooltip';
export type { TooltipPlacement } from './tooltip';
