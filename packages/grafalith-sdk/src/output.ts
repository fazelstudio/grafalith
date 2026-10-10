// Output channels: per-extension logs plus the system channel.
//
// Extensions log through `context.createOutputChannel(name)`; errors the
// host catches are appended automatically. The desktop renders channels in
// its bottom panel; memory adapters below serve tests and headless hosts.
import type { Disposable } from "./commands.js";

/**
 * Named log an extension writes to (`context.createOutputChannel(name)`).
 * The host shows it in the Output panel; `show()` requests focus.
 */
export interface OutputChannel extends Disposable {
  readonly name: string;
  append(value: string): void;
  appendLine(value: string): void;
  clear(): void;
  show(): void;
  hide(): void;
  lines(): readonly string[];
  onDidAppend(listener: (line: string) => void): Disposable;
}

/** System channel id for extension-host lifecycle logs. */
export const SYSTEM_OUTPUT_CHANNEL = "Grafalith — Extensions";

/** In-memory channel for tests and headless hosts. */
export class MemoryOutputChannel implements OutputChannel {
  private readonly buffer: string[] = [];
  private readonly appendListeners = new Set<(line: string) => void>();
  private shown = false;

  constructor(readonly name: string) {}

  append(value: string): void {
    if (value === "") return;
    if (this.buffer.length === 0) this.buffer.push("");
    this.buffer[this.buffer.length - 1] += value;
    for (const listener of [...this.appendListeners]) listener(value);
  }

  appendLine(value: string): void {
    this.buffer.push(value);
    for (const listener of [...this.appendListeners]) listener(value);
  }

  clear(): void {
    this.buffer.length = 0;
  }

  show(): void {
    this.shown = true;
  }

  hide(): void {
    this.shown = false;
  }

  dispose(): void {
    this.appendListeners.clear();
  }

  lines(): readonly string[] {
    return [...this.buffer];
  }

  onDidAppend(listener: (line: string) => void): Disposable {
    this.appendListeners.add(listener);
    return { dispose: () => void this.appendListeners.delete(listener) };
  }

  /** Whether `show()` was last called (panel focus hint). */
  get visible(): boolean {
    return this.shown;
  }
}
