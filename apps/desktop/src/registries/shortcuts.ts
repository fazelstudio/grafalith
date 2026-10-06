import { commandRegistry, type CommandDefinition, type ShortcutChord } from './commands';
import { toolRegistry } from './tools';

/** Whether the host runs on macOS (Cmd) or Windows/Linux (Ctrl). */
export function isMacPlatform(): boolean {
  if (typeof navigator === 'undefined') return false;
  const platform = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData
    ?.platform
    ?? navigator.platform
    ?? '';
  return /mac/i.test(platform);
}

/** Normalize a letter shortcut for case-insensitive matching (Ctrl+C vs Ctrl+c). */
function normalizeKey(key: string): string {
  return key.length === 1 ? key.toLowerCase() : key;
}

/** True when a chord matches a key event (ctrlOrCmd covers Ctrl on Win/Linux, Cmd on macOS). */
export function chordMatchesEvent(
  chord: ShortcutChord,
  event: { key: string; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; altKey: boolean },
  options: { allowShiftPassthrough?: boolean } = {},
): boolean {
  if (normalizeKey(chord.key) !== normalizeKey(event.key)) return false;
  if ((chord.ctrlOrCmd ?? false) !== (event.ctrlKey || event.metaKey)) return false;
  if ((chord.alt ?? false) !== event.altKey) return false;
  if (options.allowShiftPassthrough) return true;
  return (chord.shift ?? false) === event.shiftKey;
}

/** All chords registered by commands (single source; no per-surface duplicates). */
export function commandShortcuts(): readonly { command: CommandDefinition; chord: ShortcutChord }[] {
  const out: { command: CommandDefinition; chord: ShortcutChord }[] = [];
  for (const command of commandRegistry.all()) {
    for (const chord of command.shortcuts ?? []) {
      out.push({ command, chord });
    }
  }
  return out;
}

/**
 * Find the command for a key event. Nudge arrows tolerate an extra Shift
 * (Shift+Arrow = ×10 via context modifiers) instead of registering eight
 * chords; every other command matches its chord exactly.
 */
export function findCommandForEvent(event: {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}): CommandDefinition | undefined {
  for (const { command, chord } of commandShortcuts()) {
    const isNudge = command.id.startsWith('nudge');
    if (chordMatchesEvent(chord, event, { allowShiftPassthrough: isNudge })) return command;
  }
  return undefined;
}

/** Find the tool id for a single-letter tool shortcut (no modifiers held). */
export function findToolForEvent(event: {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
}): string | undefined {
  if (event.ctrlKey || event.metaKey || event.altKey) return undefined;
  if (event.key.length !== 1) return undefined;
  const tool = toolRegistry
    .all()
    .find((candidate) => candidate.shortcutHint?.toLowerCase() === event.key.toLowerCase());
  return tool?.id;
}

/** Platform-aware shortcut label (`Ctrl+Z` on Win/Linux, `⌘Z` on macOS). */
export function formatShortcut(chord: ShortcutChord, isMac = isMacPlatform()): string {
  const parts: string[] = [];
  if (chord.ctrlOrCmd) parts.push(isMac ? '⌘' : 'Ctrl');
  if (chord.shift) parts.push(isMac ? '⇧' : 'Shift');
  if (chord.alt) parts.push(isMac ? '⌥' : 'Alt');
  parts.push(shortcutKeyLabel(chord.key, isMac));
  return isMac ? parts.join('') : parts.join('+');
}

/** Display label for one key (arrows and Escape get compact glyphs). */
export function shortcutKeyLabel(key: string, isMac = isMacPlatform()): string {
  void isMac;
  switch (key) {
    case 'ArrowLeft':
      return '←';
    case 'ArrowRight':
      return '→';
    case 'ArrowUp':
      return '↑';
    case 'ArrowDown':
      return '↓';
    case 'Escape':
      return 'Esc';
    case 'Delete':
      return 'Del';
    case 'Backspace':
      return '⌫';
    case ' ':
      return 'Space';
    default:
      return key.length === 1 ? key.toUpperCase() : key;
  }
}

/** Primary shortcut label for a command, or undefined when it has none. */
export function commandShortcutLabel(
  command: CommandDefinition,
  isMac = isMacPlatform(),
): string | undefined {
  const primary = command.shortcuts?.[0] ?? null;
  if (!primary) return undefined;
  return formatShortcut(primary, isMac);
}

/** True when the event target owns the keystroke (inputs, text editing, IME). */
export function isEditableTarget(target: EventTarget | null): boolean {
  if (!target || typeof target !== 'object') return false;
  const node = target as Partial<HTMLElement> & { tagName?: string; isContentEditable?: boolean; getAttribute?: (name: string) => string | null };
  if (node.isContentEditable) return true;
  const tag = node.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  try {
    if (typeof node.getAttribute === 'function' && node.getAttribute('role') === 'textbox') return true;
  } catch {
    return false;
  }
  return false;
}

/** True when the event target lives inside a modal dialog (own keystrokes). */
export function isDialogTarget(target: EventTarget | null): boolean {
  if (!target || typeof target !== 'object') return false;
  const node = target as Partial<HTMLElement> & { closest?: (selector: string) => Element | null };
  try {
    return node.closest?.('[role="dialog"]') != null;
  } catch {
    return false;
  }
}

/**
 * Focus-aware dispatch guard. Text/input scopes own their keystrokes:
 * global editor commands must not fire while typing. Modal dialogs own
 * theirs too (Enter confirms, Escape closes): only application-scope
 * commands (palette toggle) run underneath a dialog so overlays stay
 * dismissible from anywhere.
 */
export function shouldDispatchInScope(
  scope: CommandDefinition['scope'],
  eventTarget: EventTarget | null,
  textEditing: boolean,
): boolean {
  const inField = isEditableTarget(eventTarget) || textEditing;
  if (!inField) {
    if (scope !== 'application' && isDialogTarget(eventTarget)) return false;
    return true;
  }
  return scope === 'application';
}
