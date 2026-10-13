// Extension toolbar tools: per-kind buttons contributed by extensions.
//
// Built-in tools switch the engine tool mode; extension tools run their
// command instead (automation, generators, overlays). Buttons refresh
// when extension statuses change because activation lands after the
// toolbar mounts. Failures toast; the toolbar never breaks.
import { useEffect, useState } from 'react';
import { useToast } from '../../app/shell/ToastProvider';
import { useI18n } from '../../app/i18n/resources';
import { Tooltip } from '../../ui/primitives/tooltip';
import { resolveIcon } from '../../ui/iconRegistry';
import { getExtensionHost } from '../../platform/extensions/extensionHost';
import { getExtensionStatuses } from '../../platform/extensions/extensionStatus';
import { extensionEditorToolsFor } from '../../platform/extensions/extensionContributions';
import type { ProjectKind } from '../../platform/projects/types';

/** Per-kind extension tool buttons rendered after the built-in tools. */
export function ExtensionTools({
  kind,
}: {
  kind: ProjectKind;
}): React.JSX.Element | null {
  const { notify } = useToast();
  const { t } = useI18n();
  const [, setTick] = useState(0);
  useEffect(() => {
    const subscription = getExtensionStatuses().onDidChange(() => setTick((tick) => tick + 1));
    return () => subscription.dispose();
  }, []);
  const tools = extensionEditorToolsFor(kind);
  if (tools.length === 0) return null;

  const run = async (command: string, title: string): Promise<void> => {
    const outcome = await getExtensionHost().executeCommand(command);
    if (!outcome.ok) {
      notify(
        t('notifications.extensions.toolFailed', {
          title,
          reason: outcome.reason ?? 'unknown error',
        }),
        { level: 'error' },
      );
    }
  };

  return (
    <>
      {tools.map((tool) => {
        const Icon = resolveIcon(tool.icon);
        return (
          <Tooltip key={`${tool.extensionId}:${tool.id}`} content={tool.title} placement="top">
            <button
              type="button"
              onClick={() => void run(tool.command, tool.title)}
              title={tool.title}
              aria-label={tool.title}
              className="ui-button ui-button--sm ui-button--secondary editor-toolbar__tool"
              data-extension-tool={`${tool.extensionId}:${tool.id}`}
            >
              {Icon ? <Icon size={18} /> : <span aria-hidden="true">{tool.title.slice(0, 1)}</span>}
              <span className="sr-only">{tool.title}</span>
            </button>
          </Tooltip>
        );
      })}
    </>
  );
}
