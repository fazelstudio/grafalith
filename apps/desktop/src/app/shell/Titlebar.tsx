import { useEffect, useState } from 'react';
import { useI18n } from '../i18n/resources';
import { isTauriRuntime } from '../../platform/projects/tauriAdapter';
import { executeAppCommand, type AppCommandContext } from '../../registries/appCommands';
import { CloseIcon, MaximizeIcon, MinusIcon, RestoreIcon } from '../../ui/icons';
import { Tooltip } from '../../ui/primitives/tooltip';
import './titlebar.css';

/** Custom window controls for the undecorated main window. Hidden outside Tauri. */
export function Titlebar() {
  const { t } = useI18n();
  const [maximized, setMaximized] = useState(false);
  const [enabled] = useState(() => isTauriRuntime());

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    let unlistenResize: (() => void) | undefined;
    let unlistenFocus: (() => void) | undefined;
    const refresh = async () => {
      try {
        const { getCurrentWindow } = await import('@tauri-apps/api/window');
        if (!cancelled) setMaximized(await getCurrentWindow().isMaximized());
      } catch {
        // Missing permission: keep the last known icon.
      }
    };
    (async () => {
      try {
        const { getCurrentWindow } = await import('@tauri-apps/api/window');
        const { ensureMinWindowSize } = await import('../../platform/window/windowGeometry');
        const win = getCurrentWindow();
        await ensureMinWindowSize(win);
        await refresh();
        unlistenResize = await win.onResized(() => {
          void refresh();
        });
        // Boot maximizes while hidden and shows later; focus follows the
        // show, so re-reading here corrects the icon after reveal.
        unlistenFocus = await win.onFocusChanged(() => {
          void refresh();
        });
      } catch {
        // Missing permission or browser preview: keep the default restore icon.
      }
    })();
    return () => {
      cancelled = true;
      unlistenResize?.();
      unlistenFocus?.();
    };
  }, [enabled]);

  if (!enabled) return null;

  // Window chrome runs through the shared host commands so palette rows,
  // buttons, and future extensions share one execution path.
  const appContext: AppCommandContext = {
    windowAction: async (action) => {
      try {
        const { getCurrentWindow } = await import('@tauri-apps/api/window');
        const { toggleMaximizeRestore } = await import('../../platform/window/windowGeometry');
        const win = getCurrentWindow();
        if (action === 'minimize') await win.minimize();
        else if (action === 'maximizeRestore') await toggleMaximizeRestore(win);
        else await win.close();
      } catch {
        // Permission denied or browser preview: controls stay visible but inert.
      }
    },
  };

  const run = (id: 'window.minimize' | 'window.toggleMaximize' | 'window.close') =>
    void executeAppCommand(id, appContext);

  const toggleLabel = maximized ? t('common.actions.restore') : t('common.actions.maximize');

  return (
    <div className="titlebar-controls" role="group" aria-label={t('common.appName')}>
      <Tooltip content={t('common.actions.minimize')} placement="bottom">
        <button
          type="button"
          className="titlebar-button"
          aria-label={t('common.actions.minimize')}
          onClick={() => run('window.minimize')}
        >
          <MinusIcon size={14} />
        </button>
      </Tooltip>
      <Tooltip content={toggleLabel} placement="bottom">
        <button
          type="button"
          className="titlebar-button"
          id="restore-btn"
          aria-label={toggleLabel}
          onClick={() => run('window.toggleMaximize')}
        >
          {maximized ? <RestoreIcon size={14} /> : <MaximizeIcon size={14} />}
        </button>
      </Tooltip>
      <Tooltip content={t('common.actions.close')} placement="bottom">
        <button
          type="button"
          className="titlebar-button titlebar-button--close"
          aria-label={t('common.actions.close')}
          onClick={() => run('window.close')}
        >
          <CloseIcon size={14} />
        </button>
      </Tooltip>
    </div>
  );
}
