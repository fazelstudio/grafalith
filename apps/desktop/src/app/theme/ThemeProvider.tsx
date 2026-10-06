import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { DEFAULT_THEME_MODE, resolveThemeMode, type ResolvedTheme, type ThemeMode } from './tokens';
import { preferenceService } from '../../platform/preferences/preferenceService';

interface ThemeContextValue {
  /** User-facing preference: system follows the OS media query. */
  mode: ThemeMode;
  /** Concrete theme applied to the document. */
  resolved: ResolvedTheme;
  setMode: (mode: ThemeMode) => void;
}

const ThemeContext = createContext<ThemeContextValue>({
  mode: DEFAULT_THEME_MODE,
  resolved: 'light',
  setMode: () => undefined,
});

function readOsPreference(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

function applyResolved(resolved: ResolvedTheme): void {
  document.documentElement.dataset.theme = resolved;
}

/** Centralized theme state; components consume tokens, never mode flags. */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [mode, setModeState] = useState<ThemeMode>(() => preferenceService.getTheme());
  const [osDark, setOsDark] = useState<boolean>(() => readOsPreference());

  const resolved = useMemo(() => resolveThemeMode(mode, osDark), [mode, osDark]);

  useEffect(() => {
    applyResolved(resolved);
  }, [resolved]);

  useEffect(() => {
    const query = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = (event: MediaQueryListEvent) => setOsDark(event.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);

  const setMode = useCallback((next: ThemeMode) => {
    setModeState(next);
    preferenceService.setTheme(next);
  }, []);

  const value = useMemo(() => ({ mode, resolved, setMode }), [mode, resolved, setMode]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

/** Theme preference plus the concrete applied theme. */
export function useTheme(): ThemeContextValue {
  return useContext(ThemeContext);
}
