// Output channels: per-extension logs plus one system channel.
//
// Mirrors the VSCode Output panel for a design app: each extension writes
// to its own channel through `context.createOutputChannel(name)`, and the
// host writes discovery/validation/activation order to the system channel
// ("Grafalith — Extensions"). The panel UI subscribes to appended lines;
// the host never throws when logging.
export interface OutputChannel {
  readonly name: string;
  append(value: string): void;
  appendLine(value: string): void;
  clear(): void;
  show(): void;
  hide(): void;
  dispose(): void;
  lines(): readonly string[];
  onDidAppend(listener: (line: string) => void): { dispose(): void };
  onDidShow(listener: () => void): { dispose(): void };
}

/** System channel id for extension-host lifecycle logs. */
export const SYSTEM_OUTPUT_CHANNEL = 'Grafalith — Extensions';

class MemoryOutputChannel implements OutputChannel {
  private readonly buffer: string[] = [];
  private readonly appendListeners = new Set<(line: string) => void>();
  private readonly showListeners = new Set<() => void>();
  private disposed = false;

  constructor(
    readonly name: string,
    private readonly onShow: (name: string) => void,
    private readonly onHide: (name: string) => void,
  ) {}

  append(value: string): void {
    if (this.disposed) return;
    if (value === '') return;
    const parts = value.split('\n');
    if (this.buffer.length === 0) this.buffer.push('');
    this.buffer[this.buffer.length - 1] += parts[0];
    for (const part of parts.slice(1)) {
      this.fire(part === '' ? '' : part);
      this.buffer.push(part);
    }
    if (parts.length === 1) this.fire(value);
  }

  appendLine(value: string): void {
    if (this.disposed) return;
    this.buffer.push(value);
    this.fire(value);
  }

  clear(): void {
    this.buffer.length = 0;
  }

  show(): void {
    if (this.disposed) return;
    this.onShow(this.name);
    for (const listener of [...this.showListeners]) listener();
  }

  hide(): void {
    this.onHide(this.name);
  }

  dispose(): void {
    this.disposed = true;
    this.appendListeners.clear();
    this.showListeners.clear();
  }

  lines(): readonly string[] {
    return [...this.buffer];
  }

  onDidAppend(listener: (line: string) => void): { dispose(): void } {
    this.appendListeners.add(listener);
    return { dispose: () => void this.appendListeners.delete(listener) };
  }

  onDidShow(listener: () => void): { dispose(): void } {
    this.showListeners.add(listener);
    return { dispose: () => void this.showListeners.delete(listener) };
  }

  private fire(line: string): void {
    for (const listener of [...this.appendListeners]) listener(line);
  }
}

/**
 * Host-owned channel registry: one instance per window, no globals.
 * Channels survive deactivation (logs stay inspectable); `disposeAll`
 * clears them on full teardown.
 */
export class OutputChannelService {
  private readonly channels = new Map<string, MemoryOutputChannel>();
  private visible: string | null = null;
  private readonly visibleListeners = new Set<(name: string | null) => void>();

  /** Get or create a channel (extension logs, system logs). */
  channel(name: string): OutputChannel {
    let entry = this.channels.get(name);
    if (!entry) {
      entry = new MemoryOutputChannel(
        name,
        (shown) => {
          this.visible = shown;
          this.emitVisible();
        },
        (hidden) => {
          if (this.visible === hidden) {
            this.visible = null;
            this.emitVisible();
          }
        },
      );
      this.channels.set(name, entry);
    }
    return entry;
  }

  /** System channel for discovery/validation/activation logs. */
  system(): OutputChannel {
    return this.channel(SYSTEM_OUTPUT_CHANNEL);
  }

  /** Channel names in creation order (panel switcher). */
  names(): string[] {
    return [...this.channels.keys()];
  }

  /** Currently shown channel, if any. */
  visibleChannel(): string | null {
    return this.visible;
  }

  /** Subscribe to panel visibility switches. */
  onDidChangeVisible(listener: (name: string | null) => void): { dispose(): void } {
    this.visibleListeners.add(listener);
    return { dispose: () => void this.visibleListeners.delete(listener) };
  }

  /** Drop one channel (uninstall path). */
  remove(name: string): void {
    this.channels.get(name)?.dispose();
    this.channels.delete(name);
    if (this.visible === name) {
      this.visible = null;
      this.emitVisible();
    }
  }

  /** Drop every channel (tests and full teardown). */
  disposeAll(): void {
    for (const channel of this.channels.values()) channel.dispose();
    this.channels.clear();
    this.visible = null;
  }

  private emitVisible(): void {
    for (const listener of [...this.visibleListeners]) listener(this.visible);
  }
}

let sharedService: OutputChannelService | null = null;

/** Window-shared output channels (one registry per window). */
export function getOutputChannels(): OutputChannelService {
  if (!sharedService) sharedService = new OutputChannelService();
  return sharedService;
}

/** Drop the shared channels (tests and full teardown). */
export function resetOutputChannels(): void {
  sharedService?.disposeAll();
  sharedService = null;
}
