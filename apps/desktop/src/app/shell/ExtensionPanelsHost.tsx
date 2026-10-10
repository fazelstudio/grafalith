// Shell renderer for the Extension Manager and Output panels.
//
// Mounted once in `AppShell` (next to `ExtensionDialogHost`): manager
// commands open the manager view, Output buttons switch to the output
// view with the right channel already visible, Back returns to the
// manager. One dialog at a time; closing empties the store.
import { useSyncExternalStore } from 'react';
import { useI18n } from '../i18n/resources';
import { Button } from '../../ui/primitives/controls';
import { Dialog } from '../../ui/primitives/overlays';
import { extensionPanelStore } from '../../platform/extensions/extensionPanels';
import { ExtensionManagerPanel } from '../../features/extension-manager/ExtensionManagerPanel';
import { ExtensionErrorBoundary } from '../../features/extension-manager/ExtensionErrorBoundary';
import { OutputPanel } from '../../features/output-panel/OutputPanel';

/** Manager/output dialog driven by `executeManagerCommand`. */
export function ExtensionPanelsHost(): React.JSX.Element | null {
  const view = useSyncExternalStore(
    (notify) => extensionPanelStore.subscribe(notify),
    () => extensionPanelStore.peek(),
  );
  const { t } = useI18n();

  if (!view) return null;
  const close = () => extensionPanelStore.close();

  if (view.kind === 'output') {
    return (
      <Dialog title={t('extensions.output.title')} onClose={close}>
        <ExtensionErrorBoundary surface="output panel">
          <OutputPanel />
        </ExtensionErrorBoundary>
        <div className="ui-dialog__actions">
          {view.fromManager ? (
            <Button variant="ghost" size="sm" onClick={() => extensionPanelStore.backToManager()}>
              {t('extensions.output.back')}
            </Button>
          ) : null}
          <Button variant="primary" size="sm" onClick={close}>
            {t('common.actions.close')}
          </Button>
        </div>
      </Dialog>
    );
  }

  return (
    <Dialog title={t('extensions.manager.title')} onClose={close}>
      <ExtensionManagerPanel key={view.filter} initialFilter={view.filter} />
      <div className="ui-dialog__actions">
        <Button variant="primary" size="sm" onClick={close}>
          {t('common.actions.close')}
        </Button>
      </div>
    </Dialog>
  );
}
