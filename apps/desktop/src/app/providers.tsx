import type { ReactNode } from 'react';
import { ThemeProvider } from './theme/ThemeProvider';
import { I18nProvider } from './i18n/resources';
import { ToastProvider } from './shell/ToastProvider';

/** Centralized provider composition for theme, locale, and notifications. */
export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider>
      <I18nProvider>
        <ToastProvider>{children}</ToastProvider>
      </I18nProvider>
    </ThemeProvider>
  );
}
