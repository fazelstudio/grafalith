const settings = {
  title: 'Settings',
  subtitle: 'Appearance and general preferences. Changes apply immediately.',
  general: {
    title: 'General',
    description: 'Language and basic application preferences.',
    offlineNote: 'OpenNary works offline. Preferences are stored locally on this device.',
    localeLabel: 'Language',
    localeDescription: 'Interface language. Applied without reload.',
    localeNames: {
      en: 'English',
      id: 'Indonesian',
    },
  },
  appearance: {
    title: 'Appearance',
    description: 'Theme for the application chrome.',
    themeLabel: 'Theme',
    themeDescription: 'Follow the system or choose a fixed theme.',
    themeModes: {
      system: 'System',
      light: 'Light',
      dark: 'Dark',
    },
  },
  editor: {
    title: 'Editor',
    description: 'Canvas workspace preferences. Only options backed by real behavior appear here.',
    canvasHintLabel: 'Show canvas hint',
    canvasHintDescription: 'Show the getting-started hint on an empty canvas.',
    restoreViewportLabel: 'Restore canvas position',
    restoreViewportDescription: 'Reopen each project at its last canvas position.',
  },
  shortcuts: {
    title: 'Shortcuts',
    description: 'Every keyboard shortcut in one searchable list.',
    searchLabel: 'Search shortcuts',
    searchPlaceholder: 'Search shortcuts…',
    empty: 'No matching shortcuts.',
    fixedNote: 'Shortcuts are fixed in this release. The command system does not support safe overrides yet.',
  },
  actions: {
    resetSection: 'Reset to defaults',
  },
};

export default settings;
