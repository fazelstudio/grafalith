import { useEffect, useState } from 'react';
import { notifyBootDataReady } from '../../app/boot';
import { executeAppCommand } from '../../registries/appCommands';
import { settingSectionRegistry, type SettingSection } from './settingsDescriptors';
import { SettingsContent } from './SettingsContent';

export type { SettingSection };

interface SettingsScreenProps {
  section: SettingSection;
  onNavigate: (path: string) => void;
}

/**
 * Full settings page: route-owned section plus the shared content. All
 * controls live in `SettingsContent` so the page and the editor modal
 * render (and persist) the same settings from one implementation.
 */
export function SettingsScreen({ section, onNavigate }: SettingsScreenProps) {
  const tabs = settingSectionRegistry.all();
  const [query, setQuery] = useState('');

  // Preferences render synchronously, so mounting already means ready to show.
  useEffect(() => {
    notifyBootDataReady();
  }, []);

  const active = tabs.some((tab) => tab.id === section) ? section : 'general';

  function handleSectionChange(next: SettingSection): void {
    const tab = tabs.find((entry) => entry.id === next);
    if (!tab) return;
    // Section switches run through the shared settings command so the
    // page, modal, palette, and future extensions share one path.
    void executeAppCommand('settings.openSection', {
      targetName: tab.id,
      openSettingsSection: (section) => {
        const target = tabs.find((entry) => entry.id === section);
        if (target) onNavigate(target.path);
      },
    }).then((result) => {
      if (result.status !== 'ok') onNavigate(tab.path);
    });
  }

  return (
    <SettingsContent
      section={active}
      onSectionChange={handleSectionChange}
      header
      query={query}
      onQueryChange={setQuery}
    />
  );
}
