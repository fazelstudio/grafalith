import { useRef } from 'react';

/** One dock header tab: a registry panel or a placeholder surface. */
export interface DockTab {
  id: string;
  label: string;
  /** Presentational spacer: no visible label, only the separator line. */
  bare?: boolean;
}

/** Id of the placeholder surface for the future interaction mode. */
export const INTERACTION_TAB_ID = 'interaction';

/** Keeps the active tab valid when the tab list shrinks (kind/canvas switch). */
export function resolveDockTab(tabs: readonly DockTab[], activeId: string | null): string {
  if (activeId !== null && tabs.some((tab) => tab.id === activeId)) return activeId;
  return tabs[0]?.id ?? '';
}

interface DockTabsProps {
  tabs: readonly DockTab[];
  activeId: string;
  onChange: (id: string) => void;
  ariaLabel: string;
}

/**
 * Shared dock header built on the `ui-segmented` primitive, so dock tabs
 * look exactly like the segmented controls in dialogs. One tab renders the
 * same pill selected; several render as switchable segments.
 */
export function DockTabs({ tabs, activeId, onChange, ariaLabel }: DockTabsProps) {
  const buttonsRef = useRef<(HTMLButtonElement | null)[]>([]);

  if (tabs.length === 0) return null;

  // A lone bare tab is a spacing header: it holds the header row height so
  // both docks align, with only the separator line visible underneath.
  if (tabs.length === 1 && tabs[0].bare) {
    return <div className="dock-tabs dock-tabs--bare" aria-hidden="true" />;
  }

  function focusTab(index: number): void {
    buttonsRef.current[(index + tabs.length) % tabs.length]?.focus();
  }

  function onKeyDown(event: React.KeyboardEvent, index: number): void {
    if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
      event.preventDefault();
      const next = event.key === 'ArrowRight' ? index + 1 : index - 1;
      onChange(tabs[(next + tabs.length) % tabs.length].id);
      focusTab(next);
    } else if (event.key === 'Home') {
      event.preventDefault();
      onChange(tabs[0].id);
      focusTab(0);
    } else if (event.key === 'End') {
      event.preventDefault();
      onChange(tabs[tabs.length - 1].id);
      focusTab(tabs.length - 1);
    }
  }

  return (
    <div className="ui-segmented dock-tabs" role="tablist" aria-label={ariaLabel}>
      {tabs.map((tab, index) => (
        <button
          key={tab.id}
          ref={(node) => {
            buttonsRef.current[index] = node;
          }}
          type="button"
          role="tab"
          aria-selected={tab.id === activeId}
          aria-label={tab.label}
          tabIndex={tab.id === activeId ? 0 : -1}
          className="ui-segmented__option dock-tabs__tab"
          onClick={() => onChange(tab.id)}
          onKeyDown={(event) => onKeyDown(event, index)}
        >
          <span>{tab.label}</span>
        </button>
      ))}
    </div>
  );
}
