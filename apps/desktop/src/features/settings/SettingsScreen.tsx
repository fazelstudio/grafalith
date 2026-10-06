import { useEffect, useMemo, useRef, useState } from 'react';
import { useI18n } from '../../app/i18n/resources';
import { notifyBootDataReady } from '../../app/boot';
import { LOCALE_LIST, type Locale } from '../../app/i18n/locales';
import { useTheme } from '../../app/theme/ThemeProvider';
import { THEME_MODES, type ThemeMode } from '../../app/theme/tokens';
import { SearchInput, SegmentedControl, Select, Switch, Button } from '../../ui/primitives/controls';
import { MoonIcon, SunIcon, SystemIcon } from '../../ui/icons';
import { useToast } from '../../app/shell/ToastProvider';
import { preferenceService } from '../../platform/preferences/preferenceService';
import {
  commandRegistry,
  commandShortcutLabel,
  toolRegistry,
} from '../../registries';
import {
  isSettingAvailable,
  settingSectionRegistry,
  settingsForSection,
  type SettingDefinition,
  type SettingSection,
} from './settingsDescriptors';
import './settings.css';

export type { SettingSection };

interface SettingsScreenProps {
  section: SettingSection;
  onNavigate: (path: string) => void;
}

const themeIcons: Record<ThemeMode, React.ReactNode> = {
  system: <SystemIcon size={14} />,
  light: <SunIcon size={14} />,
  dark: <MoonIcon size={14} />,
};

/**
 * Descriptor-driven settings: tabs follow the section registry, controls
 * follow the setting registry. Only settings backed by real behavior are
 * registered — startup and storage preferences stay absent until they exist.
 */
export function SettingsScreen({ section, onNavigate }: SettingsScreenProps) {
  const tabs = settingSectionRegistry.all();
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);

  // Preferences render synchronously, so mounting already means ready to show.
  useEffect(() => {
    notifyBootDataReady();
  }, []);

  function onTabsKeyDown(event: React.KeyboardEvent): void {
    if (
      event.key !== 'ArrowLeft' &&
      event.key !== 'ArrowRight' &&
      event.key !== 'Home' &&
      event.key !== 'End'
    ) {
      return;
    }
    event.preventDefault();
    const index = tabs.findIndex((tab) => tab.id === section);
    let next = index;
    if (event.key === 'ArrowRight') next = (index + 1) % tabs.length;
    else if (event.key === 'ArrowLeft') next = (index - 1 + tabs.length) % tabs.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = tabs.length - 1;
    onNavigate(tabs[next].path);
    // Hash routing re-renders synchronously enough for direct focus here;
    // the roving tabindex below keeps the tab order correct regardless.
    setTimeout(() => tabRefs.current[next]?.focus(), 0);
  }

  const active = tabs.some((tab) => tab.id === section) ? section : 'general';

  return (
    <div className="settings">
      <SettingsBody section={active} onNavigate={onNavigate} onTabsKeyDown={onTabsKeyDown} tabRefs={tabRefs} tabs={tabs} />
    </div>
  );
}

interface SettingsBodyProps {
  section: SettingSection;
  onNavigate: (path: string) => void;
  onTabsKeyDown: (event: React.KeyboardEvent) => void;
  tabRefs: React.RefObject<(HTMLButtonElement | null)[]>;
  tabs: readonly { id: string; labelKey: string; path: string }[];
}

function SettingsBody({ section, onNavigate, onTabsKeyDown, tabRefs, tabs }: SettingsBodyProps) {
  const { t, locale, setLocale } = useI18n();
  const { mode, setMode } = useTheme();
  const { notify } = useToast();
  const [showHint, setShowHint] = useState<boolean>(() => preferenceService.getShowCanvasHint());
  const [restoreViewport, setRestoreViewport] = useState<boolean>(() => preferenceService.getRestoreViewport());

  function changeTheme(next: ThemeMode): void {
    setMode(next);
    notify(t('notifications.themeChanged', { theme: t(`settings.appearance.themeModes.${next}`) }));
  }

  function changeLocale(next: string): void {
    if (next !== 'en' && next !== 'id') return;
    setLocale(next as Locale);
    notify(t('notifications.localeChanged', { language: t(`settings.general.localeNames.${next}`) }));
  }

  function changeSwitch(id: string, checked: boolean): void {
    if (id === 'canvasHint') {
      preferenceService.setShowCanvasHint(checked);
      setShowHint(checked);
    } else if (id === 'restoreViewport') {
      preferenceService.setRestoreViewport(checked);
      setRestoreViewport(checked);
    }
  }

  function switchValue(id: string): boolean {
    return id === 'canvasHint' ? showHint : restoreViewport;
  }

  function resetSection(target: SettingSection): void {
    for (const setting of settingsForSection(target)) {
      if (setting.id === 'locale') {
        // Persisted by the provider; no notification until the shared one below.
        setLocale('en');
      } else if (setting.id === 'theme') {
        setMode('system');
      } else if (setting.id === 'canvasHint') {
        preferenceService.setShowCanvasHint(true);
        setShowHint(true);
      } else if (setting.id === 'restoreViewport') {
        preferenceService.setRestoreViewport(true);
        setRestoreViewport(true);
      }
    }
    notify(t('notifications.settingsReset'));
  }

  const visible = settingsForSection(section).filter(isSettingAvailable);
  const resettable = visible.some((setting) => setting.control !== 'shortcutList');

  return (
    <div className="settings__inner">
      <div>
        <h1 className="settings__title">{t('settings.title')}</h1>
        <p className="settings__subtitle">{t('settings.subtitle')}</p>
      </div>
      <div className="settings__tabs" role="tablist" aria-label={t('settings.title')} onKeyDown={onTabsKeyDown}>
        {tabs.map((tab, index) => (
          <button
            key={tab.id}
            ref={(node) => {
              tabRefs.current[index] = node;
            }}
            type="button"
            role="tab"
            id={`settings-tab-${tab.id}`}
            aria-selected={section === tab.id}
            aria-controls={`settings-panel-${tab.id}`}
            tabIndex={section === tab.id ? 0 : -1}
            className="settings__tab"
            onClick={() => onNavigate(tab.path)}
          >
            {t(tab.labelKey)}
          </button>
        ))}
      </div>
      <section
        className="settings__card"
        role="tabpanel"
        id={`settings-panel-${section}`}
        aria-labelledby={`settings-tab-${section}`}
      >
        <h2 className="settings__card-title">{t(`settings.${section}.title`)}</h2>
        <p className="settings__card-description">{t(`settings.${section}.description`)}</p>
        {section === 'general' ? (
          <p className="settings__note">{t('settings.general.offlineNote')}</p>
        ) : null}
        {visible.map((setting) => (
          <SettingControl
            key={setting.id}
            setting={setting}
            themeMode={mode}
            onThemeChange={changeTheme}
            locale={locale}
            onLocaleChange={changeLocale}
            switchChecked={setting.control === 'switch' ? switchValue(setting.id) : false}
            onSwitchChange={changeSwitch}
          />
        ))}
        {section === 'shortcuts' ? <ShortcutBrowser /> : null}
        {resettable ? (
          <div className="settings__actions">
            <Button variant="secondary" size="sm" onClick={() => resetSection(section)}>
              {t('settings.actions.resetSection')}
            </Button>
          </div>
        ) : null}
      </section>
    </div>
  );
}

interface SettingControlProps {
  setting: SettingDefinition;
  themeMode: ThemeMode;
  onThemeChange: (mode: ThemeMode) => void;
  locale: string;
  onLocaleChange: (locale: string) => void;
  switchChecked: boolean;
  onSwitchChange: (id: string, checked: boolean) => void;
}

function SettingControl({
  setting,
  themeMode,
  onThemeChange,
  locale,
  onLocaleChange,
  switchChecked,
  onSwitchChange,
}: SettingControlProps) {
  const { t } = useI18n();
  if (setting.control === 'theme') {
    return (
      <div>
        <SegmentedControl<ThemeMode>
          label={t(setting.labelKey)}
          value={themeMode}
          onChange={onThemeChange}
          options={THEME_MODES.map((mode) => ({
            value: mode,
            label: t(`settings.appearance.themeModes.${mode}`),
            icon: themeIcons[mode],
            title: t(setting.descriptionKey ?? setting.labelKey),
          }))}
        />
        {setting.descriptionKey ? (
          <p className="settings__field-description">{t(setting.descriptionKey)}</p>
        ) : null}
      </div>
    );
  }
  if (setting.control === 'locale') {
    return (
      <div>
        <Select
          label={t(setting.labelKey)}
          value={locale}
          onChange={(event) => onLocaleChange(event.target.value)}
          options={LOCALE_LIST.map((entry) => ({ value: entry.code, label: t(entry.nameKey) }))}
        />
        {setting.descriptionKey ? (
          <p className="settings__field-description">{t(setting.descriptionKey)}</p>
        ) : null}
      </div>
    );
  }
  if (setting.control === 'switch') {
    return (
      <Switch
        label={t(setting.labelKey)}
        checked={switchChecked}
        onChange={(checked) => onSwitchChange(setting.id, checked)}
        description={setting.descriptionKey ? t(setting.descriptionKey) : undefined}
      />
    );
  }
  return null;
}

/**
 * Read-only shortcut browser: every registered command chord and tool key
 * in one searchable list. Customization stays out — the command system has
 * no safe override support, so this surface never pretends to edit.
 */
function ShortcutBrowser() {
  const { t } = useI18n();
  const [query, setQuery] = useState('');

  const rows = useMemo(() => {
    const out: { id: string; label: string; shortcut: string }[] = [];
    for (const command of commandRegistry.all()) {
      const primary = command.shortcuts?.[0];
      if (!primary) continue;
      out.push({
        id: `command:${command.id}`,
        label: t(command.labelKey),
        shortcut: commandShortcutLabel(command) ?? '',
      });
    }
    for (const tool of toolRegistry.all()) {
      if (!tool.shortcutHint) continue;
      out.push({
        id: `tool:${tool.id}`,
        label: t(tool.labelKey),
        shortcut: tool.shortcutHint.toUpperCase(),
      });
    }
    return out;
  }, [t]);

  const needle = query.trim().toLowerCase();
  const filtered =
    needle === ''
      ? rows
      : rows.filter(
          (row) =>
            row.label.toLowerCase().includes(needle) ||
            row.id.toLowerCase().includes(needle) ||
            row.shortcut.toLowerCase().includes(needle),
        );

  return (
    <div className="settings__shortcuts">
      <SearchInput
        label={t('settings.shortcuts.searchLabel')}
        placeholder={t('settings.shortcuts.searchPlaceholder')}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
      {filtered.length === 0 ? (
        <p className="settings__note">{t('settings.shortcuts.empty')}</p>
      ) : (
        <ul className="settings__shortcut-list" aria-label={t('settings.shortcuts.title')}>
          {filtered.map((row) => (
            <li key={row.id} className="settings__shortcut-row">
              <span className="settings__shortcut-label">{row.label}</span>
              <kbd className="ui-shortcut">{row.shortcut}</kbd>
            </li>
          ))}
        </ul>
      )}
      <p className="settings__note">{t('settings.shortcuts.fixedNote')}</p>
    </div>
  );
}
