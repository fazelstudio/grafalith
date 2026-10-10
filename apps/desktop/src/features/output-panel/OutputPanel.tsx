// Output panel: switchable per-extension logs plus the system channel.
//
// The bottom panel lists every channel (`getOutputChannels().names()`)
// with the system channel ("Grafalith — Extensions") first. Extension
// errors always land here with detail; users open it from the Extension
// Manager (Output button) or the palette (`grafalith.output.showSystem`).
import { useEffect, useState } from 'react';
import { useI18n } from '../../app/i18n/resources';
import { getOutputChannels, SYSTEM_OUTPUT_CHANNEL } from '../../platform/extensions/outputChannel';

function orderedNames(names: readonly string[]): string[] {
  const rest = names.filter((name) => name !== SYSTEM_OUTPUT_CHANNEL);
  return names.includes(SYSTEM_OUTPUT_CHANNEL) ? [SYSTEM_OUTPUT_CHANNEL, ...rest] : [...rest];
}

/** Switchable output logs for every extension plus the system channel. */
export function OutputPanel(): React.JSX.Element {
  const { t } = useI18n();
  const [names, setNames] = useState<string[]>(() => orderedNames(getOutputChannels().names()));
  const [selected, setSelected] = useState<string>(SYSTEM_OUTPUT_CHANNEL);
  const [lines, setLines] = useState<readonly string[]>([]);

  useEffect(() => {
    const channels = getOutputChannels();
    // Ensure the system channel exists so the panel never renders empty.
    channels.system();
    setNames(orderedNames(channels.names()));
    const visible = channels.visibleChannel();
    if (visible) setSelected(visible);
    const subscription = channels.onDidChangeVisible((name) => {
      setNames(orderedNames(channels.names()));
      if (name) setSelected(name);
    });
    return () => subscription.dispose();
  }, []);

  useEffect(() => {
    const channel = getOutputChannels().channel(selected);
    setLines(channel.lines());
    const subscription = channel.onDidAppend(() => {
      setLines(channel.lines());
    });
    return () => subscription.dispose();
  }, [selected]);

  return (
    <section aria-label={t('extensions.output.title')}>
      <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
        <label>
          {t('extensions.output.channel')}{' '}
          <select value={selected} onChange={(event) => setSelected(event.target.value)}>
            {names.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <button type="button" onClick={() => getOutputChannels().channel(selected).clear()}>
          {t('extensions.output.clear')}
        </button>
      </div>
      <pre style={{ maxHeight: 240, overflow: 'auto', margin: 0 }}>{lines.join('\n')}</pre>
    </section>
  );
}
