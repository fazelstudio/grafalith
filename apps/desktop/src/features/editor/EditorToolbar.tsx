import {
  commandsForSurface,
  canExecuteCommand,
  executeCommand,
  commandShortcutLabel,
  toolGroups,
  toolsForGroup,
  toolRegistry,
  type CommandContext,
} from '../../registries';
import { commandResultMessage } from './engineGaps';
import { Button } from '../../ui/primitives/controls';
import { useI18n } from '../../app/i18n/resources';
import { useToast } from '../../app/shell/ToastProvider';

interface EditorToolbarProps {
  activeTool: string;
  onToolChange: (tool: string) => void;
  context: CommandContext;
}

/**
 * Registry-driven toolbar: tool sections derive from tool groups, action
 * buttons derive from toolbar-surface commands. No per-tool or per-command
 * branching lives here; adding a tool or command is a registry change.
 */
export function EditorToolbar({ activeTool, onToolChange, context }: EditorToolbarProps) {
  const { t } = useI18n();
  const { notify } = useToast();
  const actions = commandsForSurface('toolbar');

  function toolTitle(id: string): string {
    const tool = toolRegistry.get(id);
    if (!tool) return id;
    const base = tool.descriptionKey ? t(tool.descriptionKey) : t(tool.labelKey);
    return tool.shortcutHint ? `${base} (${tool.shortcutHint})` : base;
  }

  function commandTitle(id: string): string {
    const command = actions.find((entry) => entry.id === id);
    if (!command) return id;
    const base = command.descriptionKey ? t(command.descriptionKey) : t(command.labelKey);
    const shortcut = commandShortcutLabel(command);
    return shortcut ? `${base} (${shortcut})` : base;
  }

  async function runCommand(id: string) {
    const result = await executeCommand(id, context);
    const message = commandResultMessage(id, result, t);
    if (message) notify(message);
  }

  return (
    <div className="editor-toolbar">
      <div className="editor-toolbar__tools" role="toolbar" aria-label={t('editor.title')}>
        {toolGroups().map((group, index) => (
          <div
            key={group}
            className="editor-toolbar__group"
            role="group"
            aria-label={t(`editor.toolGroups.${group}`)}
          >
            {index > 0 ? <span className="editor-toolbar__divider" aria-hidden="true" /> : null}
            {toolsForGroup(group).map((tool) => (
              <button
                key={tool.id}
                type="button"
                onClick={() => onToolChange(tool.id)}
                aria-pressed={activeTool === tool.id}
                aria-keyshortcuts={tool.shortcutHint}
                title={toolTitle(tool.id)}
                className="ui-button ui-button--sm ui-button--secondary editor-toolbar__tool"
              >
                {t(tool.labelKey)}
              </button>
            ))}
          </div>
        ))}
      </div>
      <div className="editor-toolbar__spacer" />
      <div className="editor-toolbar__actions">
        {actions.map((command) => {
          const verdict = canExecuteCommand(command.id, context);
          return (
            <Button
              key={command.id}
              size="sm"
              onClick={() => void runCommand(command.id)}
              disabled={!verdict.executable}
              title={commandTitle(command.id)}
            >
              {t(command.labelKey)}
            </Button>
          );
        })}
      </div>
    </div>
  );
}
