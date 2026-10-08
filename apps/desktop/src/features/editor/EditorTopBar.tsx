import { executeCommand, type AppCommandContext, type CommandContext } from '../../registries';
import { commandResultMessage } from './engineGaps';
import { EditorMenuBar } from './menus/menus';
import { useI18n } from '../../app/i18n/resources';
import { useToast } from '../../app/shell/ToastProvider';

interface EditorTopBarProps {
  context: CommandContext;
  appContext: AppCommandContext;
  onExecuteAppCommand: (id: string, patch?: Partial<AppCommandContext>) => void;
}

/**
 * Editor menubar: File, Edit, and View only. Project identity lives in the
 * titlebar quick switcher, persistence runs through manual Save and the
 * autosave preference, and history/palette run through the shared registries
 * without duplicated handlers.
 */
export function EditorTopBar({ context, appContext, onExecuteAppCommand }: EditorTopBarProps) {
  const { t } = useI18n();
  const { notify } = useToast();

  async function runCommand(id: string) {
    const result = await executeCommand(id, context);
    const message = commandResultMessage(id, result, t);
    if (message) notify(message);
  }

  return (
    <div className="editor-topbar">
      <EditorMenuBar
        context={context}
        appContext={appContext}
        onExecuteCommand={(id) => void runCommand(id)}
        onExecuteAppCommand={(id, patch) => onExecuteAppCommand(id, patch)}
      />
      <span className="editor-topbar__spacer" />
    </div>
  );
}
