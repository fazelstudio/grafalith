import { DEFAULT_LOCALE, isLocale, type Locale } from './i18n/locales';
import { DEFAULT_THEME_MODE, isThemeMode, resolveThemeMode } from './theme/tokens';
import { isTauriRuntime } from '../platform/projects/tauriAdapter';

const THEME_KEY = 'grafalith:theme';
const LOCALE_KEY = 'grafalith:locale';

let revealed = false;
let bootDataSettled = false;
let bootDataSettledResolve: (() => void) | null = null;
const bootDataSettledPromise = new Promise<void>((resolve) => {
  bootDataSettledResolve = resolve;
});

const READY_TIMEOUT_MS = 4000;
const SETTLE_MS = 150;
const FONT_TIMEOUT_MS = 1500;

function readStored(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

/** Resolve theme synchronously so the first paint already uses the right tokens. */
export function getBootTheme(): 'light' | 'dark' {
  if (typeof window === 'undefined') return 'light';
  const raw = readStored(THEME_KEY);
  const mode = isThemeMode(raw) ? raw : DEFAULT_THEME_MODE;
  const prefersDark =
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-color-scheme: dark)').matches;
  return resolveThemeMode(mode, prefersDark);
}

/** Resolve locale synchronously so the first paint never shows a fallback language. */
export function getBootLocale(): Locale {
  if (typeof window === 'undefined') return DEFAULT_LOCALE;
  const raw = readStored(LOCALE_KEY);
  return isLocale(raw) ? raw : DEFAULT_LOCALE;
}

/**
 * Apply persisted theme and locale before React renders. Mirrors the inline
 * script in index.html so the window can stay hidden until this matches.
 */
export function applyBootPreferences(): void {
  if (typeof document === 'undefined') return;
  const resolved = getBootTheme();
  document.documentElement.dataset.theme = resolved;
  try {
    document.documentElement.style.colorScheme = resolved;
  } catch {
    // Non-critical enhancement; tokens still apply via data-theme.
  }
  document.documentElement.lang = getBootLocale();
}

/**
 * Screens call this once their first data load settles (list, session, or
 * synchronous preferences). Showing an error still counts as settled, so a
 * storage failure never leaves the window hidden. Idempotent.
 */
export function notifyBootDataReady(): void {
  if (bootDataSettled) return;
  bootDataSettled = true;
  bootDataSettledResolve?.();
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(() => resolve(), ms);
  });
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => resolve());
    } else {
      setTimeout(() => resolve(), 16);
    }
  });
}

/** Wait for web fonts plus two painted frames so text never swaps after show. */
async function waitForFirstPaint(): Promise<void> {
  try {
    const ready = document.fonts?.ready;
    if (ready) await Promise.race([ready, delay(FONT_TIMEOUT_MS)]);
  } catch {
    // System fonts suffice; frame waits below still apply.
  }
  await nextFrame();
  await nextFrame();
}

/**
 * Show the main window exactly once, only when content is truly ready. The
 * window is created hidden and unmaximized; it is maximized while still
 * hidden (maximizing at creation flashes), then shown after fonts, first
 * paint, and first data all settle. A timeout guarantees the window always
 * appears even if a data load hangs.
 */
export async function revealWhenReady(): Promise<void> {
  if (revealed || typeof window === 'undefined' || !isTauriRuntime()) return;
  revealed = true;
  try {
    const { getCurrentWindow } = await import('@tauri-apps/api/window');
    const { ensureMinWindowSize } = await import('../platform/window/windowGeometry');
    const win = getCurrentWindow();
    await ensureMinWindowSize(win);
    try {
      await win.setBackgroundColor(getBootTheme() === 'dark' ? '#1c1c1a' : '#ffffff');
    } catch {
      // Themed CSS already paints the same background.
    }
    await win.maximize();
    await Promise.race([
      (async () => {
        await waitForFirstPaint();
        await bootDataSettledPromise;
        await nextFrame();
        await delay(SETTLE_MS);
      })(),
      delay(READY_TIMEOUT_MS),
    ]);
    await win.show();
    await win.setFocus();
  } catch {
    // Browser preview or missing permission: keep rendering without a native window.
  }
}
