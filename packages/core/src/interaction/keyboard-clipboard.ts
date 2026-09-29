import { Scene } from '../scene/scene';
import { HistoryManager } from '../history/history-manager';
import { copyElements, pasteElements, duplicateElements, cutElements } from './clipboard';

/**
 * Registers global keyboard shortcuts for clipboard operations.
 * Returns an unsubscribe function.
 * Skips events from text fields so typing is never hijacked.
 */
export function registerClipboardShortcuts(
  target: EventTarget,
  scene: Scene,
  history: HistoryManager,
  getSelectedIds: () => string[],
  isBusy?: () => boolean,
): () => void {
  const handler = (e: Event) => {
    const ke = e as KeyboardEvent;
    const t = ke.target as HTMLElement | null;
    if (t && (t.tagName === 'TEXTAREA' || t.tagName === 'INPUT' || t.isContentEditable)) return;
    if (isBusy?.()) return;
    const mod = ke.metaKey || ke.ctrlKey;

    if (!mod) return;

    const selected = getSelectedIds();
    const key = ke.key.toLowerCase();

    if (key === 'c') {
      ke.preventDefault();
      if (selected.length > 0) {
        copyElements(scene, selected);
      }
    } else if (key === 'v') {
      ke.preventDefault();
      pasteElements(scene, history);
    } else if (key === 'd') {
      ke.preventDefault();
      if (selected.length > 0) {
        duplicateElements(scene, history, selected);
      }
    } else if (key === 'x') {
      ke.preventDefault();
      if (selected.length > 0) {
        cutElements(scene, history, selected);
      }
    }
  };

  target.addEventListener('keydown', handler as EventListener);
  return () => target.removeEventListener('keydown', handler as EventListener);
}
