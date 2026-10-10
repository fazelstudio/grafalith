// Extension-declared settings: controls for every `configuration`
// contribution, grouped by owning extension.
//
// Values persist under the same `extension:<packageId>:<key>` localStorage
// keys the extension context reads (`workspace.config`), so an extension
// picks up changes on its next read without any host round-trip. The list
// refreshes when extension statuses change (install/uninstall/enable).
import { useEffect, useState } from 'react';
import { useI18n } from '../../app/i18n/resources';
import { Switch, TextInput } from '../../ui/primitives/controls';
import {
  extensionConfigurations,
  type ExtensionConfiguration,
} from '../../platform/extensions/extensionContributions';
import { getExtensionStatuses } from '../../platform/extensions/extensionStatus';

function storageKey(extensionId: string, key: string): string {
  return `extension:${extensionId}:${key}`;
}

function readStored<T>(extensionId: string, key: string, fallback: T): T {
  try {
    const raw = globalThis.localStorage?.getItem(storageKey(extensionId, key));
    if (raw === null || raw === undefined) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writeStored(extensionId: string, key: string, value: string | boolean | number): void {
  try {
    globalThis.localStorage?.setItem(storageKey(extensionId, key), JSON.stringify(value));
  } catch {
    // Storage full or blocked: the control below still shows the value.
  }
}

/** Whether any extension configuration matches a settings search needle. */
export function extensionSettingsMatch(needle: string): boolean {
  const term = needle.trim().toLowerCase();
  if (term === '') return true;
  return extensionConfigurations().some(
    (config) =>
      config.title.toLowerCase().includes(term) ||
      config.key.toLowerCase().includes(term) ||
      config.extensionId.toLowerCase().includes(term),
  );
}

/** Settings controls declared by installed extensions. */
export function ExtensionSettings({ query = '' }: { query?: string } = {}): React.JSX.Element {
  const { t } = useI18n();
  const [, setTick] = useState(0);
  const [values, setValues] = useState<Record<string, string | boolean | number>>({});

  useEffect(() => {
    const subscription = getExtensionStatuses().onDidChange(() => setTick((tick) => tick + 1));
    return () => subscription.dispose();
  }, []);

  const needle = query.trim().toLowerCase();
  const configs = extensionConfigurations().filter(
    (config) =>
      needle === '' ||
      config.title.toLowerCase().includes(needle) ||
      config.key.toLowerCase().includes(needle) ||
      config.extensionId.toLowerCase().includes(needle),
  );
  if (configs.length === 0) {
    return <p className="settings__note">{t('settings.extensions.empty')}</p>;
  }
  const byExtension = new Map<string, ExtensionConfiguration[]>();
  for (const config of configs) {
    const group = byExtension.get(config.extensionId) ?? [];
    group.push(config);
    byExtension.set(config.extensionId, group);
  }

  const valueOf = (config: ExtensionConfiguration): string | boolean | number => {
    const id = `${config.extensionId}:${config.key}`;
    if (values[id] !== undefined) return values[id];
    return readStored(config.extensionId, config.key, config.default);
  };

  const commit = (config: ExtensionConfiguration, value: string | boolean | number): void => {
    writeStored(config.extensionId, config.key, value);
    setValues((current) => ({ ...current, [`${config.extensionId}:${config.key}`]: value }));
  };

  return (
    <div>
      {[...byExtension].map(([extensionId, group]) => (
        <div key={extensionId}>
          <h3 className="settings__card-title">{extensionId}</h3>
          {group.map((config) => {
            const current = valueOf(config);
            if (typeof config.default === 'boolean') {
              return (
                <Switch
                  key={config.key}
                  label={config.title}
                  checked={current === true}
                  onChange={(checked) => commit(config, checked)}
                  description={config.key}
                />
              );
            }
            return (
              <TextInput
                key={config.key}
                label={config.title}
                type={typeof config.default === 'number' ? 'number' : 'text'}
                inputMode={typeof config.default === 'number' ? 'numeric' : undefined}
                value={String(current)}
                onChange={(event) => {
                  const raw = event.target.value;
                  commit(
                    config,
                    typeof config.default === 'number' ? (Number(raw) || 0) : raw,
                  );
                }}
              />
            );
          })}
        </div>
      ))}
    </div>
  );
}
