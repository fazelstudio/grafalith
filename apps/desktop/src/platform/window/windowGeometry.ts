import type { Window } from '@tauri-apps/api/window';

/** Fraction of the monitor used for restore size and the resize floor. */
export const RESTORE_FRACTION = 0.6;
export const MIN_SIZE_FRACTION = 0.6;

async function activeMonitor() {
  try {
    const { currentMonitor } = await import('@tauri-apps/api/window');
    const current = await currentMonitor();
    if (current) return current;
  } catch {
    // Missing monitor permission: fall through to the primary monitor.
  }
  try {
    const { primaryMonitor } = await import('@tauri-apps/api/window');
    return await primaryMonitor();
  } catch {
    return null;
  }
}

/**
 * Clamp the window so it cannot be resized below a fraction of the screen.
 * Measured from the active monitor on every device, and mirrored natively by
 * the Rust setup hook so the floor holds before the frontend loads.
 */
export async function ensureMinWindowSize(win: Window): Promise<void> {
  try {
    const monitor = await activeMonitor();
    if (!monitor) return;
    const { PhysicalSize } = await import('@tauri-apps/api/dpi');
    const width = Math.round(monitor.size.width * MIN_SIZE_FRACTION);
    const height = Math.round(monitor.size.height * MIN_SIZE_FRACTION);
    await win.setMinSize(new PhysicalSize(width, height));
  } catch {
    // Monitor query or permission failed: the Rust setup hook already applied
    // the same relative floor, so resizing stays bounded.
  }
}

/** Resize to a fraction of the monitor and recenter. Used for restore. */
export async function restoreToFraction(win: Window, fraction = RESTORE_FRACTION): Promise<void> {
  const monitor = await activeMonitor();
  if (!monitor) {
    await win.unmaximize();
    return;
  }
  const { PhysicalSize } = await import('@tauri-apps/api/dpi');
  const width = Math.round(monitor.size.width * fraction);
  const height = Math.round(monitor.size.height * fraction);
  await win.unmaximize();
  await win.setSize(new PhysicalSize(width, height));
  await win.center();
}

/** Maximize when floating, otherwise restore to the fraction size. */
export async function toggleMaximizeRestore(win: Window): Promise<void> {
  const maximized = await win.isMaximized();
  if (maximized) {
    await restoreToFraction(win);
  } else {
    await win.maximize();
  }
}
