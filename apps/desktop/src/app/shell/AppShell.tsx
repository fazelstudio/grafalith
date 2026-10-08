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
import { ExtensionDialogHost } from './ExtensionDialogHost';
import { getExtensionHost } from '../../platform/extensions/extensionHost';
import { revealWhenReady } from '../boot';
import { isTauriRuntime } from '../../platform/projects/tauriAdapter';
import { Titlebar } from './Titlebar';
import { Tooltip } from '../../ui/primitives/tooltip';
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
        {route.layout === 'editor' ? (
          <div className="shell__titlebar-center">
            <div id="editor-titlebar-center" className="shell__titlebar-slot" />
          </div>
        ) : (
          <span className="shell__spacer" data-tauri-drag-region />
        )}
        <Titlebar />
      </header>
      <div className="shell__workspace">
        {route.layout !== 'editor' ? (
          <aside
            id="app-sidebar"
            className={`shell__sidebar${sidebarCollapsed ? ' shell__sidebar--collapsed' : ''}`}
          >
            <nav className="shell__sidebar-nav" aria-label={t('navigation.projects')}>
              <Tooltip
                content={t('navigation.projects')}
                placement="right"
                disabled={!sidebarCollapsed}
              >
                <button
                  type="button"
                  className="shell__sidebar-link"
                  aria-current={route.id === 'home' ? 'page' : undefined}
                  onClick={() => navigate('#/')}
                >
                  <ProjectsIcon className="shell__sidebar-icon" size={16} />
                  <span className="shell__sidebar-label">{t('navigation.projects')}</span>
                </button>
              </Tooltip>
              <Tooltip
                content={t('navigation.trash')}
                placement="right"
                disabled={!sidebarCollapsed}
              >
                <button
                  type="button"
                  className="shell__sidebar-link"
                  aria-current={route.id === 'trash' ? 'page' : undefined}
                  onClick={() => navigate('#/trash')}
                >
                  <TrashIcon className="shell__sidebar-icon" size={16} />
                  <span className="shell__sidebar-label">{t('navigation.trash')}</span>
                </button>
              </Tooltip>
            </nav>
            <nav className="shell__sidebar-bottom" aria-label={t('navigation.settings')}>
              <Tooltip
                content={t('navigation.settings')}
                placement="right"
                disabled={!sidebarCollapsed}
              >
                <button
                  type="button"
                  className="shell__sidebar-link"
                  aria-current={route.layout === 'settings' ? 'page' : undefined}
                  onClick={() => navigate(routeRegistry.get('settings')!.path)}
                >
                  <SettingsIcon className="shell__sidebar-icon" size={16} />
                  <span className="shell__sidebar-label">{t('navigation.settings')}</span>
                </button>
              </Tooltip>
            </nav>
            <Tooltip
              content={t(sidebarCollapsed ? 'navigation.expandSidebar' : 'navigation.collapseSidebar')}
              placement="right"
            >
              <button
                type="button"
                className="shell__sidebar-toggle"
                aria-label={t(sidebarCollapsed ? 'navigation.expandSidebar' : 'navigation.collapseSidebar')}
                aria-controls="app-sidebar"
                aria-expanded={!sidebarCollapsed}
                onClick={() => setSidebarCollapsed((collapsed) => !collapsed)}
              >
                {sidebarCollapsed ? <ChevronRightIcon size={14} /> : <ChevronLeftIcon size={14} />}
              </button>
            </Tooltip>
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
        {toasts.map((toast) => {
          const action = toast.action;
          return (
          <span
            key={toast.id}
            role="status"
            className={`shell__toast shell__toast--${toast.level}`}
          >
            <button
              type="button"
              className="shell__toast-message"
              onClick={() => dismiss(toast.id)}
              aria-label={`${toast.message} — ${t('common.actions.close')}`}
            >
              {toast.message}
            </button>
            {action ? (
              <button
                type="button"
                className="shell__toast-action"
                onClick={() => {
                  dismiss(toast.id);
                  void getExtensionHost().executeCommand(action.commandId);
                }}
              >
                {action.label}
              </button>
            ) : null}
          </span>
          );
        })}
      </div>
      <ExtensionDialogHost />
    </div>
  );
}
