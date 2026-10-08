import { useState } from 'react';
import { useI18n } from '../../app/i18n/resources';
import { IconButton } from '../../ui/primitives/controls';
import { Dialog } from '../../ui/primitives/overlays';
import { CloseIcon } from '../../ui/icons';
import type { SettingSection } from './settingsDescriptors';
import { SettingsContent, SettingsSearch } from './SettingsContent';

interface SettingsModalProps {
  onClose: () => void;
}

/**
 * Editor settings modal: the same `SettingsContent` as the settings page,
 * so new options appear here automatically with no second implementation.
 * Opens on the editor section; every section stays reachable through the
 * shared sidebar and search. The dialog header carries the search and the
 * close button, so no bottom actions are needed.
 */
export function SettingsModal({ onClose }: SettingsModalProps) {
  const { t } = useI18n();
  const [section, setSection] = useState<SettingSection>('editor');
  const [query, setQuery] = useState('');

  return (
    <Dialog
      title={t('settings.title')}
      description={t('settings.subtitle')}
      onClose={onClose}
      className="ui-dialog--wide settings-modal"
      headerExtra={
        <>
          <div className="settings__search">
            <SettingsSearch value={query} onChange={setQuery} />
          </div>
          <IconButton label={t('common.actions.close')} size="sm" onClick={onClose}>
            <CloseIcon size={14} />
          </IconButton>
        </>
      }
    >
      <SettingsContent
        section={section}
        onSectionChange={setSection}
        header={false}
        query={query}
        onQueryChange={setQuery}
      />
    </Dialog>
  );
}
