import { useEffect, useState } from 'react';
import { useI18n } from '../i18n/resources';
import { isTauriRuntime } from '../../platform/projects/tauriAdapter';
import { CloseIcon, MaximizeIcon, MinusIcon, RestoreIcon } from '../../ui/icons';
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

  const run = async (action: 'minimize' | 'toggle' | 'close') => {
    try {
      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      const { toggleMaximizeRestore } = await import('../../platform/window/windowGeometry');
      const win = getCurrentWindow();
      if (action === 'minimize') await win.minimize();
      else if (action === 'toggle') await toggleMaximizeRestore(win);
      else await win.close();
    } catch {
      // Permission denied or browser preview: controls stay visible but inert.
    }
  };

  const toggleLabel = maximized ? t('common.actions.restore') : t('common.actions.maximize');

  return (
    <div className="titlebar-controls" role="group" aria-label={t('common.appName')}>
      <button
        type="button"
        className="titlebar-button"
        aria-label={t('common.actions.minimize')}
        title={t('common.actions.minimize')}
        onClick={() => void run('minimize')}
      >
        <MinusIcon size={14} />
      </button>
      <button
        type="button"
        className="titlebar-button"
        id="restore-btn"
        aria-label={toggleLabel}
        title={toggleLabel}
        onClick={() => void run('toggle')}
      >
        {maximized ? <RestoreIcon size={14} /> : <MaximizeIcon size={14} />}
      </button>
      <button
        type="button"
        className="titlebar-button titlebar-button--close"
        aria-label={t('common.actions.close')}
        title={t('common.actions.close')}
        onClick={() => void run('close')}
      >
        <CloseIcon size={14} />
      </button>
    </div>
  );
}
