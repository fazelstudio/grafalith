// Extension Manager panel: installed extensions with live status.
//
// Rendered behind `grafalith.extensions.manager.open` (the shell mounts it
// in a dialog through `ExtensionPanelsHost`). Every row shows name,
// status, failure reason, and Enable / Disable / Reload / Uninstall /
// Output actions. Rows subscribe to status changes so enable/disable
// updates reactively without restarting the app.
import { useEffect, useMemo, useState } from 'react';
import { useI18n } from '../../app/i18n/resources';
import {
  disableExtension,
  enableExtension,
  filterExtensions,
  listExtensions,
  reloadExtension,
  showExtensionOutput,
  uninstallExtension,
  type ExtensionManagerRow,
} from '../../platform/extensions/extensionManager';
import { extensionPanelStore } from '../../platform/extensions/extensionPanels';
import { getExtensionStatuses } from '../../platform/extensions/extensionStatus';
import { ExtensionErrorBoundary } from './ExtensionErrorBoundary';

type ManagerFilter = 'all' | 'active' | 'failed';

const FILTERS: readonly ManagerFilter[] = ['all', 'active', 'failed'];

/** Installed-extension list with enable/disable/reload/uninstall/output. */
export function ExtensionManagerPanel({
  initialFilter = 'all',
}: {
  initialFilter?: ManagerFilter;
} = {}): React.JSX.Element {
  const { t } = useI18n();
  const [filter, setFilter] = useState<ManagerFilter>(initialFilter);
  const [rows, setRows] = useState<readonly ExtensionManagerRow[]>(() => listExtensions());

  useEffect(() => {
    const refresh = (): void => setRows(listExtensions());
    refresh();
    const subscription = getExtensionStatuses().onDidChange(() => refresh());
    return () => subscription.dispose();
  }, []);

  const visible = useMemo(() => filterExtensions(rows, filter), [rows, filter]);
  const filterLabel = (entry: ManagerFilter): string =>
    entry === 'all'
      ? t('extensions.manager.filterAll')
      : entry === 'active'
        ? t('extensions.manager.filterActive')
        : t('extensions.manager.filterFailed');

  return (
    <ExtensionErrorBoundary surface="extension manager">
      <section aria-label={t('extensions.manager.title')}>
        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          {FILTERS.map((entry) => (
            <button
              key={entry}
              type="button"
              aria-pressed={filter === entry}
              onClick={() => setFilter(entry)}
            >
              {filterLabel(entry)}
            </button>
          ))}
        </div>
        {visible.length === 0 ? (
          <p>{t('extensions.manager.empty')}</p>
        ) : (
          <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 8 }}>
            {visible.map((row) => (
              <ExtensionRow
                key={row.packageId}
                row={row}
                onRefresh={() => setRows(listExtensions())}
              />
            ))}
          </ul>
        )}
      </section>
    </ExtensionErrorBoundary>
  );
}

function ExtensionRow({
  row,
  onRefresh,
}: {
  row: ExtensionManagerRow;
  onRefresh: () => void;
}): React.JSX.Element {
  const { t } = useI18n();
  const run = (work: Promise<unknown>): void => {
    void work.then(() => onRefresh());
  };
  const openOutput = (): void => {
    showExtensionOutput(row.packageId);
    extensionPanelStore.openOutput(true);
  };
  return (
    <li
      style={{ border: '1px solid var(--border, #e2e2e2)', borderRadius: 8, padding: 12 }}
      data-extension-id={row.packageId}
      data-extension-status={row.status}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
        <strong>{row.packageId}</strong>
        <span aria-label={`status ${row.status}`}>{row.status}</span>
      </div>
      {row.reason ? <div style={{ opacity: 0.75, marginTop: 4 }}>{row.reason}</div> : null}
      <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
        {row.active ? (
          <button type="button" onClick={() => run(disableExtension(row.packageId))}>
            {t('extensions.manager.disable')}
          </button>
        ) : (
          <button type="button" onClick={() => run(enableExtension(row.packageId))}>
            {t('extensions.manager.enable')}
          </button>
        )}
        <button type="button" onClick={() => run(reloadExtension(row.packageId))}>
          {t('extensions.manager.reload')}
        </button>
        <button type="button" onClick={() => run(uninstallExtension(row.packageId))}>
          {t('extensions.manager.uninstall')}
        </button>
        <button type="button" onClick={openOutput}>
          {t('extensions.manager.output')}
        </button>
      </div>
    </li>
  );
}
