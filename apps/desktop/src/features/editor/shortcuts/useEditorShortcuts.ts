import { useEffect, useRef } from 'react';
import {
  findCommandForEvent,
  findToolForEvent,
  shouldDispatchInScope,
  isEditableTarget,
  executeCommand,
  type CommandContext,
} from '../../../registries';
import { commandResultMessage } from '../engineGaps';

interface ShortcutOptions {
  /** Live command context (refreshed per render; handler always uses the latest). */
  context: CommandContext;
  /** Whether the palette overlay is open (suppresses most shortcuts). */
  paletteOpen: boolean;
  /** Switch the persistent tool (tools are modes, not commands). */
  onToolChange: (tool: string) => void;
  /** Surface engine failures consistently. */
  notify: (message: string) => void;
  /** Translator for error messages. */
  t: (key: string, params?: Record<string, string | number>) => string;
}

/**
 * Single global shortcut listener. Shortcuts reuse commands:
 * the handler resolves a key event to one registry command and runs it
 * through `executeCommand` — never through a duplicated per-component
 * handler. Focus-aware: text/input targets only receive
 * application-scope commands; text sessions suppress editor commands.
 */
export function useEditorShortcuts({ context, paletteOpen, onToolChange, notify, t }: ShortcutOptions) {
  const ctxRef = useRef(context);
  ctxRef.current = context;
  const paletteRef = useRef(paletteOpen);
  paletteRef.current = paletteOpen;
  const toolRef = useRef(onToolChange);
  toolRef.current = onToolChange;
  const notifyRef = useRef(notify);
  notifyRef.current = notify;
  const tRef = useRef(t);
  tRef.current = t;

  useEffect(() => {
    async function onKeyDown(event: KeyboardEvent) {
      const ctx = ctxRef.current;
      if (paletteRef.current) return;
      const target = event.target as EventTarget | null;

      const modifiers = {
        shift: event.shiftKey,
        alt: event.altKey,
        ctrlOrCmd: event.ctrlKey || event.metaKey,
      };

      // Tool shortcuts are single letters with no modifiers and no text session.
      if (!modifiers.ctrlOrCmd && !modifiers.alt && event.key.length === 1) {
        if (!isEditableTarget(target) && ctx.textEditingId === null) {
          const toolId = findToolForEvent({
            key: event.key,
            ctrlKey: event.ctrlKey,
            metaKey: event.metaKey,
            altKey: event.altKey,
          });
          if (toolId) {
            event.preventDefault();
            toolRef.current(toolId);
            return;
          }
        }
      }

      const command = findCommandForEvent({
        key: event.key,
        ctrlKey: event.ctrlKey,
        metaKey: event.metaKey,
        shiftKey: event.shiftKey,
        altKey: event.altKey,
      });
      if (!command) return;

      // Text/input focus owns Delete/arrows/Ctrl+C etc.; only
      // application-scope commands (palette toggle) run there.
      if (!shouldDispatchInScope(command.scope, target, ctx.textEditingId !== null)) {
        return;
      }

      // Nudge ×10 uses the live Shift state at dispatch time.
      const execCtx: CommandContext = command.id.startsWith('nudge')
        ? { ...ctx, modifiers }
        : ctx;

      event.preventDefault();
      const result = await executeCommand(command.id, execCtx);
      const message = commandResultMessage(command.id, result, tRef.current);
      if (message) notifyRef.current(message);
      // Esc with a non-Select tool and no text session returns to Select
      // (the engine already cancelled the gesture or cleared the
      // selection; the tool reset is host chrome state). Text sessions own
      // Esc themselves via the overlay and never reach this dispatch.
      if (command.id === 'escape' && result.status === 'ok') {
        const live = ctxRef.current;
        if (live.activeTool !== 'select' && live.textEditingId === null) {
          toolRef.current('select');
        }
      }
    }

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}
