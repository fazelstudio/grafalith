import { useEffect, useRef } from 'react';
import { Button } from './controls';

interface DialogProps {
  title: string;
  description?: string;
  onClose: () => void;
  children?: React.ReactNode;
  actions?: React.ReactNode;
}

/** Modal dialog with focus containment and Escape dismissal. */
export function Dialog({ title, description, onClose, children, actions }: DialogProps) {
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
      <div ref={dialogRef} className="ui-dialog" role="dialog" aria-modal="true" aria-label={title}>
        <div className="ui-dialog__title">{title}</div>
        {description ? <div className="ui-dialog__description">{description}</div> : null}
        {children}
        <div className="ui-dialog__actions">{actions ?? <Button onClick={onClose}>OK</Button>}</div>
      </div>
    </div>
  );
}

interface TooltipProps {
  label: string;
  children: React.ReactNode;
}

/** Visual hint wrapper; the child keeps its own accessible name. */
export function Tooltip({ label, children }: TooltipProps) {
  return (
    <span className="ui-tooltip-wrap">
      {children}
      <span className="ui-tooltip" role="presentation">
        {label}
      </span>
    </span>
  );
}
