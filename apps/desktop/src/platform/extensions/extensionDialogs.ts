/** One modal request a extension shows through the host dialog surface. */
export type ExtensionDialogRequest =
  | {
      readonly kind: 'quickPick';
      readonly items: readonly { readonly id: string; readonly label: string; readonly description?: string }[];
      readonly placeholder?: string;
    }
  | { readonly kind: 'input'; readonly prompt: string; readonly initialValue?: string }
  | { readonly kind: 'confirm'; readonly title: string; readonly body: string };

/**
 * Single-flight modal queue: one request is visible at a time, each
 * resolves exactly once (value or undefined on dismiss). The React host
 * subscribes; extension code only awaits `ask`.
 */
export class ExtensionDialogQueue {
  private current: { request: ExtensionDialogRequest; resolve: (value: unknown) => void } | null = null;
  private readonly listeners = new Set<() => void>();

  ask<T>(request: ExtensionDialogRequest): Promise<T | undefined> {
    this.cancel();
    return new Promise<T | undefined>((resolve) => {
      this.current = { request, resolve: resolve as (value: unknown) => void };
      this.emit();
    });
  }

  peek(): ExtensionDialogRequest | null {
    return this.current?.request ?? null;
  }

  answer(value: unknown): void {
    const pending = this.current;
    this.current = null;
    pending?.resolve(value);
    this.emit();
  }

  cancel(): void {
    if (this.current) this.answer(undefined);
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  }

  private emit(): void {
    for (const listener of [...this.listeners]) listener();
  }
}

/** Window-shared dialog queue (one modal surface per window). */
export const extensionDialogQueue = new ExtensionDialogQueue();
