import type { ButtonHTMLAttributes, ReactNode } from 'react';

/** Visual role of an action row shared by menus, context menus, and selects. */
export type ActionRowTone = 'default' | 'danger';

interface ActionRowProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: ReactNode;
  shortcut?: ReactNode;
  icon?: ReactNode;
  tone?: ActionRowTone;
  selected?: boolean;
}

/**
 * Single template for every pickable row. Menubar items, canvas context
 * rows, select-menu options, and palette rows share this shape so a new
 * surface never invents its own button markup.
 */
export function ActionRow({
  label,
  shortcut,
  icon,
  tone = 'default',
  selected = false,
  className,
  ...props
}: ActionRowProps) {
  const toneClass = tone === 'danger' ? ' ui-action-row--danger' : '';
  const selectedClass = selected ? ' ui-action-row--selected' : '';
  return (
    <button
      type="button"
      role={props.role ?? 'menuitem'}
      {...props}
      className={`ui-action-row${toneClass}${selectedClass}${className ? ` ${className}` : ''}`}
      aria-selected={selected || undefined}
    >
      {icon ? <span className="ui-action-row__icon" aria-hidden="true">{icon}</span> : null}
      <span className="ui-action-row__label">{label}</span>
      {shortcut ? <span className="ui-action-row__shortcut">{shortcut}</span> : null}
    </button>
  );
}
