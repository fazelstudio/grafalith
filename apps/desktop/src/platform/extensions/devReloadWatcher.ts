// Development hot-reload: re-activate an extension when its files change.
//
// Polling with an injectable fingerprint source, so tests use memory and
// the desktop plugs Tauri fs (see the snippet below). One interval serves
// every watched package; a changed fingerprint triggers `host.reload()`.
// Reload failure toasts and stays disabled until the next good reload —
// the watcher never disarms itself on failure.
//
// Tauri wiring (dev only, in the shell once `@tauri-apps/plugin-fs` is
// installed for development):
//
// ```ts
// import { stat } from '@tauri-apps/plugin-fs';
// import { connectDevReload } from '../platform/extensions/devReloadWatcher';
// const connection = connectDevReload(host, {
//   fingerprint: async (packageId) =>
//     String((await stat(`${packageId}/dist/index.js`)).mtime ?? ''),
// });
// connection.arm('acme.pack');
// ```
import type { DesktopExtensionHost } from './extensionHost';
import { formatExtensionMessage } from './extensionMessages';

/** Fingerprint backend: comparable revision per package, null when unreadable. */
export interface ReloadFingerprintSource {
  fingerprint(packageId: string): Promise<string | null>;
}

/** In-memory source for tests and headless hosts. */
export class MemoryReloadSource implements ReloadFingerprintSource {
  private readonly revisions = new Map<string, string>();

  /** Set the current revision observed for a package. */
  touch(packageId: string, revision = `${Date.now()}`): void {
    this.revisions.set(packageId, revision);
  }

  async fingerprint(packageId: string): Promise<string | null> {
    return this.revisions.get(packageId) ?? null;
  }
}

export interface DevReloadOptions {
  /** Poll period in ms (default 1000; tests inject small values). */
  intervalMs?: number;
  /** Toast surface for reload failures (host toasts by default). */
  notify?: (message: string, options?: { level?: 'info' | 'success' | 'warning' | 'error'; source?: string }) => void;
}

/**
 * Polling hot-reload watcher: one timer, many packages, injectable clock.
 * A null fingerprint means "unreadable this tick" — skipped, never a reload.
 */
export class DevReloadWatcher {
  private readonly seen = new Map<string, string>();
  private readonly watchedIds = new Set<string>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private ticking = false;
  private readonly intervalMs: number;

  constructor(
    private readonly source: ReloadFingerprintSource,
    private readonly reload: (packageId: string) => Promise<boolean>,
    private readonly notify: NonNullable<DevReloadOptions['notify']>,
    options: DevReloadOptions = {},
  ) {
    this.intervalMs = options.intervalMs ?? 1000;
  }

  /** Start watching one package (captures its current revision first). */
  watch(packageId: string): void {
    this.watchedIds.add(packageId);
    void this.source.fingerprint(packageId).then((revision) => {
      if (revision !== null && this.watchedIds.has(packageId) && !this.seen.has(packageId)) {
        this.seen.set(packageId, revision);
      }
    });
    this.ensureRunning();
  }

  /** Stop watching one package. */
  unwatch(packageId: string): void {
    this.watchedIds.delete(packageId);
    this.seen.delete(packageId);
    if (this.watchedIds.size === 0) this.stop();
  }

  /** Watched package ids. */
  watched(): string[] {
    return [...this.watchedIds];
  }

  /** Stop everything (tests and full teardown). */
  disposeAll(): void {
    this.stop();
    this.watchedIds.clear();
    this.seen.clear();
  }

  private ensureRunning(): void {
    if (this.timer !== null) return;
    this.timer = setInterval(() => void this.tick(), this.intervalMs);
  }

  private stop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private async tick(): Promise<void> {
    if (this.ticking) return;
    this.ticking = true;
    try {
      for (const packageId of [...this.watchedIds]) {
        let revision: string | null;
        try {
          revision = await this.source.fingerprint(packageId);
        } catch {
          continue;
        }
        if (revision === null) continue;
        const previous = this.seen.get(packageId);
        if (previous === undefined) {
          this.seen.set(packageId, revision);
          continue;
        }
        if (revision !== previous) {
          this.seen.set(packageId, revision);
          let ok = false;
          try {
            ok = await this.reload(packageId);
          } catch {
            ok = false;
          }
          if (!ok) {
            this.notify(
              formatExtensionMessage('notifications.extensions.reloadFailed', { id: packageId }),
              {
                level: 'error',
                source: packageId,
              },
            );
          }
        }
      }
    } finally {
      this.ticking = false;
    }
  }
}

/** Connection arming watcher packages through one host. */
export interface DevReloadConnection {
  arm(packageId: string): void;
  disarm(packageId: string): void;
  dispose(): void;
}

/**
 * Connect a fingerprint source to a host: `arm()` watches a package and
 * reloads it through the host on change.
 */
export function connectDevReload(
  host: DesktopExtensionHost,
  source: ReloadFingerprintSource,
  options: DevReloadOptions = {},
): DevReloadConnection {
  const notify = options.notify ?? ((message, notifyOptions) => host.notifyToast(message, notifyOptions));
  const watcher = new DevReloadWatcher(source, (packageId) => host.reload(packageId), notify, options);
  return {
    arm: (packageId) => watcher.watch(packageId),
    disarm: (packageId) => watcher.unwatch(packageId),
    dispose: () => watcher.disposeAll(),
  };
}
