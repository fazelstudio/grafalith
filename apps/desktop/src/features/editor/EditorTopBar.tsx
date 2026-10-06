import {
  commandRegistry,
  canExecuteCommand,
  executeCommand,
  commandShortcutLabel,
  panelRegistry,
  type CommandContext,
} from '../../registries';
import { commandResultMessage } from './engineGaps';
import { EditorMenu } from './menus/menus';
import { Button } from '../../ui/primitives/controls';
import { useI18n } from '../../app/i18n/resources';
import { useToast } from '../../app/shell/ToastProvider';
import { BackIcon } from '../../ui/icons';

interface EditorTopBarProps {
  projectName: string;
  saveLabel: string;
  saveDisabled: boolean;
  onSave: () => void;
  onBack: () => void;
  context: CommandContext;
  openPanels: readonly string[];
  onTogglePanel: (id: string) => void;
  onOpenPalette: () => void;
}

const HISTORY_COMMANDS = ['undo', 'redo'] as const;

/**
 * High-value editor bar: identity, save state, shared history commands,
 * edit menu, palette access, and panel toggles. All actions reuse the
 * command registry; no duplicated handlers live here.
 */
export function EditorTopBar({
  projectName,
  saveLabel,
  saveDisabled,
  onSave,
  onBack,
  context,
  openPanels,
  onTogglePanel,
  onOpenPalette,
}: EditorTopBarProps) {
  const { t } = useI18n();
  const { notify } = useToast();

  function commandTitle(id: string): string {
    const command = commandRegistry.get(id);
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
    <div className="editor-topbar">
      <Button variant="ghost" size="sm" onClick={onBack} title={t('navigation.backToHome')}>
        <BackIcon size={14} />
        {t('navigation.backToHome')}
      </Button>
      <span className="editor-topbar__name" title={projectName}>
        {projectName}
      </span>
      <span className="editor-topbar__save" aria-live="polite">
        {saveLabel}
      </span>
      <Button
        variant="secondary"
        size="sm"
        onClick={onSave}
        disabled={saveDisabled}
        title={t('editor.project.save')}
      >
        {t('editor.project.save')}
      </Button>
      <span className="editor-topbar__divider" aria-hidden="true" />
      {HISTORY_COMMANDS.map((id) => {
        const command = commandRegistry.get(id);
        if (!command) return null;
        const verdict = canExecuteCommand(id, context);
        return (
          <Button
            key={id}
            variant="ghost"
            size="sm"
            onClick={() => void runCommand(id)}
            disabled={!verdict.executable}
            title={commandTitle(id)}
          >
            {t(command.labelKey)}
          </Button>
        );
      })}
      <EditorMenu context={context} onExecute={(id) => void runCommand(id)} />
      <Button
        variant="ghost"
        size="sm"
        onClick={onOpenPalette}
        title={commandTitle('commandPalette')}
      >
        {t('editor.commands.commandPalette')}
      </Button>
      <span className="editor-topbar__spacer" />
      {panelRegistry.all().map((panel) => {
        const open = openPanels.includes(panel.id);
        return (
          <Button
            key={panel.id}
            variant="ghost"
            size="sm"
            onClick={() => onTogglePanel(panel.id)}
            aria-pressed={open}
            title={t(panel.toggleKey)}
          >
            {t(panel.labelKey)}
          </Button>
        );
      })}
    </div>
  );
}
