import { useMemo, useRef, useState } from 'react';
import { useI18n } from '../../app/i18n/resources';
import { LOCALE_LIST, type Locale } from '../../app/i18n/locales';
import { useTheme } from '../../app/theme/ThemeProvider';
import { THEME_MODES, type ThemeMode } from '../../app/theme/tokens';
import { SearchInput, SegmentedControl, Select, Switch, TextInput, Button, Divider } from '../../ui/primitives/controls';
import {
  GridViewIcon,
  ListViewIcon,
  MoonIcon,
  SettingsIcon,
  SunIcon,
  SystemIcon,
} from '../../ui/icons';
import { useToast } from '../../app/shell/ToastProvider';
import { resolveIcon } from '../../ui/iconRegistry';
import { preferenceService } from '../../platform/preferences/preferenceService';
import {
  AUTOSAVE_DELAY_MS,
  DEFAULT_HOME_VIEW_MODE,
  HOME_VIEW_MODES,
  normalizeAutosaveDelayMs,
  type HomeViewMode,
} from '../../platform/preferences/editorWorkspace';
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
  type SettingSectionDefinition,
} from './settingsDescriptors';
import './settings.css';

interface SettingsContentProps {
  section: SettingSection;
  onSectionChange: (section: SettingSection) => void;
  /** Page shows the workspace header; the modal dialog owns the title instead. */
  header?: boolean;
  query: string;
  onQueryChange: (next: string) => void;
}

const themeIcons: Record<ThemeMode, React.ReactNode> = {
  system: <SystemIcon size={14} />,
  light: <SunIcon size={14} />,
  dark: <MoonIcon size={14} />,
};

const homeViewIcons: Record<HomeViewMode, React.ReactNode> = {
  grid: <GridViewIcon size={14} />,
  list: <ListViewIcon size={14} />,
};

/**
 * Sidebar icons resolve through the shared icon registry, so sections added
 * by the host or future extensions render without branching in this file.
 */
function sectionIcon(id: string) {
  return resolveIcon(id) ?? SettingsIcon;
}

interface ShortcutRow {
  id: string;
  label: string;
  shortcut: string;
}

/**
 * Single settings content shared by the settings page and the editor
 * settings modal. Sidebar entries follow the section registry, controls
 * follow the setting registry, and every control writes through the
 * preference service — so adding an option in one place updates both
 * surfaces with no second implementation to keep in sync. Only settings
 * backed by real behavior are registered — startup and storage
 * preferences stay absent until they exist.
 */
export function SettingsContent({ section, onSectionChange, header = true, query, onQueryChange }: SettingsContentProps) {
  const { t, locale, setLocale } = useI18n();
  const { mode, setMode } = useTheme();
  const { notify } = useToast();
  const tabs = settingSectionRegistry.all();
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const [showHint, setShowHint] = useState<boolean>(() => preferenceService.getShowCanvasHint());
  const [restoreViewport, setRestoreViewport] = useState<boolean>(() => preferenceService.getRestoreViewport());
  const [autosaveEnabled, setAutosaveEnabled] = useState<boolean>(() => preferenceService.getAutosaveEnabled());
  const [autosaveDelayMs, setAutosaveDelayMs] = useState<string>(() =>
    String(preferenceService.getAutosaveDelayMs()),
  );
  const [homeView, setHomeView] = useState<HomeViewMode>(() => preferenceService.getHomeViewMode());
  const shortcutRows = useShortcutRows();

  const needle = query.trim().toLowerCase();
  const isSearching = needle !== '';

  function changeTheme(next: ThemeMode): void {
    setMode(next);
    notify(t('notifications.themeChanged', { theme: t(`settings.appearance.themeModes.${next}`) }));
  }

  function changeHomeView(next: HomeViewMode): void {
    preferenceService.setHomeViewMode(next);
    setHomeView(next);
    notify(t('notifications.layoutChanged', { layout: t(`home.view.${next}`) }));
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
    } else if (id === 'autosaveEnabled') {
      preferenceService.setAutosaveEnabled(checked);
      setAutosaveEnabled(checked);
    }
  }

  function switchValue(id: string): boolean {
    if (id === 'autosaveEnabled') return autosaveEnabled;
    return id === 'canvasHint' ? showHint : restoreViewport;
  }

  function changeNumber(id: string, raw: string): void {
    if (id !== 'autosaveDelayMs') return;
    setAutosaveDelayMs(raw);
    const parsed = Number(raw);
    if (raw.trim() !== '' && Number.isFinite(parsed)) {
      preferenceService.setAutosaveDelayMs(parsed);
    }
  }

  function commitNumber(id: string): void {
    if (id !== 'autosaveDelayMs') return;
    const normalized = normalizeAutosaveDelayMs(Number(autosaveDelayMs));
    preferenceService.setAutosaveDelayMs(normalized);
    setAutosaveDelayMs(String(normalized));
  }

  function numberValue(id: string): string {
    return id === 'autosaveDelayMs' ? autosaveDelayMs : '';
  }

  function resetSection(target: SettingSection): void {
    for (const setting of settingsForSection(target)) {
      if (setting.id === 'locale') {
        // Persisted by the provider; no notification until the shared one below.
        setLocale('en');
      } else if (setting.id === 'theme') {
        setMode('system');
      } else if (setting.id === 'homeView') {
        preferenceService.setHomeViewMode(DEFAULT_HOME_VIEW_MODE);
        setHomeView(DEFAULT_HOME_VIEW_MODE);
      } else if (setting.id === 'canvasHint') {
        preferenceService.setShowCanvasHint(true);
        setShowHint(true);
      } else if (setting.id === 'restoreViewport') {
        preferenceService.setRestoreViewport(true);
        setRestoreViewport(true);
      } else if (setting.id === 'autosaveEnabled') {
        preferenceService.setAutosaveEnabled(true);
        setAutosaveEnabled(true);
      } else if (setting.id === 'autosaveDelayMs') {
        preferenceService.setAutosaveDelayMs(AUTOSAVE_DELAY_MS.default);
        setAutosaveDelayMs(String(AUTOSAVE_DELAY_MS.default));
      }
    }
    notify(t('notifications.settingsReset'));
  }

  function renderSetting(setting: SettingDefinition): React.ReactNode {
    return (
      <SettingControl
        key={setting.id}
        setting={setting}
        themeMode={mode}
        onThemeChange={changeTheme}
        homeViewMode={homeView}
        onHomeViewChange={changeHomeView}
        locale={locale}
        onLocaleChange={changeLocale}
        switchChecked={setting.control === 'switch' ? switchValue(setting.id) : false}
        onSwitchChange={changeSwitch}
        numberText={setting.control === 'number' ? numberValue(setting.id) : ''}
        onNumberChange={changeNumber}
        onNumberCommit={commitNumber}
      />
    );
  }

  function settingMatches(setting: SettingDefinition): boolean {
    if (!isSearching) return true;
    if (t(setting.labelKey).toLowerCase().includes(needle)) return true;
    return (
      setting.descriptionKey !== undefined &&
      t(setting.descriptionKey).toLowerCase().includes(needle)
    );
  }

  function matchingSettings(tab: SettingSectionDefinition): readonly SettingDefinition[] {
    return settingsForSection(tab.id as SettingSection)
      .filter(isSettingAvailable)
      .filter(settingMatches);
  }

  function matchingShortcuts(): readonly ShortcutRow[] {
    return filterShortcutRows(shortcutRows, needle);
  }

  function sectionMatches(tab: SettingSectionDefinition): boolean {
    if (!isSearching) return true;
    if (t(tab.labelKey).toLowerCase().includes(needle)) return true;
    if (t(`settings.${tab.id}.description`).toLowerCase().includes(needle)) return true;
    if (matchingSettings(tab).length > 0) return true;
    return tab.id === 'shortcuts' && matchingShortcuts().length > 0;
  }

  const visibleTabs = tabs.filter(sectionMatches);

  function onSidebarKeyDown(event: React.KeyboardEvent): void {
    if (
      event.key !== 'ArrowUp' &&
      event.key !== 'ArrowDown' &&
      event.key !== 'ArrowLeft' &&
      event.key !== 'ArrowRight' &&
      event.key !== 'Home' &&
      event.key !== 'End'
    ) {
      return;
    }
    event.preventDefault();
    const index = visibleTabs.findIndex((tab) => tab.id === section);
    const from = index === -1 ? 0 : index;
    let next = from;
    if (event.key === 'ArrowDown' || event.key === 'ArrowRight') {
      next = (from + 1) % visibleTabs.length;
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      next = (from - 1 + visibleTabs.length) % visibleTabs.length;
    } else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = visibleTabs.length - 1;
    chooseTab(visibleTabs[next]);
    // Hash routing re-renders synchronously enough for direct focus here;
    // the roving tabindex below keeps the tab order correct regardless.
    setTimeout(() => tabRefs.current[next]?.focus(), 0);
  }

  function chooseTab(tab: SettingSectionDefinition): void {
    // Picking a search result returns to single-section mode.
    if (isSearching) onQueryChange('');
    onSectionChange(tab.id as SettingSection);
  }

  const visible = settingsForSection(section).filter(isSettingAvailable);
  const resettable = visible.some((setting) => setting.control !== 'shortcutList');

  return (
    <div className={`settings${header ? '' : ' settings--modal'}`}>
      {header ? (
        <header className="workspace-page-header settings__page-header">
          <div>
            <h1 className="workspace-page-title">{t('settings.title')}</h1>
            <p className="workspace-page-description">{t('settings.subtitle')}</p>
          </div>
          <div className="settings__header-actions">
            <div className="settings__search">
              <SettingsSearch value={query} onChange={onQueryChange} />
            </div>
          </div>
        </header>
      ) : null}
      <div className="settings__body">
        <nav
          className="settings__sidebar"
          role="tablist"
          aria-orientation="vertical"
          aria-label={t('settings.title')}
          onKeyDown={onSidebarKeyDown}
        >
          {visibleTabs.map((tab, index) => {
            const Icon = sectionIcon(tab.icon);
            const selected = !isSearching && section === tab.id;
            return (
              <button
                key={tab.id}
                ref={(node) => {
                  tabRefs.current[index] = node;
                }}
                type="button"
                role="tab"
                id={`settings-tab-${tab.id}`}
                aria-selected={selected}
                aria-controls={`settings-panel-${tab.id}`}
                tabIndex={selected || (isSearching && index === 0) ? 0 : -1}
                className={`settings__sidebar-item${selected ? ' settings__sidebar-item--active' : ''}`}
                onClick={() => chooseTab(tab)}
              >
                <Icon className="settings__sidebar-icon" size={16} />
                <span className="settings__sidebar-label">{t(tab.labelKey)}</span>
              </button>
            );
          })}
        </nav>
        {isSearching ? (
          <section className="settings__card" aria-label={t('settings.search.label')}>
            {visibleTabs.length === 0 ? (
              <p className="settings__note">{t('settings.search.empty')}</p>
            ) : (
              visibleTabs.map((tab) => (
                <div key={tab.id} className="settings__result-group">
                  <h2 className="settings__card-title">{t(tab.labelKey)}</h2>
                  <Divider />
                  {matchingSettings(tab).map(renderSetting)}
                  {tab.id === 'shortcuts' ? <ShortcutList rows={matchingShortcuts()} /> : null}
                </div>
              ))
            )}
          </section>
        ) : (
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
            <Divider />
            {visible.map(renderSetting)}
            {section === 'shortcuts' ? <ShortcutBrowser /> : null}
            {resettable ? (
              <div className="settings__actions">
                <Button variant="secondary" size="sm" onClick={() => resetSection(section)}>
                  {t('settings.actions.resetSection')}
                </Button>
              </div>
            ) : null}
          </section>
        )}
      </div>
    </div>
  );
}

/** Shared search field; one definition serves the page header and the modal dialog header. */
export function SettingsSearch({ value, onChange }: { value: string; onChange: (next: string) => void }) {
  const { t } = useI18n();
  return (
    <SearchInput
      label={t('settings.search.label')}
      placeholder={t('settings.search.placeholder')}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.stopPropagation();
          if (value !== '') {
            onChange('');
          } else {
            event.currentTarget.blur();
          }
        }
      }}
    />
  );
}

interface SettingControlProps {
  setting: SettingDefinition;
  themeMode: ThemeMode;
  onThemeChange: (mode: ThemeMode) => void;
  homeViewMode: HomeViewMode;
  onHomeViewChange: (mode: HomeViewMode) => void;
  locale: string;
  onLocaleChange: (locale: string) => void;
  switchChecked: boolean;
  onSwitchChange: (id: string, checked: boolean) => void;
  numberText: string;
  onNumberChange: (id: string, raw: string) => void;
  onNumberCommit: (id: string) => void;
}

function SettingControl({
  setting,
  themeMode,
  onThemeChange,
  homeViewMode,
  onHomeViewChange,
  locale,
  onLocaleChange,
  switchChecked,
  onSwitchChange,
  numberText,
  onNumberChange,
  onNumberCommit,
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
  if (setting.control === 'homeView') {
    return (
      <div>
        <SegmentedControl<HomeViewMode>
          label={t(setting.labelKey)}
          value={homeViewMode}
          onChange={onHomeViewChange}
          options={HOME_VIEW_MODES.map((view) => ({
            value: view,
            label: t(`home.view.${view}`),
            icon: homeViewIcons[view],
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
          onChange={(next) => onLocaleChange(next)}
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
  if (setting.control === 'number') {
    return (
      <div>
        <TextInput
          label={t(setting.labelKey)}
          type="number"
          inputMode="numeric"
          value={numberText}
          min={setting.min}
          max={setting.max}
          step={setting.step ?? 1}
          onChange={(event) => onNumberChange(setting.id, event.target.value)}
          onBlur={() => onNumberCommit(setting.id)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') (event.target as HTMLInputElement).blur();
          }}
        />
        {setting.descriptionKey ? (
          <p className="settings__field-description">{t(setting.descriptionKey)}</p>
        ) : null}
      </div>
    );
  }
  return null;
}

/** Every registered command chord and tool key, unfiltered. */
function useShortcutRows(): readonly ShortcutRow[] {
  const { t } = useI18n();
  return useMemo(() => {
    const out: ShortcutRow[] = [];
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
}

function filterShortcutRows(rows: readonly ShortcutRow[], needle: string): readonly ShortcutRow[] {
  const term = needle.trim().toLowerCase();
  if (term === '') return rows;
  return rows.filter(
    (row) =>
      row.label.toLowerCase().includes(term) ||
      row.id.toLowerCase().includes(term) ||
      row.shortcut.toLowerCase().includes(term),
  );
}

function ShortcutList({ rows }: { rows: readonly ShortcutRow[] }) {
  const { t } = useI18n();
  return (
    <ul className="settings__shortcut-list" aria-label={t('settings.shortcuts.title')}>
      {rows.map((row) => (
        <li key={row.id} className="settings__shortcut-row">
          <span className="settings__shortcut-label">{row.label}</span>
          <kbd className="ui-shortcut">{row.shortcut}</kbd>
        </li>
      ))}
    </ul>
  );
}

/**
 * Read-only shortcut browser: every registered command chord and tool key
 * in one searchable list. Customization stays out — the command system has
 * no safe override support, so this surface never pretends to edit.
 */
function ShortcutBrowser() {
  const { t } = useI18n();
  const rows = useShortcutRows();
  const [query, setQuery] = useState('');

  const filtered = filterShortcutRows(rows, query);

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
        <ShortcutList rows={filtered} />
      )}
      <p className="settings__note">{t('settings.shortcuts.fixedNote')}</p>
    </div>
  );
}
