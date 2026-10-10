// Panel surfaces for the Extension Manager and the Output panel.
//
// `executeManagerCommand` drives this store; `ExtensionPanelsHost` (mounted
// once in the shell) renders whichever view is open inside a Dialog. State
// is external (subscribe/peek, like the dialog queue) so commands,
// toasts, and tests drive it without React.
export type ExtensionPanelFilter = 'all' | 'active' | 'failed';

export type ExtensionPanelView =
  | { readonly kind: 'manager'; readonly filter: ExtensionPanelFilter }
  | { readonly kind: 'output'; readonly fromManager: boolean };

/**
 * Single-flight panel state: one manager/output dialog at a time.
 * Opening a view replaces the current one; closing empties it.
 */
export class ExtensionPanelStore {
  private view: ExtensionPanelView | null = null;
  private readonly listeners = new Set<() => void>();

  peek(): ExtensionPanelView | null {
    return this.view;
  }

  openManager(filter: ExtensionPanelFilter = 'all'): void {
    this.view = { kind: 'manager', filter };
    this.emit();
  }

  openOutput(fromManager = false): void {
    this.view = { kind: 'output', fromManager };
    this.emit();
  }

  backToManager(): void {
    this.view = { kind: 'manager', filter: 'all' };
    this.emit();
  }

  close(): void {
    if (this.view !== null) {
      this.view = null;
      this.emit();
    }
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  }

  private emit(): void {
    for (const listener of [...this.listeners]) listener();
  }
}

/** Window-shared panel state (one manager/output dialog per window). */
export const extensionPanelStore = new ExtensionPanelStore();
