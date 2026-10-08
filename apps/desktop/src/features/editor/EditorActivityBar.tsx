import type { ReactNode } from 'react';
import { useI18n } from '../../app/i18n/resources';
import { activities } from '../../registries';
import { extensionViewsFor } from '../../platform/extensions/extensionContributions';
import { resolveIcon } from '../../ui/iconRegistry';
import { StarIcon } from '../../ui/icons';
import { Tooltip } from '../../ui/primitives/tooltip';

interface EditorActivityBarProps {
  openPanels: readonly string[];
  onTogglePanel: (id: string) => void;
  /** Pinned bottom slot (e.g. settings); the shell owner supplies content. */
  footer?: ReactNode;
  /** Extension rail action (command click or view activation). */
  onExtensionAction?: (viewId: string, command: string | undefined) => void;
}

/** Compact activity rail for switching editor side-panel surfaces. */
export function EditorActivityBar({ openPanels, onTogglePanel, footer, onExtensionAction }: EditorActivityBarProps) {
  const { t } = useI18n();
  const extensionItems = extensionViewsFor('activity');

  function icon(id: string) {
    const Icon = resolveIcon(id);
    return Icon ? <Icon size={20} /> : null;
  }

  return (
    <nav className="editor-activitybar" aria-label={t('editor.activity.title')}>
      <div className="editor-activitybar__top">
        {activities().map((activity) => {
          const active = openPanels.includes(activity.panelId);
          const label = t(activity.labelKey);
          return (
            <Tooltip key={activity.id} content={label} placement="right">
              <button
                type="button"
                className="editor-activitybar__item"
                aria-label={label}
                aria-pressed={active}
                onClick={() => onTogglePanel(activity.panelId)}
              >
                {icon(activity.icon)}
              </button>
            </Tooltip>
          );
        })}
        {extensionItems.map((view) => {
          const Icon = resolveIcon(view.icon) ?? StarIcon;
          return (
            <Tooltip key={`extension:${view.id}`} content={view.title} placement="right">
              <button
                type="button"
                className="editor-activitybar__item"
                aria-label={view.title}
                onClick={() => onExtensionAction?.(view.id, view.command)}
              >
                <Icon size={20} />
              </button>
            </Tooltip>
          );
        })}
      </div>
      {footer ? <div className="editor-activitybar__bottom">{footer}</div> : null}
    </nav>
  );
}
