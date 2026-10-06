import { useEffect, useState } from 'react';
import './shell.css';
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  ProjectsIcon,
  SettingsIcon,
  TrashIcon,
} from '../../ui/icons';
import { routeRegistry } from '../routing/routes';
import { useHashRoute } from '../routing/useHashRoute';
import { useI18n } from '../i18n/resources';
import { AppErrorBoundary } from './AppErrorBoundary';
import { useToast } from './ToastProvider';
import { revealWhenReady } from '../boot';
import { isTauriRuntime } from '../../platform/projects/tauriAdapter';
import { Titlebar } from './Titlebar';
import { getProjectStore } from '../../platform/projects/projectService';
import { parseProjectError } from '../../platform/projects/types';
import { persistenceConfig } from '../../platform/projects/persistenceConfig';
import appIcon from '../../../src-tauri/icons/icon.png';

interface ShellProps {
  children: (
    routeId: string,
    navigate: (path: string) => void,
    hash: string,
  ) => React.ReactNode;
}

/**
 * Global application shell: identity, home-level navigation, content area,
 * toast region, and per-screen failure boundary.
 */
export function AppShell({ children }: ShellProps) {
  const { route, hash, navigate } = useHashRoute();
  const { t } = useI18n();
  const { toasts, dismiss, notify } = useToast();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  // Window starts hidden; reveal fires once fonts, first paint, and the
  // first screen's data have all settled (with a timeout backstop).
  useEffect(() => {
    void revealWhenReady();
  }, []);

  useEffect(() => {
    let mounted = true;
    const purgeExpired = async () => {
      try {
        await getProjectStore().purgeExpired();
      } catch (raw) {
        const error = parseProjectError(raw);
        if (mounted) {
          notify(
            error.details
              ? t(error.messageKey, { details: error.details })
              : t(error.messageKey),
          );
        }
      }
    };
    void purgeExpired();
    const interval = window.setInterval(
      () => void purgeExpired(),
      persistenceConfig.trashPurgeIntervalMs,
    );
    return () => {
      mounted = false;
      window.clearInterval(interval);
    };
  }, [notify, t]);

  const toggleMaximize = async () => {
    if (!isTauriRuntime()) return;
    try {
      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      const { toggleMaximizeRestore } = await import('../../platform/window/windowGeometry');
      await toggleMaximizeRestore(getCurrentWindow());
    } catch {
      // Permission denied: double-click stays inert.
    }
  };

  // Disable the default browser context menu so the app can render custom
  // context menus where needed.
  useEffect(() => {
    const handler = (event: Event) => {
      if (event instanceof MouseEvent) {
        event.preventDefault();
      }
    };
    document.addEventListener('contextmenu', handler);
    return () => document.removeEventListener('contextmenu', handler);
  }, []);

  return (
    <div className="shell">
      <header
        className="shell__header"
        data-tauri-drag-region
        onDoubleClick={() => void toggleMaximize()}
      >
        <span className="shell__brand">
          <img src={appIcon} alt="" />
          {t('common.appName')}
        </span>
        <span className="shell__spacer" data-tauri-drag-region />
        <Titlebar />
      </header>
      <div className="shell__workspace">
        {route.layout !== 'editor' ? (
          <aside
            id="app-sidebar"
            className={`shell__sidebar${sidebarCollapsed ? ' shell__sidebar--collapsed' : ''}`}
          >
            <nav className="shell__sidebar-nav" aria-label={t('navigation.projects')}>
              <button
                type="button"
                className="shell__sidebar-link"
                aria-current={route.id === 'home' ? 'page' : undefined}
                title={t('navigation.projects')}
                onClick={() => navigate('#/')}
              >
                <ProjectsIcon className="shell__sidebar-icon" size={16} />
                <span className="shell__sidebar-label">{t('navigation.projects')}</span>
              </button>
              <button
                type="button"
                className="shell__sidebar-link"
                aria-current={route.id === 'trash' ? 'page' : undefined}
                title={t('navigation.trash')}
                onClick={() => navigate('#/trash')}
              >
                <TrashIcon className="shell__sidebar-icon" size={16} />
                <span className="shell__sidebar-label">{t('navigation.trash')}</span>
              </button>
            </nav>
            <nav className="shell__sidebar-bottom" aria-label={t('navigation.settings')}>
              <button
                type="button"
                className="shell__sidebar-link"
                aria-current={route.layout === 'settings' ? 'page' : undefined}
                title={t('navigation.settings')}
                onClick={() => navigate(routeRegistry.get('settings')!.path)}
              >
                <SettingsIcon className="shell__sidebar-icon" size={16} />
                <span className="shell__sidebar-label">{t('navigation.settings')}</span>
              </button>
            </nav>
            <button
              type="button"
              className="shell__sidebar-toggle"
              aria-label={t(sidebarCollapsed ? 'navigation.expandSidebar' : 'navigation.collapseSidebar')}
              aria-controls="app-sidebar"
              aria-expanded={!sidebarCollapsed}
              title={t(sidebarCollapsed ? 'navigation.expandSidebar' : 'navigation.collapseSidebar')}
              onClick={() => setSidebarCollapsed((collapsed) => !collapsed)}
            >
              {sidebarCollapsed ? <ChevronRightIcon size={14} /> : <ChevronLeftIcon size={14} />}
            </button>
          </aside>
        ) : null}
        <main className="shell__main">
          <AppErrorBoundary
            title={t('dialogs.errorTitle')}
            description={t('dialogs.errorDescription')}
            retryLabel={t('common.actions.retry')}
            homeLabel={t('navigation.backToHome')}
            onHome={() => navigate('#/')}
          >
            {children(route.id, navigate, hash)}
          </AppErrorBoundary>
        </main>
      </div>
      <div className="shell__toasts" aria-live="polite" aria-atomic="false">
        {toasts.map((toast) => (
          <button
            key={toast.id}
            type="button"
            className="shell__toast"
            onClick={() => dismiss(toast.id)}
            title={t('common.actions.close')}
            aria-label={`${toast.message} — ${t('common.actions.close')}`}
          >
            {toast.message}
          </button>
        ))}
      </div>
    </div>
  );
}
