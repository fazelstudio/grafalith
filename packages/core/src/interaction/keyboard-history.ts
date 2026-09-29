import { HistoryManager } from '../history/history-manager';

/**
 * Registers global keyboard shortcuts for undo/redo.
 * This is a framework-agnostic helper — the app layer calls this with
 * a target element (typically `document`) and the HistoryManager instance.
 * @param onChange - Optional callback invoked after undo/redo for the app to sync state (e.g. re-render interactive canvas)
 * @param isBusy - Optional predicate: when true, undo/redo is ignored
 *   (e.g. mid-drag transform, text editing, crop, rubber-band). Prefer
 *   Editor.undo()/redo() which already guard; this keeps the standalone
 *   helper from tearing half-committed batches when both are wired.
 */
export function registerHistoryShortcuts(
  target: EventTarget,
  history: HistoryManager,
  onChange?: () => void,
  isBusy?: () => boolean,
): () => void {
  const handler = (e: Event) => {
    const ke = e as KeyboardEvent;
    // Never hijack typing in text fields/textarea/contenteditable.
    const t = ke.target as HTMLElement | null;
    if (t && (t.tagName === 'TEXTAREA' || t.tagName === 'INPUT' || t.isContentEditable)) return;
    if (isBusy?.()) return;
    const mod = ke.metaKey || ke.ctrlKey;

    if (!mod) return;

    const key = ke.key.toLowerCase();
    if (key === 'z' && !ke.shiftKey) {
      ke.preventDefault();
      history.undo();
      onChange?.();
    } else if ((key === 'z' && ke.shiftKey) || key === 'y') {
      ke.preventDefault();
      history.redo();
      onChange?.();
    }
  };

  target.addEventListener('keydown', handler as EventListener);
  return () => target.removeEventListener('keydown', handler as EventListener);
}
